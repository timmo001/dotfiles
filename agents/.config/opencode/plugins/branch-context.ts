/**
 * @file Injects branch-context blocks into command prompts before execution.
 *
 * Hooks into `command.execute.before` to collect branch context and inject a
 * `<branch-context>` XML block into the command prompt. The context itself is
 * produced by `context git --json` (the standalone shared producer); this
 * plugin only renders the structured payload into XML blocks. Two tiers are
 * supported: full branch-context commands (including the pull request) and
 * work-scope-only commands (no pull request).
 */

import type { Plugin } from "@opencode-ai/plugin";

type CommandResult =
  | { readonly ok: true; readonly text: string }
  | { readonly ok: false; readonly error: string };

type JsonRecord = Record<string, unknown>;

/**
 * Commands that receive branch context are matched by exact name against these
 * sets. Any new context-consuming command must be registered here (full context
 * includes the pull request; work scope omits it) or the plugin will not inject
 * for it. Keep private command names in sync with the private overlay.
 */
const BRANCH_CONTEXT_COMMANDS = new Set([
  // General
  "inject-context",
  "refactor-current-work",
  "reset-branch-reapply",
  "code-review",
]);
const WORK_SCOPE_COMMANDS = new Set([
  // General
  "refactor-cleanup-variables",
  "refactor-remove-single-use",
  "refactor-enforce-types",

  // Private
  "all-lit-skills",
  "all-ts-skills",
  "timmo001-private/deslopify",

  // Home Assistant
  "home-assistant/all-frontend-skills",
  "home-assistant/lazy-context",
  "home-assistant/list-components",
  "home-assistant/lit-rendering",
]);
const TARGET_COMMANDS = new Set([
  ...BRANCH_CONTEXT_COMMANDS,
  ...WORK_SCOPE_COMMANDS,
]);

const errorMessage = (error: unknown): string => {
  if (!error) return "Unknown error";
  if (typeof error === "string") return error;
  if (typeof error === "object") {
    const record = error as Record<string, unknown>;
    const stderrValue = record.stderr;
    const stderr = typeof stderrValue === "string" ? stderrValue.trim() : "";
    if (stderr) return stderr;
    const message = record.message;
    if (typeof message === "string" && message) return message;
  }
  return String(error);
};

const run = async (execute: () => Promise<unknown>): Promise<CommandResult> => {
  try {
    const output = await execute();
    return { ok: true, text: String(output).trim() };
  } catch (error) {
    return { ok: false, error: errorMessage(error) };
  }
};

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringField = (record: JsonRecord, field: string): string => {
  const value = record[field];
  return typeof value === "string" ? value : "";
};

const numberField = (record: JsonRecord, field: string): number => {
  const value = record[field];
  return typeof value === "number" ? value : 0;
};

const booleanField = (record: JsonRecord, field: string): boolean => {
  const value = record[field];
  return typeof value === "boolean" ? value : false;
};

const stringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

