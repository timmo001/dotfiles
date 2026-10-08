import { Clock, Duration, Effect, FileSystem, Schema } from "effect";
import { join } from "path";
import { plural } from "../lib/runSummary.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";
import {
  type AgentLintCommand,
  managedGitRepoForPath,
} from "../services/GitConfig.js";
import { OutputLog } from "../services/OutputLog.js";

const FILES_PLACEHOLDER = "{files}";

const DEFAULT_TIMEOUT = Duration.seconds(60);

const OUTPUT_TAIL_LINES = 200;

const TIMEOUT_EXIT = 124;

const EMPTY_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";

/** Options accepted by the agent lint command. */
export interface AgentLintOptions {
  /** Paths that narrow the changed files, relative to the current directory. */
  readonly paths: readonly string[];
  /** Print one JSON report instead of log lines. */
  readonly json: boolean;
  /** Lint every tracked and untracked file, not only changed ones. */
  readonly all: boolean;
  /** Names of the commands to run; empty runs them all. */
  readonly only: readonly string[];
}

/** Domain error raised before any lint command starts. */
export class AgentLintError extends Schema.TaggedError<AgentLintError>()(
  "AgentLintError",
  { message: Schema.String },
) {}

/** Outcome of one configured command. */
export interface AgentLintResult {
  /** Configured command name. */
  readonly name: string;
  /** `skipped` means no changed file matched the command. */
  readonly status: "passed" | "failed" | "timed-out" | "skipped";
  /** Exit code when the command ran. */
  readonly exitCode?: number;
  /** Wall time in milliseconds when the command ran. */
  readonly durationMs?: number;
  /** Last lines of combined stdout and stderr for failed or timed-out commands. */
  readonly output?: string;
  /** Expanded argv run from the repository root, or the configured argv when skipped. */
  readonly command: readonly string[];
}

/** Report printed by `dot agent-lint --json`. */
export interface AgentLintReport {
  /** Whether the repository sets `agent_lint` in private dot-git.yml. */
  readonly configured: boolean;
  /** Repository root the commands ran from. */
  readonly root: string;
  /** Repository-relative changed files in scope. */
  readonly files: readonly string[];
  /** One result per configured command, in order. */
  readonly results: readonly AgentLintResult[];
  /** Configured closing line for the lint message. */
  readonly message?: string;
}

const outputTail = (text: string) =>
  text.trim().split("\n").slice(-OUTPUT_TAIL_LINES).join("\n");

const changedFiles = Effect.fn("agentLint.changedFiles")(function* (
  root: string,
  paths: readonly string[],
  all: boolean,
) {
  const executor = yield* CommandExecutor;
  const fs = yield* FileSystem.FileSystem;

  const git = (args: readonly string[]) =>
    executor
      .run("git", ["-c", "core.quotePath=false", ...args], {
        cwd: process.cwd(),
      })
      .pipe(
        Effect.mapError(
          (error) =>
            new AgentLintError({
              message: `agent-lint: could not read changes: ${error.stderr || `exit ${error.exitCode}`}`,
            }),
        ),
      );

  const base = yield* git(["rev-parse", "--verify", "--quiet", "HEAD"]).pipe(
    Effect.map((output) => output.trim()),
    Effect.orElseSucceed(() => EMPTY_TREE),
  );

  const pathspec = paths.length ? ["--", ...paths] : [];

  const [tracked, untracked] = yield* Effect.all([
    all
      ? git(["ls-files", "--cached", "--full-name", "-z", ...pathspec])
      : git([
          "diff",
          "--name-only",
          "-z",
          "--diff-filter=d",
          base,
          ...pathspec,
        ]),
    git([
      "ls-files",
      "--others",
      "--exclude-standard",
      "--full-name",
      "-z",
      ...pathspec,
    ]),
  ]);

  const candidates = [
    ...new Set([...tracked.split("\0"), ...untracked.split("\0")]),
  ].filter(Boolean);

  // Submodule pointer changes appear as paths too; only lint regular files.
  const files = yield* Effect.filter(candidates, (file) =>
    fs.stat(join(root, file)).pipe(
      Effect.map((info) => info.type === "File"),
      Effect.orElseSucceed(() => false),
    ),
  );

  return files.toSorted();
});

const matchingFiles = (command: AgentLintCommand, files: readonly string[]) =>
  command.include
    ? files.filter((file) =>
        command.include?.some((pattern) => new Bun.Glob(pattern).match(file)),
      )
    : files;

