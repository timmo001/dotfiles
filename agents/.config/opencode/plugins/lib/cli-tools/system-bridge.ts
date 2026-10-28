import { homedir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "@effect/platform-node";
import {
  AudioControl,
  ClipboardTextRequest,
  DisplayControl,
  GetFilesRequest,
  HistoryRequest,
  KeepAwakeRequest,
  MediaControl,
  ModuleName,
  Notification,
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
    "This machine through System Bridge: read system modules (cpu, memory, disks, processes, sensors, media, audio and displays), metric history and media files, and control media, audio, displays, notifications and the clipboard.",
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
