import {
  type CliRenderer,
  BoxRenderable,
  TextRenderable,
  t,
  fg,
} from "@opentui/core";
import type { WorkflowRepoRuns, WorkflowRun, WorkflowState } from "../types.js";
import type { Theme } from "../theme.js";
import {
  formatWorkflowRepoDetail,
  formatWorkflowRunDetail,
  formatWorkflowTimeAgo,
  runFailed,
  runPassed,
  runRunning,
  workflowRepoStatus,
  workflowRepoStatusIcon,
  workflowRunStatusIcon,
} from "../services/workflowStatus.js";
import { formatBreadcrumb } from "./breadcrumb.js";
import { formatHelpBar, GLOBAL_HELP, type HelpEntry } from "./helpBar.js";
import { StatusList, type StatusListItem } from "./StatusList.js";

/** Help entries for the workflow runs view */
const HELP: readonly HelpEntry[] = [
  { key: "↑↓", action: "navigate" },
  { key: "Tab", action: "pane" },
  { key: "Enter", action: "runs/open" },
  { key: "r", action: "refresh" },
  { key: "Esc/Backspace", action: "back" },
  ...GLOBAL_HELP,
];

/** Configuration callbacks for the workflow runs view */
export interface WorkflowRunsViewOptions {
  /** Called when the user requests a workflow state refresh */
  readonly onRefresh: () => void;
  /** Called when the user opens a workflow run in the browser */
  readonly onOpenRun: (run: WorkflowRun) => void;
  /** Called when the user navigates back */
  readonly onBack: () => void;
}

type WorkflowPane = "repos" | "runs";

const INACTIVE_OPACITY = 0.45;

/** Two-pane workflow run view for watched GitHub repositories */
export class WorkflowRunsView {
  private renderer: CliRenderer;
  private callbacks: WorkflowRunsViewOptions;
  private theme: Theme;

  private root: BoxRenderable;
  private leftPane: BoxRenderable;
  private rightPane: BoxRenderable;
  private repoList: StatusList<WorkflowRepoRuns>;
  private runList: StatusList<WorkflowRun>;
  private repoTitle: TextRenderable;
  private runTitle: TextRenderable;
  private statusBar: TextRenderable;
  private helpBar: TextRenderable;

  private activePane: WorkflowPane = "repos";
  private repos: readonly WorkflowRepoRuns[] = [];
  private runs: readonly WorkflowRun[] = [];
  private state: WorkflowState | null = null;
  private selectedRepoSlug: string | null = null;
  private isVisible = false;
  private requestedInitialRefresh = false;

