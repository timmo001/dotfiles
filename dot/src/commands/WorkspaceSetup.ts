import { Clock, Effect, Schema } from "effect";
import { appendFileSync, mkdirSync, rmSync } from "fs";
import { dirname, join } from "path";
import { HOME_DIR, STATE_DIR, expandHomePath } from "../lib/paths.js";
import { decodeJson, type JsonValue } from "../lib/schema.js";
import {
  acquireWorkspaceMutationLock,
  releaseWorkspaceMutationLock,
} from "../lib/workspaceMutationLock.js";
import { CommandExecutor } from "../services/CommandExecutor.js";

const DEFAULT_TEMP_WORKSPACE = 99;
const DEFAULT_SPEED_MULTIPLIER = 1.8;
const LAUNCH_POLLS = 80;
const LOG_DIRECTORY = join(STATE_DIR, "workspace-setup", "runs");
const TAG_PREFIX = "wssetup-";
const TAGS = {
  slack: `${TAG_PREFIX}ws1-slack`,
  discord: `${TAG_PREFIX}ws1-discord`,
  browser: `${TAG_PREFIX}ws1-browser-main`,
  terminalTop: `${TAG_PREFIX}ws1-term-top`,
  terminal: `${TAG_PREFIX}ws1-term`,
  workspace2Terminal: `${TAG_PREFIX}ws2-term`,
  workspace2Cursor: `${TAG_PREFIX}ws2-cursor`,
  workBrowser: `${TAG_PREFIX}ws3-browser`,
} as const;
const MANAGED_TAGS = Object.values(TAGS);

/** Move dispatcher supported by workspace setup. */
export type WorkspaceMoveDispatcher =
  "movetoworkspace" | "movetoworkspacesilent";

/** Explicit workspace setup layout, bypassing work-time detection. */
export type WorkspaceSetupMode = "work" | "normal";

/** Raw workspace setup options supplied by the CLI. */
export interface WorkspaceSetupOptions {
  /** Pause after each logged step. */
  readonly stepThrough: boolean;
  /** Multiply built-in sleeps by this value. */
  readonly speedMultiplier: number;
  /** Use the unscaled fast timing preset. */
  readonly fast: boolean;
  /** Delay startup by this many unscaled seconds. */
  readonly startupDelay: number;
  /** Explicit numeric temporary workspace. */
  readonly temporaryWorkspace?: number;
  /** Explicit dispatcher selection. */
  readonly moveDispatcher?: WorkspaceMoveDispatcher;
  /** Explicit run log path. */
  readonly logFile?: string;
  /** Explicit work or normal layout, skipping `is-work-time`. */
  readonly mode?: WorkspaceSetupMode;
}

/** Validated workspace setup configuration. */
export interface WorkspaceSetupConfig {
  /** Pause after each logged step. */
  readonly stepThrough: boolean;
  /** Multiplier applied to built-in sleeps. */
  readonly speedMultiplier: number;
  /** Unscaled startup delay in seconds. */
  readonly startupDelay: number;
  /** Numeric temporary workspace used to rebuild split trees. */
  readonly temporaryWorkspace: number;
  /** Dispatcher name retained for compatibility and logging. */
  readonly moveDispatcher: WorkspaceMoveDispatcher;
  /** Whether moves follow the target workspace. */
  readonly follow: boolean;
  /** Optional explicit run log path. */
  readonly logFile?: string;
  /** Explicit work or normal layout, skipping `is-work-time`. */
  readonly mode?: WorkspaceSetupMode;
}

interface HyprlandClient {
  readonly address: string;
  readonly class: string;
  readonly initialClass: string;
  readonly title: string;
  readonly initialTitle: string;
  readonly workspace: { readonly id: number };
  readonly tags: readonly string[];
  readonly focusHistoryID: number;
}

interface Slot {
  readonly tag: string;
  /** jq-compatible regex, matching class, initialClass, title, or initialTitle. */
  readonly pattern: string;
  readonly command: string;
  readonly workspace: number;
  readonly skipOpenCode: boolean;
  /** jq-compatible regex of windows this slot must not claim. */
  readonly excludePattern?: string;
}

