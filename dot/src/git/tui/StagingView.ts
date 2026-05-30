import {
  type CliRenderer,
  BoxRenderable,
  TextRenderable,
  t,
  fg,
} from "@opentui/core";
import { Effect } from "effect";
import type { StagedFile } from "../../types.js";
import type { Theme } from "../../theme.js";
import type { GitStagingService } from "../services/GitStaging.js";
import { formatBreadcrumb } from "../../tui/breadcrumb.js";
import {
  addResponsiveHelpBar,
  GLOBAL_HELP,
  type HelpEntry,
} from "../../tui/helpBar.js";
import { formatPaneTitle } from "../../tui/paneTitle.js";
import { StatusList } from "../../tui/StatusList.js";

/** Help entries for the staging view */
const HELP: readonly HelpEntry[] = [
  { key: "Space", action: "toggle" },
  { key: "Tab", action: "pane" },
  { key: "a", action: "stage all" },
  { key: "l", action: "lazygit" },
  { key: "c/Enter", action: "commit" },
  { key: "Esc/Backspace", action: "back" },
  ...GLOBAL_HELP,
];

const log = (msg: string) => console.error(`[dot:StagingView] ${msg}`);

/** Configuration and callbacks for the staging view */
export interface StagingViewOptions {
  /** Called when the user proceeds to the commit view */
  readonly onCommit: (repoPath: string) => void;
  /** Called when the user wants to open lazygit for the repo */
  readonly onLazygit: (repoPath: string) => void;
  /** Called when the user navigates back */
  readonly onBack: () => void;
}

type StagingPane = "staged" | "unstaged";

/** Two-pane view showing staged (top) and unstaged (bottom) files for a single repo */
export class StagingView {
  private renderer: CliRenderer;
  private callbacks: StagingViewOptions;
  private gitStaging: GitStagingService;
  private theme: Theme;

  private root: BoxRenderable;
  private stagedPane: BoxRenderable;
  private unstagedPane: BoxRenderable;
  private stagedList: StatusList<StagedFile>;
  private unstagedList: StatusList<StagedFile>;
  private stagedTitle: TextRenderable;
  private unstagedTitle: TextRenderable;
  private statusBar: TextRenderable;

  private activePane: StagingPane = "unstaged";
  private stagedFiles: StagedFile[] = [];
  private unstagedFiles: StagedFile[] = [];
  private repoPath = "";
  private repoName = "";
  private isVisible = false;
  private busy = false;

