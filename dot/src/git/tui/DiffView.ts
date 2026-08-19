import {
  type CliRenderer,
  BoxRenderable,
  InputRenderable,
  InputRenderableEvents,
  TextRenderable,
  type KeyEvent,
  t,
  fg,
} from "@opentui/core";
import { unlinkSync } from "node:fs";
import { join } from "node:path";
import type { Repo, RepoState } from "../../types.js";
import type { Theme } from "../../theme.js";
import { formatBreadcrumb } from "../../tui/breadcrumb.js";
import {
  addResponsiveHelpBar,
  GLOBAL_HELP,
  type HelpEntry,
} from "../../tui/helpBar.js";
import {
  editorLabel,
  type ExternalEditorKind,
} from "../../tui/externalEditor.js";
import {
  openCodeSessionLabel,
  type OpenCodeSessionMode,
} from "../../tui/openCodeSession.js";
import { formatPaneTitle, setTwoPaneActive } from "../../tui/paneTitle.js";
import { StatusList } from "../../tui/StatusList.js";
import { displayPath } from "../../lib/paths.js";

/** Help entries for the diff view */
const HELP: readonly HelpEntry[] = [
  { key: "↑↓", action: "navigate" },
  { key: "Tab", action: "pane" },
  { key: "/", action: "filter" },
  { key: "Enter", action: "lazygit" },
  { key: "e", action: "edit" },
  { key: "E", action: "visual edit" },
  { key: "o", action: "OpenCode" },
  { key: "O", action: "OpenCode plan" },
  { key: "x", action: "unlock" },
  { key: "t", action: "terminal" },
  { key: "w", action: "web" },
  { key: "r", action: "refresh" },
  { key: "Esc/Backspace", action: "back" },
  ...GLOBAL_HELP,
];

/** Configuration callbacks and initial state for the diff view */
export interface DiffViewOptions {
  /** Called when the user selects a repo (e.g. to open lazygit) */
  readonly onSelect: (repo: Repo) => void;
  /** Called to open the selected repo directory in an external editor */
  readonly onOpenEditor: (
    repo: Repo,
    kind: ExternalEditorKind,
  ) => Promise<void>;
  /** Called to open an interactive OpenCode session in the selected repo directory. */
  readonly onOpenOpencode: (
    repo: Repo,
    mode: OpenCodeSessionMode,
  ) => Promise<void>;
  /** Called to open a plain terminal in the selected repo's directory */
  readonly onOpenTerminal: (repo: Repo) => void;
  /** Called to open the selected repo on GitHub in the browser */
  readonly onOpenWeb: (repo: Repo) => void;
  /** Called when the user requests a manual refresh */
  readonly onRefresh: () => void;
  /** Called when the user navigates back (Escape/Backspace) */
  readonly onBack: () => void;
  /** Which pane to focus on startup (default: "changed") */
  readonly initialTab?: Pane;
}

type Pane = "changed" | "unchanged";

/** Two-pane diff view showing Changed and Other repositories with a status bar */
export class DiffView {
  private renderer: CliRenderer;
  private callbacks: DiffViewOptions;
  private theme: Theme;

  private root: BoxRenderable;
  private leftPane: BoxRenderable;
  private rightPane: BoxRenderable;
  private changedList: StatusList<Repo>;
  private unchangedList: StatusList<Repo>;
  private changedTitle: TextRenderable;
  private unchangedTitle: TextRenderable;
  private filterBox: BoxRenderable;
  private filterLabel: TextRenderable;
  private filterInput: InputRenderable;
  private statusBar: TextRenderable;

  private activePane: Pane = "changed";
  private keyHandlers: Readonly<Record<string, () => void>>;
  private changedRepos: readonly Repo[] = [];
  private unchangedRepos: readonly Repo[] = [];
  private filterPane: Pane | null = null;
  private filterQuery = "";
  private filterEditing = false;
  private lastChecked: Date = new Date();
  private isVisible = false;
  private openingEditor = false;
  private openingOpenCode = false;