const PATTERN_SLACK = "^chrome-app\\.slack\\.com__client";
const PATTERN_DISCORD = "^chrome-discord\\.com__app";
const PATTERN_CHROMIUM = "^chromium$";
const PATTERN_GHOSTTY = "^com\\.mitchellh\\.ghostty$";
const PATTERN_HERDR = "^herdr$";
const PATTERN_WORK_BROWSER = "^(work-browser|google-chrome)$";

const WorkspaceSchema = Schema.Struct({ id: Schema.Finite });
const ClientSchema = Schema.Struct({
  address: Schema.NonEmptyString,
  class: Schema.optional(Schema.String),
  initialClass: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  initialTitle: Schema.optional(Schema.String),
  workspace: WorkspaceSchema,
  tags: Schema.optional(Schema.Array(Schema.String)),
  focusHistoryID: Schema.optional(Schema.Finite),
});
const ClientsSchema = Schema.Array(ClientSchema);
const ActiveWindowSchema = Schema.Struct({
  address: Schema.optional(Schema.String),
});

/** Domain error raised by the workspace setup command. */
export class WorkspaceSetupError extends Schema.TaggedError<WorkspaceSetupError>()(
  "WorkspaceSetupError",
  { message: Schema.String },
) {}

function fail(message: string): never {
  throw new WorkspaceSetupError({ message });
}

/** Overlay copy for a logged step, or `undefined` when the step is too detailed. */
function overlayProgress(message: string): string | undefined {
  if (
    message.startsWith("Preparing ") ||
    message.startsWith("Rebuilding ") ||
    message.startsWith("Applying ") ||
    message.startsWith("Switching ") ||
    message.startsWith("Using ") ||
    message.startsWith("Detected ") ||
    message.startsWith("Skipping ") ||
    message === "Workspace setup complete"
  ) {
    return message;
  }
  return undefined;
}

function positiveWorkspace(value: string | undefined, label: string): number {
  if (value === undefined || !/^\d+$/.test(value) || Number(value) <= 0) {
    return fail(`${label} must be a positive integer workspace id`);
  }
  return Number(value);
}

/** Resolve explicit options over legacy environment variables and defaults. */
export function resolveWorkspaceSetupConfig(
  options: WorkspaceSetupOptions,
  environment: Readonly<Record<string, string | undefined>> = process.env,
): WorkspaceSetupConfig {
  const speedMultiplier = options.fast ? 1 : options.speedMultiplier;
  if (!Number.isFinite(speedMultiplier) || speedMultiplier <= 0) {
    return fail("--speed-multiplier must be a positive number");
  }
  if (!Number.isFinite(options.startupDelay) || options.startupDelay < 0) {
    return fail("--sleep must be a non-negative number");
  }

  const temporaryWorkspace =
    options.temporaryWorkspace ??
    (environment.WORKSPACE_SETUP_TEMP_WS === undefined
      ? DEFAULT_TEMP_WORKSPACE
      : positiveWorkspace(
          environment.WORKSPACE_SETUP_TEMP_WS,
          "WORKSPACE_SETUP_TEMP_WS",
        ));
  if (!Number.isInteger(temporaryWorkspace) || temporaryWorkspace <= 0) {
    return fail("--temp-workspace must be a positive integer workspace id");
  }
  if ([1, 2, 3].includes(temporaryWorkspace)) {
    return fail("Temporary workspace must not be workspace 1, 2, or 3");
  }

  const moveDispatcher =
    options.moveDispatcher ??
    environment.WORKSPACE_SETUP_MOVE_DISPATCHER ??
    "movetoworkspace";
  if (
    moveDispatcher !== "movetoworkspace" &&
    moveDispatcher !== "movetoworkspacesilent"
  ) {
    return fail(
      "Move dispatcher must be movetoworkspace or movetoworkspacesilent",
    );
  }

  const configuredLog =
    options.logFile ?? environment.WORKSPACE_SETUP_LOG_FILE ?? undefined;
  return {
    stepThrough: options.stepThrough,
    speedMultiplier,
    startupDelay: options.startupDelay,
    temporaryWorkspace,
    moveDispatcher,
    follow: moveDispatcher === "movetoworkspace",
    logFile: configuredLog ? expandHomePath(configuredLog) : undefined,
    mode: options.mode,
  };
}

