// --- Repo watcher types ---

/** A tracked git repository with a display name and absolute path */
export interface Repo {
  /** Short display name (e.g. "dotfiles", "worktree:laptop") */
  readonly name: string;
  /** Absolute filesystem path to the repository root */
  readonly path: string;
  /** Whether `.git/index.lock` exists (stale lock from a crashed git process) */
  readonly locked: boolean;
}

/**
 * Classification of a tracked repository, used to scope operations such as
 * `dot update --check` to core/system repos.
 *
 * - `dotfiles`: public or private dotfiles repositories
 * - `omarchy`: Omarchy system repos (hypr, waybar, ghostty, uwsm, bootstrap)
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

/** Snapshot of all tracked repositories partitioned by change status */
export interface RepoState {
  /** Repositories with uncommitted or unpushed changes */
  readonly changed: readonly Repo[];
  /** Repositories with no pending changes */
  readonly unchanged: readonly Repo[];
  /** Timestamp of the last successful poll */
  readonly lastChecked: Date;
}

// --- Git log types ---

/** A recent commit from a tracked git repository. */
export interface GitLogCommit {
  /** Full commit SHA. */
  readonly sha: string;
  /** Short commit SHA for display. */
  readonly shortSha: string;
  /** ISO commit timestamp, or null when unavailable. */
  readonly committedAt: string | null;
  /** Commit author display name. */
  readonly authorName: string;
  /** Commit subject line. */
  readonly subject: string;
}

/** Recent commit history for one tracked git repository. */
export interface GitLogRepo {
  /** Short display name, matching the git-diff repository list. */
  readonly name: string;
  /** Absolute filesystem path to the repository root. */
  readonly path: string;
  /** Most recent commit timestamp, or null when the repo has no commits. */
  readonly latestAt: string | null;
  /** Recent commits for this repository, newest first. */
  readonly commits: readonly GitLogCommit[];
  /** Fetch or parse error for this repository, if history could not be loaded. */
  readonly error?: string;
}

/** Snapshot of recent commit history across tracked repositories. */
export interface GitLogState {
  /** Tracked repositories sorted by latest commit activity. */
  readonly repos: readonly GitLogRepo[];
  /** Timestamp of the last refresh attempt. */
  readonly lastChecked: Date;
  /** Whether a refresh is currently running. */
  readonly loading: boolean;
  /** Whether at least one refresh has completed. */
  readonly loaded: boolean;
  /** Optional global status message. */
  readonly message?: string;
}

// --- Menu types ---

/** Identifies a top-level TUI view for navigation */
export type ViewId =
  | "main"
  | "dashboard"
  | "git-diff"
  | "git-log"
  | "git-workflows"
  | "git-notifications"
  | "omarchy"
  | "output";

// --- GitHub workflow run types ---

/** GitHub Actions run status returned by `gh run list` */
export type WorkflowRunStatus =
  | "completed"
  | "in_progress"
  | "queued"
  | "requested"
  | "waiting"
  | "pending"
  | "unknown";

/** A GitHub Actions workflow run associated with a watched repo head commit */
export interface WorkflowRun {
  /** Stable GitHub run database ID */
  readonly id: string;
  /** GitHub workflow database ID for filtering disabled workflow runs */
  readonly workflowId: string | null;
  /** Workflow display name */
  readonly workflowName: string;
  /** Run title, usually the commit subject or workflow-provided title */
  readonly displayTitle: string;
  /** GitHub Actions status */
  readonly status: WorkflowRunStatus;
  /** Completed run conclusion, if available */
  readonly conclusion: string | null;
  /** Browser URL for the workflow run */
  readonly url: string;
  /** Event that triggered the run */
  readonly event: string;
  /** Run creation timestamp from GitHub */
  readonly createdAt: string | null;
  /** Run start timestamp from GitHub, updated on reruns */
  readonly startedAt: string | null;
  /** Last update timestamp from GitHub */
  readonly updatedAt: string | null;
  /** Branch the run executed for, when available from GitHub. */
  readonly headBranch?: string | null;
  /** Commit SHA the run executed for, when available from GitHub. */
  readonly headSha?: string | null;
}

