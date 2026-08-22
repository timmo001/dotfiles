import {
  Clock,
  Context,
  Effect,
  Layer,
  PubSub,
  Schedule,
  Schema,
  Stream,
} from "effect";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { DiffRepo } from "../../types.js";
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
const isDashboardBarModuleId = Schema.is(
  Schema.Union(BAR_MODULES.map((id) => Schema.Literal(id))),
);
const BarOutput = Schema.Struct({
  error: Schema.optional(Schema.String),
  text: Schema.optional(Schema.String),
  tooltip: Schema.optional(Schema.String),
  class: Schema.optional(Schema.String),
  name: Schema.optional(Schema.String),
});
const DashboardConfig = Schema.Struct({
  sources: Schema.Record(
    Schema.String,
    Schema.Struct({
      command: Schema.String,
      unit: Schema.optional(Schema.String),
      open_command: Schema.optional(Schema.String),
    }),
  ),
});

/** Domain error for dashboard source command failures. */
class DashboardError extends Schema.TaggedErrorClass<DashboardError>()(
  "DashboardError",
  {
    message: Schema.String,
  },
) {}

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
  readonly openCommand?: string;
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
                Effect.catch(() => Effect.succeed<readonly DiffRepo[]>([])),
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
      }).pipe(Effect.withSpan("Dashboard.refresh"));

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
  // SAFETY: BAR_MODULES supplies every DashboardBarModuleId exactly once.
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
    // SAFETY: loadBarValue returns exactly one entry for every BAR_MODULES id.
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
    return parseBarValue(id, output, updatedAt, {
      unit: source.unit,
      openCommand: source.openCommand,
    });
  });
}

function runDashboardCommand(
  command: string,
): Effect.Effect<string, DashboardError> {
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
        throw new DashboardError({
          message: errorOutput.trim() || `exit ${exitCode}`,
        });
      }
      return output;
    },
    catch: (error) =>
      error instanceof DashboardError
        ? error
        : new DashboardError({ message: String(error) }),
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
  config: { readonly unit?: string; readonly openCommand?: string } = {},
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
    const parsed = Schema.decodeUnknownSync(BarOutput)(JSON.parse(trimmed));
    if (parsed.error !== undefined) {
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
    const text = parsed.text ?? "";
    const tooltip = parsed.tooltip ?? "";
    const className = parsed.class ?? "";
    const name = parsed.name ?? "";
    return {
      id,
      status:
        text || tooltip || className ? barStatus(className, text) : "hidden",
      text,
      tooltip,
      className,
      ...(config.unit && { unit: config.unit }),
      ...(name && { name }),
      ...(config.openCommand && { openCommand: config.openCommand }),
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

function formatError(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
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
    const parsed = Schema.decodeUnknownSync(DashboardConfig)(
      Bun.YAML.parse(readFileSync(path, "utf-8")),
    );
    return parseDashboardCommands(parsed);
  } catch {
    return {};
  }
}

interface DashboardCommands {
  [key: string]: DashboardSourceCommand;
}

function parseDashboardCommands(
  value: Schema.Schema.Type<typeof DashboardConfig>,
): DashboardCommands {
  const commands: DashboardCommands = {};
  for (const [key, source] of Object.entries(value.sources)) {
    if (!isDashboardBarModuleId(key)) continue;
    const command = source.command;
    if (command.trim()) {
      const unit = source.unit?.trim() ? source.unit : undefined;
      const openCommand = source.open_command?.trim()
        ? source.open_command
        : undefined;
      commands[key] = {
        command,
        ...(unit && { unit }),
        ...(openCommand && { openCommand }),
      };
    }
  }
  return commands;
}
