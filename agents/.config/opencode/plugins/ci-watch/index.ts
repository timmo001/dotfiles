/**
 * @file Follows the Herdr Workflow Watch state for the session's checkout. Failures only reach the model when the user sends them.
 */

import { Plugin } from "@opencode/plugin/effect";
import { Effect, Fiber, Schedule, Schema, Semaphore, Stream } from "effect";
import { debugLog, type DebugFields } from "../lib/debug";
import { runText } from "../lib/process";
import { metadataUpdates, snapshot, type Snapshot } from "./herdr";
import { type CiState, type CiStatus, CiWatchRpc, Failures, noStatus } from "./rpc";

const PLUGIN_ID = "timmo.workflow-watch";

const STATE_TOKEN = "timmo_workflow_watch_state";

const PluginList = Schema.fromJsonString(
  Schema.Struct({
    result: Schema.Struct({
      plugins: Schema.Array(Schema.Struct({ plugin_id: Schema.String, plugin_root: Schema.String })),
    }),
  }),
);

type Token =
  | { readonly state: Exclude<CiState, "none" | "loading" | "unavailable" | "failure">; readonly sha: string }
  | { readonly state: "failure"; readonly sha: string; readonly fingerprint: string }
  | { readonly state: "loading" | "unavailable" };

// See the Integrations section of the herdr-workflow-watch README.
const parse = (value: string | undefined): Token | null => {
  const [version, state, sha, fingerprint] = (value ?? "").split(" ");

  if (version !== "v1") return null;

  if (state === "loading" || state === "unavailable") return { state };

  if (!sha) return null;

  if (state === "failure") return fingerprint ? { state, sha, fingerprint } : null;

  if (state === "running" || state === "success" || state === "idle") return { state, sha };

  return null;
};

const inside = (root: string, path: string) => path === root || path.startsWith(`${root}/`);

