/**
 * @file JSON renderer for `dot git-context --json`.
 *
 * Serialises a {@link BranchContextData} snapshot into the structured payload
 * the OpenCode branch-context plugin consumes. Section text blocks are
 * pre-truncated here (via {@link CHAR_LIMITS}) so prompt-size bounding lives in
 * one place and the plugin stays a thin XML renderer.
 */
import { CHAR_LIMITS } from "./model.js";
import type {
  BranchContextData,
  FileChange,
  PullRequestData,
} from "./model.js";

/** Truncate text to a character budget, appending a notice when it overflows. */
function limited(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n\n[TRUNCATED ${text.length - max} CHARS]`;
}

/** Join `--name-status` raw lines. */
function nameStatusText(files: readonly FileChange[]): string {
  return files.map((file) => file.raw).join("\n");
}

/** Serialised pull request block for the JSON payload. */
interface PullRequestJson {
  readonly summary: PullRequestData["summary"];
  readonly description?: string;
  readonly labels?: readonly string[];
  readonly comments?: PullRequestData["comments"];
  readonly reviews?: PullRequestData["reviews"];
  readonly checks?: string;
}

/** Serialise the pull request block, truncating the checks text. */
function toPullRequestJson(pr: PullRequestData): PullRequestJson {
  return {
    summary: pr.summary,
    ...(pr.description !== undefined ? { description: pr.description } : {}),
    ...(pr.labels !== undefined ? { labels: pr.labels } : {}),
    ...(pr.comments !== undefined ? { comments: pr.comments } : {}),
    ...(pr.reviews !== undefined ? { reviews: pr.reviews } : {}),
    ...(pr.checks !== undefined
      ? { checks: limited(pr.checks, CHAR_LIMITS.checks) }
      : {}),
  };
}

/**
 * Render the branch-context snapshot as the JSON payload consumed by the
 * plugin. Only enabled sections are present; `pullRequest` is `null` when none
 * applies, and `inRepo: false` signals the plugin to emit its error block.
 */
export function renderBranchContextJson(data: BranchContextData): string {
  if (!data.inRepo) {
    return JSON.stringify({
      inRepo: false,
      pullRequest: null,
      warnings: data.warnings,
    });
  }

  const payload = {
    inRepo: true,
    ...(data.branchMetadata ? { branchMetadata: data.branchMetadata } : {}),
    ...(data.status
      ? {
          status: {
            short: limited(data.status.short, CHAR_LIMITS.status),
            unstaged: limited(
              nameStatusText(data.status.unstaged),
              CHAR_LIMITS.nameStatus,
            ),
            staged: limited(
              nameStatusText(data.status.staged),
              CHAR_LIMITS.nameStatus,
            ),
          },
        }
      : {}),
    ...(data.workScope
      ? {
          workScope: {
            skipped: data.workScope.skipped,
            branchCommits: limited(
              data.workScope.branchCommits
                .map((commit) => `${commit.hash} ${commit.subject}`.trimEnd())
                .join("\n"),
              CHAR_LIMITS.commits,
            ),
            branchFiles: limited(
              nameStatusText(data.workScope.branchFiles),
              CHAR_LIMITS.nameStatus,
            ),
            branchDiffStat: limited(
              data.workScope.branchDiffStat,
              CHAR_LIMITS.diffStat,
            ),
          },
        }
      : {}),
    pullRequest: data.pullRequest ? toPullRequestJson(data.pullRequest) : null,
    warnings: data.warnings,
  };

  return JSON.stringify(payload);
}
