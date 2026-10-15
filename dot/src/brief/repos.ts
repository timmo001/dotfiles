import { Effect } from "effect";
import { managedGitRepos } from "../services/GitConfig.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";
import { pathExists } from "../lib/fsProbe.js";

/** A tracked checkout's display name and path. */
export interface TrackedCheckout {
  /** Name from the private dot git config, such as `[HA] Core`. */
  readonly name: string;
  /** Absolute checkout path. */
  readonly path: string;
}

const slugFromUrl = (url: string) =>
  /github\.com[:/]([^/\s]+\/[^/\s]+?)(?:\.git)?\/?$/
    .exec(url.trim())?.[1]
    ?.toLowerCase();

/**
 * Tracked checkouts for GitHub repositories, keyed by lower-case `owner/repo`.
 * A fork's checkout is also found by its `upstream` remote, so
 * `home-assistant/core` resolves to the `timmo001/ha-core` checkout. Remotes
 * are only read for `slugs` the config doesn't name directly.
 */
export const trackedCheckouts = Effect.fn("brief.trackedCheckouts")(function* (
  slugs: readonly string[],
) {
  const config = yield* Config;
  const executor = yield* CommandExecutor;
  const repos = managedGitRepos(config.gitConfig);

  const checkouts = new Map<string, TrackedCheckout>(
    repos.map((repo) => [
      repo.github.toLowerCase(),
      { name: repo.name, path: repo.path },
    ]),
  );

  const missing = new Set(
    slugs.flatMap((slug) =>
      checkouts.has(slug.toLowerCase()) ? [] : [slug.toLowerCase()],
    ),
  );

  if (missing.size === 0) return checkouts;

  const upstreams = yield* Effect.forEach(
    repos,
    (repo) =>
      Effect.gen(function* () {
        if (!(yield* pathExists(repo.path))) return undefined;

        const url = yield* executor
          .run("git", ["-C", repo.path, "remote", "get-url", "upstream"])
          .pipe(Effect.orElseSucceed(() => ""));

        const slug = slugFromUrl(url);

        return slug && missing.has(slug)
          ? ([slug, { name: repo.name, path: repo.path }] as const)
          : undefined;
      }),
    { concurrency: 8 },
  );

  for (const entry of upstreams) if (entry) checkouts.set(...entry);

  return checkouts;
});