  constructor(
    renderer: CliRenderer,
    theme: Theme,
    gitStaging: GitStagingService,
    callbacks: StagingViewOptions,
  ) {
    this.renderer = renderer;
    this.callbacks = callbacks;
    this.gitStaging = gitStaging;
    this.theme = theme;

    // Root container — full screen, vertical layout
    this.root = new BoxRenderable(renderer, {
      id: "staging-root",
      flexDirection: "column",
      width: "100%",
      height: "100%",
      padding: 1,
    });

    // Title bar — updated when repo is set
    const titleBar = new TextRenderable(renderer, {
      id: "staging-title-bar",
      content: formatBreadcrumb(theme, ["Dot", "Diff", "Stage"], ""),
      marginBottom: 1,
    });
    this.root.add(titleBar);

    // --- Top pane: Staged ---
    this.stagedPane = new BoxRenderable(renderer, {
      id: "staging-staged-pane",
      flexDirection: "column",
      flexGrow: 1,
    });

    this.stagedTitle = new TextRenderable(renderer, {
      id: "staging-staged-title",
      content: formatPaneTitle(theme, "Staged", 0, false, theme.fgMuted),
      marginBottom: 0,
    });
    this.stagedPane.add(this.stagedTitle);

    this.stagedList = new StatusList(renderer, {
      id: "staging-staged-list",
      theme,
      onSelect: (item) => this.toggleFile(item.value),
      selectOnEnter: false,
    });
    this.stagedPane.add(this.stagedList);
    this.root.add(this.stagedPane);

    // Separator
    const separator = new TextRenderable(renderer, {
      id: "staging-separator",
      content: t`${fg(theme.surface)("─".repeat(60))}`,
      marginTop: 1,
      marginBottom: 0,
    });
    this.root.add(separator);

    // --- Bottom pane: Unstaged ---
    this.unstagedPane = new BoxRenderable(renderer, {
      id: "staging-unstaged-pane",
      flexDirection: "column",
      flexGrow: 1,
    });

    this.unstagedTitle = new TextRenderable(renderer, {
      id: "staging-unstaged-title",
      content: formatPaneTitle(theme, "Unstaged", 0, true, theme.fgMuted),
      marginBottom: 0,
    });
    this.unstagedPane.add(this.unstagedTitle);

    this.unstagedList = new StatusList(renderer, {
      id: "staging-unstaged-list",
      theme,
      onSelect: (item) => this.toggleFile(item.value),
      selectOnEnter: false,
    });
    this.unstagedPane.add(this.unstagedList);
    this.root.add(this.unstagedPane);

    // Status bar
    this.statusBar = new TextRenderable(renderer, {
      id: "staging-status-bar",
      content: t`${fg(theme.fgMuted)("")}`,
      marginTop: 1,
    });
    this.root.add(this.statusBar);

    addResponsiveHelpBar(renderer, this.root, {
      id: "staging-help-bar",
      theme,
      entries: HELP,
    });

    renderer.root.add(this.root);

    // Keyboard handling
    renderer.keyInput.on("keypress", (key) => {
      if (!this.isVisible || this.busy) return;

      if (key.name === "space") {
        this.toggleSelectedFile();
      } else if (key.name === "tab") {
        this.togglePane();
      } else if (key.name === "a") {
        this.stageAll();
      } else if (key.name === "l") {
        this.callbacks.onLazygit(this.repoPath);
      } else if (key.name === "return" || key.name === "c") {
        if (this.stagedFiles.length > 0) {
          this.callbacks.onCommit(this.repoPath);
        } else {
          this.statusBar.content = t`${fg(theme.yellow)("No staged files — stage files before committing")}`;
        }
      } else if (key.name === "escape" || key.name === "backspace") {
        this.callbacks.onBack();
      }
    });

    // Start on unstaged pane
    this.activePane = "unstaged";
  }

  /** Open the staging view for a specific repository */
  openForRepo(repoPath: string, repoName: string): void {
    this.repoPath = repoPath;
    this.repoName = repoName;
    this.activePane = "unstaged";
    this.statusBar.content = t`${fg(this.theme.fgMuted)("Loading...")}`;
    this.refreshFiles();
  }

  /** Show or hide the staging view */
  setVisible(visible: boolean): void {
    this.root.visible = visible;
    this.isVisible = visible;
  }

  /** Give keyboard focus to the active pane */
  focus(): void {
    this.focusPane(this.activePane);
  }

  /** Remove the staging view from the render tree */
  destroy(): void {
    this.renderer.root.remove(this.root.id);
  }

  /** Refresh the file lists from git status */
  private refreshFiles(): void {
    this.busy = true;
    Effect.runPromise(
      this.gitStaging.getStatus(this.repoPath).pipe(
        Effect.catch((err) => {
          log(`Status error: ${err.message}`);
          return Effect.succeed([] as readonly StagedFile[]);
        }),
      ),
    ).then((files) => {
      this.stagedFiles = files.filter((f) => f.staged);
      this.unstagedFiles = files.filter((f) => !f.staged);
      this.updateLists();
      this.busy = false;
    });
  }

