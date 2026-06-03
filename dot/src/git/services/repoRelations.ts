import { Effect } from "effect";
import type { CommandExecutorService } from "../../services/CommandExecutor.js";
import {
  normalizeGitHubSlug,
  type GitManagedRepo,
} from "../../services/GitConfig.js";

/** Return the configured GitHub slug plus the checkout's upstream GitHub slug when present. */
export function managedRepoGitHubSlugs(
  repo: GitManagedRepo,
  executor: CommandExecutorService,
) {
  return repoGitHubSlugs(repo.github, repo.path, executor);
}

/** Return a primary GitHub slug plus the checkout's upstream GitHub slug when present. */
export function repoGitHubSlugs(
  primarySlug: string,
  repoPath: string,
  executor: CommandExecutorService,
) {
  return repoUpstreamGitHubSlug(repoPath, executor).pipe(
    Effect.map((upstream) => uniqueSlugs([primarySlug, upstream])),
  );
}

/** Return a repository checkout's `upstream` remote as a GitHub slug, when configured. */
export function repoUpstreamGitHubSlug(
  repoPath: string,
  executor: CommandExecutorService,
) {
  return executor
    .run("git", ["config", "--get", "remote.upstream.url"], {
      cwd: repoPath,
    })
    .pipe(
      Effect.map((output) => normalizeGitHubSlug(output.trim())),
      Effect.catch(() => Effect.succeed(null)),
    );
}

function uniqueSlugs(slugs: readonly (string | null)[]): readonly string[] {
  const seen = new Set<string>();
  const unique: string[] = [];

  for (const slug of slugs) {
    if (!slug) continue;
    const normalized = slug.toLowerCase();
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    unique.push(slug);
  }

  return unique;
}