  constructor(renderer: CliRenderer, theme: Theme, callbacks: DiffViewOptions) {
    this.renderer = renderer;
    this.callbacks = callbacks;
    this.theme = theme;
    this.keyHandlers = {
      tab: () => this.togglePane(),
      e: () => void this.openSelectedInEditor("editor"),
      "shift+e": () => void this.openSelectedInEditor("visual"),
      t: () =>
        this.runRepoAction((repo) => this.callbacks.onOpenTerminal(repo)),
      o: () => void this.openSelectedInOpenCode("default"),
      "shift+o": () => void this.openSelectedInOpenCode("plan"),
      w: () => this.runRepoAction((repo) => this.callbacks.onOpenWeb(repo)),
      r: () => {
        this.statusBar.content = t`${fg(this.theme.yellow)("Refreshing...")}`;
        this.callbacks.onRefresh();
      },
      x: () => this.removeLock(),
      escape: () => this.callbacks.onBack(),
      backspace: () => this.callbacks.onBack(),
    };

    // Root container — full screen
    this.root = new BoxRenderable(renderer, {
      id: "diff-root",
      flexDirection: "column",
      width: "100%",
      height: "100%",
      padding: 1,
    });

    // Title bar — breadcrumb style matching other subviews
    const titleBar = new TextRenderable(renderer, {
      id: "diff-title-bar",
      content: formatBreadcrumb(theme, ["Dot", "Diff"], "repo watcher"),
      marginBottom: 1,
    });
    this.root.add(titleBar);

    this.filterBox = new BoxRenderable(renderer, {
      id: "diff-filter-box",
      flexDirection: "row",
      width: "100%",
      flexShrink: 0,
      backgroundColor: theme.bgInput,
      paddingLeft: 1,
      paddingRight: 1,
      marginBottom: 1,
      visible: false,
    });
    this.filterLabel = new TextRenderable(renderer, {
      id: "diff-filter-label",
      content: t`${fg(theme.accent)("Filter Changed: ")}`,
    });
    this.filterInput = new InputRenderable(renderer, {
      id: "diff-filter-input",
      flexGrow: 1,
      placeholder: "repo name or path",
      placeholderColor: theme.fgSubtle,
      backgroundColor: theme.bgInput,
      focusedBackgroundColor: theme.bgInput,
      textColor: theme.fg,
      focusedTextColor: theme.fg,
      cursorColor: theme.accent,
    });
    this.filterInput.on(InputRenderableEvents.INPUT, (value: string) => {
      this.filterQuery = value;
      this.updateRepoLists();
    });
    this.filterInput.on(InputRenderableEvents.ENTER, () => {
      this.filterEditing = false;
      this.focusPane(this.activePane);
    });
    this.filterBox.add(this.filterLabel);
    this.filterBox.add(this.filterInput);
    this.root.add(this.filterBox);

    // Two-pane container
    const paneContainer = new BoxRenderable(renderer, {
      id: "diff-pane-container",
      flexDirection: "row",
      flexGrow: 1,
      gap: 2,
    });

    // --- Left pane: Changed ---
    this.leftPane = new BoxRenderable(renderer, {
      id: "diff-left-pane",
      flexDirection: "column",
      flexGrow: 1,
      flexBasis: 0,
    });

    this.changedTitle = new TextRenderable(renderer, {
      id: "diff-changed-title",
      content: formatPaneTitle(theme, "Changed", 0, true, theme.fgMuted),
      marginBottom: 0,
    });
    this.leftPane.add(this.changedTitle);

    this.changedList = new StatusList(renderer, {
      id: "diff-changed-list",
      theme,
      onSelect: (item) => this.callbacks.onSelect(item.value),
    });
    this.leftPane.add(this.changedList);

    // --- Right pane: Unchanged ---
    this.rightPane = new BoxRenderable(renderer, {
      id: "diff-right-pane",
      flexDirection: "column",
      flexGrow: 1,
      flexBasis: 0,
    });

    this.unchangedTitle = new TextRenderable(renderer, {
      id: "diff-unchanged-title",
      content: formatPaneTitle(theme, "Other", 0, false, theme.fgMuted),
      marginBottom: 0,
    });
    this.rightPane.add(this.unchangedTitle);

    this.unchangedList = new StatusList(renderer, {
      id: "diff-unchanged-list",
      theme,
      onSelect: (item) => this.callbacks.onSelect(item.value),
    });
    this.rightPane.add(this.unchangedList);

    paneContainer.add(this.leftPane);
    paneContainer.add(this.rightPane);
    this.root.add(paneContainer);

    // Status bar
    this.statusBar = new TextRenderable(renderer, {
      id: "diff-status-bar",
      content: t`${fg(theme.fgMuted)("Loading...")}`,
      marginTop: 1,
    });
    this.root.add(this.statusBar);

    addResponsiveHelpBar(renderer, this.root, {
      id: "diff-help-bar",
      theme,
      entries: HELP,
    });

    renderer.root.add(this.root);

    renderer.keyInput.on("keypress", (key) => this.handleKeyPress(key));

    // Focus the initial pane
    this.activePane = callbacks.initialTab ?? "changed";
    this.focusPane(this.activePane);

    // Update titles to reflect initial pane
    this.updatePaneTitles();
  }