  /** Update status list items from current file state */
  private updateLists(): void {
    this.stagedList.setItems(
      this.stagedFiles.map((f) => ({
        id: `staged:${f.path}`,
        title: `${this.statusIcon(f.status)} ${f.path}`,
        description: this.statusLabel(f.status),
        color: this.theme.green,
        value: f,
      })),
    );

    this.unstagedList.setItems(
      this.unstagedFiles.map((f) => ({
        id: `unstaged:${f.path}`,
        title: `${this.statusIcon(f.status)} ${f.path}`,
        description: this.statusLabel(f.status),
        color: this.theme.red,
        value: f,
      })),
    );

    this.updatePaneTitles();

    this.updateStatusBar();
    this.focusPane(this.activePane);
  }

  /** Toggle the currently selected file between staged and unstaged */
  private toggleSelectedFile(): void {
    const item =
      this.activePane === "staged"
        ? this.stagedList.getSelectedItem()
        : this.unstagedList.getSelectedItem();
    if (!item) return;

    this.toggleFile(item.value);
  }

  private toggleFile(file: StagedFile): void {
    if (this.busy) return;

    const filePath = file.path;
    this.busy = true;

    const effect = file.staged
      ? this.gitStaging.unstageFile(this.repoPath, filePath)
      : this.gitStaging.stageFile(this.repoPath, filePath);

    Effect.runPromise(
      effect.pipe(
        Effect.catch((err) => {
          log(`Toggle error: ${err.message}`);
          this.statusBar.content = t`${fg(this.theme.red)(`Error: ${err.message}`)}`;
          return Effect.void;
        }),
      ),
    ).then(() => {
      this.busy = false;
      this.refreshFiles();
    });
  }

  /** Stage all unstaged files */
  private stageAll(): void {
    if (this.unstagedFiles.length === 0) return;

    this.busy = true;
    this.statusBar.content = t`${fg(this.theme.yellow)("Staging all files...")}`;

    Effect.runPromise(
      this.gitStaging.stageAll(this.repoPath).pipe(
        Effect.catch((err) => {
          log(`Stage all error: ${err.message}`);
          this.statusBar.content = t`${fg(this.theme.red)(`Error: ${err.message}`)}`;
          return Effect.void;
        }),
      ),
    ).then(() => {
      this.busy = false;
      this.refreshFiles();
    });
  }

  private togglePane(): void {
    this.focusPane(this.activePane === "staged" ? "unstaged" : "staged");
  }

  private focusPane(pane: StagingPane): void {
    this.activePane = pane;
    this.stagedList.setActive(pane === "staged");
    this.unstagedList.setActive(pane === "unstaged");
    this.updatePaneTitles();
  }

  private updatePaneTitles(): void {
    this.stagedTitle.content = formatPaneTitle(
      this.theme,
      "Staged",
      this.stagedFiles.length,
      this.activePane === "staged",
      this.stagedFiles.length > 0 ? this.theme.green : this.theme.fgMuted,
    );
    this.unstagedTitle.content = formatPaneTitle(
      this.theme,
      "Unstaged",
      this.unstagedFiles.length,
      this.activePane === "unstaged",
      this.theme.fgMuted,
    );
  }

  private statusIcon(status: string): string {
    switch (status) {
      case "M":
        return "M";
      case "A":
        return "A";
      case "D":
        return "D";
      case "R":
        return "R";
      case "?":
        return "?";
      default:
        return status;
    }
  }

  private statusLabel(status: string): string {
    switch (status) {
      case "M":
        return "modified";
      case "A":
        return "added";
      case "D":
        return "deleted";
      case "R":
        return "renamed";
      case "C":
        return "copied";
      case "U":
        return "unmerged";
      case "?":
        return "untracked";
      default:
        return status;
    }
  }

  private updateStatusBar(): void {
    const th = this.theme;
    const staged = this.stagedFiles.length;
    const unstaged = this.unstagedFiles.length;
    const total = staged + unstaged;
    this.statusBar.content = t`${fg(th.fgMuted)(`${this.repoName}`)}    ${fg(th.green)(`${staged} staged`)}  ${fg(th.red)(`${unstaged} unstaged`)}  ${fg(th.fgMuted)(`${total} total`)}`;
  }
}
