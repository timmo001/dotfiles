import {
  type CliRenderer,
  BoxRenderable,
  TextRenderable,
  type KeyEvent,
  t,
  fg,
} from "@opentui/core";
import type { GitLogCommit, GitLogRepo, GitLogState } from "../../types.js";
import type { Theme } from "../../theme.js";
import { formatBreadcrumb } from "../../tui/breadcrumb.js";
import {
  addResponsiveHelpBar,
  GLOBAL_HELP,
  type HelpEntry,
} from "../../tui/helpBar.js";
import {
  formatCountPaneTitle,
  formatPaneTitle,
  setTwoPaneActive,
} from "../../tui/paneTitle.js";
import { StatusList, type StatusListItem } from "../../tui/StatusList.js";
import {
  formatGitLogCommitDetail,
  formatGitLogRepoDetail,
  formatGitLogTimeAgo,
} from "../services/gitLogStatus.js";

/** Help entries for the git log view. */
const HELP: readonly HelpEntry[] = [
  { key: "↑↓", action: "navigate" },
  { key: "Tab", action: "pane" },
  { key: "Enter", action: "commits/show" },
  { key: "r", action: "refresh" },
  { key: "Esc/Backspace", action: "back" },
  ...GLOBAL_HELP,
];

/** Configuration callbacks for the git log view. */
export interface GitLogViewOptions {
  /** Called when the user requests a git log refresh. */
  readonly onRefresh: () => void;
  /** Called when the user opens a commit in the pager. */
  readonly onOpenCommit: (repo: GitLogRepo, commit: GitLogCommit) => void;
  /** Called when the user navigates back. */
  readonly onBack: () => void;
}

type GitLogPane = "repos" | "commits";

const INACTIVE_OPACITY = 0.45;

/** Two-pane recent commit history view for tracked git repositories. */
export class GitLogView {
  private renderer: CliRenderer;
  private callbacks: GitLogViewOptions;
  private theme: Theme;

  private root: BoxRenderable;
  private leftPane: BoxRenderable;
  private rightPane: BoxRenderable;
  private repoList: StatusList<GitLogRepo>;
  private commitList: StatusList<GitLogCommit>;
  private repoTitle: TextRenderable;
  private commitTitle: TextRenderable;
  private statusBar: TextRenderable;

  private activePane: GitLogPane = "repos";
  private keyHandlers: Readonly<Record<string, () => void>>;
  private repos: readonly GitLogRepo[] = [];
  private commits: readonly GitLogCommit[] = [];
  private state: GitLogState | null = null;
  private selectedRepoPath: string | null = null;
  private isVisible = false;
  private requestedInitialRefresh = false;

