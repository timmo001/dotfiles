import { expect, test } from "bun:test";
import { Effect, FileSystem, Schema } from "../../dot/node_modules/effect/dist/index.js";
import { HerdrSdk, herdrSdkLayerFromOptions, SessionSnapshot } from "../../dot/node_modules/@herdr/sdk/src/index.ts";
import { formatHerdrContext, HerdrContext, readHerdrContext } from "../../dot/src/commands/HerdrContext.js";
import { CommandError, CommandExecutor } from "../../dot/src/services/CommandExecutor.js";

const socketPath = "/fixture/with spaces/herdr.sock";

const clientSocket = "/fixture/with spaces/herdr-client.sock";

async function collect(options: {
  attached?: boolean;
  peer?: string;
  args?: string[];
  foreground?: boolean;
  detachAfterSnapshot?: boolean;
  foregroundCwd?: string | null;
  paneCwd?: string | null;
  focusedPane?: string | null;
  git?: boolean;
  branch?: string | null;
  failProbe?: boolean;
  disappear?: boolean;
} = {}) {
  const calls: string[] = [];
  let snapshotRead = false;

  const snapshot = Schema.decodeUnknownSync(SessionSnapshot)({
    version: "0.9.0", protocol: 22,
    focused_workspace_id: "w1", focused_tab_id: "w1:t1",
    focused_pane_id: options.focusedPane === undefined ? "w1:p1" : options.focusedPane,
    workspaces: [{ workspace_id: "w1", active_tab_id: "w1:t1", label: "Project", number: 1, pane_count: 1, tab_count: 1, agent_status: "idle", focused: true }],
    tabs: [{ tab_id: "w1:t1", workspace_id: "w1", label: "Editor", number: 1, pane_count: 1, agent_status: "idle", focused: true }],
    panes: [{ pane_id: "w1:p1", tab_id: "w1:t1", workspace_id: "w1", terminal_id: "terminal-1", revision: 0, focused: true, agent_status: "idle", agent: "opencode",
      cwd: options.paneCwd === undefined ? "/fixture/shell" : options.paneCwd,
      foreground_cwd: options.foregroundCwd === undefined ? "/fixture/worktree/src" : options.foregroundCwd }],
    layouts: [], agents: [],
  });

  const executor = CommandExecutor.of({
    run: (command, args, input) => Effect.suspend(() => {
      calls.push(`${command} ${args.join(" ")}`);

      if (command === "ss") {
        expect(args.at(-1)).toBe(clientSocket);

        if (options.failProbe) return Effect.fail(new CommandError({ command, exitCode: 2, stderr: "probe failed" }));

        return Effect.succeed(options.attached === false || (snapshotRead && options.detachAfterSnapshot)
          ? "" : `u_str ESTAB 0 0 ${clientSocket} 100 * 200\n`);
      }

      if (command === "ps") return Effect.succeed(`42 42 ${options.foreground === false ? 55 : 42} ${process.getuid?.()} pts/7\n`);
      expect(command).toBe("git");
      expect(input?.cwd).toBe(options.foregroundCwd ?? options.paneCwd ?? "/fixture/worktree/src");
      expect(input?.env?.GIT_OPTIONAL_LOCKS).toBe("0");

      if (options.git === false) return Effect.fail(new CommandError({ command, exitCode: 128, stderr: "fatal: not a git repository" }));

      if (args[0] === "rev-parse") return Effect.succeed("/fixture/worktree\n");
      expect(args).toEqual(["symbolic-ref", "--quiet", "--short", "HEAD"]);

      return options.branch === null
        ? Effect.fail(new CommandError({ command, exitCode: 1, stderr: "" }))
        : Effect.succeed(options.branch ?? "topic\n");
    }),
    exitCode: () => Effect.die("Unexpected command"),
    inherit: () => Effect.die("Unexpected command"),
    stream: () => { throw new Error("Unexpected command"); },
  });

  const program = Effect.gen(function* () {
    const sdk = yield* HerdrSdk;

    return yield* readHerdrContext().pipe(Effect.provideService(HerdrSdk, {
      ...sdk,
      session: { snapshot: () => Effect.sync(() => {
        calls.push("snapshot");
        snapshotRead = true;

        return snapshot;
      }) },
    }));
  });

  const context = await Effect.runPromise(program.pipe(
    Effect.provide(herdrSdkLayerFromOptions({ socketPath })),
    Effect.provideService(CommandExecutor, executor),
    Effect.provide(FileSystem.layerNoop({
      readLink: path => options.disappear ? FileSystem.makeNoop({}).readLink(path)
        : Effect.succeed(path.endsWith("/exe") ? "/usr/bin/herdr" : `socket:[${options.peer ?? "200"}]`),
      readFileString: () => Effect.succeed((options.args ?? ["herdr", "session", "attach", "default"]).join("\0") + "\0"),
      readDirectory: () => Effect.succeed(["4"]),
    })),
  ));

  expect(Schema.is(HerdrContext)(context)).toBe(true);

  return { context, calls };
}

test.each([
  { attached: false },
  { peer: "999" },
  { foreground: false },
  { args: ["herdr", "server"] },
  { args: ["herdr", "api", "snapshot"] },
  { args: ["herdr", "--remote", "host"] },
  { args: ["herdr", "terminal", "observe", "terminal-1"] },
  { disappear: true },
])("does not expose retained focus without a matching attached client: %j", async options => {
  const { context, calls } = await collect(options);
  expect(context).toMatchObject({ attached: false, cwd: null, repository: null, workspace: null, pane: null, tab: null });
  expect(calls).not.toContain("snapshot");
  expect(formatHerdrContext(context, false)).toBe("No attached Herdr terminal");
});

test.each([["herdr"], ["herdr", "--session", "work"], ["herdr", "--session=work", "--handoff"], ["herdr", "session", "attach", "default"]])("accepts an attached local terminal: %j", async (...args) => {
  const { context } = await collect({ args });
  expect(context).toMatchObject({ attached: true, cwd: "/fixture/worktree/src", repository: { path: "/fixture/worktree", branch: "topic" } });
  expect(JSON.parse(formatHerdrContext(context, true))).toEqual(context);
  expect(formatHerdrContext(context, false)).toContain("Workspace: Project (w1)");
  expect(formatHerdrContext(context, false)).toContain("Branch: topic");
});

test("clears focus if the terminal detaches while context is collected", async () => {
  const { context, calls } = await collect({ detachAfterSnapshot: true });
  expect(calls).toContain("snapshot");
  expect(context.attached).toBe(false);
  expect(context.cwd).toBeNull();
});

test("uses the pane shell directory when the foreground cwd is absent", async () => {
  const { context } = await collect({ foregroundCwd: null, paneCwd: "/fixture/shell" });
  expect(context.cwd).toBe("/fixture/shell");
});

test("returns attachment without leaking the caller directory when focus is absent", async () => {
  const { context, calls } = await collect({ focusedPane: null });
  expect(context).toMatchObject({ attached: true, cwd: null, pane: null, repository: null });
  expect(calls.some(call => call.startsWith("git "))).toBe(false);
});

test("non-Git directories and detached HEAD still have valid Herdr context", async () => {
  expect((await collect({ git: false })).context).toMatchObject({ attached: true, cwd: "/fixture/worktree/src", repository: null });
  const { context } = await collect({ branch: null });
  expect(context.repository?.branch).toBeNull();
  expect(formatHerdrContext(context, false)).toContain("Branch: detached HEAD");
});

test("probe failure is an error, not a detached or cached result", async () => {
  await expect(collect({ failProbe: true })).rejects.toThrow();
});
