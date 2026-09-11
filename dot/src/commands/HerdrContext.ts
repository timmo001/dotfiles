import { NodeStream } from "@effect/platform-node";
import {
  HerdrEvent,
  HerdrSdk,
  HerdrTransport,
  herdrConfigLayerFromOptions,
  herdrSdkLayerFromOptions,
  herdrTransportLayerWithoutDependencies,
} from "@herdr/sdk";
import {
  Duration,
  Effect,
  Layer,
  Option,
  Queue,
  Ref,
  Schedule,
  Schema,
  Stream,
} from "effect";
import { basename, join } from "node:path";
import { localHerdrAttachment } from "../lib/herdrAttachment.js";
import { CONFIG_DIR } from "../lib/paths.js";
import { formatCause } from "../lib/schema.js";
import { CommandExecutor } from "../services/CommandExecutor.js";

/** JSON contract shared by attached-workspace consumers. */
export const HerdrContext = Schema.Struct({
  attached: Schema.Boolean,
  session: Schema.Struct({
    name: Schema.NullOr(Schema.String),
    socketPath: Schema.String,
  }),
  workspace: Schema.NullOr(
    Schema.Struct({ id: Schema.String, label: Schema.String }),
  ),
  tab: Schema.NullOr(
    Schema.Struct({ id: Schema.String, label: Schema.String }),
  ),
  pane: Schema.NullOr(
    Schema.Struct({
      id: Schema.String,
      agent: Schema.NullOr(Schema.String),
      status: Schema.String,
    }),
  ),
  cwd: Schema.NullOr(Schema.String),
  repository: Schema.NullOr(
    Schema.Struct({
      name: Schema.String,
      path: Schema.String,
      branch: Schema.NullOr(Schema.String),
    }),
  ),
});

/** Decoded attached-session context, with null fields when no client is attached. */
export type HerdrContext = typeof HerdrContext.Type;

