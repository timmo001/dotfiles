import { Effect } from "effect";
import { expandHomePath } from "../lib/paths.js";
import {
  appendUsageEvent,
  readAllEvents,
  usageEventKey,
  usageCommandKey,
  usageRoot,
  type UsageEvent,
} from "../lib/usage.js";
import { scanShellHistory } from "../lib/usageHistory.js";

/** Aggregated usage stats for one tool + command feature. */
interface FeatureAgg {
  /** Tool name. */
  readonly tool: string;
  /** Command/feature path joined by spaces. */
  readonly command: string;
  /** Total invocations. */
  total: number;
  /** Invocations attributed to a human. */
  human: number;
  /** Invocations attributed to an agent. */
  agent: number;
  /** Invocations attributed to status-bar/automation polls. */
  automation: number;
  /** Invocations that exited non-zero. */
  failures: number;
  /** Most recent ISO timestamp seen. */
  lastSeen: string;
  /** Recorded durations in milliseconds. */
  readonly durations: number[];
}

/** Options parsed from `dot usage` arguments. */
/** Typed usage-report input supplied by the Effect CLI command. */
export interface UsageOptions {
  /** Subcommand: summary, stale, path, backfill, or help. */
  readonly subcommand: "summary" | "stale" | "path" | "backfill";
  /** Day window for summary/stale. */
  readonly days: number;
  /** Output format for summary. */
  readonly format: "text" | "json" | "agent-context";
  /** Extra event roots to combine with the default root. */
  readonly roots: readonly string[];
  /** Whether backfill should write events (otherwise dry-run). */
  readonly apply: boolean;
}

/** Human-readable label used in help and headers. */
const FEATURE_KEY = (event: UsageEvent): string =>
  `${event.tool} ${event.command.join(" ")}`.trim();

/** Resolve the roots to read: default root plus any explicit `--root`. */
function resolveRoots(options: UsageOptions): readonly string[] {
  return [usageRoot(), ...options.roots];
}

/** ISO timestamp for `days` before now. */
function cutoffIso(days: number): string {
  return new Date(Date.now() - days * 86_400_000).toISOString();
}

/** Aggregate events into per-feature stats. */
function aggregate(events: readonly UsageEvent[]): readonly FeatureAgg[] {
  const byKey = new Map<string, FeatureAgg>();
  for (const event of events) {
    const key = FEATURE_KEY(event);
    let agg = byKey.get(key);
    if (!agg) {
      agg = {
        tool: event.tool,
        command: event.command.join(" "),
        total: 0,
        human: 0,
        agent: 0,
        automation: 0,
        failures: 0,
        lastSeen: event.ts,
        durations: [],
      };
      byKey.set(key, agg);
    }
    agg.total += 1;
    if (event.invoker === "agent") agg.agent += 1;
    else if (event.invoker === "automation") agg.automation += 1;
    else agg.human += 1;
    if (event.exitCode !== null && event.exitCode !== 0) agg.failures += 1;
    if (event.ts > agg.lastSeen) agg.lastSeen = event.ts;
    if (event.durationMs !== null) agg.durations.push(event.durationMs);
  }
  return [...byKey.values()].sort((a, b) => b.total - a.total);
}

/** Median of a set of numbers, or null when empty. */
function median(values: readonly number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? Math.round((sorted[mid - 1] + sorted[mid]) / 2)
    : sorted[mid];
}

/** Count distinct machines represented in a set of events. */
function machineCount(events: readonly UsageEvent[]): number {
  return new Set(events.map((event) => event.machine)).size;
}

/** Render the plain-text summary table. */
function renderText(
  events: readonly UsageEvent[],
  aggs: readonly FeatureAgg[],
  days: number,
): string {
  if (aggs.length === 0) {
    return `No usage events in the last ${days} days.\nRun \`dot usage backfill --history\` to import from shell history.`;
  }
  const header = `Usage summary (last ${days} days · ${machineCount(events)} machine(s) · ${events.length} events)`;
  const cols = [
    "TOOL".padEnd(8),
    "COMMAND".padEnd(20),
    "USES".padStart(6),
    "HUMAN".padStart(6),
    "AGENT".padStart(6),
    "AUTO".padStart(6),
    "FAIL".padStart(5),
    "P50ms".padStart(7),
    "LAST",
  ].join("  ");
  const rows = aggs.map((agg) => {
    const p50 = median(agg.durations);
    return [
      agg.tool.padEnd(8),
      (agg.command || "(root)").padEnd(20),
      String(agg.total).padStart(6),
      String(agg.human).padStart(6),
      String(agg.agent).padStart(6),
      String(agg.automation).padStart(6),
      String(agg.failures).padStart(5),
      (p50 === null ? "-" : String(p50)).padStart(7),
      agg.lastSeen.slice(0, 10),
    ].join("  ");
  });
  return [header, "", cols, ...rows].join("\n");
}

/** Render the JSON summary payload. */
function renderJson(
  events: readonly UsageEvent[],
  aggs: readonly FeatureAgg[],
  days: number,
): string {
  return JSON.stringify(
    {
      days,
      machines: machineCount(events),
      events: events.length,
      features: aggs.map((agg) => ({
        tool: agg.tool,
        command: agg.command,
        total: agg.total,
        human: agg.human,
        agent: agg.agent,
        automation: agg.automation,
        failures: agg.failures,
        lastSeen: agg.lastSeen,
        p50DurationMs: median(agg.durations),
      })),
    },
    null,
    2,
  );
}

