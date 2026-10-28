import {
  AgentName,
  HerdrSdk,
  herdrSdkLayerFromOptions,
  PaneId,
  TabId,
  WorkspaceId,
} from "@timmo001/effect-herdr";
import { Duration, Effect, Schema } from "effect";
import { homedir } from "node:os";
import { join } from "node:path";
import { type ClientNamespace, clientTools, pathExists } from "./tool";

const socketPath =
  process.env.HERDR_SOCKET_PATH ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), ".config"), "herdr", "herdr.sock");

const tool = clientTools(herdrSdkLayerFromOptions({ socketPath, requestTimeout: Duration.seconds(10) }));

const withHerdr = <A, E>(f: (herdr: HerdrSdk["Service"]) => Effect.Effect<A, E>) =>
  Effect.flatMap(Effect.service(HerdrSdk), f);

const paneId = PaneId.annotate({ description: "A pane ID, such as w1:p2" });
const workspaceId = WorkspaceId.annotate({ description: "A workspace ID, such as w1" });
const tabId = TabId.annotate({ description: "A tab ID, such as w1:t1" });

const agent = Schema.Union([
  Schema.Struct({ paneId: paneId }),
  Schema.Struct({ name: AgentName.annotate({ description: "The agent's assigned name" }) }),
]).annotate({ description: "The agent, by its pane ID or its assigned name" });

const source = Schema.optionalKey(
  Schema.Literals(["visible", "recent", "recent_unwrapped", "detection"]),
).annotate({
  description:
    "visible for the screen, recent for scrollback, recent_unwrapped for scrollback with wrapped lines joined (recent_unwrapped by default)",
});

const status = Schema.Literals(["idle", "working", "blocked", "done", "unknown"]);

const readInput = { source, lines: Schema.optionalKey(Schema.Int).annotate({ description: "How many lines to read" }) };

const read = (input: { readonly source?: "visible" | "recent" | "recent_unwrapped" | "detection"; readonly lines?: number }) => ({
  source: input.source ?? "recent_unwrapped",
  ...(input.lines !== undefined && { lines: input.lines }),
  stripAnsi: true,
});

const target = (input: { readonly paneId: string } | { readonly name: string }) =>
  "paneId" in input ? { paneId: input.paneId } : { name: input.name };

const describeTarget = (input: { readonly paneId: string } | { readonly name: string }) =>
  "paneId" in input ? input.paneId : input.name;

