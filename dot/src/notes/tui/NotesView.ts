import {
  type CliRenderer,
  BoxRenderable,
  type MarkdownOptions,
  MarkdownRenderable,
  type Renderable,
  ScrollBoxRenderable,
  StyledText,
  SyntaxStyle,
  TextRenderable,
  type TextChunk,
  type KeyEvent,
  t,
  bold,
  dim,
  fg,
  italic,
  strikethrough,
  underline,
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
  { key: "o", action: "OpenCode" },
  { key: "r", action: "refresh" },
  { key: "Esc/Backspace", action: "back" },
  ...GLOBAL_HELP,
];

type NotesPane = "list" | "content";
type MarkdownRenderNode = NonNullable<MarkdownOptions["renderNode"]>;
type MarkdownToken = Parameters<MarkdownRenderNode>[0];
type BlockRenderer = (
  token: MarkdownToken,
  isFirstBlock: boolean,
) => Renderable | null;
type InlineRenderer = (
  token: MarkdownToken,
  theme: Theme,
  style: InlineStyle,
) => TextChunk[];
type StyleApplier = (chunk: TextChunk, style: InlineStyle) => TextChunk;

interface InlineStyle {
  readonly fg?: string;
  readonly bold?: boolean;
  readonly dim?: boolean;
  readonly italic?: boolean;
  readonly strikethrough?: boolean;
  readonly underline?: boolean;
}

interface MarkdownListItem {
  readonly task?: boolean;
  readonly checked?: boolean;
  readonly text: string;
  readonly tokens: readonly MarkdownToken[];
}

type MarkdownListToken = MarkdownToken & {
  readonly ordered: boolean;
  readonly start: number | "";
  readonly items: readonly MarkdownListItem[];
};
type MarkdownHeadingToken = MarkdownToken & { readonly depth: number };

const INACTIVE_OPACITY = 0.45;
const INLINE_RENDERERS: Readonly<Record<string, InlineRenderer>> = {
  br: (token, theme, style) => [textChunk("\n", theme, style)],
  codespan: (token, theme, style) => [
    textChunk(tokenText(token), theme, { ...style, fg: theme.green }),
  ],
  del: (token, theme, style) =>
    tokenChunks(token, theme, { ...style, strikethrough: true }),
  em: (token, theme, style) =>
    tokenChunks(token, theme, { ...style, italic: true }),
  escape: (token, theme, style) => [textChunk(tokenText(token), theme, style)],
  image: imageChunks,
  link: linkChunks,
  strong: (token, theme, style) =>
    tokenChunks(token, theme, { ...style, bold: true }),
  text: tokenChunks,
};
const STYLE_APPLIERS: readonly StyleApplier[] = [
  (chunk, style) => (style.bold ? bold(chunk) : chunk),
  (chunk, style) => (style.dim ? dim(chunk) : chunk),
  (chunk, style) => (style.italic ? italic(chunk) : chunk),
  (chunk, style) => (style.strikethrough ? strikethrough(chunk) : chunk),
  (chunk, style) => (style.underline ? underline(chunk) : chunk),
];

