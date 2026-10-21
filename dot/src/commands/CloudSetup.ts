/**
 * @file `dot cloud setup`: prepare Claude Code in a cloud session VM.
 *
 * Runs from `cloud/setup.sh`, the cloud environment's setup script, after the
 * toolchain is installed and `dot` is built. It links the cloud Claude Code
 * settings, writes the user instructions and links the shared skills. The
 * environment snapshots the result, so later sessions start with it on disk.
 */
import { Effect, FileSystem, Schema } from "effect";
import { dirname, join } from "path";
import { writeFileAtomic } from "../lib/atomicWrite.js";
import { lstatOrNull, readLinkOrNull, readTextOrNull } from "../lib/fsProbe.js";
import { ENV, envString } from "../lib/env.js";
import {
  CONFIG_DIR,
  HOME_DIR,
  STATE_DIR,
  displayPath,
  expandHomePath,
} from "../lib/paths.js";
import { cliStyler } from "../lib/ansi.js";
import { CLOUD_CHECKOUTS_DIR } from "../lib/cloudSession.js";
import { syncSkills } from "../lib/externalSkills.js";
import {
  backupFileIfUnmanaged,
  formatBackupMove,
} from "../lib/stowConflicts.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";

const CLAUDE_DIR = join(HOME_DIR, ".claude");

/** Cloud Claude Code files in the public dotfiles, relative to its root. */
const CLOUD_SETTINGS = join("cloud", "claude", "settings.json");
const CLOUD_INSTRUCTIONS = join("cloud", "claude", "CLAUDE.md");

/** Global agent instructions in the private dotfiles, relative to its root. */
const PRIVATE_INSTRUCTIONS = join("agents", ".config", "opencode", "AGENTS.md");

/** The private dotfiles repository, cloned once a session can reach it. */
const PRIVATE_REPOSITORY_URL =
  "https://github.com/timmo001/dotfiles-private.git";

/** Where a cloud session checks out the private repository when attached. */
const ATTACHED_PRIVATE_DOTFILES = join(CLOUD_CHECKOUTS_DIR, "dotfiles-private");

/** Where dot looks for the private dotfiles, cloned or linked by cloud setup. */
const PRIVATE_CLONE = expandHomePath(
  envString(ENV.DOTFILES_PRIVATE_DIR) ?? join(CONFIG_DIR, "dotfiles-private"),
);

/** Background rebuild run when the session start hook pulls new commits. */
const REBUILD_LOG = join(STATE_DIR, "dot", "cloud-rebuild.log");

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

/** User-level Claude Code instructions written by cloud setup. */
const CLAUDE_INSTRUCTIONS = join(CLAUDE_DIR, "CLAUDE.md");

/** The built `~/.claude/CLAUDE.md` and the global instructions in it. */
interface ClaudeInstructions {
  /** Full file content. */
  readonly content: string;
  /** The private global AGENTS.md, or `null` when it was not found. */
  readonly global: string | null;
}

/** Whether a built CLAUDE.md already carries the private global AGENTS.md. */
const hasGlobalInstructions = (content: string) =>
  content.split("\n", 1)[0]?.includes(PRIVATE_INSTRUCTIONS) ?? false;

/**
 * Find the private dotfiles to read the global AGENTS.md from: the usual
 * clone, else the checkout a cloud session makes when the private repository
 * is attached to it. The setup script has no GitHub credentials, so the
 * attached checkout is often the only copy until the session starts.
 */
const findPrivateDotfiles = Effect.fn("CloudSetup.findPrivate")(function* (
  privateDotfiles: string | null,
) {
  for (const directory of [privateDotfiles, ATTACHED_PRIVATE_DOTFILES]) {
    if (directory === null) continue;

    if ((yield* lstatOrNull(join(directory, PRIVATE_INSTRUCTIONS))) !== null)
      return directory;
  }

  return null;
});

/**
 * Build `~/.claude/CLAUDE.md` from the tracked cloud notes followed by the
 * private global AGENTS.md, when the private dotfiles are present. The first
 * line records the sources, which the session start hook reads back.
 */
