import {
  AgentName,
  HerdrSdk,
  herdrSdkLayerFromOptions,
  PaneId,
  type Agent,
  type TabId,
} from "@timmo001/effect-herdr";
import {
  Cause,
  Duration,
  Effect,
  FileSystem,
  Option,
  Schedule,
  Schema,
} from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { join, resolve } from "path";
import { ENV, envString } from "../lib/env.js";
import { localHerdrAttachment } from "../lib/herdrAttachment.js";
import { CACHE_DIR, CONFIG_DIR, HOME_DIR } from "../lib/paths.js";
import { formatCause } from "../lib/schema.js";
import { CommandError, CommandExecutor } from "../services/CommandExecutor.js";
import { installedHerdrAgents } from "./HerdrAgents.js";
import {
  createHerdrModelSession,
  HerdrModelError,
  switchHerdrModel,
} from "./HerdrModel.js";

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
  /** Placement override; auto reuses an idle shell pane before splitting right. */
  readonly layout?: "auto" | "vertical" | "horizontal" | "tab";
  /** Qt keyboard modifiers, resolved with Ctrl, Alt, then Shift precedence. */
  readonly modifiers?: number;
  /** Requested Herdr workspace label. */
  readonly label: string;
  /** Repository working directory. */
  readonly directory: string;
  /** Label for the selected command tab or new pane. */
  readonly tabLabel?: string;
  /** Optional command to run in the selected repository. */
  readonly command?: string;
  /** Initial prompt delivered through Herdr after the selected agent is ready. */
  readonly prompt?: string;
  /** File whose contents are sent as the initial prompt; excludes prompt. */
  readonly promptFile?: string;
  /** Expected Herdr agent kind for an explicit command. */
  readonly agentKind?: string;
  /** Installed launcher identity from dot herdr agents. */
  readonly agent?: string;
  /** OpenCode 2 model name or unique match, selected before launch. */
  readonly model?: string;
  /** Explicit model variant, mutually exclusive with a #variant suffix. */
  readonly variant?: string;
  /** Unique name assigned to the verified agent before prompting. */
  readonly agentName?: string;
  /** Leave the current view focused and do not open a terminal client. */
  readonly noFocus?: boolean;
  /** Print the selected resources and launch outcome as JSON. */
  readonly json?: boolean;
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

const readPromptFile = Effect.fn("herdrRepoOpen.readPromptFile")(function* (
  path: string,
) {
  const fs = yield* FileSystem.FileSystem;

  const text = yield* fs.readFileString(path).pipe(
    Effect.catch((error) =>
      fs.exists(path).pipe(
        Effect.orElseSucceed(() => false),
        Effect.map((present) =>
          fail(
            present
              ? `Could not read prompt file ${path}: ${formatCause(error)}`
              : `Prompt file ${path} does not exist`,
            2,
          ),
        ),
      ),
    ),
  );

  if (!text.trim()) return fail(`Prompt file ${path} is empty`, 2);

  return text.trimEnd();
});

