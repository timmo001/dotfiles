import { Effect, Layer, Schema } from "effect";
import { systemBridgeNamespace } from "./system-bridge";
import { type ClientNamespace, clientTools, commandExists, runCliOutput } from "./tool";

const tool = clientTools(Layer.empty);

const hyprctl = (args: readonly string[], json = false) =>
  runCliOutput("hyprctl", json ? ["-j", ...args] : args, { json });

/** Only registered when System Bridge, whose hyprland tool covers these, isn't running. */
const withoutSystemBridge = Effect.map(systemBridgeNamespace.available, (available) => !available);

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
    "Hyprland through hyprctl, for what the system-bridge namespace doesn't cover: the version, reloading the config and running any dispatcher. Read windows, workspaces, binds and config errors with system-bridge's hyprland tool.",
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