/** Collect context only while a local terminal client is attached. */
export const readHerdrContext = Effect.fn("readHerdrContext")(function* () {
  const sdk = yield* HerdrSdk;
  const executor = yield* CommandExecutor;

  const empty: HerdrContext = {
    attached: false,
    session: {
      name:
        Option.getOrNull(sdk.config.session) ??
        (sdk.config.socketPath === join(CONFIG_DIR, "herdr", "herdr.sock")
          ? "default"
          : null),
      socketPath: sdk.config.socketPath,
    },
    workspace: null,
    tab: null,
    pane: null,
    cwd: null,
    repository: null,
  };

  if (!(yield* localHerdrAttachment(sdk.config.socketPath))) return empty;
  const snapshot = yield* sdk.session.snapshot();

  const pane = snapshot.panes.find(
    (value) => value.id === Option.getOrNull(snapshot.focusedPaneId),
  );

  const workspace = snapshot.workspaces.find(
    (value) => value.id === pane?.workspaceId,
  );

  const tab = snapshot.tabs.find((value) => value.id === pane?.tabId);

  const cwd = pane
    ? Option.getOrNull(Option.orElse(pane.foregroundCwd, () => pane.cwd))
    : null;

  let repository: HerdrContext["repository"] = null;

  if (cwd) {
    const path = yield* executor
      .run("git", ["rev-parse", "--show-toplevel"], {
        cwd,
        env: { LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0" },
      })
      .pipe(
        Effect.catchTag("CommandError", (error) =>
          /not a git repository/.test(error.stderr)
            ? Effect.succeed(null)
            : Effect.fail(error),
        ),
      );

    if (path) {
      const branch = yield* executor
        .run("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], {
          cwd,
          env: { LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0" },
        })
        .pipe(
          Effect.catchTag("CommandError", (error) =>
            error.exitCode === 1 ? Effect.succeed(null) : Effect.fail(error),
          ),
        );

      repository = {
        name: basename(path.trim()),
        path: path.trim(),
        branch: branch?.trim() || null,
      };
    }
  }

  if (!(yield* localHerdrAttachment(sdk.config.socketPath))) return empty;

  return {
    ...empty,
    attached: true,
    workspace: workspace ? { id: workspace.id, label: workspace.label } : null,
    tab: tab ? { id: tab.id, label: tab.label } : null,
    pane: pane
      ? {
          id: pane.id,
          agent: Option.getOrNull(pane.agent),
          status: pane.agentStatus,
        }
      : null,
    cwd,
    repository,
  };
});

/** Render context for people, or one JSON object for panel consumers. */
export function formatHerdrContext(
  context: HerdrContext,
  json: boolean,
): string {
  if (json) return JSON.stringify(context);

  if (!context.attached) return "No attached Herdr terminal";

  return [
    `Herdr: attached (${context.session.name ?? context.session.socketPath})`,
    `Workspace: ${context.workspace ? `${context.workspace.label} (${context.workspace.id})` : "unavailable"}`,
    `Tab: ${context.tab ? `${context.tab.label} (${context.tab.id})` : "unavailable"}`,
    `Pane: ${context.pane ? `${context.pane.id} · ${context.pane.agent ?? "shell"} · ${context.pane.status}` : "unavailable"}`,
    `Directory: ${context.cwd ?? "unavailable"}`,
    ...(context.repository
      ? [
          `Repository: ${context.repository.path}`,
          `Branch: ${context.repository.branch ?? "detached HEAD"}`,
        ]
      : []),
  ].join("\n");
}

class HerdrContextDisconnected extends Schema.TaggedError<HerdrContextDisconnected>()(
  "HerdrContextDisconnected",
  { message: Schema.String },
) {}

function contextEvent(
  event: HerdrEvent,
  context: HerdrContext | null,
): boolean {
  switch (event.type) {
    case "workspace.focused":
    case "tab.focused":
    case "pane.focused":
      return true;
    case "workspace.renamed":
    case "workspace.closed":
      return event.workspaceId === context?.workspace?.id;
    case "tab.renamed":
    case "tab.closed":
    case "tab.moved":
      return event.tabId === context?.tab?.id;
    case "pane.closed":
      return event.paneId === context?.pane?.id;
    case "pane.moved":
      return event.previousPaneId === context?.pane?.id || event.pane.focused;
    case "pane.updated":
      return (
        (event.pane.id === context?.pane?.id ||
          (!context?.pane && event.pane.focused)) &&
        (Option.getOrNull(
          Option.orElse(event.pane.foregroundCwd, () => event.pane.cwd),
        ) !== context?.cwd ||
          Option.getOrNull(event.pane.agent) !== context?.pane?.agent)
      );
    default:
      return false;
  }
}

/** Publish attached context from one event subscription, with slow reconciliation. */
export const watchHerdrContext = Effect.fn("watchHerdrContext")(function* (
  emit: (context: HerdrContext | null) => Effect.Effect<void>,
  refreshes: Stream.Stream<void> = Stream.never,
) {
  const transport = yield* HerdrTransport;
  const lastJson = yield* Ref.make<string | undefined>(undefined);

  const publish = Effect.fn("watchHerdrContext.publish")(function* (
    context: HerdrContext | null,
    force = false,
  ) {
    const json = JSON.stringify(context);

    if (!force && json === (yield* Ref.get(lastJson))) return;
    yield* emit(context);
    yield* Ref.set(lastJson, json);
  });

  const connect = Effect.scoped(
    Effect.gen(function* () {
      const connection = yield* transport.openStream("events.subscribe", {
        subscriptions: [
          { type: "workspace.focused" },
          { type: "workspace.renamed" },
          { type: "workspace.closed" },
          { type: "tab.focused" },
          { type: "tab.renamed" },
          { type: "tab.closed" },
          { type: "tab.moved" },
          { type: "pane.focused" },
          { type: "pane.closed" },
          { type: "pane.moved" },
          { type: "pane.updated" },
        ],
      });

      const current = yield* Ref.make<HerdrContext | null>(null);
      const generation = yield* Ref.make(0);
      const forced = yield* Ref.make(false);
      const pending = yield* Queue.sliding<number>(1);

      const request = Effect.fn("watchHerdrContext.request")(function* (
        force = false,
      ) {
        if (force) yield* Ref.set(forced, true);

        const next = yield* Ref.updateAndGet(generation, (value) => value + 1);
        yield* Queue.offer(pending, next);
      });

      const listen = connection.readBytes.pipe(
        Stream.decodeText(),
        Stream.splitLines,
        Stream.filter((line) => line.trim() !== ""),
        Stream.mapEffect((line) =>
          Schema.decodeEffect(
            Schema.fromJsonString(Schema.Struct({ data: HerdrEvent })),
          )(line),
        ),
        Stream.runForEach(({ data }) =>
          Effect.gen(function* () {
            if (contextEvent(data, yield* Ref.get(current))) yield* request();
          }),
        ),
        Effect.andThen(
          Effect.fail(
            new HerdrContextDisconnected({
              message: "Herdr event stream closed",
            }),
          ),
        ),
      );

      const collect = Stream.fromQueue(pending).pipe(
        Stream.debounce("100 millis"),
        Stream.runForEach((requestGeneration) =>
          Effect.gen(function* () {
            const context = yield* readHerdrContext().pipe(
              Effect.timeout("2 seconds"),
              Effect.catch((error) =>
                Effect.sync(() => {
                  console.error(`dot herdr context: ${formatCause(error)}`);

                  return null;
                }),
              ),
            );

            if (requestGeneration !== (yield* Ref.get(generation))) return;
            yield* Ref.set(current, context);
            yield* publish(context, yield* Ref.getAndSet(forced, false));
          }),
        ),
      );

      yield* Effect.all(
        [
          listen,
          refreshes.pipe(Stream.runForEach(() => request(true))),
          request().pipe(Effect.repeat(Schedule.spaced("30 seconds"))),
          collect,
        ],
        { concurrency: "unbounded", discard: true },
      );
    }),
  );

  yield* connect.pipe(
    Effect.tapError((error) =>
      Effect.gen(function* () {
        console.error(`dot herdr context: ${formatCause(error)}`);
        yield* publish(null);
      }),
    ),
    Effect.retry(
      Schedule.exponential("1 second").pipe(
        Schedule.modifyDelay(({ duration }) =>
          Effect.succeed(Duration.min(duration, Duration.seconds(30))),
        ),
      ),
    ),
  );
});

/** Run the readable or JSON context command using explicit or standard SDK session selection. */
export const herdrContext = Effect.fn("herdrContext")(
  function* (options: {
    readonly json: boolean;
    readonly session?: string;
    readonly watch?: boolean;
  }) {
    const sdkOptions =
      options.session === "default"
        ? {
            socketPath: join(
              process.env.HERDR_CONFIG_DIR || CONFIG_DIR + "/herdr",
              "herdr.sock",
            ),
          }
        : options.session
          ? { session: options.session }
          : {};

    if (options.watch) {
      yield* watchHerdrContext(
        (context) =>
          Effect.sync(() => {
            console.log(JSON.stringify(context));
          }),
        NodeStream.fromReadable({
          evaluate: () => process.stdin,
          closeOnDone: false,
        }).pipe(
          Stream.decodeText(),
          Stream.splitLines,
          Stream.filter((line) => line.trim() === "refresh"),
          Stream.map(() => undefined),
          Stream.catch((error) => {
            console.error(`dot herdr context input: ${formatCause(error)}`);

            return Stream.empty;
          }),
        ),
      ).pipe(
        Effect.provide(
          Layer.merge(
            herdrSdkLayerFromOptions(sdkOptions),
            herdrTransportLayerWithoutDependencies.pipe(
              Layer.provide(herdrConfigLayerFromOptions(sdkOptions)),
            ),
          ),
        ),
      );

      return;
    }

    const context = yield* readHerdrContext().pipe(
      Effect.provide(herdrSdkLayerFromOptions(sdkOptions)),
      Effect.timeout("2 seconds"),
    );

    console.log(formatHerdrContext(context, options.json));
  },
  Effect.catch((error) =>
    Effect.sync(() => {
      console.error(`dot herdr context: ${formatCause(error)}`);
      process.exitCode = 1;
    }),
  ),
);
