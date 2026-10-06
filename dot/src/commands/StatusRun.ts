import {
  Clock,
  Console,
  Deferred,
  Effect,
  Fiber,
  Ref,
  Schedule,
  Schema,
} from "effect";
import { ANSI, colorEnabled } from "../lib/ansi.js";
import { CommandExecutor } from "../services/CommandExecutor.js";

/** Invalid `dot status-run` arguments. */
export class StatusRunError extends Schema.TaggedError<StatusRunError>()(
  "StatusRunError",
  { message: Schema.String },
) {}

/** Options for {@link statusRun}. */
export interface StatusRunOptions {
  /** Name shown in the header and terminal title. */
  readonly title: string;
  /** URL pinned in the header. */
  readonly url?: string;
  /** What serves the URL, when it is not this command, shown beside it. */
  readonly via?: string;
  /** zsh command run before the main command or daemon starts. */
  readonly setup?: string;
  /** Pitchfork daemon to start and follow instead of running a command. */
  readonly pitchfork?: string;
  /** Pitchfork daemons that cannot run alongside the daemon; stopped first after asking. */
  readonly conflicts: readonly string[];
  /** Follow an already running daemon instead of asking to restart it. */
  readonly attach: boolean;
  /** Leave the pitchfork daemon running and return once it is ready. */
  readonly background: boolean;
  /** Command and arguments run in the foreground. */
  readonly command: readonly string[];
}

type Phase =
  | { readonly kind: "setup" }
  | { readonly kind: "prompt" }
  | { readonly kind: "starting" }
  | { readonly kind: "running"; readonly daemon: boolean }
  | { readonly kind: "stopping" }
  | { readonly kind: "background" }
  | { readonly kind: "done" }
  | { readonly kind: "stopped" }
  | { readonly kind: "cancelled" }
  | { readonly kind: "failed"; readonly reason: string };

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

const HEADER_ROWS = 2;

const ESC = "\x1b";

const phaseLabel = (phase: Phase) => {
  switch (phase.kind) {
    case "setup":
      return "Setting up";
    case "prompt":
      return "Waiting";
    case "starting":
      return "Starting";
    case "running":
      return "Running";
    case "stopping":
      return "Stopping";
    case "background":
      return "Running in background";
    case "done":
      return "Done";
    case "stopped":
      return "Stopped";
    case "cancelled":
      return "Cancelled";
    case "failed":
      return `Failed (${phase.reason})`;
  }
};

const phaseIcon = (phase: Phase, frame: number) => {
  switch (phase.kind) {
    case "running":
      return phase.daemon ? "●" : SPINNER[frame % SPINNER.length];
    case "background":
      return "●";
    case "prompt":
      return "?";
    case "done":
      return "✓";
    case "stopped":
    case "cancelled":
      return "■";
    case "failed":
      return "✗";
    default:
      return SPINNER[frame % SPINNER.length];
  }
};

const phaseColor = (phase: Phase) => {
  switch (phase.kind) {
    case "running":
    case "background":
    case "done":
      return ANSI.green;
    case "failed":
      return ANSI.red;
    case "stopped":
    case "cancelled":
      return ANSI.dim;
    default:
      return ANSI.yellow;
  }
};

const elapsed = (millis: number) => {
  const seconds = Math.floor(millis / 1000);
  const minutes = Math.floor(seconds / 60);

  return minutes >= 60
    ? `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`
    : `${minutes}:${String(seconds % 60).padStart(2, "0")}`;
};

const clip = (text: string, width: number) => text.slice(0, Math.max(width, 0));

const statusOf = (output: string) =>
  /^Status: (.+)$/m.exec(output)?.[1]?.trim() ?? "unknown";

/**
 * Run setup and then a command or pitchfork daemon under a header pinned to
 * the top of the terminal, showing the state, URL and elapsed time. The
 * terminal title tracks the same state. Ctrl+C stops a followed daemon.
 */
