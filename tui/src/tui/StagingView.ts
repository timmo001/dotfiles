import {
  type CliRenderer,
  BoxRenderable,
  TextRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  t,
  fg,
} from "@opentui/core"
import { Effect } from "effect"
import type { StagedFile } from "../types.js"
import type { GitStagingService } from "../services/GitStaging.js"
import { formatBreadcrumb } from "./breadcrumb.js"
import { formatHelpBar, type HelpEntry } from "./helpBar.js"

/** Help entries for the staging view */
const HELP: readonly HelpEntry[] = [
  { key: "Space", action: "toggle" },
  { key: "Tab", action: "pane" },
  { key: "a", action: "stage all" },
  { key: "l", action: "lazygit" },
  { key: "c/Enter", action: "commit" },
  { key: "Esc/Backspace", action: "back" },
  { key: "q", action: "quit" },
]

const log = (msg: string) => console.error(`[dot-tui:StagingView] ${msg}`)

/** Configuration and callbacks for the staging view */
export interface StagingViewOptions {
  /** Called when the user proceeds to the commit view */
  readonly onCommit: (repoPath: string) => void
  /** Called when the user wants to open lazygit for the repo */
  readonly onLazygit: (repoPath: string) => void
  /** Called when the user navigates back */
  readonly onBack: () => void
}

type StagingPane = "staged" | "unstaged"

/** Two-pane view showing staged (top) and unstaged (bottom) files for a single repo */
export class StagingView {
  private renderer: CliRenderer
  private callbacks: StagingViewOptions
  private gitStaging: GitStagingService

  private root: BoxRenderable
  private stagedSelect: SelectRenderable
  private unstagedSelect: SelectRenderable
  private stagedTitle: TextRenderable
  private unstagedTitle: TextRenderable
  private statusBar: TextRenderable
  private helpBar: TextRenderable

  private activePane: StagingPane = "unstaged"
  private stagedFiles: StagedFile[] = []
  private unstagedFiles: StagedFile[] = []
  private repoPath = ""
  private repoName = ""
  private isVisible = false
  private busy = false

