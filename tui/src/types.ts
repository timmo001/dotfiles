// --- Repo watcher types ---

export interface Repo {
  readonly name: string
  readonly path: string
}

export interface RepoState {
  readonly changed: readonly Repo[]
  readonly unchanged: readonly Repo[]
  readonly lastChecked: Date
}

// --- Menu types ---

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

export type MenuAction = CommandAction | SilentAction | ViewAction | SubmenuAction

export interface MenuItem {
  readonly id: string
  readonly title: string
  readonly description: string
  readonly icon: string
  readonly action: MenuAction
}