  /** Update both panes and the status bar with a new repo state snapshot */
  update(state: RepoState): void {
    this.changedRepos = state.changed;
    this.unchangedRepos = state.unchanged;
    this.lastChecked = state.lastChecked;

    this.updateRepoLists();
  }

  /** Show or hide the diff view */
  setVisible(visible: boolean): void {
    this.root.visible = visible;
    this.isVisible = visible;
    if (!visible) {
      this.filterEditing = false;
      this.filterInput.blur();
      this.changedList.setActive(false);
      this.unchangedList.setActive(false);
    }
  }

  /** Give keyboard focus to the currently active pane */
  focus(): void {
    this.focusPane(this.activePane);
  }

  /** Focus a changed repository by name and activate its lazygit action. */
  openChangedRepo(name: string): boolean {
    const repo = this.changedRepos.find((candidate) => candidate.name === name);
    if (!repo || !this.changedList.selectById(repo.path)) return false;
    this.focusPane("changed");
    this.callbacks.onSelect(repo);
    return true;
  }

  private togglePane(): void {
    this.focusPane(this.activePane === "changed" ? "unchanged" : "changed");
  }

  private handleKeyPress(key: KeyEvent): void {
    if (!this.isVisible) return;
    if (this.filterEditing) {
      if (key.name === "escape") {
        key.stopPropagation();
        this.clearFilter();
      }
      return;
    }
    if (key.name === "/") {
      key.stopPropagation();
      this.openFilter();
      return;
    }
    if (
      (key.name === "escape" || key.name === "backspace") &&
      this.filterPane !== null
    ) {
      key.stopPropagation();
      this.clearFilter();
      return;
    }
    this.keyHandlers[`${key.shift ? "shift+" : ""}${key.name}`]?.();
  }

  private openFilter(): void {
    if (this.filterPane !== this.activePane) this.filterQuery = "";
    this.filterPane = this.activePane;
    this.filterEditing = true;
    this.filterLabel.content = t`${fg(this.theme.accent)(`Filter ${this.activePane === "changed" ? "Changed" : "Other"}: `)}`;
    this.filterBox.visible = true;
    this.filterInput.value = this.filterQuery;
    this.changedList.setActive(false);
    this.unchangedList.setActive(false);
    this.filterInput.focus();
    this.updateRepoLists();
  }

