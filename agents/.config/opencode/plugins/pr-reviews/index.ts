/**
 * @file Polls the review threads on the pull request for the session's checkout. Threads only reach the model when the user sends them.
 */

import type { OpenCodeClient } from "@opencode/client/effect";
import { Plugin } from "@opencode/plugin/effect";
import { Session } from "@opencode/schema/session";
import { Clock, DateTime, Effect, Predicate, Schedule, Schema, Semaphore, Stream } from "effect";
import { runText } from "../lib/process";
import { connectClient, discoverService } from "../lib/service";
import { noStatus, type OpenThread, PrReviewsRpc, type ReviewsStatus } from "./rpc";

const Login = Schema.NullOr(Schema.Struct({ login: Schema.String }));

// The parts of `dot pr reviews --json` this plugin reads.
const Reviews = Schema.fromJsonString(
  Schema.Struct({
    pullRequests: Schema.Array(
      Schema.Struct({
        number: Schema.Number,
        title: Schema.String,
        url: Schema.String,
        head: Schema.String,
        botRequests: Schema.Array(Schema.String),
        threads: Schema.Array(
          Schema.Struct({
            id: Schema.String,
            isResolved: Schema.Boolean,
            isOutdated: Schema.Boolean,
            path: Schema.String,
            line: Schema.NullOr(Schema.Number),
            originalLine: Schema.NullOr(Schema.Number),
            comments: Schema.Struct({
              nodes: Schema.Array(
                Schema.Struct({
                  body: Schema.optionalKey(Schema.String),
                  url: Schema.String,
                  author: Login,
                  isMinimized: Schema.Boolean,
                }),
              ),
            }),
          }),
        ),
      }),
    ),
  }),
);

type PullRequest = (typeof Reviews.Type)["pullRequests"][number];

type Current = Omit<ReviewsStatus, "sessionID" | "dismissed">;

const empty: Current = { state: "none", number: null, title: null, url: null, threads: [], botRequests: [] };

// Matches isOpenThread in dot: neither resolved nor minimized.
const openThreads = (pr: PullRequest): OpenThread[] =>
  pr.threads.flatMap((thread) => {
    const [first] = thread.comments.nodes;

    if (thread.isResolved || first?.isMinimized) return [];

    return [
      {
        id: thread.id,
        location: `${thread.path}:${thread.line ?? thread.originalLine ?? "?"}${thread.isOutdated ? " (outdated)" : ""}`,
        url: first?.url ?? pr.url,
        comments: thread.comments.nodes.map((comment) => ({
          author: comment.author?.login ?? "ghost",
          body: comment.body ?? "",
          url: comment.url,
        })),
      },
    ];
  });

const toCurrent = (pr: PullRequest | null): Current => {
  if (!pr) return empty;

  const threads = openThreads(pr);

  return {
    state: threads.length ? "open" : pr.botRequests.length ? "requested" : "clear",
    number: pr.number,
    title: pr.title,
    url: pr.url,
    threads,
    botRequests: pr.botRequests,
  };
};

// Changes when a thread opens or closes, or gets a new reply.
const threadPrint = (current: Current) =>
  current.threads.map((thread) => `${thread.id}/${thread.comments.length}`).join(",");

export default Plugin.define({
  id: "pr-reviews",
  effect: (context) =>
    Effect.gen(function* () {
      const directory = context.location.directory;
      const lock = yield* Semaphore.make(1);
      // Top-level sessions in this directory, by when they were last active.
      const sessions = new Map<Session.ID, number>();
      const ignored = new Set<string>();
      let current = empty;
      let print = "";
      let dismissed: string | undefined;
      let client: OpenCodeClient | undefined;

      const locked = Semaphore.withPermit(lock);
      const logged = Effect.catch((error) => Effect.logWarning(`pr-reviews: ${String(error)}`));

      const getClient = Effect.gen(function* () {
        if (client) return client;

        const endpoint = yield* discoverService();

        if (!endpoint) return yield* Effect.fail(new Error("OpenCode service not found"));

        client = yield* connectClient(endpoint);

        return client;
      });

      const status = (sessionID: string): ReviewsStatus =>
        current.state === "none"
          ? noStatus(sessionID)
          : { sessionID, ...current, dismissed: current.threads.length > 0 && threadPrint(current) === dismissed };

      // Replaced once the RPC is registered below.
      let emit: (status: ReviewsStatus) => Effect.Effect<void, unknown> = () => Effect.void;

      const broadcast = Effect.suspend(() =>
        Effect.forEach([...sessions.keys()], (sessionID) => emit(status(sessionID)), { discard: true }),
      ).pipe(logged);

      // Only sessions opened here get review status; execution events reach every loaded copy of this plugin.
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

      const poll = Effect.gen(function* () {
        if (!sessions.size) return;

        // No pull request for the branch exits 1, as does a gh failure; both hide the label until a poll works.
        const pr = yield* runText("dot", ["pr", "reviews", "--json"], { cwd: directory }).pipe(
          Effect.flatMap(Schema.decodeUnknownEffect(Reviews)),
          Effect.map((reviews) => reviews.pullRequests[0] ?? null),
          Effect.orElseSucceed(() => null),
        );

        const next = toCurrent(pr);
        const nextPrint = pr ? `${pr.number}:${pr.head}:${threadPrint(next)}:${pr.botRequests.join(",")}` : "";

        yield* Effect.gen(function* () {
          if (nextPrint === print) return;

          print = nextPrint;
          current = next;
          yield* broadcast;
        }).pipe(locked);
      }).pipe(logged);

      const registration = yield* context.rpc
        .register(PrReviewsRpc, {
          status: (input) =>
            track(input.sessionID).pipe(
              locked,
              logged,
              Effect.map(() => status(input.sessionID)),
            ),
          dismiss: () =>
            Effect.gen(function* () {
              if (current.threads.length) dismissed = threadPrint(current);

              yield* broadcast;
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
      }).pipe(locked, logged);

      yield* poll.pipe(Effect.repeat(Schedule.spaced("1 minute")), Effect.forkScoped);

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
