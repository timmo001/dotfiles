import { Effect, Schema } from "effect";
import { join } from "path";
import { Config } from "../services/Config.js";
import { runQuiet } from "./quietCommand.js";

/** Failure while installing the shared OpenCode plugin dependencies. */
export class OpencodePluginInstallError extends Schema.TaggedError<OpencodePluginInstallError>()(
  "OpencodePluginInstallError",
  { message: Schema.String },
) {}

/**
 * Install the locked OpenCode plugin dependencies in the stow source.
 *
 * Stowed plugin files resolve imports from their symlink target, so the
 * dependencies must live beside the source rather than under `~/.config`.
 */
export const installOpencodePluginDependencies = Effect.gen(function* () {
  const config = yield* Config;

  const source = join(
    config.publicDotfiles,
    "agents",
    ".config",
    "opencode",
    "plugins",
  );

  const { exitCode: code } = yield* runQuiet(
    "bun",
    ["install", "--frozen-lockfile"],
    { cwd: source },
  );

  if (code !== 0) {
    return yield* new OpencodePluginInstallError({
      message: `Locked OpenCode plugin dependency install exited ${code}`,
    });
  }

  return source;
});
