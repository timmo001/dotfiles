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
import type {
  NoteCreateDraft,
  NoteCreateKind,
  NoteDeleteResult,
  NoteEntry,
  NoteRepoSection,
} from "../types.js";
import { formatBreadcrumb } from "../../tui/breadcrumb.js";
import { formatPaneTitle } from "../../tui/paneTitle.js";
import {
  addResponsiveHelpBar,
  GLOBAL_HELP,
  type HelpEntry,
} from "../../tui/helpBar.js";
import {
  editorLabel,
  editorLaunchesDetached,
} from "../../tui/externalEditor.js";
import { openCodeSessionLabel } from "../../tui/openCodeSession.js";
import { StatusList, type StatusListItem } from "../../tui/StatusList.js";
import type { NoteEditorKind } from "./NoteEditor.js";
import {
  NoteCreatePrompt,
  type NoteCreatePromptResult,
} from "./NoteCreatePrompt.js";
import type { OpenCodeNoteMode } from "./OpenCodeNote.js";
import { formatLocalNoteDateTimeFromEpochSeconds } from "../time.js";

/** Help entries for the repository notes view. */
const HELP: readonly HelpEntry[] = [
  { key: "↑↓", action: "navigate" },
  { key: "Tab", action: "pane" },
  { key: "a", action: "add" },
  { key: "A", action: "add visual" },
  { key: "g", action: "toggle all" },
  { key: "e", action: "edit" },
  { key: "E", action: "visual edit" },
  { key: "o", action: "OpenCode" },
  { key: "O", action: "OpenCode plan" },
  { key: "r", action: "refresh" },
  { key: "s", action: "sort" },
  { key: "d", action: "delete" },
  { key: "Esc/Backspace", action: "back" },
  ...GLOBAL_HELP,
];

type NotesPane = "list" | "content";

/** Ordering applied to the visible note list. */
type NoteSortMode = "modified-desc" | "modified-asc" | "name-asc" | "name-desc";

