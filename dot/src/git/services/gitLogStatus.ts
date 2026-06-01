import type { GitLogCommit, GitLogRepo } from "../../types.js";
import { formatRelativeTimeAgo } from "./relativeTime.js";

/** Return a compact relative timestamp for git log UI and CLI output. */
export function formatGitLogTimeAgo(value: string | null): string {
  return formatRelativeTimeAgo(value);
}

/** Return one-line repository details for git log list displays. */
export function formatGitLogRepoDetail(repo: GitLogRepo): string {
  if (repo.error) return repo.error;
  if (repo.latestAt)
    return `latest change ${formatGitLogTimeAgo(repo.latestAt)}`;
  return "no commits";
}

/** Return one-line commit details for git log list displays. */
export function formatGitLogCommitDetail(commit: GitLogCommit): string {
  return `${formatGitLogTimeAgo(commit.committedAt)} • ${commit.authorName}`;
}
