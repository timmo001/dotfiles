import {
  type CliRenderer,
  BoxRenderable,
  TextRenderable,
  InputRenderable,
  InputRenderableEvents,
  t,
  fg,
  bold,
} from "@opentui/core";
import { Effect } from "effect";
import type { CommitSuggestion } from "../../types.js";
import type { Theme } from "../../theme.js";
import type { GitStagingService } from "../services/GitStaging.js";
import type { CommitSuggestService } from "../services/CommitSuggest.js";
import { formatBreadcrumb } from "../../tui/breadcrumb.js";
import {
  formatHelpBar,
  GLOBAL_HELP,
  type HelpEntry,
} from "../../tui/helpBar.js";
import { StatusList } from "../../tui/StatusList.js";

/** Help entries for the commit view (default state) */
const HELP_DEFAULT: readonly HelpEntry[] = [
  { key: "Ctrl+s", action: "suggest" },
  { key: "Enter", action: "commit" },
  { key: "Esc", action: "back" },
  ...GLOBAL_HELP,
];

/** Help entries for the commit view when suggestions are visible */
const HELP_SUGGESTIONS: readonly HelpEntry[] = [
  { key: "Tab", action: "switch" },
  { key: "Enter", action: "select/commit" },
  { key: "Ctrl+s", action: "suggest" },
  { key: "Esc", action: "back" },
  ...GLOBAL_HELP,
];

const log = (msg: string) => console.error(`[dot:CommitView] ${msg}`);

/** Configuration and callbacks for the commit view */
export interface CommitViewOptions {
  /** Called after a successful commit to trigger a diff refresh */
  readonly onCommitComplete: () => void;
  /** Called when the user navigates back to the staging view */
  readonly onBack: () => void;
}

type CommitFocus = "input" | "suggestions";

/** Commit message input view with AI-powered suggestion list */
export class CommitView {
  private renderer: CliRenderer;
  private theme: Theme;
  private callbacks: CommitViewOptions;
  private gitStaging: GitStagingService;
  private commitSuggest: CommitSuggestService;

  private root: BoxRenderable;
  private titleText: TextRenderable;
  private messageInput: InputRenderable;
  private suggestionsTitle: TextRenderable;
  private suggestionsList: StatusList<CommitSuggestion>;
  private statusBar: TextRenderable;
  private helpBar: TextRenderable;

  private currentFocus: CommitFocus = "input";
  private suggestionsVisible = false;
  private repoPath = "";
  private repoName = "";
  private isVisible = false;
  private busy = false;