  private clearFilter(): void {
    this.filterEditing = false;
    this.filterPane = null;
    this.filterQuery = "";
    this.filterInput.value = "";
    this.filterBox.visible = false;
    this.focusPane(this.activePane);
    this.updateRepoLists();
  }

  private updateRepoLists(): void {
    const changed = this.filteredRepos("changed", this.changedRepos);
    const unchanged = this.filteredRepos("unchanged", this.unchangedRepos);
    this.changedList.setItems(
      changed.map((repo) => ({
        id: repo.path,
        title: this.formatRepoName(repo),
        description: this.shortenPath(repo.path),
        color: repo.locked ? this.theme.yellow : this.theme.fg,
        value: repo,
      })),
    );
    this.unchangedList.setItems(
      unchanged.map((repo) => ({
        id: repo.path,
        title: this.formatRepoName(repo),
        description: this.shortenPath(repo.path),
        color: repo.locked ? this.theme.yellow : this.theme.fgMuted,
        value: repo,
      })),
    );
    this.updatePaneTitles();
    this.updateStatusBar();
  }

  private filteredRepos(pane: Pane, repos: readonly Repo[]): readonly Repo[] {
    if (this.filterPane !== pane || this.filterQuery.length === 0) return repos;
    const query = this.filterQuery.toLocaleLowerCase();
    return repos.filter(
      (repo) =>
        repo.name.toLocaleLowerCase().includes(query) ||
        this.shortenPath(repo.path).toLocaleLowerCase().includes(query),
    );
  }

  private runRepoAction(action: (repo: Repo) => void): void {
    const repo = this.getActiveRepo();
    if (repo) action(repo);
  }

  private async openSelectedInEditor(kind: ExternalEditorKind): Promise<void> {
    if (this.openingEditor) {
      this.statusBar.content = t`${fg(this.theme.yellow)("An editor is already open")}`;
      return;
    }

    const repo = this.getActiveRepo();
    if (!repo) {
      this.statusBar.content = t`${fg(this.theme.yellow)("Select a repo before opening editor")}`;
      return;
    }

    this.openingEditor = true;
    this.statusBar.content = t`${fg(this.theme.yellow)(`Opening ${repo.name} in ${editorLabel(kind)}...`)}`;

    try {
      await this.callbacks.onOpenEditor(repo, kind);
      this.statusBar.content = t`${fg(this.theme.green)(`Opened ${repo.name} in ${editorLabel(kind)}`)}`;
    } catch (error) {
      this.statusBar.content = t`${fg(this.theme.red)(`Failed to open ${repo.name}: ${errorMessage(error)}`)}`;
    } finally {
      this.openingEditor = false;
    }
  }

  private async openSelectedInOpenCode(
    mode: OpenCodeSessionMode,
  ): Promise<void> {
    if (this.openingOpenCode) {
      this.statusBar.content = t`${fg(this.theme.yellow)("An OpenCode session is already open")}`;
      return;
    }

    const repo = this.getActiveRepo();
    if (!repo) {
      this.statusBar.content = t`${fg(this.theme.yellow)("Select a repo before opening OpenCode")}`;
      return;
    }

    this.openingOpenCode = true;
    const label = openCodeSessionLabel(mode);
    this.statusBar.content = t`${fg(this.theme.yellow)(`Opening ${repo.name} in ${label}...`)}`;

    try {
      await this.callbacks.onOpenOpencode(repo, mode);
      this.statusBar.content = t`${fg(this.theme.green)(`Closed ${label} for ${repo.name}`)}`;
    } catch (error) {
      this.statusBar.content = t`${fg(this.theme.red)(`Failed to open ${label} for ${repo.name}: ${errorMessage(error)}`)}`;
    } finally {
      this.openingOpenCode = false;
    }
  }

