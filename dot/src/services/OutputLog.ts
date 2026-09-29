import { Clock, Context, Effect, FileSystem, Layer, Schedule } from "effect";
import { dirname, join } from "path";
import { stripVTControlCharacters } from "util";
import { Config } from "./Config.js";
import { cliStyler } from "../lib/ansi.js";
import { mirrorConfiguredLog } from "../lib/logMirror.js";
import { expandHomePath } from "../lib/paths.js";
import { ENV, envString } from "../lib/env.js";

/** Severity levels for log entries */
export type LogLevel = "info" | "success" | "warn" | "error" | "section";

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
  /** Log a completed step with a success marker */
  readonly success: (msg: string) => Effect.Effect<void>;
  /** Log a warning */
  readonly warn: (msg: string) => Effect.Effect<void>;
  /** Log an error */
  readonly error: (msg: string) => Effect.Effect<void>;
  /** Log a section heading */
  readonly section: (title: string) => Effect.Effect<void>;
  /**
   * Run `effect` while showing an animated single-line spinner labelled
   * `label`.
   *
   * Animates only on an interactive stdout TTY (CLI mode); on a non-TTY the
   * effect runs without animation. The spinner line is always cleared when
   * `effect` completes, fails, or is interrupted. On successful completion a
   * `<label> (<duration>)` line is logged (file + stdout, all environments).
   */
  readonly withSpinner: <A, E, R>(
    label: string,
    effect: Effect.Effect<A, E, R>,
  ) => Effect.Effect<A, E, R>;
  /**
   * Update the label of the currently active spinner, if one is running.
   *
   * Lets a long-running {@link withSpinner} effect reflect live progress (for
   * example which checks are still in flight). No-op when no spinner is active
   * or on a non-TTY where the spinner does not animate.
   */
  readonly updateSpinner: (label: string) => Effect.Effect<void>;
}

/** Braille spinner frames, matching opencode's standard Spinner (cli-spinners "dots"). */
const SPINNER_FRAMES = [
  "⠋",
  "⠙",
  "⠹",
  "⠸",
  "⠼",
  "⠴",
  "⠦",
  "⠧",
  "⠇",
  "⠏",
] as const;

/** Spinner animation interval, matching opencode's 80ms cadence. */
const SPINNER_INTERVAL = "80 millis";

/** ANSI escape: return the cursor to column 0 and clear to end of line. */
const CLEAR_LINE = "\r\x1b[K";

/** ANSI escape: hide the terminal cursor. */
const HIDE_CURSOR = "\x1b[?25l";

/** ANSI escape: show the terminal cursor. */
const SHOW_CURSOR = "\x1b[?25h";

/** Format an elapsed duration with adaptive precision (ms under 1s, else one-decimal seconds). */
function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

/** Format a log entry as a plain text line (for log file) */
function formatPlain(entry: LogEntry): string {
  const ts = new Date(entry.timestamp).toISOString();
  const label = entry.level.toUpperCase().padEnd(7);

  return `${ts} [${label}] ${stripVTControlCharacters(entry.message)}`;
}

/** Format a log entry for CLI stdout, coloured only when colour is enabled */
function formatAnsi(entry: LogEntry): string {
  const style = cliStyler();

  switch (entry.level) {
    case "section":
      return `\n${style.heading(entry.message)}`;
    case "info":
      return `  ${entry.message}`;
    case "success":
      return `  ${style.success("✓")} ${entry.message}`;
    case "warn":
      return `  ${style.warn("[WARN]")} ${entry.message}`;
    case "error":
      return `  ${style.error("[ERROR]")} ${entry.message}`;
  }
}

function configuredLogFile(): string | undefined {
  const configured = envString(ENV.DOT_LOG_FILE);

  return configured ? expandHomePath(configured) : undefined;
}

function logFiles(defaultLogFile: string): readonly string[] {
  const configured = configuredLogFile();
  const paths = configured ? [defaultLogFile, configured] : [defaultLogFile];

  return [...new Set(paths)];
}

const initialiseLogFiles = (
  fs: FileSystem.FileSystem,
  paths: readonly string[],
) =>
  Effect.gen(function* () {
    const configured = configuredLogFile();

    for (const path of paths) {
      yield* fs.makeDirectory(dirname(path), { recursive: true });

      if (configured === path && envString(ENV.DOT_TEE_INHERIT_LOG) === "1")
        continue;

      yield* fs.writeFileString(path, "");
    }

    mirrorConfiguredLog();
  }).pipe(Effect.orDie);

const appendLogFiles = (
  fs: FileSystem.FileSystem,
  paths: readonly string[],
  entry: LogEntry,
) =>
  Effect.gen(function* () {
    const line = formatPlain(entry) + "\n";

    for (const path of paths)
      yield* fs.writeFileString(path, line, { flag: "a" });
    mirrorConfiguredLog();
  }).pipe(Effect.orDie);

/** Number of recent auto-generated per-run log files to retain in the log dir. */
const LOG_RETENTION_COUNT = 100;

/** Matches the auto-generated per-run log file name (ISO timestamp + `.log`). */
const RUN_LOG_RE = /^\d{4}-\d{2}-\d{2}T[\d-]+Z\.log$/;

/**
 * Delete old auto-generated per-run log files, keeping the most recent
 * {@link LOG_RETENTION_COUNT}.
 *
 * Only targets files named like the per-run default log (ISO timestamp), so
 * `doctor-*.log` reports and any other files are left untouched. ISO names
 * sort chronologically, so a lexicographic sort orders them oldest-first.
 * Best-effort: a missing directory or a file removed by a concurrent run is
 * ignored.
 */
