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
import { CONFIG_DIR, expandHomePath } from "../../lib/paths.js";
import { ENV, envString } from "../../lib/env.js";
import type { CommandExecutorService } from "../../services/CommandExecutor.js";
import type {
  DashboardBarModuleId,
  DashboardBarValue,
  DashboardSourceState,
} from "../types.js";

const DASHBOARD_COMMAND_TIMEOUT_SECONDS = 8;
const DEBUG = !!envString(ENV.DOT_DEBUG);
const log = (msg: string) => {
  if (DEBUG) console.error(`[dot:Dashboard] ${msg}`);
};

const BAR_MODULES: readonly {
  readonly id: DashboardBarModuleId;
  readonly configKey: string;
}[] = [
  { id: "twitch", configKey: "custom/twitch-notifications-active" },
  { id: "temperature", configKey: "custom/temperature" },
  { id: "co2", configKey: "custom/co2-alert" },
  { id: "voc", configKey: "custom/voc-alert" },
  { id: "calendar", configKey: "custom/current-next-event" },
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

/** Effect service for dashboard live source snapshots. */
export class Dashboard extends Context.Service<Dashboard, DashboardService>()(
  "Dashboard",
) {
  static readonly layer = Layer.effect(
    Dashboard,
    Effect.gen(function* () {
      log("Initialising Dashboard...");
      const dotDiff = yield* DotDiff;
      const executor = yield* CommandExecutor;
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
            loadBarValues(config.omarchy.repoBase, executor),
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
    BAR_MODULES.map(({ id }) => [
      id,
      missingBarValue(id, updatedAt, "not loaded"),
    ]),
  ) as Readonly<Record<DashboardBarModuleId, DashboardBarValue>>;
}

function loadBarValues(repoBase: string, executor: CommandExecutorService) {
  return Effect.gen(function* () {
    const now = new Date(yield* Clock.currentTimeMillis);
    const commandMap = waybarModuleCommands(repoBase);
    const entries = yield* Effect.all(
      BAR_MODULES.map(({ id, configKey }) =>
        loadBarValue(id, commandMap[configKey], executor, now),
      ),
      { concurrency: 3 },
    );
    return Object.fromEntries(
      entries.map((entry) => [entry.id, entry]),
    ) as Readonly<Record<DashboardBarModuleId, DashboardBarValue>>;
  });
}

function loadBarValue(
  id: DashboardBarModuleId,
  command: string | undefined,
  executor: CommandExecutorService,
  updatedAt: Date,
) {
  return Effect.gen(function* () {
    if (!command)
      return missingBarValue(id, updatedAt, "module not configured");
    if (!safeDashboardCommand(command)) {
      return missingBarValue(id, updatedAt, "module is not a bounded source");
    }

    const output = yield* executor
      .run("timeout", [
        `${DASHBOARD_COMMAND_TIMEOUT_SECONDS}s`,
        "bash",
        "-lc",
        command,
      ])
      .pipe(
        Effect.catch((error) =>
          Effect.succeed(JSON.stringify({ error: formatError(error) })),
        ),
      );
    return parseBarValue(id, output, updatedAt);
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
  if (command.includes(" singleton-stream ")) return false;
  if (command.includes(" doorbell ")) return false;
  return (
    command.includes("twitch-notifications --status-bar-json") ||
    command.includes("ha-waybar-module.sh temperature") ||
    command.includes("ha-waybar-module.sh co2-alert") ||
    command.includes("ha-waybar-module.sh voc-alert") ||
    command.includes("ha-waybar-module.sh current-next-event") ||
    command.startsWith("printf ")
  );
}

function waybarModuleCommands(repoBase: string): Record<string, string> {
  const base = parseWaybarConfig(join(CONFIG_DIR, "waybar", "config.jsonc"));
  const host = waybarHostName();
  const hostFile = host
    ? join(repoBase, "waybar", `config.${host}.jsonc`)
    : null;
  const hostConfig =
    hostFile && existsSync(hostFile) ? parseWaybarConfig(hostFile) : {};
  return { ...base, ...hostConfig };
}

function waybarHostName(): string | null {
  const host = envString(ENV.OMARCHY_HOST)?.trim();
  return host && ["desktop", "laptop"].includes(host) ? host : null;
}

function parseWaybarConfig(path: string): Record<string, string> {
  try {
    const raw = readFileSync(expandHomePath(path), "utf-8");
    const commands: Record<string, string> = {};
    const modulePattern = /"(custom\/[^"]+)"\s*:\s*\{/g;
    let match: RegExpExecArray | null;
    while ((match = modulePattern.exec(raw)) !== null) {
      const key = match[1];
      const start = match.index + match[0].length;
      const body = readObjectBody(raw, start);
      const exec = body ? execValue(body) : null;
      if (exec) commands[key] = exec;
    }
    return commands;
  } catch {
    return {};
  }
}

function readObjectBody(raw: string, start: number): string | null {
  let depth = 1;
  let quote: string | null = null;
  let escaped = false;
  for (let index = start; index < raw.length; index++) {
    const char = raw[index];
    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }
    if (char === '"' || char === "'") {
      quote = char;
      continue;
    }
    if (char === "{") depth += 1;
    if (char === "}") {
      depth -= 1;
      if (depth === 0) return raw.slice(start, index);
    }
  }
  return null;
}

function execValue(body: string): string | null {
  const match = /"exec"\s*:\s*"((?:\\.|[^"])*)"/.exec(body);
  if (!match) return null;
  try {
    return JSON.parse(`"${match[1]}"`) as string;
  } catch {
    return null;
  }
}
