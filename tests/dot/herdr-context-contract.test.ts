import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { createServer, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect, Fiber, FileSystem, Layer, Queue, Schema, Stream } from "../../dot/node_modules/effect/dist/index.js";
import { HerdrSdk, herdrConfigLayerFromOptions, herdrSdkLayerFromOptions, herdrTransportLayerWithoutDependencies, SessionSnapshot } from "../../dot/node_modules/@herdr/sdk/src/index.ts";
import { formatHerdrContext, HerdrContext, readHerdrContext, watchHerdrContext } from "../../dot/src/commands/HerdrContext.js";
import { CommandError, CommandExecutor } from "../../dot/src/services/CommandExecutor.js";

const socketPath = "/fixture/with spaces/herdr.sock";

const clientSocket = "/fixture/with spaces/herdr-client.sock";

function contextFixture(options: {
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
  beforeSnapshot?: () => Effect.Effect<void>;
} = {}) {
  const calls: string[] = [];
  let snapshotRead = false;

  const snapshot = () => Schema.decodeUnknownSync(SessionSnapshot)({
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

  const provide = <A, E, R>(program: Effect.Effect<A, E, R>) => Effect.gen(function* () {
    const sdk = yield* HerdrSdk;

    return yield* program.pipe(Effect.provideService(HerdrSdk, {
      ...sdk,
      session: { snapshot: () => Effect.gen(function* () {
        calls.push("snapshot");
        snapshotRead = true;
        const value = snapshot();

        if (options.beforeSnapshot) yield* options.beforeSnapshot();

        return value;
      }) },
    }));
  }).pipe(
    Effect.provide(herdrSdkLayerFromOptions({ socketPath })),
    Effect.provideService(CommandExecutor, executor),
    Effect.provide(FileSystem.layerNoop({
      readLink: path => options.disappear ? FileSystem.makeNoop({}).readLink(path)
        : Effect.succeed(path.endsWith("/exe") ? "/usr/bin/herdr" : `socket:[${options.peer ?? "200"}]`),
      readFileString: () => Effect.succeed((options.args ?? ["herdr", "session", "attach", "default"]).join("\0") + "\0"),
      readDirectory: () => Effect.succeed(["4"]),
    })),
  );

  return { provide, calls };
}

async function collect(options: Parameters<typeof contextFixture>[0] = {}) {
  const { provide, calls } = contextFixture(options);
  const context = await Effect.runPromise(provide(readHerdrContext()));

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

const watchServer = Effect.acquireRelease(
  Effect.gen(function* () {
    const subscriptions = yield* Queue.unbounded<Socket>();
    const directory = yield* Effect.promise(() => mkdtemp(join(tmpdir(), "dot-herdr-context-")));
    const path = join(directory, "api.sock");
    const sockets = new Set<Socket>();

    const server = createServer(socket => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
      let buffer = "";
      socket.on("data", data => {
        buffer += data.toString();
        let newline: number;

        while ((newline = buffer.indexOf("\n")) >= 0) {
          const request = Schema.decodeUnknownSync(Schema.fromJsonString(Schema.Struct({ id: Schema.String, method: Schema.String })))(buffer.slice(0, newline));
          buffer = buffer.slice(newline + 1);
          expect(["ping", "events.subscribe"]).toContain(request.method);
          socket.write(JSON.stringify({ id: request.id, result: request.method === "ping"
            ? { type: "pong", version: "0.9.0", protocol: 22 }
            : { type: "subscription_started" } }) + "\n");

          if (request.method === "events.subscribe") Queue.offerUnsafe(subscriptions, socket);
        }
      });
    });

    yield* Effect.promise(() => new Promise<void>(resolve => server.listen(path, resolve)));

    return { path, subscriptions, server, sockets, directory };
  }),
  ({ server, sockets, directory }) => Effect.promise(async () => {
    for (const socket of sockets) socket.destroy();
    await new Promise<void>(resolve => server.close(() => resolve()));
    await rm(directory, { recursive: true, force: true });
  }),
);

test("watch subscribes before collecting, follows switches and closes its socket", async () => {
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const server = yield* watchServer;
    let subscribed = false;

    const options = {
      foregroundCwd: "/fixture/old",
      beforeSnapshot: () => Effect.sync(() => expect(subscribed).toBe(true)),
    };

    const { provide } = contextFixture(options);
    const output = yield* Queue.unbounded<HerdrContext | null>();
    const refreshes = yield* Queue.unbounded<void>();

    const watcher = yield* provide(watchHerdrContext(value => Queue.offer(output, value).pipe(Effect.asVoid), Stream.fromQueue(refreshes))).pipe(
      Effect.provide(herdrTransportLayerWithoutDependencies.pipe(Layer.provide(herdrConfigLayerFromOptions({ socketPath: server.path })))),
      Effect.forkChild,
    );

    const socket = yield* Queue.take(server.subscriptions);
    subscribed = true;
    expect((yield* Queue.take(output))?.cwd).toBe("/fixture/old");
    yield* Queue.offer(refreshes, undefined);
    expect((yield* Queue.take(output))?.cwd).toBe("/fixture/old");
    options.foregroundCwd = "/fixture/new";
    socket.write(JSON.stringify({ event: "pane_focused", data: { type: "pane_focused", pane_id: "w1:p1", workspace_id: "w1" } }) + "\n");
    socket.write(JSON.stringify({ event: "pane_focused", data: { type: "pane_focused", pane_id: "w1:p1", workspace_id: "w1" } }) + "\n");
    expect((yield* Queue.take(output))?.cwd).toBe("/fixture/new");
    yield* Fiber.interrupt(watcher);
    yield* Effect.promise(() => socket.closed ? Promise.resolve() : new Promise<void>(resolve => socket.once("close", resolve)));
  })));
}, 10000);

test("watch clears failed context, reconnects and observes detachment", async () => {
  await Effect.runPromise(Effect.scoped(Effect.gen(function* () {
    const server = yield* watchServer;
    const options = { attached: true, failProbe: false };
    const { provide } = contextFixture(options);
    const output = yield* Queue.unbounded<HerdrContext | null>();

    const watcher = yield* provide(watchHerdrContext(value => Queue.offer(output, value).pipe(Effect.asVoid))).pipe(
      Effect.provide(herdrTransportLayerWithoutDependencies.pipe(Layer.provide(herdrConfigLayerFromOptions({ socketPath: server.path })))),
      Effect.forkChild,
    );

    const socket = yield* Queue.take(server.subscriptions);
    expect((yield* Queue.take(output))?.attached).toBe(true);
    options.failProbe = true;
    socket.write(JSON.stringify({ event: "workspace_focused", data: { type: "workspace_focused", workspace_id: "w1" } }) + "\n");
    expect(yield* Queue.take(output)).toBeNull();
    options.failProbe = false;
    options.attached = false;
    socket.end();
    yield* Queue.take(server.subscriptions);
    expect(yield* Queue.take(output)).toMatchObject({ attached: false, cwd: null });
    yield* Fiber.interrupt(watcher);
  })));
}, 10000);
