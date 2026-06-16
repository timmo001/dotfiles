import type { CliRenderer } from "@opentui/core";
import { Effect } from "effect";
import type {
  ViewId,
  MenuItem,
  MenuAction,
  NotesViewFilter,
  Repo,
  RepoState,
  GitNotificationAction,
  GitNotificationThread,
  GitLogCommit,
  GitLogRepo,
  WorkflowRun,
} from "../types.js";
import type { DashboardState } from "../dashboard/types.js";
import type {
  NoteCreateDraft,
  NoteCreateKind,
  NoteDeleteResult,
  NoteEntry,
  NotePriority,
  NoteRepoSection,
} from "../notes/types.js";
import type { Theme } from "../theme.js";
import { menuItemsById, submenus } from "../menu.js";
import type { CommandRunnerService } from "../services/CommandRunner.js";
import type { GitStagingService } from "../git/services/GitStaging.js";
import type { CommitSuggestService } from "../git/services/CommitSuggest.js";
import { MainMenu } from "./MainMenu.js";
import { DashboardView } from "../dashboard/tui/DashboardView.js";
import { DiffView } from "../git/tui/DiffView.js";
import { GitLogView } from "../git/tui/GitLogView.js";
import { GitNotificationsView } from "../git/tui/GitNotificationsView.js";
import { WorkflowRunsView } from "../git/tui/WorkflowRunsView.js";
import { NotesView } from "../notes/tui/NotesView.js";
import { openNoteInEditor } from "../notes/tui/NoteEditor.js";
import {
  openNoteInOpenCode,
  type OpenCodeNoteMode,
} from "../notes/tui/OpenCodeNote.js";
import { OmarchyMenu } from "./OmarchyMenu.js";
import { StagingView } from "../git/tui/StagingView.js";
import { CommitView } from "../git/tui/CommitView.js";
import { OutputPane } from "./OutputPane.js";
import { Toast } from "./Toast.js";
import { VariantPopup } from "./VariantPopup.js";
import { openLazygit } from "../git/tui/Lazygit.js";
import { openGitShow } from "../git/tui/GitShow.js";
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
const gitLogTitle = "Dot TUI \u203A Git Log";
const stagingTitle = "Dot TUI \u203A Diff \u203A Stage";

const formatDiffTitle = (changedCount: number): string =>
  `${diffTitle} (${changedCount})`;

/** Wrap a string in single quotes, escaping embedded single quotes for safe shell interpolation */
const shellQuote = (s: string): string => `'${s.replace(/'/g, "'\\''")}'`;

export interface AppOptions {
  /** Which view to start on (default: "main") */
  readonly initialView?: ViewId;
  /** Initial tab for the diff view */
  readonly initialDiffTab?: "changed" | "unchanged";
  /** If set, execute this menu item immediately on startup and pre-select it */
  readonly executeItemId?: string;
  /** Optional notes filter to apply when starting on the notes view. */
  readonly initialNotesFilter?: NotesViewFilter;
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
  /** Callback to trigger an immediate git log refresh */
  readonly onRefreshGitLog: () => void;
  /** Callback to trigger an immediate workflow refresh */
  readonly onRefreshWorkflows: () => void;
  /** Callback to trigger an immediate GitHub notification refresh */
  readonly onRefreshNotifications: () => void;
  /** Callback to trigger an immediate dashboard source refresh. */
  readonly onRefreshDashboard: () => void;
  /** Callback to apply a mutating notification thread action */
  readonly onNotificationAction: (
    action: GitNotificationAction,
    threadId: string,
  ) => void;
  /** List note entries for the current repository. */
  readonly listNotes: () => Promise<readonly NoteEntry[]>;
  /** List note entries grouped by every repository notes directory. */
  readonly listAllNotes: () => Promise<readonly NoteRepoSection[]>;
  /** Read the full markdown content for a note file. */
  readonly readNote: (filePath: string) => Promise<string>;
  /** Delete a note file from the notes vault. */
  readonly deleteNote: (filePath: string) => Promise<NoteDeleteResult>;
  /** Create a draft note file with seed content. */
  readonly createNoteDraft: (
    kind: NoteCreateKind,
    name: string,
    description: string,
  ) => Promise<NoteCreateDraft>;
  /** Commit a draft note after editor exit. */
  readonly finaliseNoteDraft: (filePath: string) => Promise<void>;
  /** Commit an edited note after editor exit. */
  readonly finaliseNoteEdit: (filePath: string) => Promise<void>;
  /** Set the handoff priority for a note and commit it. */
  readonly updateNotePriority: (
    filePath: string,
    priority: NotePriority,
  ) => Promise<void>;
}

