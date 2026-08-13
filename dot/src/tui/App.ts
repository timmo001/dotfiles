import type { CliRenderer } from "@opentui/core";
import { Effect } from "effect";
import type {
  ViewId,
  MenuItem,
  MenuAction,
  Repo,
  RepoState,
  GitNotificationAction,
  GitNotificationThread,
} from "../types.js";
import type { DashboardState } from "../dashboard/types.js";
import type { Theme } from "../theme.js";
import { menuItemsById, submenus } from "../menu.js";
import type { CommandRunnerService } from "../services/CommandRunner.js";
import { MainMenu } from "./MainMenu.js";
import { DashboardView } from "../dashboard/tui/DashboardView.js";
import { DiffView } from "../git/tui/DiffView.js";
import { GitNotificationsView } from "../git/tui/GitNotificationsView.js";
import { OmarchyMenu } from "./OmarchyMenu.js";
import { OutputPane } from "./OutputPane.js";
import { Toast } from "./Toast.js";
import { VariantPopup } from "./VariantPopup.js";
import { openLazygit } from "../git/tui/Lazygit.js";
import {
  editorLaunchesDetached,
  openEditorInDirectory,
  openPathInEditor,
} from "./externalEditor.js";
import { openOpenCodeSession } from "./openCodeSession.js";
import {
  resizeIfFloating,
  DEFAULT_FLOATING_SIZE,
  DASHBOARD_FLOATING_SIZE,
} from "./hyprland.js";

const log = (msg: string) => console.error(`[dot:App] ${msg}`);

/** Set the terminal tab/window title via an OSC escape sequence */
const setTerminalTitle = (title: string): void => {
  process.stdout.write(`\x1b]0;${title}\x07`);
};

const diffTitle = "Dot TUI \u203A Diff";

const formatDiffTitle = (changedCount: number): string =>
  `${diffTitle} (${changedCount})`;

/** Wrap a string in single quotes, escaping embedded single quotes for safe shell interpolation */
const shellQuote = (s: string): string => `'${s.replace(/'/g, "'\\''")}'`;

/** Startup options controlling the App's initial view and pre-selected action */
export interface AppOptions {
  /** Which view to start on (default: "main") */
  readonly initialView?: ViewId;
  /** Initial tab for the diff view */
  readonly initialDiffTab?: "changed" | "unchanged";
  /** If set, execute this menu item immediately on startup and pre-select it */
  readonly executeItemId?: string;
}

/** Dependencies injected into the App at construction time */
export interface AppDeps {
  /** The OpenTUI CLI renderer instance */
  readonly renderer: CliRenderer;
  /** Active colour theme */
  readonly theme: Theme;
  /** Service for running shell commands with suspend/resume */
  readonly commandRunner: CommandRunnerService;
  /** Callback to trigger an immediate diff refresh (wired to RepoWatcher) */
  readonly onRefreshDiff: () => void;
  /** Callback to trigger an immediate GitHub notification refresh */
  readonly onRefreshNotifications: () => void;
  /** Callback to trigger an immediate dashboard source refresh. */
  readonly onRefreshDashboard: () => void;
  /** Callback to apply a mutating notification thread action */
  readonly onNotificationAction: (
    action: GitNotificationAction,
    threadId: string,
  ) => void;
}

/** Top-level TUI application shell managing a view stack and global keyboard */
export class App {
  private renderer: CliRenderer;
  private commandRunner: CommandRunnerService;
  private mainMenu: MainMenu;
  private dashboardView: DashboardView;
  private diffView: DiffView;
  private notificationsView: GitNotificationsView;
  private omarchyMenu: OmarchyMenu;
  private outputPane: OutputPane;
  private variantPopup: VariantPopup;
  private activeView: ViewId = "main";
  private viewStack: ViewId[] = [];
  private diffChangedCount = 0;