  constructor(
    renderer: CliRenderer,
    theme: Theme,
    gitStaging: GitStagingService,
    commitSuggest: CommitSuggestService,
    callbacks: CommitViewOptions,
  ) {
    this.renderer = renderer;
    this.theme = theme;
    this.callbacks = callbacks;
    this.gitStaging = gitStaging;
    this.commitSuggest = commitSuggest;

    // Root container
    this.root = new BoxRenderable(renderer, {
      id: "commit-root",
      flexDirection: "column",
      width: "100%",
      height: "100%",
      padding: 1,
    });

    // Title bar
    this.titleText = new TextRenderable(renderer, {
      id: "commit-title-bar",
      content: formatBreadcrumb(theme, ["Dot", "Diff", "Stage", "Commit"], ""),
      marginBottom: 1,
    });
    this.root.add(this.titleText);

    // Message label
    const messageLabel = new TextRenderable(renderer, {
      id: "commit-message-label",
      content: t`${bold(fg(theme.accent)("Message:"))}`,
      marginBottom: 0,
    });
    this.root.add(messageLabel);

    // Message input
    this.messageInput = new InputRenderable(renderer, {
      id: "commit-message-input",
      width: "100%",
      placeholder: "Type commit message or press Ctrl+s for suggestions...",
      backgroundColor: theme.bgElevated,
      focusedBackgroundColor: theme.bgInput,
      textColor: theme.fg,
      cursorColor: theme.accent,
    });
    this.root.add(this.messageInput);

    // Suggestions section (hidden initially)
    this.suggestionsTitle = new TextRenderable(renderer, {
      id: "commit-suggestions-title",
      content: t`${fg(theme.fgMuted)("── Suggestions ──")}`,
      marginTop: 1,
      marginBottom: 0,
    });
    this.suggestionsTitle.visible = false;
    this.root.add(this.suggestionsTitle);

    this.suggestionsList = new StatusList(renderer, {
      id: "commit-suggestions-list",
      theme,
      onSelect: (item) => {
        if (!this.isVisible || this.busy) return;
        this.messageInput.value = item.value.message;
        this.hideSuggestions();
        this.setFocus("input");
      },
    });
    this.suggestionsList.visible = false;
    this.root.add(this.suggestionsList);

    // Status bar
    this.statusBar = new TextRenderable(renderer, {
      id: "commit-status-bar",
      content: t`${fg(theme.fgMuted)("")}`,
      marginTop: 1,
    });
    this.root.add(this.statusBar);

    // Help bar
    this.helpBar = new TextRenderable(renderer, {
      id: "commit-help-bar",
      content: formatHelpBar(
        theme,
        HELP_DEFAULT,
        undefined,
        renderer.terminalWidth,
      ),
      width: "100%",
    });
    this.root.add(this.helpBar);

    renderer.root.add(this.root);

    // Re-wrap help bar on terminal resize
    renderer.on("resize", () => {
      this.updateHelpBar();
    });

    // Input enter event — commit
    this.messageInput.on(InputRenderableEvents.ENTER, (value: string) => {
      if (!this.isVisible || this.busy) return;
      if (value.trim()) {
        this.doCommit(value.trim());
      }
    });

    // Keyboard handling
    renderer.keyInput.on("keypress", (key) => {
      if (!this.isVisible || this.busy) return;

      if (key.name === "s" && key.ctrl) {
        this.requestSuggestions();
      } else if (key.name === "escape") {
        if (this.currentFocus === "suggestions") {
          this.hideSuggestions();
          this.setFocus("input");
        } else {
          this.callbacks.onBack();
        }
      } else if (key.name === "tab" && this.suggestionsVisible) {
        // Toggle between input and suggestions
        this.setFocus(this.currentFocus === "input" ? "suggestions" : "input");
      }
    });
  }

  /** Open the commit view for a specific repository */
  openForRepo(repoPath: string, repoName: string): void {
    this.repoPath = repoPath;
    this.repoName = repoName;
    this.messageInput.value = "";
    this.hideSuggestions();
    this.setFocus("input");
    this.statusBar.content = t`${fg(this.theme.fgMuted)(`Committing to ${repoName}`)}`;
  }

  /** Show or hide the commit view */
  setVisible(visible: boolean): void {
    this.root.visible = visible;
    this.isVisible = visible;
  }

  /** Give keyboard focus to the message input */
  focus(): void {
    this.setFocus("input");
  }

  /** Remove the commit view from the render tree */
  destroy(): void {
    this.renderer.root.remove(this.root.id);
  }

  /** Execute the commit with the given message */
  private doCommit(message: string): void {
    this.busy = true;
    this.statusBar.content = t`${fg(this.theme.yellow)("Committing...")}`;

    Effect.runPromise(
      this.gitStaging.commit(this.repoPath, { message }).pipe(
        Effect.catch((err) => {
          log(`Commit error: ${err.message}`);
          this.statusBar.content = t`${fg(this.theme.red)(`Commit failed: ${err.message}`)}`;
          this.busy = false;
          return Effect.void;
        }),
      ),
    ).then(() => {
      if (this.busy) {
        this.statusBar.content = t`${fg(this.theme.green)(`Committed: ${message}`)}`;
        this.busy = false;
        // Brief pause so the user sees the success message, then go back
        setTimeout(() => {
          this.callbacks.onCommitComplete();
        }, 800);
      }
    });
  }

