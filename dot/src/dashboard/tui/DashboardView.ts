import {
  type CliRenderer,
  BoxRenderable,
  ScrollBoxRenderable,
  TextRenderable,
  type KeyEvent,
  t,
  fg,
  bold,
} from "@opentui/core";
import type { StyledText } from "@opentui/core";
import type { Theme } from "../../theme.js";
import type { ViewId } from "../../types.js";
import type {
  DashboardCard,
  DashboardSection,
  DashboardState,
  DashboardTone,
} from "../types.js";
import { formatBreadcrumb } from "../../tui/breadcrumb.js";
import {
  addResponsiveHelpBar,
  GLOBAL_HELP,
  type HelpEntry,
} from "../../tui/helpBar.js";

/** Help entries for the dashboard view. */
const HELP: readonly HelpEntry[] = [
  { key: "arrows", action: "navigate cards" },
  { key: "Tab", action: "next card" },
  { key: "Enter", action: "open linked view" },
  { key: "r", action: "refresh" },
  { key: "Esc/Backspace", action: "back" },
  ...GLOBAL_HELP,
];

/** Fixed width of each rich card; drives how many cards wrap per row. */
const CARD_WIDTH = 44;

const INITIAL_STATE = {
  summaryHeadline: "Loading dashboard sources",
  summaryTone: "muted",
  summaryLines: [],
  lastChecked: new Date(),
  loading: true,
  sections: [
    {
      title: "Overview",
      cards: [
        {
          id: "today",
          section: "Overview",
          title: "Events in the next hour",
          headline: "Loading calendar",
          tone: "muted",
          lines: [],
        },
        {
          id: "updates",
          section: "Overview",
          title: "Updates",
          headline: "Loading update state",
          tone: "muted",
          lines: [],
        },
        {
          id: "live",
          section: "Overview",
          title: "Live Channels",
          headline: "Loading live channels",
          tone: "muted",
          lines: [],
        },
        {
          id: "environment",
          section: "Overview",
          title: "Environment",
          headline: "Loading environment",
          tone: "muted",
          lines: [],
        },
      ],
    },
    {
      title: "Git",
      cards: [
        {
          id: "git",
          section: "Git",
          title: "Git Diff",
          headline: "Loading git state",
          tone: "muted",
          lines: [],
          viewId: "git-diff",
          actionLabel: "Open Git Diff",
        },
        {
          id: "github",
          section: "Git",
          title: "Git Notifications",
          headline: "Loading GitHub state",
          tone: "muted",
          lines: [],
          viewId: "git-notifications",
          actionLabel: "Open Notifications",
        },
      ],
    },
    {
      title: "Todos",
      cards: [
        {
          id: "my-tasks",
          section: "Todos",
          title: "My Tasks",
          headline: "Loading tasks",
          tone: "muted",
          lines: [],
        },
        {
          id: "work-tasks",
          section: "Todos",
          title: "Work Tasks",
          headline: "Loading tasks",
          tone: "muted",
          lines: [],
        },
      ],
    },
  ],
} satisfies DashboardState;

interface DashboardCardRenderables {
  readonly card: DashboardCard;
  readonly box: BoxRenderable;
  readonly headline: TextRenderable;
  readonly details: TextRenderable;
  readonly action: TextRenderable;
}

/** Configuration callbacks for the dashboard view. */
export interface DashboardViewOptions {
  /** Called when the user opens a linked TUI view from a dashboard card. */
  readonly onOpenView: (viewId: ViewId) => void;
  /** Called when the user runs a dashboard card command. */
  readonly onRunCommand: (
    command: string,
    mode: DashboardCard["commandMode"],
  ) => void;
  /** Called when the user requests a dashboard source refresh. */
  readonly onRefresh: () => void;
  /** Called when the user navigates back. */
  readonly onBack: () => void;
}

