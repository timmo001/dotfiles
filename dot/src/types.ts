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

/** Enriched repository state with git status counts for diff modes */
export interface DiffRepo {
  /** Short display name (e.g. "dotfiles", "omarchy:hypr") */
  readonly name: string;
  /** Absolute filesystem path to the repository root */
  readonly path: string;
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

// --- Menu types ---

/** Identifies a top-level TUI view for navigation */
export type ViewId =
  | "main"
  | "diff"
  | "omarchy"
  | "staging"
  | "commit"
  | "output";

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

/** A single AI-generated commit message suggestion */
export interface CommitSuggestion {
  /** The suggested commit message text */
  readonly message: string;
}

/** Action that suspends the TUI and runs a command with inherited stdio */
export interface CommandAction {
  readonly type: "command";
  readonly cmd: string;
  /** When true, show "Press any key to continue" before resuming the TUI */
  readonly wait: boolean;
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