const pruneRunLogs = (
  fs: FileSystem.FileSystem,
  logDir: string,
  keep: number,
) =>
  Effect.gen(function* () {
    const names = (yield* fs.readDirectory(logDir)).filter((name) =>
      RUN_LOG_RE.test(name),
    );

    if (names.length <= keep) return;

    for (const name of names.toSorted().slice(0, names.length - keep))
      yield* fs.remove(join(logDir, name)).pipe(Effect.ignore);
  }).pipe(Effect.ignore);

/** Effect service for {@link OutputLogService} */
export class OutputLog extends Context.Service<OutputLog, OutputLogService>()(
  "OutputLog",
) {
  /** Writes directly to stdout, coloured when colour is enabled. */
  static readonly layer = Layer.effect(
    OutputLog,
    Effect.gen(function* () {
      const config = yield* Config;
      const fs = yield* FileSystem.FileSystem;

      const defaultLogFile = join(
        config.logDir,
        `${new Date(yield* Clock.currentTimeMillis).toISOString().replace(/[:.]/g, "-")}.log`,
      );

      const paths = logFiles(defaultLogFile);

      // Create/prune log files lazily on first emit so query/machine commands
      // that never log (e.g. status-bar JSON polls) leave no files behind.
      let initialised = false;

      const ensureInitialised = Effect.gen(function* () {
        if (initialised) return;
        initialised = true;
        yield* pruneRunLogs(fs, config.logDir, LOG_RETENTION_COUNT);
        yield* initialiseLogFiles(fs, paths);
      });

      // Animate the spinner only on an interactive TTY so frames and cursor
      // escapes never leak into piped output, redirects, or the init log tee.
      const spinnerEnabled = process.stdout.isTTY === true;

      let spinner: {
        label: string;
        frame: number;
        startedAt: number;
      } | null = null;

      const renderSpinner = (now: number): void => {
        if (!spinner) return;

        const frame =
          SPINNER_FRAMES[spinner.frame % SPINNER_FRAMES.length] ??
          SPINNER_FRAMES[0];

        const seconds = Math.floor((now - spinner.startedAt) / 1000);
        const elapsedText = seconds >= 1 ? ` (${seconds}s)` : "";
        // Keep the whole spinner on one physical row. A wrapped line breaks the
        // in-place CLEAR_LINE redraw (it only clears the last row) and leaves a
        // trail of stale spinner lines, so truncate the label to fit the width.
        // `|| 80` (not `??`) so a pty reporting 0 columns falls back sensibly.
        const columns = process.stdout.columns || 80;
        const maxLabel = Math.max(0, columns - 2 - elapsedText.length - 1);

        const label =
          spinner.label.length > maxLabel
            ? spinner.label.slice(0, Math.max(0, maxLabel - 1)) + "\u2026"
            : spinner.label;

        const elapsed = elapsedText ? cliStyler().dim(elapsedText) : "";

        process.stdout.write(
          `${CLEAR_LINE}${cliStyler().accent(frame)} ${label}${elapsed}`,
        );
      };

      const emit = (level: LogLevel, message: string): Effect.Effect<void> =>
        Effect.gen(function* () {
          const now = yield* Clock.currentTimeMillis;
          yield* ensureInitialised;
          const entry: LogEntry = { level, message, timestamp: now };
          yield* appendLogFiles(fs, paths, entry);

          // Clear the spinner line before a real log line, then redraw it
          // beneath so the spinner stays pinned to the bottom.
          if (spinner) process.stdout.write(CLEAR_LINE);
          process.stdout.write(formatAnsi(entry) + "\n");

          if (spinner) renderSpinner(now);
        });

      const tick = Effect.gen(function* () {
        if (!spinner) return;
        const now = yield* Clock.currentTimeMillis;
        spinner.frame += 1;
        renderSpinner(now);
      });

      const runSpinner = <A, E, R>(
        label: string,
        startedAt: number,
        effect: Effect.Effect<A, E, R>,
      ): Effect.Effect<A, E, R> =>
        Effect.scoped(
          Effect.gen(function* () {
            yield* Effect.acquireRelease(
              Effect.gen(function* () {
                const now = yield* Clock.currentTimeMillis;
                spinner = { label, frame: 0, startedAt };
                process.stdout.write(HIDE_CURSOR);
                renderSpinner(now);
              }),
              () =>
                Effect.sync(() => {
                  spinner = null;
                  process.stdout.write(CLEAR_LINE + SHOW_CURSOR);
                }),
            );
            yield* tick.pipe(
              Effect.repeat(Schedule.spaced(SPINNER_INTERVAL)),
              Effect.forkScoped,
            );

            return yield* effect;
          }),
        );

      const withSpinner = <A, E, R>(
        label: string,
        effect: Effect.Effect<A, E, R>,
      ): Effect.Effect<A, E, R> =>
        Effect.gen(function* () {
          const startedAt = yield* Clock.currentTimeMillis;

          // Animate only on a TTY; the duration line is logged either way.
          const result = yield* spinnerEnabled
            ? runSpinner(label, startedAt, effect)
            : effect;

          const finishedAt = yield* Clock.currentTimeMillis;
          yield* emit(
            "info",
            `${label} ${cliStyler().dim(`(${formatDuration(finishedAt - startedAt)})`)}`,
          );

          return result;
        });

      return {
        info: (msg) => emit("info", msg),
        success: (msg) => emit("success", msg),
        warn: (msg) => emit("warn", msg),
        error: (msg) => emit("error", msg),
        section: (title) => emit("section", title),
        withSpinner,
        updateSpinner: (label) =>
          Effect.gen(function* () {
            if (!spinner) return;
            const now = yield* Clock.currentTimeMillis;
            spinner.label = label;
            renderSpinner(now);
          }),
      };
    }),
  );
}
