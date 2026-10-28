import { homedir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import {
  AudioControl,
  ClipboardTextRequest,
  DesktopWindowRequest,
  DesktopWindowStateRequest,
  DesktopWorkspaceRequest,
  DisplayControl,
  GetFilesRequest,
  HistoryRequest,
  HyprlandDispatchRequest,
  HyprlandMoveWindowRequest,
  HyprlandMoveWorkspaceRequest,
  HyprlandOptionRequest,
  HyprlandRenameWorkspaceRequest,
  HyprlandSetWindowRequest,
  KeepAwakeRequest,
  MediaControl,
  ModuleName,
  Notification,
  OmarchyMenuRequest,
  OmarchyPanelRequest,
  OpenTarget,
  PowerProfileRequest,
  ProcessKillRequest,
  SystemBridgeWebSocket,
} from "@timmo001/effect-system-bridge";
import { Duration, Effect, FileSystem, Layer, Redacted, Schema } from "effect";
import { type ClientNamespace, clientTools, pathExists } from "./tool";

const tokenPath = join(
  process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"),
  "system-bridge",
  "v5",
  "token",
);

const port = Number(process.env.SYSTEM_BRIDGE_PORT) || 9170;

const options = Effect.flatMap(Effect.service(FileSystem.FileSystem), (fs) => fs.readFileString(tokenPath)).pipe(
  Effect.provide(NodeServices.layer),
  Effect.map((token) => ({
    host: "localhost",
    port,
    token: Redacted.make(token.trim()),
    // The tool's own timeout bounds each call, and execute_command can run long
    requestTimeout: Duration.minutes(10),
  })),
);

const tool = clientTools(Layer.unwrap(Effect.map(options, SystemBridgeWebSocket.layerGlobal)));

const withBridge = <A, E>(f: (bridge: SystemBridgeWebSocket["Service"]) => Effect.Effect<A, E>) =>
  Effect.flatMap(Effect.service(SystemBridgeWebSocket), f);

/** A write that takes one of the client's request schemas and returns nothing. */
const action = <S extends Schema.Codec<any, any>>(definition: {
  readonly name: string;
  readonly description: string;
  readonly input: S;
  readonly resource?: (input: S["Type"]) => string;
  readonly run: (bridge: SystemBridgeWebSocket["Service"], input: S["Type"]) => Effect.Effect<unknown, unknown>;
}) =>
  tool({
    name: definition.name,
    description: definition.description,
    access: "write",
    input: definition.input,
    resource: definition.resource,
    summary: (input) => `${definition.name} ${JSON.stringify(input)}`,
    run: (input) => withBridge((bridge) => definition.run(bridge, input)),
  });

/** This machine through the System Bridge backend's WebSocket. */
export const systemBridgeNamespace: ClientNamespace = {
  kind: "client",
  command: "system-bridge",
  description:
    "This machine through System Bridge: read system modules (cpu, memory, disks, processes, sensors, media, audio, displays and the desktop with its Hyprland windows, workspaces, binds, options and config errors), metric history and media files, and control windows, workspaces, media, audio, displays, notifications, the clipboard and Omarchy menus.",
  available: pathExists(tokenPath),
  tools: [
    tool({
      name: "data",
      description: "Read the latest data of the given modules.",
      access: "read",
      pinned: true,
      input: Schema.Struct({ modules: Schema.Array(ModuleName) }),
      run: ({ modules }) => withBridge((bridge) => bridge.getData(modules)),
    }),
    tool({
      name: "hyprland",
      description:
        "Read the desktop: the focused window, workspace and display, every window and workspace with their ids for the window and workspace tools, and Hyprland's binds, options, global shortcuts and config errors.",
      access: "read",
      pinned: true,
      input: Schema.Struct({}),
      run: () => withBridge((bridge) => Effect.map(bridge.getData(["desktop"]), (data) => data.desktop)),
    }),
    tool({
      name: "history",
      description: "Read metric history from up to the last 24 hours, optionally since a Unix time in milliseconds and for some modules.",
      access: "read",
      input: HistoryRequest,
      run: (input) => withBridge((bridge) => bridge.getHistory(input)),
    }),
    tool({
      name: "media_directories",
      description: "List the media directories files can be listed from.",
      access: "read",
      input: Schema.Struct({}),
      run: () => withBridge((bridge) => bridge.getDirectories),
    }),
    tool({
      name: "files",
      description: "List the files in a media directory, by its key from media_directories, optionally in a subpath.",
      access: "read",
      input: GetFilesRequest,
      run: (input) => withBridge((bridge) => bridge.getFiles(input)),
    }),
    tool({
      name: "commands",
      description: "List the allowlisted commands execute_command can run.",
      access: "read",
      input: Schema.Struct({}),
      run: () => withBridge((bridge) => Effect.map(bridge.getSettings, (settings) => settings.commands)),
    }),
    action({
      name: "hyprland_dispatch",
      description: "Run one of System Bridge's typed Hyprland dispatchers, optionally on a window by id.",
      input: HyprlandDispatchRequest,
      resource: (input) => input.dispatcher,
      run: (bridge, input) => bridge.hyprlandDispatch(input),
    }),
    action({
      name: "hyprland_set_window",
      description: "Float or tile, pin, move or resize a window.",
      input: HyprlandSetWindowRequest,
      run: (bridge, input) => bridge.hyprlandSetWindow(input),
    }),
    action({
      name: "hyprland_move_window",
      description: "Move a window to a workspace, leaving the focus where it is.",
      input: HyprlandMoveWindowRequest,
      run: (bridge, input) => bridge.hyprlandMoveWindow(input),
    }),
    action({
      name: "hyprland_move_workspace",
      description: "Move a workspace to a display.",
      input: HyprlandMoveWorkspaceRequest,
      run: (bridge, input) => bridge.hyprlandMoveWorkspace(input),
    }),
    action({
      name: "hyprland_rename_workspace",
      description: "Rename a workspace, or restore its default name.",
      input: HyprlandRenameWorkspaceRequest,
      run: (bridge, input) => bridge.hyprlandRenameWorkspace(input),
    }),
    action({
      name: "hyprland_set_option",
      description: "Set a Hyprland option until the config reloads.",
      input: HyprlandOptionRequest,
      resource: (input) => input.name,
      run: (bridge, input) => bridge.hyprlandSetOption(input),
    }),
    action({
      name: "hyprland_kill_window",
      description: "Kill a window's app without asking it to close.",
      input: DesktopWindowRequest,
      run: (bridge, input) => bridge.hyprlandKillWindow(input),
    }),
    action({
      name: "close_window",
      description: "Ask a window to close, as its close button would.",
      input: DesktopWindowRequest,
      run: (bridge, input) => bridge.desktopCloseWindow(input),
    }),
    action({
      name: "focus_window",
      description: "Focus a window, showing its workspace.",
      input: DesktopWindowRequest,
      run: (bridge, input) => bridge.desktopFocusWindow(input),
    }),
    action({
      name: "focus_workspace",
      description: "Show and focus a workspace.",
      input: DesktopWorkspaceRequest,
      run: (bridge, input) => bridge.desktopFocusWorkspace(input),
    }),
    action({
      name: "window_state",
      description: "Make a window fullscreen or maximised, or not.",
      input: DesktopWindowStateRequest,
      run: (bridge, input) => bridge.desktopSetWindowState(input),
    }),
    action({
      name: "media_control",
      description: "Play, pause, skip, seek or change the volume of a media player.",
      input: MediaControl,
      resource: (input) => input.action,
      run: (bridge, input) => bridge.mediaControl(input),
    }),
    action({
      name: "audio_control",
      description: "Set an output's, input's or app's volume or mute, make one the default, or move an app to another output.",
      input: AudioControl,
      run: (bridge, input) => bridge.audioControl(input),
    }),
    action({
      name: "display_control",
      description: "Set a display's brightness or power state.",
      input: DisplayControl,
      run: (bridge, input) => bridge.displayControl(input),
    }),
    tool({
      name: "notify",
      description: "Send a desktop notification, returning its id.",
      access: "write",
      input: Notification,
      summary: (input) => `notify ${input.title}: ${input.message}`,
      run: (input) => withBridge((bridge) => bridge.sendNotification(input)),
    }),
    action({
      name: "open",
      description: "Open a path or URL with its default app.",
      input: OpenTarget,
      resource: (input) => ("url" in input ? "url" : "path"),
      run: (bridge, input) => bridge.open(input),
    }),
    action({
      name: "clipboard_set",
      description: "Put text on the clipboard.",
      input: ClipboardTextRequest,
      run: (bridge, input) => bridge.setClipboard(input),
    }),
    action({
      name: "power_profile",
      description: "Switch the power profile, such as balanced or performance.",
      input: PowerProfileRequest,
      resource: (input) => input.profile,
      run: (bridge, input) => bridge.setPowerProfile(input),
    }),
    action({
      name: "keep_awake",
      description: "Keep the system from idling, optionally for some seconds, or let it idle again.",
      input: KeepAwakeRequest,
      run: (bridge, input) => bridge.setKeepAwake(input),
    }),
    action({
      name: "kill_process",
      description: "End a process by its id from the processes module, optionally forcing it.",
      input: ProcessKillRequest,
      run: (bridge, input) => bridge.killProcess(input),
    }),
    action({
      name: "omarchy_menu",
      description: "Open, close or toggle the Omarchy menu at a route.",
      input: OmarchyMenuRequest,
      run: (bridge, input) => bridge.omarchyMenu(input),
    }),
    action({
      name: "omarchy_panel",
      description: "Open, close or toggle an Omarchy shell panel.",
      input: OmarchyPanelRequest,
      run: (bridge, input) => bridge.omarchyPanel(input),
    }),
    tool({
      name: "execute_command",
      description: "Run an allowlisted command by its id from commands and wait for its output.",
      access: "write",
      timeout: "10 minutes",
      input: Schema.Struct({ id: Schema.String }),
      resource: (input) => input.id,
      summary: (input) => `execute command ${input.id}`,
      run: (input) => withBridge((bridge) => bridge.executeCommand(input.id)),
    }),
  ],
};
