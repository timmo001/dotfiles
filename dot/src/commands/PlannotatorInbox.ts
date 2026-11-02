import { Effect, Schedule, Schema } from "effect";
import {
  formatCommandError,
  handleCommandError,
} from "../git/commands/rows.js";
import {
  acquireWorkspaceMutationLock,
  releaseWorkspaceMutationLock,
} from "../lib/workspaceMutationLock.js";
import { CommandExecutor } from "../services/CommandExecutor.js";

/**
 * The Inbox's web app window: a Chromium app window, whose class starts with
 * `chrome-` and comes from the host, and whose title the Inbox sets, with an
 * unread count such as "(1) " in front.
 */
const isInboxWindow = (client: HyprlandClient) =>
  client.class.startsWith("chrome-") &&
  client.title.endsWith("Plannotator Inbox");

const HyprlandClient = Schema.Struct({
  address: Schema.String,
  class: Schema.String,
  title: Schema.String,
  tags: Schema.Array(Schema.String),
});

interface HyprlandClient extends Schema.Schema.Type<typeof HyprlandClient> {}

const HyprlandClients = Schema.fromJsonString(Schema.Array(HyprlandClient));

/** Options accepted by `dot plannotator inbox`. */
export interface PlannotatorInboxOptions {
  /** Base address the Inbox window opens instead of the Inbox's own loopback URL. */
  readonly url?: string;
  /** Thread to open, as the Inbox's `#thread=<id>` fragment. */
  readonly thread?: string;
}

/** Domain error raised when the Inbox cannot be started or opened. */
export class PlannotatorInboxError extends Schema.TaggedError<PlannotatorInboxError>()(
  "PlannotatorInboxError",
  { message: Schema.String },
) {}

/**
 * The address the web app opens: the override when given, otherwise the URL
 * the Inbox printed, with exactly one trailing slash so a thread fragment can
 * follow it.
 */
