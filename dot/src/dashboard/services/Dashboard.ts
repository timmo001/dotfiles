import {
  Clock,
  Context,
  Effect,
  Layer,
  PubSub,
  Schedule,
  Stream,
} from "effect";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DiffRepo } from "../../types.js";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { Config } from "../../services/Config.js";
import { DotDiff } from "../../git/services/DotDiff.js";
import { ENV, envString } from "../../lib/env.js";
import type {
  DashboardBarModuleId,
  DashboardBarValue,
  DashboardSourceState,
} from "../types.js";

const DASHBOARD_COMMAND_TIMEOUT_MS = 8_000;
const DEBUG = !!envString(ENV.DOT_DEBUG);
const log = (msg: string) => {
  if (DEBUG) console.error(`[dot:Dashboard] ${msg}`);
};

const DASHBOARD_CONFIG_FILE = "dot-dashboard.yml";
const BAR_MODULES: readonly DashboardBarModuleId[] = [
  "twitch",
  "temperature",
  "co2",
  "voc",
  "calendar",
  "todo_my_tasks",
  "todo_work",
];

/** Service interface for dashboard live source snapshots. */
interface DashboardService {
  /** Subscribe to dashboard source snapshots. */
  readonly subscribe: () => Stream.Stream<DashboardSourceState>;
  /** Refresh dashboard live sources. */
  readonly refresh: () => Effect.Effect<void>;
  /** Return the most recent dashboard source snapshot. */
  readonly getState: () => Effect.Effect<DashboardSourceState>;
}

interface DashboardSourceCommand {
  readonly command: string;
  readonly unit?: string;
}

/** Effect service for dashboard live source snapshots. */
export class Dashboard extends Context.Service<Dashboard, DashboardService>()(
  "Dashboard",
) {
  static readonly layer = Layer.effect(
    Dashboard,
    Effect.gen(function* () {
      log("Initialising Dashboard...");
      const dotDiff = yield* DotDiff;
      const config = yield* Config;
      const pubsub = yield* PubSub.unbounded<DashboardSourceState>();

      let currentState = buildState(
        [],
        emptyBarState(new Date(yield* Clock.currentTimeMillis)),
        new Date(yield* Clock.currentTimeMillis),
        false,
        false,
      );

      const refresh = Effect.gen(function* () {
        const loadingAt = new Date(yield* Clock.currentTimeMillis);
        currentState = buildState(
          currentState.diffRepos,
          currentState.bar,
          loadingAt,
          true,
          currentState.loaded,
        );
        yield* PubSub.publish(pubsub, currentState);

        const [diffRepos, barValues] = yield* Effect.all(
          [
            dotDiff
              .getAll()
              .pipe(
                Effect.catch(() => Effect.succeed([] as readonly DiffRepo[])),
              ),
            loadBarValues(config.privateDotfiles),
          ],
          { concurrency: 2 },
        );

        currentState = buildState(
          diffRepos,
          barValues,
          new Date(yield* Clock.currentTimeMillis),
          false,
          true,
        );
        yield* PubSub.publish(pubsub, currentState);
        log("Dashboard refresh complete");
      }).pipe(
        Effect.withSpan("Dashboard.refresh"),
        Effect.catch((error) =>
          Effect.gen(function* () {
            currentState = buildState(
              currentState.diffRepos,
              currentState.bar,
              new Date(yield* Clock.currentTimeMillis),
              false,
              currentState.loaded,
              String(error),
            );
            yield* PubSub.publish(pubsub, currentState);
          }),
        ),
      );

      yield* refresh;
      yield* refresh.pipe(
        Effect.repeat(Schedule.spaced("60 seconds")),
        Effect.forkScoped,
      );

      return {
        subscribe: () => Stream.fromPubSub(pubsub),
        refresh: () => refresh,
        getState: () => Effect.succeed(currentState),
      };
    }),
  );
}

function buildState(
  diffRepos: readonly DiffRepo[],
  bar: Readonly<Record<DashboardBarModuleId, DashboardBarValue>>,
  lastChecked: Date,
  loading: boolean,
  loaded: boolean,
  message?: string,
): DashboardSourceState {
  return {
    diffRepos,
    bar,
    lastChecked,
    loading,
    loaded,
    ...(message && { message }),
  };
}

function emptyBarState(
  updatedAt: Date,
): Readonly<Record<DashboardBarModuleId, DashboardBarValue>> {
  return Object.fromEntries(
    BAR_MODULES.map((id) => [id, missingBarValue(id, updatedAt, "not loaded")]),
  ) as Readonly<Record<DashboardBarModuleId, DashboardBarValue>>;
}

function loadBarValues(privateDotfiles: string | null) {
  return Effect.gen(function* () {
    const now = new Date(yield* Clock.currentTimeMillis);
    const commandMap = dashboardCommands(privateDotfiles);
    const entries = yield* Effect.all(
      BAR_MODULES.map((id) => loadBarValue(id, commandMap[id], now)),
      { concurrency: 3 },
    );
    return Object.fromEntries(
      entries.map((entry) => [entry.id, entry]),
    ) as Readonly<Record<DashboardBarModuleId, DashboardBarValue>>;
  });
}