export default Plugin.define({
  id: "ci-watch",
  effect: (context) =>
    Effect.gen(function* () {
      const directory = context.location.directory;
      const socket = process.env.HERDR_SOCKET_PATH;
      const lock = yield* Semaphore.make(1);
      const roots = new Map<string, string | null>();
      const matches = new Map<string, boolean>();
      let raw: string | undefined;
      let token: Token | null = null;
      let details: { readonly fingerprint: string; readonly failures: Failures } | undefined;
      let dismissed: string | undefined;
      let fetching: Fiber.Fiber<void> | undefined;
      let pluginRoot: string | undefined;

      const locked = Semaphore.withPermit(lock);
      const logged = Effect.catch((error) => Effect.logWarning(`ci-watch: ${String(error)}`));

      const debug = (message: string, data: DebugFields = {}) =>
        Effect.sync(() =>
          debugLog("ci-watch", "server", message, {
            directory,
            token: token && "fingerprint" in token ? `${token.state} ${token.fingerprint}` : (token?.state ?? null),
            dismissed: dismissed ?? null,
            ...data,
          }),
        );

      yield* debug("plugin started");
      yield* Effect.addFinalizer(() => debug("plugin stopped"));

      const root = (path: string) =>
        Effect.gen(function* () {
          const cached = roots.get(path);

          if (cached !== undefined) return cached;

          const found = yield* runText("git", ["-C", path, "rev-parse", "--show-toplevel"]).pipe(
            Effect.map((output) => output.trim() || null),
            Effect.orElseSucceed(() => null),
          );

          roots.set(path, found);

          return found;
        });

      const status = (): CiStatus => {
        if (!token) return noStatus(directory);

        if (!("sha" in token)) return { ...noStatus(directory), state: token.state };

        return {
          directory,
          state: token.state,
          sha: token.sha,
          failures: token.state === "failure" ? (details?.failures.runs.length ?? 0) : 0,
          dismissed: token.state === "failure" && token.fingerprint === dismissed,
        };
      };

      // Replaced once the RPC is registered below.
      let emit: (status: CiStatus) => Effect.Effect<void, unknown> = () => Effect.void;

      const broadcast = Effect.suspend(() => {
        const current = status();

        return Effect.andThen(
          debug("broadcast", { state: `${current.state}${current.dismissed ? " dismissed" : ""}` }),
          emit(current),
        );
      }).pipe(logged);

      const locate = Effect.gen(function* () {
        if (pluginRoot) return pluginRoot;

        const listed = yield* runText("herdr", ["plugin", "list", "--plugin", PLUGIN_ID, "--json"]).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(PluginList)),
        );

        const found = listed.result.plugins.find((plugin) => plugin.plugin_id === PLUGIN_ID)?.plugin_root;

        if (!found) return yield* Effect.fail(new Error(`Herdr plugin ${PLUGIN_ID} is not installed`));

        pluginRoot = found;

        return found;
      });

      const load = (sha: string, fingerprint: string) =>
        Effect.gen(function* () {
          const failures = yield* runText(
            "mise",
            ["exec", "--", "bun", "dist/index.js", "failures", "--cwd", directory, "--json"],
            { cwd: yield* locate },
          ).pipe(Effect.flatMap(Schema.decodeUnknownEffect(Schema.fromJsonString(Failures))));

          yield* Effect.gen(function* () {
            // The branch moved on; the next token update brings the new commit.
            if (token?.state !== "failure" || token.fingerprint !== fingerprint || failures.sha !== sha) return;

            details = { fingerprint, failures };
            yield* broadcast;
          }).pipe(locked);
        }).pipe(logged);

      const apply = (value: string | undefined) =>
        Effect.gen(function* () {
          if (value === raw) return;

          yield* debug("token changed", { previous: raw ?? null, next: value ?? null });

          raw = value;
          token = parse(value);

          if (token?.state === "failure") {
            if (details?.fingerprint !== token.fingerprint) {
              details = undefined;

              if (fetching) yield* Fiber.interrupt(fetching);

              fetching = yield* Effect.forkScoped(load(token.sha, token.fingerprint));
            }
          } else {
            details = undefined;

            if (fetching) yield* Fiber.interrupt(fetching);

            fetching = undefined;
          }

          yield* broadcast;
        }).pipe(locked, logged);

      // Mirrors the watcher's checkout choice: worktree path, else the first pane's cwd.
      const refresh = (current: Snapshot) =>
        Effect.gen(function* () {
          const own = yield* root(directory);

          matches.clear();

          for (const workspace of current.workspaces) {
            const checkout =
              workspace.worktree?.checkout_path ??
              current.panes.find((pane) => pane.workspace_id === workspace.workspace_id)?.cwd;

            const found = checkout ? yield* root(checkout) : null;

            matches.set(workspace.workspace_id, Boolean(own && found && inside(own, found)));
          }

          return current.workspaces.find((workspace) => matches.get(workspace.workspace_id));
        });

      const follow = (path: string) =>
        Effect.gen(function* () {
          const initial = yield* refresh(yield* snapshot(path));

          yield* apply(initial?.tokens?.[STATE_TOKEN]);

          yield* metadataUpdates(path).pipe(
            Stream.runForEach((workspace) =>
              Effect.gen(function* () {
                if (!matches.has(workspace.workspace_id)) yield* refresh(yield* snapshot(path));

                if (matches.get(workspace.workspace_id)) yield* apply(workspace.tokens?.[STATE_TOKEN]);
              }),
            ),
          );

          return yield* Effect.fail(new Error("Herdr closed the event stream"));
        }).pipe(
          Effect.tapError((error) => Effect.andThen(Effect.logWarning(`ci-watch: ${String(error)}`), apply(undefined))),
          Effect.retry(Schedule.spaced("10 seconds")),
        );

      const registration = yield* context.rpc
        .register(CiWatchRpc, {
          status: () =>
            Effect.sync(status).pipe(Effect.tap((result) => debug("status call", { result }))),
          details: () =>
            Effect.succeed(token?.state === "failure" && details?.fingerprint === token.fingerprint ? details.failures : null),
          dismiss: () =>
            Effect.gen(function* () {
              yield* debug("dismiss call");

              if (token?.state === "failure") dismissed = token.fingerprint;

              yield* broadcast;

              return null;
            }).pipe(locked, logged, Effect.as(null)),
        })
        .pipe(Effect.orDie);

      emit = (status) => registration.events.emit("status", status);

      if (socket) yield* Effect.forkScoped(follow(socket));
    }),
});