  private focusPane(pane: Pane): void {
    this.activePane = pane;
    setTwoPaneActive(
      pane,
      "changed",
      this.changedList,
      "unchanged",
      this.unchangedList,
    );
    this.updatePaneTitles();
  }

  /** Return the repo currently highlighted in the active pane, if any */
  private getActiveRepo(): Repo | undefined {
    if (this.activePane === "changed") {
      return this.changedList.getSelectedItem()?.value;
    }
    return this.unchangedList.getSelectedItem()?.value;
  }

  private updatePaneTitles(): void {
    const changedCount = this.filteredRepos(
      "changed",
      this.changedRepos,
    ).length;
    const unchangedCount = this.filteredRepos(
      "unchanged",
      this.unchangedRepos,
    ).length;
    this.changedTitle.content = formatPaneTitle(
      this.theme,
      "Changed",
      changedCount,
      this.activePane === "changed",
      this.changedRepos.length > 0 ? this.theme.red : this.theme.fgMuted,
    );
    this.unchangedTitle.content = formatPaneTitle(
      this.theme,
      "Other",
      unchangedCount,
      this.activePane === "unchanged",
      this.theme.fgMuted,
    );
  }

  /** Format a repo name with a lock indicator when `.git/index.lock` exists */
  private formatRepoName(repo: Repo): string {
    return repo.locked ? `󰌾 ${repo.name}` : repo.name;
  }

  /** Remove `.git/index.lock` for the selected repo and trigger a refresh */
  private removeLock(): void {
    const th = this.theme;
    const repo = this.getActiveRepo();
    if (!repo) return;

    if (!repo.locked) {
      this.statusBar.content = t`${fg(th.fgMuted)(`${repo.name} has no lock file`)}`;
      return;
    }

    const lockPath = join(repo.path, ".git", "index.lock");
    try {
      unlinkSync(lockPath);
      this.statusBar.content = t`${fg(th.green)(`Removed index.lock from ${repo.name}`)}`;
      this.callbacks.onRefresh();
    } catch {
      this.statusBar.content = t`${fg(th.red)(`Failed to remove index.lock from ${repo.name}`)}`;
    }
  }

  private updateStatusBar(): void {
    const th = this.theme;
    const ago = this.formatTimeAgo(this.lastChecked);
    const changedCount = this.changedRepos.length;
    const dot = changedCount > 0 ? fg(th.red)("●") : fg(th.green)("●");
    const countText =
      changedCount > 0
        ? fg(th.red)(
            `${changedCount} repo${changedCount === 1 ? "" : "s"} changed`,
          )
        : fg(th.green)("all clean");

    const allRepos = [...this.changedRepos, ...this.unchangedRepos];
    const lockedCount = allRepos.filter((r) => r.locked).length;
    const filterText =
      this.filterPane === null
        ? ""
        : `    ${this.filterPane === "changed" ? "Changed" : "Other"} filter: ${this.filterQuery || "all"}`;

    if (lockedCount > 0) {
      this.statusBar.content = t`${fg(th.fgMuted)(`Last checked: ${ago}`)}    ${dot}  ${countText}    ${fg(th.yellow)("󰌾")}  ${fg(th.yellow)(`${lockedCount} locked`)}${fg(th.fgMuted)(filterText)}`;
    } else {
      this.statusBar.content = t`${fg(th.fgMuted)(`Last checked: ${ago}`)}    ${dot}  ${countText}${fg(th.fgMuted)(filterText)}`;
    }
  }

  private formatTimeAgo(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 5) return "just now";
    if (seconds < 60) return `${seconds}s ago`;
    const minutes = Math.floor(seconds / 60);
    return `${minutes}m ago`;
  }

  private shortenPath(path: string): string {
    return displayPath(path);
  }

  /** Remove the diff view from the render tree */
  destroy(): void {
    this.renderer.root.remove(this.root);
  }
}

function errorMessage(cause: unknown): string {
  if (cause instanceof Error) return cause.message;
  return String(cause);
}
