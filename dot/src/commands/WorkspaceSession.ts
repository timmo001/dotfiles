import { Effect, Schema } from "effect";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import {
  decodeJson,
  isJsonObject,
  type JsonObject,
  type JsonValue,
} from "../lib/schema.js";
import { STATE_DIR, expandHomePath } from "../lib/paths.js";
import {
  CommandExecutor,
  type CommandExecutorService,
} from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";

const EXCLUDED_CLASS = /^workspace-menu-terminal$/;
const EXCLUDED_TITLE = /^Workspace Menu$/;
const SESSION_VERSION = 2;
const POLICY_VERSION = 1;

const CoordinateSchema = Schema.Tuple([Schema.Finite, Schema.Finite]);
const WorkspaceSchema = Schema.Struct({ id: Schema.Finite });
const ProcessSchema = Schema.Struct({
  address: Schema.optional(Schema.String),
  pid: Schema.optional(Schema.NullOr(Schema.Finite)),
  cmdline: Schema.optional(Schema.String),
  cwd: Schema.optional(Schema.String),
});
const SessionClientSchema = Schema.Struct({
  address: Schema.optional(Schema.String),
  pid: Schema.optional(Schema.Finite),
  class: Schema.optional(Schema.String),
  initialClass: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  initialTitle: Schema.optional(Schema.String),
  workspace: WorkspaceSchema,
  at: Schema.optional(CoordinateSchema),
  size: Schema.optional(CoordinateSchema),
  floating: Schema.optional(Schema.Boolean),
  focusHistoryID: Schema.optional(Schema.Finite),
  process: Schema.optional(ProcessSchema),
  browser_url: Schema.optional(Schema.NullOr(Schema.String)),
});
const SessionSchema = Schema.Struct({
  version: Schema.optional(Schema.Literal(SESSION_VERSION)),
  generated_at: Schema.optional(Schema.String),
  scope: Schema.optional(Schema.String),
  active_workspace: Schema.Struct({ id: Schema.optional(Schema.Finite) }),
  active_window: Schema.optional(Schema.Json),
  monitors: Schema.optional(Schema.Json),
  clients: Schema.Array(SessionClientSchema),
});
const LiveClientSchema = Schema.Struct({
  address: Schema.NonEmptyString,
  class: Schema.optional(Schema.String),
  initialClass: Schema.optional(Schema.String),
  title: Schema.optional(Schema.String),
  initialTitle: Schema.optional(Schema.String),
  pid: Schema.optional(Schema.Finite),
  workspace: WorkspaceSchema,
  at: Schema.optional(CoordinateSchema),
  size: Schema.optional(CoordinateSchema),
  floating: Schema.optional(Schema.Boolean),
  focusHistoryID: Schema.optional(Schema.Finite),
});
const LiveClientsSchema = Schema.Array(LiveClientSchema);
const BrowserUrlsSchema = Schema.Array(
  Schema.Struct({ title: Schema.optional(Schema.String), url: Schema.String }),
);
const LaunchCommandSchema = Schema.Struct({
  executable: Schema.NonEmptyString,
  args: Schema.Array(Schema.String),
});
const LaunchRuleSchema = Schema.Struct({
  label: Schema.NonEmptyString,
  matches: Schema.Array(Schema.NonEmptyString),
  liveMatches: Schema.optional(Schema.Array(Schema.NonEmptyString)),
  command: LaunchCommandSchema,
});
const PolicySchema = Schema.Struct({
  version: Schema.Literal(POLICY_VERSION),
  launchRules: Schema.Array(LaunchRuleSchema),
});

interface LiveClient {
  readonly address: string;
  readonly class?: string;
  readonly initialClass?: string;
  readonly title?: string;
  readonly initialTitle?: string;
  readonly pid?: number;
  readonly workspace: { readonly id: number };
  readonly at?: readonly [number, number];
  readonly size?: readonly [number, number];
  readonly floating?: boolean;
  readonly focusHistoryID?: number;
  readonly raw: JsonObject;
}

