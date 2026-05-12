import {
  type CliRenderer,
  BoxRenderable,
  TextRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  type SelectOption,
  t,
  fg,
} from "@opentui/core"
import { unlinkSync } from "node:fs"
import { join } from "node:path"
import type { Repo, RepoState } from "../types.js"
import { formatBreadcrumb } from "./breadcrumb.js"

/** Configuration callbacks and initial state for the diff view */
export interface DiffViewOptions {
  /** Called when the user selects a repo (e.g. to open lazygit) */
  readonly onSelect: (repo: Repo) => void
  /** Called when the user presses 'c' to open the commit/staging flow for the selected repo */
  readonly onCommit: (repo: Repo) => void
  /** Called to open a tmux session — "changed" repos when the Changed pane is active, "all" when Other */
  readonly onOpenTmux: (mode: "changed" | "all") => void
  /** Called to open a plain terminal in the selected repo's directory */
  readonly onOpenTerminal: (repo: Repo) => void
  /** Called to open the selected repo on GitHub in the browser */
  readonly onOpenWeb: (repo: Repo) => void
  /** Called when the user requests a manual refresh */
  readonly onRefresh: () => void
  /** Called when the user navigates back (Escape/Backspace) */
  readonly onBack: () => void
  /** Which pane to focus on startup (default: "changed") */
  readonly initialTab?: Pane
}

type Pane = "changed" | "unchanged"

/** Two-pane diff view showing Changed and Other repositories with a status bar */
export class DiffView {
  private renderer: CliRenderer
  private callbacks: DiffViewOptions

  private root: BoxRenderable
  private changedSelect: SelectRenderable
  private unchangedSelect: SelectRenderable
  private changedTitle: TextRenderable
  private unchangedTitle: TextRenderable
  private statusBar: TextRenderable

  private activePane: Pane = "changed"
  private changedRepos: readonly Repo[] = []
  private unchangedRepos: readonly Repo[] = []
  private lastChecked: Date = new Date()
  private isVisible = false

