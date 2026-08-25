type JsonRecord = Record<string, unknown>;

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

const optionalNumberField = (
  record: JsonRecord,
  field: string,
): number | null => {
  const value = record[field];
  return typeof value === "number" ? value : null;
};

const booleanField = (record: JsonRecord, field: string): boolean => {
  const value = record[field];
  return typeof value === "boolean" ? value : false;
};

const optionalBooleanField = (
  record: JsonRecord,
  field: string,
): boolean | null => {
  const value = record[field];
  return typeof value === "boolean" ? value : null;
};

const stringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

const recordArray = (value: unknown): JsonRecord[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

export const parseBranchContextJSON = (text: string): JsonRecord | null => {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const escapeXml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

const limited = (value: string, max = 4_000): string =>
  value.length <= max
    ? value
    : `${value.slice(0, max)}\n[TRUNCATED ${value.length - max} CHARS]`;

const formatTag = (
  name: string,
  description: string,
  lines: readonly string[],
): string => {
  const body = [
    `Description: ${description}`,
    ...lines.filter(Boolean).map((line) => escapeXml(line)),
  ]
    .join("\n")
    .trim();
  return [`<${name}>`, body || "(empty)", `</${name}>`].join("\n");
};

const formatList = (title: string, value: string): string => {
  const text = value && value.trim() ? value.trim() : "(empty)";
  return `${title}:\n${text}`;
};

const renderBranchMetadata = (meta: JsonRecord | null): string[] => {
  if (!meta) return ["(unavailable)"];
  const remotes = stringArray(meta.remotes);
  const ahead = optionalNumberField(meta, "ahead");
  const behind = optionalNumberField(meta, "behind");
  const onDefaultBranch = optionalBooleanField(meta, "onDefaultBranch");
  return [
    `Repository: ${stringField(meta, "repositoryName") || "(unknown)"}`,
    `Repository root: ${stringField(meta, "repositoryRoot") || "(unknown)"}`,
    `Current branch: ${stringField(meta, "currentBranch") || "(unknown)"}`,
    `HEAD: ${stringField(meta, "headSha") || "(unknown)"}`,
    `Default remote: ${stringField(meta, "defaultRemote") || "(unresolved)"}`,
    `Default branch: ${stringField(meta, "defaultBranch") || "(unresolved)"}`,
    `Base ref: ${stringField(meta, "baseRef") || "(unresolved)"}`,
    `Upstream ref: ${stringField(meta, "upstreamRef") || "(none)"}`,
    `Ahead/behind base: ${ahead === null || behind === null ? "(unavailable)" : `${ahead} ahead, ${behind} behind`}`,
    `On default branch: ${onDefaultBranch === null ? "(unresolved)" : onDefaultBranch ? "yes" : "no"}`,
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
  const state = workScope ? stringField(workScope, "state") : "";
  if (state === "not-applicable" || booleanField(workScope ?? {}, "skipped")) {
    lines.push(
      "Branch scope: skipped (HEAD is on the default branch)",
      "",
      formatList("Recent commits", recentCommits),
    );
    return lines;
  }
  if (state === "unresolved") {
    const reason = workScope
      ? stringField(workScope, "reason")
      : "default branch is unresolved";
    lines.push(
      `Branch scope: unavailable (${reason || "default branch is unresolved"})`,
      "",
      formatList("Recent commits", recentCommits),
    );
    return lines;
  }
  if (state !== "collected") {
    lines.push("Branch scope: unavailable");
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
        `@${stringField(comment, "author")} (${stringField(comment, "createdAt")}): ${limited(stringField(comment, "body"), 2_000)}`,
    )
    .join("\n");
};

const renderReviews = (reviews: JsonRecord[]): string => {
  if (!reviews.length) return "(none)";
  return reviews
    .map((review) => {
      const header = `@${stringField(review, "author")} ${stringField(review, "state")}`;
      const body = limited(stringField(review, "body").trim(), 2_000);
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
    lines.push("", formatList("Description", limited(pr.description)));
  }
  if (Array.isArray(pr.comments)) {
    lines.push(
      "",
      formatList(
        "Comments",
        renderComments(recordArray(pr.comments).slice(0, 20)),
      ),
    );
  }
  if (Array.isArray(pr.reviews)) {
    lines.push(
      "",
      formatList(
        "Reviews",
        renderReviews(recordArray(pr.reviews).slice(0, 20)),
      ),
    );
  }
  if (typeof pr.checks === "string") {
    lines.push("", formatList("Checks", pr.checks));
  }
  return lines;
};

const renderTruncations = (truncations: JsonRecord[]): string[] =>
  truncations.map((truncation) => {
    const details = [
      `retained=${numberField(truncation, "retained")}`,
      `original=${numberField(truncation, "original")}`,
      stringField(truncation, "unit"),
    ].filter(Boolean);
    return `${stringField(truncation, "path") || "unknown"}: ${details.join(" ")}`;
  });

export const renderBranchContext = (
  data: JsonRecord,
  includePullRequest: boolean,
): string => {
  const meta = isRecord(data.branchMetadata) ? data.branchMetadata : null;
  const status = isRecord(data.status) ? data.status : null;
  const workScope = isRecord(data.workScope) ? data.workScope : null;
  const recentCommits = stringField(data, "commits");
  const pr = isRecord(data.pullRequest) ? data.pullRequest : null;
  const warnings = stringArray(data.warnings);
  const truncations = recordArray(data.truncations);

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

  if (truncations.length) {
    lines.push(
      formatTag(
        "truncations",
        "Applied output limits. Treat affected branch-context sections as partial.",
        renderTruncations(truncations),
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