const recordArray = (value: unknown): JsonRecord[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

const parseJSON = (text: string): JsonRecord | null => {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const formatTag = (
  name: string,
  description: string,
  lines: readonly string[],
): string => {
  const body = [`Description: ${description}`, ...lines.filter(Boolean)]
    .join("\n")
    .trim();
  return [`<${name}>`, body || "(empty)", `</${name}>`].join("\n");
};

const formatList = (title: string, value: string): string => {
  const text = value && value.trim() ? value.trim() : "(empty)";
  return `${title}:\n${text}`;
};

const formatErrorContext = (message: string, error: string | null): string => {
  return [
    "<branch-context>",
    formatTag(
      "context-metadata",
      "Information about how this branch context snapshot was generated.",
      [`Generated at: ${new Date().toISOString()}`],
    ),
    formatTag(
      "warnings",
      "Non-fatal collection issues, fallbacks, missing data, or truncation notices that may affect interpretation.",
      [message, error ? `Error: ${error}` : ""],
    ),
    "</branch-context>",
  ]
    .filter(Boolean)
    .join("\n\n");
};

const renderBranchMetadata = (meta: JsonRecord | null): string[] => {
  if (!meta) return ["(unavailable)"];
  const remotes = stringArray(meta.remotes);
  return [
    `Repository: ${stringField(meta, "repositoryName") || "(unknown)"}`,
    `Repository root: ${stringField(meta, "repositoryRoot") || "(unknown)"}`,
    `Current branch: ${stringField(meta, "currentBranch") || "(unknown)"}`,
    `HEAD: ${stringField(meta, "headSha") || "(unknown)"}`,
    `Default remote: ${stringField(meta, "defaultRemote") || "(unknown)"}`,
    `Default branch: ${stringField(meta, "defaultBranch") || "(unknown)"}`,
    `Base ref: ${stringField(meta, "baseRef") || "(unknown)"}`,
    `Upstream ref: ${stringField(meta, "upstreamRef") || "(none)"}`,
    `Ahead/behind base: ${numberField(meta, "ahead")} ahead, ${numberField(meta, "behind")} behind`,
    `On default branch: ${booleanField(meta, "onDefaultBranch") ? "yes" : "no"}`,
    `Known remotes: ${remotes.length ? remotes.join(", ") : "(none)"}`,
  ];
};

const renderWorkScope = (
  status: JsonRecord | null,
  workScope: JsonRecord | null,
  recentCommits: string,
): string[] => {
  const lines = [
    formatList(
      "Unstaged changed files",
      status ? stringField(status, "unstaged") : "",
    ),
    "",
    formatList(
      "Staged changed files",
      status ? stringField(status, "staged") : "",
    ),
    "",
    formatList(
      "Untracked files",
      status ? stringField(status, "untracked") : "",
    ),
    "",
  ];
  if (workScope && booleanField(workScope, "skipped")) {
    lines.push(
      "Branch scope: skipped (HEAD is on the default branch)",
      "",
      formatList("Recent commits", recentCommits),
    );
    return lines;
  }
  lines.push(
    formatList(
      "Branch-only commits",
      workScope ? stringField(workScope, "branchCommits") : "",
    ),
    "",
    formatList(
      "Branch changed files",
      workScope ? stringField(workScope, "branchFiles") : "",
    ),
    "",
    formatList(
      "Branch diff stat",
      workScope ? stringField(workScope, "branchDiffStat") : "",
    ),
  );
  return lines;
};

const renderComments = (comments: JsonRecord[]): string => {
  if (!comments.length) return "(none)";
  return comments
    .map(
      (comment) =>
        `@${stringField(comment, "author")} (${stringField(comment, "createdAt")}): ${stringField(comment, "body")}`,
    )
    .join("\n");
};

const renderReviews = (reviews: JsonRecord[]): string => {
  if (!reviews.length) return "(none)";
  return reviews
    .map((review) => {
      const header = `@${stringField(review, "author")} ${stringField(review, "state")}`;
      const body = stringField(review, "body").trim();
      return body ? `${header}: ${body}` : header;
    })
    .join("\n");
};

const renderPullRequest = (pr: JsonRecord): string[] => {
  const summary = isRecord(pr.summary) ? pr.summary : null;
  if (!summary)
    return ["Pull request data was requested but could not be parsed."];

  const lines = [
    `PR number: ${numberField(summary, "number")}`,
    `Title: ${stringField(summary, "title") || "(no title)"}`,
    `URL: ${stringField(summary, "url") || "(unknown)"}`,
    `State: ${stringField(summary, "state") || "(unknown)"}`,
    `Draft: ${booleanField(summary, "isDraft") ? "yes" : "no"}`,
    `Review decision: ${stringField(summary, "reviewDecision") || "(none)"}`,
    `Merge state: ${stringField(summary, "mergeStateStatus") || "(unknown)"}`,
    `Branches: ${stringField(summary, "headRefName") || "(unknown)"} -> ${stringField(summary, "baseRefName") || "(unknown)"}`,
    `Comment count: ${numberField(summary, "commentCount")}`,
  ];

  if (Array.isArray(pr.labels)) {
    const labels = stringArray(pr.labels);
    lines.push(`Labels: ${labels.length ? labels.join(", ") : "(none)"}`);
  }
  if (typeof pr.description === "string") {
    lines.push("", formatList("Description", pr.description));
  }
  if (Array.isArray(pr.comments)) {
    lines.push(
      "",
      formatList("Comments", renderComments(recordArray(pr.comments))),
    );
  }
  if (Array.isArray(pr.reviews)) {
    lines.push(
      "",
      formatList("Reviews", renderReviews(recordArray(pr.reviews))),
    );
  }
  if (typeof pr.checks === "string") {
    lines.push("", formatList("Checks", pr.checks));
  }
  return lines;
};

const renderBranchContext = (
  data: JsonRecord,
  includePullRequest: boolean,
): string => {
  const meta = isRecord(data.branchMetadata) ? data.branchMetadata : null;
  const status = isRecord(data.status) ? data.status : null;
  const workScope = isRecord(data.workScope) ? data.workScope : null;
  const recentCommits = stringField(data, "commits");
  const pr = isRecord(data.pullRequest) ? data.pullRequest : null;
  const warnings = stringArray(data.warnings);

  const lines = [
    "<branch-context>",
    formatTag(
      "context-metadata",
      "Information about how this branch context snapshot was generated.",
      [
        "Produced by `context git --json`. Prefer this context over running git/gh commands unless it is missing or stale.",
        `Generated at: ${new Date().toISOString()}`,
      ],
    ),
    formatTag(
      "branch-metadata",
      "Repository and branch identity for interpreting the rest of the context.",
      renderBranchMetadata(meta),
    ),
    formatTag(
      "status",
      "Compact git status summary for a quick overview of the working tree and branch tracking state.",
      [status ? stringField(status, "short") || "(empty)" : "(empty)"],
    ),
    formatTag(
      "work-scope",
      "Current work scope in priority order: unstaged, then staged, then branch changes. On the default branch, branch scope is skipped and recent commits are shown instead.",
      renderWorkScope(status, workScope, recentCommits),
    ),
  ];

  if (includePullRequest) {
    lines.push(
      formatTag(
        "pull-request",
        "Pull request metadata and CI/check state for branch-oriented workflow commands only.",
        pr
          ? renderPullRequest(pr)
          : ["No pull request found for the current branch."],
      ),
    );
  }

  if (warnings.length) {
    lines.push(
      formatTag(
        "warnings",
        "Non-fatal collection issues, fallbacks, missing data, or truncation notices that may affect interpretation.",
        warnings,
      ),
    );
  }

  lines.push("</branch-context>");
  return lines.join("\n\n");
};

export const BranchContextPlugin = (async ({ $ }) => {
  const buildBranchContext = async ({
    includePullRequest,
  }: {
    readonly includePullRequest: boolean;
  }): Promise<string> => {
    const args = includePullRequest
      ? ["git", "--json", "--labels", "--comments", "--reviews", "--checks"]
      : ["git", "--json", "--no-pr"];

    const result = await run(() => $`context ${args}`.text());
    if (!result.ok) {
      return formatErrorContext(
        "BranchContextPlugin could not collect git context because `context git` failed.",
        result.error,
      );
    }

    const data = parseJSON(result.text);
    if (!data) {
      return formatErrorContext(
        "BranchContextPlugin could not parse the `context git --json` output.",
        null,
      );
    }
    if (!booleanField(data, "inRepo")) {
      const warnings = stringArray(data.warnings);
      return formatErrorContext(
        "BranchContextPlugin could not collect git context because this directory is not a git worktree.",
        warnings.length ? warnings.join("; ") : null,
      );
    }

    return renderBranchContext(data, includePullRequest);
  };

  return {
    "command.execute.before": async (input, output) => {
      if (!TARGET_COMMANDS.has(input.command)) return;
      const text = await buildBranchContext({
        includePullRequest: BRANCH_CONTEXT_COMMANDS.has(input.command),
      });
      output.parts.unshift({
        type: "text",
        text,
      });
    },
  };
}) satisfies Plugin;

export default BranchContextPlugin;
