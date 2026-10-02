import { Effect, FileSystem, Option, Schema } from "effect";
import { CommandError, CommandExecutor } from "../services/CommandExecutor.js";
import { join, dirname } from "path";
import { ENV, envString } from "./env.js";
import {
  isBuildCurrent,
  sourceBuildKey,
  installCompiledBinary,
} from "./buildStamp.js";
import { withSpinnerTimeout } from "./workflowStep.js";

const DEPENDENCY_INSTALL_TIMEOUT_SECONDS = 3 * 60;

const BINARY_COMPILE_TIMEOUT_SECONDS = 3 * 60;

const DEBUG = !!envString(ENV.DOT_DEBUG);

const log = (msg: string) => {
  if (DEBUG) console.error(`[dot:selfUpdate] ${msg}`);
};

/**
 * Resolve the running binary and the dot source directory from its location.
 *
 * Binary lives at `<dotfiles>/scripts/.local/bin/dot`; source is at
 * `<dotfiles>/dot`. Resolve any symlinks (e.g. ~/.local/bin/dot → repo path)
 * before walking up.
 */
const resolveDotLocation = Effect.fn("SelfUpdate.resolveDotLocation")(
  function* () {
    const fs = yield* FileSystem.FileSystem;

    const binPath = yield* fs
      .realPath(process.execPath)
      .pipe(Effect.orElseSucceed(() => process.execPath));

    return {
      binPath,
      dotSrc: join(dirname(binPath), "..", "..", "..", "dot"),
    };
  },
);

/**
 * Rebuild the dot binary from source.
 *
 * Runs `bun install` then `bun build --compile` to a temporary path,
 * then atomically renames over the current binary. Skips both when the binary
 * was last built from the same clean source tree, and returns whether it built.
 * Callers may relaunch when the rebuilt code must continue the current workflow.
 */
export const rebuild = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const { binPath, dotSrc } = yield* resolveDotLocation();

  log(`Rebuilding from: ${dotSrc}`);

  const buildKey = yield* sourceBuildKey(dotSrc);

  if (yield* isBuildCurrent(binPath, buildKey)) {
    log(`Binary already built from ${buildKey}`);

    return false;
  }

  const installed = yield* withSpinnerTimeout(
    "Installing dot dependencies",
    DEPENDENCY_INSTALL_TIMEOUT_SECONDS,
    executor.run("bun", ["install"], { cwd: dotSrc }),
  );

  if (Option.isNone(installed)) {
    return yield* new CommandError({
      command: "bun install",
      exitCode: 124,
      stderr: `timed out after ${DEPENDENCY_INSTALL_TIMEOUT_SECONDS}s`,
    });
  }

  log("Dependencies installed");

  const tmpPath = `${binPath}.new`;

  const compiled = yield* withSpinnerTimeout(
    "Compiling dot binary",
    BINARY_COMPILE_TIMEOUT_SECONDS,
    executor.run(
      "bun",
      ["build", "src/index.ts", "--compile", "--outfile", tmpPath],
      { cwd: dotSrc },
    ),
  );

  if (Option.isNone(compiled)) {
    return yield* new CommandError({
      command: "bun build src/index.ts --compile",
      exitCode: 124,
      stderr: `timed out after ${BINARY_COMPILE_TIMEOUT_SECONDS}s`,
    });
  }

  log(`Built to: ${tmpPath}`);

  // Atomic rename over the real binary (not the symlink)
  yield* installCompiledBinary(tmpPath, binPath, buildKey).pipe(Effect.orDie);
  log("Binary replaced");

  return true;
});

/** The restarted dot exited non-zero after handling and reporting its own failure. */
export class DotRestartError extends Schema.TaggedError<DotRestartError>()(
  "DotRestartError",
  {
    message: Schema.String,
  },
) {}

/** Restart the rebuilt dot binary with inherited stdio and fail on non-zero exit. */
export const restartDot = (
  args: readonly string[],
): Effect.Effect<
  void,
  CommandError | DotRestartError,
  CommandExecutor | FileSystem.FileSystem
> =>
  Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    const { binPath } = yield* resolveDotLocation();
    const command = `${binPath} ${args.join(" ")}`;
    log(`Restarting: ${command}`);
    const exitCode = yield* executor.inherit(binPath, args);

    if (exitCode !== 0) {
      return yield* new DotRestartError({
        message: `${command} exited ${exitCode}`,
      });
    }
  });