  constructor(deps: AppDeps, options: AppOptions = {}) {
    this.renderer = deps.renderer;
    this.commandRunner = deps.commandRunner;

    // --- Create views ---

    this.mainMenu = new MainMenu(deps.renderer, deps.theme, {
      onSelect: (item) => this.handleMenuAction(item),
      initialSelectedId: options.executeItemId,
    });

    this.dashboardView = new DashboardView(deps.renderer, deps.theme, {
      onOpenView: (viewId) => this.pushView(viewId),
      onRunCommand: (command, mode) => {
        const run = (() => {
          if (mode === "exit") return this.commandRunner.exitAndRun(command);
          if (mode === "suspend") {
            return this.commandRunner.runSuspended(command, false).then(() => {
              deps.onRefreshDashboard();
            });
          }
          return this.commandRunner.runSilent(command);
        })();
        run.catch((err) => {
          log(`Dashboard command error: ${err}`);
          if (mode === "exit") this.renderer.destroy();
        });
      },
      onRefresh: () => deps.onRefreshDashboard(),
      onBack: () => this.popView(),
    });

    this.diffView = new DiffView(deps.renderer, deps.theme, {
      initialTab: options.initialDiffTab ?? "changed",
      onSelect: async (repo) => {
        await openLazygit(deps.renderer, repo.path, () => {
          setTerminalTitle(formatDiffTitle(this.diffChangedCount));
        });
        deps.onRefreshDiff();
      },
      onOpenEditor: async (repo, kind) => {
        try {
          if (editorLaunchesDetached(kind)) {
            await openPathInEditor(deps.renderer, repo.path, kind);
          } else {
            await openEditorInDirectory(deps.renderer, repo.path, () => {
              setTerminalTitle(formatDiffTitle(this.diffChangedCount));
            });
          }
        } finally {
          deps.onRefreshDiff();
        }
      },
      onOpenOpencode: async (repo, mode) => {
        try {
          await openOpenCodeSession(deps.renderer, {
            mode,
            cwd: repo.path,
            afterResume: () => {
              setTerminalTitle(formatDiffTitle(this.diffChangedCount));
            },
          });
        } finally {
          deps.onRefreshDiff();
        }
      },
      onOpenTerminal: (repo) => {
        const p = shellQuote(repo.path);
        deps.commandRunner
          .runSilent(
            `uwsm app -- xdg-terminal-exec --app-id=org.omarchy.terminal /usr/bin/env bash -lc 'cd "$0" && exec bash -l' ${p}`,
          )
          .catch((err) => {
            log(`Open terminal error: ${err}`);
          });
      },
      onOpenWeb: (repo) => {
        const p = shellQuote(repo.path);
        deps.commandRunner
          .runSilent(`cd ${p} && gh repo view --web`)
          .catch((err) => {
            log(`Open web error: ${err}`);
          });
      },
      onRefresh: () => deps.onRefreshDiff(),
      onBack: () => this.popView(),
    });

    this.notificationsView = new GitNotificationsView(
      deps.renderer,
      deps.theme,
      {
        onRefresh: () => deps.onRefreshNotifications(),
        onOpenThread: (thread: GitNotificationThread) => {
          deps.commandRunner
            .runSilent(`xdg-open ${shellQuote(thread.webUrl)}`)
            .catch((err) => {
              log(`Open notification thread error: ${err}`);
            });
        },
        onOpenInbox: () => {
          deps.commandRunner
            .runSilent("xdg-open https://github.com/notifications")
            .catch((err) => {
              log(`Open notifications inbox error: ${err}`);
            });
        },
        onAction: (action, thread) => {
          deps.onNotificationAction(action, thread.id);
        },
        onBack: () => this.popView(),
      },
    );

    this.omarchyMenu = new OmarchyMenu(deps.renderer, deps.theme, {
      onAction: (item) => this.handleMenuAction(item),
      onBack: () => this.popView(),
      onTitleChange: (parts) => {
        // parts: ["Dot", "Omarchy"] or ["Dot", "Omarchy", "Refresh"] etc.
        const suffix = parts.slice(1).join(" \u203A ");
        setTerminalTitle(`Dot TUI \u203A ${suffix}`);
      },
    });

    this.variantPopup = new VariantPopup(deps.renderer, deps.theme, {
      onSelect: (action) => {
        // Defer refocus to avoid the same keypress event hitting the MenuList
        queueMicrotask(() => this.focusActiveView());
        this.dispatchAction(action);
      },
      onDismiss: () => {
        // Defer refocus to avoid the same Escape event hitting the MenuList
        queueMicrotask(() => this.focusActiveView());
      },
    });

    this.outputPane = new OutputPane(deps.renderer, deps.theme, {
      onBack: () => this.popView(),
    });

    // --- Hide all views initially ---
    this.hideAllViews();

    // --- Global keyboard ---
    // Ctrl+C is handled by OpenTUI's exitOnCtrlC option which ensures
    // terminal state is fully restored before exiting.
    deps.renderer.keyInput.on("keypress", (key) => {
      // Route keys to the variant popup when it is visible
      if (this.variantPopup.visible) {
        this.variantPopup.handleKeyPress(key);
        return;
      }
    });

    // --- Determine initial view ---
    const startView = options.initialView ?? "main";

    // Ensure back navigation works when starting on a non-main view
    if (startView !== "main") {
      this.viewStack.push("main");
    }

    // If an item should be executed immediately (subcommand mode):
    // always suspend, run with visible output, wait for keypress, then exit.
    if (options.executeItemId) {
      const item = menuItemsById.get(options.executeItemId);
      if (item) {
        this.showView("main");
        const { action } = item;
        if (
          action.type === "command" ||
          action.type === "exit-command" ||
          action.type === "silent" ||
          action.type === "notify"
        ) {
          setTimeout(() => {
            const run =
              action.type === "exit-command"
                ? this.commandRunner.exitAndRun(action.cmd)
                : this.commandRunner.runSuspended(action.cmd, true);
            run
              .then(() => deps.renderer.destroy())
              .catch((err) => {
                log(`Execute error: ${err}`);
                deps.renderer.destroy();
              });
          }, 50);
        } else {
          setTimeout(() => this.handleMenuAction(item), 50);
        }
        return;
      }
    }

    this.showView(startView);
  }