/** Render the compact, agent-facing context summary. */
function renderAgentContext(
  events: readonly UsageEvent[],
  aggs: readonly FeatureAgg[],
  days: number,
): string {
  if (aggs.length === 0) {
    return `No tool usage recorded in the last ${days} days.`;
  }
  const top = [...aggs]
    .sort((a, b) => b.human + b.agent - (a.human + a.agent))
    .slice(0, 10)
    .map((agg) => {
      const label = `${agg.tool} ${agg.command}`.trim();
      const auto = agg.automation > 0 ? `, ${agg.automation} auto` : "";
      return `- ${label} — ${agg.human + agg.agent} interactive (${agg.human} human / ${agg.agent} agent${auto}), last ${agg.lastSeen.slice(0, 10)}`;
    });
  const failing = aggs
    .filter((agg) => agg.failures > 0)
    .slice(0, 10)
    .map(
      (agg) =>
        `- ${`${agg.tool} ${agg.command}`.trim()} — ${agg.failures} failed of ${agg.total}`,
    );
  const lines = [`## Tool usage (last ${days} days)`, "", "Most used:", ...top];
  if (failing.length > 0) {
    lines.push("", "Recently failing:", ...failing);
  }
  return lines.join("\n");
}

/** Run `dot usage summary`. */
function runSummary(options: UsageOptions): string {
  const cutoff = cutoffIso(options.days);
  const events = readAllEvents(resolveRoots(options)).filter(
    (event) => event.ts >= cutoff,
  );
  const aggs = aggregate(events);
  switch (options.format) {
    case "json":
      return renderJson(events, aggs, options.days);
    case "agent-context":
      return renderAgentContext(events, aggs, options.days);
    default:
      return renderText(events, aggs, options.days);
  }
}

/** Run `dot usage stale`: features not seen within the window. */
function runStale(
  options: UsageOptions,
  commandNames: readonly string[],
): string {
  const cutoff = cutoffIso(options.days);
  const events = readAllEvents(resolveRoots(options));
  const lastSeen = new Map<string, string>();
  for (const event of events) {
    const key = FEATURE_KEY(event);
    const current = lastSeen.get(key);
    if (!current || event.ts > current) lastSeen.set(key, event.ts);
  }

  const staleObserved = [...lastSeen.entries()]
    .filter(([, ts]) => ts < cutoff)
    .sort((a, b) => a[1].localeCompare(b[1]))
    .map(([key, ts]) => `  ${key.padEnd(28)} last ${ts.slice(0, 10)}`);

  const neverSeen = commandNames
    .map((command) => `dot ${command}`)
    .filter((key) => !lastSeen.has(key))
    .map((key) => `  ${key}`);

  const lines = [`Features not used in the last ${options.days} days:`];
  lines.push(staleObserved.length > 0 ? staleObserved.join("\n") : "  (none)");
  lines.push("", "dot commands never recorded:");
  lines.push(neverSeen.length > 0 ? neverSeen.join("\n") : "  (none)");
  return lines.join("\n");
}

/** Run `dot usage backfill`: import whitelisted invocations from history. */
function runBackfill(options: UsageOptions): string {
  const scan = scanShellHistory();
  const recorded = readAllEvents([usageRoot()]);
  const existing = new Set(recorded.map(usageEventKey));
  const firstLiveByCommand = new Map<string, string>();
  for (const event of recorded) {
    if (event.source !== "live") continue;
    const key = usageCommandKey(event);
    const current = firstLiveByCommand.get(key);
    if (!current || event.ts < current) firstLiveByCommand.set(key, event.ts);
  }
  const fresh = scan.events.filter((event) => {
    const key = usageEventKey(event);
    if (existing.has(key)) return false;
    const liveSince = firstLiveByCommand.get(usageCommandKey(event));
    if (liveSince && event.ts >= liveSince) return false;
    existing.add(key);
    return true;
  });

  const lines = ["Shell history backfill:"];
  for (const source of scan.sources) {
    const status = !source.found
      ? "not found"
      : (source.note ?? `${source.imported} whitelisted entries`);
    lines.push(`  ${source.shell.padEnd(5)} ${status}`);
  }

  const byTool = new Map<string, number>();
  for (const event of fresh) {
    byTool.set(event.tool, (byTool.get(event.tool) ?? 0) + 1);
  }
  lines.push("", `New events to import: ${fresh.length}`);
  for (const [tool, count] of [...byTool.entries()].sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    lines.push(`  ${tool.padEnd(8)} ${count}`);
  }

  if (!options.apply) {
    lines.push("", "Dry run. Re-run with --apply to write these events.");
    return lines.join("\n");
  }

  for (const event of fresh) appendUsageEvent(event);
  lines.push("", `Imported ${fresh.length} events to ${usageRoot()}.`);
  return lines.join("\n");
}

/** Run the `dot usage` command. */
export function usage(
  input: UsageOptions & { readonly history: boolean },
  commandNames: readonly string[],
): Effect.Effect<void> {
  return Effect.sync(() => {
    const options = { ...input, roots: input.roots.map(expandHomePath) };
    const output = (() => {
      switch (options.subcommand) {
        case "path":
          return usageRoot();
        case "stale":
          return runStale(options, commandNames);
        case "backfill":
          return runBackfill(options);
        case "summary":
          return runSummary(options);
        default:
          return runSummary(options);
      }
    })();
    process.stdout.write(`${output}\n`);
  });
}