/** Workflow run data for one watched GitHub repository */
export interface WorkflowRepoRuns {
  /** GitHub owner/repo slug */
  readonly slug: string;
  /** Current locally checked-out branch name used as the head branch */
  readonly branch: string | null;
  /** Current locally checked-out HEAD commit SHA */
  readonly headSha: string | null;
  /** Current locally checked-out HEAD commit subject */
  readonly commitSubject: string | null;
  /** Browser URL for the current locally checked-out HEAD commit */
  readonly commitUrl: string | null;
  /** Latest workflow runs for the current locally checked-out HEAD commit */
  readonly runs: readonly WorkflowRun[];
  /** Fetch error, if this repo could not be queried */
  readonly error?: string;
}

/** Query options for fetching watched GitHub workflow runs. */
export interface WorkflowRunQueryOptions {
  /** Only include workflow runs created, started, or updated at or after this ISO timestamp. */
  readonly since?: string;
}

/** Snapshot of all watched workflow repos and their latest run state */
export interface WorkflowState {
  /** Workflow repositories from dot-git.yml */
  readonly repos: readonly WorkflowRepoRuns[];
  /** Timestamp of the last refresh attempt */
  readonly lastChecked: Date;
  /** Whether a refresh is currently running */
  readonly loading: boolean;
  /** Whether at least one refresh has completed */
  readonly loaded: boolean;
  /** Active ISO timestamp filter for workflow run activity time */
  readonly since: string | null;
  /** Optional global status message, such as an invalid git config */
  readonly message?: string;
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
  /** Session-local thread IDs hidden after a successful Done action. */
  readonly hiddenThreadIds: readonly string[];
  /** Timestamp of the last refresh attempt. */
  readonly lastChecked: Date;
  /** Whether a refresh is currently running. */
  readonly loading: boolean;
  /** Whether at least one refresh has completed. */
  readonly loaded: boolean;
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

/** Action that suspends the TUI and runs a command with inherited stdio */
export interface CommandAction {
  readonly type: "command";
  readonly cmd: string;
  /** When true, show "Press any key to continue" before resuming the TUI */
  readonly wait: boolean;
}

/** Action that exits the TUI and then runs a command with normal CLI stdio. */
export interface ExitCommandAction {
  readonly type: "exit-command";
  readonly cmd: string;
}

/** Action that runs a command in the background without suspending */
export interface SilentAction {
  readonly type: "silent";
  readonly cmd: string;
}

/** Toast notification config for notify actions */
export interface NotifyConfig {
  /** Stable ID for grouping — a new notification with the same ID replaces the previous one */
  readonly id: string;
  /** Message shown while the command is running (e.g. "Refreshing memory...") */
  readonly progress: string;
  /** Message shown on success (e.g. "Memory refreshed") */
  readonly success: string;
}

/** Action that runs a command silently and shows toast notifications for progress/result */
export interface NotifyAction {
  readonly type: "notify";
  readonly cmd: string;
  readonly notify: NotifyConfig;
}

/** Toast variant controlling display colour */
export type ToastVariant = "info" | "success" | "error";

/** Action that navigates to a sub-view within the TUI */
export interface ViewAction {
  readonly type: "view";
  readonly viewId: ViewId;
}

/** Action that opens a nested submenu */
export interface SubmenuAction {
  readonly type: "submenu";
  readonly menuId: string;
}

/** Action that exits the TUI */
export interface QuitAction {
  readonly type: "quit";
}

/** Discriminated union of all possible menu item actions */
export type MenuAction =
  | CommandAction
  | ExitCommandAction
  | SilentAction
  | NotifyAction
  | ViewAction
  | SubmenuAction
  | QuitAction;

/** A selectable variant for a menu item offering an alternative action */
export interface MenuVariant {
  /** Short display label (e.g. "Quick", "Full") */
  readonly label: string;
  /** Optional description shown below the label in the popup */
  readonly description?: string;
  /** The action to execute when this variant is selected */
  readonly action: MenuAction;
}

/** A single entry in the TUI menu system */
export interface MenuItem {
  /** Stable dot-separated identifier (e.g. "update", "omarchy.theme.set") */
  readonly id: string;
  /** Primary display text */
  readonly title: string;
  /** Secondary text shown below the title */
  readonly description: string;
  /** Nerd Font icon character */
  readonly icon: string;
  /** What happens when this item is selected */
  readonly action: MenuAction;
  /** Optional alternative actions shown in a popup selector when present */
  readonly variants?: readonly MenuVariant[];
  /** Optional search aliases for fuzzy filter matching */
  readonly keywords?: readonly string[];
  /**
   * Group key for section grouping. When consecutive items share the same
   * group value, a non-selectable section header is rendered before the
   * first item in each group. Items without a group are rendered normally.
   */
  readonly group?: string;
}
