/**
 * @file `dot cloud setup`: prepare Claude Code in a cloud session VM.
 *
 * Runs from `cloud/setup.sh`, the cloud environment's setup script, after the
 * toolchain is installed and `dot` is built. It links the cloud Claude Code
 * settings, writes the user instructions and links the shared skills. The
 * environment snapshots the result, so later sessions start with it on disk.
 */
import { Effect, FileSystem, Schema } from "effect";
import { join } from "path";
import { writeFileAtomic } from "../lib/atomicWrite.js";
import { lstatOrNull, readLinkOrNull, readTextOrNull } from "../lib/fsProbe.js";
import { ENV, envString } from "../lib/env.js";
import { HOME_DIR, displayPath } from "../lib/paths.js";
import { cliStyler } from "../lib/ansi.js";
import { syncSkills } from "../lib/externalSkills.js";
import {
  backupFileIfUnmanaged,
  formatBackupMove,
} from "../lib/stowConflicts.js";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";

const CLAUDE_DIR = join(HOME_DIR, ".claude");

/** Cloud Claude Code files in the public dotfiles, relative to its root. */
const CLOUD_SETTINGS = join("cloud", "claude", "settings.json");
const CLOUD_INSTRUCTIONS = join("cloud", "claude", "CLAUDE.md");

/** Global agent instructions in the private dotfiles, relative to its root. */
const PRIVATE_INSTRUCTIONS = join("agents", ".config", "opencode", "AGENTS.md");

/** Domain error for cloud setup failures. */
class CloudSetupError extends Schema.TaggedError<CloudSetupError>()(
  "CloudSetupError",
  { message: Schema.String },
) {}

/** Typed options supplied by the Effect CLI command. */
export interface CloudSetupOptions {
  /** Run outside a Claude Code cloud session. */
  readonly force: boolean;
}

/**
 * Point `~/.claude/settings.json` at the tracked cloud settings. A real file
 * already there is moved into the dotfiles backup folder first, and a link to
 * anywhere else is replaced.
 */
const linkClaudeSettings = Effect.fn("CloudSetup.linkSettings")(function* (
  publicDotfiles: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const log = yield* OutputLog;
  const source = join(publicDotfiles, CLOUD_SETTINGS);
  const target = join(CLAUDE_DIR, "settings.json");

  if ((yield* readLinkOrNull(target)) === source) {
    yield* log.info("Claude Code settings are already linked");

    return null;
  }

  const move = yield* Effect.sync(() =>
    backupFileIfUnmanaged(target, join(publicDotfiles, "backup", ".claude")),
  );

  if (move) yield* log.warn(`Backed up ${formatBackupMove(move)}`);

  if ((yield* lstatOrNull(target)) !== null) yield* fs.remove(target);

  yield* fs.makeDirectory(CLAUDE_DIR, { recursive: true });
  yield* fs.symlink(source, target);
  yield* log.success(
    `Linked ${displayPath(target)} ${cliStyler().dim(`-> ${displayPath(source)}`)}`,
  );

  return "Linked the cloud Claude Code settings";
});

/**
 * Write `~/.claude/CLAUDE.md` from the tracked cloud notes followed by the
 * private global AGENTS.md, when the private dotfiles are present.
 */
const writeClaudeInstructions = Effect.fn("CloudSetup.writeInstructions")(
  function* (publicDotfiles: string, privateDotfiles: string | null) {
    const log = yield* OutputLog;
    const target = join(CLAUDE_DIR, "CLAUDE.md");
    const cloudSource = join(publicDotfiles, CLOUD_INSTRUCTIONS);

    const privateSource =
      privateDotfiles === null
        ? null
        : join(privateDotfiles, PRIVATE_INSTRUCTIONS);

    const cloud = yield* readTextOrNull(cloudSource);

    const global =
      privateSource === null ? null : yield* readTextOrNull(privateSource);

    if (cloud === null)
      return yield* new CloudSetupError({
        message: `Missing cloud instructions: ${cloudSource}`,
      });

    if (global === null)
      yield* log.warn(
        "Private dotfiles are not available, so CLAUDE.md has the cloud notes only",
      );

    const sources = [
      cloudSource,
      ...(global === null || privateSource === null ? [] : [privateSource]),
    ];

    const content = [
      `<!-- dot cloud setup: sources=${sources.map(displayPath).join(",")} -->`,
      "",
      cloud.trimEnd(),
      ...(global === null ? [] : ["", global.trimEnd()]),
      "",
    ].join("\n");

    if ((yield* readTextOrNull(target)) === content) {
      yield* log.info("Claude Code instructions are up to date");

      return null;
    }

    yield* Effect.sync(() =>
      writeFileAtomic(target, content, { createDirectory: true }),
    );
    yield* log.success(`Wrote ${displayPath(target)}`);

    return global === null
      ? "Wrote the cloud Claude Code instructions"
      : "Wrote the cloud and global Claude Code instructions";
  },
);

/**
 * Prepare Claude Code in a cloud session VM: link the cloud settings, write
 * the user instructions and link the shared skills into `~/.claude/skills`.
 *
 * @returns Actions taken, for the closing summary.
 */
export const cloudSetup = Effect.fn("CloudSetup")(function* (
  options: CloudSetupOptions,
) {
  const config = yield* Config;
  const log = yield* OutputLog;

  if (envString(ENV.CLAUDE_CODE_REMOTE) !== "true" && !options.force)
    return yield* new CloudSetupError({
      message:
        "Not in a Claude Code cloud session (CLAUDE_CODE_REMOTE is not true); pass --force to set up Claude Code here anyway",
    });

  const actions: string[] = [];

  yield* log.section("Claude Code");

  const settings = yield* linkClaudeSettings(config.publicDotfiles);

  if (settings) actions.push(settings);

  const instructions = yield* writeClaudeInstructions(
    config.publicDotfiles,
    config.privateDotfiles,
  );

  if (instructions) actions.push(instructions);

  actions.push(
    ...(yield* syncSkills)
      .filter((action) => action.status === "done")
      .map((action) => action.message),
  );

  const result: readonly string[] = actions;

  return result;
});