const canonicalLabel = Effect.fn("herdrRepoOpen.canonicalLabel")(function* (
  options: HerdrRepoOpenOptions,
) {
  const fs = yield* FileSystem.FileSystem;

  const path =
    options.pickerCache ?? join(CACHE_DIR, "dot", "repo-picker.json");

  if (!(yield* fs.exists(path).pipe(Effect.orElseSucceed(() => false))))
    return options.label;

  return yield* fs.readFileString(path).pipe(
    Effect.map((text) => {
      const entries = Schema.decodeUnknownSync(PickerCacheSchema)(
        JSON.parse(text),
      );

      return (
        entries.find((entry) => entry.path === options.directory)?.name ??
        options.label
      );
    }),
    Effect.catchCause(() => Effect.succeed(options.label)),
  );
});

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
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
  const label = yield* canonicalLabel(options);
  const directory = resolve(options.directory);

  if (options.layout !== undefined && options.modifiers !== undefined)
    return fail("Use only one of --layout or --modifiers", 2);

  if (options.prompt !== undefined && options.promptFile !== undefined)
    return fail("Use only one of --prompt or --prompt-file", 2);

  const prompt =
    options.promptFile === undefined
      ? options.prompt
      : yield* readPromptFile(options.promptFile);

  const modifiers = options.modifiers ?? 0;

  const layout =
    options.layout ??
    (modifiers & CONTROL_MODIFIER
      ? "tab"
      : modifiers & ALT_MODIFIER
        ? "horizontal"
        : modifiers & SHIFT_MODIFIER
          ? "vertical"
          : "auto");

  if (
    options.agent !== undefined &&
    (options.command !== undefined || options.agentKind !== undefined)
  )
    return fail("Use --agent or a command with --agent-kind, not both", 2);

  const launcher =
    options.agent === undefined
      ? undefined
      : (yield* installedHerdrAgents).find(
          (target) => target.command === options.agent,
        );

  if (options.agent !== undefined && !launcher)
    return fail(
      `Agent ${options.agent} is not available in dot herdr agents`,
      2,
    );

  if (options.model !== undefined && options.agent !== "opencode2")
    return fail("--model requires --agent opencode2", 2);

  if (options.variant !== undefined && options.model === undefined)
    return fail("--variant requires --model", 2);

  let command = launcher?.executable ?? options.command;
  const agentKind = launcher?.kind ?? options.agentKind;
  const tabLabel = options.tabLabel ?? launcher?.label ?? "Shell";

  if (
    (prompt !== undefined || options.agentName !== undefined) &&
    (!command || !agentKind)
  )
    return fail(
      "A prompt or agent name requires --agent or a command with --agent-kind",
      2,
    );

  if (agentKind && !command) return fail("--agent-kind requires a command", 2);

  const agentName =
    options.agentName === undefined
      ? undefined
      : yield* Schema.decodeUnknownEffect(
          AgentName.check(Schema.isPattern(/^[a-z][a-z0-9_-]{0,31}$/)),
        )(options.agentName).pipe(
          Effect.mapError(
            () =>
              new HerdrRepoOpenError({
                message:
                  "Agent names must start with a lowercase letter and contain only lowercase letters, digits, '-' or '_' (1-32 characters)",
                exitCode: 2,
              }),
          ),
        );

  if (
    agentName !== undefined &&
    (yield* herdr.agents.list()).some(
      (agent) => Option.getOrUndefined(agent.name) === agentName,
    )
  )
    return fail(`Agent name ${agentName} is already in use`, 2);

  let expectedExecutable: string | undefined;

  if (agentKind && command === join(HOME_DIR, ".local", "bin", "opencode2")) {
    yield* executor.run("test", ["-x", command]);
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

  const selected =
    options.model === undefined
      ? undefined
      : yield* createHerdrModelSession(
          options.model,
          directory,
          options.variant,
        );

  if (selected && command) command += ` --session ${selected.sessionId}`;

  const socketPath = herdr.config.socketPath;

  const clientReady =
    runtime.foregroundClientReady ?? localHerdrAttachment(socketPath);

  const launchTerminal =
    runtime.launchTerminal ??
    spawner
      .spawn(
        ChildProcess.make(
          "uwsm",
          [
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
        ),
      )
      .pipe(
        Effect.flatMap((child) => child.unref),
        Effect.asVoid,
        Effect.scoped,
        Effect.mapError(
          (error) =>
            new HerdrRepoOpenError({
              message: `Could not launch the Herdr terminal: ${formatCause(error)}`,
              exitCode: 1,
            }),
        ),
      );

  const initiallyReady = options.noFocus || (yield* clientReady);

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
  let renameTab = false;
  const created = { workspace: false, tab: false, pane: false };

  if (!workspaceId) {
    const opened = yield* herdr.workspaces.createInDirectory(
      directory,
      label ? { label, focus: false } : { focus: false },
    );

    workspaceId = opened.workspace.id;
    tabId = opened.tab.id;
    paneId = opened.rootPane.id;
    renameTab = true;
    created.workspace = true;
    created.tab = true;
    created.pane = true;
  } else if (command !== undefined && layout === "tab") {
    const opened = yield* herdr.tabs.create({
      workspaceId,
      cwd: directory,
      label: tabLabel,
      focus: false,
    });

    tabId = opened.tab.id;
    paneId = opened.rootPane.id;
    renameTab = true;
    created.tab = true;
    created.pane = true;
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

        tabId = tab.id;
        renameTab = tab.paneCount === 1;
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

      const opened = yield* herdr.panes.split(target.id, {
        direction: layout === "horizontal" ? "down" : "right",
        cwd: directory,
        focus: false,
      });

      paneId = opened.id;
      tabId = opened.tabId;
      created.pane = true;
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

    if (renameTab && tabId) {
      yield* herdr.tabs.rename(tabId, tabLabel);
    } else {
      yield* herdr.panes.rename(paneId, tabLabel);
    }

    if (command) {
      yield* herdr.panes.sendInput(paneId, {
        text: command,
        keys: ["enter"],
      });
    }
  }

  if (!options.noFocus) {
    yield* herdr.workspaces.focus(workspaceId);

    if (tabId) yield* herdr.tabs.focus(tabId);

    if (paneId) yield* herdr.panes.focus(paneId);
  }

  let agent: Agent | undefined;

  if (agentKind && paneId) {
    const targetPane = paneId;
    yield* herdr.agents.get({ paneId: targetPane }).pipe(
      Effect.retry({
        times: 60,
        schedule: Schedule.spaced(500),
      }),
      Effect.timeout("30 seconds"),
    );

    agent = yield* herdr.agents.wait(
      { paneId: targetPane },
      { until: ["idle", "done"], timeoutMs: 30_000 },
      { requestTimeout: Duration.seconds(35) },
    );

    if (Option.getOrUndefined(agent.agent) !== agentKind)
      return fail(`The selected ${agentKind} agent did not start`);

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

    if (agentName !== undefined)
      agent = yield* herdr.agents.rename({ paneId: targetPane }, agentName);

    if (prompt !== undefined)
      agent = yield* herdr.agents.prompt(
        { paneId: targetPane },
        { text: prompt },
      );
  }

  return {
    workspaceId,
    tabId: tabId ?? workspace?.activeTabId ?? null,
    paneId: paneId ?? null,
    directory,
    created,
    agent: agent
      ? {
          kind: Option.getOrNull(agent.agent),
          name: Option.getOrNull(agent.name),
          status: agent.status,
          session: Option.getOrNull(agent.agentSession),
        }
      : null,
    promptSent: prompt !== undefined && agent !== undefined,
    model: selected?.model ?? null,
    sessionId: selected?.sessionId ?? null,
  };
});

