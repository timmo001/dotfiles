import {
  HerdrSdk,
  herdrSdkLayerFromOptions,
  type PaneId,
  type TabId,
} from "@herdr/sdk";
import { Cause, Duration, Effect, Schedule, Schema } from "effect";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { ENV, envString } from "../lib/env.js";
import { CACHE_DIR, CONFIG_DIR } from "../lib/paths.js";
import { formatCause } from "../lib/schema.js";
import { CommandError, CommandExecutor } from "../services/CommandExecutor.js";
import { herdrServerPid } from "./HerdrServer.js";

const READINESS_SCHEDULE = Schedule.recurs(49).pipe(
  Schedule.addDelay(() => Effect.succeed("100 millis")),
);
const DEFAULT_SOCKET_PATH = join(CONFIG_DIR, "herdr", "herdr.sock");

const PickerCacheSchema = Schema.Array(
  Schema.Struct({ name: Schema.String, path: Schema.String }),
);

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

/** Open or focus a repository workspace with a configurable readiness schedule. */
export const openHerdrRepo = Effect.fn("herdrRepoOpen")(function* (
  options: HerdrRepoOpenOptions,
  runtime: HerdrRepoOpenRuntime = {},
) {
  const executor = yield* CommandExecutor;
  const herdr = yield* HerdrSdk;
  const label = canonicalLabel(options);
  if ((yield* executor.exitCode("herdr", ["status", "server"])) !== 0) {
    return fail("Shared Herdr server is not running");
  }
  const socketPath = envString(ENV.HERDR_SOCKET_PATH) ?? DEFAULT_SOCKET_PATH;
  const binary = `/proc/${yield* herdrServerPid(socketPath)}/exe`;
  const clientReady =
    runtime.foregroundClientReady ??
    herdr.client.windowTitle
      .clear({ requestTimeout: Duration.millis(500) })
      .pipe(
        Effect.map((response) => response.reason !== "no_foreground_client"),
        Effect.orElseSucceed(() => false),
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
            binary,
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

  const workspaces = yield* herdr.workspaces.list();
  let workspaceId = workspaces.find(
    (workspace) => workspace.label === label,
  )?.id;
  let tabId: TabId | undefined;
  let paneId: PaneId | undefined;

  if (!workspaceId) {
    const created = yield* herdr.workspaces.createInDirectory(
      options.directory,
      label ? { label, focus: false } : { focus: false },
    );
    workspaceId = created.workspace.id;
    tabId = created.tab.id;
    paneId = created.rootPane.id;
  } else if (options.command && options.pane) {
    const activeTabId = workspaces.find(
      (workspace) => workspace.id === workspaceId,
    )?.activeTabId;
    const panes = yield* herdr.panes.list({ workspaceId });
    const target =
      panes.find((pane) => pane.tabId === activeTabId && pane.focused) ??
      panes.find((pane) => pane.tabId === activeTabId) ??
      panes[0];
    if (!target) return fail(`Herdr did not return a pane ID for ${label}`);
    const created = yield* herdr.panes.split(target.id, {
      direction: "right",
      cwd: options.directory,
      focus: true,
    });
    paneId = created.id;
  } else if (options.command) {
    const created = yield* herdr.tabs.create({
      workspaceId,
      cwd: options.directory,
      label: options.tabLabel,
      focus: false,
    });
    tabId = created.tab.id;
    paneId = created.rootPane.id;
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
      yield* herdr.tabs.rename(tabId, options.tabLabel);
    }
    yield* herdr.panes.sendInput(paneId, {
      text: options.command,
      keys: ["enter"],
    });
  }

  yield* herdr.workspaces.focus(workspaceId);
  if (tabId) yield* herdr.tabs.focus(tabId);
});

/** Open or focus a repository workspace in the visible Herdr terminal. */
export const herdrRepoOpen = (options: HerdrRepoOpenOptions) =>
  openHerdrRepo(options).pipe(
    Effect.provide(
      herdrSdkLayerFromOptions({
        socketPath: envString(ENV.HERDR_SOCKET_PATH) ?? DEFAULT_SOCKET_PATH,
        requestTimeout: Duration.seconds(5),
      }),
    ),
    Effect.catchCause((cause) => {
      const error = Cause.squash(cause);
      const failure =
        error instanceof HerdrRepoOpenError
          ? error
          : new HerdrRepoOpenError({
              message:
                error instanceof CommandError
                  ? error.stderr || `Herdr command failed: ${error.command}`
                  : formatCause(error),
              exitCode: 1,
            });
      return Effect.sync(() => {
        process.stderr.write(`${failure.message}\n`);
        process.exitCode = failure.exitCode;
      });
    }),
    Effect.asVoid,
  );
