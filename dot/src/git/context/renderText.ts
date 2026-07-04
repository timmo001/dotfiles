/**
 * @file Text renderer for `dot git-context`.
 *
 * Formats a {@link BranchContextData} snapshot into the human/agent-facing text
 * output: branch header, an optional labelled pull request block, working-tree
 * sections, the recent-commit list, and optional full diffs.
 */
import { formatRelativeTimeAgo } from "../services/relativeTime.js";
import { plainStyler, type Styler } from "../../lib/ansi.js";
import type {
  BranchContextData,
  BranchMetadata,
  CommitRange,
  CommitRecord,
  FileChange,
  PullRequestComment,
  PullRequestData,
  PullRequestReview,
} from "./model.js";

/** Render a single {@link FileChange} as its name-status line plus counts. */
function formatFileChange(file: FileChange): string {
  if (!file.countsKnown) return file.raw;
  if (file.added === null || file.deleted === null)
    return `${file.raw}  (binary)`;
  return `${file.raw}  (+${file.added} -${file.deleted})`;
}

/** Render a file list, or `  (none)` when empty. */
function formatFileList(files: readonly FileChange[]): string {
  if (files.length === 0) return "  (none)";
  return files.map(formatFileChange).join("\n");
}

/** Format a count with a singular/plural noun. */
function pluralise(count: number, noun: string): string {
  return `${count} ${count === 1 ? noun : `${noun}s`}`;
}

/** Render ahead/behind counts for the base line. */
function formatAheadBehind(meta: BranchMetadata): string {
  return `${meta.ahead} ahead, ${meta.behind} behind`;
}