/** Mission Control style dashboard view. */
export class DashboardView {
  private readonly renderer: CliRenderer;
  private readonly theme: Theme;
  private readonly callbacks: DashboardViewOptions;
  private readonly root: BoxRenderable;
  private readonly body: ScrollBoxRenderable;
  private readonly gridContainer: BoxRenderable;
  private readonly statusBar: TextRenderable;
  private readonly renderedCards: DashboardCardRenderables[] = [];
  private state: DashboardState = INITIAL_STATE;
  private selectedIndex = 0;
  private isVisible = false;
  private requestedInitialRefresh = false;
  private readonly keyHandlers: Readonly<Record<string, () => void>>;

  constructor(
    renderer: CliRenderer,
    theme: Theme,
    callbacks: DashboardViewOptions,
  ) {
    this.renderer = renderer;
    this.theme = theme;
    this.callbacks = callbacks;
    this.keyHandlers = {
      tab: () => this.selectRelative(1),
      up: () => this.moveSelection("up"),
      down: () => this.moveSelection("down"),
      left: () => this.moveSelection("left"),
      right: () => this.moveSelection("right"),
      return: () => this.openSelectedCard(),
      r: () => this.refresh(),
      escape: () => this.callbacks.onBack(),
      backspace: () => this.callbacks.onBack(),
    };

    this.root = new BoxRenderable(renderer, {
      id: "dashboard-root",
      flexDirection: "column",
      width: "100%",
      height: "100%",
      padding: 1,
      gap: 1,
    });

    const titleBar = new TextRenderable(renderer, {
      id: "dashboard-title-bar",
      content: formatBreadcrumb(theme, ["Dot", "Dashboard"], "Mission Control"),
      width: "100%",
    });
    this.root.add(titleBar);

    this.body = new ScrollBoxRenderable(renderer, {
      id: "dashboard-body",
      width: "100%",
      flexGrow: 1,
      flexShrink: 1,
      scrollY: true,
      scrollX: false,
      backgroundColor: "transparent",
      contentOptions: {
        flexDirection: "column",
        gap: 1,
        backgroundColor: "transparent",
      },
      viewportOptions: {
        backgroundColor: "transparent",
      },
      scrollbarOptions: {
        trackOptions: {
          foregroundColor: theme.accent,
          backgroundColor: theme.surface,
        },
      },
    });
    this.root.add(this.body);

    this.gridContainer = new BoxRenderable(renderer, {
      id: "dashboard-grid",
      flexDirection: "row",
      flexWrap: "wrap",
      width: "100%",
      flexGrow: 0,
      flexShrink: 0,
      rowGap: 0,
      columnGap: 1,
    });
    this.body.add(this.gridContainer);
    this.buildSections();

    this.statusBar = new TextRenderable(renderer, {
      id: "dashboard-status-bar",
      content: this.formatStatusBar(),
      width: "100%",
    });
    this.root.add(this.statusBar);

    addResponsiveHelpBar(renderer, this.root, {
      id: "dashboard-help-bar",
      theme,
      entries: HELP,
    });

    renderer.root.add(this.root);
    renderer.keyInput.on("keypress", (key) => this.handleKeyPress(key));
    renderer.on("resize", () => this.handleResize());
    this.update(this.state);
    this.refreshSelectionStyles();
  }

  /** Update the dashboard cards and summary from live source state. */
  update(state: DashboardState): void {
    const selectedId = this.renderedCards[this.selectedIndex]?.card.id;
    this.state = state;
    this.rebuildSections();
    if (selectedId) this.selectCard(selectedId, { fallbackToFirst: true });
    else this.refreshSelectionStyles();
  }

  /** Show or hide the dashboard view. */
  setVisible(visible: boolean): void {
    this.root.visible = visible;
    this.isVisible = visible;
    if (!visible || this.requestedInitialRefresh) return;
    this.requestedInitialRefresh = true;
    this.callbacks.onRefresh();
  }

  /** Give keyboard focus to the selected dashboard card. */
  focus(): void {
    this.renderedCards[this.selectedIndex]?.box.focus();
  }

  /** Remove the dashboard view from the render tree. */
  destroy(): void {
    this.renderer.root.remove(this.root.id);
  }