  constructor(
    renderer: CliRenderer,
    theme: Theme,
    callbacks: WorkflowRunsViewOptions,
  ) {
    this.renderer = renderer;
    this.callbacks = callbacks;
    this.theme = theme;

    this.root = new BoxRenderable(renderer, {
      id: "workflows-root",
      flexDirection: "column",
      width: "100%",
      height: "100%",
      padding: 1,
    });

    const titleBar = new TextRenderable(renderer, {
      id: "workflows-title-bar",
      content: formatBreadcrumb(theme, ["Dot", "Workflows"], "watched runs"),
      marginBottom: 1,
    });
    this.root.add(titleBar);

    const paneContainer = new BoxRenderable(renderer, {
      id: "workflows-pane-container",
      flexDirection: "row",
      flexGrow: 1,
      gap: 2,
    });

    this.leftPane = new BoxRenderable(renderer, {
      id: "workflows-left-pane",
      flexDirection: "column",
      flexGrow: 1,
      flexBasis: 0,
    });

    this.repoTitle = new TextRenderable(renderer, {
      id: "workflows-repo-title",
      content: this.formatPaneTitle("Repos", 0, true),
      marginBottom: 0,
    });
    this.leftPane.add(this.repoTitle);

    this.repoList = new StatusList(renderer, {
      id: "workflows-repo-list",
      theme,
      onSelect: () => this.focusPane("runs"),
      onSelectionChanged: (item) => {
        this.selectedRepoSlug = item.value.slug;
        this.updateRunsForSelectedRepo();
      },
    });
    this.leftPane.add(this.repoList);

    this.rightPane = new BoxRenderable(renderer, {
      id: "workflows-right-pane",
      flexDirection: "column",
      flexGrow: 1,
      flexBasis: 0,
    });

    this.runTitle = new TextRenderable(renderer, {
      id: "workflows-run-title",
      content: this.formatPaneTitle("Runs", 0, false),
      marginBottom: 0,
    });
    this.rightPane.add(this.runTitle);

    this.runList = new StatusList(renderer, {
      id: "workflows-run-list",
      theme,
      onSelect: (item) => {
        if (item.value.url) {
          this.callbacks.onOpenRun(item.value);
        } else {
          this.statusBar.content = t`${fg(this.theme.fgMuted)("No workflow run URL for selected item")}`;
        }
      },
    });
    this.rightPane.add(this.runList);

    paneContainer.add(this.leftPane);
    paneContainer.add(this.rightPane);
    this.root.add(paneContainer);

    this.statusBar = new TextRenderable(renderer, {
      id: "workflows-status-bar",
      content: t`${fg(theme.fgMuted)("Loading...")}`,
      marginTop: 1,
    });
    this.root.add(this.statusBar);

    this.helpBar = new TextRenderable(renderer, {
      id: "workflows-help-bar",
      content: formatHelpBar(theme, HELP),
    });
    this.root.add(this.helpBar);

    renderer.root.add(this.root);

    renderer.on("resize", () => {
      this.helpBar.content = formatHelpBar(this.theme, HELP);
    });

    renderer.keyInput.on("keypress", (key) => {
      if (!this.isVisible) return;

      if (key.name === "tab") {
        this.togglePane();
      } else if (key.name === "r") {
        this.statusBar.content = t`${fg(theme.yellow)("Refreshing workflows...")}`;
        this.callbacks.onRefresh();
      } else if (key.name === "escape" || key.name === "backspace") {
        this.callbacks.onBack();
      }
    });

    this.focusPane(this.activePane);
  }

  /** Update both panes and the status bar with a new workflow state snapshot */
  update(state: WorkflowState): void {
    this.state = state;
    this.repos = state.repos;

    const selectedSlug = this.pickSelectedRepoSlug();
    this.selectedRepoSlug = selectedSlug;

    this.repoList.setItems(
      state.repos.map((repo) => this.repoListItem(repo)),
      selectedSlug,
    );

    this.updateRunsForSelectedRepo();
    this.updatePaneTitles();
    this.updateStatusBar();
  }

  /** Show or hide the workflow runs view */
  setVisible(visible: boolean): void {
    this.root.visible = visible;
    this.isVisible = visible;
    if (visible && !this.requestedInitialRefresh) {
      this.requestedInitialRefresh = true;
      this.statusBar.content = t`${fg(this.theme.yellow)("Refreshing workflows...")}`;
      this.callbacks.onRefresh();
    }
  }

  /** Give keyboard focus to the currently active pane */
  focus(): void {
    this.focusPane(this.activePane);
  }

  /** Remove the workflow runs view from the render tree */
  destroy(): void {
    this.renderer.root.remove(this.root.id);
  }

  private togglePane(): void {
    this.focusPane(this.activePane === "repos" ? "runs" : "repos");
  }

  private focusPane(pane: WorkflowPane): void {
    this.activePane = pane;
    this.leftPane.opacity = pane === "repos" ? 1 : INACTIVE_OPACITY;
    this.rightPane.opacity = pane === "runs" ? 1 : INACTIVE_OPACITY;
    this.repoList.setActive(pane === "repos");
    this.runList.setActive(pane === "runs");
    this.updatePaneTitles();
  }

  private updatePaneTitles(): void {
    this.repoTitle.content = this.formatPaneTitle(
      "Repos",
      this.repos.length,
      this.activePane === "repos",
    );
    this.runTitle.content = this.formatPaneTitle(
      "Runs",
      this.runs.length,
      this.activePane === "runs",
    );
  }