  /** Request AI suggestions for the staged diff */
  private requestSuggestions(): void {
    this.busy = true;
    const modelId = this.commitSuggest.getModelId();
    const modelHint = modelId ? ` (${modelId})` : "";
    this.statusBar.content = t`${fg(this.theme.yellow)(`Generating suggestions${modelHint}...`)}`;
    this.suggestionsTitle.visible = true;
    this.suggestionsList.visible = true;
    this.suggestionsList.setItems([
      {
        id: "loading",
        title: "Loading...",
        description: "",
        color: this.theme.fgMuted,
        value: { message: "Loading..." },
      },
    ]);

    // Get diff and recent commits in parallel, then request suggestions
    const getSuggestions = Effect.gen({ self: this }, function* () {
      // Get staged diff
      const diffOutput = yield* Effect.tryPromise({
        try: async () => {
          const proc = Bun.spawn(
            ["git", "-C", this.repoPath, "diff", "--cached"],
            {
              stdout: "pipe",
              stderr: "pipe",
            },
          );
          const stdout = await new Response(proc.stdout).text();
          await proc.exited;
          return stdout;
        },
        catch: (e) => new Error(`Failed to get diff: ${e}`),
      });

      // Get recent commits from this repo and others
      const recentCommits = yield* this.gatherRecentCommits();

      // Request suggestions
      return yield* this.commitSuggest.suggest(diffOutput, recentCommits);
    });

    Effect.runPromise(
      getSuggestions.pipe(
        Effect.catch((err) => {
          log(`Suggestions error: ${err.message}`);
          this.statusBar.content = t`${fg(this.theme.red)(`Error: ${err.message}`)}`;
          this.hideSuggestions();
          this.busy = false;
          this.updateHelpBar();
          return Effect.succeed([] as readonly CommitSuggestion[]);
        }),
      ),
    ).then((suggestions) => {
      this.busy = false;
      if (suggestions.length > 0) {
        this.showSuggestions(suggestions);
      }
      this.updateHelpBar();
    });
  }

  /**
   * Gather recent commits from the target repo for style reference.
   */
  private gatherRecentCommits(): Effect.Effect<readonly string[], Error> {
    return Effect.gen({ self: this }, function* () {
      const targetCommits = yield* this.gitStaging.getRecentCommits(
        this.repoPath,
        10,
      );

      log(
        `Gathered ${targetCommits.length} recent commits for style reference`,
      );
      return targetCommits;
    });
  }

  /** Show the suggestion list with AI-generated options */
  private showSuggestions(suggestions: readonly CommitSuggestion[]): void {
    this.suggestionsVisible = true;
    this.suggestionsTitle.visible = true;
    this.suggestionsList.visible = true;
    this.suggestionsList.setItems(
      suggestions.map((suggestion, index) => ({
        id: `suggestion-${index}`,
        title: suggestion.message,
        description: "",
        color: this.theme.fg,
        value: suggestion,
      })),
    );
    this.statusBar.content = t`${fg(this.theme.green)("Select a suggestion or Tab to return to input")}`;
    this.updateHelpBar();
    this.setFocus("suggestions");
  }

  /** Hide the suggestion list */
  private hideSuggestions(): void {
    this.suggestionsVisible = false;
    this.suggestionsTitle.visible = false;
    this.suggestionsList.visible = false;
    this.suggestionsList.setItems([]);
    this.updateHelpBar();
  }

  private setFocus(target: CommitFocus): void {
    this.currentFocus = target;
    if (target === "input") {
      this.suggestionsList.setActive(false);
      this.messageInput.focus();
    } else {
      this.messageInput.blur();
      this.suggestionsList.setActive(true);
    }
  }

  private updateHelpBar(): void {
    const modelId = this.commitSuggest.getModelId();
    const entries = this.suggestionsVisible ? HELP_SUGGESTIONS : HELP_DEFAULT;
    const suffix = modelId ? fg(this.theme.fgGhost)(`[${modelId}]`) : undefined;
    this.helpBar.content = formatHelpBar(
      this.theme,
      entries,
      suffix,
      this.renderer.terminalWidth,
    );
  }
}
