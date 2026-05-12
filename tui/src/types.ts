// --- Repo watcher types ---

/** A tracked git repository with a display name and absolute path */
export interface Repo {
  /** Short display name (e.g. "dotfiles", "worktree:laptop") */
  readonly name: string
  /** Absolute filesystem path to the repository root */
  readonly path: string
  /** Whether `.git/index.lock` exists (stale lock from a crashed git process) */
  readonly locked: boolean
}

/** Snapshot of all tracked repositories partitioned by change status */
export interface RepoState {
  /** Repositories with uncommitted or unpushed changes */
  readonly changed: readonly Repo[]
  /** Repositories with no pending changes */
  readonly unchanged: readonly Repo[]
  /** Timestamp of the last successful poll */
  readonly lastChecked: Date
}

// --- Menu types ---

/** Identifies a top-level TUI view for navigation */
export type ViewId = "main" | "diff" | "omarchy"

/** Action that suspends the TUI and runs a command with inherited stdio */
export interface CommandAction {
  readonly type: "command"
  readonly cmd: string
  /** When true, show "Press any key to continue" before resuming the TUI */
  readonly wait: boolean
}

/** Action that runs a command in the background without suspending */
export interface SilentAction {
  readonly type: "silent"
  readonly cmd: string
}

/** Action that navigates to a sub-view within the TUI */
export interface ViewAction {
  readonly type: "view"
  readonly viewId: ViewId
}

/** Action that opens a nested submenu */
export interface SubmenuAction {
  readonly type: "submenu"
  readonly menuId: string
}

/** Discriminated union of all possible menu item actions */
export type MenuAction = CommandAction | SilentAction | ViewAction | SubmenuAction

/** A single entry in the TUI menu system */
export interface MenuItem {
  /** Stable dot-separated identifier (e.g. "update", "omarchy.theme.set") */
  readonly id: string
  /** Primary display text */
  readonly title: string
  /** Secondary text shown below the title */
  readonly description: string
  /** Nerd Font icon character */
  readonly icon: string
  /** What happens when this item is selected */
  readonly action: MenuAction
}