  private buildSections(): void {
    let firstSection = true;
    for (const section of this.state.sections) {
      const slug = section.title.toLowerCase().replace(/\s+/g, "-");
      const headingBox = new BoxRenderable(this.renderer, {
        id: `dashboard-section-${slug}`,
        width: "100%",
        flexShrink: 0,
        marginTop: firstSection ? 0 : 1,
      });
      headingBox.add(
        new TextRenderable(this.renderer, {
          id: `dashboard-section-${slug}-title`,
          content: t`${bold(fg(this.theme.fgSubtle)(section.title))}`,
          selectable: false,
        }),
      );
      this.gridContainer.add(headingBox);

      for (const card of section.cards) {
        const renderables = this.createCard(card);
        this.renderedCards.push(renderables);
        this.gridContainer.add(renderables.box);
      }

      firstSection = false;
    }
  }

  private rebuildSections(): void {
    for (const child of this.gridContainer.getChildren()) {
      this.gridContainer.remove(child.id);
      child.destroyRecursively();
    }
    this.renderedCards.length = 0;
    this.buildSections();
  }

  private createCard(card: DashboardCard): DashboardCardRenderables {
    const toneColor = this.toneColor(card.tone);
    const box = new BoxRenderable(this.renderer, {
      id: `dashboard-card-${card.id}`,
      width: CARD_WIDTH,
      height: 8,
      flexGrow: 0,
      flexShrink: 0,
      border: true,
      borderStyle: "rounded",
      borderColor: toneColor,
      title: card.title,
      titleColor: toneColor,
      paddingX: 1,
      paddingY: 0,
      backgroundColor: this.theme.bgElevated,
      flexDirection: "column",
      onMouseDown: (event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        this.selectCard(card.id);
        this.openSelectedCard();
      },
    });

    const headline = new TextRenderable(this.renderer, {
      id: `dashboard-card-${card.id}-headline`,
      content: t`${fg(toneColor)(card.headline)}`,
      width: "100%",
      selectable: false,
    });
    const details = new TextRenderable(this.renderer, {
      id: `dashboard-card-${card.id}-details`,
      content: this.formatCardLines(card),
      width: "100%",
      wrapMode: "word",
      selectable: false,
    });
    const action = new TextRenderable(this.renderer, {
      id: `dashboard-card-${card.id}-action`,
      content: this.formatCardAction(card),
      width: "100%",
      selectable: false,
    });

    box.add(headline);
    box.add(details);
    box.add(action);
    return { card, box, headline, details, action };
  }

  private handleKeyPress(key: KeyEvent): void {
    if (!this.isVisible) return;
    this.keyHandlers[key.name]?.();
  }

  private handleResize(): void {
    this.statusBar.content = this.formatStatusBar();
    this.refreshSelectionStyles();
  }

  private selectRelative(delta: number): void {
    const count = this.renderedCards.length;
    this.selectedIndex = (this.selectedIndex + delta + count) % count;
    this.refreshSelectionStyles();
  }

  private moveSelection(direction: "left" | "right" | "up" | "down"): void {
    const current = this.renderedCards[this.selectedIndex];
    if (!current) return;
    this.body.updateFromLayout();

    const origin = cardCentre(current.box);
    let bestIndex = -1;
    let bestScore = Number.POSITIVE_INFINITY;

    for (let index = 0; index < this.renderedCards.length; index++) {
      if (index === this.selectedIndex) continue;
      const candidate = cardCentre(this.renderedCards[index].box);
      const dx = candidate.x - origin.x;
      const dy = candidate.y - origin.y;

      let matches = false;
      let score = 0;
      switch (direction) {
        case "right":
          matches = dx > 0;
          score = Math.abs(dy) * 1000 + dx;
          break;
        case "left":
          matches = dx < 0;
          score = Math.abs(dy) * 1000 - dx;
          break;
        case "down":
          matches = dy > 0;
          score = Math.abs(dx) * 1000 + dy;
          break;
        case "up":
          matches = dy < 0;
          score = Math.abs(dx) * 1000 - dy;
          break;
      }

      if (!matches || score >= bestScore) continue;
      bestScore = score;
      bestIndex = index;
    }

    if (bestIndex === -1) return;
    this.selectedIndex = bestIndex;
    this.refreshSelectionStyles();
  }