/** Top-level TUI application shell managing a view stack and global keyboard */
export class App {
  private renderer: CliRenderer;
  private commandRunner: CommandRunnerService;
  private mainMenu: MainMenu;
  private dashboardView: DashboardView;
  private diffView: DiffView;
  private gitLogView: GitLogView;
  private workflowsView: WorkflowRunsView;
  private notificationsView: GitNotificationsView;
  private notesView: NotesView;
  private omarchyMenu: OmarchyMenu;
  private stagingView: StagingView;
  private commitView: CommitView;
  private outputPane: OutputPane;
  private variantPopup: VariantPopup;
  private activeView: ViewId = "main";
  private viewStack: ViewId[] = [];
  private diffChangedCount = 0;
  private activeNotesFilter: NotesViewFilter | null = null;
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
      onCommit: (repo) => {
        this.commitRepoPath = repo.path;
        this.commitRepoName = repo.name;
        this.stagingView.openForRepo(repo.path, repo.name);
        this.pushView("staging");
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
      onOpenTmux: (mode) => {
        deps.commandRunner
          .runSilent(`git-diff-tmux-session ${mode}`)
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

    this.gitLogView = new GitLogView(deps.renderer, deps.theme, {
      onRefresh: () => deps.onRefreshGitLog(),
      onOpenCommit: async (repo: GitLogRepo, commit: GitLogCommit) => {
        await openGitShow(deps.renderer, repo.path, commit.sha, () => {
          setTerminalTitle(gitLogTitle);
        });
      },
      onBack: () => this.popView(),
    });

    this.workflowsView = new WorkflowRunsView(deps.renderer, deps.theme, {
      onRefresh: () => deps.onRefreshWorkflows(),
      onOpenRun: (run: WorkflowRun) => {
        if (!run.url) return;
        deps.commandRunner
          .runSilent(`xdg-open ${shellQuote(run.url)}`)
          .catch((err) => {
            log(`Open workflow run error: ${err}`);
          });
      },
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

    this.notesView = new NotesView(deps.renderer, deps.theme, {
      listNotes: deps.listNotes,
      listAllNotes: deps.listAllNotes,
      readNote: deps.readNote,
      deleteNote: deps.deleteNote,
      createNoteDraft: deps.createNoteDraft,
      finaliseNoteDraft: deps.finaliseNoteDraft,
      finaliseNoteEdit: deps.finaliseNoteEdit,
      onSetPriority: deps.updateNotePriority,
      onEditNote: (entry, kind) =>
        openNoteInEditor(deps.renderer, entry, kind, () => {
          setTerminalTitle(`Dot TUI › ${this.notesTitle()}`);
        }),
      onOpenOpencode: (entry, noteContent, mode: OpenCodeNoteMode) =>
        openNoteInOpenCode(deps.renderer, entry, noteContent, {
          mode,
          afterResume: () => {
            setTerminalTitle(`Dot TUI › ${this.notesTitle()}`);
          },
        }),
      onBack: () => this.popView(),
    });
    this.setNotesFilter(options.initialNotesFilter ?? null);

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
          await openLazygit(deps.renderer, repoPath, () => {
            setTerminalTitle(stagingTitle);
          });
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

  /** Get the workflow runs view for direct state updates from the watcher */
  getWorkflowsView(): WorkflowRunsView {
    return this.workflowsView;
  }

  /** Get the git log view for direct state updates from the watcher. */
  getGitLogView(): GitLogView {
    return this.gitLogView;
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
      case "git-log":
        setTerminalTitle(gitLogTitle);
        this.gitLogView.setVisible(true);
        this.gitLogView.focus();
        break;
      case "git-workflows":
        setTerminalTitle("Dot TUI \u203A Workflows");
        this.workflowsView.setVisible(true);
        this.workflowsView.focus();
        break;
      case "git-notifications":
        setTerminalTitle("Dot TUI \u203A Notifications");
        this.notificationsView.setVisible(true);
        this.notificationsView.focus();
        break;
      case "notes":
        setTerminalTitle(`Dot TUI \u203A ${this.notesTitle()}`);
        this.notesView.setVisible(true);
        this.notesView.focus();
        break;
      case "omarchy":
        this.omarchyMenu.setVisible(true);
        this.omarchyMenu.resetAndFocus();
        // OmarchyMenu updates the terminal title itself via onTitleChange
        break;
      case "staging":
        setTerminalTitle(stagingTitle);
        this.stagingView.setVisible(true);
        this.stagingView.focus();
        break;
      case "commit":
        setTerminalTitle("Dot TUI \u203A Diff \u203A Commit");
        this.commitView.setVisible(true);
        this.commitView.focus();
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

  private setNotesFilter(filter: NotesViewFilter | null): void {
    this.activeNotesFilter = filter;
    this.notesView.setFilter(filter);
  }

  private notesTitle(): string {
    const title = this.activeNotesFilter?.title ?? "Notes";
    if (!this.activeNotesFilter?.includeAllRepos) return title;
    return title.startsWith("All ") ? title : `All ${title}`;
  }

  private hideAllViews(): void {
    this.mainMenu.setVisible(false);
    this.dashboardView.setVisible(false);
    this.diffView.setVisible(false);
    this.gitLogView.setVisible(false);
    this.workflowsView.setVisible(false);
    this.notificationsView.setVisible(false);
    this.notesView.setVisible(false);
    this.omarchyMenu.setVisible(false);
    this.stagingView.setVisible(false);
    this.commitView.setVisible(false);
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
        if (action.viewId === "notes") {
          this.setNotesFilter(action.notesFilter ?? null);
        }
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
      case "git-log":
        this.gitLogView.focus();
        break;
      case "git-workflows":
        this.workflowsView.focus();
        break;
      case "git-notifications":
        this.notificationsView.focus();
        break;
      case "notes":
        this.notesView.focus();
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