export const statusRun = Effect.fn("StatusRun")(function* (
  options: StatusRunOptions,
) {
  const executor = yield* CommandExecutor;
  const daemon = options.pitchfork;

  if (daemon === undefined && options.command.length === 0)
    return yield* new StatusRunError({
      message: "Pass a command after -- or a daemon with --pitchfork",
    });

  if (daemon !== undefined && options.command.length > 0)
    return yield* new StatusRunError({
      message: "Pass either a command or --pitchfork, not both",
    });

  if (daemon === undefined && options.background)
    return yield* new StatusRunError({
      message: "--background only applies to --pitchfork daemons",
    });

  if (daemon === undefined && options.conflicts.length > 0)
    return yield* new StatusRunError({
      message: "--conflicts only applies to --pitchfork daemons",
    });

  if (daemon === undefined && options.attach)
    return yield* new StatusRunError({
      message: "--attach only applies to --pitchfork daemons",
    });

  const tty = process.stdout.isTTY === true;
  const color = colorEnabled();
  const phase = yield* Ref.make<Phase>({ kind: "setup" });
  const phaseStarted = yield* Ref.make(yield* Clock.currentTimeMillis);
  const frame = yield* Ref.make(0);
  const interrupted = yield* Deferred.make<void>();
  const write = (text: string) => Effect.sync(() => process.stdout.write(text));

  const render = Effect.gen(function* () {
    const current = yield* Ref.get(phase);
    const tick = yield* Ref.get(frame);
    const now = yield* Clock.currentTimeMillis;
    const since = now - (yield* Ref.get(phaseStarted));
    const icon = phaseIcon(current, tick);
    const label = phaseLabel(current);

    const timed =
      current.kind === "running" ||
      current.kind === "setup" ||
      current.kind === "starting"
        ? `${current.kind === "running" ? "up " : ""}${elapsed(since)}`
        : "";

    const url =
      options.url && options.via
        ? `${options.url} (via ${options.via})`
        : options.url;

    const parts = [url, daemon, timed].filter((part): part is string => !!part);

    const plain = ` ${icon} ${label}   ${parts.join("   ")}`;
    const title = `${icon} ${options.title} · ${label}`;

    return { current, plain, title, icon, label, parts };
  });

  const styled = (
    current: Phase,
    icon: string,
    label: string,
    parts: string[],
    width: number,
  ) => {
    const text = clip(` ${icon} ${label}   ${parts.join("   ")}`, width);

    if (!color) return text;

    const head = ` ${icon} ${label}`;

    return text.length <= head.length
      ? `${phaseColor(current)}${ANSI.bold}${text}${ANSI.reset}`
      : `${phaseColor(current)}${ANSI.bold}${head}${ANSI.reset}${text.slice(head.length)}`;
  };

  const draw = Effect.gen(function* () {
    const { current, title, icon, label, parts } = yield* render;
    const width = process.stdout.columns ?? 80;
    const rule = "─".repeat(width);

    yield* write(
      `${ESC}]2;${title}\x07${ESC}7${ESC}[1;1H${ESC}[2K${styled(current, icon, label, parts, width)}${ESC}[2;1H${ESC}[2K${color ? ANSI.dim : ""}${rule}${color ? ANSI.reset : ""}${ESC}8`,
    );
  });

  const setRegion = Effect.sync(() =>
    process.stdout.write(
      `${ESC}7${ESC}[${HEADER_ROWS + 1};${process.stdout.rows ?? 24}r${ESC}8`,
    ),
  );

  const setPhase = Effect.fn("StatusRun.setPhase")(function* (next: Phase) {
    yield* Ref.set(phase, next);
    yield* Ref.set(phaseStarted, yield* Clock.currentTimeMillis);

    if (tty) return yield* draw;

    const { title } = yield* render;
    yield* Console.log(`[status] ${title}`);
  });

  const context = yield* Effect.context<never>();
  const onInterrupt = () => Deferred.doneUnsafe(interrupted, Effect.void);

  const onResize = () =>
    Effect.runForkWith(context)(Effect.andThen(setRegion, draw));

  yield* Effect.acquireRelease(
    Effect.sync(() => {
      process.on("SIGINT", onInterrupt);
      process.on("SIGTERM", onInterrupt);
      process.on("SIGHUP", onInterrupt);
      process.on("SIGWINCH", onResize);
    }),
    () =>
      Effect.sync(() => {
        process.off("SIGINT", onInterrupt);
        process.off("SIGTERM", onInterrupt);
        process.off("SIGHUP", onInterrupt);
        process.off("SIGWINCH", onResize);
      }),
  );

  if (tty) {
    yield* write(`${ESC}[H${ESC}[2J`);
    yield* setRegion;
    yield* write(`${ESC}[${HEADER_ROWS + 1};1H`);

    yield* Effect.addFinalizer(() =>
      Effect.gen(function* () {
        yield* write(`${ESC}7${ESC}[r${ESC}8`);
        yield* draw;
        const { plain } = yield* render;
        yield* write(`\n${plain}\n`);
      }),
    );

    yield* Ref.update(frame, (tick) => tick + 1).pipe(
      Effect.andThen(draw),
      Effect.repeat(Schedule.spaced("120 millis")),
      Effect.forkScoped,
    );
  }

  const cancelled = Deferred.isDone(interrupted);

  const finish = Effect.fn("StatusRun.finish")(function* (
    next: Phase,
    exitCode: number,
  ) {
    yield* setPhase(next);
    process.exitCode = exitCode;
  });

  const exitPhase = (exitCode: number): Effect.Effect<Phase> =>
    Effect.map(cancelled, (wasCancelled) =>
      wasCancelled || exitCode === 130
        ? { kind: "cancelled" }
        : { kind: "failed", reason: `exit ${exitCode}` },
    );

  yield* setPhase({ kind: "setup" });

  if (options.setup !== undefined) {
    const setupExit = yield* executor.inherit("zsh", ["-ic", options.setup]);

    if (setupExit !== 0)
      return yield* finish(yield* exitPhase(setupExit), setupExit);
  }

  if (yield* cancelled) return yield* finish({ kind: "cancelled" }, 130);

  if (daemon === undefined) {
    const [command, ...args] = options.command;
    yield* setPhase({ kind: "running", daemon: false });
    const exitCode = yield* executor.inherit(command, args);

    return yield* finish(
      exitCode === 0 ? { kind: "done" } : yield* exitPhase(exitCode),
      exitCode,
    );
  }

  const statusOfDaemon = (name: string) =>
    executor.run("pitchfork", ["status", name]).pipe(
      Effect.map(statusOf),
      Effect.orElseSucceed(() => "unknown"),
    );

  const status = statusOfDaemon(daemon);

  const ask = (question: string) =>
    Effect.map(
      executor.inherit("zsh", [
        "-c",
        'read -q "?$1 [y/N] "; answer=$?; echo; exit $answer',
        "zsh",
        question,
      ]),
      (exitCode) => exitCode === 0,
    );

  for (const conflict of options.conflicts) {
    if ((yield* statusOfDaemon(conflict)) !== "running") continue;

    yield* setPhase({ kind: "prompt" });

    const stop = yield* ask(
      `${conflict} is running and can't run alongside ${daemon}. Stop it?`,
    );

    if (!stop || (yield* cancelled))
      return yield* finish({ kind: "cancelled" }, 1);

    if ((yield* statusOfDaemon(conflict)) !== "running") continue;

    yield* setPhase({ kind: "stopping" });
    const stopExit = yield* executor.inherit("pitchfork", ["stop", conflict]);

    if (stopExit !== 0)
      return yield* finish(
        { kind: "failed", reason: `could not stop ${conflict}` },
        stopExit,
      );
  }

  let restart = false;

  if (!options.attach && (yield* status) === "running") {
    yield* setPhase({ kind: "prompt" });
    restart = yield* ask(`${daemon} is already running. Restart it?`);
  }

  if (yield* cancelled) return yield* finish({ kind: "cancelled" }, 130);

  const alreadyRunning = !restart && (yield* status) === "running";

  if (!alreadyRunning) {
    yield* setPhase({ kind: "starting" });

    const startExit = yield* executor.inherit("pitchfork", [
      "start",
      ...(restart ? ["--force"] : []),
      daemon,
    ]);

    if (startExit !== 0)
      return yield* finish(yield* exitPhase(startExit), startExit);
  }

  if (options.background) return yield* finish({ kind: "background" }, 0);

  yield* setPhase({ kind: "running", daemon: true });

  const logs = yield* executor
    .inherit("pitchfork", ["logs", "--tail", daemon])
    .pipe(Effect.forkScoped);

  const down = status.pipe(
    Effect.repeat({
      schedule: Schedule.spaced("2 seconds"),
      while: (current) => current === "running",
    }),
  );

  const outcome = yield* Effect.raceFirst(
    Effect.as(Deferred.await(interrupted), "interrupted" as const),
    down,
  );

  yield* Fiber.interrupt(logs);

  if (outcome !== "interrupted")
    return yield* finish(
      outcome === "stopped"
        ? { kind: "stopped" }
        : { kind: "failed", reason: outcome },
      outcome === "stopped" ? 0 : 1,
    );

  yield* setPhase({ kind: "stopping" });
  const stopExit = yield* executor.inherit("pitchfork", ["stop", daemon]);

  return yield* finish(
    stopExit === 0
      ? { kind: "stopped" }
      : { kind: "failed", reason: "stop failed" },
    stopExit,
  );
}, Effect.scoped);
