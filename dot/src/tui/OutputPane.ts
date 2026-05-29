import {
  type CliRenderer,
  BoxRenderable,
  TextRenderable,
  ScrollBoxRenderable,
  t,
  bold,
  fg,
} from "@opentui/core";
import type { Theme } from "../theme.js";
import type { LogEntry } from "../services/OutputLog.js";
import {
  addResponsiveHelpBar,
  GLOBAL_HELP,
  type HelpEntry,
} from "./helpBar.js";

/** Help entries for the output pane */
const HELP: readonly HelpEntry[] = [
  { key: "↑↓", action: "scroll" },
  { key: "Esc", action: "back" },
  ...GLOBAL_HELP,
];

/** Configuration callbacks for the output pane */
export interface OutputPaneOptions {
  /** Called when the user presses Escape/Backspace to leave the pane */
  readonly onBack: () => void;
}

/**
 * Full-screen scrollable view for streaming command output.
 *
 * Subscribes to OutputLog entries and renders them with ANSI-style colouring.
 * Uses stickyScroll (bottom) so new output is always visible.
 */
export class OutputPane {
  private renderer: CliRenderer;
  private theme: Theme;
  private root: BoxRenderable;
  private scrollBox: ScrollBoxRenderable;
  private titleText: TextRenderable;
  private callbacks: OutputPaneOptions;
  private lineCount = 0;

  constructor(renderer: CliRenderer, theme: Theme, options: OutputPaneOptions) {
    this.renderer = renderer;
    this.theme = theme;
    this.callbacks = options;

    this.root = new BoxRenderable(renderer, {
      id: "output-pane-root",
      flexDirection: "column",
      width: "100%",
      height: "100%",
      padding: 1,
    });

    // Title
    this.titleText = new TextRenderable(renderer, {
      id: "output-pane-title",
      content: t`${bold(fg(theme.accent)("Output"))}`,
      marginBottom: 1,
    });
    this.root.add(this.titleText);

    // Scrollable output area
    this.scrollBox = new ScrollBoxRenderable(renderer, {
      id: "output-pane-scroll",
      flexGrow: 1,
      width: "100%",
      stickyScroll: true,
      stickyStart: "bottom",
      scrollY: true,
      scrollX: false,
    });
    this.root.add(this.scrollBox);

    addResponsiveHelpBar(renderer, this.root, {
      id: "output-pane-help",
      theme,
      entries: HELP,
      marginTop: 1,
    });

    renderer.root.add(this.root);
  }

  /** Show or hide the output pane */
  setVisible(visible: boolean): void {
    this.root.visible = visible;
  }

  /** Give keyboard focus to the scroll box */
  focus(): void {
    this.scrollBox.focus();
  }

  /** Set the title shown above the output */
  setTitle(title: string): void {
    this.titleText.content = t`${bold(fg(this.theme.accent)(title))}`;
  }

  /** Clear all output lines and reset state */
  clear(): void {
    const children = this.scrollBox.getChildren();
    for (const child of children) {
      this.scrollBox.remove(child.id);
    }
    this.lineCount = 0;
  }

  /** Append a log entry to the output */
  appendEntry(entry: LogEntry): void {
    const content = this.formatEntry(entry);
    const line = new TextRenderable(this.renderer, {
      id: `output-line-${this.lineCount++}`,
      content,
    });
    this.scrollBox.add(line);
  }

  /** Handle keyboard input — Escape/Backspace returns to previous view */
  handleKeyPress(key: { key: string }): void {
    if (key.key === "escape" || key.key === "backspace") {
      this.callbacks.onBack();
    }
  }

  /** Remove from the render tree */
  destroy(): void {
    this.renderer.root.remove(this.root.id);
  }

  /** Format a log entry with themed colours */
  private formatEntry(entry: LogEntry): ReturnType<typeof t> {
    switch (entry.level) {
      case "section":
        return t`\n${bold(fg(this.theme.accent)(entry.message))}`;
      case "info":
        return t`  ${fg(this.theme.fg)(entry.message)}`;
      case "warn":
        return t`  ${fg(this.theme.yellow)("[WARN]")} ${fg(this.theme.fg)(entry.message)}`;
      case "error":
        return t`  ${fg(this.theme.red)("[ERROR]")} ${fg(this.theme.fg)(entry.message)}`;
    }
  }
}
