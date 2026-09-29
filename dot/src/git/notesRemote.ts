/**
 * @file Apply each managed repository's `notes_remote` to its local Git config.
 *
 * notes reads `notes.remote` to choose which remote identifies a checkout, so
 * a fork can keep resolving against its upstream when private config says so.
 */
import { Effect, FileSystem } from "effect";
import { displayPath } from "../lib/paths.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";
import { managedGitRepos } from "../services/GitConfig.js";
import { OutputLog } from "../services/OutputLog.js";

const NOTES_REMOTE_KEY = "notes.remote";

/** Set or clear `notes.remote` in each managed checkout to match private dot-git.yml. */
export const syncNotesRemotes = Effect.gen(function* () {
  const { gitConfig } = yield* Config;
  const executor = yield* CommandExecutor;
  const fs = yield* FileSystem.FileSystem;
  const log = yield* OutputLog;

  for (const repo of managedGitRepos(gitConfig)) {
    if (!(yield* fs.exists(repo.path).pipe(Effect.orElseSucceed(() => false))))
      continue;

    const current = (yield* executor
      .run("git", ["config", "--local", "--get", NOTES_REMOTE_KEY], {
        cwd: repo.path,
      })
      .pipe(Effect.orElseSucceed(() => ""))).trim();

    const wanted = repo.notesRemote ?? "";

    if (current === wanted) continue;

    yield* executor
      .run(
        "git",
        wanted
          ? ["config", "--local", NOTES_REMOTE_KEY, wanted]
          : ["config", "--local", "--unset", NOTES_REMOTE_KEY],
        { cwd: repo.path },
      )
      .pipe(
        Effect.andThen(
          log.info(
            wanted
              ? `Set notes remote to ${wanted}: ${displayPath(repo.path)}`
              : `Cleared notes remote: ${displayPath(repo.path)}`,
          ),
        ),
        Effect.catch((error) =>
          log.warn(
            `Could not update notes remote for ${displayPath(repo.path)}: ${error.stderr.trim() || error.command}`,
          ),
        ),
      );
  }
}).pipe(Effect.withSpan("NotesRemote.sync"));