const runLintCommand = Effect.fn("agentLint.runCommand")(function* (
  root: string,
  command: AgentLintCommand,
  files: readonly string[],
) {
  const executor = yield* CommandExecutor;
  const matched = matchingFiles(command, files);

  if (matched.length === 0)
    return {
      name: command.name,
      status: "skipped",
      command: command.run,
    } satisfies AgentLintResult;

  const argv = command.run.flatMap((arg) =>
    arg === FILES_PLACEHOLDER ? matched : [arg],
  );

  const timeout = Duration.toMillis(command.timeout ?? DEFAULT_TIMEOUT);
  const started = yield* Clock.currentTimeMillis;

  const outcome = yield* executor
    .run("dot", ["run", "--timeout", `${timeout} millis`, "--", ...argv], {
      cwd: root,
      // A caller that terminates agent-lint's process group also stops the
      // runner, which then stops the lint command's own group.
      sameProcessGroup: true,
      mergeStderr: true,
    })
    .pipe(
      Effect.as({ exitCode: 0, output: "" }),
      Effect.catchTag("CommandError", (error) =>
        Effect.succeed({
          exitCode: error.exitCode,
          output: [error.stdout ?? "", error.stderr].filter(Boolean).join("\n"),
        }),
      ),
    );

  const durationMs = (yield* Clock.currentTimeMillis) - started;

  if (outcome.exitCode === 0)
    return {
      name: command.name,
      status: "passed",
      exitCode: 0,
      durationMs,
      command: argv,
    } satisfies AgentLintResult;

  return {
    name: command.name,
    status: outcome.exitCode === TIMEOUT_EXIT ? "timed-out" : "failed",
    exitCode: outcome.exitCode,
    durationMs,
    output: outputTail(outcome.output),
    command: argv,
  } satisfies AgentLintResult;
});

const printReport = Effect.fn("agentLint.printReport")(function* (
  report: AgentLintReport,
) {
  const log = yield* OutputLog;

  if (!report.configured) {
    yield* log.info(
      "Repository has no agent_lint commands in private dot-git.yml",
    );

    return;
  }

  if (report.files.length === 0) {
    yield* log.info("No changed files to lint");

    return;
  }

  yield* log.section("Agent Lint");
  yield* log.info(`Linting ${plural(report.files.length, "changed file")}`);

  for (const result of report.results) {
    const seconds =
      result.durationMs === undefined
        ? ""
        : ` in ${(result.durationMs / 1000).toFixed(1)}s`;

    if (result.status === "skipped") {
      yield* log.info(`${result.name} skipped: no matching changed files`);
      continue;
    }

    if (result.status === "passed") {
      yield* log.success(`${result.name} passed${seconds}`);
      continue;
    }

    if (result.output)
      yield* Effect.sync(() => process.stdout.write(`${result.output}\n`));

    yield* log.warn(
      result.status === "timed-out"
        ? `${result.name} timed out${seconds}`
        : `${result.name} failed with exit ${result.exitCode}${seconds}`,
    );
  }
});

/** Run the repository's configured fallback lint commands on changed files. */
export const agentLint = Effect.fn("agentLint")(function* (
  options: AgentLintOptions,
) {
  const config = yield* Config;
  const executor = yield* CommandExecutor;

  const root = (yield* executor
    .run("git", ["rev-parse", "--show-toplevel"], { cwd: process.cwd() })
    .pipe(
      Effect.mapError(
        () =>
          new AgentLintError({
            message: "agent-lint: not inside a Git repository",
          }),
      ),
    )).trim();

  const settings = managedGitRepoForPath(config.gitConfig, root)?.agentLint;

  const report: AgentLintReport = settings
    ? yield* Effect.gen(function* () {
        const unknown = options.only.filter(
          (name) => !settings.commands.some((command) => command.name === name),
        );

        if (unknown.length)
          return yield* new AgentLintError({
            message: `agent-lint: no agent_lint command named ${unknown.join(", ")}`,
          });

        const files = yield* changedFiles(root, options.paths, options.all);

        // With no changed files every command is reported as skipped, so
        // callers still see each configured check.
        const results = yield* Effect.forEach(
          options.only.length
            ? settings.commands.filter((command) =>
                options.only.includes(command.name),
              )
            : settings.commands,
          (command) => runLintCommand(root, command, files),
          { concurrency: "unbounded" },
        );

        return {
          configured: true,
          root,
          files,
          results,
          ...(settings.message && { message: settings.message }),
        };
      })
    : { configured: false, root, files: [], results: [] };

  if (options.json) {
    yield* Effect.sync(() =>
      process.stdout.write(`${JSON.stringify(report)}\n`),
    );
  } else {
    yield* printReport(report);
  }

  if (
    report.results.some(
      (result) => result.status === "failed" || result.status === "timed-out",
    )
  )
    process.exitCode = 1;
});