  private selectCard(
    cardId: string,
    options?: { readonly fallbackToFirst?: boolean },
  ): void {
    const index = this.renderedCards.findIndex(
      ({ card }) => card.id === cardId,
    );
    if (index === -1) {
      this.selectedIndex = options?.fallbackToFirst ? 0 : this.selectedIndex;
    } else {
      this.selectedIndex = index;
    }
    this.refreshSelectionStyles();
  }

  private openSelectedCard(): void {
    const card = this.renderedCards[this.selectedIndex]?.card;
    if (!card) return;
    const viewId = card.viewId;
    const command = card.command;
    if (viewId) queueMicrotask(() => this.callbacks.onOpenView(viewId));
    else if (command)
      queueMicrotask(() =>
        this.callbacks.onRunCommand(command, card.commandMode),
      );
  }

  private refresh(): void {
    this.statusBar.content = t`${fg(this.theme.yellow)("Refreshing dashboard sources...")}`;
    this.callbacks.onRefresh();
  }

  private refreshSelectionStyles(): void {
    for (let index = 0; index < this.renderedCards.length; index++) {
      const renderable = this.renderedCards[index];
      const selected = index === this.selectedIndex;
      const toneColor = this.toneColor(renderable.card.tone);
      renderable.box.borderColor = selected ? this.theme.accent : toneColor;
      renderable.box.backgroundColor = selected
        ? this.theme.bgSelected
        : this.theme.bgElevated;
      renderable.box.titleColor = selected ? this.theme.accent : toneColor;
      renderable.headline.content = t`${fg(toneColor)(renderable.card.headline)}`;
      renderable.action.content = this.formatCardAction(
        renderable.card,
        selected,
      );
    }
    this.statusBar.content = this.formatStatusBar();
    const selected = this.renderedCards[this.selectedIndex];
    if (selected) this.body.scrollChildIntoView(selected.box.id);
    this.focus();
  }

  private formatStatusBar(prefix?: string): StyledText {
    const selected = this.renderedCards[this.selectedIndex]?.card;
    const action = selected?.actionLabel;
    const message = prefix ? `${prefix} | ` : "";
    const actionText = action ? `| Enter: ${action}` : "";
    return t`${fg(this.theme.fgMuted)(message)}${fg(this.theme.fgMuted)(`Last refreshed: ${this.formatTimeAgo(this.state.lastChecked)}`)}    ${fg(this.theme.accent)(selected?.title ?? "Dashboard")} ${fg(this.theme.fgMuted)(actionText)}`;
  }

  private formatCardLines(card: DashboardCard): StyledText {
    return t`${fg(this.theme.fgMuted)(card.lines.join("\n"))}`;
  }

  private formatCardAction(card: DashboardCard, selected = false): StyledText {
    if (!card.actionLabel) return t``;
    return t`${fg(selected ? this.theme.accent : this.theme.fgSubtle)(`-> ${card.actionLabel}`)}`;
  }

  private toneColor(tone: DashboardTone): string {
    switch (tone) {
      case "attention":
        return this.theme.red;
      case "active":
        return this.theme.accent;
      case "ok":
        return this.theme.green;
      case "prototype":
        return this.theme.yellow;
      case "muted":
        return this.theme.fgMuted;
    }
  }

  private formatTimeAgo(date: Date): string {
    const seconds = Math.floor((Date.now() - date.getTime()) / 1000);
    if (seconds < 5) return "just now";
    if (seconds < 60) return `${seconds}s ago`;
    return `${Math.floor(seconds / 60)}m ago`;
  }
}

/** Centre point of a laid-out card box, used for spatial grid navigation. */
function cardCentre(box: BoxRenderable): {
  readonly x: number;
  readonly y: number;
} {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
}
