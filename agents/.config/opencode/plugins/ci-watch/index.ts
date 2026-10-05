/**
 * @file Follows the Herdr Workflow Watch state for the session's checkout. Failures only reach the model when the user sends them.
 */

import type { OpenCodeClient } from "@opencode/client/effect";
import { Plugin } from "@opencode/plugin/effect";
import { Session } from "@opencode/schema/session";
import { Clock, DateTime, Effect, Fiber, Predicate, Schedule, Schema, Semaphore, Stream } from "effect";
import { debugLog, type DebugFields } from "../lib/debug";
import { runText } from "../lib/process";
import { connectClient, discoverService } from "../lib/service";
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
      // Top-level sessions in this directory, by when they were last active.
      const sessions = new Map<Session.ID, number>();
      const ignored = new Set<string>();
      const roots = new Map<string, string | null>();
      const matches = new Map<string, boolean>();
      let raw: string | undefined;
      let token: Token | null = null;
      let details: { readonly fingerprint: string; readonly failures: Failures } | undefined;
      let dismissed: string | undefined;
      let fetching: Fiber.Fiber<void> | undefined;
      let pluginRoot: string | undefined;
      let client: OpenCodeClient | undefined;

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
      yield* Effect.addFinalizer(() => debug("plugin stopped", { sessions: sessions.size }));

      const getClient = Effect.gen(function* () {
        if (client) return client;

        const endpoint = yield* discoverService();

        if (!endpoint) return yield* Effect.fail(new Error("OpenCode service not found"));

        client = yield* connectClient(endpoint);

        return client;
      });

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

      const status = (sessionID: string): CiStatus => {
        if (!token) return noStatus(sessionID);

        if (!("sha" in token)) return { ...noStatus(sessionID), state: token.state };

        return {
          sessionID,
          state: token.state,
          sha: token.sha,
          failures: token.state === "failure" ? (details?.failures.runs.length ?? 0) : 0,
          dismissed: token.state === "failure" && token.fingerprint === dismissed,
        };
      };

      // Replaced once the RPC is registered below.
      let emit: (status: CiStatus) => Effect.Effect<void, unknown> = () => Effect.void;

      const broadcast = Effect.suspend(() =>
        Effect.andThen(
          debug("broadcast", {
            sessions: [...sessions.keys()].map((sessionID) => {
              const current = status(sessionID);

              return `${sessionID} ${current.state}${current.dismissed ? " dismissed" : ""}`;
            }),
          }),
          Effect.forEach([...sessions.keys()], (sessionID) => emit(status(sessionID)), { discard: true }),
        ),
      ).pipe(logged);

      // Only sessions opened here get CI status; execution events reach every loaded copy of this plugin.
      const track = (id: string) =>
        Effect.gen(function* () {
          if (ignored.has(id)) return;

          const sessionID = yield* Schema.decodeUnknownEffect(Session.ID)(id);

          if (!sessions.has(sessionID)) {
            const session = yield* context.session
              .get({ sessionID })
              .pipe(
                Effect.catchIf(
                  (error) => Predicate.isTagged(error, "Session.NotFoundError"),
                  () => Effect.succeed(null),
                ),
              );

            if (!session || session.parentID || session.location.directory !== directory) {
              ignored.add(id);

              return;
            }
          }

          sessions.set(sessionID, yield* Clock.currentTimeMillis);
        });

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
          status: (input) =>
            track(input.sessionID).pipe(
              locked,
              logged,
              Effect.map(() => status(input.sessionID)),
              Effect.tap((result) =>
                debug("status call", {
                  sessionID: input.sessionID,
                  tracked: [...sessions.keys()].some((id) => id === input.sessionID),
                  ignored: ignored.has(input.sessionID),
                  result,
                }),
              ),
            ),
          details: () =>
            Effect.succeed(token?.state === "failure" && details?.fingerprint === token.fingerprint ? details.failures : null),
          dismiss: (input) =>
            Effect.gen(function* () {
              yield* debug("dismiss call", {
                sessionID: input.sessionID,
                tracked: [...sessions.keys()].some((id) => id === input.sessionID),
                ignored: ignored.has(input.sessionID),
                sessions: sessions.size,
              });

              if (token?.state === "failure") dismissed = token.fingerprint;

              yield* broadcast;

              return null;
            }).pipe(locked, logged, Effect.as(null)),
        })
        .pipe(Effect.orDie);

      emit = (status) => registration.events.emit("status", status);

      // A reload or service restart starts empty, and open TUIs only register once.
      yield* Effect.gen(function* () {
        const api = yield* getClient;
        const listed = yield* api.session.list({ directory, parentID: null, order: "desc", limit: 20 });

        for (const session of listed.data) {
          if (session.parentID || session.time.archived || session.location.directory !== directory) continue;

          sessions.set(session.id, DateTime.toEpochMillis(session.time.updated));
        }

        yield* debug("sessions rebuilt", { sessions: [...sessions.keys()] });
      }).pipe(locked, logged);

      if (socket) yield* Effect.forkScoped(follow(socket));

      yield* context.event.subscribe().pipe(
        Stream.runForEach((event) =>
          event.type === "session.execution.started"
            ? track(event.data.sessionID).pipe(locked, logged)
            : Effect.void,
        ),
        Effect.orDie,
        Effect.forkScoped,
      );
    }),
});