/** Open or focus a repository workspace in the visible Herdr terminal. */
export const herdrRepoOpen = (options: HerdrRepoOpenOptions) =>
  openHerdrRepo(options).pipe(
    Effect.tap((result) =>
      Effect.sync(() => {
        if (options.json) process.stdout.write(`${JSON.stringify(result)}\n`);
      }),
    ),
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
                  : error instanceof HerdrModelError
                    ? error.message
                    : formatCause(error),
              exitCode: error instanceof HerdrModelError ? 2 : 1,
            });

      return Effect.sync(() => {
        process.stderr.write(`${failure.message}\n`);
        process.exitCode = failure.exitCode;
      });
    }),
    Effect.asVoid,
  );

/** Switch the model of a named or pane-targeted Herdr OpenCode 2 agent. */
export const herdrModel = (options: {
  readonly target: string;
  readonly model: string;
  readonly variant?: string;
  readonly json: boolean;
}) =>
  Effect.gen(function* () {
    const herdr = yield* HerdrSdk;

    const target = options.target.includes(":")
      ? {
          paneId: yield* Schema.decodeEffect(PaneId)(options.target),
        }
      : {
          name: yield* Schema.decodeEffect(AgentName)(options.target),
        };

    const agent = yield* herdr.agents.get(target);

    const directory =
      Option.getOrUndefined(agent.foregroundCwd) ??
      Option.getOrUndefined(agent.cwd);

    if (!directory)
      return fail("Herdr has not reported a working directory for this agent");

    const result = yield* switchHerdrModel(
      agent,
      agent.paneId,
      directory,
      options.model,
      options.variant,
    );

    process.stdout.write(
      options.json
        ? `${JSON.stringify(result)}\n`
        : `Switched ${options.target} to ${result.model}\n`,
    );
  }).pipe(
    Effect.provide(
      herdrSdkLayerFromOptions({
        socketPath: envString(ENV.HERDR_SOCKET_PATH) ?? DEFAULT_SOCKET_PATH,
        requestTimeout: Duration.seconds(5),
      }),
    ),
    Effect.catchCause((cause) => {
      const error = Cause.squash(cause);

      return Effect.sync(() => {
        process.stderr.write(
          `${error instanceof Error ? error.message : formatCause(error)}\n`,
        );
        process.exitCode = error instanceof HerdrModelError ? 2 : 1;
      });
    }),
    Effect.asVoid,
  );
