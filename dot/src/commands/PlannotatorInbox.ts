import { Effect, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import {
  formatCommandError,
  handleCommandError,
} from "../git/commands/rows.js";
import { CommandExecutor } from "../services/CommandExecutor.js";

/** Options accepted by `dot plannotator inbox`. */
export interface PlannotatorInboxOptions {
  /** Base address the web app opens instead of the Inbox's own loopback URL. */
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
 * The window class Chromium gives an `--app` window: the URL's host and path
 * as `chrome-<host>_<path>-Default` with slashes as underscores, which
 * omarchy-launch-or-focus matches before it launches a new window.
 */
export function webappWindowClass(url: URL): string {
  return `chrome-${url.hostname.toLowerCase()}_${url.pathname || "/"}-Default`.replaceAll(
    "/",
    "_",
  );
}

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
          ? `--url must be an http or https address: ${source}`
          : `plannotator inbox printed no usable URL: ${source || "(empty)"}`,
      }),
    );
  }

  parsed.pathname = parsed.pathname.replace(/\/*$/, "/");
  parsed.hash = "";

  return Effect.succeed(parsed);
}

/**
 * Open the Plannotator Inbox as an Omarchy web app. `plannotator inbox
 * --background` starts a stopped Inbox and prints the running one's URL, so
 * the window never waits on a server. The Inbox itself opens through
 * omarchy-launch-or-focus-webapp, which raises an existing window; a thread
 * opens in a new app window, since a focused window cannot be navigated.
 */
export const plannotatorInbox = Effect.fn("plannotatorInbox")(
  function* (options: PlannotatorInboxOptions) {
    const executor = yield* CommandExecutor;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;

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

    const [command, ...args] = options.thread
      ? ["omarchy-launch-webapp", `${base.href}#thread=${options.thread}`]
      : ["omarchy-launch-or-focus-webapp", webappWindowClass(base), base.href];

    yield* spawner
      .spawn(
        ChildProcess.make(command, args, {
          stdin: "ignore",
          stdout: "ignore",
          stderr: "ignore",
          detached: true,
        }),
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