  constructor(
    renderer: CliRenderer,
    gitStaging: GitStagingService,
    callbacks: StagingViewOptions,
  ) {
    this.renderer = renderer
    this.callbacks = callbacks
    this.gitStaging = gitStaging

    // Root container — full screen, vertical layout
    this.root = new BoxRenderable(renderer, {
      id: "staging-root",
      flexDirection: "column",
      width: "100%",
      height: "100%",
      padding: 1,
    })

    // Title bar — updated when repo is set
    const titleBar = new TextRenderable(renderer, {
      id: "staging-title-bar",
      content: formatBreadcrumb(["Dot", "Diff", "Stage"], ""),
      marginBottom: 1,
    })
    this.root.add(titleBar)

    // --- Top pane: Staged ---
    this.stagedTitle = new TextRenderable(renderer, {
      id: "staging-staged-title",
      content: this.formatPaneTitle("Staged", 0, false),
      marginBottom: 0,
    })
    this.root.add(this.stagedTitle)

    this.stagedSelect = new SelectRenderable(renderer, {
      id: "staging-staged-select",
      flexGrow: 1,
      width: "100%",
      options: [],
      backgroundColor: "#161b22",
      focusedBackgroundColor: "#161b22",
      selectedBackgroundColor: "#1f6feb",
      selectedTextColor: "#ffffff",
      textColor: "#3fb950",
      focusedTextColor: "#3fb950",
      descriptionColor: "#8b949e",
      selectedDescriptionColor: "#c9d1d9",
      showDescription: true,
      showScrollIndicator: true,
      wrapSelection: true,
    })
    this.root.add(this.stagedSelect)

    // Separator
    const separator = new TextRenderable(renderer, {
      id: "staging-separator",
      content: t`${fg("#30363d")("─".repeat(60))}`,
      marginTop: 1,
      marginBottom: 0,
    })
    this.root.add(separator)

    // --- Bottom pane: Unstaged ---
    this.unstagedTitle = new TextRenderable(renderer, {
      id: "staging-unstaged-title",
      content: this.formatPaneTitle("Unstaged", 0, true),
      marginBottom: 0,
    })
    this.root.add(this.unstagedTitle)

    this.unstagedSelect = new SelectRenderable(renderer, {
      id: "staging-unstaged-select",
      flexGrow: 1,
      width: "100%",
      options: [],
      backgroundColor: "#161b22",
      focusedBackgroundColor: "#161b22",
      selectedBackgroundColor: "#30363d",
      selectedTextColor: "#c9d1d9",
      textColor: "#f85149",
      focusedTextColor: "#f85149",
      descriptionColor: "#8b949e",
      selectedDescriptionColor: "#8b949e",
      showDescription: true,
      showScrollIndicator: true,
      wrapSelection: true,
    })
    this.root.add(this.unstagedSelect)

    // Status bar
    this.statusBar = new TextRenderable(renderer, {
      id: "staging-status-bar",
      content: t`${fg("#8b949e")("")}`,
      marginTop: 1,
    })
    this.root.add(this.statusBar)

    // Help bar
    this.helpBar = new TextRenderable(renderer, {
      id: "staging-help-bar",
      content: formatHelpBar(HELP),
    })
    this.root.add(this.helpBar)

    renderer.root.add(this.root)

    // Re-wrap help bar on terminal resize
    renderer.on("resize", () => {
      this.helpBar.content = formatHelpBar(HELP)
    })

    // Wire select events (Enter on staged/unstaged list — no-op, we use space for toggle)
    this.stagedSelect.on(SelectRenderableEvents.ITEM_SELECTED, () => {
      // Enter on staged list does nothing — use space to toggle
    })
    this.unstagedSelect.on(SelectRenderableEvents.ITEM_SELECTED, () => {
      // Enter on unstaged list does nothing — use space to toggle
    })

    // Keyboard handling
    renderer.keyInput.on("keypress", (key) => {
      if (!this.isVisible || this.busy) return

      if (key.name === "space") {
        this.toggleSelectedFile()
      } else if (key.name === "tab") {
        this.togglePane()
      } else if (key.name === "a") {
        this.stageAll()
      } else if (key.name === "l") {
        this.callbacks.onLazygit(this.repoPath)
      } else if (key.name === "return" || key.name === "c") {
        if (this.stagedFiles.length > 0) {
          this.callbacks.onCommit(this.repoPath)
        } else {
          this.statusBar.content = t`${fg("#d29922")("No staged files — stage files before committing")}`
        }
      } else if (key.name === "escape" || key.name === "backspace") {
        this.callbacks.onBack()
      }
    })

    // Start on unstaged pane
    this.activePane = "unstaged"
  }

  /** Open the staging view for a specific repository */
  openForRepo(repoPath: string, repoName: string): void {
    this.repoPath = repoPath
    this.repoName = repoName
    this.activePane = "unstaged"
    this.statusBar.content = t`${fg("#8b949e")("Loading...")}`
    this.refreshFiles()
  }

  /** Show or hide the staging view */
  setVisible(visible: boolean): void {
    this.root.visible = visible
    this.isVisible = visible
  }

  /** Give keyboard focus to the active pane */
  focus(): void {
    this.focusPane(this.activePane)
  }

  /** Remove the staging view from the render tree */
  destroy(): void {
    this.renderer.root.remove(this.root.id)
  }

  /** Refresh the file lists from git status */
  private refreshFiles(): void {
    this.busy = true
    Effect.runPromise(
      this.gitStaging.getStatus(this.repoPath).pipe(
        Effect.catchAll((err) => {
          log(`Status error: ${err.message}`)
          return Effect.succeed([] as readonly StagedFile[])
        }),
      ),
    ).then((files) => {
      this.stagedFiles = files.filter((f) => f.staged)
      this.unstagedFiles = files.filter((f) => !f.staged)
      this.updateLists()
      this.busy = false
    })
  }

