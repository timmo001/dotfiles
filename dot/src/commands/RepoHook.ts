import { Effect, FileSystem } from "effect";
import { Prompt } from "effect/cli";
import { isAgent } from "../lib/agent.js";
import { gitHead, gitOutput } from "../lib/git.js";
import { displayPath } from "../lib/paths.js";
import { Config } from "../services/Config.js";
import { loadDotGitConfig, managedGitRepos } from "../services/GitConfig.js";
import { OutputLog } from "../services/OutputLog.js";
import { runRepoPostUpdate } from "./Update.js";

/** Options for {@link repoHook}. */
export interface RepoHookArgs {
  /** Directory inside the repository (default: the working directory). */
  readonly path?: string;
  /** Revision HEAD was at before the pull; the prompt is skipped when HEAD still matches. */
  readonly from?: string;
}

/**
 * Offer to run a tracked repository's `post_update` command, such as after a
 * plain `git pull`. Does nothing for repositories without one, or when
 * `from` shows the pull did not move HEAD. Outside a terminal it only prints
 * the command.
 */
export const repoHook = Effect.fn("RepoHook")(function* (args: RepoHookArgs) {
  const config = yield* Config;
  const fs = yield* FileSystem.FileSystem;
  const log = yield* OutputLog;

  const root = yield* gitOutput(["rev-parse", "--show-toplevel"], {
    cwd: args.path ?? process.cwd(),
  }).pipe(Effect.map((path) => path.trim()));

  const repoPath = yield* fs.realPath(root);

  if (args.from !== undefined) {
    const head = yield* gitHead(repoPath);

    const from = yield* gitOutput(
      ["rev-parse", "--verify", `${args.from.trim()}^{commit}`],
      { cwd: repoPath },
    ).pipe(Effect.map((rev) => rev.trim()));

    if (head === from) return;
  }

  const gitConfig = config.canUsePrivate
    ? yield* loadDotGitConfig(config.gitConfig.filePath)
    : config.gitConfig;

  const repo = managedGitRepos(gitConfig).find(
    (entry) => entry.path === repoPath,
  );

  if (!repo?.postUpdate) return;

  if (isAgent() || !process.stdin.isTTY || !process.stdout.isTTY) {
    yield* log.info(
      `${repo.name} has a post-update command: ${repo.postUpdate} (run dot repo hook in ${displayPath(repoPath)} to run it)`,
    );

    return;
  }

  const run = yield* Prompt.run(
    Prompt.Confirm({
      message: `Run ${repo.name} post-update command (${repo.postUpdate})?`,
      initial: true,
    }),
  ).pipe(Effect.catchTag("QuitError", () => Effect.succeed(false)));

  if (run) yield* runRepoPostUpdate(repo);
});