  constructor(renderer: CliRenderer, callbacks: DiffViewOptions) {
    this.renderer = renderer
    this.callbacks = callbacks

    // Root container — full screen
    this.root = new BoxRenderable(renderer, {
      id: "diff-root",
      flexDirection: "column",
      width: "100%",
      height: "100%",
      padding: 1,
    })

    // Title bar — breadcrumb style matching other subviews
    const titleBar = new TextRenderable(renderer, {
      id: "diff-title-bar",
      content: formatBreadcrumb(["Dot", "Diff"], "repo watcher"),
      marginBottom: 1,
    })
    this.root.add(titleBar)

    // Two-pane container
    const paneContainer = new BoxRenderable(renderer, {
      id: "diff-pane-container",
      flexDirection: "row",
      flexGrow: 1,
      gap: 2,
    })

    // --- Left pane: Changed ---
    const leftPane = new BoxRenderable(renderer, {
      id: "diff-left-pane",
      flexDirection: "column",
      flexGrow: 1,
      flexBasis: 0,
    })

    this.changedTitle = new TextRenderable(renderer, {
      id: "diff-changed-title",
      content: this.formatPaneTitle("Changed", 0, true),
      marginBottom: 0,
    })
    leftPane.add(this.changedTitle)

    this.changedSelect = new SelectRenderable(renderer, {
      id: "diff-changed-select",
      flexGrow: 1,
      width: "100%",
      options: [],
      backgroundColor: "#161b22",
      focusedBackgroundColor: "#161b22",
      selectedBackgroundColor: "#1f6feb",
      selectedTextColor: "#ffffff",
      textColor: "#c9d1d9",
      focusedTextColor: "#c9d1d9",
      descriptionColor: "#8b949e",
      selectedDescriptionColor: "#c9d1d9",
      showDescription: true,
      showScrollIndicator: true,
      wrapSelection: true,
    })
    leftPane.add(this.changedSelect)

    // --- Right pane: Unchanged ---
    const rightPane = new BoxRenderable(renderer, {
      id: "diff-right-pane",
      flexDirection: "column",
      flexGrow: 1,
      flexBasis: 0,
    })

    this.unchangedTitle = new TextRenderable(renderer, {
      id: "diff-unchanged-title",
      content: this.formatPaneTitle("Other", 0, false),
      marginBottom: 0,
    })
    rightPane.add(this.unchangedTitle)

    this.unchangedSelect = new SelectRenderable(renderer, {
      id: "diff-unchanged-select",
      flexGrow: 1,
      width: "100%",
      options: [],
      backgroundColor: "#161b22",
      focusedBackgroundColor: "#161b22",
      selectedBackgroundColor: "#30363d",
      selectedTextColor: "#c9d1d9",
      textColor: "#8b949e",
      focusedTextColor: "#8b949e",
      descriptionColor: "#484f58",
      selectedDescriptionColor: "#8b949e",
      showDescription: true,
      showScrollIndicator: true,
      wrapSelection: true,
    })
    rightPane.add(this.unchangedSelect)

    paneContainer.add(leftPane)
    paneContainer.add(rightPane)
    this.root.add(paneContainer)

    // Status bar
    this.statusBar = new TextRenderable(renderer, {
      id: "diff-status-bar",
      content: t`${fg("#8b949e")("Loading...")}`,
      marginTop: 1,
    })
    this.root.add(this.statusBar)

    // Help bar
    const helpBar = new TextRenderable(renderer, {
      id: "diff-help-bar",
      content: t`${fg("#484f58")("↑↓ navigate   Tab pane   Enter lazygit   c commit   x unlock   t tmux   o open   w web   r refresh   Esc back   q quit")}`,
    })
    this.root.add(helpBar)

    renderer.root.add(this.root)

    // Wire up select events
    this.changedSelect.on(SelectRenderableEvents.ITEM_SELECTED, (_index: number, option: SelectOption) => {
      const repo = this.changedRepos.find((r) => r.path === option.value)
      if (repo) this.callbacks.onSelect(repo)
    })

    this.unchangedSelect.on(SelectRenderableEvents.ITEM_SELECTED, (_index: number, option: SelectOption) => {
      const repo = this.unchangedRepos.find((r) => r.path === option.value)
      if (repo) this.callbacks.onSelect(repo)
    })

    // Keyboard handling
    renderer.keyInput.on("keypress", (key) => {
      // Only handle keys when this view is visible
      if (!this.isVisible) return

      if (key.name === "tab") {
        this.togglePane()
      } else if (key.name === "c") {
        const repo = this.getActiveRepo()
        if (repo) this.callbacks.onCommit(repo)
      } else if (key.name === "t") {
        this.callbacks.onOpenTmux(this.activePane === "changed" ? "changed" : "all")
      } else if (key.name === "o") {
        const repo = this.getActiveRepo()
        if (repo) this.callbacks.onOpenTerminal(repo)
      } else if (key.name === "w") {
        const repo = this.getActiveRepo()
        if (repo) this.callbacks.onOpenWeb(repo)
      } else if (key.name === "r") {
        this.statusBar.content = t`${fg("#d29922")("Refreshing...")}`
        this.callbacks.onRefresh()
      } else if (key.name === "x") {
        this.removeLock()
      } else if (key.name === "escape" || key.name === "backspace") {
        this.callbacks.onBack()
      }
    })

    // Focus the initial pane
    this.activePane = callbacks.initialTab ?? "changed"
    this.focusPane(this.activePane)

    // Update titles to reflect initial pane
    this.changedTitle.content = this.formatPaneTitle("Changed", 0, this.activePane === "changed")
    this.unchangedTitle.content = this.formatPaneTitle("Other", 0, this.activePane === "unchanged")
  }

  /** Update both panes and the status bar with a new repo state snapshot */
  update(state: RepoState): void {
    this.changedRepos = state.changed
    this.unchangedRepos = state.unchanged
    this.lastChecked = state.lastChecked

    // Update changed list
    this.changedSelect.options = state.changed.map((repo) => ({
      name: this.formatRepoName(repo),
      description: this.shortenPath(repo.path),
      value: repo.path,
    }))

    // Update unchanged list
    this.unchangedSelect.options = state.unchanged.map((repo) => ({
      name: this.formatRepoName(repo),
      description: this.shortenPath(repo.path),
      value: repo.path,
    }))

    // Update titles
    this.changedTitle.content = this.formatPaneTitle(
      "Changed",
      state.changed.length,
      this.activePane === "changed",
    )
    this.unchangedTitle.content = this.formatPaneTitle(
      "Other",
      state.unchanged.length,
      this.activePane === "unchanged",
    )

    // Update status bar
    this.updateStatusBar()
  }