/** Format an ISO timestamp as a compact local `YYYY-MM-DD HH:mm` label. */
function formatHeadingDateTime(value: string | null): string {
  const date = new Date(value ?? "");
  if (!Number.isFinite(date.getTime())) return "unknown time";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

/** Build the commit-list heading with count and range context. */
function formatCommitsHeading(
  range: CommitRange,
  commits: readonly CommitRecord[],
): string {
  const count = pluralise(commits.length, "commit");
  const legend = "↑ local, ✓ pushed";
  if (range.kind === "branch") {
    return `Branch commits since ${range.sinceRef} (${count}, ${legend}):`;
  }
  if (range.kind === "today") {
    if (range.total > range.limit) {
      return `Today's commits from 00:00 (${commits.length} of ${range.total} commits, max ${range.limit}; use --since for more, ${legend}):`;
    }
    return `Today's commits from 00:00 (${count}, ${legend}):`;
  }
  if (range.kind === "since") {
    return `Recent commits since ${formatHeadingDateTime(range.since)} (${count}, ${legend}):`;
  }
  const oldest = commits[commits.length - 1];
  return `Recent commits from ${formatHeadingDateTime(oldest?.isoDate ?? null)} (${count}, ${legend}):`;
}

/** Append a blank line and a diff block when the diff has content. */
function appendDiffBlock(lines: string[], diff: string | undefined): void {
  if (!diff) return;
  lines.push("");
  lines.push(diff);
}

/** Append optional remote URL details. */
function appendRemoteDetails(
  lines: string[],
  meta: BranchMetadata,
  styler: Styler,
): void {
  if (!meta.remoteDetails) return;
  lines.push(styler.heading("Remotes:"));
  if (meta.remoteDetails.length === 0) {
    lines.push("  (none)");
    return;
  }
  for (const remote of meta.remoteDetails) {
    lines.push(`  ${remote.name}:`);
    lines.push(`    fetch: ${remote.fetchUrl || "(unknown)"}`);
    lines.push(`    push: ${remote.pushUrl || "(unknown)"}`);
  }
}

/** Append the labelled pull request block. */
function appendPullRequest(
  lines: string[],
  pr: PullRequestData,
  styler: Styler,
): void {
  const s = pr.summary;
  lines.push(styler.heading(`Pull request #${s.number}: ${s.title}`));
  lines.push(
    `  ${styler.label("State:")} ${s.state || "(unknown)"} · ${styler.label("Draft:")} ${s.isDraft ? "yes" : "no"}`,
  );
  lines.push(
    `  ${styler.label("Review decision:")} ${s.reviewDecision || "(none)"}`,
  );
  lines.push(
    `  ${styler.label("Mergeability:")} ${s.mergeStateStatus || "(unknown)"}`,
  );
  lines.push(
    `  ${styler.label("Branches:")} ${s.headRefName || "(unknown)"} → ${s.baseRefName || "(unknown)"}`,
  );
  lines.push(`  ${styler.label("Comments:")} ${s.commentCount}`);
  if (pr.labels) {
    lines.push(
      `  ${styler.label("Labels:")} ${pr.labels.length ? pr.labels.join(", ") : "(none)"}`,
    );
  }
  lines.push(`  ${styler.label("URL:")} ${s.url || "(unknown)"}`);

  if (pr.description !== undefined) {
    lines.push("");
    lines.push(`  ${styler.heading("Description:")}`);
    const body = pr.description.replace(/\r\n?/g, "\n").trim();
    if (body) {
      for (const line of body.split("\n")) lines.push(`    ${line}`);
    } else {
      lines.push("    (none)");
    }
  }

  if (pr.comments) appendComments(lines, pr.comments, styler);
  if (pr.reviews) appendReviews(lines, pr.reviews, styler);
  if (pr.checks !== undefined) appendChecks(lines, pr.checks, styler);
}

/** Append the PR comments block, indenting each comment body. */
function appendComments(
  lines: string[],
  comments: readonly PullRequestComment[],
  styler: Styler,
): void {
  lines.push("");
  lines.push(`  ${styler.heading(`Comments (${comments.length}):`)}`);
  if (comments.length === 0) {
    lines.push("    (none)");
    return;
  }
  for (const comment of comments) {
    lines.push(
      `    @${comment.author} ${formatRelativeTimeAgo(comment.createdAt)}:`,
    );
    for (const line of comment.body
      .replace(/\r\n?/g, "\n")
      .trim()
      .split("\n")) {
      lines.push(`      ${line}`);
    }
  }
}

/** Append the PR reviews block. */
function appendReviews(
  lines: string[],
  reviews: readonly PullRequestReview[],
  styler: Styler,
): void {
  lines.push("");
  lines.push(`  ${styler.heading(`Reviews (${reviews.length}):`)}`);
  if (reviews.length === 0) {
    lines.push("    (none)");
    return;
  }
  for (const review of reviews) {
    const header = `    @${review.author} ${review.state} ${formatRelativeTimeAgo(review.submittedAt)}`;
    const body = review.body.replace(/\r\n?/g, "\n").trim();
    if (body) {
      lines.push(`${header}:`);
      for (const line of body.split("\n")) lines.push(`      ${line}`);
    } else {
      lines.push(header);
    }
  }
}

/** Append the CI checks block. */
function appendChecks(lines: string[], checks: string, styler: Styler): void {
  lines.push("");
  lines.push(`  ${styler.heading("Checks:")}`);
  const trimmed = checks.trim();
  if (!trimmed) {
    lines.push("    (none)");
    return;
  }
  for (const line of trimmed.split("\n")) lines.push(`    ${line}`);
}

/**
 * Render the branch-context snapshot as `dot git-context` text output. Only the
 * sections present in {@link BranchContextData} are shown, so the enabled
 * options drive the layout. Pass a colour-emitting `styler` for interactive
 * terminal output; the default {@link plainStyler} leaves the text unstyled for
 * pipes, redirects, captured agent context, and the MCP layer.
 */
export function renderBranchContextText(
  data: BranchContextData,
  styler: Styler = plainStyler,
): string {
  if (!data.inRepo) {
    return "Not a git repository.\n";
  }

  const lines: string[] = [];
  const meta = data.branchMetadata;

  if (meta) {
    lines.push(
      `${styler.heading("Repository:")} ${meta.repositoryName || "(unknown)"} (${meta.repositoryRoot || "(unknown)"})`,
    );
    lines.push(
      `${styler.heading("Branch:")} ${meta.currentBranch || "(detached)"}${meta.headSha ? ` @ ${meta.headSha}` : ""}`,
    );
    lines.push(
      `${styler.heading("Base:")} ${meta.baseRef} (${formatAheadBehind(meta)})`,
    );
    lines.push(
      `${styler.heading("Default:")} ${meta.defaultRemote}/${meta.defaultBranch}`,
    );
    appendRemoteDetails(lines, meta, styler);
  } else {
    lines.push(`${styler.heading("Branch:")} (metadata omitted)`);
  }
  lines.push("");

  if (data.pullRequest) {
    appendPullRequest(lines, data.pullRequest, styler);
    lines.push("");
  }

  if (data.status) {
    lines.push(styler.heading("Unstaged:"));
    lines.push(formatFileList(data.status.unstaged));
    appendDiffBlock(lines, data.diffs?.unstaged);
    lines.push("");

    lines.push(styler.heading("Staged:"));
    lines.push(formatFileList(data.status.staged));
    appendDiffBlock(lines, data.diffs?.staged);
    lines.push("");

    lines.push("Untracked:");
    lines.push(formatFileList(data.status.untracked));
    lines.push("");
  }

  if (data.workScope && !data.workScope.skipped) {
    const comparisonRef =
      data.commits?.range.kind === "branch"
        ? data.commits.range.sinceRef
        : "default branch";
    lines.push(`Branch changes vs ${comparisonRef}:`);
    lines.push(formatFileList(data.workScope.branchFiles));
    if (data.workScope.branchDiffStat.trim()) {
      lines.push("");
      lines.push("Diff stat:");
      for (const line of data.workScope.branchDiffStat.split("\n")) {
        if (line.trim()) lines.push(`  ${line}`);
      }
    }
    lines.push("");
  }

  if (data.commits) {
    lines.push(
      styler.heading(
        formatCommitsHeading(data.commits.range, data.commits.records),
      ),
    );
    if (data.commits.records.length === 0) {
      lines.push("  (none)");
    } else {
      for (const commit of data.commits.records) {
        const marker = commit.pushed ? styler.success("✓") : styler.dim("↑");
        lines.push(
          `${marker} ${commit.shortHash} ${commit.relativeTime} — ${commit.subject}`,
        );
        for (const file of commit.files)
          lines.push(`    ${formatFileChange(file)}`);
      }
    }
  }

  const branchDiff = data.diffs?.branch;
  if (branchDiff) {
    lines.push("");
    lines.push(
      styler.heading(
        `Diff vs ${branchDiff.ref} (merge-base ${branchDiff.mergeBase}):`,
      ),
    );
    lines.push(branchDiff.diff || "  (no differences)");
  }

  if (data.warnings.length) {
    lines.push("");
    for (const warning of data.warnings)
      lines.push(styler.warn(`! ${warning}`));
  }

  const hint = formatHint(data);
  if (hint) {
    lines.push("");
    lines.push(styler.markdown(hint));
  }

  return lines.join("\n") + "\n";
}

/**
 * Build the trailing discoverability notes for the available flags. `null` when
 * a detail flag is already set (diffs collected). Points at the full-diff flag
 * for the current branch, then lists only the PR-detail flags not already
 * shown, plus `--json` / `--help`.
 */
function formatHint(data: BranchContextData): string | null {
  if (data.diffs !== undefined) return null;

  const notes: string[] = [];
  const range = data.commits?.range;
  if (range?.kind === "branch") {
    notes.push(
      `Run \`dot git-context --branch-diff\` for the full diff vs ${range.sinceRef}, or --diff for the working-tree diff.`,
    );
  } else {
    notes.push(
      "Run `dot git-context --diff` for the full staged and unstaged diff.",
    );
  }

  const pr = data.pullRequest;
  if (pr) {
    const missing: string[] = [];
    if (pr.comments === undefined) missing.push("--comments");
    if (pr.reviews === undefined) missing.push("--reviews");
    if (pr.labels === undefined) missing.push("--labels");
    if (pr.checks === undefined) missing.push("--checks");
    if (missing.length) {
      const list =
        missing.length === 1
          ? missing[0]
          : missing.length === 2
            ? `${missing[0]} or ${missing[1]}`
            : `${missing.slice(0, -1).join(", ")}, or ${missing[missing.length - 1]}`;
      notes.push(`Add ${list} for more PR detail.`);
    }
  }

  notes.push("Use --json for the branch-context plugin payload.");
  notes.push("`dot git-context --help` lists all flags.");
  return notes.join("\n");
}
