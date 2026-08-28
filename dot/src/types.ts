// --- Repository types ---

/** A tracked git repository with a display name and absolute path */
export interface Repo {
  /** Short display name (e.g. "dotfiles", "worktree:laptop") */
  readonly name: string;
  /** Absolute filesystem path to the repository root */
  readonly path: string;
}

/**
 * Classification of a tracked repository, used to scope operations such as
 * `dot update --check` to core/system repos.
 *
 * - `dotfiles`: public or private dotfiles repositories
 * - `omarchy`: Omarchy system repositories
 * - `notes`: the notes vault repository
 * - `private`: schedule-gated activity repos from `dot-git.yml`
 */
export type RepoCategory = "dotfiles" | "omarchy" | "notes" | "private";

/** Enriched repository state with git status counts for diff modes */
export interface DiffRepo {
  /** Short display name (e.g. "dotfiles", "omarchy:hypr") */
  readonly name: string;
  /** Absolute filesystem path to the repository root */
  readonly path: string;
  /** Repository classification used to scope operations like update checks */
  readonly category: RepoCategory;
  /** Whether the repo has any uncommitted changes (modified, untracked, etc.) */
  readonly isDirty: boolean;
  /** Number of modified/untracked/deleted files */
  readonly modified: number;
  /** Number of commits ahead of upstream */
  readonly ahead: number;
  /** Number of commits behind upstream */
  readonly behind: number;
}

// --- GitHub notification types ---

/** GitHub notification thread subject type. */
export type GitNotificationSubjectType =
  | "CheckSuite"
  | "Commit"
  | "Discussion"
  | "Issue"
  | "PullRequest"
  | "Release"
  | "RepositoryAdvisory"
  | "SecurityAdvisory"
  | "WorkflowRun"
  | "unknown";

/** A single GitHub notification thread from the authenticated user's inbox. */
export interface GitNotificationThread {
  /** Stable GitHub notification thread ID. */
  readonly id: string;
  /** GitHub owner/repo slug for the notification. */
  readonly repo: string;
  /** Browser URL for the repository. */
  readonly repoUrl: string;
  /** Notification subject title. */
  readonly title: string;
  /** Notification subject type. */
  readonly type: GitNotificationSubjectType;
  /** GitHub notification reason, such as `mention` or `review_requested`. */
  readonly reason: string;
  /** Whether GitHub currently marks the thread unread. */
  readonly unread: boolean;
  /** Last notification update timestamp from GitHub. */
  readonly updatedAt: string | null;
  /** Last read timestamp from GitHub, if available. */
  readonly lastReadAt: string | null;
  /** Browser URL for the notification subject, best-effort derived from the API URL. */
  readonly webUrl: string;
  /** REST API URL for the notification thread. */
  readonly apiUrl: string;
  /** REST API URL for the notification subject. */
  readonly subjectApiUrl: string | null;
  /** REST API URL for the latest comment, if GitHub provided one. */
  readonly latestCommentApiUrl: string | null;
}

/** Query options for fetching GitHub notifications. */
export interface GitNotificationQueryOptions {
  /** Include read notifications when true. */
  readonly all?: boolean;
  /** Restrict results to participating or mentioned threads when true. */
  readonly participating?: boolean;
  /** Only include notifications updated at or after this ISO timestamp. */
  readonly since?: string;
  /** Apply status-bar repo schedule and bot-activity filters. */
  readonly barFilter?: boolean;
}

/** Snapshot of the authenticated user's GitHub notification inbox. */
export interface GitNotificationState {
  /** Notification threads returned by GitHub. */
  readonly threads: readonly GitNotificationThread[];
  /** Timestamp of the last refresh attempt. */
  readonly lastChecked: Date;
  /** Active query options used to fetch this state. */
  readonly query: GitNotificationQueryOptions;
  /** Optional global status message, such as an authentication error. */
  readonly message?: string;
}

/** Mutating GitHub notification action. */
export type GitNotificationAction = "read" | "done" | "ignore" | "unignore";

/** Options for batch bot notification read actions. */
export interface GitNotificationBotReadOptions {
  /** Report matching bot notifications without mutating GitHub state. */
  readonly dryRun?: boolean;
}

/** Result from a mutating GitHub notification action. */
export interface GitNotificationActionResult {
  /** Action that was applied. */
  readonly action: GitNotificationAction;
  /** Notification thread ID the action targeted. */
  readonly threadId: string;
  /** Human-readable action result. */
  readonly message: string;
}

/** Failed batch notification mark-read attempt. */
export interface GitNotificationBotReadFailure {
  /** Notification thread that could not be marked read. */
  readonly thread: GitNotificationThread;
  /** Human-readable failure reason. */
  readonly message: string;
}

/** Summary of a batch bot notification mark-read operation. */
export interface GitNotificationBotReadResult {
  /** Whether this run only reported matches without mutating GitHub state. */
  readonly dryRun: boolean;
  /** Bot notification threads matched by the detector. */
  readonly matched: readonly GitNotificationThread[];
  /** Bot notification threads successfully marked read. */
  readonly marked: readonly GitNotificationThread[];
  /** Bot notification threads that could not be marked read. */
  readonly failed: readonly GitNotificationBotReadFailure[];
}

// --- Git staging types ---

/** Git status code for a file (first two columns of `git status --porcelain`) */
export type GitStatusCode = "M" | "A" | "D" | "R" | "C" | "U" | "?" | "!";

/** A file tracked by `git status` with its staging state */
export interface StagedFile {
  /** Relative file path within the repository */
  readonly path: string;
  /** Git status code (M=modified, A=added, D=deleted, ?=untracked, etc.) */
  readonly status: GitStatusCode;
  /** Whether this file is currently staged (in the index) */
  readonly staged: boolean;
}