  /** Show or hide the diff view */
  setVisible(visible: boolean): void {
    this.root.visible = visible
    this.isVisible = visible
  }

  /** Give keyboard focus to the currently active pane */
  focus(): void {
    this.focusPane(this.activePane)
  }

  private togglePane(): void {
    this.activePane = this.activePane === "changed" ? "unchanged" : "changed"
    this.focusPane(this.activePane)

    this.changedTitle.content = this.formatPaneTitle(
      "Changed",
      this.changedRepos.length,
      this.activePane === "changed",
    )
    this.unchangedTitle.content = this.formatPaneTitle(
      "Other",
      this.unchangedRepos.length,
      this.activePane === "unchanged",
    )
  }

  private focusPane(pane: Pane): void {
    if (pane === "changed") {
      this.unchangedSelect.blur()
      this.changedSelect.focus()
    } else {
      this.changedSelect.blur()
      this.unchangedSelect.focus()
    }
  }

  /** Return the repo currently highlighted in the active pane, if any */
  private getActiveRepo(): Repo | undefined {
    if (this.activePane === "changed") {
      const opt = this.changedSelect.getSelectedOption()
      return opt ? this.changedRepos.find((r) => r.path === opt.value) : undefined
    }
    const opt = this.unchangedSelect.getSelectedOption()
    return opt ? this.unchangedRepos.find((r) => r.path === opt.value) : undefined
  }

  private formatPaneTitle(label: string, count: number, active: boolean) {
    const indicator = active ? "▸" : " "
    const color = active ? "#58a6ff" : "#8b949e"
    const countColor = label === "Changed" && count > 0 ? "#f85149" : "#8b949e"
    return t`${fg(color)(`${indicator} ${label}`)} ${fg(countColor)(`(${count})`)}`
  }

  /** Format a repo name with a lock indicator when `.git/index.lock` exists */
  private formatRepoName(repo: Repo): string {
    return repo.locked ? `󰌾 ${repo.name}` : repo.name
  }

  /** Remove `.git/index.lock` for the selected repo and trigger a refresh */
  private removeLock(): void {
    const repo = this.getActiveRepo()
    if (!repo) return

    if (!repo.locked) {
      this.statusBar.content = t`${fg("#8b949e")(`${repo.name} has no lock file`)}`
      return
    }

    const lockPath = join(repo.path, ".git", "index.lock")
    try {
      unlinkSync(lockPath)
      this.statusBar.content = t`${fg("#3fb950")(`Removed index.lock from ${repo.name}`)}`
      this.callbacks.onRefresh()
    } catch {
      this.statusBar.content = t`${fg("#f85149")(`Failed to remove index.lock from ${repo.name}`)}`
    }
  }

  private updateStatusBar(): void {
    const ago = this.formatTimeAgo(this.lastChecked)
    const changedCount = this.changedRepos.length
    const dot = changedCount > 0 ? fg("#f85149")("●") : fg("#3fb950")("●")
    const countText =
      changedCount > 0
        ? fg("#f85149")(`${changedCount} repo${changedCount === 1 ? "" : "s"} changed`)
        : fg("#3fb950")("all clean")

    const allRepos = [...this.changedRepos, ...this.unchangedRepos]
    const lockedCount = allRepos.filter((r) => r.locked).length

    if (lockedCount > 0) {
      this.statusBar.content = t`${fg("#8b949e")(`Last checked: ${ago}`)}    ${dot}  ${countText}    ${fg("#d29922")("󰌾")}  ${fg("#d29922")(`${lockedCount} locked`)}`
    } else {
      this.statusBar.content = t`${fg("#8b949e")(`Last checked: ${ago}`)}    ${dot}  ${countText}`
    }
  }

  private formatTimeAgo(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000)
    if (seconds < 5) return "just now"
    if (seconds < 60) return `${seconds}s ago`
    const minutes = Math.floor(seconds / 60)
    return `${minutes}m ago`
  }

  private shortenPath(path: string): string {
    const home = process.env.HOME || "~"
    if (path.startsWith(home)) {
      return "~" + path.slice(home.length)
    }
    return path
  }

  /** Remove the diff view from the render tree */
  destroy(): void {
    this.renderer.root.remove(this.root.id)
  }
}
