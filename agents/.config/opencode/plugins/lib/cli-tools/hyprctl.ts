import { homedir } from "node:os";
import { join } from "node:path";
import { Effect, Layer, Schema } from "effect";
import { type ClientNamespace, clientTools, commandExists, pathExists, runCliOutput } from "./tool";

const tool = clientTools(Layer.empty);

const hyprctl = (args: readonly string[], json = false) =>
  runCliOutput("hyprctl", json ? ["-j", ...args] : args, { json });

const systemBridgeToken = join(
  process.env.XDG_DATA_HOME || join(homedir(), ".local", "share"),
  "system-bridge",
  "v5",
  "token",
);

/**
 * Whether System Bridge is set up here, so its own OpenCode plugin adds the `system-bridge`
 * namespace, whose get_data and Hyprland tools cover the listings below.
 */
export const systemBridgeAvailable = pathExists(systemBridgeToken);

const withoutSystemBridge = Effect.map(systemBridgeAvailable, (available) => !available);

const listing = (name: string, command: string, description: string) =>
  tool({
    name,
    description,
    access: "read",
    available: withoutSystemBridge,
    input: Schema.Struct({}),
    run: () => hyprctl([command], true),
  });

/** What hyprctl does that System Bridge's Hyprland tools don't. */
export const hyprctlNamespace: ClientNamespace = {
  kind: "client",
  command: "hyprctl",
  description:
    "Hyprland through hyprctl, for what the system-bridge namespace doesn't cover: the version, reloading the config and running any dispatcher. Read windows, workspaces, binds and config errors with system-bridge's get_data tool and its desktop module.",
  available: commandExists("hyprctl"),
  tools: [
    tool({
      name: "version",
      description: "Read the running Hyprland's version, commit and build flags.",
      access: "read",
      input: Schema.Struct({}),
      run: () => hyprctl(["version"], true),
    }),
    tool({
      name: "reload",
      description: "Reload the Hyprland config, optionally without reloading monitors.",
      access: "write",
      input: Schema.Struct({
        configOnly: Schema.optionalKey(Schema.Boolean).annotate({ description: "Leave monitors as they are" }),
      }),
      summary: (input) => `hyprctl reload${input.configOnly ? " config-only" : ""}`,
      run: (input) => hyprctl(["reload", ...(input.configOnly ? ["config-only"] : [])]),
    }),
    tool({
      name: "dispatch",
      description:
        "Run any Hyprland dispatcher with its argument, as a bind would. Prefer system-bridge's hyprland_dispatch and window tools when they cover it.",
      access: "write",
      input: Schema.Struct({
        dispatcher: Schema.String.annotate({ description: "Such as workspace, togglespecialworkspace or exec" }),
        argument: Schema.optionalKey(Schema.String),
      }),
      resource: (input) => input.dispatcher,
      summary: (input) => `hyprctl dispatch ${input.dispatcher} ${input.argument ?? ""}`.trim(),
      run: (input) =>
        hyprctl(["dispatch", input.dispatcher, ...(input.argument === undefined ? [] : [input.argument])]),
    }),
    listing("clients", "clients", "List every window with its workspace, position, size and properties."),
    listing("binds", "binds", "List every registered bind."),
    listing("config_errors", "configerrors", "List the current config errors."),
  ],
};