/** Configuration callbacks for the repository notes view. */
export interface NotesViewOptions {
  /** List note entries for the current repository. */
  readonly listNotes: () => Promise<readonly NoteEntry[]>;
  /** Read the full markdown content for a note file. */
  readonly readNote: (filePath: string) => Promise<string>;
  /** Open the selected note in a full OpenCode session. */
  readonly onOpenOpencode: (entry: NoteEntry) => Promise<void>;
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
  private footer: BoxRenderable;
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
  private openingOpenCode = false;
  private requestedInitialRefresh = false;
  private loadVersion = 0;
  private renderedMarkdownBlockCount = 0;
  private readonly keyHandlers: Readonly<Record<string, () => void>>;
  private readonly blockRenderers: Readonly<Record<string, BlockRenderer>>;

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
      o: () => void this.openSelectedInOpenCode(),
      r: () => void this.refresh(),
      escape: () => this.callbacks.onBack(),
      backspace: () => this.callbacks.onBack(),
    };
    this.blockRenderers = {
      blockquote: (token) => this.renderMarkdownBlockquote(token),
      code: (token) => this.renderMarkdownCode(token),
      heading: (token, isFirstBlock) =>
        this.renderMarkdownHeading(token, isFirstBlock),
      hr: () => this.renderMarkdownRule(),
      list: (token) =>
        isListToken(token) ? this.renderMarkdownList(token) : null,
      paragraph: (token) =>
        this.renderMarkdownText(tokenChunks(token, this.theme)),
      text: (token) => this.renderMarkdownText(tokenChunks(token, this.theme)),
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
      renderNode: (token, context) =>
        this.renderMarkdownNode(token, context.defaultRender),
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

    this.footer = new BoxRenderable(renderer, {
      id: "notes-footer",
      flexDirection: "column",
      width: "100%",
      flexShrink: 0,
      backgroundColor: theme.bg,
      zIndex: 10,
    });

    this.statusBar = new TextRenderable(renderer, {
      id: "notes-status-bar",
      content: t`${fg(theme.fgMuted)("Loading...")}`,
      marginTop: 1,
    });
    this.footer.add(this.statusBar);

    addResponsiveHelpBar(renderer, this.footer, {
      id: "notes-help-bar",
      theme,
      entries: HELP,
    });
    this.root.add(this.footer);

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
    this.setMarkdownContent("Loading note content...");
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
    this.setMarkdownContent(noteBodyContent(content));
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
    this.setMarkdownContent(`Failed to read note content.\n\n${message}`);
    this.bodyScroll.scrollTo(0);
    this.statusBar.content = t`${fg(this.theme.red)(`Failed to read ${entry.filename}: ${message}`)}`;
  }

  private togglePane(): void {
    this.focusPane(this.activePane === "list" ? "content" : "list");
  }

  private async openSelectedInOpenCode(): Promise<void> {
    if (this.openingOpenCode) return;
    const entry = this.selectedEntry;
    if (!entry) {
      this.statusBar.content = t`${fg(this.theme.yellow)("Select a note before opening OpenCode")}`;
      return;
    }

    this.openingOpenCode = true;
    this.statusBar.content = t`${fg(this.theme.yellow)(`Opening ${entry.filename} in OpenCode...`)}`;
    try {
      await this.callbacks.onOpenOpencode(entry);
      this.updateStatusBar();
    } catch (error) {
      this.statusBar.content = t`${fg(this.theme.red)(`Failed to open OpenCode: ${errorMessage(error)}`)}`;
    } finally {
      this.openingOpenCode = false;
    }
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
    this.setMarkdownContent(body);
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

  private renderMarkdownNode(
    token: MarkdownToken,
    defaultRender: () => Renderable | null,
  ): Renderable | null {
    const renderBlock = this.blockRenderers[token.type];
    const rendered = renderBlock
      ? renderBlock(token, this.renderedMarkdownBlockCount === 0)
      : defaultRender();
    if (rendered && !isH1Token(token)) this.renderedMarkdownBlockCount += 1;
    return rendered;
  }

  private renderMarkdownBlock(token: MarkdownToken): Renderable | null {
    return this.blockRenderers[token.type]?.(token, false) ?? null;
  }

  private renderMarkdownText(chunks: readonly TextChunk[]): TextRenderable {
    return new TextRenderable(this.renderer, {
      content: new StyledText([...chunks]),
      width: "100%",
      wrapMode: "word",
      fg: this.theme.fg,
      bg: this.theme.bgElevated,
      flexShrink: 0,
    });
  }

  private renderMarkdownHeading(
    token: MarkdownToken,
    isFirstBlock: boolean,
  ): BoxRenderable {
    if (isH1Token(token)) return this.renderEmptyMarkdownBlock();

    const heading = new BoxRenderable(this.renderer, {
      flexDirection: "column",
      width: "100%",
      flexShrink: 0,
      backgroundColor: this.theme.bgElevated,
    });
    if (!isFirstBlock) heading.add(this.renderHeadingGap());
    heading.add(
      this.renderMarkdownText(
        tokenChunks(token, this.theme, headingStyle(this.theme, token)),
      ),
    );
    heading.add(this.renderHeadingGap());
    return heading;
  }

  private renderEmptyMarkdownBlock(): BoxRenderable {
    return new BoxRenderable(this.renderer, {
      width: "100%",
      height: 0,
      flexShrink: 0,
      backgroundColor: this.theme.bgElevated,
    });
  }

  private renderHeadingGap(): BoxRenderable {
    return new BoxRenderable(this.renderer, {
      width: "100%",
      height: 1,
      flexShrink: 0,
      backgroundColor: this.theme.bgElevated,
    });
  }

  private renderMarkdownBlockquote(token: MarkdownToken): BoxRenderable {
    const quote = new BoxRenderable(this.renderer, {
      flexDirection: "column",
      width: "100%",
      flexShrink: 0,
      border: ["left"],
      borderColor: this.theme.fgMuted,
      paddingLeft: 1,
      backgroundColor: this.theme.bgElevated,
    });
    this.addMarkdownChildren(quote, childTokens(token), tokenText(token));
    return quote;
  }

  private renderMarkdownCode(token: MarkdownToken): TextRenderable {
    return new TextRenderable(this.renderer, {
      content: tokenText(token),
      width: "100%",
      wrapMode: "word",
      fg: this.theme.green,
      bg: this.theme.bgElevated,
      flexShrink: 0,
    });
  }

  private renderMarkdownRule(): BoxRenderable {
    return new BoxRenderable(this.renderer, {
      width: "100%",
      height: 1,
      flexShrink: 0,
      border: ["top"],
      borderColor: this.theme.fgMuted,
      backgroundColor: this.theme.bgElevated,
    });
  }

  private renderMarkdownList(token: MarkdownListToken): BoxRenderable {
    const list = new BoxRenderable(this.renderer, {
      flexDirection: "column",
      width: "100%",
      flexShrink: 0,
      backgroundColor: this.theme.bgElevated,
    });
    const markers = token.items.map((item, index) =>
      listMarker(token, item, index),
    );
    const markerWidth = Math.max(...markers.map((marker) => marker.length), 1);

    token.items.forEach((item, index) => {
      const row = new BoxRenderable(this.renderer, {
        flexDirection: "row",
        alignItems: "flex-start",
        width: "100%",
        flexShrink: 0,
      });
      row.add(
        new TextRenderable(this.renderer, {
          content: t`${fg(this.theme.fgMuted)(markers[index].padStart(markerWidth))} `,
          width: markerWidth + 1,
          flexShrink: 0,
        }),
      );
      row.add(this.renderMarkdownListItemContent(item));
      list.add(row);
    });

    return list;
  }

  private renderMarkdownListItemContent(item: MarkdownListItem): Renderable {
    const inlineToken = singleInlineListToken(item.tokens);
    if (inlineToken) {
      return new TextRenderable(this.renderer, {
        content: new StyledText(tokenChunks(inlineToken, this.theme)),
        width: "100%",
        wrapMode: "word",
        fg: this.theme.fg,
        bg: this.theme.bgElevated,
        flexGrow: 1,
        flexShrink: 1,
        minHeight: 0,
      });
    }

    const content = new BoxRenderable(this.renderer, {
      flexDirection: "column",
      flexGrow: 1,
      flexShrink: 1,
      minHeight: 0,
      backgroundColor: this.theme.bgElevated,
    });
    this.addMarkdownChildren(content, item.tokens, item.text);
    return content;
  }

  private addMarkdownChildren(
    parent: BoxRenderable,
    tokens: readonly MarkdownToken[],
    fallbackText: string,
  ): void {
    const children = tokens
      .filter((token) => token.type !== "space")
      .map((token) => this.renderMarkdownBlock(token))
      .filter(isRenderable);
    const renderables = children.length
      ? children
      : [this.renderMarkdownText([textChunk(fallbackText, this.theme)])];

    for (const child of renderables) parent.add(child);
  }

  private setMarkdownContent(content: string): void {
    this.renderedMarkdownBlockCount = 0;
    this.markdown.content = content;
  }
}