/** Herdr through its socket API: workspaces, tabs, panes, agents and worktrees. */
export const herdrNamespace: ClientNamespace = {
  kind: "client",
  command: "herdr",
  description:
    "Herdr, the terminal multiplexer for coding agents, through its socket API: list and read workspaces, tabs, panes and agents, wait on agents or pane output, and create, prompt or close them. Only close panes and workspaces you created.",
  available: pathExists(socketPath),
  tools: [
    tool({
      name: "session_snapshot",
      description: "Read the whole Herdr session at once: every workspace, tab, pane and agent.",
      access: "read",
      input: Schema.Struct({}),
      run: () => withHerdr((herdr) => herdr.session.snapshot()),
    }),
    tool({
      name: "workspace_list",
      description: "List Herdr workspaces.",
      access: "read",
      pinned: true,
      input: Schema.Struct({}),
      run: () => withHerdr((herdr) => herdr.workspaces.list()),
    }),
    tool({
      name: "tab_list",
      description: "List Herdr tabs, in one workspace or all.",
      access: "read",
      input: Schema.Struct({ workspaceId: Schema.optionalKey(workspaceId) }),
      run: (input) => withHerdr((herdr) => herdr.tabs.list(input)),
    }),
    tool({
      name: "pane_list",
      description: "List Herdr panes with their working directory and agent, in one workspace or all.",
      access: "read",
      pinned: true,
      input: Schema.Struct({ workspaceId: Schema.optionalKey(workspaceId) }),
      run: (input) => withHerdr((herdr) => herdr.panes.list(input)),
    }),
    tool({
      name: "pane_get",
      description: "Read one Herdr pane's details.",
      access: "read",
      input: Schema.Struct({ paneId }),
      run: (input) => withHerdr((herdr) => herdr.panes.get(input.paneId)),
    }),
    tool({
      name: "pane_process",
      description: "Read the foreground process running in a Herdr pane.",
      access: "read",
      input: Schema.Struct({ paneId }),
      run: (input) => withHerdr((herdr) => herdr.panes.processInfo(input.paneId)),
    }),
    tool({
      name: "pane_read",
      description: "Read a Herdr pane's output, without ANSI escapes.",
      access: "read",
      pinned: true,
      input: Schema.Struct({ paneId, ...readInput }),
      run: (input) => withHerdr((herdr) => herdr.panes.read(input.paneId, read(input))),
    }),
    tool({
      name: "pane_wait_output",
      description: "Wait until a Herdr pane's output contains a substring or matches a regular expression.",
      access: "read",
      timeout: "1 hour",
      input: Schema.Struct({
        paneId,
        source,
        match: Schema.Struct({ type: Schema.Literals(["substring", "regex"]), value: Schema.String }),
        timeoutMs: Schema.optionalKey(Schema.Int).annotate({ description: "Give up after this long" }),
      }),
      run: (input) =>
        withHerdr((herdr) =>
          herdr.panes.waitForOutput(input.paneId, {
            source: input.source ?? "recent_unwrapped",
            match: input.match,
            stripAnsi: true,
            ...(input.timeoutMs !== undefined && { timeoutMs: input.timeoutMs }),
          }),
        ),
    }),
    tool({
      name: "agent_list",
      description: "List the coding agents Herdr detects in its panes, with their status: idle, working, blocked or done.",
      access: "read",
      pinned: true,
      input: Schema.Struct({}),
      run: () => withHerdr((herdr) => herdr.agents.list()),
    }),
    tool({
      name: "agent_get",
      description: "Read one Herdr agent's details and status.",
      access: "read",
      input: Schema.Struct({ agent }),
      run: (input) => withHerdr((herdr) => herdr.agents.get(target(input.agent))),
    }),
    tool({
      name: "agent_read",
      description: "Read a Herdr agent's pane output, without ANSI escapes.",
      access: "read",
      input: Schema.Struct({ agent, ...readInput }),
      run: (input) => withHerdr((herdr) => herdr.agents.read(target(input.agent), read(input))),
    }),
    tool({
      name: "agent_wait",
      description: "Wait until a Herdr agent reaches one of the given statuses, done or idle by default.",
      access: "read",
      timeout: "2 hours",
      input: Schema.Struct({
        agent,
        until: Schema.optionalKey(Schema.Array(status)),
        timeoutMs: Schema.optionalKey(Schema.Int).annotate({ description: "Give up after this long" }),
      }),
      run: (input) =>
        withHerdr((herdr) =>
          herdr.agents.wait(target(input.agent), {
            until: input.until ?? ["done", "idle"],
            ...(input.timeoutMs !== undefined && { timeoutMs: input.timeoutMs }),
          }),
        ),
    }),
    tool({
      name: "worktree_list",
      description: "List the Git worktrees of a Herdr workspace's repository.",
      access: "read",
      input: Schema.Struct({
        workspaceId: Schema.optionalKey(workspaceId),
        cwd: Schema.optionalKey(Schema.String).annotate({ description: "An absolute path in the repository" }),
      }),
      run: (input) => withHerdr((herdr) => herdr.worktrees.list(input)),
    }),
    tool({
      name: "workspace_create",
      description: "Create a Herdr workspace in a directory, without focusing it unless asked.",
      access: "write",
      input: Schema.Struct({
        cwd: Schema.String.annotate({ description: "An absolute directory" }),
        label: Schema.optionalKey(Schema.String),
        focus: Schema.optionalKey(Schema.Boolean),
      }),
      summary: (input) => `herdr workspace create ${input.cwd}`,
      run: ({ cwd, ...options }) =>
        withHerdr((herdr) => herdr.workspaces.createInDirectory(cwd, { focus: false, ...options })),
    }),
    tool({
      name: "workspace_rename",
      description: "Rename a Herdr workspace.",
      access: "write",
      input: Schema.Struct({ workspaceId, label: Schema.String }),
      summary: (input) => `herdr workspace rename ${input.workspaceId} ${input.label}`,
      run: (input) => withHerdr((herdr) => herdr.workspaces.rename(input.workspaceId, input.label)),
    }),
    tool({
      name: "workspace_close",
      description: "Close a Herdr workspace and every pane in it. Only one you created.",
      access: "write",
      input: Schema.Struct({ workspaceId }),
      summary: (input) => `herdr workspace close ${input.workspaceId}`,
      run: (input) => withHerdr((herdr) => herdr.workspaces.close(input.workspaceId)),
    }),
    tool({
      name: "tab_create",
      description: "Create a Herdr tab, without focusing it unless asked.",
      access: "write",
      input: Schema.Struct({
        workspaceId: Schema.optionalKey(workspaceId),
        cwd: Schema.optionalKey(Schema.String).annotate({ description: "An absolute directory" }),
        label: Schema.optionalKey(Schema.String),
        focus: Schema.optionalKey(Schema.Boolean),
      }),
      summary: (input) => `herdr tab create ${input.workspaceId ?? ""} ${input.label ?? ""}`.trim(),
      run: (input) => withHerdr((herdr) => herdr.tabs.create({ focus: false, ...input })),
    }),
    tool({
      name: "tab_close",
      description: "Close a Herdr tab and its panes. Only one you created.",
      access: "write",
      input: Schema.Struct({ tabId }),
      summary: (input) => `herdr tab close ${input.tabId}`,
      run: (input) => withHerdr((herdr) => herdr.tabs.close(input.tabId)),
    }),
    tool({
      name: "pane_split",
      description: "Split a Herdr pane right or down, without focusing the new pane unless asked.",
      access: "write",
      input: Schema.Struct({
        paneId: Schema.optionalKey(paneId),
        direction: Schema.Literals(["right", "down"]),
        cwd: Schema.optionalKey(Schema.String).annotate({ description: "An absolute directory" }),
        focus: Schema.optionalKey(Schema.Boolean),
      }),
      summary: (input) => `herdr pane split ${input.paneId ?? ""} ${input.direction}`,
      run: ({ paneId, ...options }) =>
        withHerdr((herdr) => herdr.panes.split(paneId, { focus: false, ...options })),
    }),
    tool({
      name: "pane_rename",
      description: "Label a Herdr pane, or clear its label with null.",
      access: "write",
      input: Schema.Struct({ paneId, label: Schema.NullOr(Schema.String) }),
      summary: (input) => `herdr pane rename ${input.paneId} ${input.label ?? "(clear)"}`,
      run: (input) => withHerdr((herdr) => herdr.panes.rename(input.paneId, input.label)),
    }),
    tool({
      name: "pane_send",
      description:
        "Type text and press keys in a Herdr pane, such as text with keys [\"Enter\"] to run a command. Key names follow Herdr's, such as Enter, Escape, C-c or Up.",
      access: "write",
      input: Schema.Struct({
        paneId,
        text: Schema.optionalKey(Schema.String),
        keys: Schema.optionalKey(Schema.Array(Schema.String)),
      }),
      summary: (input) => `herdr pane send ${input.paneId} ${JSON.stringify(input.text ?? "")} ${(input.keys ?? []).join(" ")}`,
      run: ({ paneId, text, keys }) =>
        withHerdr((herdr) =>
          herdr.panes.sendInput(paneId, text === undefined ? { keys: keys ?? [] } : { text, ...(keys && { keys }) }),
        ),
    }),
    tool({
      name: "pane_close",
      description: "Close a Herdr pane. Only one you created.",
      access: "write",
      input: Schema.Struct({ paneId }),
      summary: (input) => `herdr pane close ${input.paneId}`,
      run: (input) => withHerdr((herdr) => herdr.panes.close(input.paneId)),
    }),
    tool({
      name: "agent_start",
      description: "Start a named coding agent, such as opencode or claude, in a Herdr pane.",
      access: "write",
      input: Schema.Struct({
        name: AgentName.annotate({ description: "A name to address the agent by" }),
        kind: Schema.String.annotate({ description: "The agent to run, such as opencode, claude or pi" }),
        paneId,
        args: Schema.optionalKey(Schema.Array(Schema.String)),
      }),
      summary: (input) => `herdr agent start ${input.name} ${input.kind} in ${input.paneId}`,
      run: (input) => withHerdr((herdr) => herdr.agents.start(input)),
    }),
    tool({
      name: "agent_prompt",
      description: "Send a prompt to a Herdr agent, and optionally wait for it to reach a status.",
      access: "write",
      timeout: "2 hours",
      input: Schema.Struct({
        agent,
        text: Schema.String,
        until: Schema.optionalKey(Schema.Array(status)).annotate({ description: "Wait until one of these statuses" }),
        timeoutMs: Schema.optionalKey(Schema.Int),
      }),
      summary: (input) => `herdr agent prompt ${describeTarget(input.agent)}`,
      run: (input) =>
        withHerdr((herdr) =>
          herdr.agents.prompt(target(input.agent), {
            text: input.text,
            ...(input.until !== undefined && {
              wait: { until: input.until, ...(input.timeoutMs !== undefined && { timeoutMs: input.timeoutMs }) },
            }),
          }),
        ),
    }),
    tool({
      name: "agent_rename",
      description: "Name a Herdr agent, or clear its name with null.",
      access: "write",
      input: Schema.Struct({ agent, name: Schema.NullOr(AgentName) }),
      summary: (input) => `herdr agent rename ${describeTarget(input.agent)} ${input.name ?? "(clear)"}`,
      run: (input) => withHerdr((herdr) => herdr.agents.rename(target(input.agent), input.name)),
    }),
    tool({
      name: "notify",
      description: "Show a notification in Herdr.",
      access: "write",
      input: Schema.Struct({
        title: Schema.String,
        body: Schema.optionalKey(Schema.String),
        sound: Schema.optionalKey(Schema.Literals(["none", "done", "request"])),
      }),
      summary: (input) => `herdr notify ${input.title}`,
      run: (input) => withHerdr((herdr) => herdr.notifications.show(input)),
    }),
    tool({
      name: "worktree_create",
      description: "Create a Git worktree and a Herdr workspace in it.",
      access: "write",
      input: Schema.Struct({
        cwd: Schema.String.annotate({ description: "An absolute path in the repository" }),
        branch: Schema.optionalKey(Schema.String),
        base: Schema.optionalKey(Schema.String),
        label: Schema.optionalKey(Schema.String),
        focus: Schema.optionalKey(Schema.Boolean),
      }),
      summary: (input) => `herdr worktree create ${input.cwd} ${input.branch ?? ""}`.trim(),
      run: (input) => withHerdr((herdr) => herdr.worktrees.create({ focus: false, ...input })),
    }),
    tool({
      name: "worktree_remove",
      description: "Remove a worktree workspace and its Git worktree. Only one you created.",
      access: "write",
      input: Schema.Struct({ workspaceId }),
      summary: (input) => `herdr worktree remove ${input.workspaceId}`,
      run: (input) => withHerdr((herdr) => herdr.worktrees.remove(input.workspaceId)),
    }),
  ],
};
