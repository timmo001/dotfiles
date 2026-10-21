/**
 * @file Claude Code cloud session support shared by dot commands.
 *
 * A cloud session clones each repository attached to it under `/home/user`
 * rather than at the path private `dot-git.yml` gives it, and its GitHub proxy
 * only serves those attached repositories.
 */
import { Effect } from "effect";
import { isAbsolute, join, relative } from "path";
import { ENV, envString } from "./env.js";
import { readDirectoryOrNull, readTextOrNull } from "./fsProbe.js";
import {
  normalizeGitHubSlug,
  type DotGitConfig,
} from "../services/GitConfig.js";

/** Where a cloud session clones the repositories attached to it. */
export const CLOUD_CHECKOUTS_DIR = "/home/user";

/** Whether dot is running in a Claude Code cloud session. */
export const isCloudSession = () =>
  envString(ENV.CLAUDE_CODE_REMOTE) === "true";

/** Whether a path is a checkout a cloud session cloned for an attached repository. */
export const isAttachedCheckout = (path: string) => {
  const inside = relative(CLOUD_CHECKOUTS_DIR, path);

  return inside !== "" && !inside.startsWith("..") && !isAbsolute(inside);
};

const ORIGIN_URL = /\[remote "origin"\][^[]*?^\s*url\s*=\s*(\S+)/m;

/** Attached checkouts keyed by their lower-case GitHub owner/repo slug. */
const attachedCheckouts = Effect.gen(function* () {
  const checkouts = new Map<string, string>();

  for (const entry of (yield* readDirectoryOrNull(CLOUD_CHECKOUTS_DIR)) ?? []) {
    const directory = join(CLOUD_CHECKOUTS_DIR, entry);

    const url = (yield* readTextOrNull(
      join(directory, ".git", "config"),
    ))?.match(ORIGIN_URL)?.[1];

    const slug = url ? normalizeGitHubSlug(url) : null;

    if (slug) checkouts.set(slug.toLowerCase(), directory);
  }

  return checkouts;
}).pipe(Effect.withSpan("cloudSession.attachedCheckouts"));

/**
 * In a cloud session, point each tracked repository at the checkout of it
 * attached to the session, so commands that match the current directory, such
 * as `dot agent lint` and `dot repo list`, find it. Repositories that are not
 * attached keep their configured path. Outside a cloud session the config is
 * returned unchanged.
 */
export const withAttachedCheckouts = Effect.fn(
  "cloudSession.withAttachedCheckouts",
)(function* (gitConfig: DotGitConfig) {
  if (!isCloudSession()) return gitConfig;

  const checkouts = yield* attachedCheckouts;

  if (checkouts.size === 0) return gitConfig;

  const remapped: DotGitConfig = {
    ...gitConfig,
    repositories: gitConfig.repositories.map((repo) => {
      const path = checkouts.get(repo.github.toLowerCase());

      return path ? { ...repo, path } : repo;
    }),
  };

  return remapped;
});
