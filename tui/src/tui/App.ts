import type { CliRenderer } from "@opentui/core";
import type { ViewId, MenuItem, MenuAction, Repo } from "../types.js";
import type { Theme } from "../theme.js";
import { menuItemsById, submenus } from "../menu.js";
import type { CommandRunnerService } from "../services/CommandRunner.js";
import type { GitStagingService } from "../services/GitStaging.js";
import type { CommitSuggestService } from "../services/CommitSuggest.js";
import { MainMenu } from "./MainMenu.js";
import { DiffView } from "./DiffView.js";
import { OmarchyMenu } from "./OmarchyMenu.js";
import { StagingView } from "./StagingView.js";
import { CommitView } from "./CommitView.js";
import { Toast } from "./Toast.js";
import { VariantPopup } from "./VariantPopup.js";
import { openLazygit } from "./Lazygit.js";

const log = (msg: string) => console.error(`[dot-tui:App] ${msg}`);

/** Set the terminal tab/window title via an OSC escape sequence */
const setTerminalTitle = (title: string): void => {
  process.stdout.write(`\x1b]0;${title}\x07`);
};

/** Wrap a string in single quotes, escaping embedded single quotes for safe shell interpolation */
const shellQuote = (s: string): string => `'${s.replace(/'/g, "'\\''")}'`;

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
  /** Service for git staging operations */
  readonly gitStaging: GitStagingService;
  /** Service for AI commit message suggestions */
  readonly commitSuggest: CommitSuggestService;
  /** Callback to trigger an immediate diff refresh (wired to RepoWatcher) */
  readonly onRefreshDiff: () => void;
}

/** Top-level TUI application shell managing a view stack and global keyboard */
export class App {
  private renderer: CliRenderer;
  private commandRunner: CommandRunnerService;
  private mainMenu: MainMenu;
  private diffView: DiffView;
  private omarchyMenu: OmarchyMenu;
  private stagingView: StagingView;
  private commitView: CommitView;
  private variantPopup: VariantPopup;
  private activeView: ViewId = "main";
  private viewStack: ViewId[] = [];
  /** Repo path passed through the staging → commit flow */
  private commitRepoPath = "";
  /** Repo display name passed through the staging → commit flow */
  private commitRepoName = "";

  constructor(deps: AppDeps, options: AppOptions = {}) {
    this.renderer = deps.renderer;
    this.commandRunner = deps.commandRunner;

    // --- Create views ---

    this.mainMenu = new MainMenu(deps.renderer, deps.theme, {
      onSelect: (item) => this.handleMenuAction(item),
      initialSelectedId: options.executeItemId,
    });

    this.diffView = new DiffView(deps.renderer, deps.theme, {
      initialTab: options.initialDiffTab ?? "changed",
      onSelect: async (repo) => {
        await openLazygit(deps.renderer, repo.path);
        deps.onRefreshDiff();
      },
      onCommit: (repo) => {
        this.commitRepoPath = repo.path;
        this.commitRepoName = repo.name;
        this.stagingView.openForRepo(repo.path, repo.name);
        this.pushView("staging");
      },
      onOpenTmux: (mode) => {
        deps.commandRunner
          .runSilent(`dot-diff-tmux-session ${mode}`)
          .catch((err) => {
            log(`Tmux session error: ${err}`);
          });
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
      onPull: (repo) => {
        const p = shellQuote(repo.path);
        deps.commandRunner
          .runSuspended(`git -C ${p} pull --rebase --no-edit`, true)
          .then(() => {
            deps.onRefreshDiff();
          })
          .catch((err) => {
            log(`Pull error: ${err}`);
          });
      },
      onPush: (repo) => {
        const p = shellQuote(repo.path);
        deps.commandRunner
          .runSuspended(`git -C ${p} push`, true)
          .then(() => {
            deps.onRefreshDiff();
          })
          .catch((err) => {
            log(`Push error: ${err}`);
          });
      },
      onRefresh: () => deps.onRefreshDiff(),
      onBack: () => this.popView(),
    });

    this.omarchyMenu = new OmarchyMenu(deps.renderer, deps.theme, {
      onAction: (item) => this.handleMenuAction(item),
      onBack: () => this.popView(),
      onTitleChange: (parts) => {
        // parts: ["Dot", "Omarchy"] or ["Dot", "Omarchy", "Refresh"] etc.
        const suffix = parts.slice(1).join(" \u203A ");
        setTerminalTitle(`Dot TUI \u203A ${suffix}`);
      },
    });

    this.stagingView = new StagingView(
      deps.renderer,
      deps.theme,
      deps.gitStaging,
      {
        onCommit: (repoPath) => {
          this.commitView.openForRepo(repoPath, this.commitRepoName);
          this.pushView("commit");
        },
        onLazygit: async (repoPath) => {
          await openLazygit(deps.renderer, repoPath);
          this.stagingView.openForRepo(repoPath, this.commitRepoName);
          deps.onRefreshDiff();
        },
        onBack: () => this.popView(),
      },
    );

    this.commitView = new CommitView(
      deps.renderer,
      deps.theme,
      deps.gitStaging,
      deps.commitSuggest,
      {
        onCommitComplete: () => {
          // Pop back to diff view (skip staging)
          this.viewStack = this.viewStack.filter((v) => v !== "staging");
          this.popView();
          deps.onRefreshDiff();
        },
        onBack: () => this.popView(),
      },
    );

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

    // --- Hide all views initially ---
    this.mainMenu.setVisible(false);
    this.diffView.setVisible(false);
    this.omarchyMenu.setVisible(false);
    this.stagingView.setVisible(false);
    this.commitView.setVisible(false);

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
          action.type === "silent" ||
          action.type === "notify"
        ) {
          setTimeout(() => {
            this.commandRunner
              .runSuspended(action.cmd, true)
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

  /** Get the diff view for direct state updates from the watcher */
  getDiffView(): DiffView {
    return this.diffView;
  }

  private showView(viewId: ViewId): void {
    log(`Switching to view: ${viewId}`);

    // Hide all
    this.mainMenu.setVisible(false);
    this.diffView.setVisible(false);
    this.omarchyMenu.setVisible(false);
    this.stagingView.setVisible(false);
    this.commitView.setVisible(false);

    this.activeView = viewId;

    // Show the target and reset filter state (fresh view entry)
    switch (viewId) {
      case "main":
        setTerminalTitle("Dot TUI");
        this.mainMenu.setVisible(true);
        this.mainMenu.resetAndFocus();
        break;
      case "diff":
        setTerminalTitle("Dot TUI \u203A Diff");
        this.diffView.setVisible(true);
        this.diffView.focus();
        break;
      case "omarchy":
        this.omarchyMenu.setVisible(true);
        this.omarchyMenu.resetAndFocus();
        // OmarchyMenu updates the terminal title itself via onTitleChange
        break;
      case "staging":
        setTerminalTitle("Dot TUI \u203A Diff \u203A Stage");
        this.stagingView.setVisible(true);
        this.stagingView.focus();
        break;
      case "commit":
        setTerminalTitle("Dot TUI \u203A Diff \u203A Commit");
        this.commitView.setVisible(true);
        this.commitView.focus();
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
      case "diff":
        this.diffView.focus();
        break;
      case "omarchy":
        this.omarchyMenu.focus();
        break;
      case "staging":
        this.stagingView.focus();
        break;
      case "commit":
        this.commitView.focus();
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
