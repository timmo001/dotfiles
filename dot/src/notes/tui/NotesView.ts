import {
  type CliRenderer,
  BoxRenderable,
  MarkdownRenderable,
  ScrollBoxRenderable,
  SyntaxStyle,
  TextRenderable,
  type KeyEvent,
  t,
  bold,
  fg,
} from "@opentui/core";
import type { NotesViewFilter } from "../../types.js";
import type { Theme } from "../../theme.js";
import type { NoteEntry } from "../types.js";
import { formatBreadcrumb } from "../../tui/breadcrumb.js";
import { formatPaneTitle } from "../../tui/paneTitle.js";
import {
  addResponsiveHelpBar,
  GLOBAL_HELP,
  type HelpEntry,
} from "../../tui/helpBar.js";
import { StatusList, type StatusListItem } from "../../tui/StatusList.js";

/** Help entries for the repository notes view. */
const HELP: readonly HelpEntry[] = [
  { key: "↑↓", action: "navigate" },
  { key: "Tab", action: "pane" },
  { key: "Enter", action: "preview" },
  { key: "r", action: "refresh" },
  { key: "Esc/Backspace", action: "back" },
  ...GLOBAL_HELP,
];

type NotesPane = "list" | "content";

const INACTIVE_OPACITY = 0.45;

/** Configuration callbacks for the repository notes view. */
export interface NotesViewOptions {
  /** List note entries for the current repository. */
  readonly listNotes: () => Promise<readonly NoteEntry[]>;
  /** Read the full markdown content for a note file. */
  readonly readNote: (filePath: string) => Promise<string>;
  /** Called when the user navigates back. */
  readonly onBack: () => void;
}

/** Two-pane repository notes browser with fixed metadata and scrollable markdown. */
export class NotesView {
  private renderer: CliRenderer;
  private callbacks: NotesViewOptions;
  private theme: Theme;
  private syntaxStyle: SyntaxStyle;

  private root: BoxRenderable;
  private leftPane: BoxRenderable;
  private rightPane: BoxRenderable;
  private titleBar: TextRenderable;
  private noteList: StatusList<NoteEntry>;
  private listTitle: TextRenderable;
  private contentTitle: TextRenderable;
  private noteHeading: TextRenderable;
  private noteDescription: TextRenderable;
  private noteTags: TextRenderable;
  private noteFile: TextRenderable;
  private noteModified: TextRenderable;
  private bodyScroll: ScrollBoxRenderable;
  private markdown: MarkdownRenderable;
  private statusBar: TextRenderable;

  private filter: NotesViewFilter | null = null;
  private activePane: NotesPane = "list";
  private entries: readonly NoteEntry[] = [];
  private visibleEntries: readonly NoteEntry[] = [];
  private selectedFilePath: string | null = null;
  private selectedEntry: NoteEntry | null = null;
  private isVisible = false;
  private requestedInitialRefresh = false;
  private loadVersion = 0;
  private readonly keyHandlers: Readonly<Record<string, () => void>>;