/** One captured Hyprland client in a version 2 workspace session. */
export interface WorkspaceSessionClient {
  /** Saved Hyprland address. */
  readonly address?: string;
  /** Current window class at capture time. */
  readonly class?: string;
  /** Initial window class at capture time. */
  readonly initialClass?: string;
  /** Current window title at capture time. */
  readonly title?: string;
  /** Saved workspace. */
  readonly workspace: { readonly id: number };
  /** Saved top-left coordinates. */
  readonly at?: readonly [number, number];
  /** Saved window size. */
  readonly size?: readonly [number, number];
  /** Whether the saved window was floating. */
  readonly floating?: boolean;
  /** Captured process metadata. */
  readonly process?: { readonly cwd?: string };
  /** Captured browser URL. */
  readonly browser_url?: string | null;
}

/** An argv-based application launch command. */
export interface WorkspaceLaunchCommand {
  /** Executable resolved through PATH. */
  readonly executable: string;
  /** Arguments passed to the executable. */
  readonly args: readonly string[];
}

/** A private class-to-command restore rule. */
export interface WorkspaceLaunchRule {
  /** Human-readable restore label. */
  readonly label: string;
  /** Regular expressions matched against current and initial classes. */
  readonly matches: readonly string[];
  /** Optional broader expressions used to find a running or newly launched window. */
  readonly liveMatches?: readonly string[];
  /** Command used when no existing window matches. */
  readonly command: WorkspaceLaunchCommand;
}

/** Domain error raised by workspace capture or restore. */
export class WorkspaceSessionError extends Schema.TaggedError<WorkspaceSessionError>()(
  "WorkspaceSessionError",
  { message: Schema.String },
) {}

function fail(message: string): never {
  throw new WorkspaceSessionError({ message });
}

function parseJson(source: string, label: string): JsonValue {
  try {
    return decodeJson(JSON.parse(source));
  } catch (error) {
    return fail(`${label} returned invalid JSON: ${String(error)}`);
  }
}

/** Decode a persisted version 2 workspace session. */
export function decodeWorkspaceSession(value: JsonValue) {
  try {
    const session = Schema.decodeUnknownSync(SessionSchema)(value);
    if (
      session.clients.some((client) => !Number.isInteger(client.workspace.id))
    ) {
      return fail("Workspace session client ids must be integers");
    }
    return session;
  } catch (error) {
    if (error instanceof WorkspaceSessionError) throw error;
    return fail(`Invalid workspace session: ${String(error)}`);
  }
}

/** Decode and validate optional private workspace launch policy. */
export function decodeWorkspaceLaunchPolicy(
  value: JsonValue,
): readonly WorkspaceLaunchRule[] {
  try {
    const policy = Schema.decodeUnknownSync(PolicySchema)(value);
    for (const rule of policy.launchRules) {
      if (rule.matches.length === 0) return fail("Launch rules need a match");
      for (const pattern of [...rule.matches, ...(rule.liveMatches ?? [])]) {
        new RegExp(pattern);
      }
    }
    return policy.launchRules;
  } catch (error) {
    if (error instanceof WorkspaceSessionError) throw error;
    return fail(`Invalid workspace session launch policy: ${String(error)}`);
  }
}

function excluded(client: {
  readonly class?: string;
  readonly initialClass?: string;
  readonly title?: string;
  readonly initialTitle?: string;
}): boolean {
  return (
    EXCLUDED_CLASS.test(client.class ?? "") ||
    EXCLUDED_CLASS.test(client.initialClass ?? "") ||
    EXCLUDED_TITLE.test(client.title ?? "") ||
    EXCLUDED_TITLE.test(client.initialTitle ?? "")
  );
}

function cleanBrowserTitle(title: string): string {
  return title
    .replace(/^\(\d+\) /, "")
    .replace(/ - Chromium$/, "")
    .replace(/ - Google Chrome$/, "");
}