  constructor(
    renderer: CliRenderer,
    theme: Theme,
    callbacks: GitLogViewOptions,
  ) {
    this.theme = theme;
    this.renderer = renderer;
    this.callbacks = callbacks;
    this.keyHandlers = this.createKeyHandlers();

    this.root = new BoxRenderable(renderer, {
      id: "git-log-root",
      flexDirection: "column",
      width: "100%",
      height: "100%",
      padding: 1,
    });

    const titleBar = new TextRenderable(renderer, {
      id: "git-log-title-bar",
      content: formatBreadcrumb(theme, ["Dot", "Git Log"], "recent commits"),
      marginBottom: 1,
    });
    this.root.add(titleBar);

    const paneContainer = new BoxRenderable(renderer, {
      id: "git-log-pane-container",
      flexDirection: "row",
      flexGrow: 1,
      gap: 2,
    });

    this.leftPane = new BoxRenderable(renderer, {
      id: "git-log-left-pane",
      flexDirection: "column",
      flexGrow: 1,
      flexBasis: 0,
    });

    this.repoTitle = new TextRenderable(renderer, {
      id: "git-log-repo-title",
      content: formatPaneTitle(theme, "Repos", 0, true, theme.fgMuted),
      marginBottom: 0,
    });
    this.leftPane.add(this.repoTitle);

    this.repoList = new StatusList(renderer, {
      id: "git-log-repo-list",
      theme,
      onSelect: () => this.focusPane("commits"),
      onSelectionChanged: (item) => {
        this.selectedRepoPath = item.value.path;
        this.updateCommitsForSelectedRepo();
      },
    });
    this.leftPane.add(this.repoList);

    this.rightPane = new BoxRenderable(renderer, {
      id: "git-log-right-pane",
      flexDirection: "column",
      flexGrow: 1,
      flexBasis: 0,
    });

    this.commitTitle = new TextRenderable(renderer, {
      id: "git-log-commit-title",
      content: formatPaneTitle(theme, "Commits", 0, false, theme.fgMuted),
      marginBottom: 0,
    });
    this.rightPane.add(this.commitTitle);

    this.commitList = new StatusList(renderer, {
      id: "git-log-commit-list",
      theme,
      onSelect: (item) => {
        const repo = this.getSelectedRepo();
        if (repo) this.callbacks.onOpenCommit(repo, item.value);
      },
    });
    this.rightPane.add(this.commitList);

    paneContainer.add(this.leftPane);
    paneContainer.add(this.rightPane);
    this.root.add(paneContainer);

    this.statusBar = new TextRenderable(renderer, {
      id: "git-log-status-bar",
      content: t`${fg(theme.fgMuted)("Loading...")}`,
      marginTop: 1,
    });
    this.root.add(this.statusBar);

    addResponsiveHelpBar(renderer, this.root, {
      id: "git-log-help-bar",
      theme,
      entries: HELP,
    });

    this.mount();
  }

  /** Update both panes and the status bar with a new git log snapshot. */
  update(state: GitLogState): void {
    this.state = state;
    this.repos = state.repos;

    const selectedPath = this.pickSelectedRepoPath();
    this.selectedRepoPath = selectedPath;
    this.repoList.setItems(
      this.repos.map((repo) => this.repoListItem(repo)),
      selectedPath,
    );

    this.updateCommitsForSelectedRepo();
    this.updatePaneTitles();
    this.updateStatusBar();
  }

  /** Show or hide the git log view. */
  setVisible(visible: boolean): void {
    this.root.visible = visible;
    this.isVisible = visible;
    this.refreshOnFirstOpen(visible);
  }

  /** Give keyboard focus to the currently active pane. */
  focus(): void {
    this.focusPane(this.activePane);
  }

  /** Remove the git log view from the render tree. */
  destroy(): void {
    this.renderer.root.remove(this.root);
  }

  private togglePane(): void {
    this.focusPane(this.activePane === "repos" ? "commits" : "repos");
  }

  private createKeyHandlers(): Readonly<Record<string, () => void>> {
    return {
      tab: () => this.togglePane(),
      r: () => this.requestRefresh(),
      escape: () => this.callbacks.onBack(),
      backspace: () => this.callbacks.onBack(),
    };
  }

  private mount(): void {
    this.renderer.root.add(this.root);
    this.renderer.keyInput.on("keypress", (key) => this.handleKeyPress(key));
    this.focus();
  }

  private refreshOnFirstOpen(visible: boolean): void {
    if (!visible || this.requestedInitialRefresh) return;
    this.requestedInitialRefresh = true;
    this.requestRefresh();
  }

  private requestRefresh(): void {
    this.statusBar.content = t`${fg(this.theme.yellow)("Refreshing git log...")}`;
    this.callbacks.onRefresh();
  }

  private handleKeyPress(key: KeyEvent): void {
    if (!this.isVisible) return;
    this.keyHandlers[key.name]?.();
  }

  private focusPane(pane: GitLogPane): void {
    this.activePane = pane;
    this.leftPane.opacity = pane === "repos" ? 1 : INACTIVE_OPACITY;
    this.rightPane.opacity = pane === "commits" ? 1 : INACTIVE_OPACITY;
    setTwoPaneActive(pane, "repos", this.repoList, "commits", this.commitList);
    this.updatePaneTitles();
  }