export function inboxBaseUrl(
  printed: string,
  override?: string,
): Effect.Effect<URL, PlannotatorInboxError> {
  const source = (override ?? printed).trim();
  const parsed = URL.parse(source);

  if (!parsed || !/^https?:$/.test(parsed.protocol)) {
    return Effect.fail(
      new PlannotatorInboxError({
        message: override
          ? `The Inbox address must be http or https: ${source}`
          : `plannotator inbox printed no usable URL: ${source || "(empty)"}`,
      }),
    );
  }

  parsed.pathname = parsed.pathname.replace(/\/*$/, "/");
  parsed.hash = "";

  return Effect.succeed(parsed);
}

const luaString = (value: string) => JSON.stringify(value);

const windowSelector = (address: string) => luaString(`address:${address}`);

const shellWord = (value: string) => `'${value.replaceAll("'", `'\\''`)}'`;

/** How long a new Inbox window gets to appear: 50 polls, 100 ms apart. */
const NEW_WINDOW_POLLS = 50;

/**
 * Open the Plannotator Inbox as an Omarchy web app (a Chromium app window).
 * `plannotator inbox --background` starts a stopped Inbox and prints the
 * running one's URL, so the window never waits on a server. A running window
 * is raised rather than duplicated. Nothing outside Chromium can navigate an
 * app window, so `--thread` opens a new window at the thread and swaps it into
 * the running one's place, keeping its workspace, slot and tags, then closes
 * the old one; the Inbox keeps its state on the server.
 */
export const plannotatorInbox = Effect.fn("plannotatorInbox")(
  function* (options: PlannotatorInboxOptions) {
    const executor = yield* CommandExecutor;

    const readClients = executor
      .run("hyprctl", ["clients", "-j"])
      .pipe(Effect.flatMap(Schema.decodeUnknownEffect(HyprlandClients)));

    // Through Hyprland, as dot workspace setup launches, so the browser is
    // never a child of this command.
    const launch = (url: string) =>
      executor.run("hyprctl", [
        "dispatch",
        `hl.dsp.exec_cmd(${luaString(`omarchy-launch-webapp ${shellWord(url)}`)})`,
      ]);

    if (options.thread && !/^[A-Za-z0-9_-]+$/.test(options.thread)) {
      return yield* new PlannotatorInboxError({
        message: `Not an Inbox thread id: ${options.thread}`,
      });
    }

    const printed = yield* executor
      .run("plannotator", ["inbox", "--background"])
      .pipe(
        Effect.catchTag("CommandError", (error) =>
          Effect.fail(
            new PlannotatorInboxError({
              message: /ENOENT|not ?found/i.test(error.stderr)
                ? "plannotator is not installed; install it from https://plannotator.ai and run plannotator inbox once"
                : `The Inbox did not start: ${error.stderr.trim() || `exit ${error.exitCode}`}`,
            }),
          ),
        ),
      );

    const base = yield* inboxBaseUrl(printed, options.url);

    const open = yield* readClients.pipe(
      Effect.map((clients) => clients.find(isInboxWindow)),
      Effect.orElseSucceed(() => undefined),
    );

    if (!open) {
      yield* launch(
        options.thread ? `${base.href}#thread=${options.thread}` : base.href,
      );

      return;
    }

    if (!options.thread) {
      yield* executor
        .run("hyprctl", [
          "dispatch",
          `hl.dsp.focus({ window = ${windowSelector(open.address)} })`,
        ])
        .pipe(Effect.ignore);

      return;
    }

    const replace = Effect.gen(function* () {
      const before = new Set(
        (yield* readClients).map(({ address }) => address),
      );

      yield* launch(`${base.href}#thread=${options.thread}`);

      const fresh = yield* readClients.pipe(
        Effect.flatMap((clients) => {
          const found = clients.find(
            (client) =>
              client.class === open.class && !before.has(client.address),
          );

          return found
            ? Effect.succeed(found)
            : Effect.fail(
                new PlannotatorInboxError({
                  message:
                    "The Inbox window for the thread did not open; the open one is left as it was",
                }),
              );
        }),
        Effect.retry({
          times: NEW_WINDOW_POLLS,
          schedule: Schedule.spaced("100 millis"),
        }),
      );

      // One batch: the new window takes the old one's slot on its workspace
      // (the old one lands where the new one opened, and closing it gives that
      // slot back), keeps its tags, such as dot workspace setup's, and gets
      // focus. Tags ending in * are dynamic ones from window rules.
      const tags = open.tags.filter((tag) => !tag.endsWith("*"));

      yield* executor.run("hyprctl", [
        "--batch",
        [
          `dispatch hl.dsp.focus({ window = ${windowSelector(fresh.address)} })`,
          `dispatch hl.dsp.window.swap({ target = ${windowSelector(open.address)} })`,
          ...tags.map(
            (tag) =>
              `dispatch hl.dsp.window.tag({ tag = ${luaString(`+${tag}`)}, window = ${windowSelector(fresh.address)} })`,
          ),
          `dispatch hl.dsp.window.close({ window = ${windowSelector(open.address)} })`,
          `dispatch hl.dsp.focus({ window = ${windowSelector(fresh.address)} })`,
        ].join(" ; "),
      ]);
    });

    // dot workspace setup and relayout move windows too; one at a time.
    const lock = yield* Effect.try({
      try: () =>
        acquireWorkspaceMutationLock(
          (message) => new PlannotatorInboxError({ message }),
        ),
      catch: (error) =>
        error instanceof PlannotatorInboxError
          ? error
          : new PlannotatorInboxError({ message: String(error) }),
    });

    yield* replace.pipe(
      Effect.ensuring(Effect.sync(() => releaseWorkspaceMutationLock(lock))),
    );
  },
  // The bar and the app launcher run this, where nobody sees stderr.
  Effect.tapError((error) =>
    Effect.gen(function* () {
      const executor = yield* CommandExecutor;

      yield* executor
        .run("notify-send", [
          "-a",
          "Plannotator Inbox",
          "Could not open the Plannotator Inbox",
          formatCommandError(error),
        ])
        .pipe(Effect.ignore);
    }),
  ),
  handleCommandError("plannotator-inbox"),
);
