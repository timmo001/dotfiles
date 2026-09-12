import { Clock, Effect, Schema } from "effect";
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { cpus, hostname, loadavg, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { displayPath, expandHomePath } from "../lib/paths.js";
import { isAgent } from "../lib/agent.js";
import { ENV, envString } from "../lib/env.js";
import { Launcher } from "../services/Launcher.js";

const unavailable = Schema.is(
  Schema.Struct({
    code: Schema.Literals(["ENOENT", "ESRCH", "EACCES", "EPERM"]),
  }),
);

const processFields = Schema.Struct({
  parent: Schema.FiniteFromString,
  user: Schema.FiniteFromString,
  system: Schema.FiniteFromString,
  start: Schema.FiniteFromString,
});

const memoryFields = Schema.Struct({
  MemTotal: Schema.Finite,
  MemAvailable: Schema.Finite,
  SwapTotal: Schema.Finite,
  SwapFree: Schema.Finite,
});

const pressureFields = Schema.Struct({
  avg10: Schema.FiniteFromString,
  avg60: Schema.FiniteFromString,
  avg300: Schema.FiniteFromString,
  total: Schema.FiniteFromString,
});

function parsePressure(line: string | undefined) {
  if (!line) return null;

  const values = Schema.decodeUnknownSync(pressureFields)(
    Object.fromEntries(
      line
        .trim()
        .split(/\s+/)
        .slice(1)
        .map((field) => field.split("=")),
    ),
  );

  return {
    avg10Percent: values.avg10,
    avg60Percent: values.avg60,
    avg300Percent: values.avg300,
    totalMicroseconds: values.total,
  };
}

function markdownText(value: string) {
  return value.replace(/[\\`*_[\]|<>]/g, "\\$&").replace(/\p{Cc}/gu, " ");
}

function readOptional(path: string) {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    if (unavailable(error)) return undefined;

    throw error;
  }
}

function readCounters(source: string) {
  return Object.fromEntries(
    source
      .trim()
      .split("\n")
      .map((line) => {
        const [key, value] = line.split(/:\s+/);

        return [
          key,
          Schema.decodeUnknownSync(Schema.FiniteFromString)(
            value?.split(/\s+/)[0],
          ),
        ];
      }),
  );
}

function readProcesses() {
  const processes = new Map<
    number,
    {
      name: string;
      parent: number;
      ticks: number;
      start: number;
    }
  >();

  for (const pid of readdirSync("/proc").filter((name) => /^\d+$/.test(name))) {
    const stat = readOptional(`/proc/${pid}/stat`);

    if (!stat) continue;

    const end = stat.lastIndexOf(")");

    const fields = stat
      .slice(end + 2)
      .trim()
      .split(/\s+/);

    const parsed = Schema.decodeUnknownSync(processFields)({
      parent: fields[1],
      user: fields[11],
      system: fields[12],
      start: fields[19],
    });

    processes.set(Number(pid), {
      name: stat.slice(stat.indexOf("(") + 1, end).replace(/\p{Cc}/gu, "?"),
      parent: parsed.parent,
      ticks: parsed.user + parsed.system,
      start: parsed.start,
    });
  }

  return processes;
}

function readCpu() {
  const fields = readFileSync("/proc/stat", "utf8")
    .split("\n")[0]
    ?.trim()
    .split(/\s+/)
    .slice(1, 9);

  const ticks = Schema.decodeUnknownSync(Schema.Array(Schema.FiniteFromString))(
    fields,
  );

  return {
    total: ticks.reduce((sum, value) => sum + value, 0),
    idle: (ticks[3] ?? 0) + (ticks[4] ?? 0),
  };
}

/** Failure to collect or save a CPU and memory snapshot. */
export class SnapshotError extends Schema.TaggedError<SnapshotError>()(
  "SnapshotError",
  {
    message: Schema.String,
  },
) {}

/** Sample Linux CPU usage and save memory totals and process rankings. */
export const snapshot = Effect.fn("Snapshot.run")(function* ({
  output,
  json = false,
  sort = "mem",
  limit = 40,
  minMemoryMib = 80,
  minCpu = 1,
}: {
  output?: string;
  json?: boolean;
  sort?: "cpu" | "mem";
  limit?: number;
  minMemoryMib?: number;
  minCpu?: number;
}) {
  const agent = isAgent();
  const jsonOutput = json || agent;
  const timestamp = yield* Clock.currentTimeMillis;

  const before = yield* Effect.try({
    try: () => ({
      processes: readProcesses(),
      cpu: readCpu(),
      time: performance.now(),
    }),
    catch: (error) => new SnapshotError({ message: String(error) }),
  });

  yield* Effect.sleep("1 second");

  const report = yield* Effect.try({
    try: () => {
      const after = {
        cpu: readCpu(),
        time: performance.now(),
        processes: readProcesses(),
      };

      const elapsed = after.cpu.total - before.cpu.total;

      if (elapsed <= 0) throw new Error("CPU counters did not advance");

      const memory = Schema.decodeUnknownSync(memoryFields)(
        readCounters(readFileSync("/proc/meminfo", "utf8")),
      );

      const used = memory.MemTotal - memory.MemAvailable;
      const cores = cpus().length;
      const groups = new Map<string, { count: number; pss: number }>();

      const rows: {
        pid: number;
        parent: number;
        name: string;
        cpu: number | undefined;
        pss: number | undefined;
      }[] = [];

      let missingPss = 0;

      for (const [pid, current] of after.processes) {
        const previous = before.processes.get(pid);

        const cpu =
          previous?.start === current.start
            ? (Math.max(0, current.ticks - previous.ticks) / elapsed) *
              cores *
              100
            : undefined;

        const smaps = readOptional(`/proc/${pid}/smaps_rollup`);

        const pss = smaps
          ? readCounters(smaps.split("\n").slice(1).join("\n")).Pss
          : undefined;

        if (pss === undefined) missingPss++;
        else {
          const group = groups.get(current.name) ?? { count: 0, pss: 0 };
          group.count++;
          group.pss += pss;
          groups.set(current.name, group);
        }

        rows.push({
          pid,
          parent: current.parent,
          name: current.name,
          cpu,
          pss,
        });
      }

      const pressure = ["cpu", "memory", "io"].map((resource) => {
        const lines = readOptional(`/proc/pressure/${resource}`)?.split("\n");

        return {
          resource,
          some: parsePressure(lines?.find((line) => line.startsWith("some "))),
          full: parsePressure(lines?.find((line) => line.startsWith("full "))),
        };
      });

      const cpuBusy = 100 * (1 - (after.cpu.idle - before.cpu.idle) / elapsed);
      const memoryPercent = (used / memory.MemTotal) * 100;

      const cpuRows = rows
        .filter((row) => row.cpu !== undefined)
        .sort((a, b) => (b.cpu ?? 0) - (a.cpu ?? 0));

      const memoryGroups = [...groups].sort((a, b) => b[1].pss - a[1].pss);

      const memoryRows = rows
        .filter((row) => row.pss !== undefined)
        .sort((a, b) => (b.pss ?? 0) - (a.pss ?? 0));

      const loads = loadavg();

      const formatMemory = (kb: number) =>
        kb >= 1048576
          ? `${(kb / 1048576).toFixed(2)} GiB`
          : `${(kb / 1024).toFixed(1)} MiB`;

      const formatRow = (row: (typeof rows)[number]) =>
        `| ${markdownText(row.name)} | ${row.cpu?.toFixed(1) ?? "n/a"} | ${row.pss === undefined ? "n/a" : formatMemory(row.pss)} | ${row.pid} |`;

      const tableHeader = [
        "| Process | CPU % | Memory (PSS) | PID |",
        "| :--- | ---: | ---: | ---: |",
      ];

      interface ProcessNode {
        pid: number;
        parentPid: number;
        name: string;
        cpuPercent: number | null;
        pssBytes: number | null;
        parentUnavailable: boolean;
        subtreeCpuPercent: number;
        subtreePssBytes: number;
        subtreeProcessCount: number;
        children: ProcessNode[];
      }

      const nodes = new Map<number, ProcessNode>(
        rows.map((row) => [
          row.pid,
          {
            pid: row.pid,
            parentPid: row.parent,
            name: row.name,
            cpuPercent: row.cpu ?? null,
            pssBytes: row.pss === undefined ? null : row.pss * 1024,
            parentUnavailable: false,
            subtreeCpuPercent: row.cpu ?? 0,
            subtreePssBytes: (row.pss ?? 0) * 1024,
            subtreeProcessCount: 1,
            children: [],
          },
        ]),
      );

      const roots: ProcessNode[] = [];

      for (const node of nodes.values()) {
        const parent = nodes.get(node.parentPid);
        const ancestors = new Set([node.pid]);
        let ancestor = parent;

        while (ancestor && !ancestors.has(ancestor.pid)) {
          ancestors.add(ancestor.pid);
          ancestor = nodes.get(ancestor.parentPid);
        }

        if (parent && !ancestor) parent.children.push(node);
        else {
          node.parentUnavailable = node.parentPid !== 0;
          roots.push(node);
        }
      }

      const sortTree = (branches: ProcessNode[]) => {
        for (const node of branches) {
          sortTree(node.children);
          node.subtreeCpuPercent += node.children.reduce(
            (sum, child) => sum + child.subtreeCpuPercent,
            0,
          );
          node.subtreePssBytes += node.children.reduce(
            (sum, child) => sum + child.subtreePssBytes,
            0,
          );
          node.subtreeProcessCount += node.children.reduce(
            (sum, child) => sum + child.subtreeProcessCount,
            0,
          );
        }

        branches.sort(
          (a, b) =>
            (sort === "cpu"
              ? b.subtreeCpuPercent - a.subtreeCpuPercent
              : b.subtreePssBytes - a.subtreePssBytes) || a.pid - b.pid,
        );
      };

      sortTree(roots);

      const subtreeUsage = (node: ProcessNode) =>
        sort === "cpu" ? node.subtreeCpuPercent : node.subtreePssBytes;

      const threshold = sort === "cpu" ? minCpu : minMemoryMib * 1048576;

      const aboveThreshold = (node: ProcessNode) =>
        subtreeUsage(node) > 0 && subtreeUsage(node) >= threshold;

      const included = new Set<number>();
      const candidates = roots.filter(aboveThreshold);

      // Expand the largest remaining branch, counting ancestors in the same budget.
      while (candidates.length > 0 && included.size < limit) {
        candidates.sort(
          (a, b) => subtreeUsage(b) - subtreeUsage(a) || a.pid - b.pid,
        );
        const node = candidates.shift();

        if (!node) break;
        included.add(node.pid);
        candidates.push(...node.children.filter(aboveThreshold));
      }

      const treeLines = () => {
        const lines: string[] = [];

        const visit = (branches: readonly ProcessNode[], prefix: string) => {
          const visible = branches.filter((node) => included.has(node.pid));

          for (const [index, node] of visible.entries()) {
            const last = index === visible.length - 1;

            const memoryText =
              node.pssBytes === null && node.children.length === 0
                ? "n/a"
                : formatMemory(node.subtreePssBytes / 1024);

            const cpuText =
              node.cpuPercent === null && node.children.length === 0
                ? "n/a"
                : `${node.subtreeCpuPercent.toFixed(1)}%`;

            const missing = node.parentUnavailable
              ? " [parent unavailable]"
              : "";

            lines.push(
              `${memoryText.padStart(10)}  ${cpuText.padStart(7)}  ${prefix}${last ? "└─" : "├─"} ${node.name.replaceAll("`", "'")}${missing}`,
            );
            visit(node.children, `${prefix}${last ? "   " : "│  "}`);
          }
        };

        visit(roots, "");

        return lines.length > 0
          ? ["    Memory      CPU  Process", ...lines]
          : ["No measured process subtree meets the cutoff."];
      };

      const summary = [
        "# CPU and memory snapshot",
        "",
        `**${markdownText(hostname())}** · ${new Date(timestamp).toISOString()}`,
        "",
        "| Metric | Usage | Detail |",
        "| :--- | ---: | :--- |",
        `| CPU | **${cpuBusy.toFixed(1)}%** | ${cores} logical CPUs |`,
        `| RAM | **${memoryPercent.toFixed(1)}%** | ${formatMemory(used)} / ${formatMemory(memory.MemTotal)} |`,
        `| Available | ${formatMemory(memory.MemAvailable)} | Includes reclaimable memory |`,
        `| Swap | ${formatMemory(memory.SwapTotal - memory.SwapFree)} | Used |`,
        "",
        "## Process tree",
        "",
        `Sorted by ${sort === "cpu" ? "CPU" : "memory"}, minimum ${sort === "cpu" ? `${minCpu}% CPU` : `${minMemoryMib} MiB PSS`} per subtree. Up to ${limit} visible processes, including parents.`,
        "",
        "Usage includes children, even when hidden. Parent and child totals overlap.",
        "",
        "```text",
        ...treeLines(),
        "```",
        "",
        `${included.size} processes shown; ${nodes.size - included.size} hidden.${candidates.length > 0 ? ` Display limit reached; use --limit ${limit * 2} to expand.` : ""}`,
        "",
        `**Pressure (10s):** ${pressure.map((entry) => `${entry.resource} ${entry.some === null ? "n/a" : `${entry.some.avg10Percent.toFixed(2)}%`}`).join(" · ")}`,
        "",
        "Process CPU: 100% = one logical CPU. PSS divides shared pages between processes.",
        "",
      ].join("\n");

      const full = [
        summary,
        "## Top CPU processes",
        "",
        ...tableHeader,
        ...cpuRows
          .filter((row) => (row.cpu ?? 0) > 0 && (row.cpu ?? 0) >= minCpu)
          .slice(0, limit)
          .map(formatRow),
        "",
        "## Top memory processes",
        "",
        ...tableHeader,
        ...memoryRows
          .filter(
            (row) =>
              (row.pss ?? 0) > 0 && (row.pss ?? 0) >= minMemoryMib * 1024,
          )
          .slice(0, limit)
          .map(formatRow),
        "",
        "## Memory groups",
        "",
        "| Process | Memory (PSS) | Count |",
        "| :--- | ---: | ---: |",
        ...memoryGroups
          .filter(
            ([, group]) => group.pss > 0 && group.pss >= minMemoryMib * 1024,
          )
          .slice(0, limit)
          .map(
            ([name, group]) =>
              `| ${markdownText(name)} | ${formatMemory(group.pss)} | ${group.count} |`,
          ),
        "",
        "## Pressure",
        "",
        "| Resource | Stalls | 10s % | 60s % | 300s % | Total µs |",
        "| :--- | :--- | ---: | ---: | ---: | ---: |",
        ...pressure.flatMap((entry) =>
          (["some", "full"] as const).map((kind) => {
            const values = entry[kind];

            return `| ${entry.resource} | ${kind} | ${values?.avg10Percent ?? "n/a"} | ${values?.avg60Percent ?? "n/a"} | ${values?.avg300Percent ?? "n/a"} | ${values?.totalMicroseconds ?? "n/a"} |`;
          }),
        ),
        "",
        "## Measurement details",
        "",
        `- Ranking tables show up to ${limit} entries each, with cutoffs of ${minMemoryMib} MiB PSS and ${minCpu}% CPU. Memory groups combine processes with the same name.`,
        `- CPU sample: ${((after.time - before.time) / 1000).toFixed(2)} seconds. New processes show n/a.`,
        `- Load average (1/5/15 minutes): ${loads.map((value) => value.toFixed(2)).join(" / ")}.`,
        `- PSS unavailable for ${missingPss} processes (permissions, kernel threads or exited processes).`,
        "- Process totals exclude unmeasured processes and kernel memory.",
        "",
      ].join("\n");

      const data = {
        schemaVersion: 1,
        sort,
        reportSelection: {
          limit,
          minMemoryMib,
          minCpuPercent: minCpu,
          visiblePids: [...included],
          omittedProcessCount: nodes.size - included.size,
          limitReached: candidates.length > 0,
        },
        timestamp: new Date(timestamp).toISOString(),
        hostname: hostname(),
        sampleDurationMilliseconds: after.time - before.time,
        cpu: {
          busyPercent: cpuBusy,
          logicalCpus: cores,
          loadAverage: {
            oneMinute: loads[0],
            fiveMinutes: loads[1],
            fifteenMinutes: loads[2],
          },
          processPercentPerCore: true,
        },
        memory: {
          totalBytes: memory.MemTotal * 1024,
          usedBytes: used * 1024,
          availableBytes: memory.MemAvailable * 1024,
          usedPercent: memoryPercent,
          swapUsedBytes: (memory.SwapTotal - memory.SwapFree) * 1024,
        },
        pressure,
        processes: [...rows]
          .sort(
            (a, b) =>
              (sort === "cpu"
                ? (b.cpu ?? -1) - (a.cpu ?? -1)
                : (b.pss ?? -1) - (a.pss ?? -1)) || a.pid - b.pid,
          )
          .map((row) => ({
            pid: row.pid,
            parentPid: row.parent,
            name: row.name,
            cpuPercent: row.cpu ?? null,
            pssBytes: row.pss === undefined ? null : row.pss * 1024,
          })),
        processTree: roots,
        memoryGroups: memoryGroups.map(([name, group]) => ({
          name,
          measuredProcessCount: group.count,
          pssBytes: group.pss * 1024,
        })),
        measurement: {
          pssUnavailableProcessCount: missingPss,
          processTotalsIncludeKernelMemory: false,
        },
      };

      return { summary, full, data };
    },
    catch: (error) => new SnapshotError({ message: String(error) }),
  });

  const target = output
    ? resolve(expandHomePath(output))
    : join(
        tmpdir(),
        `dot-snapshot-${new Date(timestamp).toISOString().replaceAll(":", "-")}.${jsonOutput ? "json" : "md"}`,
      );

  yield* Effect.try({
    try: () => {
      mkdirSync(dirname(target), { recursive: true });

      const content = jsonOutput
        ? `${JSON.stringify({ ...report.data, reportPath: target }, null, 2)}\n`
        : report.full;

      writeFileSync(target, content, { mode: 0o600, flag: "wx" });
      console.log(
        jsonOutput
          ? content.trimEnd()
          : `${report.summary}\nFull report: ${markdownText(displayPath(target))}\n`,
      );
    },
    catch: (error) => new SnapshotError({ message: String(error) }),
  });

  if (!agent && !jsonOutput && process.stdin.isTTY && process.stdout.isTTY) {
    const launcher = yield* Launcher;
    const editor = envString(ENV.EDITOR)?.trim() || "vi";

    yield* launcher.suspendArgv([
      "sh",
      "-c",
      `exec ${editor} "$1"`,
      "dot-snapshot",
      target,
    ]);
  }
});