/** Sort modes in the order the sort key cycles through them. */
const SORT_CYCLE: readonly NoteSortMode[] = [
  "modified-desc",
  "modified-asc",
  "name-asc",
  "name-desc",
];
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
const DELETE_PROMPT_WIDTH = 58;
const DELETE_PROMPT_HEIGHT = 7;
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
  /** List note entries grouped by every repository notes directory. */
  readonly listAllNotes: () => Promise<readonly NoteRepoSection[]>;
  /** Read the full markdown content for a note file. */
  readonly readNote: (filePath: string) => Promise<string>;
  /** Delete a note file from the notes vault. */
  readonly deleteNote: (filePath: string) => Promise<NoteDeleteResult>;
  /** Create a draft note file with seed content. */
  readonly createNoteDraft: (
    kind: NoteCreateKind,
    name: string,
    description: string,
  ) => Promise<NoteCreateDraft>;
  /** Commit a draft note file after editor exit. */
  readonly finaliseNoteDraft: (filePath: string) => Promise<void>;
  /** Commit an edited existing note file after editor exit. */
  readonly finaliseNoteEdit: (filePath: string) => Promise<void>;
  /** Open the selected note in an external editor. */
  readonly onEditNote: (
    entry: NoteEntry,
    kind: NoteEditorKind,
  ) => Promise<void>;
  /** Open the selected note in a full OpenCode session. */
  readonly onOpenOpencode: (
    entry: NoteEntry,
    noteContent: string,
    mode: OpenCodeNoteMode,
  ) => Promise<void>;
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
  private deletePrompt: BoxRenderable;
  private deletePromptTitle: TextRenderable;
  private deletePromptFile: TextRenderable;
  private deletePromptHelp: TextRenderable;
  private createPrompt: NoteCreatePrompt;

  private filter: NotesViewFilter | null = null;
  private activePane: NotesPane = "list";
  private sortMode: NoteSortMode = "modified-desc";
  private entries: readonly NoteEntry[] = [];
  private visibleEntries: readonly NoteEntry[] = [];
  private showingAllRepos = false;
  private usingAllReposFallback = false;
  private selectedFilePath: string | null = null;
  private selectedEntry: NoteEntry | null = null;
  private loadedNoteContent: string | null = null;
  private loadedNoteContentPath: string | null = null;
  private isVisible = false;
  private openingOpenCode = false;
  private editingFilePath: string | null = null;
  private creatingNote = false;
  private createEditorKind: NoteEditorKind = "editor";
  private deleteConfirmation: NoteEntry | null = null;
  private deletingFilePath: string | null = null;
  private requestedInitialRefresh = false;
  private loadVersion = 0;
  private renderedMarkdownBlockCount = 0;
  private readonly keyHandlers: Readonly<Record<string, () => void>>;
  private readonly deleteConfirmationKeyHandlers: Readonly<
    Record<string, () => void>
  >;
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
      a: () => this.startCreateFlow("editor"),
      "shift+a": () => this.startCreateFlow("visual"),
      g: () => this.toggleAllRepos(),
      e: () => void this.openSelectedInEditor("editor"),
      "shift+e": () => void this.openSelectedInEditor("visual"),
      o: () => void this.openSelectedInOpenCode("default"),
      "shift+o": () => void this.openSelectedInOpenCode("plan"),
      r: () => void this.refresh(),
      s: () => this.cycleSortMode(),
      d: () => this.requestDeleteSelected(),
      escape: () => this.callbacks.onBack(),
      backspace: () => this.callbacks.onBack(),
    };
    this.deleteConfirmationKeyHandlers = {
      y: () => void this.confirmDeleteSelected(),
      n: () => this.cancelDeleteConfirmation(),
      escape: () => this.cancelDeleteConfirmation(),
      backspace: () => this.cancelDeleteConfirmation(),
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

    this.deletePrompt = new BoxRenderable(renderer, {
      id: "notes-delete-prompt",
      position: "absolute",
      width: DELETE_PROMPT_WIDTH,
      height: DELETE_PROMPT_HEIGHT,
      zIndex: 160,
      visible: false,
      borderStyle: "rounded",
      borderColor: theme.red,
      backgroundColor: theme.bgElevated,
      flexDirection: "column",
      paddingLeft: 1,
      paddingRight: 1,
      paddingTop: 0,
      paddingBottom: 0,
    });
    this.deletePromptTitle = new TextRenderable(renderer, {
      id: "notes-delete-prompt-title",
      content: t``,
      marginBottom: 1,
    });
    this.deletePromptFile = new TextRenderable(renderer, {
      id: "notes-delete-prompt-file",
      content: t``,
      width: "100%",
      truncate: true,
    });
    this.deletePromptHelp = new TextRenderable(renderer, {
      id: "notes-delete-prompt-help",
      content: t``,
      marginTop: 1,
    });
    this.deletePrompt.add(this.deletePromptTitle);
    this.deletePrompt.add(this.deletePromptFile);
    this.deletePrompt.add(this.deletePromptHelp);

    this.createPrompt = new NoteCreatePrompt(renderer, theme, {
      onSubmit: (result) => void this.executeCreateFlow(result),
      onDismiss: () => this.cancelCreateFlow(),
    });

    const handleNotesKeyPress = (key: KeyEvent) => this.handleKeyPress(key);
    renderer.keyInput.on("keypress", handleNotesKeyPress);
    renderer.root.add(this.root);
    renderer.root.add(this.deletePrompt);
    this.focus();
  }

  /** Update the note filter used by this view. */
  setFilter(filter: NotesViewFilter | null): void {
    const previous = this.filterKey;
    this.filter = filter;
    if (previous !== this.filterKey) {
      this.clearDeleteConfirmation(false);
      this.selectedFilePath = null;
      this.selectedEntry = null;
      this.loadedNoteContent = null;
      this.loadedNoteContentPath = null;
      this.showingAllRepos = filter?.includeAllRepos === true;
      this.usingAllReposFallback = false;
      this.titleBar.content = this.formatTitle();
      this.applyFilter();
      if (this.isVisible) void this.refresh();
    }
  }

  /** Show or hide the notes view. */
  setVisible(visible: boolean): void {
    this.isVisible = visible;
    this.root.visible = visible;
    if (!visible) {
      this.clearDeleteConfirmation(false);
      return;
    }
    if (this.requestedInitialRefresh) return;
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
    this.createPrompt.destroy();
    this.renderer.root.remove(this.root.id);
    this.renderer.root.remove(this.deletePrompt.id);
  }

  private get filterKey(): string {
    const tag = this.filter?.tag?.toLowerCase() ?? "";
    const scope = this.filter?.includeAllRepos ? "all" : "current";
    return `${tag}:${scope}`;
  }

  private async refresh(): Promise<boolean> {
    const version = ++this.loadVersion;
    this.statusBar.content = t`${fg(this.theme.yellow)("Refreshing notes...")}`;

    try {
      const loaded = await this.loadEntriesForActiveScope();
      if (version !== this.loadVersion) return false;
      this.entries = loaded.entries;
      this.showingAllRepos = loaded.allRepos;
      this.usingAllReposFallback = loaded.fallback;
      this.titleBar.content = this.formatTitle();
      this.applyFilter();
      this.updateStatusBar();
      return true;
    } catch (error) {
      if (version !== this.loadVersion) return false;
      this.entries = [];
      this.visibleEntries = [];
      this.noteList.setItems([]);
      this.showEmptyContent("Unable to load notes", errorMessage(error));
      this.statusBar.content = t`${fg(this.theme.red)(`Unable to load notes: ${errorMessage(error)}`)}`;
      return false;
    }
  }

  private async loadEntriesForActiveScope(): Promise<{
    readonly entries: readonly NoteEntry[];
    readonly allRepos: boolean;
    readonly fallback: boolean;
  }> {
    if (this.filter?.includeAllRepos) {
      return {
        entries: flattenNoteSections(await this.callbacks.listAllNotes()),
        allRepos: true,
        fallback: false,
      };
    }

    const currentEntries = await this.callbacks.listNotes();
    const currentVisible = currentEntries.filter((entry) =>
      matchesFilter(entry, this.filter),
    );
    if (currentVisible.length > 0) {
      return { entries: currentEntries, allRepos: false, fallback: false };
    }

    return {
      entries: flattenNoteSections(await this.callbacks.listAllNotes()),
      allRepos: true,
      fallback: true,
    };
  }

  private applyFilter(): void {
    this.visibleEntries = this.sortEntries(
      this.entries.filter((entry) => matchesFilter(entry, this.filter)),
    );
    this.noteList.setItems(
      this.visibleEntries.map((entry) => this.listItem(entry)),
      this.selectedFilePath,
    );
    this.titleBar.content = this.formatTitle();
    this.updatePaneTitles();

    if (this.visibleEntries.length === 0) {
      this.showEmptyContent(this.emptyTitle(), this.emptyBody());
    }
  }

  /** Advance to the next sort mode and re-render the list. */
  private cycleSortMode(): void {
    const nextIndex =
      (SORT_CYCLE.indexOf(this.sortMode) + 1) % SORT_CYCLE.length;
    this.sortMode = SORT_CYCLE[nextIndex];
    this.applyFilter();
    this.updateStatusBar();
  }

  /**
   * Sort entries by the active mode, keeping all-repos sections grouped so the
   * list's section headers stay contiguous.
   */
  private sortEntries(entries: readonly NoteEntry[]): readonly NoteEntry[] {
    const compare = sortComparator(this.sortMode);
    if (!this.showingAllRepos) return [...entries].sort(compare);

    const sectionOrder = new Map<string, number>();
    for (const entry of entries) {
      const key = entry.repoSlug ?? "";
      if (!sectionOrder.has(key)) sectionOrder.set(key, sectionOrder.size);
    }
    return [...entries].sort((a, b) => {
      const sectionDelta =
        (sectionOrder.get(a.repoSlug ?? "") ?? 0) -
        (sectionOrder.get(b.repoSlug ?? "") ?? 0);
      return sectionDelta !== 0 ? sectionDelta : compare(a, b);
    });
  }

  private toggleAllRepos(): void {
    const currentFilter = this.filter;
    if (currentFilter?.includeAllRepos) {
      const nextFilter: NotesViewFilter = {
        ...(currentFilter.tag && { tag: currentFilter.tag }),
        ...(currentFilter.title && { title: currentFilter.title }),
      };
      this.setFilter(Object.keys(nextFilter).length > 0 ? nextFilter : null);
      return;
    }

    this.setFilter({ ...(currentFilter ?? {}), includeAllRepos: true });
  }

  private async loadNote(entry: NoteEntry): Promise<void> {
    const version = ++this.loadVersion;
    const label = notePathLabel(entry);
    this.selectedEntry = entry;
    this.loadedNoteContent = null;
    this.loadedNoteContentPath = entry.filePath;
    this.updateHeader(entry);
    this.updatePaneTitles();
    this.setMarkdownContent("Loading note content...");
    this.bodyScroll.scrollTo(0);
    this.statusBar.content = t`${fg(this.theme.yellow)(`Loading ${label}...`)}`;

    try {
      const content = await this.callbacks.readNote(entry.filePath);
      this.renderLoadedNote(version, content);
    } catch (error) {
      this.renderNoteError(version, entry, error);
    }
  }

  private renderLoadedNote(version: number, content: string): void {
    if (version !== this.loadVersion) return;
    this.loadedNoteContent = content;
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
    this.loadedNoteContent = null;
    const message = errorMessage(error);
    const label = notePathLabel(entry);
    this.setMarkdownContent(`Failed to read note content.\n\n${message}`);
    this.bodyScroll.scrollTo(0);
    this.statusBar.content = t`${fg(this.theme.red)(`Failed to read ${label}: ${message}`)}`;
  }

  private togglePane(): void {
    this.focusPane(this.activePane === "list" ? "content" : "list");
  }

  private async openSelectedInOpenCode(mode: OpenCodeNoteMode): Promise<void> {
    if (this.openingOpenCode) return;
    const entry = this.selectedEntry;
    if (!entry) {
      this.statusBar.content = t`${fg(this.theme.yellow)("Select a note before opening OpenCode")}`;
      return;
    }

    this.openingOpenCode = true;
    const modeLabel = openCodeSessionLabel(mode);
    const label = notePathLabel(entry);
    this.statusBar.content = t`${fg(this.theme.yellow)(`Opening ${label} in ${modeLabel}...`)}`;
    try {
      const content =
        this.loadedNoteContentPath === entry.filePath &&
        this.loadedNoteContent !== null
          ? this.loadedNoteContent
          : await this.callbacks.readNote(entry.filePath);
      this.loadedNoteContent = content;
      this.loadedNoteContentPath = entry.filePath;
      await this.callbacks.onOpenOpencode(entry, content, mode);
      this.updateStatusBar();
    } catch (error) {
      this.statusBar.content = t`${fg(this.theme.red)(`Failed to open OpenCode: ${errorMessage(error)}`)}`;
    } finally {
      this.openingOpenCode = false;
    }
  }

  private async openSelectedInEditor(kind: NoteEditorKind): Promise<void> {
    if (this.editingFilePath) {
      this.statusBar.content = t`${fg(this.theme.yellow)("An editor is already open")}`;
      return;
    }

    const entry = this.selectedEntry;
    if (!entry) {
      this.statusBar.content = t`${fg(this.theme.yellow)("Select a note before editing")}`;
      return;
    }

    this.editingFilePath = entry.filePath;
    this.selectedFilePath = entry.filePath;
    const label = notePathLabel(entry);
    const detached = editorLaunchesDetached(kind);
    this.statusBar.content = t`${fg(this.theme.yellow)(`Opening ${label} in ${editorLabel(kind)}...`)}`;

    let editError: unknown;
    let refreshed = false;
    try {
      try {
        await this.callbacks.onEditNote(entry, kind);
        if (!detached) {
          try {
            await this.callbacks.finaliseNoteEdit(entry.filePath);
          } catch {
            // Non-fatal: git commit/sync failure does not block the flow.
          }
        }
      } catch (error) {
        editError = error;
      }
      refreshed = await this.refresh();
    } finally {
      this.editingFilePath = null;
    }

    if (editError) {
      this.statusBar.content = t`${fg(this.theme.red)(`Failed to edit ${label}: ${errorMessage(editError)}`)}`;
      return;
    }

    if (refreshed) {
      this.statusBar.content = detached
        ? t`${fg(this.theme.green)(`Opened ${label} in ${editorLabel(kind)}`)}`
        : t`${fg(this.theme.green)(`Updated ${label}`)}`;
    }
  }

  private startCreateFlow(editorKind: NoteEditorKind): void {
    if (this.creatingNote || this.editingFilePath) {
      this.statusBar.content = t`${fg(this.theme.yellow)("An editor is already open")}`;
      return;
    }
    this.createEditorKind = editorKind;
    const preferHandoff = this.filter?.tag?.toLowerCase() === "handoff";
    this.noteList.setActive(false);
    this.bodyScroll.blur();
    this.createPrompt.show(preferHandoff);
  }

  private cancelCreateFlow(): void {
    this.statusBar.content = t`${fg(this.theme.fgMuted)("Create cancelled")}`;
    this.focusPane(this.activePane);
  }

  private async executeCreateFlow(
    result: NoteCreatePromptResult,
  ): Promise<void> {
    this.creatingNote = true;
    this.statusBar.content = t`${fg(this.theme.yellow)(`Creating ${result.kind} draft...`)}`;
    this.focusPane(this.activePane);

    let draft: NoteCreateDraft;
    try {
      draft = await this.callbacks.createNoteDraft(
        result.kind,
        result.name,
        result.description,
      );
    } catch (error) {
      this.creatingNote = false;
      this.statusBar.content = t`${fg(this.theme.red)(`Failed to create draft: ${errorMessage(error)}`)}`;
      return;
    }

    this.selectedFilePath = draft.entry.filePath;
    const detached = editorLaunchesDetached(this.createEditorKind);
    this.statusBar.content = t`${fg(this.theme.yellow)(`Opening ${draft.entry.filename} in ${editorLabel(this.createEditorKind)}...`)}`;

    let editError: unknown;
    try {
      try {
        await this.callbacks.onEditNote(draft.entry, this.createEditorKind);
      } catch (error) {
        editError = error;
      }

      if (!detached) {
        try {
          await this.callbacks.finaliseNoteDraft(draft.entry.filePath);
        } catch {
          // Non-fatal: git commit failure does not block the flow.
        }
      }

      await this.refresh();
    } finally {
      this.creatingNote = false;
    }

    if (editError) {
      this.statusBar.content = t`${fg(this.theme.red)(`Editor error for ${draft.entry.filename}: ${errorMessage(editError)}`)}`;
      return;
    }

    const matchesActiveFilter = this.visibleEntries.some(
      (entry) => entry.filePath === draft.entry.filePath,
    );

    if (matchesActiveFilter) {
      this.statusBar.content = detached
        ? t`${fg(this.theme.green)(`Created draft ${draft.entry.filename} in ${editorLabel(this.createEditorKind)}`)}`
        : t`${fg(this.theme.green)(`Created ${draft.entry.filename}`)}`;
    } else {
      this.statusBar.content = detached
        ? t`${fg(this.theme.yellow)(`Created draft ${draft.entry.filename} in ${editorLabel(this.createEditorKind)} (hidden by current filter)`)}`
        : t`${fg(this.theme.yellow)(`Created ${draft.entry.filename} (hidden by current filter)`)}`;
    }
  }

  private requestDeleteSelected(): void {
    if (this.deletingFilePath) {
      this.statusBar.content = t`${fg(this.theme.yellow)("A note deletion is already in progress")}`;
      return;
    }

    const entry = this.selectedEntry;
    if (!entry) {
      this.statusBar.content = t`${fg(this.theme.yellow)("Select a note before deleting")}`;
      return;
    }

    this.deleteConfirmation = entry;
    this.showDeletePrompt(entry);
  }

  private async confirmDeleteSelected(): Promise<void> {
    const entry = this.deleteConfirmation;
    if (!entry) return;
    if (this.deletingFilePath) return;

    this.deletingFilePath = entry.filePath;
    this.clearDeleteConfirmation();
    this.loadVersion += 1;
    const label = notePathLabel(entry);
    this.statusBar.content = t`${fg(this.theme.yellow)(`Deleting ${label}...`)}`;

    try {
      await this.deleteSelectedEntry(entry);
    } catch (error) {
      this.statusBar.content = t`${fg(this.theme.red)(`Failed to delete ${label}: ${errorMessage(error)}`)}`;
    } finally {
      this.deletingFilePath = null;
    }
  }

  private async deleteSelectedEntry(entry: NoteEntry): Promise<void> {
    const nextSelectedFilePath = this.nextSelectedFilePathAfterDelete(
      entry.filePath,
    );
    const result = await this.callbacks.deleteNote(entry.filePath);
    this.clearDeletedSelection(entry.filePath, nextSelectedFilePath);
    if (await this.refresh())
      this.showDeleteSuccess(notePathLabel(entry), result);
  }

  private nextSelectedFilePathAfterDelete(filePath: string): string | null {
    const deletedIndex = this.visibleEntries.findIndex(
      (visibleEntry) => visibleEntry.filePath === filePath,
    );
    if (deletedIndex === -1) return null;

    const nextEntry = this.visibleEntries[deletedIndex + 1];
    if (nextEntry) return nextEntry.filePath;

    const previousEntry = this.visibleEntries[deletedIndex - 1];
    return previousEntry ? previousEntry.filePath : null;
  }

  private clearDeletedSelection(
    deletedFilePath: string,
    nextSelectedFilePath: string | null,
  ): void {
    if (this.selectedFilePath === deletedFilePath) {
      this.selectedFilePath = nextSelectedFilePath;
    }

    const selectedEntry = this.selectedEntry;
    if (selectedEntry && selectedEntry.filePath === deletedFilePath) {
      this.selectedEntry = null;
    }

    if (this.loadedNoteContentPath === deletedFilePath) {
      this.loadedNoteContent = null;
      this.loadedNoteContentPath = null;
    }
  }

  private showDeleteSuccess(label: string, result: NoteDeleteResult): void {
    const message = result.commit.ok
      ? `Deleted ${label}`
      : `Deleted ${label}; git commit failed: ${result.commit.error ?? "unknown error"}`;
    this.statusBar.content = t`${fg(result.commit.ok ? this.theme.green : this.theme.yellow)(message)}`;
  }

  private showDeletePrompt(entry: NoteEntry): void {
    this.deletePromptTitle.content = t`${bold(fg(this.theme.red)("Delete note?"))}`;
    this.deletePromptFile.content = t`${fg(this.theme.fgMuted)("File: ")}${fg(this.theme.fg)(notePathLabel(entry))}`;
    this.deletePromptHelp.content = t`${dim("y")} ${dim("delete")}  ${dim("n/Esc")} ${dim("cancel")}`;
    this.deletePrompt.top = Math.max(
      1,
      Math.floor((this.renderer.height - DELETE_PROMPT_HEIGHT) / 2),
    );
    this.deletePrompt.left = Math.max(
      1,
      Math.floor((this.renderer.width - DELETE_PROMPT_WIDTH) / 2),
    );
    this.deletePrompt.visible = true;
    this.noteList.setActive(false);
    this.bodyScroll.blur();
  }

  private cancelDeleteConfirmation(): void {
    const entry = this.deleteConfirmation;
    this.clearDeleteConfirmation();
    if (entry) {
      this.statusBar.content = t`${fg(this.theme.fgMuted)(`Delete cancelled: ${notePathLabel(entry)}`)}`;
    }
  }

  private clearDeleteConfirmation(refocus = true): void {
    this.deleteConfirmation = null;
    this.deletePrompt.visible = false;
    if (refocus && this.isVisible) this.focusPane(this.activePane);
  }

  private handleDeleteConfirmationKey(key: KeyEvent): void {
    this.deleteConfirmationKeyHandlers[key.name]?.();
  }

  private handleKeyPress(key: KeyEvent): void {
    if (!this.isVisible) return;
    if (this.createPrompt.visible) {
      this.createPrompt.handleKeyPress(key);
      return;
    }
    if (this.deleteConfirmation) {
      this.handleDeleteConfirmationKey(key);
      return;
    }
    this.keyHandlers[`${key.shift ? "shift+" : ""}${key.name}`]?.();
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
      section: this.showingAllRepos ? entry.repoSlug : undefined,
      value: entry,
    };
  }

  private updateHeader(entry: NoteEntry): void {
    const name = entry.name ?? stripMarkdownExtension(entry.filename);
    const modified = formatLocalNoteDateTimeFromEpochSeconds(entry.mtime);
    const fileLabel = notePathLabel(entry);
    this.noteHeading.content = t`${fg(this.theme.fgMuted)("Name: ")}${bold(fg(this.theme.accent)(name))}`;
    this.noteDescription.content = entry.description
      ? t`${fg(this.theme.fgMuted)("Description: ")}${fg(this.theme.fg)(entry.description)}`
      : t`${fg(this.theme.fgMuted)("Description: ")}${fg(this.theme.fgSubtle)("No description")}`;
    this.noteTags.content = t`${fg(this.theme.fgMuted)("Tags: ")}${fg(this.theme.fg)(formatTags(entry.tags))}`;
    this.noteFile.content = t`${fg(this.theme.fgMuted)("File: ")}${fg(this.theme.fg)(fileLabel)}`;
    this.noteModified.content = t`${fg(this.theme.fgMuted)("Modified: ")}${fg(this.theme.fg)(modified)}`;
  }

  private showEmptyContent(title: string, body: string): void {
    this.selectedEntry = null;
    this.loadedNoteContent = null;
    this.loadedNoteContentPath = null;
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
      `${notesDisplayTitle(this.filter, this.showingAllRepos)} • ${sortModeLabel(this.sortMode)}`,
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

    this.statusBar.content = t`${fg(this.theme.fgMuted)(formatStatusBarText(this.visibleEntries.length, this.selectedEntry, this.filter, this.showingAllRepos, this.usingAllReposFallback))}`;
  }

  private emptyTitle(): string {
    return `No ${notesDisplayTitle(this.filter, this.showingAllRepos)}`;
  }

  private emptyBody(): string {
    if (this.showingAllRepos) {
      return this.filter?.tag
        ? `No notes tagged ${this.filter.tag} found in any repository.`
        : "No notes found in any repository.";
    }

    return this.filter?.tag
      ? `No notes tagged ${this.filter.tag} found for this repository.`
      : "No notes found for this repository.";
  }

  private formatTitle() {
    return formatBreadcrumb(
      this.theme,
      ["Dot", notesDisplayTitle(this.filter, this.showingAllRepos)],
      notesSubtitle(this.filter, this.showingAllRepos),
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

function sortComparator(
  mode: NoteSortMode,
): (a: NoteEntry, b: NoteEntry) => number {
  switch (mode) {
    case "modified-desc":
      return (a, b) => b.mtime - a.mtime;
    case "modified-asc":
      return (a, b) => a.mtime - b.mtime;
    case "name-asc":
      return (a, b) =>
        noteSortName(a).localeCompare(noteSortName(b), undefined, {
          numeric: true,
        });
    case "name-desc":
      return (a, b) =>
        noteSortName(b).localeCompare(noteSortName(a), undefined, {
          numeric: true,
        });
  }
}

function noteSortName(entry: NoteEntry): string {
  return (entry.name ?? stripMarkdownExtension(entry.filename)).toLowerCase();
}

function sortModeLabel(mode: NoteSortMode): string {
  switch (mode) {
    case "modified-desc":
      return "modified ↓";
    case "modified-asc":
      return "modified ↑";
    case "name-asc":
      return "name ↑";
    case "name-desc":
      return "name ↓";
  }
}

function flattenNoteSections(
  sections: readonly NoteRepoSection[],
): readonly NoteEntry[] {
  return sections.flatMap((section) => section.entries);
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

function notesDisplayTitle(
  filter: NotesViewFilter | null,
  showingAllRepos: boolean,
): string {
  const title = filter?.title ?? "Notes";
  if (!showingAllRepos) return title;
  return title.startsWith("All ") ? title : `All ${title}`;
}

function notesSubtitle(
  filter: NotesViewFilter | null,
  showingAllRepos: boolean,
): string {
  const scope = showingAllRepos ? "all repos" : "repo notes";
  return filter?.tag ? `tag:${filter.tag} • ${scope}` : scope;
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
  showingAllRepos: boolean,
  usingAllReposFallback: boolean,
): string {
  return `${count} ${noteLabel(count)}${filterStatusText(filter, showingAllRepos, usingAllReposFallback)}    ${selectedStatusText(selectedEntry)}`;
}

function noteLabel(count: number): string {
  return count === 1 ? "note" : "notes";
}

function filterStatusText(
  filter: NotesViewFilter | null,
  showingAllRepos: boolean,
  usingAllReposFallback: boolean,
): string {
  const parts = [
    ...(filter?.tag ? [`tag:${filter.tag}`] : []),
    ...(showingAllRepos
      ? [usingAllReposFallback ? "all repos fallback" : "all repos"]
      : []),
  ];
  return parts.length ? ` • ${parts.join(" • ")}` : "";
}

function selectedStatusText(entry: NoteEntry | null): string {
  return entry ? `Selected: ${notePathLabel(entry)}` : "Select a note";
}

function formatListDescription(entry: NoteEntry): string {
  const description = entry.description ?? "No description";
  const tags = entry.tags.length ? ` [${entry.tags.join(", ")}]` : "";
  return `${description}${tags} • ${formatLocalNoteDateTimeFromEpochSeconds(entry.mtime)}`;
}

function formatTags(tags: readonly string[]): string {
  return tags.length > 0 ? tags.join(", ") : "untagged";
}

function notePathLabel(entry: NoteEntry): string {
  return entry.repoSlug
    ? `${entry.repoSlug}/${entry.filename}`
    : entry.filename;
}

function stripMarkdownExtension(filename: string): string {
  return filename.replace(/\.md$/i, "");
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}
