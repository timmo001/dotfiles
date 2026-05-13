import {
  type CliRenderer,
  BoxRenderable,
  TextRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  t,
  fg,
} from "@opentui/core";
import { Effect } from "effect";
import type { StagedFile } from "../types.js";
import type { Theme } from "../theme.js";
import type { GitStagingService } from "../services/GitStaging.js";
import { formatBreadcrumb } from "./breadcrumb.js";
import { formatHelpBar, GLOBAL_HELP, type HelpEntry } from "./helpBar.js";

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

const log = (msg: string) => console.error(`[dot-tui:StagingView] ${msg}`);

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
  private stagedSelect: SelectRenderable;
  private unstagedSelect: SelectRenderable;
  private stagedTitle: TextRenderable;
  private unstagedTitle: TextRenderable;
  private statusBar: TextRenderable;
  private helpBar: TextRenderable;

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
      content: this.formatPaneTitle("Staged", 0, false),
      marginBottom: 0,
    });
    this.stagedPane.add(this.stagedTitle);

    this.stagedSelect = new SelectRenderable(renderer, {
      id: "staging-staged-select",
      flexGrow: 1,
      width: "100%",
      options: [],
      backgroundColor: theme.bgElevated,
      focusedBackgroundColor: theme.bgElevated,
      selectedBackgroundColor: theme.accent,
      selectedTextColor: theme.accentFg,
      textColor: theme.green,
      focusedTextColor: theme.green,
      descriptionColor: theme.fgMuted,
      selectedDescriptionColor: theme.fg,
      showDescription: true,
      showScrollIndicator: true,
      wrapSelection: true,
    });
    this.stagedPane.add(this.stagedSelect);
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
      content: this.formatPaneTitle("Unstaged", 0, true),
      marginBottom: 0,
    });
    this.unstagedPane.add(this.unstagedTitle);

    this.unstagedSelect = new SelectRenderable(renderer, {
      id: "staging-unstaged-select",
      flexGrow: 1,
      width: "100%",
      options: [],
      backgroundColor: theme.bgElevated,
      focusedBackgroundColor: theme.bgElevated,
      selectedBackgroundColor: theme.surface,
      selectedTextColor: theme.fg,
      textColor: theme.red,
      focusedTextColor: theme.red,
      descriptionColor: theme.fgMuted,
      selectedDescriptionColor: theme.fgMuted,
      showDescription: true,
      showScrollIndicator: true,
      wrapSelection: true,
    });
    this.unstagedPane.add(this.unstagedSelect);
    this.root.add(this.unstagedPane);

    // Status bar
    this.statusBar = new TextRenderable(renderer, {
      id: "staging-status-bar",
      content: t`${fg(theme.fgMuted)("")}`,
      marginTop: 1,
    });
    this.root.add(this.statusBar);

    // Help bar
    this.helpBar = new TextRenderable(renderer, {
      id: "staging-help-bar",
      content: formatHelpBar(theme, HELP),
    });
    this.root.add(this.helpBar);

    renderer.root.add(this.root);

    // Re-wrap help bar on terminal resize
    renderer.on("resize", () => {
      this.helpBar.content = formatHelpBar(this.theme, HELP);
    });

    // Wire select events (Enter on staged/unstaged list — no-op, we use space for toggle)
    this.stagedSelect.on(SelectRenderableEvents.ITEM_SELECTED, () => {
      // Enter on staged list does nothing — use space to toggle
    });
    this.unstagedSelect.on(SelectRenderableEvents.ITEM_SELECTED, () => {
      // Enter on unstaged list does nothing — use space to toggle
    });

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
        Effect.catchAll((err) => {
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

  /** Update SelectRenderable options from current file state */
  private updateLists(): void {
    this.stagedSelect.options = this.stagedFiles.map((f) => ({
      name: `${this.statusIcon(f.status)} ${f.path}`,
      description: this.statusLabel(f.status),
      value: f.path,
    }));

    this.unstagedSelect.options = this.unstagedFiles.map((f) => ({
      name: `${this.statusIcon(f.status)} ${f.path}`,
      description: this.statusLabel(f.status),
      value: f.path,
    }));

    this.stagedTitle.content = this.formatPaneTitle(
      "Staged",
      this.stagedFiles.length,
      this.activePane === "staged",
    );
    this.unstagedTitle.content = this.formatPaneTitle(
      "Unstaged",
      this.unstagedFiles.length,
      this.activePane === "unstaged",
    );

    this.updateStatusBar();
    this.focusPane(this.activePane);
  }

  /** Toggle the currently selected file between staged and unstaged */
  private toggleSelectedFile(): void {
    const select =
      this.activePane === "staged" ? this.stagedSelect : this.unstagedSelect;
    const option = select.getSelectedOption();
    if (!option) return;

    const filePath = option.value as string;
    this.busy = true;

    const effect =
      this.activePane === "unstaged"
        ? this.gitStaging.stageFile(this.repoPath, filePath)
        : this.gitStaging.unstageFile(this.repoPath, filePath);

    Effect.runPromise(
      effect.pipe(
        Effect.catchAll((err) => {
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
        Effect.catchAll((err) => {
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
    this.activePane = this.activePane === "staged" ? "unstaged" : "staged";
    this.focusPane(this.activePane);
    this.stagedTitle.content = this.formatPaneTitle(
      "Staged",
      this.stagedFiles.length,
      this.activePane === "staged",
    );
    this.unstagedTitle.content = this.formatPaneTitle(
      "Unstaged",
      this.unstagedFiles.length,
      this.activePane === "unstaged",
    );
  }

  private focusPane(pane: StagingPane): void {
    const th = this.theme;
    if (pane === "staged") {
      this.unstagedSelect.blur();
      this.stagedSelect.focus();

      // Active pane: restore highlight colours, full opacity
      this.stagedSelect.selectedBackgroundColor = th.accent;
      this.stagedSelect.selectedTextColor = th.accentFg;
      this.stagedSelect.selectedDescriptionColor = th.fg;
      this.stagedPane.opacity = 1;

      // Inactive pane: hide highlight (match background), dim opacity
      this.unstagedSelect.selectedBackgroundColor = th.bgElevated;
      this.unstagedSelect.selectedTextColor = th.red;
      this.unstagedSelect.selectedDescriptionColor = th.fgMuted;
      this.unstagedPane.opacity = 0.45;
    } else {
      this.stagedSelect.blur();
      this.unstagedSelect.focus();

      // Active pane: restore highlight colours, full opacity
      this.unstagedSelect.selectedBackgroundColor = th.surface;
      this.unstagedSelect.selectedTextColor = th.fg;
      this.unstagedSelect.selectedDescriptionColor = th.fgMuted;
      this.unstagedPane.opacity = 1;

      // Inactive pane: hide highlight (match background), dim opacity
      this.stagedSelect.selectedBackgroundColor = th.bgElevated;
      this.stagedSelect.selectedTextColor = th.green;
      this.stagedSelect.selectedDescriptionColor = th.fgMuted;
      this.stagedPane.opacity = 0.45;
    }
  }

  private formatPaneTitle(label: string, count: number, active: boolean) {
    const th = this.theme;
    const indicator = active ? "▸" : " ";
    const color = active ? th.accent : th.fgMuted;
    const countColor = label === "Staged" && count > 0 ? th.green : th.fgMuted;
    return t`${fg(color)(`${indicator} ${label}`)} ${fg(countColor)(`(${count})`)}`;
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