function formatTimestamp(date: Date): string {
  const part = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}${part(date.getMonth() + 1)}${part(date.getDate())}-${part(date.getHours())}${part(date.getMinutes())}${part(date.getSeconds())}`;
}

function formatIsoSeconds(date: Date): string {
  const offset = -date.getTimezoneOffset();
  const sign = offset >= 0 ? "+" : "-";
  const absolute = Math.abs(offset);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000)
    .toISOString()
    .slice(0, 19);
  return `${local}${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

function appendLog(path: string, line: string): void {
  process.stdout.write(`${line}\n`);
  writeFileSync(path, `${line}\n`, { flag: "a" });
}

function decodeLogged<A>(logPath: string, decode: () => A): A {
  try {
    return decode();
  } catch (error) {
    appendLog(logPath, error instanceof Error ? error.message : String(error));
    throw error;
  }
}

function runLogged(
  executor: CommandExecutorService,
  logPath: string,
  command: string,
  args: readonly string[],
) {
  return executor
    .run(command, args)
    .pipe(
      Effect.tapError((error) =>
        Effect.sync(() => appendLog(logPath, error.stderr || error.command)),
      ),
    );
}

/** Expand a home-relative private policy argument, including values after `=`. */
export function expandWorkspacePolicyArg(value: string): string {
  const equals = value.indexOf("=");
  if (equals < 0) return expandHomePath(value);
  return `${value.slice(0, equals + 1)}${expandHomePath(value.slice(equals + 1))}`;
}

function readProcess(pid: number | undefined, address: string) {
  if (pid === undefined) return { address, pid: null, cmdline: "", cwd: "" };
  let cmdline = "";
  let cwd = "";
  try {
    cmdline = readFileSync(`/proc/${pid}/cmdline`, "utf8")
      .replaceAll("\0", " ")
      .trimEnd();
  } catch {}
  try {
    cwd = readlinkSync(`/proc/${pid}/cwd`);
  } catch {}
  return { address, pid, cmdline, cwd };
}

function decodeLiveClients(value: JsonValue) {
  try {
    const decoded = Schema.decodeUnknownSync(LiveClientsSchema)(value);
    if (
      !Array.isArray(value) ||
      value.some((client) => !isJsonObject(client))
    ) {
      return fail("Invalid Hyprland clients response: expected client objects");
    }
    return decoded.map((client, index): LiveClient => ({
      ...client,
      raw: value[index],
    }));
  } catch (error) {
    return fail(`Invalid Hyprland clients response: ${String(error)}`);
  }
}

function decodeActiveWorkspace(value: JsonValue): { readonly id: number } {
  try {
    return Schema.decodeUnknownSync(Schema.Struct({ id: Schema.Finite }))(
      value,
    );
  } catch (error) {
    return fail(`Invalid Hyprland active workspace response: ${String(error)}`);
  }
}

function decodeBrowserUrls(value: JsonValue) {
  try {
    return Schema.decodeUnknownSync(BrowserUrlsSchema)(value);
  } catch (error) {
    return fail(`Invalid browser URL state: ${String(error)}`);
  }
}

function shellArg(value: string): string {
  return /^[A-Za-z0-9_@%+=:,./~-]+$/.test(value)
    ? value
    : `'${value.replaceAll("'", `'"'"'`)}'`;
}

/** Render argv as one safely shell-quoted command for Hyprland's exec boundary. */
export function renderWorkspaceLaunchCommand(
  command: WorkspaceLaunchCommand,
): string {
  return [command.executable, ...command.args].map(shellArg).join(" ");
}

function classMatches(
  pattern: string,
  client: WorkspaceSessionClient,
): boolean {
  const regex = new RegExp(pattern);
  return (
    regex.test(client.class ?? "") || regex.test(client.initialClass ?? "")
  );
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface RestoreTarget {
  readonly label: string;
  readonly classPattern: string;
  readonly command: WorkspaceLaunchCommand;
}

/** Resolve the supported relaunch target for a captured client. */
export function restoreTargetForClient(
  client: WorkspaceSessionClient,
  privateRules: readonly WorkspaceLaunchRule[],
): RestoreTarget | undefined {
  for (const rule of privateRules) {
    const pattern = rule.matches.find((candidate) =>
      classMatches(candidate, client),
    );
    if (pattern) {
      return {
        label: rule.label,
        classPattern: (rule.liveMatches ?? rule.matches)
          .map((value) => `(?:${value})`)
          .join("|"),
        command: rule.command,
      };
    }
  }

  const className = client.class || client.initialClass || "unknown";
  const twitchClass = [client.class, client.initialClass].find(
    (candidate) =>
      candidate !== undefined &&
      (/^chrome-(?:www\.)?twitch\.tv__/.test(candidate) ||
        candidate.startsWith("chrome-twitch.tv__")),
  );
  if (twitchClass) {
    const rawPath = twitchClass.slice(twitchClass.indexOf("__") + 2);
    const suffix = rawPath.lastIndexOf("-");
    const path = suffix < 0 ? rawPath : rawPath.slice(0, suffix);
    const host = twitchClass.slice("chrome-".length, twitchClass.indexOf("__"));
    const url =
      client.browser_url ||
      `https://${host}/${path.startsWith("directory_") ? path.replaceAll("_", "/") : path}`;
    return {
      label: `Twitch (${path})`,
      classPattern: "^chrome-(www\\.)?twitch\\.tv__" + escapeRegex(path) + "-",
      command: { executable: "omarchy-launch-webapp", args: [url] },
    };
  }
  if (className.startsWith("chrome-") && client.browser_url) {
    return {
      label: client.title ? `${className} (${client.title})` : className,
      classPattern: `^${escapeRegex(className)}$`,
      command: {
        executable: "omarchy-launch-webapp",
        args: [client.browser_url],
      },
    };
  }
  if (
    client.class === "com.mitchellh.ghostty" ||
    client.initialClass === "com.mitchellh.ghostty"
  ) {
    const cwd = client.process?.cwd;
    return {
      label: "Ghostty",
      classPattern: "^com\\.mitchellh\\.ghostty$",
      command: {
        executable: "uwsm",
        args: [
          "app",
          "--",
          "ghostty-host-config",
          ...(cwd && existsSync(cwd) ? [`--working-directory=${cwd}`] : []),
        ],
      },
    };
  }
  return undefined;
}

function loadPrivateRules(privateDotfiles: string | null) {
  if (!privateDotfiles) return [];
  const path = join(privateDotfiles, "workspace-session.json");
  if (!existsSync(path)) return [];
  return decodeWorkspaceLaunchPolicy(
    parseJson(readFileSync(path, "utf8"), "workspace session launch policy"),
  ).map((rule) => ({
    ...rule,
    command: {
      ...rule.command,
      args: rule.command.args.map(expandWorkspacePolicyArg),
    },
  }));
}

/** Capture a version 2 Hyprland workspace session. */
export const workspaceCapture = Effect.fn("workspaceCapture")(
  function* (options: {
    readonly currentWorkspace: boolean;
    readonly output?: string;
    readonly stateDir?: string;
  }) {
    const executor = yield* CommandExecutor;
    const stateDir = expandHomePath(
      options.stateDir ?? join(STATE_DIR, "workspace-sessions"),
    );
    mkdirSync(stateDir, { recursive: true });
    const output = expandHomePath(
      options.output ??
        join(stateDir, `workspace-${formatTimestamp(new Date())}.json`),
    );
    mkdirSync(dirname(output), { recursive: true });
    const logPath = join(stateDir, "capture.log");
    writeFileSync(logPath, "");

    const activeWorkspaceSource = yield* runLogged(
      executor,
      logPath,
      "hyprctl",
      ["-j", "activeworkspace"],
    );
    const activeWorkspace = decodeLogged(logPath, () =>
      parseJson(activeWorkspaceSource, "hyprctl activeworkspace"),
    );
    const active = decodeLogged(logPath, () =>
      decodeActiveWorkspace(activeWorkspace),
    );
    const activeWindow = yield* executor
      .run("hyprctl", ["-j", "activewindow"])
      .pipe(
        Effect.map((value) =>
          decodeLogged(logPath, () => parseJson(value, "hyprctl activewindow")),
        ),
        Effect.orElseSucceed(() => ({})),
      );
    const monitorsSource = yield* runLogged(executor, logPath, "hyprctl", [
      "-j",
      "monitors",
    ]);
    const monitors = decodeLogged(logPath, () =>
      parseJson(monitorsSource, "hyprctl monitors"),
    );
    const clientsSource = yield* runLogged(executor, logPath, "hyprctl", [
      "-j",
      "clients",
    ]);
    let clients = decodeLogged(logPath, () =>
      decodeLiveClients(parseJson(clientsSource, "hyprctl clients")),
    ).filter((client) => !excluded(client));
    if (options.currentWorkspace) {
      clients = clients.filter((client) => client.workspace.id === active.id);
    }

    const urlPath = join(STATE_DIR, "browser-urls.json");
    const urls = existsSync(urlPath)
      ? decodeLogged(logPath, () =>
          decodeBrowserUrls(
            parseJson(readFileSync(urlPath, "utf8"), "browser URL state"),
          ),
        )
      : [];
    const capturedClients = clients.map((client) => {
      const processInfo = readProcess(client.pid, client.address);
      if (!/^chrome-|^chromium$/.test(client.class ?? "")) {
        return { ...client.raw, process: processInfo };
      }
      const title = cleanBrowserTitle(client.title ?? "");
      return {
        ...client.raw,
        process: processInfo,
        browser_url:
          urls.find((entry) => (entry.title ?? "") === title)?.url ?? null,
      };
    });
    const session = {
      version: SESSION_VERSION,
      generated_at: formatIsoSeconds(new Date()),
      scope: options.currentWorkspace ? "current-workspace" : "all-workspaces",
      active_workspace: activeWorkspace,
      active_window: activeWindow,
      monitors,
      clients: capturedClients,
    };
    decodeLogged(logPath, () =>
      writeFileSync(output, `${JSON.stringify(session, null, 2)}\n`),
    );
    appendLog(logPath, `Captured workspace session: ${output}`);
  },
);

function newestSession(stateDir: string): string | undefined {
  if (!existsSync(stateDir)) return undefined;
  return readdirSync(stateDir)
    .filter((name) => /^workspace-.*\.json$/.test(name))
    .map((name) => ({
      path: join(stateDir, name),
      mtime: statSync(join(stateDir, name)).mtimeMs,
    }))
    .sort((left, right) => right.mtime - left.mtime)[0]?.path;
}

function matchingClients(
  clients: readonly LiveClient[],
  pattern: string,
  used: ReadonlySet<string>,
) {
  const regex = new RegExp(pattern);
  return clients
    .filter(
      (client) =>
        !used.has(client.address) &&
        (regex.test(client.class ?? "") ||
          regex.test(client.initialClass ?? "")),
    )
    .sort(
      (left, right) =>
        (left.focusHistoryID ?? 999999) - (right.focusHistoryID ?? 999999),
    );
}

/** Restore an existing version 2 workspace session. */
export const workspaceRestore = Effect.fn("workspaceRestore")(
  function* (options: {
    readonly dryRun: boolean;
    readonly file?: string;
    readonly stateDir?: string;
    readonly launchMissing: boolean;
    readonly moveExisting: boolean;
  }) {
    const executor = yield* CommandExecutor;
    const config = yield* Config;
    const stateDir = expandHomePath(
      options.stateDir ?? join(STATE_DIR, "workspace-sessions"),
    );
    const sessionPath = options.file
      ? expandHomePath(options.file)
      : newestSession(stateDir);
    if (!sessionPath || !existsSync(sessionPath)) {
      return fail("workspace-restore: no session file found");
    }
    mkdirSync(stateDir, { recursive: true });
    const logPath = join(stateDir, "restore.log");
    writeFileSync(logPath, "");
    const log = (message: string) =>
      appendLog(logPath, options.dryRun ? `[dry-run] ${message}` : message);
    const session = decodeLogged(logPath, () =>
      decodeWorkspaceSession(
        parseJson(readFileSync(sessionPath, "utf8"), "workspace session"),
      ),
    );
    const privateRules = decodeLogged(logPath, () =>
      loadPrivateRules(config.privateDotfiles),
    );
    const used = new Set<string>();
    const liveClientsSource = yield* runLogged(executor, logPath, "hyprctl", [
      "-j",
      "clients",
    ]);
    let liveClients = decodeLogged(logPath, () =>
      decodeLiveClients(parseJson(liveClientsSource, "hyprctl clients")),
    );
    appendLog(logPath, `Restoring workspace session: ${sessionPath}`);

    const clients = [...session.clients].sort(
      (left, right) =>
        left.workspace.id - right.workspace.id ||
        (left.at?.[1] ?? 0) - (right.at?.[1] ?? 0) ||
        (left.at?.[0] ?? 0) - (right.at?.[0] ?? 0),
    );
    for (const client of clients) {
      if (excluded(client)) continue;
      const workspace = client.workspace.id;
      const className = client.class || client.initialClass || "unknown";
      let address = client.address
        ? liveClients.find(
            (candidate) =>
              candidate.address === client.address &&
              !used.has(candidate.address),
          )?.address
        : undefined;
      let label = className;
      if (address) log(`Found ${className} by address ${address}`);

      const target = restoreTargetForClient(client, privateRules);
      if (!address && target) {
        label = target.label;
        const matches = matchingClients(liveClients, target.classPattern, used);
        address =
          matches.find((candidate) => candidate.workspace.id === workspace)
            ?.address ?? matches[0]?.address;
        if (address) {
          log(
            `Reusing ${label} window ${address} for saved ${client.address ?? ""} on workspace ${workspace}`,
          );
        } else if (options.dryRun) {
          log(
            `Would launch ${label} for workspace ${workspace}: ${renderWorkspaceLaunchCommand(target.command)}`,
          );
          address = "dry-run";
        } else if (options.launchMissing) {
          log(`Launching ${label} for workspace ${workspace}`);
          const before = new Set(matches.map((candidate) => candidate.address));
          yield* executor
            .exitCode("hyprctl", [
              "dispatch",
              `hl.dsp.exec_cmd(${JSON.stringify(renderWorkspaceLaunchCommand(target.command))})`,
            ])
            .pipe(Effect.ignore);
          for (let attempt = 0; attempt < 80 && !address; attempt += 1) {
            const polledClients = yield* runLogged(
              executor,
              logPath,
              "hyprctl",
              ["-j", "clients"],
            );
            liveClients = decodeLogged(logPath, () =>
              decodeLiveClients(parseJson(polledClients, "hyprctl clients")),
            );
            address = matchingClients(
              liveClients,
              target.classPattern,
              used,
            ).find((candidate) => !before.has(candidate.address))?.address;
            if (!address) yield* Effect.sleep("100 millis");
          }
          if (!address) {
            appendLog(
              logPath,
              `workspace-restore: failed to resolve launched window for ${label} (${client.title ?? ""})`,
            );
            continue;
          }
        }
      }
      if (!address) {
        log(
          `Skipping ${className} (${client.title ?? ""}) from workspace ${workspace}: unsupported class for automatic relaunch`,
        );
        continue;
      }
      if (address !== "dry-run") used.add(address);
      if (options.moveExisting) {
        log(`Moving ${label} to workspace ${workspace}`);
        if (!options.dryRun && address !== "dry-run") {
          yield* executor
            .exitCode("hyprctl", [
              "dispatch",
              `hl.dsp.window.move({ workspace = ${JSON.stringify(String(workspace))}, window = ${JSON.stringify(`address:${address}`)} })`,
            ])
            .pipe(Effect.ignore);
          if (client.size) {
            if (client.floating && client.at) {
              log(
                `Restoring floating geometry for ${address} to ${client.size[0]}x${client.size[1]}+${client.at[0]}+${client.at[1]}`,
              );
              for (const command of [
                `hl.dsp.window.float({ action = "enable", window = "address:${address}" })`,
                `hl.dsp.window.resize({ x = ${client.size[0]}, y = ${client.size[1]}, window = "address:${address}" })`,
                `hl.dsp.window.move({ x = ${client.at[0]}, y = ${client.at[1]}, window = "address:${address}" })`,
              ])
                yield* executor
                  .exitCode("hyprctl", ["dispatch", command])
                  .pipe(Effect.ignore);
            } else {
              log(
                `Restoring tiled size for ${address} to ${client.size[0]}x${client.size[1]}`,
              );
              yield* executor
                .exitCode("hyprctl", [
                  "dispatch",
                  `hl.dsp.window.resize({ x = ${client.size[0]}, y = ${client.size[1]}, window = "address:${address}" })`,
                ])
                .pipe(Effect.ignore);
            }
          }
        }
      }
    }
    if (session.active_workspace.id !== undefined) {
      log(`Switching to saved active workspace ${session.active_workspace.id}`);
      if (!options.dryRun) {
        yield* executor
          .exitCode("hyprctl", [
            "dispatch",
            `hl.dsp.focus({ workspace = ${JSON.stringify(String(session.active_workspace.id))} })`,
          ])
          .pipe(Effect.ignore);
      }
    }
    appendLog(
      logPath,
      `Workspace restore complete${options.dryRun ? " (dry run)" : ""}`,
    );
  },
);
