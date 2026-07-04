/**
 * @file Data model and options for the shared branch-context producer.
 *
 * `buildBranchContext` (see `build.ts`) collects a {@link BranchContextData}
 * snapshot from git and `gh`; the text renderer (`dot git-context`) and the
 * JSON renderer (consumed by the OpenCode branch-context plugin) both format
 * that single structured snapshot. {@link BranchContextOptions} gate which
 * sections are collected and shown.
 */

/**
 * Which branch-context sections to collect and render. Section booleans gate
 * both collection (git/gh work) and display. `since` overrides the recent
 * commit window on the default branch.
 */
export interface BranchContextOptions {
  /** Include repository/branch identity (remote, default branch, base ref). */
  readonly branchMetadata: boolean;
  /** Include working-tree status (unstaged and staged file lists). */
  readonly status: boolean;
  /** Include branch-scope aggregates (branch commits, files, diff stat). */
  readonly workScope: boolean;
  /** Include the pull request associated with the branch. */
  readonly pullRequest: boolean;
  /** Include the pull request description/body. */
  readonly description: boolean;
  /** Include the pull request labels. */
  readonly labels: boolean;
  /** Include the pull request conversation comments. */
  readonly comments: boolean;
  /** Include individual pull request reviews. */
  readonly reviews: boolean;
  /** Include CI check runs (a second `gh pr checks` call). */
  readonly checks: boolean;
  /** Append full unstaged and staged diffs beneath their sections. */
  readonly diff: boolean;
  /** Append the full merge-base diff against the default branch. */
  readonly branchDiff: boolean;
  /** Override the recent-commit window with commits after this timestamp. */
  readonly since: string | undefined;
}

/**
 * git-context default options: branch metadata, status, work scope, PR summary
 * and description on; comments, labels, reviews, checks, and full diffs off.
 */
export const GIT_CONTEXT_DEFAULTS: BranchContextOptions = {
  branchMetadata: true,
  status: true,
  workScope: true,
  pullRequest: true,
  description: true,
  labels: false,
  comments: false,
  reviews: false,
  checks: false,
  diff: false,
  branchDiff: false,
  since: undefined,
};

/** A single changed file with its status and line counts. */
export interface FileChange {
  /** Raw `--name-status` line, e.g. `M\tpath` or `R100\told\tnew`. */
  readonly raw: string;
  /** Change type letter (M/A/D/R/...). */
  readonly status: string;
  /** File path (last tab-separated field, the destination for renames). */
  readonly path: string;
  /** Whether line counts were resolved for this file (false: render no suffix). */
  readonly countsKnown: boolean;
  /** Added line count, or `null` for a binary file. */
  readonly added: number | null;
  /** Deleted line count, or `null` for a binary file. */
  readonly deleted: number | null;
}

/** Repository and branch identity used to interpret the rest of the context. */
export interface BranchMetadata {
  /** Current branch name, empty when HEAD is detached. */
  readonly currentBranch: string;
  /** Chosen default remote (upstream > origin > first). */
  readonly defaultRemote: string;
  /** Resolved default branch name (e.g. `main`). */
  readonly defaultBranch: string;
  /** Remote-qualified base ref used for push status (upstream or default). */
  readonly baseRef: string;
  /** Whether HEAD is on the repository's default branch. */
  readonly onDefaultBranch: boolean;
  /** All configured remote names, in `git remote` order. */
  readonly remotes: readonly string[];
}

/** Working-tree status: structured file lists plus the `git status -sb` line. */
export interface WorkingTreeStatus {
  /** Unstaged changed files. */
  readonly unstaged: readonly FileChange[];
  /** Staged changed files. */
  readonly staged: readonly FileChange[];
  /** Raw `git status -sb` output for the compact plugin `<status>` block. */
  readonly short: string;
}

/** Branch-scope aggregates measured against the default branch. */
export interface WorkScope {
  /** Whether these aggregates were skipped (HEAD on the default branch). */
  readonly skipped: boolean;
  /** Branch-only commits (`<base>..HEAD`) as short hash + subject. */
  readonly branchCommits: readonly {
    readonly hash: string;
    readonly subject: string;
  }[];
  /** Branch-only changed files (`<base>...HEAD` name-status). */
  readonly branchFiles: readonly FileChange[];
  /** Branch diff stat (`<base>...HEAD --stat`). */
  readonly branchDiffStat: string;
}

/** Scope information for the recent-commit list heading. */
export type CommitRange =
  | {
      readonly args: readonly string[];
      readonly kind: "branch";
      readonly sinceRef: string;
    }
  | { readonly args: readonly string[]; readonly kind: "today" }
  | {
      readonly args: readonly string[];
      readonly kind: "since";
      readonly since: string;
    }
  | { readonly args: readonly string[]; readonly kind: "recent" };

