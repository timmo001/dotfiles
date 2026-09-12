import {
  HerdrSdk,
  herdrSdkLayerFromOptions,
  type PaneId,
  type TabId,
} from "@herdr/sdk";
import { Cause, Duration, Effect, Option, Schedule, Schema } from "effect";
import { existsSync, readFileSync } from "fs";
import { join, resolve } from "path";
import { ENV, envString } from "../lib/env.js";
import { localHerdrAttachment } from "../lib/herdrAttachment.js";
import { CACHE_DIR, CONFIG_DIR, HOME_DIR } from "../lib/paths.js";
import { formatCause } from "../lib/schema.js";
import { CommandError, CommandExecutor } from "../services/CommandExecutor.js";

const READINESS_SCHEDULE = Schedule.recurs(49).pipe(
  Schedule.addDelay(() => Effect.succeed("100 millis")),
);

const DEFAULT_SOCKET_PATH = join(CONFIG_DIR, "herdr", "herdr.sock");

// Qt::KeyboardModifier values passed unchanged by desktop click/key events.
const SHIFT_MODIFIER = 0x02000000;

const CONTROL_MODIFIER = 0x04000000;

const ALT_MODIFIER = 0x08000000;

const PickerCacheSchema = Schema.Array(
  Schema.Struct({ name: Schema.String, path: Schema.String }),
);