function createMarkdownSyntaxStyle(theme: Theme): SyntaxStyle {
  return SyntaxStyle.fromStyles({
    default: { fg: theme.fg },
    conceal: { fg: theme.fgMuted },
    "markup.heading": { fg: theme.accent, bold: true },
    "markup.strong": { bold: true },
    "markup.italic": { italic: true },
    "markup.raw": { fg: theme.green },
    "markup.link": { fg: theme.accent, underline: true },
    "markup.link.label": { fg: theme.accent, underline: true },
    "markup.link.url": { fg: theme.fgMuted, dim: true },
  });
}

function isRenderable(value: Renderable | null): value is Renderable {
  return value !== null;
}

function tokenChunks(
  token: MarkdownToken,
  theme: Theme,
  style: InlineStyle = {},
): TextChunk[] {
  const children = childTokens(token);
  if (children.length === 0) return [textChunk(tokenText(token), theme, style)];
  return inlineChunks(children, theme, style);
}

function inlineChunks(
  tokens: readonly MarkdownToken[],
  theme: Theme,
  style: InlineStyle = {},
): TextChunk[] {
  return tokens.flatMap((token) => inlineTokenChunks(token, theme, style));
}

function inlineTokenChunks(
  token: MarkdownToken,
  theme: Theme,
  style: InlineStyle,
): TextChunk[] {
  return (INLINE_RENDERERS[token.type] ?? fallbackInlineChunks)(
    token,
    theme,
    style,
  );
}

