import { Effect, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import {
  formatCommandError,
  handleCommandError,
} from "../git/commands/rows.js";
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

/**
 * Open the Plannotator Inbox as an Omarchy web app (a Chromium app window).
 * `plannotator inbox --background` starts a stopped Inbox and prints the
 * running one's URL, so the window never waits on a server. A running window
 * is raised rather than duplicated. Nothing outside Chromium can navigate an
 * app window, so `--thread` closes a running one and opens a new one at the
 * thread; the Inbox keeps its state on the server.
 */
export const plannotatorInbox = Effect.fn("plannotatorInbox")(
  function* (options: PlannotatorInboxOptions) {
    const executor = yield* CommandExecutor;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

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

    const open = yield* executor.run("hyprctl", ["clients", "-j"]).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(HyprlandClients)),
      Effect.map((clients) => clients.find(isInboxWindow)),
      Effect.orElseSucceed(() => undefined),
    );

    if (open && !options.thread) {
      yield* executor
        .run("hyprctl", [
          "dispatch",
          `hl.dsp.focus({ window = "address:${open.address}" })`,
        ])
        .pipe(Effect.ignore);

      return;
    }

    if (open) {
      yield* executor
        .run("hyprctl", [
          "dispatch",
          `hl.dsp.window.close({ window = "address:${open.address}" })`,
        ])
        .pipe(Effect.ignore);
    }

    yield* spawner
      .spawn(
        ChildProcess.make(
          "omarchy-launch-webapp",
          [
            options.thread
              ? `${base.href}#thread=${options.thread}`
              : base.href,
          ],
          {
            stdin: "ignore",
            stdout: "ignore",
            stderr: "ignore",
            detached: true,
          },
        ),
      )
      .pipe(
        Effect.flatMap((child) => child.unref),
        Effect.asVoid,
        Effect.scoped,
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