/** Parsed repository-opening options. */
export interface HerdrRepoOpenOptions {
  /** Shorthand for an explicit vertical split. */
  readonly pane?: boolean;
  /** Placement override; auto reuses an idle shell pane before splitting right. */
  readonly layout?: "auto" | "vertical" | "horizontal" | "tab";
  /** Qt keyboard modifiers, resolved with Ctrl, Alt, then Shift precedence. */
  readonly modifiers?: number;
  /** Requested Herdr workspace label. */
  readonly label: string;
  /** Repository working directory. */
  readonly directory: string;
  /** Label for the selected command tab or new pane. */
  readonly tabLabel: string;
  /** Optional command to run in the selected repository. */
  readonly command?: string;
  /** Initial prompt delivered through Herdr after the selected agent is ready. */
  readonly prompt?: string;
  /** Expected Herdr agent kind when delivering an initial prompt. */
  readonly agentKind?: string;
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

const readIdleShell = Effect.fn("herdrRepoOpen.readIdleShell")(function* (
  paneId: PaneId,
) {
  const herdr = yield* HerdrSdk;

  if (Option.isSome((yield* herdr.panes.get(paneId)).agent)) return;

  const info = yield* herdr.panes.processInfo(paneId);
  const shellPid = Option.getOrUndefined(info.shellPid);
  const shell = info.foregroundProcesses?.[0];

  if (
    !shellPid ||
    info.foregroundProcesses?.length !== 1 ||
    shell?.pid !== shellPid ||
    Option.getOrUndefined(info.foregroundProcessGroupId) !== shellPid ||
    !["sh", "bash", "zsh", "fish", "dash", "ksh"].includes(shell.name) ||
    !Option.exists(
      shell.argv,
      (argv) =>
        argv.length > 0 &&
        argv
          .slice(1)
          .every((arg) =>
            ["-l", "-i", "-il", "-li", "--login", "--interactive"].includes(
              arg,
            ),
          ),
    )
  )
    return;

  return shell;
});

/** Open or focus a repository workspace with a configurable readiness schedule. */
export const openHerdrRepo = Effect.fn("herdrRepoOpen")(function* (
  options: HerdrRepoOpenOptions,
  runtime: HerdrRepoOpenRuntime = {},
) {
  const executor = yield* CommandExecutor;
  const herdr = yield* HerdrSdk;
  const label = canonicalLabel(options);
  const directory = resolve(options.directory);
  let command = options.command;

  if (
    [
      options.pane === true,
      options.layout !== undefined,
      options.modifiers !== undefined,
    ].filter(Boolean).length > 1
  )
    return fail("Use only one of --pane, --layout or --modifiers", 2);

  const modifiers = options.modifiers ?? 0;

  const layout =
    options.layout ??
    (options.pane
      ? "vertical"
      : modifiers & CONTROL_MODIFIER
        ? "tab"
        : modifiers & ALT_MODIFIER
          ? "horizontal"
          : modifiers & SHIFT_MODIFIER
            ? "vertical"
            : "auto");

  if (options.prompt !== undefined && (!options.command || !options.agentKind))
    return fail("An initial prompt requires a command and --agent-kind", 2);
  let expectedExecutable: string | undefined;

  if (
    options.prompt !== undefined &&
    options.command === join(HOME_DIR, ".local", "bin", "opencode2")
  ) {
    yield* executor.run("test", ["-x", options.command]);
    expectedExecutable = (yield* executor.run("mise", ["which", "opencode2"], {
      cwd: options.directory,
    })).trim();

    if (
      !expectedExecutable.startsWith("/") ||
      expectedExecutable.includes("\n")
    )
      return fail("OpenCode 2 verification did not return an executable path");
    yield* executor.run("test", ["-x", expectedExecutable]);
  }

  const socketPath = herdr.config.socketPath;

  const clientReady =
    runtime.foregroundClientReady ?? localHerdrAttachment(socketPath);

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

  const workspace = workspaces.find((workspace) => workspace.label === label);
  let workspaceId = workspace?.id;

  let tabId: TabId | undefined;
  let paneId: PaneId | undefined;

  if (!workspaceId) {
    const created = yield* herdr.workspaces.createInDirectory(
      directory,
      label ? { label, focus: false } : { focus: false },
    );

    workspaceId = created.workspace.id;
    tabId = created.tab.id;
    paneId = created.rootPane.id;
  } else if (command !== undefined && layout === "tab") {
    const created = yield* herdr.tabs.create({
      workspaceId,
      cwd: directory,
      label: options.tabLabel,
      focus: false,
    });

    tabId = created.tab.id;
    paneId = created.rootPane.id;
  } else if (command !== undefined) {
    const panes = yield* herdr.panes.list({ workspaceId });
    const focusedPane = panes.find((pane) => pane.focused);
    const activeTabId = focusedPane?.tabId ?? workspace?.activeTabId;

    if (layout === "auto") {
      const tabs = (yield* herdr.tabs.list({ workspaceId })).toSorted(
        (left, right) =>
          Number(right.id === activeTabId) - Number(left.id === activeTabId),
      );

      const candidates = tabs.flatMap((tab) =>
        panes
          .filter((pane) => pane.tabId === tab.id)
          .toSorted(
            (left, right) => Number(right.focused) - Number(left.focused),
          )
          .map((pane) => ({ tab, pane })),
      );

      for (const { tab, pane } of candidates) {
        if (Option.isSome(pane.agent)) continue;
        const shell = yield* readIdleShell(pane.id);

        if (!shell) continue;

        const currentShell = yield* readIdleShell(pane.id);

        if (!currentShell || currentShell.pid !== shell.pid) break;

        tabId = tab.paneCount === 1 ? tab.id : undefined;
        paneId = pane.id;

        if (Option.getOrUndefined(currentShell.cwd) !== directory) {
          command =
            `cd -- '${directory.replaceAll("'", "'\\''")}'` +
            (command ? ` && eval '${command.replaceAll("'", "'\\''")}'` : "");
        }

        break;
      }
    }

    if (!paneId) {
      const target =
        focusedPane ??
        panes.find((pane) => pane.tabId === activeTabId) ??
        panes[0];

      if (!target) return fail(`Herdr did not return a pane ID for ${label}`);

      paneId = (yield* herdr.panes.split(target.id, {
        direction: layout === "horizontal" ? "down" : "right",
        cwd: directory,
        focus: false,
      })).id;
    }
  }

  if (!workspaceId)
    return fail(`Herdr did not return a workspace ID for ${label}`);

  if (command !== undefined) {
    if (!paneId) {
      return fail(
        `Herdr did not return the required pane or tab ID for ${label}`,
      );
    }

    if (tabId) {
      yield* herdr.tabs.rename(tabId, options.tabLabel);
    } else {
      yield* herdr.panes.rename(paneId, options.tabLabel);
    }

    if (command) {
      yield* herdr.panes.sendInput(paneId, {
        text: command,
        keys: ["enter"],
      });
    }
  }

  yield* herdr.workspaces.focus(workspaceId);

  if (tabId) yield* herdr.tabs.focus(tabId);

  if (paneId) yield* herdr.panes.focus(paneId);

  if (options.prompt !== undefined && paneId) {
    const targetPane = paneId;
    yield* herdr.agents.get({ paneId: targetPane }).pipe(
      Effect.retry({
        times: 60,
        schedule: Schedule.spaced(500),
      }),
      Effect.timeout("30 seconds"),
    );

    const agent = yield* herdr.agents.wait(
      { paneId: targetPane },
      { until: ["idle", "done"], timeoutMs: 30_000 },
      { requestTimeout: Duration.seconds(35) },
    );

    if (Option.getOrUndefined(agent.agent) !== options.agentKind)
      return fail(`The selected ${options.agentKind} agent did not start`);

    if (expectedExecutable) {
      const processes =
        (yield* herdr.panes.processInfo(targetPane)).foregroundProcesses ?? [];

      if (
        !processes.some((process) =>
          Option.exists(process.argv, (argv) =>
            argv.includes(expectedExecutable),
          ),
        )
      )
        return fail("OpenCode 2 did not start through the expected runtime");
    }

    yield* herdr.agents.prompt(
      { paneId: targetPane },
      { text: options.prompt },
    );
  }
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
