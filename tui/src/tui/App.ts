import type { CliRenderer } from "@opentui/core"
import type { ViewId, MenuItem } from "../types.js"
import { menuItemsById, submenus } from "../menu.js"
import type { CommandRunnerService } from "../services/CommandRunner.js"
import { MainMenu } from "./MainMenu.js"
import { DiffView } from "./DiffView.js"
import { OmarchyMenu } from "./OmarchyMenu.js"
import { openLazygit } from "./Lazygit.js"

const log = (msg: string) => console.error(`[dot-tui:App] ${msg}`)

/** Wrap a string in single quotes, escaping embedded single quotes for safe shell interpolation */
const shellQuote = (s: string): string => `'${s.replace(/'/g, "'\\''")}'`

export interface AppOptions {
  /** Which view to start on (default: "main") */
  readonly initialView?: ViewId
  /** Initial tab for the diff view */
  readonly initialDiffTab?: "changed" | "unchanged"
  /** If set, execute this menu item immediately on startup and pre-select it */
  readonly executeItemId?: string
}

/** Dependencies injected into the App at construction time */
export interface AppDeps {
  /** The OpenTUI CLI renderer instance */
  readonly renderer: CliRenderer
  /** Service for running shell commands with suspend/resume */
  readonly commandRunner: CommandRunnerService
  /** Callback to trigger an immediate diff refresh (wired to RepoWatcher) */
  readonly onRefreshDiff: () => void
}

/** Top-level TUI application shell managing a view stack and global keyboard */
export class App {
  private renderer: CliRenderer
  private commandRunner: CommandRunnerService
  private mainMenu: MainMenu
  private diffView: DiffView
  private omarchyMenu: OmarchyMenu
  private activeView: ViewId = "main"
  private viewStack: ViewId[] = []

  constructor(deps: AppDeps, options: AppOptions = {}) {
    this.renderer = deps.renderer
    this.commandRunner = deps.commandRunner

    deps.renderer.setBackgroundColor("#0d1117")

    // --- Create views ---

    this.mainMenu = new MainMenu(deps.renderer, {
      onSelect: (item) => this.handleMenuAction(item),
      initialSelectedId: options.executeItemId,
    })

    this.diffView = new DiffView(deps.renderer, {
      initialTab: options.initialDiffTab ?? "changed",
      onSelect: async (repo) => {
        await openLazygit(deps.renderer, repo.path)
        deps.onRefreshDiff()
      },
      onOpenTmux: (mode) => {
        deps.commandRunner.runSilent(`dot-diff-tmux-session ${mode}`).catch((err) => {
          log(`Tmux session error: ${err}`)
        })
      },
      onOpenTerminal: (repo) => {
        const p = shellQuote(repo.path)
        deps.commandRunner
          .runSilent(
            `uwsm app -- xdg-terminal-exec --app-id=org.omarchy.terminal /usr/bin/env bash -lc 'cd "$0" && exec bash -l' ${p}`,
          )
          .catch((err) => {
            log(`Open terminal error: ${err}`)
          })
      },
      onOpenWeb: (repo) => {
        const p = shellQuote(repo.path)
        deps.commandRunner.runSilent(`cd ${p} && gh repo view --web`).catch((err) => {
          log(`Open web error: ${err}`)
        })
      },
      onRefresh: () => deps.onRefreshDiff(),
      onBack: () => this.popView(),
    })

    this.omarchyMenu = new OmarchyMenu(deps.renderer, {
      onAction: (item) => this.handleMenuAction(item),
      onBack: () => this.popView(),
    })

    // --- Hide all views initially ---
    this.mainMenu.setVisible(false)
    this.diffView.setVisible(false)
    this.omarchyMenu.setVisible(false)

    // --- Global keyboard ---
    deps.renderer.keyInput.on("keypress", (key) => {
      if (key.name === "q" && !key.ctrl) {
        log("Quit requested")
        deps.renderer.destroy()
        process.exit(0)
      }
    })

    // --- Determine initial view ---
    const startView = options.initialView ?? "main"

    // Ensure back navigation works when starting on a non-main view
    if (startView !== "main") {
      this.viewStack.push("main")
    }

    // If an item should be executed immediately (subcommand mode):
    // always suspend, run with visible output, wait for keypress, then resume.
    if (options.executeItemId) {
      const item = menuItemsById.get(options.executeItemId)
      if (item) {
        this.showView("main")
        const { action } = item
        if (action.type === "command" || action.type === "silent") {
          setTimeout(() => {
            this.commandRunner.runSuspended(action.cmd, true).catch((err) => {
              log(`Execute error: ${err}`)
            })
          }, 50)
        } else {
          setTimeout(() => this.handleMenuAction(item), 50)
        }
        return
      }
    }

    this.showView(startView)
  }

  /** Navigate to a view, pushing the current one onto the stack */
  pushView(viewId: ViewId): void {
    if (this.activeView !== viewId) {
      this.viewStack.push(this.activeView)
    }
    this.showView(viewId)
  }

  /** Return to the previous view on the stack */
  popView(): void {
    const prev = this.viewStack.pop()
    if (prev) {
      this.showView(prev)
    }
    // If stack is empty we're at main — stay there
  }

  /** Get the diff view for direct state updates from the watcher */
  getDiffView(): DiffView {
    return this.diffView
  }

  private showView(viewId: ViewId): void {
    log(`Switching to view: ${viewId}`)

    // Hide all
    this.mainMenu.setVisible(false)
    this.diffView.setVisible(false)
    this.omarchyMenu.setVisible(false)

    this.activeView = viewId

    // Show the target
    switch (viewId) {
      case "main":
        this.mainMenu.setVisible(true)
        this.mainMenu.focus()
        break
      case "diff":
        this.diffView.setVisible(true)
        this.diffView.focus()
        break
      case "omarchy":
        this.omarchyMenu.setVisible(true)
        this.omarchyMenu.focus()
        break
    }
  }

  private handleMenuAction(item: MenuItem): void {
    const { action } = item
    log(`Action: ${action.type} for item ${item.id}`)

    switch (action.type) {
      case "command":
        this.commandRunner.runSuspended(action.cmd, action.wait).catch((err) => {
          log(`Command error: ${err}`)
        })
        break

      case "silent":
        this.commandRunner.runSilent(action.cmd).catch((err) => {
          log(`Silent command error: ${err}`)
        })
        break

      case "view":
        this.pushView(action.viewId)
        break

      case "submenu": {
        if (action.menuId === "omarchy") {
          this.omarchyMenu.resetToRoot()
          this.pushView("omarchy")
        } else {
          // For nested omarchy submenus, push within the omarchy menu
          this.omarchyMenu.pushSubmenu(action.menuId)
          if (this.activeView !== "omarchy") {
            this.pushView("omarchy")
          }
        }
        break
      }
    }
  }
}