  constructor(
    renderer: CliRenderer,
    theme: Theme,
    callbacks: NotesViewOptions,
  ) {
    this.renderer = renderer;
    this.callbacks = callbacks;
    this.theme = theme;
    this.syntaxStyle = createMarkdownSyntaxStyle(theme);
    this.keyHandlers = {
      tab: () => this.togglePane(),
      r: () => void this.refresh(),
      escape: () => this.callbacks.onBack(),
      backspace: () => this.callbacks.onBack(),
    };

    this.root = new BoxRenderable(renderer, {
      id: "notes-root",
      flexDirection: "column",
      width: "100%",
      height: "100%",
      padding: 1,
    });

    this.titleBar = new TextRenderable(renderer, {
      id: "notes-title-bar",
      content: this.formatTitle(),
      marginBottom: 1,
    });
    this.root.add(this.titleBar);

    const paneContainer = new BoxRenderable(renderer, {
      id: "notes-pane-container",
      flexDirection: "row",
      flexGrow: 1,
      flexShrink: 1,
      minHeight: 0,
      gap: 2,
    });

    this.leftPane = new BoxRenderable(renderer, {
      id: "notes-left-pane",
      flexDirection: "column",
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 0,
      minHeight: 0,
    });

    this.listTitle = new TextRenderable(renderer, {
      id: "notes-list-title",
      content: formatPaneTitle(theme, "Notes", 0, true, theme.fgMuted),
      marginBottom: 0,
    });
    this.leftPane.add(this.listTitle);

    this.noteList = new StatusList(renderer, {
      id: "notes-list",
      theme,
      onSelect: () => this.focusPane("content"),
      onSelectionChanged: (item) => {
        this.selectedFilePath = item.value.filePath;
        void this.loadNote(item.value);
      },
    });
    this.noteList.flexShrink = 1;
    this.noteList.minHeight = 0;
    this.leftPane.add(this.noteList);

    this.rightPane = new BoxRenderable(renderer, {
      id: "notes-right-pane",
      flexDirection: "column",
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 0,
      minHeight: 0,
    });

    this.contentTitle = new TextRenderable(renderer, {
      id: "notes-content-title",
      content: formatPaneTitle(theme, "Content", 0, false, theme.fgMuted),
      marginBottom: 0,
    });
    this.rightPane.add(this.contentTitle);

    const heading = new BoxRenderable(renderer, {
      id: "notes-content-heading",
      flexDirection: "column",
      width: "100%",
      flexShrink: 0,
      backgroundColor: theme.bgElevated,
      padding: 1,
      marginBottom: 1,
    });
    this.noteHeading = new TextRenderable(renderer, {
      id: "notes-content-heading-title",
      content: t`${bold(fg(theme.fgMuted)("No note selected"))}`,
      width: "100%",
      truncate: true,
    });
    this.noteDescription = new TextRenderable(renderer, {
      id: "notes-content-heading-desc",
      content: t``,
      width: "100%",
      truncate: true,
    });
    this.noteTags = new TextRenderable(renderer, {
      id: "notes-content-heading-tags",
      content: t``,
      width: "100%",
      truncate: true,
    });
    this.noteFile = new TextRenderable(renderer, {
      id: "notes-content-heading-file",
      content: t``,
      width: "100%",
      truncate: true,
    });
    this.noteModified = new TextRenderable(renderer, {
      id: "notes-content-heading-modified",
      content: t``,
      width: "100%",
      truncate: true,
    });
    heading.add(this.noteHeading);
    heading.add(this.noteDescription);
    heading.add(this.noteTags);
    heading.add(this.noteFile);
    heading.add(this.noteModified);
    this.rightPane.add(heading);

    this.bodyScroll = new ScrollBoxRenderable(renderer, {
      id: "notes-content-scroll",
      flexGrow: 1,
      flexShrink: 1,
      minHeight: 0,
      width: "100%",
      scrollY: true,
      scrollX: false,
      backgroundColor: theme.bgElevated,
      focusable: true,
      wrapperOptions: {
        flexGrow: 1,
        flexShrink: 1,
        minHeight: 0,
      },
      viewportOptions: {
        flexGrow: 1,
        flexShrink: 1,
        minHeight: 0,
      },
      contentOptions: {
        flexDirection: "column",
        width: "100%",
      },
    });
    this.markdown = new MarkdownRenderable(renderer, {
      id: "notes-content-markdown",
      content: "Select a note to preview its content.",
      syntaxStyle: this.syntaxStyle,
      width: "100%",
      fg: theme.fg,
      bg: theme.bgElevated,
      conceal: true,
      internalBlockMode: "top-level",
      tableOptions: {
        widthMode: "full",
        wrapMode: "word",
      },
    });
    this.bodyScroll.add(this.markdown);
    this.rightPane.add(this.bodyScroll);

    paneContainer.add(this.leftPane);
    paneContainer.add(this.rightPane);
    this.root.add(paneContainer);

    this.statusBar = new TextRenderable(renderer, {
      id: "notes-status-bar",
      content: t`${fg(theme.fgMuted)("Loading...")}`,
      marginTop: 1,
    });
    this.root.add(this.statusBar);

    addResponsiveHelpBar(renderer, this.root, {
      id: "notes-help-bar",
      theme,
      entries: HELP,
    });

    const handleNotesKeyPress = (key: KeyEvent) => this.handleKeyPress(key);
    renderer.keyInput.on("keypress", handleNotesKeyPress);
    renderer.root.add(this.root);
    this.focus();
  }

  /** Update the note filter used by this view. */
  setFilter(filter: NotesViewFilter | null): void {
    const previous = this.filterKey;
    this.filter = filter;
    if (previous !== this.filterKey) {
      this.selectedFilePath = null;
      this.selectedEntry = null;
      this.titleBar.content = this.formatTitle();
      this.applyFilter();
      if (this.isVisible) void this.refresh();
    }
  }

  /** Show or hide the notes view. */
  setVisible(visible: boolean): void {
    this.isVisible = visible;
    this.root.visible = visible;
    if (!visible || this.requestedInitialRefresh) return;
    this.requestedInitialRefresh = true;
    void this.refresh();
  }

  /** Give keyboard focus to the currently active pane. */
  focus(): void {
    this.focusPane(this.activePane);
  }

