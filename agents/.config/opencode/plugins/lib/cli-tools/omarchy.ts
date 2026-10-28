import { Layer, Schema } from "effect";
import { type ClientNamespace, clientTools, commandExists, runCliOutput } from "./tool";

const tool = clientTools(Layer.empty);

const Component = Schema.Literals([
  "app",
  "audio",
  "bluetooth",
  "btop",
  "helix",
  "herdr",
  "hyprctl",
  "hyprsunset",
  "opencode",
  "shell",
  "terminal",
  "tmux",
  "trackpad",
  "wifi",
  "xcompose",
]);

const pluginId = Schema.String.annotate({ description: "A plugin's id from plugin_list, such as timmo.git" });

const omarchy = (args: readonly string[], json = false) => runCliOutput("omarchy", args, { json });

/** Omarchy's component restarts and shell plugins. */
export const omarchyNamespace: ClientNamespace = {
  kind: "client",
  command: "omarchy",
  description:
    "Omarchy through its command: restart desktop components and apps, and list, add, remove, enable or disable shell plugins and bar widgets.",
  available: commandExists("omarchy"),
  tools: [
    tool({
      name: "plugin_list",
      description: "List the shell plugins Omarchy finds, with their kinds and whether each is enabled and active.",
      access: "read",
      input: Schema.Struct({}),
      run: () => omarchy(["plugin", "list", "--json"], true),
    }),
    tool({
      name: "restart",
      description:
        "Restart an Omarchy component, such as the shell, or with component app, an application by killing it and relaunching it.",
      access: "write",
      input: Schema.Struct({
        component: Component,
        app: Schema.optionalKey(Schema.String).annotate({ description: "The application to restart, for component app" }),
      }),
      resource: (input) => (input.component === "app" ? `app ${input.app ?? ""}`.trim() : input.component),
      summary: (input) => `omarchy restart ${input.component} ${input.app ?? ""}`.trim(),
      run: (input) =>
        omarchy(["restart", input.component, ...(input.component === "app" && input.app ? [input.app] : [])]),
    }),
    tool({
      name: "plugin_add",
      description: "Add a shell plugin from a Git URL, optionally enabling it.",
      access: "write",
      timeout: "5 minutes",
      input: Schema.Struct({ url: Schema.String, enable: Schema.optionalKey(Schema.Boolean) }),
      resource: (input) => input.url,
      summary: (input) => `omarchy plugin add ${input.url}${input.enable ? " --enable" : ""}`,
      run: (input) => omarchy(["plugin", "add", input.url, ...(input.enable ? ["--enable"] : []), "--yes"]),
    }),
    tool({
      name: "plugin_remove",
      description: "Remove an installed shell plugin.",
      access: "write",
      input: Schema.Struct({ id: pluginId }),
      resource: (input) => input.id,
      summary: (input) => `omarchy plugin remove ${input.id}`,
      run: (input) => omarchy(["plugin", "remove", input.id, "--yes"]),
    }),
    tool({
      name: "plugin_enable",
      description: "Enable a shell plugin, optionally in a bar section.",
      access: "write",
      input: Schema.Struct({
        id: pluginId,
        section: Schema.optionalKey(
          Schema.Literals(["left", "centerBegin", "center", "centerEnd", "tray", "right"]),
        ).annotate({ description: "The bar section for a bar widget" }),
      }),
      resource: (input) => input.id,
      summary: (input) => `omarchy plugin enable ${input.id} ${input.section ?? ""}`.trim(),
      run: (input) =>
        omarchy(["plugin", "enable", input.id, ...(input.section === undefined ? [] : ["--section", input.section])]),
    }),
    tool({
      name: "plugin_disable",
      description: "Disable a shell plugin.",
      access: "write",
      input: Schema.Struct({ id: pluginId }),
      resource: (input) => input.id,
      summary: (input) => `omarchy plugin disable ${input.id}`,
      run: (input) => omarchy(["plugin", "disable", input.id]),
    }),
  ],
};