  /** Navigate to a view, pushing the current one onto the stack */
  pushView(viewId: ViewId): void {
    if (this.activeView !== viewId) {
      this.viewStack.push(this.activeView);
    }
    this.showView(viewId);
  }

  /** Return to the previous view on the stack */
  popView(): void {
    const prev = this.viewStack.pop();
    if (prev) {
      this.showView(prev);
    }
    // If stack is empty we're at main — stay there
  }

  /** Get the GitHub notifications view for direct state updates from the watcher */
  getNotificationsView(): GitNotificationsView {
    return this.notificationsView;
  }

  /** Update the diff view and terminal title with the latest watcher state. */
  updateDiffState(state: RepoState): void {
    this.diffChangedCount = state.changed.length;
    this.diffView.update(state);
    if (this.activeView === "git-diff") {
      setTerminalTitle(formatDiffTitle(this.diffChangedCount));
    }
  }

  /** Update the dashboard view with the latest composed live state. */
  updateDashboardState(state: DashboardState): void {
    this.dashboardView.update(state);
  }

  /**
   * Resize the floating Hyprland window for the given view: the dashboard uses
   * a custom size, every other view resets to the Omarchy default.
   */
  private resizeForView(viewId: ViewId): void {
    const size =
      viewId === "dashboard" ? DASHBOARD_FLOATING_SIZE : DEFAULT_FLOATING_SIZE;
    void Effect.runPromise(resizeIfFloating(size.width, size.height));
  }