  /** Update SelectRenderable options from current file state */
  private updateLists(): void {
    this.stagedSelect.options = this.stagedFiles.map((f) => ({
      name: `${this.statusIcon(f.status)} ${f.path}`,
      description: this.statusLabel(f.status),
      value: f.path,
    }))

    this.unstagedSelect.options = this.unstagedFiles.map((f) => ({
      name: `${this.statusIcon(f.status)} ${f.path}`,
      description: this.statusLabel(f.status),
      value: f.path,
    }))

    this.stagedTitle.content = this.formatPaneTitle(
      "Staged",
      this.stagedFiles.length,
      this.activePane === "staged",
    )
    this.unstagedTitle.content = this.formatPaneTitle(
      "Unstaged",
      this.unstagedFiles.length,
      this.activePane === "unstaged",
    )

    this.updateStatusBar()
    this.focusPane(this.activePane)
  }

  /** Toggle the currently selected file between staged and unstaged */
  private toggleSelectedFile(): void {
    const select = this.activePane === "staged" ? this.stagedSelect : this.unstagedSelect
    const option = select.getSelectedOption()
    if (!option) return

    const filePath = option.value as string
    this.busy = true

    const effect =
      this.activePane === "unstaged"
        ? this.gitStaging.stageFile(this.repoPath, filePath)
        : this.gitStaging.unstageFile(this.repoPath, filePath)

    Effect.runPromise(
      effect.pipe(
        Effect.catchAll((err) => {
          log(`Toggle error: ${err.message}`)
          this.statusBar.content = t`${fg("#f85149")(`Error: ${err.message}`)}`
          return Effect.void
        }),
      ),
    ).then(() => {
      this.busy = false
      this.refreshFiles()
    })
  }

  /** Stage all unstaged files */
  private stageAll(): void {
    if (this.unstagedFiles.length === 0) return

    this.busy = true
    this.statusBar.content = t`${fg("#d29922")("Staging all files...")}`

    Effect.runPromise(
      this.gitStaging.stageAll(this.repoPath).pipe(
        Effect.catchAll((err) => {
          log(`Stage all error: ${err.message}`)
          this.statusBar.content = t`${fg("#f85149")(`Error: ${err.message}`)}`
          return Effect.void
        }),
      ),
    ).then(() => {
      this.busy = false
      this.refreshFiles()
    })
  }

  private togglePane(): void {
    this.activePane = this.activePane === "staged" ? "unstaged" : "staged"
    this.focusPane(this.activePane)
    this.stagedTitle.content = this.formatPaneTitle(
      "Staged",
      this.stagedFiles.length,
      this.activePane === "staged",
    )
    this.unstagedTitle.content = this.formatPaneTitle(
      "Unstaged",
      this.unstagedFiles.length,
      this.activePane === "unstaged",
    )
  }

  private focusPane(pane: StagingPane): void {
    if (pane === "staged") {
      this.unstagedSelect.blur()
      this.stagedSelect.focus()
    } else {
      this.stagedSelect.blur()
      this.unstagedSelect.focus()
    }
  }

  private formatPaneTitle(label: string, count: number, active: boolean) {
    const indicator = active ? "▸" : " "
    const color = active ? "#58a6ff" : "#8b949e"
    const countColor = label === "Staged" && count > 0 ? "#3fb950" : "#8b949e"
    return t`${fg(color)(`${indicator} ${label}`)} ${fg(countColor)(`(${count})`)}`
  }

  private statusIcon(status: string): string {
    switch (status) {
      case "M": return "M"
      case "A": return "A"
      case "D": return "D"
      case "R": return "R"
      case "?": return "?"
      default: return status
    }
  }

  private statusLabel(status: string): string {
    switch (status) {
      case "M": return "modified"
      case "A": return "added"
      case "D": return "deleted"
      case "R": return "renamed"
      case "C": return "copied"
      case "U": return "unmerged"
      case "?": return "untracked"
      default: return status
    }
  }

  private updateStatusBar(): void {
    const staged = this.stagedFiles.length
    const unstaged = this.unstagedFiles.length
    const total = staged + unstaged
    this.statusBar.content = t`${fg("#8b949e")(`${this.repoName}`)}    ${fg("#3fb950")(`${staged} staged`)}  ${fg("#f85149")(`${unstaged} unstaged`)}  ${fg("#8b949e")(`${total} total`)}`
  }
}
