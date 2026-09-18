import { Effect } from "effect";
import type { DependencyPolicy } from "./config.js";
import {
  DependencyDiscoveryError,
  type Extraction,
  type Snapshot,
  type Dependency,
} from "./model.js";
import { matchesPatterns } from "./rules.js";
import { extractPackages } from "./managers/packages.js";
import { extractMise } from "./managers/mise.js";
import { extractGithubActions } from "./managers/githubActions.js";
import { extractSubmodules } from "./managers/submodules.js";
import { extractRegex } from "./managers/regex.js";

const defaults = {
  npm: ["**/package.json"],
  bun: ["**/bun.lock", "**/bun.lockb"],
  mise: [
    "**/{,.}mise{,.*}.toml",
    "**/{,.}mise/config{,.*}.toml",
    "**/.config/mise/config.toml",
  ],
  "github-actions": [".github/workflows/*.{yml,yaml}", "**/action.{yml,yaml}"],
  "git-submodules": [".gitmodules"],
};

/** Select supported manager files while respecting imported path exclusions. */
export function managerFiles(
  policy: DependencyPolicy,
  manager: string,
  file: string,
): boolean {
  return (
    (!policy.ignorePaths?.length ||
      !matchesPatterns(file, policy.ignorePaths)) &&
    (!policy.enabledManagers?.length ||
      policy.enabledManagers.includes(manager)) &&
    matchesPatterns(file, [
      ...(Object.entries(defaults).find(([name]) => name === manager)?.[1] ??
        []),
      ...(policy.managers[manager]?.files ?? []),
    ])
  );
}

/** Identify snapshot blobs needed by native extraction, without traversing submodules. */
export function dependencyFile(
  policy: DependencyPolicy,
  file: string,
): boolean {
  return (
    /(^|\/)\.npmrc$/.test(file) ||
    Object.keys(defaults).some((manager) =>
      managerFiles(policy, manager, file),
    ) ||
    ((!policy.enabledManagers?.length ||
      policy.enabledManagers.includes("custom.regex")) &&
      (!policy.ignorePaths?.length ||
        !matchesPatterns(file, policy.ignorePaths)) &&
      policy.regexManagers.some((manager) =>
        matchesPatterns(file, manager.files),
      ))
  );
}

/** Extract once from pinned text; adapter errors become explicit discovery failures. */
export const extractDependencies = Effect.fn("Dependencies.extract")(function* (
  snapshot: Snapshot,
  policy: DependencyPolicy,
): Effect.fn.Return<Extraction, DependencyDiscoveryError> {
  const dependencies: Dependency[] = [];
  const blockers: string[] = [];

  for (const [file, text] of Object.entries(snapshot.files)) {
    const results: Extraction[] = [];

    if (
      /(^|\/)\.npmrc$/.test(file) &&
      /(?:registry|_auth|token)\s*=/i.test(text)
    )
      blockers.push(
        `${file}: package registry or authentication overrides require native support`,
      );

    if (managerFiles(policy, "npm", file) && file.endsWith("package.json"))
      results.push(yield* extractPackages(file, text, snapshot.files));

    if (managerFiles(policy, "mise", file))
      results.push(yield* extractMise(file, text));

    if (managerFiles(policy, "github-actions", file))
      results.push(yield* extractGithubActions(file, text));

    if (managerFiles(policy, "git-submodules", file))
      results.push(extractSubmodules(file, text, snapshot.tree));

    if (
      (!policy.enabledManagers?.length ||
        policy.enabledManagers.includes("custom.regex")) &&
      (!policy.ignorePaths?.length ||
        !matchesPatterns(file, policy.ignorePaths))
    )
      results.push(
        yield* Effect.try({
          try: () => extractRegex(file, text, policy.regexManagers),
          catch: () =>
            new DependencyDiscoveryError({
              message: `${file}: invalid regex or template`,
            }),
        }),
      );

    for (const result of results) {
      dependencies.push(...result.dependencies);
      blockers.push(...result.blockers);
    }
  }

  for (const manager of policy.enabledManagers ?? [])
    if (!(manager in defaults) && manager !== "custom.regex")
      blockers.push(`Unsupported enabled manager: ${manager}`);

  return { dependencies, blockers };
});
