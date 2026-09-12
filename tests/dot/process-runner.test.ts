import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const root = resolve(import.meta.dir, "../..");

const temporary: string[] = [];

afterEach(() => {
  for (const directory of temporary.splice(0))
    rmSync(directory, { recursive: true, force: true });
});

function run(args: string[]) {
  return Bun.spawn(
    [process.execPath, "run", "dot/src/index.ts", "run", ...args],
    {
      cwd: root,
      stdin: "pipe",
      stdout: "pipe",
      stderr: "pipe",
    },
  );
}

function alive(pid: number) {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");

    return (
      stat.slice(stat.lastIndexOf(")") + 2, stat.lastIndexOf(")") + 3) !== "Z"
    );
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ENOENT")
      return false;
    throw error;
  }
}

test("passes arguments and separate streams through, preserving the exit code", async () => {
  const child = run([
    "--timeout",
    "5 seconds",
    "--",
    "node",
    "-e",
    `
    let input = '';
    process.stdin.on('data', (chunk) => input += chunk);
    process.stdin.on('end', () => {
      process.stdout.write(JSON.stringify({ args: process.argv.slice(1), input }));
      process.stderr.write('diagnostic');
      process.exitCode = 23;
    });
  `,
    "--",
    "--help",
    "--no-help",
    "a b",
    "",
    "--timeout=1ms",
  ]);

  child.stdin.write("input\n");
  child.stdin.end();

  const [code, stdout, stderr] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);

  expect(code).toBe(23);
  expect(JSON.parse(stdout)).toEqual({
    args: ["--help", "--no-help", "a b", "", "--timeout=1ms"],
    input: "input\n",
  });
  expect(stderr).toBe("diagnostic");
});

test("times out and kills a TERM-resistant child and grandchild", async () => {
  const directory = mkdtempSync(join(tmpdir(), "dot-run-"));
  temporary.push(directory);
  const pids = join(directory, "pids");

  const child = run([
    "--timeout",
    "1 second",
    "--kill-after",
    "100 millis",
    "--",
    "node",
    "-e",
    `
    const { spawn } = require('node:child_process');
    process.on('SIGTERM', () => {});
    const child = spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    require('node:fs').writeFileSync(process.argv[1], process.pid + '\\n' + child.pid);
    setInterval(() => {}, 1000);
  `,
    pids,
  ]);

  expect(await child.exited).toBe(124);
  expect(await new Response(child.stderr).text()).toContain(
    "command exceeded 1s",
  );

  for (const pid of readFileSync(pids, "utf8").split("\n").map(Number))
    expect(alive(pid)).toBe(false);
});

test("cleans remaining children when the direct child exits successfully", async () => {
  const directory = mkdtempSync(join(tmpdir(), "dot-run-"));
  temporary.push(directory);
  const pidFile = join(directory, "pid");

  const child = run([
    "--timeout",
    "5 seconds",
    "--kill-after",
    "100 millis",
    "--",
    "node",
    "-e",
    `
    const child = require('node:child_process').spawn(process.execPath, ['-e', 'process.on("SIGTERM", () => {}); setInterval(() => {}, 1000)'], { stdio: 'ignore' });
    require('node:fs').writeFileSync(process.argv[1], String(child.pid));
    child.unref();
  `,
    pidFile,
  ]);

  expect(await child.exited).toBe(0);
  expect(alive(Number(readFileSync(pidFile, "utf8")))).toBe(false);
});

test("SIGTERM cleans the owned group and exits with the signal status", async () => {
  const child = run([
    "--timeout",
    "10 seconds",
    "--kill-after",
    "100 millis",
    "--",
    "node",
    "-e",
    `
    process.on('SIGTERM', () => {});
    process.stdout.write(String(process.pid));
    setInterval(() => {}, 1000);
  `,
  ]);

  const reader = child.stdout.getReader();
  const first = await reader.read();
  const pid = Number(new TextDecoder().decode(first.value));
  expect(pid).toBeGreaterThan(0);
  child.kill("SIGTERM");
  expect(await child.exited).toBe(143);
  expect(alive(pid)).toBe(false);
  reader.releaseLock();
});

test.each(["SIGTERM", "SIGINT"] as const)("preserves direct child termination by %s", async (signal) => {
  const child = run(["--timeout", "5 seconds", "--", "node", "-e", `process.kill(process.pid, ${JSON.stringify(signal)})`]);

  expect(await child.exited).toBe(signal === "SIGTERM" ? 143 : 130);
  expect(await new Response(child.stderr).text()).toBe("");
});
