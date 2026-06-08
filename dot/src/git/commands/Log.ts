import { Effect } from "effect";
import type { GitLogRepo, GitLogState } from "../../types.js";
import { GitLog } from "../services/GitLog.js";
import {
  formatGitLogCommitDetail,
  formatGitLogRepoDetail,
  formatGitLogTimeAgo,
} from "../services/gitLogStatus.js";
import { displayPath } from "../../lib/paths.js";
import { handleCommandError, writeText } from "./rows.js";

const handleGitLogError = handleCommandError("dot git-log");

/** CLI text output: --raw recent commit history. */
export const gitLogRaw = Effect.gen(function* () {
  const gitLog = yield* GitLog;
  yield* gitLog.refresh();
  const state = yield* gitLog.getState();
  yield* writeText(formatRaw(state));
}).pipe(Effect.withSpan("gitLog.raw"), handleGitLogError);

function formatRaw(state: GitLogState): string {
  const lines = [
    "Git Log",
    `Last checked: ${formatGitLogTimeAgo(state.lastChecked.toISOString())}`,
  ];
  if (state.message) lines.push(`Message: ${state.message}`);
  if (state.repos.length === 0) {
    lines.push("", "No tracked repositories found.");
    return lines.join("\n") + "\n";
  }

  for (const repo of state.repos) {
    appendRepoLines(lines, repo);
  }

  return lines.join("\n") + "\n";
}

function appendRepoLines(lines: string[], repo: GitLogRepo): void {
  lines.push("", repo.name, `  ${displayPath(repo.path)}`);
  lines.push(`  ${formatGitLogRepoDetail(repo)}`);

  if (repo.commits.length === 0) {
    if (!repo.error) lines.push("  No commits.");
    return;
  }

  for (const commit of repo.commits) {
    lines.push(
      `  ${commit.shortSha}  ${formatGitLogCommitDetail(commit)}  ${commit.subject}`,
    );
  }
}