  /** Remove the notes view from the render tree. */
  destroy(): void {
    this.syntaxStyle.destroy();
    this.renderer.root.remove(this.root.id);
  }

  private get filterKey(): string {
    return this.filter?.tag?.toLowerCase() ?? "";
  }

  private async refresh(): Promise<void> {
    const version = ++this.loadVersion;
    this.statusBar.content = t`${fg(this.theme.yellow)("Refreshing notes...")}`;

    try {
      const entries = await this.callbacks.listNotes();
      if (version !== this.loadVersion) return;
      this.entries = entries;
      this.applyFilter();
      this.updateStatusBar();
    } catch (error) {
      if (version !== this.loadVersion) return;
      this.entries = [];
      this.visibleEntries = [];
      this.noteList.setItems([]);
      this.showEmptyContent("Unable to load notes", errorMessage(error));
      this.statusBar.content = t`${fg(this.theme.red)(`Unable to load notes: ${errorMessage(error)}`)}`;
    }
  }

  private applyFilter(): void {
    this.visibleEntries = this.entries.filter((entry) =>
      matchesFilter(entry, this.filter),
    );
    this.noteList.setItems(
      this.visibleEntries.map((entry) => this.listItem(entry)),
      this.selectedFilePath,
    );
    this.updatePaneTitles();

    if (this.visibleEntries.length === 0) {
      this.showEmptyContent(this.emptyTitle(), this.emptyBody());
    }
  }

  private async loadNote(entry: NoteEntry): Promise<void> {
    const version = ++this.loadVersion;
    this.selectedEntry = entry;
    this.updateHeader(entry);
    this.updatePaneTitles();
    this.markdown.content = "Loading note content...";
    this.bodyScroll.scrollTo(0);
    this.statusBar.content = t`${fg(this.theme.yellow)(`Loading ${entry.filename}...`)}`;

    try {
      const content = await this.callbacks.readNote(entry.filePath);
      this.renderLoadedNote(version, content);
    } catch (error) {
      this.renderNoteError(version, entry, error);
    }
  }

  private renderLoadedNote(version: number, content: string): void {
    if (version !== this.loadVersion) return;
    this.markdown.content = noteBodyContent(content);
    this.bodyScroll.scrollTo(0);
    this.updateStatusBar();
  }

  private renderNoteError(
    version: number,
    entry: NoteEntry,
    error: unknown,
  ): void {
    if (version !== this.loadVersion) return;
    const message = errorMessage(error);
    this.markdown.content = `Failed to read note content.\n\n${message}`;
    this.bodyScroll.scrollTo(0);
    this.statusBar.content = t`${fg(this.theme.red)(`Failed to read ${entry.filename}: ${message}`)}`;
  }

  private togglePane(): void {
    this.focusPane(this.activePane === "list" ? "content" : "list");
  }

  private handleKeyPress(key: KeyEvent): void {
    if (!this.isVisible) return;
    this.keyHandlers[key.name]?.();
  }

  private focusPane(pane: NotesPane): void {
    this.activePane = pane;
    this.leftPane.opacity = pane === "list" ? 1 : INACTIVE_OPACITY;
    this.rightPane.opacity = pane === "content" ? 1 : INACTIVE_OPACITY;
    this.noteList.setActive(pane === "list");
    if (pane === "content") this.bodyScroll.focus();
    else this.bodyScroll.blur();
    this.updatePaneTitles();
  }

  private listItem(entry: NoteEntry): StatusListItem<NoteEntry> {
    return {
      id: entry.filePath,
      title: entry.name ?? stripMarkdownExtension(entry.filename),
      description: formatListDescription(entry),
      color: this.theme.fg,
      value: entry,
    };
  }

  private updateHeader(entry: NoteEntry): void {
    const name = entry.name ?? stripMarkdownExtension(entry.filename);
    const modified = formatDate(entry.mtime);
    this.noteHeading.content = t`${fg(this.theme.fgMuted)("Name: ")}${bold(fg(this.theme.accent)(name))}`;
    this.noteDescription.content = entry.description
      ? t`${fg(this.theme.fgMuted)("Description: ")}${fg(this.theme.fg)(entry.description)}`
      : t`${fg(this.theme.fgMuted)("Description: ")}${fg(this.theme.fgSubtle)("No description")}`;
    this.noteTags.content = t`${fg(this.theme.fgMuted)("Tags: ")}${fg(this.theme.fg)(formatTags(entry.tags))}`;
    this.noteFile.content = t`${fg(this.theme.fgMuted)("File: ")}${fg(this.theme.fg)(entry.filename)}`;
    this.noteModified.content = t`${fg(this.theme.fgMuted)("Modified: ")}${fg(this.theme.fg)(modified)}`;
  }