  private updateCommitsForSelectedRepo(): void {
    const repo = this.getSelectedRepo();
    this.commits = repo?.commits ?? [];
    this.commitList.setItems(
      this.commits.map((commit) => this.commitListItem(commit)),
    );
    this.updatePaneTitles();
  }

  private repoListItem(repo: GitLogRepo): StatusListItem<GitLogRepo> {
    return {
      id: repo.path,
      title: repo.name,
      description: formatGitLogRepoDetail(repo),
      color: repo.error
        ? this.theme.red
        : repo.latestAt
          ? this.theme.fg
          : this.theme.fgMuted,
      value: repo,
    };
  }

  private commitListItem(commit: GitLogCommit): StatusListItem<GitLogCommit> {
    return {
      id: commit.sha,
      title: `${commit.shortSha} ${commit.subject}`,
      description: formatGitLogCommitDetail(commit),
      color: this.theme.accent,
      value: commit,
    };
  }

  private pickSelectedRepoPath(): string | null {
    const selectedPath = this.selectedRepoPath;
    if (selectedPath === null) return this.firstRepoPath();
    return this.pathOrFirst(selectedPath);
  }

  private pathOrFirst(path: string): string | null {
    if (this.hasRepoPath(path)) return path;
    return this.firstRepoPath();
  }

  private firstRepoPath(): string | null {
    return this.repos[0]?.path ?? null;
  }

  private hasRepoPath(path: string): boolean {
    return this.repos.some((repo) => repo.path === path);
  }

  private getSelectedRepo(): GitLogRepo | undefined {
    if (!this.selectedRepoPath) return undefined;
    return this.repos.find((repo) => repo.path === this.selectedRepoPath);
  }

  private updatePaneTitles(): void {
    this.repoTitle.content = formatCountPaneTitle(
      this.theme,
      "Repos",
      this.repos.length,
      this.activePane === "repos",
    );
    this.commitTitle.content = formatCountPaneTitle(
      this.theme,
      "Commits",
      this.commits.length,
      this.activePane === "commits",
    );
  }

  private updateStatusBar(): void {
    const state = this.state;
    if (!state) return;
    this.updateStatusBarForState(state);
  }

  private updateStatusBarForState(state: GitLogState): void {
    if (this.showLoadingStatus(state)) return;
    if (this.showMessageStatus(state)) return;
    if (this.showEmptyStatus()) return;
    this.showSummaryStatus(state);
  }

  private showLoadingStatus(state: GitLogState): boolean {
    if (!state.loading) return false;
    this.statusBar.content = t`${fg(this.theme.yellow)("Refreshing git log...")}`;
    return true;
  }

  private showMessageStatus(state: GitLogState): boolean {
    if (!state.message) return false;
    this.statusBar.content = t`${fg(this.theme.yellow)(state.message)}`;
    return true;
  }

  private showEmptyStatus(): boolean {
    if (this.repos.length > 0) return false;
    this.statusBar.content = t`${fg(this.theme.fgMuted)("No tracked repositories found")}`;
    return true;
  }

  private showSummaryStatus(state: GitLogState): void {
    const th = this.theme;
    const commitCount = this.repos.reduce(
      (total, repo) => total + repo.commits.length,
      0,
    );
    const errorCount = this.repos.filter((repo) => repo.error).length;
    const dot = errorCount > 0 ? fg(th.red)("●") : fg(th.green)("●");
    const summary =
      errorCount > 0
        ? fg(th.red)(`${errorCount} repo${errorCount === 1 ? "" : "s"} errored`)
        : fg(th.green)(`${commitCount} recent commits`);

    this.statusBar.content = t`${fg(th.fgMuted)(`Last checked: ${formatGitLogTimeAgo(state.lastChecked.toISOString())}`)}    ${dot}  ${summary}`;
  }
}
