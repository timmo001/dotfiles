import { Effect } from "effect";
import { gitOutput } from "../lib/git.js";
import { CommandExecutor } from "../services/CommandExecutor.js";

/** Return the current named branch for a git repository, or an empty string on failure. */
export function readGitBranch(
  repoPath: string,
): Effect.Effect<string, never, CommandExecutor> {
  return gitOutput(["rev-parse", "--abbrev-ref", "HEAD"], {
    cwd: repoPath,
  }).pipe(
    Effect.catch(() => Effect.succeed("")),
    Effect.map((result) => result.trim()),
  );
}

/** Return the upstream ref for a git repository, or an empty string on failure. */
export function readGitUpstream(
  repoPath: string,
  ref = "@{u}",
): Effect.Effect<string, never, CommandExecutor> {
  return gitOutput(["rev-parse", "--abbrev-ref", ref], { cwd: repoPath }).pipe(
    Effect.catch(() => Effect.succeed("")),
    Effect.map((result) => result.trim()),
  );
}

/** Return the branch segment from an upstream ref such as origin/main. */
export function upstreamBranch(upstream: string): string {
  const slashIndex = upstream.indexOf("/");
  return slashIndex === -1 ? upstream : upstream.slice(slashIndex + 1);
}