  private updateRunsForSelectedRepo(): void {
    const repo = this.getSelectedRepo();
    this.runs = repo?.runs ?? [];
    this.runList.setItems(this.runs.map((run) => this.runListItem(run)));
    this.updatePaneTitles();
  }

  private repoListItem(
    repo: WorkflowRepoRuns,
  ): StatusListItem<WorkflowRepoRuns> {
    return {
      id: repo.slug,
      title: this.formatRepoName(repo),
      description: formatWorkflowRepoDetail(repo),
      color: this.repoStatusColor(repo),
      value: repo,
    };
  }

  private runListItem(run: WorkflowRun): StatusListItem<WorkflowRun> {
    return {
      id: run.id || run.url || run.workflowName,
      title: this.formatRunName(run),
      description: formatWorkflowRunDetail(run),
      color: this.runStatusColor(run),
      value: run,
    };
  }

  private pickSelectedRepoSlug(): string | null {
    if (
      this.selectedRepoSlug &&
      this.repos.some((repo) => repo.slug === this.selectedRepoSlug)
    ) {
      return this.selectedRepoSlug;
    }

    return this.repos[0]?.slug ?? null;
  }

  private getSelectedRepo(): WorkflowRepoRuns | undefined {
    if (!this.selectedRepoSlug) return undefined;
    return this.repos.find((repo) => repo.slug === this.selectedRepoSlug);
  }

  private formatPaneTitle(label: string, count: number, active: boolean) {
    const indicator = active ? "▸" : " ";
    const color = active ? this.theme.accent : this.theme.fgMuted;
    const countColor = count > 0 ? this.theme.accent : this.theme.fgMuted;
    return t`${fg(color)(`${indicator} ${label}`)} ${fg(countColor)(`(${count})`)}`;
  }

  private formatRepoName(repo: WorkflowRepoRuns): string {
    return `${workflowRepoStatusIcon(repo)} ${repo.slug}`;
  }

  private formatRunName(run: WorkflowRun): string {
    return `${workflowRunStatusIcon(run)} ${run.workflowName}`;
  }

  private repoStatusColor(repo: WorkflowRepoRuns): string {
    switch (workflowRepoStatus(repo)) {
      case "error":
      case "failed":
        return this.theme.red;
      case "running":
      case "mixed":
        return this.theme.yellow;
      case "passed":
        return this.theme.green;
      case "not-loaded":
      case "quiet":
        return this.theme.fgMuted;
    }
  }

  private runStatusColor(run: WorkflowRun): string {
    if (runRunning(run)) return this.theme.yellow;
    if (runPassed(run)) return this.theme.green;
    return runFailed(run) ? this.theme.red : this.theme.fgMuted;
  }

  private updateStatusBar(): void {
    if (!this.state) return;

    const th = this.theme;
    if (this.state.loading) {
      this.statusBar.content = t`${fg(th.yellow)("Refreshing workflows...")}`;
      return;
    }

    if (this.state.message) {
      this.statusBar.content = t`${fg(th.yellow)(this.state.message)}`;
      return;
    }

    if (this.state.repos.length === 0) {
      this.statusBar.content = t`${fg(th.fgMuted)("No watched workflow repositories configured")}`;
      return;
    }

    const failed = this.state.repos.filter((repo) =>
      repo.runs.some(runFailed),
    ).length;
    const running = this.state.repos.filter((repo) =>
      repo.runs.some(runRunning),
    ).length;
    const dot = failed > 0 ? fg(th.red)("●") : fg(th.green)("●");
    const summary =
      failed > 0
        ? fg(th.red)(`${failed} repo${failed === 1 ? "" : "s"} failing`)
        : running > 0
          ? fg(th.yellow)(`${running} repo${running === 1 ? "" : "s"} running`)
          : fg(th.green)("all watched runs passing or quiet");
    const since = this.state.since
      ? fg(th.fgMuted)(` since ${formatWorkflowTimeAgo(this.state.since)}`)
      : "";

    this.statusBar.content = t`${fg(th.fgMuted)(`Last checked: ${formatWorkflowTimeAgo(this.state.lastChecked.toISOString())}`)}${since}    ${dot}  ${summary}`;
  }
}
