import { dirname, join } from "node:path";
import { Clock, Effect, FileSystem, Schema } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import {
  formatCommandError,
  handleCommandError,
} from "../git/commands/rows.js";
import {
  CACHE_DIR,
  CONFIG_DIR,
  DATA_DIR,
  displayPath,
  HOME_DIR,
} from "../lib/paths.js";
import { CommandExecutor } from "../services/CommandExecutor.js";

/** Plannotator's own settings, stowed from plannotator/.plannotator. */
const PLANNOTATOR_CONFIG = join(HOME_DIR, ".plannotator", "config.json");

/** The Qt WebEngine window, stowed from scripts/.local/share. */
const WINDOW_QML = join(DATA_DIR, "plannotator-inbox", "Inbox.qml");

/** File the window polls for the thread to show. */
const COMMAND_FILE = join(CACHE_DIR, "dot", "plannotator-inbox.json");

/** Wayland app id the Qt 6 qml runtime gives its windows. */
const WINDOW_CLASS = "org.qt-project.qml";

/** Title set in Inbox.qml, which tells the Inbox apart from other qml windows. */
const WINDOW_TITLE = "Plannotator Inbox";

const HyprlandClients = Schema.fromJsonString(
  Schema.Array(
    Schema.Struct({
      address: Schema.String,
      class: Schema.String,
      title: Schema.String,
    }),
  ),
);

const PlannotatorConfig = Schema.fromJsonString(
  Schema.Struct({
    inboxNotifications: Schema.optional(
      Schema.Struct({ allowedOrigin: Schema.optional(Schema.String) }),
    ),
  }),
);

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

/** Chromium's flags file, where a forced device scale factor may be set. */
const CHROMIUM_FLAGS = join(CONFIG_DIR, "chromium-flags.conf");

/**
 * The `--force-device-scale-factor` from chromium-flags.conf, so the Inbox
 * matches the size of browser windows, or "1" when none is set.
 */
const chromiumScale = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  const flags = yield* fs
    .readFileString(CHROMIUM_FLAGS)
    .pipe(Effect.orElseSucceed(() => ""));

  return (
    /^--force-device-scale-factor=(\d+(?:\.\d+)?)\s*$/m.exec(flags)?.[1] ?? "1"
  );
}).pipe(Effect.withSpan("PlannotatorInbox.chromiumScale"));

/**
 * The origin Plannotator lets show Inbox notifications, which is where the
 * Inbox is opened from, or undefined when it isn't set.
 */
const configuredUrl = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  if (!(yield* fs.exists(PLANNOTATOR_CONFIG))) return undefined;

  const config = yield* fs.readFileString(PLANNOTATOR_CONFIG).pipe(
    Effect.flatMap(Schema.decodeUnknownEffect(PlannotatorConfig)),
    Effect.mapError(
      (cause) =>
        new PlannotatorInboxError({
          message: `read ${displayPath(PLANNOTATOR_CONFIG)}: ${cause.message}`,
        }),
    ),
  );

  return config.inboxNotifications?.allowedOrigin;
}).pipe(Effect.withSpan("PlannotatorInbox.configuredUrl"));

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
 * Open the Plannotator Inbox in its own Qt WebEngine window (Inbox.qml).
 * `plannotator inbox --background` starts a stopped Inbox and prints the
 * running one's URL, so the window never waits on a server. A running window
 * is raised rather than duplicated, and picks up the requested thread from the
 * command file, which a browser app window could not do.
 */
export const plannotatorInbox = Effect.fn("plannotatorInbox")(
  function* (options: PlannotatorInboxOptions) {
    const executor = yield* CommandExecutor;
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    const fs = yield* FileSystem.FileSystem;

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

    const base = yield* inboxBaseUrl(
      printed,
      options.url ?? (yield* configuredUrl),
    );

    // Written every time, with a timestamp, so a thread opens again even when
    // it was the last one asked for, and a new window doesn't replay an old one.
    yield* fs.makeDirectory(dirname(COMMAND_FILE), { recursive: true });
    yield* fs.writeFileString(
      COMMAND_FILE,
      JSON.stringify({
        thread: options.thread ?? null,
        at: yield* Clock.currentTimeMillis,
      }),
    );

    const open = yield* executor.run("hyprctl", ["clients", "-j"]).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(HyprlandClients)),
      Effect.map((clients) =>
        clients.find(
          (client) =>
            client.class === WINDOW_CLASS && client.title === WINDOW_TITLE,
        ),
      ),
      Effect.orElseSucceed(() => undefined),
    );

    if (open) {
      yield* executor
        .run("hyprctl", [
          "dispatch",
          `hl.dsp.focus({ window = "address:${open.address}" })`,
        ])
        .pipe(Effect.ignore);

      return;
    }

    yield* spawner
      .spawn(
        ChildProcess.make(
          "uwsm-app",
          ["--", "qml6", WINDOW_QML, "--", base.href, COMMAND_FILE],
          {
            env: {
              QML_XHR_ALLOW_FILE_READ: "1",
              // Hyprland already scales the window, so a session-wide Qt
              // factor would double it; match Chromium's own scale instead.
              // TODO: make the scale a setting of its own.
              QT_SCALE_FACTOR: yield* chromiumScale,
            },
            extendEnv: true,
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
