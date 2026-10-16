import { Effect } from "effect";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { GitIssues } from "./services/GitIssues.js";
import { GitPullRequests } from "./services/GitPullRequests.js";

/** A GitHub issue or pull request the Git panel can open with a `dot://git/...` link. */
export interface GitItem {
  readonly kind: "issue" | "pull";
  /** GitHub `owner/repo` slug. */
  readonly repo: string;
  readonly number: number;
}

const SLUG = "([A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+)";

const DEEP_LINK = new RegExp(`^/(issue|pull)/${SLUG}/(\\d{1,9})/?$`);

const GITHUB_PATH = new RegExp(`^/${SLUG}/(issues|pull)/(\\d{1,9})/?$`);

/** Parse `dot://git/issue/<owner>/<repo>/<n>` or `dot://git/pull/...`. */
export function parseGitItemLink(link: string): GitItem | undefined {
  const url = URL.parse(link);

  if (url?.protocol !== "dot:" || url.hostname !== "git") return undefined;

  const [, kind, repo, number] = DEEP_LINK.exec(url.pathname) ?? [];

  return (kind === "issue" || kind === "pull") && repo && number
    ? { kind, repo, number: Number(number) }
    : undefined;
}

/** The item a GitHub issue or pull request URL points at, ignoring anchors and query strings. */
export function gitItemFromGitHubUrl(link: string): GitItem | undefined {
  const url = URL.parse(link);

  if (url?.hostname !== "github.com") return undefined;

  const [, repo, kind, number] = GITHUB_PATH.exec(url.pathname) ?? [];

  return repo && number
    ? {
        kind: kind === "issues" ? "issue" : "pull",
        repo,
        number: Number(number),
      }
    : undefined;
}

/** The `dot://` link that opens an item in the Git panel. */
export const gitItemLink = (item: GitItem) =>
  `dot://git/${item.kind}/${item.repo}/${item.number}`;

/** Icon for the link that opens an item in the Git panel, shown after its GitHub link. */
export const GIT_PANEL_ICON = "🖥️";

/** Markdown icon link that opens an item in the Git panel. */
export const gitItemPanelMarkdown = (item: GitItem) =>
  `[${GIT_PANEL_ICON}](${gitItemLink(item)})`;

/** The item's GitHub page. */
export const gitItemGitHubUrl = (item: GitItem) =>
  `https://github.com/${item.repo}/${item.kind === "issue" ? "issues" : "pull"}/${item.number}`;

/** Case-insensitive key for matching items. */
export const gitItemKey = (item: GitItem) =>
  `${item.kind}:${item.repo.toLowerCase()}#${item.number}`;

/**
 * Keys of the given items that the Git panel lists, read from the same cache
 * as the panel. Repositories without tracking for that kind list nothing.
 */
export const listedGitItems = Effect.fn("listedGitItems")(function* (
  items: readonly GitItem[],
) {
  const issues = yield* GitIssues;
  const pullRequests = yield* GitPullRequests;

  const repos = new Map(
    items.map((item) => [`${item.kind}:${item.repo.toLowerCase()}`, item]),
  );

  const listed = yield* Effect.forEach(
    repos.values(),
    ({ kind, repo }) =>
      kind === "issue"
        ? issues.query({ repo }).pipe(
            Effect.map((found) =>
              found.flatMap((entry) =>
                entry.issues.map((issue) =>
                  gitItemKey({ kind, repo, number: issue.number }),
                ),
              ),
            ),
            Effect.orElseSucceed(() => []),
          )
        : pullRequests.query({ repo }).pipe(
            Effect.map((found) =>
              found.flatMap((entry) =>
                entry.pulls.map((pull) =>
                  gitItemKey({ kind, repo, number: pull.number }),
                ),
              ),
            ),
            Effect.orElseSucceed(() => []),
          ),
    { concurrency: 4 },
  );

  return new Set(listed.flat());
});

/**
 * Open an item in the Git panel when the panel lists it. Returns false when it
 * doesn't, or the shell can't be reached, so the caller can open GitHub.
 */
export const openGitItemInPanel = Effect.fn("openGitItemInPanel")(function* (
  item: GitItem,
) {
  const listed = yield* listedGitItems([item]);

  if (!listed.has(gitItemKey(item))) return false;

  const executor = yield* CommandExecutor;

  return yield* executor
    .run("omarchy-shell", [
      "shell",
      "summon",
      "timmo.git",
      JSON.stringify({
        view: item.kind === "issue" ? "issues" : "pulls",
        repo: item.repo,
        number: item.number,
      }),
    ])
    .pipe(
      Effect.andThen(
        executor.run("omarchy-shell", [
          "timmo.git",
          item.kind === "issue" ? "issue" : "pullRequest",
          item.repo,
          String(item.number),
        ]),
      ),
      Effect.as(true),
      Effect.orElseSucceed(() => false),
    );
});