const buildClaudeInstructions = Effect.fn("CloudSetup.buildInstructions")(
  function* (publicDotfiles: string, privateDotfiles: string | null) {
    const cloudSource = join(publicDotfiles, CLOUD_INSTRUCTIONS);
    const cloud = yield* readTextOrNull(cloudSource);

    const privateSource =
      privateDotfiles === null
        ? null
        : join(privateDotfiles, PRIVATE_INSTRUCTIONS);

    const global =
      privateSource === null ? null : yield* readTextOrNull(privateSource);

    if (cloud === null)
      return yield* new CloudSetupError({
        message: `Missing cloud instructions: ${cloudSource}`,
      });

    const sources = [
      cloudSource,
      ...(global === null || privateSource === null ? [] : [privateSource]),
    ];

    const instructions: ClaudeInstructions = {
      content: [
        `<!-- dot cloud setup: sources=${sources.map(displayPath).join(",")} -->`,
        "",
        cloud.trimEnd(),
        ...(global === null ? [] : ["", global.trimEnd()]),
        "",
      ].join("\n"),
      global,
    };

    return instructions;
  },
);

/** Write `~/.claude/CLAUDE.md` from the cloud notes and global instructions. */
const writeClaudeInstructions = Effect.fn("CloudSetup.writeInstructions")(
  function* (publicDotfiles: string, privateDotfiles: string | null) {
    const log = yield* OutputLog;
    const target = CLAUDE_INSTRUCTIONS;

    const { content, global } = yield* buildClaudeInstructions(
      publicDotfiles,
      yield* findPrivateDotfiles(privateDotfiles),
    );

    if (global === null)
      yield* log.warn(
        "Private dotfiles are not available yet, so CLAUDE.md has the cloud notes only; the session start hook adds the rest",
      );

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

  // Setup runs without GitHub credentials, so this usually links the attached
  // checkout instead; the session start hook clones it later otherwise.
  yield* syncPrivateDotfiles(PRIVATE_CLONE);

  const instructions = yield* writeClaudeInstructions(
    config.publicDotfiles,
    PRIVATE_CLONE,
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

/**
 * Run git without prompting for credentials, capturing its output.
 *
 * @returns Trimmed stdout, or `null` when git failed.
 */
const git = Effect.fn("CloudSetup.git")(function* (args: readonly string[]) {
  const executor = yield* CommandExecutor;

  return yield* executor
    .run("git", args, { env: { GIT_TERMINAL_PROMPT: "0" } })
    .pipe(
      Effect.map((output) => output.trim()),
      Effect.orElseSucceed(() => null),
    );
});

/**
 * Reset the public dotfiles clone to the latest commit on its branch. The
 * environment snapshot can be days old, and the Distro diff workflow commits
 * after every push. When new commits arrive, rebuild dot and re-run cloud
 * setup in a detached background job, so the hook doesn't wait on the build
 * or overwrite the binary it is running from.
 */
const refreshPublicDotfiles = Effect.fn("CloudSetup.refreshPublic")(function* (
  directory: string,
) {
  const executor = yield* CommandExecutor;
  const branch = yield* git(["-C", directory, "branch", "--show-current"]);
  const before = yield* git(["-C", directory, "rev-parse", "HEAD"]);

  if (!branch || !before) return;

  const fetched = yield* git([
    "-C",
    directory,
    "fetch",
    "--quiet",
    "--depth=1",
    "origin",
    branch,
  ]);

  const after = yield* git(["-C", directory, "rev-parse", "FETCH_HEAD"]);

  if (fetched === null || !after || after === before) return;

  if (
    (yield* git(["-C", directory, "reset", "--quiet", "--hard", after])) ===
    null
  )
    return;

  const script = [
    `exec >${JSON.stringify(REBUILD_LOG)} 2>&1 </dev/null`,
    `cd ${JSON.stringify(directory)}`,
    "mise run dot:build ::: skills-maintenance:build",
    `${JSON.stringify(join(HOME_DIR, ".local", "bin", "dot"))} cloud setup --force`,
  ].join(" && ");

  yield* Effect.sync(() =>
    writeFileAtomic(REBUILD_LOG, "", { createDirectory: true }),
  );
  yield* executor.exitCode("setsid", ["-f", "bash", "-c", script]);
});

/**
 * Clone the private dotfiles, or reset an existing clone to the remote. With
 * no credentials, as in the setup script, link the attached checkout
 * instead. Failures are ignored: the cloud notes alone still apply.
 */
const syncPrivateDotfiles = Effect.fn("CloudSetup.syncPrivate")(function* (
  directory: string,
) {
  const fs = yield* FileSystem.FileSystem;

  if ((yield* lstatOrNull(join(directory, ".git"))) === null) {
    // A link left to an attached checkout this VM no longer has.
    if ((yield* readLinkOrNull(directory)) !== null)
      yield* fs.remove(directory);

    if (
      (yield* git([
        "clone",
        "--quiet",
        "--depth=1",
        PRIVATE_REPOSITORY_URL,
        directory,
      ])) !== null
    )
      return;

    // dot reads its tracked repositories and other private config from this
    // path, so point it at the attached checkout when cloning failed.
    if (
      (yield* lstatOrNull(join(ATTACHED_PRIVATE_DOTFILES, ".git"))) !== null
    ) {
      yield* fs.makeDirectory(dirname(directory), { recursive: true });
      yield* fs.symlink(ATTACHED_PRIVATE_DOTFILES, directory);
    }

    return;
  }

  // The attached checkout is the session's own working copy; leave it alone.
  if ((yield* readLinkOrNull(directory)) !== null) return;

  if (
    (yield* git([
      "-C",
      directory,
      "fetch",
      "--quiet",
      "--depth=1",
      "origin",
      "HEAD",
    ])) !== null
  )
    yield* git(["-C", directory, "reset", "--quiet", "--hard", "FETCH_HEAD"]);
});

/**
 * Claude Code `SessionStart` hook for cloud sessions.
 *
 * The setup script runs before the session has GitHub access, so the
 * snapshot's CLAUDE.md usually lacks the private global AGENTS.md. Claude
 * Code reads CLAUDE.md before this hook runs, so the hook clones the private
 * dotfiles, rewrites CLAUDE.md for later reloads such as compaction, and
 * passes the global instructions to this session as additional context when
 * the CLAUDE.md it started with did not have them. When the private
 * repository is not attached, the proxy can't serve it, so the context asks
 * the agent to attach it and re-run setup instead. It prints nothing else and
 * never fails, so a broken hook can't block a session.
 */
export const cloudSessionStart = Effect.gen(function* () {
  if (envString(ENV.CLAUDE_CODE_REMOTE) !== "true") return;

  const config = yield* Config;

  const loaded = (yield* readTextOrNull(CLAUDE_INSTRUCTIONS)) ?? "";

  yield* refreshPublicDotfiles(config.publicDotfiles);
  yield* syncPrivateDotfiles(PRIVATE_CLONE);

  const { content, global } = yield* buildClaudeInstructions(
    config.publicDotfiles,
    yield* findPrivateDotfiles(PRIVATE_CLONE),
  );

  if (content !== loaded)
    yield* Effect.sync(() =>
      writeFileAtomic(CLAUDE_INSTRUCTIONS, content, { createDirectory: true }),
    );

  if (hasGlobalInstructions(loaded)) return;

  // The session's GitHub proxy only serves attached repositories, so without
  // the private one attached nothing here can fetch it: ask the agent to.
  const additionalContext =
    global === null
      ? [
          "The private dotfiles (timmo001/dotfiles-private) are not attached to this cloud session, so the global agent instructions and tracked repositories from them are missing.",
          "Before other work, attach them with the add_repo tool (owner timmo001, repo dotfiles-private, read access), then run `dot cloud setup --force` and read ~/.claude/CLAUDE.md: the global instructions after its Cloud Session notes apply to this session.",
          "If add_repo is refused, tell the user once that this session runs without their global instructions, and to select timmo001/dotfiles-private when starting cloud sessions.",
        ].join(" ")
      : [
          "Global agent instructions from the private dotfiles. They were missing from ~/.claude/CLAUDE.md when this session started and apply as if they were in it, after its Cloud Session notes:",
          "",
          global.trimEnd(),
        ].join("\n");

  yield* Effect.sync(() => {
    process.stdout.write(
      `${JSON.stringify({ hookSpecificOutput: { hookEventName: "SessionStart", additionalContext } })}\n`,
    );
  });
}).pipe(Effect.ignore, Effect.withSpan("CloudSessionStart"));