  private showView(viewId: ViewId): void {
    log(`Switching to view: ${viewId}`);

    this.hideAllViews();
    this.clearForViewSwitch();

    this.activeView = viewId;
    this.resizeForView(viewId);

    // Show the target and reset filter state (fresh view entry)
    switch (viewId) {
      case "main":
        setTerminalTitle("Dot TUI");
        this.mainMenu.setVisible(true);
        this.mainMenu.resetAndFocus();
        break;
      case "dashboard":
        setTerminalTitle("Dot TUI \u203A Dashboard");
        this.dashboardView.setVisible(true);
        this.dashboardView.focus();
        break;
      case "git-diff":
        setTerminalTitle(formatDiffTitle(this.diffChangedCount));
        this.diffView.setVisible(true);
        this.diffView.focus();
        break;
      case "git-notifications":
        setTerminalTitle("Dot TUI \u203A Notifications");
        this.notificationsView.setVisible(true);
        this.notificationsView.focus();
        break;
      case "omarchy":
        this.omarchyMenu.setVisible(true);
        this.omarchyMenu.resetAndFocus();
        // OmarchyMenu updates the terminal title itself via onTitleChange
        break;
      case "output":
        setTerminalTitle("Dot \u203A Output");
        this.outputPane.setVisible(true);
        this.outputPane.focus();
        break;
    }
  }

  private handleMenuAction(item: MenuItem): void {
    // If the item has variants, open the popup instead of dispatching directly
    if (item.variants && item.variants.length > 0) {
      log(`Opening variant popup for item ${item.id}`);
      this.blurActiveView();
      this.variantPopup.show(item);
      return;
    }

    this.dispatchAction(item.action);
  }

  private hideAllViews(): void {
    this.mainMenu.setVisible(false);
    this.dashboardView.setVisible(false);
    this.diffView.setVisible(false);
    this.notificationsView.setVisible(false);
    this.omarchyMenu.setVisible(false);
    this.outputPane.setVisible(false);
  }

  private clearForViewSwitch(): void {
    this.renderer.currentRenderBuffer.clear();
    this.renderer.requestRender();
  }

  /** Dispatch a menu action (command, silent, notify, view, or submenu) */
  private dispatchAction(action: MenuAction): void {
    log(`Dispatching action: ${action.type}`);

    switch (action.type) {
      case "command":
        this.commandRunner
          .runSuspended(action.cmd, action.wait)
          .catch((err) => {
            log(`Command error: ${err}`);
          });
        break;

      case "exit-command":
        this.commandRunner.exitAndRun(action.cmd).catch((err) => {
          log(`Exit command error: ${err}`);
          this.renderer.destroy();
        });
        break;

      case "silent":
        this.commandRunner.runSilent(action.cmd).catch((err) => {
          log(`Silent command error: ${err}`);
        });
        break;

      case "notify":
        this.commandRunner.runNotify(action.cmd, action.notify).catch((err) => {
          log(`Notify command error: ${err}`);
        });
        break;

      case "view":
        this.pushView(action.viewId);
        break;

      case "submenu": {
        if (action.menuId === "omarchy") {
          this.omarchyMenu.resetToRoot();
          this.pushView("omarchy");
        } else {
          // For nested omarchy submenus, push within the omarchy menu
          this.omarchyMenu.pushSubmenu(action.menuId);
          if (this.activeView !== "omarchy") {
            this.pushView("omarchy");
          }
        }
        break;
      }

      case "quit":
        this.renderer.destroy();
        break;
    }
  }

  /** Restore keyboard focus to the currently active view */
  private focusActiveView(): void {
    switch (this.activeView) {
      case "main":
        this.mainMenu.focus();
        break;
      case "dashboard":
        this.dashboardView.focus();
        break;
      case "git-diff":
        this.diffView.focus();
        break;
      case "git-notifications":
        this.notificationsView.focus();
        break;
      case "omarchy":
        this.omarchyMenu.focus();
        break;
      case "output":
        this.outputPane.focus();
        break;
    }
  }

  /** Remove keyboard focus from the currently active view */
  private blurActiveView(): void {
    switch (this.activeView) {
      case "main":
        this.mainMenu.blur();
        break;
      case "omarchy":
        this.omarchyMenu.blur();
        break;
    }
  }
}