  private showEmptyContent(title: string, body: string): void {
    this.selectedEntry = null;
    this.noteHeading.content = t`${bold(fg(this.theme.fgMuted)(title))}`;
    this.noteDescription.content = t``;
    this.noteTags.content = t``;
    this.noteFile.content = t``;
    this.noteModified.content = t``;
    this.markdown.content = body;
    this.bodyScroll.scrollTo(0);
    this.updatePaneTitles();
  }

  private updatePaneTitles(): void {
    this.listTitle.content = formatPaneTitle(
      this.theme,
      notesDisplayTitle(this.filter),
      this.visibleEntries.length,
      this.activePane === "list",
      countColor(this.theme, this.visibleEntries.length),
    );
    this.contentTitle.content = formatPaneTitle(
      this.theme,
      "Content",
      contentCount(this.selectedEntry),
      this.activePane === "content",
      contentColor(this.theme, this.selectedEntry),
    );
  }

  private updateStatusBar(): void {
    if (this.visibleEntries.length === 0) {
      this.statusBar.content = t`${fg(this.theme.fgMuted)(this.emptyBody())}`;
      return;
    }

    this.statusBar.content = t`${fg(this.theme.fgMuted)(formatStatusBarText(this.visibleEntries.length, this.selectedEntry, this.filter))}`;
  }

  private emptyTitle(): string {
    return this.filter?.title ? `No ${this.filter.title}` : "No notes";
  }

  private emptyBody(): string {
    return this.filter?.tag
      ? `No notes tagged ${this.filter.tag} found for this repository.`
      : "No notes found for this repository.";
  }

  private formatTitle() {
    return formatBreadcrumb(
      this.theme,
      ["Dot", notesDisplayTitle(this.filter)],
      notesSubtitle(this.filter),
    );
  }
}

function createMarkdownSyntaxStyle(theme: Theme): SyntaxStyle {
  return SyntaxStyle.fromStyles({
    heading: { fg: theme.accent, bold: true },
    strong: { bold: true },
    emphasis: { italic: true },
    code: { fg: theme.green },
    link: { fg: theme.accent, underline: true },
  });
}

function matchesFilter(
  entry: NoteEntry,
  filter: NotesViewFilter | null,
): boolean {
  if (!filter?.tag) return true;
  const wanted = filter.tag.toLowerCase();
  return entry.tags.some((tag) => tag.toLowerCase() === wanted);
}

function splitNoteBody(content: string): string {
  const match = content.match(/^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/);
  return match ? content.slice(match[0].length) : content;
}

function noteBodyContent(content: string): string {
  const body = splitNoteBody(content).trim();
  return body || "No content after frontmatter.";
}

function notesDisplayTitle(filter: NotesViewFilter | null): string {
  return filter?.title ?? "Notes";
}

function notesSubtitle(filter: NotesViewFilter | null): string {
  return filter?.tag ? `tag:${filter.tag}` : "repo notes";
}

function countColor(theme: Theme, count: number): string {
  return count > 0 ? theme.accent : theme.fgMuted;
}

function contentCount(entry: NoteEntry | null): number {
  return entry ? 1 : 0;
}

function contentColor(theme: Theme, entry: NoteEntry | null): string {
  return entry ? theme.accent : theme.fgMuted;
}

function formatStatusBarText(
  count: number,
  selectedEntry: NoteEntry | null,
  filter: NotesViewFilter | null,
): string {
  return `${count} ${noteLabel(count)}${filterStatusText(filter)}    ${selectedStatusText(selectedEntry)}`;
}

function noteLabel(count: number): string {
  return count === 1 ? "note" : "notes";
}

function filterStatusText(filter: NotesViewFilter | null): string {
  return filter?.tag ? ` • tag:${filter.tag}` : "";
}

function selectedStatusText(entry: NoteEntry | null): string {
  return entry ? `Selected: ${entry.filename}` : "Select a note";
}

function formatListDescription(entry: NoteEntry): string {
  const description = entry.description ?? "No description";
  const tags = entry.tags.length ? ` [${entry.tags.join(", ")}]` : "";
  return `${description}${tags} • ${formatDate(entry.mtime)}`;
}

function formatTags(tags: readonly string[]): string {
  return tags.length > 0 ? tags.join(", ") : "untagged";
}

function stripMarkdownExtension(filename: string): string {
  return filename.replace(/\.md$/i, "");
}

function formatDate(epochSeconds: number): string {
  return new Date(epochSeconds * 1000).toISOString().slice(0, 10);
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
