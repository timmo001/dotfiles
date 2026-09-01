import { Cause, Effect, Schedule, Schema } from "effect";
import { existsSync, readFileSync } from "fs";
import { createConnection } from "net";
import { join } from "path";
import { ENV, envString } from "../lib/env.js";
import { CACHE_DIR, CONFIG_DIR } from "../lib/paths.js";
import { formatCause } from "../lib/schema.js";
import { CommandExecutor } from "../services/CommandExecutor.js";

const READINESS_SCHEDULE = Schedule.recurs(49).pipe(
  Schedule.addDelay(() => Effect.succeed("100 millis")),
);
const DEFAULT_SOCKET_PATH = join(CONFIG_DIR, "herdr", "herdr.sock");

const WorkspaceSchema = Schema.Struct({
  workspace_id: Schema.String,
  active_tab_id: Schema.optional(Schema.String),
  label: Schema.optional(Schema.String),
});
const TabSchema = Schema.Struct({ tab_id: Schema.String });
const PaneSchema = Schema.Struct({
  pane_id: Schema.String,
  tab_id: Schema.optional(Schema.String),
  focused: Schema.optional(Schema.Boolean),
});
const ResponseFields = {
  workspaces: Schema.optional(Schema.Array(WorkspaceSchema)),
  workspace: Schema.optional(WorkspaceSchema),
  tab: Schema.optional(TabSchema),
  root_pane: Schema.optional(PaneSchema),
  panes: Schema.optional(Schema.Array(PaneSchema)),
  pane: Schema.optional(PaneSchema),
};
const ResponsePayloadSchema = Schema.Struct(ResponseFields);
const ResponseSchema = Schema.Struct({
  ...ResponseFields,
  result: Schema.optional(ResponsePayloadSchema),
});
const PickerCacheSchema = Schema.Array(
  Schema.Struct({ name: Schema.String, path: Schema.String }),
);
const ClientProbeResponseSchema = Schema.Struct({
  result: Schema.Struct({ reason: Schema.String }),
});

type ResponsePayload = Schema.Schema.Type<typeof ResponsePayloadSchema>;

/** Parsed repository-opening options. */
export interface HerdrRepoOpenOptions {
  /** Whether a command should split the active tab instead of opening a tab. */
  readonly pane: boolean;
  /** Requested Herdr workspace label. */
  readonly label: string;
  /** Repository working directory. */
  readonly directory: string;
  /** Label for a newly created command tab. */
  readonly tabLabel: string;
  /** Optional command to run in the selected repository. */
  readonly command?: string;
  /** Repository picker cache used to resolve the canonical label. */
  readonly pickerCache?: string;
}

/** Runtime controls used to test Herdr client readiness deterministically. */
export interface HerdrRepoOpenRuntime {
  /** Retry schedule for waiting on the foreground Herdr client. */
  readonly readinessSchedule?: Schedule.Schedule<number>;
  /** Probe that reports whether Herdr has a foreground terminal client. */
  readonly foregroundClientReady?: Effect.Effect<boolean>;
  /** Start the tiled Herdr terminal without waiting for it to exit. */
  readonly launchTerminal?: Effect.Effect<void, HerdrRepoOpenError>;
}

/** Domain error raised by the Herdr repository opener. */
export class HerdrRepoOpenError extends Schema.TaggedError<HerdrRepoOpenError>()(
  "HerdrRepoOpenError",
  {
    message: Schema.String,
    exitCode: Schema.Union([Schema.Literal(1), Schema.Literal(2)]),
  },
) {}

class TerminalNotReady extends Schema.TaggedError<TerminalNotReady>()(
  "TerminalNotReady",
  {},
) {}

function fail(message: string, exitCode: 1 | 2 = 1): never {
  throw new HerdrRepoOpenError({ message, exitCode });
}

function decodeResponse(source: string, label: string): ResponsePayload {
  try {
    const response = Schema.decodeUnknownSync(ResponseSchema)(
      JSON.parse(source),
    );
    return response.result ?? response;
  } catch (error) {
    return fail(`${label} returned invalid JSON: ${formatCause(error)}`);
  }
}

function canonicalLabel(options: HerdrRepoOpenOptions): string {
  const path =
    options.pickerCache ?? join(CACHE_DIR, "dot", "repo-picker.json");
  if (!existsSync(path)) return options.label;
  try {
    const entries = Schema.decodeUnknownSync(PickerCacheSchema)(
      JSON.parse(readFileSync(path, "utf8")),
    );
    return (
      entries.find((entry) => entry.path === options.directory)?.name ??
      options.label
    );
  } catch {
    return options.label;
  }
}

function probeForegroundClient(socketPath: string): Effect.Effect<boolean> {
  return Effect.callback<boolean>((resume) => {
    let buffer = "";
    let settled = false;
    const socket = createConnection(socketPath);
    const finish = (ready: boolean) => {
      if (settled) return;
      settled = true;
      socket.destroy();
      resume(Effect.succeed(ready));
    };
    socket.setTimeout(500, () => finish(false));
    socket.on("connect", () => {
      socket.write(
        `${JSON.stringify({
          id: "dot:herdr-repo-open:ready",
          method: "client.window_title.clear",
          params: {},
        })}\n`,
      );
    });
    socket.on("data", (chunk) => {
      buffer += chunk.toString();
      const newline = buffer.indexOf("\n");
      if (newline === -1) return;
      try {
        const response = Schema.decodeUnknownSync(ClientProbeResponseSchema)(
          JSON.parse(buffer.slice(0, newline)),
        );
        finish(response.result.reason !== "no_foreground_client");
      } catch {
        finish(false);
      }
    });
    socket.on("error", () => finish(false));
    socket.on("close", () => finish(false));
    return Effect.sync(() => {
      settled = true;
      socket.destroy();
    });
  });
}