function loadBarValue(
  id: DashboardBarModuleId,
  source: DashboardSourceCommand | undefined,
  updatedAt: Date,
) {
  return Effect.gen(function* () {
    if (!source) return missingBarValue(id, updatedAt, "source not configured");
    if (!safeDashboardCommand(source.command)) {
      return missingBarValue(id, updatedAt, "source is not bounded");
    }

    const output = yield* runDashboardCommand(source.command).pipe(
      Effect.catch((error) =>
        Effect.succeed(JSON.stringify({ error: formatError(error) })),
      ),
    );
    return parseBarValue(id, output, updatedAt, source.unit);
  });
}

function runDashboardCommand(command: string): Effect.Effect<string, Error> {
  return Effect.tryPromise({
    try: async () => {
      const proc = Bun.spawn(["bash", "-lc", command], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const stdout = new Response(proc.stdout).text();
      const stderr = new Response(proc.stderr).text();
      const timer = setTimeout(() => {
        proc.kill("SIGTERM");
      }, DASHBOARD_COMMAND_TIMEOUT_MS);
      const exitCode = await proc.exited;
      clearTimeout(timer);
      const output = await stdout;
      const errorOutput = await stderr;
      if (!output.trim() && exitCode !== 0) {
        throw new Error(errorOutput.trim() || `exit ${exitCode}`);
      }
      return output;
    },
    catch: (error) =>
      error instanceof Error ? error : new Error(String(error)),
  });
}

function missingBarValue(
  id: DashboardBarModuleId,
  updatedAt: Date,
  message: string,
): DashboardBarValue {
  return {
    id,
    status: "missing",
    text: "",
    tooltip: "",
    className: "",
    updatedAt,
    message,
  };
}

function parseBarValue(
  id: DashboardBarModuleId,
  output: string,
  updatedAt: Date,
  unit?: string,
): DashboardBarValue {
  const trimmed = output.trim().split("\n")[0]?.trim() ?? "";
  if (!trimmed) {
    return {
      id,
      status: "hidden",
      text: "",
      tooltip: "",
      className: "",
      updatedAt,
    };
  }

  try {
    const parsed = JSON.parse(trimmed) as Record<string, unknown>;
    if (typeof parsed.error === "string") {
      return {
        id,
        status: "error",
        text: "",
        tooltip: "",
        className: "",
        updatedAt,
        message: parsed.error,
      };
    }
    const text = stringField(parsed, "text");
    const tooltip = stringField(parsed, "tooltip");
    const className = stringField(parsed, "class");
    return {
      id,
      status:
        text || tooltip || className ? barStatus(className, text) : "hidden",
      text,
      tooltip,
      className,
      ...(unit && { unit }),
      updatedAt,
    };
  } catch {
    return {
      id,
      status: "error",
      text: "",
      tooltip: "",
      className: "",
      updatedAt,
      message: trimmed,
    };
  }
}

function barStatus(
  className: string,
  text: string,
): DashboardBarValue["status"] {
  if (className === "hidden" && text.length === 0) return "hidden";
  return "ok";
}

function stringField(record: Record<string, unknown>, key: string): string {
  const value = record[key];
  return typeof value === "string" ? value : "";
}

function formatError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function safeDashboardCommand(command: string): boolean {
  if (command.includes("ha-watch-singleton")) return false;
  if (command.includes("singleton-stream")) return false;
  if (command.includes("doorbell")) return false;
  return command.trim().length > 0;
}

function dashboardCommands(
  privateDotfiles: string | null,
): Partial<Record<DashboardBarModuleId, DashboardSourceCommand>> {
  if (!privateDotfiles) return {};
  const path = join(privateDotfiles, DASHBOARD_CONFIG_FILE);
  if (!existsSync(path)) return {};
  try {
    const parsed = Bun.YAML.parse(readFileSync(path, "utf-8")) as unknown;
    return parseDashboardCommands(parsed);
  } catch {
    return {};
  }
}

function parseDashboardCommands(
  value: unknown,
): Partial<Record<DashboardBarModuleId, DashboardSourceCommand>> {
  if (!value || typeof value !== "object") return {};
  const sources = (value as Record<string, unknown>).sources;
  if (!sources || typeof sources !== "object") return {};
  const commands: Partial<
    Record<DashboardBarModuleId, DashboardSourceCommand>
  > = {};
  for (const [key, source] of Object.entries(
    sources as Record<string, unknown>,
  )) {
    if (!isDashboardBarModuleId(key)) continue;
    if (!source || typeof source !== "object") continue;
    const command = (source as Record<string, unknown>).command;
    if (typeof command === "string" && command.trim()) {
      const rawUnit = (source as Record<string, unknown>).unit;
      const unit =
        typeof rawUnit === "string" && rawUnit.trim() ? rawUnit : undefined;
      commands[key] = { command, ...(unit && { unit }) };
    }
  }
  return commands;
}

function isDashboardBarModuleId(value: string): value is DashboardBarModuleId {
  return BAR_MODULES.includes(value as DashboardBarModuleId);
}