function linkChunks(
  token: MarkdownToken,
  theme: Theme,
  style: InlineStyle,
): TextChunk[] {
  const href = tokenHref(token);
  const label = tokenChunks(token, theme, {
    ...style,
    fg: theme.accent,
    underline: true,
  });
  if (!href) return label;
  return [
    ...label,
    textChunk(` (${href})`, theme, { fg: theme.fgMuted, dim: true }),
  ];
}

function imageChunks(
  token: MarkdownToken,
  theme: Theme,
  style: InlineStyle,
): TextChunk[] {
  const href = tokenHref(token);
  const label = tokenText(token) || "image";
  const chunks = [textChunk(label, theme, { ...style, fg: theme.accent })];
  if (!href) return chunks;
  return [
    ...chunks,
    textChunk(` (${href})`, theme, { fg: theme.fgMuted, dim: true }),
  ];
}

function fallbackInlineChunks(
  token: MarkdownToken,
  theme: Theme,
  style: InlineStyle,
): TextChunk[] {
  const children = childTokens(token);
  if (children.length > 0) return inlineChunks(children, theme, style);
  return [textChunk(tokenText(token), theme, style)];
}

function textChunk(
  text: string,
  theme: Theme,
  style: InlineStyle = {},
): TextChunk {
  return STYLE_APPLIERS.reduce(
    (chunk, applyStyle) => applyStyle(chunk, style),
    fg(style.fg ?? theme.fg)(text),
  );
}

function childTokens(token: MarkdownToken): readonly MarkdownToken[] {
  if (!("tokens" in token) || !Array.isArray(token.tokens)) return [];
  return token.tokens;
}

function singleInlineListToken(
  tokens: readonly MarkdownToken[],
): MarkdownToken | null {
  const visibleTokens = tokens.filter((token) => token.type !== "space");
  const token = visibleTokens[0];
  return visibleTokens.length === 1 && isInlineListToken(token) ? token : null;
}

function isInlineListToken(
  token: MarkdownToken | undefined,
): token is MarkdownToken {
  return token?.type === "text" || token?.type === "paragraph";
}

function tokenText(token: MarkdownToken): string {
  return (
    tokenStringProperty(token, "text") || tokenStringProperty(token, "raw")
  );
}

function tokenStringProperty(token: MarkdownToken, key: string): string {
  const value = (token as Record<string, unknown>)[key];
  return typeof value === "string" ? value : "";
}

function tokenHref(token: MarkdownToken): string | null {
  return "href" in token && typeof token.href === "string" ? token.href : null;
}

function headingStyle(theme: Theme, token: MarkdownToken): InlineStyle {
  return isHeadingToken(token) && token.depth > 3
    ? { fg: theme.fgMuted, bold: true }
    : { fg: theme.accent, bold: true };
}

function isHeadingToken(token: MarkdownToken): token is MarkdownHeadingToken {
  return "depth" in token && typeof token.depth === "number";
}

function isH1Token(token: MarkdownToken): boolean {
  return isHeadingToken(token) && token.depth === 1;
}

function isListToken(token: MarkdownToken): token is MarkdownListToken {
  return (
    "items" in token &&
    Array.isArray(token.items) &&
    "ordered" in token &&
    typeof token.ordered === "boolean"
  );
}

function listMarker(
  token: MarkdownListToken,
  item: MarkdownListItem,
  index: number,
): string {
  if (item.task) return taskMarker(item);
  return orderedListMarker(token, index);
}

function taskMarker(item: MarkdownListItem): string {
  return item.checked ? "[x]" : "[ ]";
}

function orderedListMarker(token: MarkdownListToken, index: number): string {
  if (!token.ordered) return "-";
  const start = typeof token.start === "number" ? token.start : 1;
  return `${start + index}.`;
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

function stripH1Headings(content: string): string {
  return content
    .split(/\r?\n/)
    .filter((line) => !/^#(?!#)\s+/.test(line))
    .join("\n");
}

function noteBodyContent(content: string): string {
  const body = stripH1Headings(splitNoteBody(content)).trim();
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