function parseJson(source: string, label: string): JsonValue {
  try {
    return decodeJson(JSON.parse(source));
  } catch (error) {
    return fail(
      `${label} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function decodeClients(value: JsonValue): readonly HyprlandClient[] {
  try {
    return Schema.decodeUnknownSync(ClientsSchema)(value).map((client) => ({
      ...client,
      class: client.class ?? "",
      initialClass: client.initialClass ?? "",
      title: client.title ?? "",
      initialTitle: client.initialTitle ?? "",
      tags: client.tags ?? [],
      focusHistoryID: client.focusHistoryID ?? 999_999,
    }));
  } catch (error) {
    return fail(`Invalid Hyprland clients response: ${String(error)}`);
  }
}

function decodeActiveAddress(value: JsonValue): string {
  try {
    return Schema.decodeUnknownSync(ActiveWindowSchema)(value).address ?? "";
  } catch (error) {
    return fail(`Invalid Hyprland active window response: ${String(error)}`);
  }
}

/** Validate Hyprland preflight responses before the first workspace mutation. */
export function validateWorkspaceSetupPreflight(
  clientsJson: string,
  activeWindowJson: string,
  temporaryWorkspace: number,
): {
  readonly clients: readonly HyprlandClient[];
  readonly activeAddress: string;
} {
  const clients = decodeClients(parseJson(clientsJson, "hyprctl clients"));
  const activeAddress = decodeActiveAddress(
    parseJson(activeWindowJson, "hyprctl activewindow"),
  );
  if (clients.some((client) => client.workspace.id === temporaryWorkspace)) {
    return fail(
      `Temporary workspace ${temporaryWorkspace} is already occupied`,
    );
  }
  return { clients, activeAddress };
}

function timestampedLogPath(now: number): string {
  const timestamp = new Date(now)
    .toISOString()
    .replace(/[-:]/g, "")
    .replace("T", "-")
    .slice(0, 15);
  return join(LOG_DIRECTORY, `workspace-setup-${timestamp}.log`);
}

function fieldsMatch(client: HyprlandClient, pattern: string): boolean {
  return [
    client.class,
    client.initialClass,
    client.title,
    client.initialTitle,
  ].some((value) => new RegExp(pattern).test(value));
}

function clientMatches(client: HyprlandClient, slot: Slot): boolean {
  return (
    fieldsMatch(client, slot.pattern) &&
    (!slot.skipOpenCode || !client.title.startsWith("OC |")) &&
    (slot.excludePattern === undefined ||
      !fieldsMatch(client, slot.excludePattern))
  );
}

/** Run the native workspace setup workflow. */
export const workspaceSetup = Effect.fn("workspaceSetup")(function* (
  options: WorkspaceSetupOptions,
) {
  const executor = yield* CommandExecutor;
  const config = resolveWorkspaceSetupConfig(options);
  const startedAt = yield* Clock.currentTimeMillis;
  const logFile = config.logFile ?? timestampedLogPath(startedAt);
  mkdirSync(LOG_DIRECTORY, { recursive: true });
  mkdirSync(dirname(logFile), { recursive: true });
  appendFileSync(logFile, "");

  const showOverlay = (message: string) =>
    executor.run("popup-loading", ["show", message]).pipe(Effect.ignore);
  const hideOverlay = () =>
    executor.run("popup-loading", ["hide"]).pipe(Effect.ignore);
  const logStep = (message: string) =>
    Effect.gen(function* () {
      const now = yield* Clock.currentTimeMillis;
      const timestamp = new Date(now).toLocaleString("sv-SE");
      const line = `[workspace-setup ${timestamp}] ${message}`;
      console.log(line);
      appendFileSync(logFile, `${line}\n`);
      const overlay = overlayProgress(message);
      if (overlay !== undefined) yield* showOverlay(overlay);
      if (config.stepThrough) {
        yield* Effect.sync(() => {
          prompt("[workspace-setup] Press Enter to continue... ");
        });
      }
    });
  const sleep = (seconds: number) =>
    Effect.sleep(`${seconds * config.speedMultiplier} seconds`);
  const dispatch = (command: string) =>
    executor.run("hyprctl", ["dispatch", command]).pipe(Effect.ignore);
  let startFocusAddress = "";
  const readClients = Effect.fn("workspaceSetup.readClients")(function* () {
    return decodeClients(
      parseJson(
        yield* executor.run("hyprctl", ["-j", "clients"]),
        "hyprctl clients",
      ),
    );
  });
  const quote = (value: string) => JSON.stringify(value);
  const move = Effect.fn("workspaceSetup.move")(function* (
    workspace: number,
    address: string,
  ) {
    yield* logStep(
      `Moving window ${address} to workspace ${workspace} via ${config.moveDispatcher}`,
    );
    yield* dispatch(
      `hl.dsp.window.move({ workspace = ${quote(String(workspace))}, window = ${quote(`address:${address}`)}, follow = ${config.follow} })`,
    );
  });
  const focus = Effect.fn("workspaceSetup.focus")(function* (address: string) {
    if (!address) return false;
    yield* logStep(`Focusing window ${address}`);
    yield* dispatch(
      `hl.dsp.focus({ window = ${quote(`address:${address}`)} })`,
    );
    return true;
  });
  const addressByTag = Effect.fn("workspaceSetup.addressByTag")(function* (
    tag: string,
  ) {
    return (yield* readClients()).find((client) => client.tags.includes(tag))
      ?.address;
  });
  const clearTag = Effect.fn("workspaceSetup.clearTag")(function* (
    tag: string,
  ) {
    yield* logStep(`Clearing tag '${tag}' from all windows`);
    for (const client of yield* readClients()) {
      if (client.tags.includes(tag)) {
        yield* dispatch(
          `hl.dsp.window.tag({ tag = ${quote(`-${tag}`)}, window = ${quote(`address:${client.address}`)} })`,
        );
      }
    }
  });
  const tagAddress = Effect.fn("workspaceSetup.tagAddress")(function* (
    address: string,
    tag: string,
  ) {
    yield* logStep(`Tagging window ${address} as '${tag}'`);
    for (const managed of MANAGED_TAGS) {
      yield* dispatch(
        `hl.dsp.window.tag({ tag = ${quote(`-${managed}`)}, window = ${quote(`address:${address}`)} })`,
      );
    }
    yield* clearTag(tag);
    yield* dispatch(
      `hl.dsp.window.tag({ tag = ${quote(`+${tag}`)}, window = ${quote(`address:${address}`)} })`,
    );
  });
  const used = new Set<string>();
  const ensureSlot = Effect.fn("workspaceSetup.ensureSlot")(function* (
    slot: Slot,
    preferredAddress = "",
  ) {
    yield* logStep(
      `Ensuring slot '${slot.tag}' on workspace ${slot.workspace}`,
    );
    let clients = yield* readClients();
    let address = clients.find(
      (client) =>
        client.tags.includes(slot.tag) &&
        !used.has(client.address) &&
        clientMatches(client, slot),
    )?.address;

    if (
      !address &&
      preferredAddress &&
      !used.has(preferredAddress) &&
      (yield* readClients()).some(
        (client) =>
          client.address === preferredAddress && clientMatches(client, slot),
      )
    ) {
      yield* logStep(
        `Using preferred window ${preferredAddress} for slot '${slot.tag}'`,
      );
      address = preferredAddress;
    }

    const candidates = (current: readonly HyprlandClient[]) =>
      current
        .filter(
          (client) =>
            client.address !== startFocusAddress &&
            !used.has(client.address) &&
            clientMatches(client, slot),
        )
        .sort(
          (left, right) =>
            Number(left.workspace.id !== slot.workspace) -
              Number(right.workspace.id !== slot.workspace) ||
            Number(left.tags.some((tag) => tag.startsWith(TAG_PREFIX))) -
              Number(right.tags.some((tag) => tag.startsWith(TAG_PREFIX))) ||
            left.focusHistoryID - right.focusHistoryID,
        );

    if (!address) {
      yield* logStep(
        `No existing slot for '${slot.tag}', looking for candidate windows`,
      );
      clients = yield* readClients();
      address = candidates(clients)[0]?.address;
    }
    if (!address) {
      yield* logStep(
        `No reusable candidate for '${slot.tag}', launching command`,
      );
      const before = new Set(
        (yield* readClients())
          .filter((client) => clientMatches(client, slot))
          .map((c) => c.address),
      );
      yield* dispatch(`hl.dsp.exec_cmd(${quote(slot.command)})`);
      for (let attempt = 0; attempt < LAUNCH_POLLS; attempt += 1) {
        clients = yield* readClients();
        address = clients.find(
          (client) =>
            client.address !== startFocusAddress &&
            clientMatches(client, slot) &&
            !before.has(client.address) &&
            !used.has(client.address),
        )?.address;
        if (address) break;
        yield* sleep(0.1);
      }
    }
    if (!address) {
      yield* logStep(`Fallback candidate lookup for '${slot.tag}'`);
      address = candidates(yield* readClients())[0]?.address;
    }
    if (!address) {
      yield* logStep(`Failed to resolve address for slot '${slot.tag}'`);
      return undefined;
    }

    yield* move(slot.workspace, address);
    yield* tagAddress(address, slot.tag);
    used.add(address);
    yield* logStep(`Slot '${slot.tag}' now bound to ${address}`);
    return address;
  });
  const resize = Effect.fn("workspaceSetup.resize")(function* (
    tag: string,
    width: number,
    height: number,
  ) {
    const address = yield* addressByTag(tag);
    if (!address) return;
    yield* logStep(`Resizing tag '${tag}' (${address}) to ${width}x${height}`);
    yield* dispatch(
      `hl.dsp.window.resize({ x = ${width}, y = ${height}, window = ${quote(`address:${address}`)} })`,
    );
  });
  const preselect = (direction: "d" | "r") =>
    dispatch(`hl.dsp.layout(${quote(`preselect ${direction}`)})`);
  const slot = (
    tag: string,
    pattern: string,
    command: string,
    workspace: number,
    skipOpenCode: boolean,
    excludePattern?: string,
  ): Slot => ({
    tag,
    pattern,
    command,
    workspace,
    skipOpenCode,
    excludePattern,
  });

  if (config.startupDelay > 0) {
    const line = `[workspace-setup] Sleeping ${config.startupDelay}s before startup`;
    console.log(line);
    appendFileSync(logFile, `${line}\n`);
    yield* Effect.sleep(`${config.startupDelay} seconds`);
  }

  const lock = yield* Effect.try({
    try: () =>
      acquireWorkspaceMutationLock(
        (message) => new WorkspaceSetupError({ message }),
      ),
    catch: (error) =>
      error instanceof WorkspaceSetupError
        ? error
        : new WorkspaceSetupError({ message: String(error) }),
  });

  const run = Effect.gen(function* () {
    for (const dependency of [
      "hyprctl",
      ...(config.mode === undefined ? ["is-work-time"] : []),
      "uwsm",
      "chromium",
      "ghostty-host-config",
      "herdr",
    ]) {
      if (Bun.which(dependency) === null)
        return fail(`${dependency} is not available`);
    }

    const clientsJson = yield* executor.run("hyprctl", ["-j", "clients"]);
    const activeWindowJson = yield* executor.run("hyprctl", [
      "-j",
      "activewindow",
    ]);
    const { clients, activeAddress } = validateWorkspaceSetupPreflight(
      clientsJson,
      activeWindowJson,
      config.temporaryWorkspace,
    );
    startFocusAddress = activeAddress;
    yield* showOverlay("Setting up workspace...");
    const startupBrowser = clients.some(
      (client) =>
        client.address === activeAddress &&
        (client.class === "chromium" || client.initialClass === "chromium"),
    )
      ? activeAddress
      : "";
    const workTime =
      config.mode === "work"
        ? true
        : config.mode === "normal"
          ? false
          : (yield* executor.exitCode("is-work-time", [])) === 0;
    if (workTime && Bun.which("google-chrome-stable") === null) {
      return fail("google-chrome-stable is not available");
    }

    yield* logStep(
      `Starting workspace setup (step-through=${config.stepThrough}, speed-multiplier=${config.speedMultiplier}, move-dispatcher=${config.moveDispatcher}, log-file=${logFile})`,
    );
    if (startupBrowser) {
      yield* logStep(
        `Startup browser detected at ${startupBrowser}; preferring it for center browser slot`,
      );
    } else if (activeAddress) {
      yield* logStep(
        `Focused startup window ${activeAddress} is not chromium; center browser slot will use normal candidate selection`,
      );
    } else {
      yield* logStep(
        "No focused startup window detected; center browser slot will use normal candidate selection",
      );
    }
    yield* logStep(
      config.mode === undefined
        ? `Detected ${workTime ? "work-time" : "non-work-time"} mode`
        : `Using ${config.mode} mode`,
    );

    const personalBrowser = slot(
      TAGS.browser,
      PATTERN_CHROMIUM,
      'uwsm app -- chromium --new-window --ozone-platform=wayland --profile-directory="Default" --force-device-scale-factor=0.8',
      1,
      false,
    );
    const terminalCommand = `uwsm app -- ghostty-host-config --working-directory=${HOME_DIR}`;
    const terminal = (tag: string, workspace: number) =>
      slot(
        tag,
        PATTERN_GHOSTTY,
        terminalCommand,
        workspace,
        true,
        PATTERN_HERDR,
      );
    const herdr = slot(
      TAGS.workspace2Terminal,
      PATTERN_HERDR,
      `uwsm app -- ghostty-host-config --working-directory=${HOME_DIR} -e herdr`,
      2,
      true,
    );
    const workChrome =
      "uwsm app -- google-chrome-stable --new-window --ozone-platform=wayland --force-device-scale-factor=0.8 --profile-directory=Profile\\ 1 --user-data-dir=$HOME/.config/google-chrome-work";

    if (workTime) {
      yield* logStep("Preparing workspace 1 work apps");
      yield* clearTag(TAGS.terminalTop);
      const slackAddress = yield* ensureSlot(
        slot(
          TAGS.slack,
          PATTERN_SLACK,
          `${workChrome} --app=https://app.slack.com/client`,
          1,
          false,
        ),
      );
      const browserAddress = yield* ensureSlot(personalBrowser, startupBrowser);
      if (browserAddress) {
        yield* focus(browserAddress);
        yield* preselect("d");
        yield* sleep(0.2);
      }
      yield* ensureSlot(terminal(TAGS.terminal, 1));
      if (slackAddress) {
        yield* focus(slackAddress);
        yield* preselect("r");
        yield* sleep(0.2);
      }
      yield* ensureSlot(
        slot(
          TAGS.discord,
          PATTERN_DISCORD,
          `${workChrome} --app=https://discord.com/app`,
          1,
          false,
        ),
      );

      const slack = yield* addressByTag(TAGS.slack);
      const discord = yield* addressByTag(TAGS.discord);
      const browser = yield* addressByTag(TAGS.browser);
      const term = yield* addressByTag(TAGS.terminal);
      if (slack && discord && browser && term) {
        yield* logStep("Rebuilding workspace 1 work tree");
        for (const address of [slack, discord, browser, term]) {
          yield* move(config.temporaryWorkspace, address);
        }
        yield* sleep(0.2);
        yield* move(1, slack);
        yield* focus(slack);
        yield* preselect("d");
        yield* sleep(0.1);
        yield* move(1, browser);
        yield* focus(browser);
        yield* preselect("d");
        yield* sleep(0.1);
        yield* move(1, term);
        yield* focus(slack);
        yield* preselect("r");
        yield* sleep(0.1);
        yield* move(1, discord);
        yield* sleep(0.2);
      } else {
        yield* logStep(
          "Skipping workspace 1 work tree rebuild (missing one or more windows)",
        );
      }
      yield* logStep("Applying workspace 1 work layout sizes");
      yield* resize(TAGS.slack, 671, 660);
      yield* resize(TAGS.discord, 671, 660);
      yield* resize(TAGS.browser, 1348, 850);
      yield* resize(TAGS.terminal, 1348, 850);
      if (activeAddress) yield* focus(activeAddress);

      yield* logStep("Preparing workspace 2 and 3 work apps");
      yield* clearTag(TAGS.workspace2Cursor);
      yield* ensureSlot(herdr);
      yield* ensureSlot(
        slot(
          TAGS.workBrowser,
          PATTERN_WORK_BROWSER,
          `${workChrome} --class=work-browser`,
          3,
          false,
        ),
      );
    } else {
      yield* logStep("Preparing workspace 1 non-work apps");
      yield* clearTag(TAGS.slack);
      yield* clearTag(TAGS.discord);
      yield* ensureSlot(personalBrowser, startupBrowser);
      yield* ensureSlot(terminal(TAGS.terminalTop, 1));
      yield* ensureSlot(terminal(TAGS.terminal, 1));

      const top = yield* addressByTag(TAGS.terminalTop);
      const browser = yield* addressByTag(TAGS.browser);
      const term = yield* addressByTag(TAGS.terminal);
      if (top && browser && term) {
        yield* logStep("Rebuilding workspace 1 non-work tree");
        for (const address of [top, browser, term]) {
          yield* move(config.temporaryWorkspace, address);
        }
        yield* sleep(0.2);
        yield* move(1, top);
        yield* focus(top);
        yield* preselect("d");
        yield* sleep(0.1);
        yield* move(1, browser);
        yield* focus(browser);
        yield* preselect("d");
        yield* sleep(0.1);
        yield* move(1, term);
        yield* sleep(0.2);
      } else {
        yield* logStep(
          "Skipping workspace 1 non-work tree rebuild (missing one or more windows)",
        );
      }
      yield* logStep("Applying workspace 1 non-work layout sizes");
      yield* resize(TAGS.terminalTop, 1294, 600);
      yield* resize(TAGS.browser, 1348, 850);
      yield* resize(TAGS.terminal, 1348, 850);
      if (activeAddress) yield* focus(activeAddress);

      yield* logStep("Preparing workspace 2 non-work app");
      yield* clearTag(TAGS.workspace2Cursor);
      yield* ensureSlot(herdr);
    }

    yield* logStep("Switching to workspace 2");
    yield* dispatch('hl.dsp.focus({ workspace = "2" })');
    yield* logStep("Workspace setup complete");
    yield* logStep("Cleaning up logs older than 7 days");
    const now = yield* Clock.currentTimeMillis;
    const cutoff = now - 7 * 24 * 60 * 60 * 1000;
    for (const entry of new Bun.Glob("workspace-setup-*.log").scanSync({
      cwd: LOG_DIRECTORY,
      absolute: true,
      onlyFiles: true,
    })) {
      if (Bun.file(entry).lastModified < cutoff) rmSync(entry, { force: true });
    }
  });

  yield* run.pipe(
    Effect.ensuring(
      Effect.gen(function* () {
        yield* hideOverlay();
        releaseWorkspaceMutationLock(lock);
      }),
    ),
  );
});
