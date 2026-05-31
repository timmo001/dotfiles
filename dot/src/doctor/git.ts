import { Effect } from "effect";
import type { CommandExecutorService } from "../services/CommandExecutor.js";

/** Return the current named branch for a git repository, or an empty string on failure. */
export function readGitBranch(
  executor: Pick<CommandExecutorService, "run">,
  repoPath: string,
): Effect.Effect<string> {
  return executor
    .run("git", ["-C", repoPath, "rev-parse", "--abbrev-ref", "HEAD"])
    .pipe(
      Effect.catch(() => Effect.succeed("")),
      Effect.map((result) => result.trim()),
    );
}

/** Return the upstream ref for a git repository, or an empty string on failure. */
export function readGitUpstream(
  executor: Pick<CommandExecutorService, "run">,
  repoPath: string,
  ref = "@{u}",
): Effect.Effect<string> {
  return executor
    .run("git", ["-C", repoPath, "rev-parse", "--abbrev-ref", ref])
    .pipe(
      Effect.catch(() => Effect.succeed("")),
      Effect.map((result) => result.trim()),
    );
}

/** Return the branch segment from an upstream ref such as origin/main. */
export function upstreamBranch(upstream: string): string {
  const slashIndex = upstream.indexOf("/");
  return slashIndex === -1 ? upstream : upstream.slice(slashIndex + 1);
}