/** Open or focus a repository workspace with a configurable readiness schedule. */
export const openHerdrRepo = Effect.fn("herdrRepoOpen")(function* (
  options: HerdrRepoOpenOptions,
  runtime: HerdrRepoOpenRuntime = {},
) {
  const executor = yield* CommandExecutor;
  const label = canonicalLabel(options);
  const clientReady =
    runtime.foregroundClientReady ??
    probeForegroundClient(
      envString(ENV.HERDR_SOCKET_PATH) ?? DEFAULT_SOCKET_PATH,
    );
  const launchTerminal =
    runtime.launchTerminal ??
    Effect.try({
      try: () => {
        const process = Bun.spawn(
          [
            "uwsm",
            "app",
            "--",
            "ghostty-host-config",
            "-e",
            "herdr",
            "session",
            "attach",
            "default",
          ],
          {
            stdin: "ignore",
            stdout: "ignore",
            stderr: "ignore",
            detached: true,
          },
        );
        process.unref();
      },
      catch: (error) =>
        new HerdrRepoOpenError({
          message: `Could not launch the Herdr terminal: ${formatCause(error)}`,
          exitCode: 1,
        }),
    });

  if ((yield* executor.exitCode("herdr", ["status", "server"])) !== 0) {
    return fail("Shared Herdr server is not running");
  }

  const initiallyReady = yield* clientReady;
  if (!initiallyReady) {
    yield* launchTerminal;

    const terminalReady = clientReady.pipe(
      Effect.filterOrFail(
        (ready) => ready,
        () => new TerminalNotReady(),
      ),
      Effect.retry(runtime.readinessSchedule ?? READINESS_SCHEDULE),
      Effect.mapError(
        () =>
          new HerdrRepoOpenError({
            message: "Herdr terminal client did not become ready",
            exitCode: 1,
          }),
      ),
    );
    yield* terminalReady;
  }

  const workspaceList = decodeResponse(
    yield* executor.run("herdr", ["workspace", "list"]),
    "herdr workspace list",
  );
  let workspaceId = workspaceList.workspaces?.find(
    (workspace) => workspace.label === label,
  )?.workspace_id;
  let tabId: string | undefined;
  let paneId: string | undefined;

  if (!workspaceId) {
    const created = decodeResponse(
      yield* executor.run("herdr", [
        "workspace",
        "create",
        "--cwd",
        options.directory,
        ...(label ? ["--label", label] : []),
        "--no-focus",
      ]),
      "herdr workspace create",
    );
    workspaceId = created.workspace?.workspace_id;
    tabId = created.tab?.tab_id;
    paneId = created.root_pane?.pane_id;
  } else if (options.command && options.pane) {
    const activeTabId = workspaceList.workspaces?.find(
      (workspace) => workspace.workspace_id === workspaceId,
    )?.active_tab_id;
    const panes = decodeResponse(
      yield* executor.run("herdr", [
        "pane",
        "list",
        "--workspace",
        workspaceId,
      ]),
      "herdr pane list",
    ).panes;
    const target =
      panes?.find((pane) => pane.tab_id === activeTabId && pane.focused) ??
      panes?.find((pane) => pane.tab_id === activeTabId) ??
      panes?.[0];
    if (!target) return fail(`Herdr did not return a pane ID for ${label}`);
    const created = decodeResponse(
      yield* executor.run("herdr", [
        "pane",
        "split",
        "--pane",
        target.pane_id,
        "--direction",
        "right",
        "--cwd",
        options.directory,
        "--focus",
      ]),
      "herdr pane split",
    );
    paneId = created.pane?.pane_id;
  } else if (options.command) {
    const created = decodeResponse(
      yield* executor.run("herdr", [
        "tab",
        "create",
        "--workspace",
        workspaceId,
        "--cwd",
        options.directory,
        "--label",
        options.tabLabel,
        "--no-focus",
      ]),
      "herdr tab create",
    );
    tabId = created.tab?.tab_id;
    paneId = created.root_pane?.pane_id;
  }

  if (!workspaceId)
    return fail(`Herdr did not return a workspace ID for ${label}`);
  if (options.command) {
    if (!paneId || (!options.pane && !tabId)) {
      return fail(
        `Herdr did not return the required pane or tab ID for ${label}`,
      );
    }
    if (tabId) {
      yield* executor.run("herdr", ["tab", "rename", tabId, options.tabLabel]);
    }
    yield* executor.run("herdr", ["pane", "run", paneId, options.command]);
  }

  yield* executor.run("herdr", ["workspace", "focus", workspaceId]);
  if (tabId) yield* executor.run("herdr", ["tab", "focus", tabId]);
  else if (paneId) yield* executor.run("herdr", ["pane", "focus", paneId]);
});

/** Open or focus a repository workspace in the visible Herdr terminal. */
export const herdrRepoOpen = (options: HerdrRepoOpenOptions) =>
  openHerdrRepo(options).pipe(
    Effect.catchCause((cause) => {
      const error = Cause.squash(cause);
      const failure =
        error instanceof HerdrRepoOpenError
          ? error
          : new HerdrRepoOpenError({
              message: formatCause(error),
              exitCode: 1,
            });
      return Effect.sync(() => {
        process.stderr.write(`${failure.message}\n`);
        process.exitCode = failure.exitCode;
      });
    }),
    Effect.asVoid,
  );