/** A single recent commit with its remote status and changed files. */
export interface CommitRecord {
  /** Committer ISO timestamp, used for heading scope labels. */
  readonly isoDate: string;
  /** Abbreviated commit hash. */
  readonly shortHash: string;
  /** Compact relative time since the commit was made (e.g. "2h ago"). */
  readonly relativeTime: string;
  /** Commit subject line. */
  readonly subject: string;
  /** Whether the commit is reachable from the remote base ref. */
  readonly pushed: boolean;
  /** Changed files for the commit, with line counts. */
  readonly files: readonly FileChange[];
}

/** Recent-commit list plus its scope metadata. */
export interface CommitsSection {
  /** Scope of the commit list (branch/today/since/recent). */
  readonly range: CommitRange;
  /** The commit records, newest first. */
  readonly records: readonly CommitRecord[];
}

/** Full-diff blocks collected when `--diff` / `--branch-diff` are set. */
export interface DiffSection {
  /** Full unstaged diff, when `--diff` is set. */
  readonly unstaged?: string;
  /** Full staged diff, when `--diff` is set. */
  readonly staged?: string;
  /** Merge-base diff against the default branch, when `--branch-diff` is set. */
  readonly branch?: BranchDiff;
}

/** Resolved default-branch diff details for `--branch-diff`. */
export interface BranchDiff {
  /** Default branch ref the diff is computed against (e.g. `origin/main`). */
  readonly ref: string;
  /** Abbreviated merge-base commit the working tree is diffed against. */
  readonly mergeBase: string;
  /** Full unified diff: committed branch work plus uncommitted edits. */
  readonly diff: string;
}

/** A single pull request conversation comment. */
export interface PullRequestComment {
  /** Comment author login. */
  readonly author: string;
  /** ISO creation timestamp. */
  readonly createdAt: string;
  /** Comment body text. */
  readonly body: string;
}

/** A single pull request review submission. */
export interface PullRequestReview {
  /** Reviewer login. */
  readonly author: string;
  /** Review state (APPROVED, CHANGES_REQUESTED, COMMENTED, ...). */
  readonly state: string;
  /** ISO submission timestamp. */
  readonly submittedAt: string;
  /** Review body text, may be empty. */
  readonly body: string;
}

/** Always-on pull request metadata block. */
export interface PullRequestSummary {
  /** Pull request number. */
  readonly number: number;
  /** Pull request state (e.g. `OPEN`, `MERGED`, `CLOSED`). */
  readonly state: string;
  /** Pull request title. */
  readonly title: string;
  /** Number of conversation comments. */
  readonly commentCount: number;
  /** Aggregate review decision (APPROVED/CHANGES_REQUESTED/REVIEW_REQUIRED). */
  readonly reviewDecision: string;
  /** Pull request URL. */
  readonly url: string;
  /** Whether the pull request is a draft. */
  readonly isDraft: boolean;
  /** Mergeability state (e.g. `CLEAN`, `BLOCKED`, `DIRTY`). */
  readonly mergeStateStatus: string;
  /** Head branch name. */
  readonly headRefName: string;
  /** Base branch name. */
  readonly baseRefName: string;
}

/** Pull request data: always-on summary plus optional detail sections. */
export interface PullRequestData {
  /** Always-on metadata summary. */
  readonly summary: PullRequestSummary;
  /** Description/body, when `description` is enabled. */
  readonly description?: string;
  /** Labels, when `labels` is enabled. */
  readonly labels?: readonly string[];
  /** Conversation comments, when `comments` is enabled. */
  readonly comments?: readonly PullRequestComment[];
  /** Individual reviews, when `reviews` is enabled. */
  readonly reviews?: readonly PullRequestReview[];
  /** CI check output (`gh pr checks` text), when `checks` is enabled. */
  readonly checks?: string;
}

/** Full structured branch-context snapshot. */
export interface BranchContextData {
  /** Whether the working directory is inside a git worktree. */
  readonly inRepo: boolean;
  /** Repository/branch identity, when `branchMetadata` is enabled. */
  readonly branchMetadata?: BranchMetadata;
  /** Working-tree status, when `status` is enabled. */
  readonly status?: WorkingTreeStatus;
  /** Branch-scope aggregates, when `workScope` is enabled. */
  readonly workScope?: WorkScope;
  /** Recent-commit list (git-context core). */
  readonly commits?: CommitsSection;
  /** Full-diff blocks, when `--diff` / `--branch-diff` are set. */
  readonly diffs?: DiffSection;
  /** Pull request data, or `null` when none applies. */
  readonly pullRequest: PullRequestData | null;
  /** Non-fatal collection issues (missing gh, PR fetch failure, truncation). */
  readonly warnings: readonly string[];
}

/** Character limits applied by the JSON renderer to bound prompt size. */
export const CHAR_LIMITS = {
  status: 12000,
  commits: 30000,
  nameStatus: 30000,
  diffStat: 20000,
  checks: 40000,
} as const;
