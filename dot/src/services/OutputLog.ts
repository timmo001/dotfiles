import { Context, Effect, Layer, PubSub, Stream } from "effect";
import { appendFileSync, mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { Config } from "./Config.js";
import { mirrorConfiguredLog } from "../lib/logMirror.js";
import { expandHomePath } from "../lib/paths.js";

/** Severity levels for log entries */
export type LogLevel = "info" | "warn" | "error" | "section";

/** A single log entry emitted by the OutputLog service */
export interface LogEntry {
  readonly level: LogLevel;
  readonly message: string;
  readonly timestamp: number;
}

/** Service interface for structured output logging */
export interface OutputLogService {
  /** Log an informational message */
  readonly info: (msg: string) => Effect.Effect<void>;
  /** Log a warning */
  readonly warn: (msg: string) => Effect.Effect<void>;
  /** Log an error */
  readonly error: (msg: string) => Effect.Effect<void>;
  /** Log a section heading */
  readonly section: (title: string) => Effect.Effect<void>;
  /** Stream of log entries (for TUI subscription) */
  readonly stream: Stream.Stream<LogEntry>;
  /** Flush all buffered entries as a single formatted string */
  readonly flush: Effect.Effect<string>;
}

/** ANSI colour helpers for CLI output */
const ansi = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
} as const;

/** Format a log entry as a plain text line (for log file) */
function formatPlain(entry: LogEntry): string {
  const ts = new Date(entry.timestamp).toISOString();
  const label = entry.level.toUpperCase().padEnd(7);
  return `${ts} [${label}] ${entry.message}`;
}

/** Format a log entry with ANSI colours (for CLI stdout) */
function formatAnsi(entry: LogEntry): string {
  switch (entry.level) {
    case "section":
      return `\n${ansi.bold}${ansi.cyan}${entry.message}${ansi.reset}`;
    case "info":
      return `  ${entry.message}`;
    case "warn":
      return `  ${ansi.yellow}[WARN]${ansi.reset} ${entry.message}`;
    case "error":
      return `  ${ansi.red}[ERROR]${ansi.reset} ${entry.message}`;
  }
}

function logFiles(defaultLogFile: string): readonly string[] {
  const configuredLogFile = process.env.DOT_LOG_FILE
    ? expandHomePath(process.env.DOT_LOG_FILE)
    : undefined;
  const paths = configuredLogFile
    ? [defaultLogFile, configuredLogFile]
    : [defaultLogFile];
  return [...new Set(paths)];
}

function initialiseLogFiles(paths: readonly string[]): void {
  const configuredLogFile = process.env.DOT_LOG_FILE
    ? expandHomePath(process.env.DOT_LOG_FILE)
    : null;
  for (const path of paths) {
    mkdirSync(dirname(path), { recursive: true });
    if (configuredLogFile === path && process.env.DOT_TEE_INHERIT_LOG === "1") {
      continue;
    }
    writeFileSync(path, "");
  }
  mirrorConfiguredLog();
}

function appendLogFiles(paths: readonly string[], entry: LogEntry): void {
  const line = formatPlain(entry) + "\n";
  for (const path of paths) appendFileSync(path, line);
  mirrorConfiguredLog();
}

/** Effect service for {@link OutputLogService} */
export class OutputLog extends Context.Service<OutputLog, OutputLogService>()(
  "OutputLog",
) {
  /** TUI layer: PubSub-backed, entries flow to subscribers via stream */
  static readonly tuiLayer = Layer.effect(
    OutputLog,
    Effect.gen(function* () {
      const config = yield* Config;
      const pubsub = yield* PubSub.unbounded<LogEntry>();
      const entries: LogEntry[] = [];
      const defaultLogFile = join(
        config.logDir,
        `${new Date().toISOString().replace(/[:.]/g, "-")}.log`,
      );
      const paths = logFiles(defaultLogFile);

      initialiseLogFiles(paths);

      const emit = (level: LogLevel, message: string): Effect.Effect<void> =>
        Effect.gen(function* () {
          const entry: LogEntry = { level, message, timestamp: Date.now() };
          entries.push(entry);
          appendLogFiles(paths, entry);
          yield* PubSub.publish(pubsub, entry);
        });

      return {
        info: (msg) => emit("info", msg),
        warn: (msg) => emit("warn", msg),
        error: (msg) => emit("error", msg),
        section: (title) => emit("section", title),
        stream: Stream.fromPubSub(pubsub),
        flush: Effect.sync(() => entries.map(formatPlain).join("\n")),
      };
    }),
  );

  /** CLI layer: writes directly to stdout with ANSI colours */
  static readonly cliLayer = Layer.effect(
    OutputLog,
    Effect.gen(function* () {
      const config = yield* Config;
      const entries: LogEntry[] = [];
      const defaultLogFile = join(
        config.logDir,
        `${new Date().toISOString().replace(/[:.]/g, "-")}.log`,
      );
      const paths = logFiles(defaultLogFile);

      initialiseLogFiles(paths);

      const emit = (level: LogLevel, message: string): Effect.Effect<void> =>
        Effect.sync(() => {
          const entry: LogEntry = { level, message, timestamp: Date.now() };
          entries.push(entry);
          appendLogFiles(paths, entry);
          process.stdout.write(formatAnsi(entry) + "\n");
        });

      return {
        info: (msg) => emit("info", msg),
        warn: (msg) => emit("warn", msg),
        error: (msg) => emit("error", msg),
        section: (title) => emit("section", title),
        stream: Stream.empty,
        flush: Effect.sync(() => entries.map(formatPlain).join("\n")),
      };
    }),
  );
}
