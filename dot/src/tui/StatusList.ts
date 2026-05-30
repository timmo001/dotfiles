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
import type { Theme } from "../theme.js";

/** A two-line status list item with first-line colour and muted details */
export interface StatusListItem<T> {
  /** Stable item identifier */
  readonly id: string;
  /** First-line label */
  readonly title: string;
  /** Second-line details */
  readonly description: string;
  /** Colour used for the first line in both selected and unselected states */
  readonly color: string;
  /** Optional non-selectable section heading shown before grouped items. */
  readonly section?: string;
  /** Source value associated with this item */
  readonly value: T;
}

/** Options for {@link StatusList} */
export interface StatusListOptions<T> {
  /** Unique renderable ID */
  readonly id: string;
  /** Active colour theme */
  readonly theme: Theme;
  /** Initial items to render */
  readonly items?: readonly StatusListItem<T>[];
  /** Called when the user presses Enter on the selected item */
  readonly onSelect: (item: StatusListItem<T>) => void;
  /** Called when the highlighted item changes */
  readonly onSelectionChanged?: (item: StatusListItem<T>) => void;
  /** Whether Enter activates the highlighted item. Defaults to true. */
  readonly selectOnEnter?: boolean;
}

interface StatusListRow<T> {
  readonly container: BoxRenderable;
  readonly titleText: TextRenderable;
  readonly descText: TextRenderable;
  readonly item: StatusListItem<T>;
}

/** Scrollable two-line list that can colour each item's first line independently */
export class StatusList<T> extends ScrollBoxRenderable {
  private readonly renderer: CliRenderer;
  private readonly theme: Theme;
  private readonly onSelect: (item: StatusListItem<T>) => void;
  private readonly onItemSelectionChanged?: (item: StatusListItem<T>) => void;
  private readonly selectOnEnter: boolean;
  private sectionHeaders: BoxRenderable[] = [];
  private rows: StatusListRow<T>[] = [];
  private items: readonly StatusListItem<T>[] = [];
  private selectedIndex = 0;
  private active = false;

  constructor(renderer: CliRenderer, options: StatusListOptions<T>) {
    super(renderer, {
      id: options.id,
      flexGrow: 1,
      width: "100%",
      scrollY: true,
      scrollX: false,
      backgroundColor: options.theme.bgElevated,
      focusable: true,
    });

    this.renderer = renderer;
    this.theme = options.theme;
    this.onSelect = options.onSelect;
    this.onItemSelectionChanged = options.onSelectionChanged;
    this.selectOnEnter = options.selectOnEnter ?? true;
    this.setItems(options.items ?? []);
  }

  /** Replace rendered items, preserving selection by item ID when possible */
  setItems(
    items: readonly StatusListItem<T>[],
    preferredId?: string | null,
  ): void {
    const selectedId = preferredId ?? this.getSelectedItem()?.id ?? null;
    this.clearRows();
    this.items = items;
    this.selectedIndex = selectedId
      ? Math.max(
          0,
          items.findIndex((item) => item.id === selectedId),
        )
      : 0;
    this.buildRows();
    this.emitSelectionChanged();
  }

  /** Return the highlighted item, if any */
  getSelectedItem(): StatusListItem<T> | undefined {
    return this.items[this.selectedIndex];
  }

  /** Mark this list as the active pane and focus it */
  setActive(active: boolean): void {
    this.active = active;
    this.opacity = active ? 1 : 0.45;
    if (active) this.focus();
    else this.blur();
    this.refreshRowStyles();
  }

  /** Handle list navigation and selection keys */
  override handleKeyPress(key: KeyEvent): boolean {
    if (key.name === "up") {
      this.moveSelection(-1);
      return true;
    }
    if (key.name === "down") {
      this.moveSelection(1);
      return true;
    }
    if (key.name === "return" && this.selectOnEnter) {
      const item = this.getSelectedItem();
      if (item) this.onSelect(item);
      return true;
    }
    return super.handleKeyPress(key);
  }

  private moveSelection(delta: number): void {
    if (this.items.length === 0) return;
    const next =
      (this.selectedIndex + delta + this.items.length) % this.items.length;
    if (next === this.selectedIndex) return;
    this.selectedIndex = next;
    this.refreshRowStyles();
    const row = this.rows[this.selectedIndex];
    if (row) this.scrollChildIntoView(row.container.id);
    this.emitSelectionChanged();
  }

  private activateIndex(index: number): void {
    const item = this.items[index];
    if (!item) return;

    if (index !== this.selectedIndex) {
      this.selectedIndex = index;
      this.refreshRowStyles();
      const row = this.rows[this.selectedIndex];
      if (row) this.scrollChildIntoView(row.container.id);
      this.emitSelectionChanged();
    }

    this.onSelect(item);
  }

  private emitSelectionChanged(): void {
    const item = this.getSelectedItem();
    if (item) this.onItemSelectionChanged?.(item);
  }

  private clearRows(): void {
    for (const header of this.sectionHeaders) {
      this.remove(header.id);
    }
    for (const row of this.rows) {
      this.remove(row.container.id);
    }
    this.sectionHeaders = [];
    this.rows = [];
  }

  private buildRows(): void {
    let lastSection: string | undefined;
    for (let index = 0; index < this.items.length; index++) {
      const item = this.items[index];
      if (item.section && item.section !== lastSection) {
        const header = this.createSectionHeader(item.section, index);
        this.sectionHeaders.push(header);
        this.add(header);
      }
      lastSection = item.section;

      const row = this.createRow(item, index);
      this.rows.push(row);
      this.add(row.container);
    }
    this.refreshRowStyles();
  }

  private createRow(item: StatusListItem<T>, index: number): StatusListRow<T> {
    const id = `${this.id}-row-${index}`;
    const container = new BoxRenderable(this.renderer, {
      id,
      flexDirection: "column",
      width: "100%",
      flexShrink: 0,
      backgroundColor: this.theme.bgElevated,
      paddingLeft: 1,
      onMouseDown: (event) => {
        if (event.button !== 0) return;
        event.stopPropagation();
        this.activateIndex(index);
      },
    });
    const titleText = new TextRenderable(this.renderer, {
      id: `${id}-title`,
      content: t`${fg(item.color)(item.title)}`,
    });
    const descText = new TextRenderable(this.renderer, {
      id: `${id}-desc`,
      content: t`${fg(this.theme.fgMuted)(item.description)}`,
    });

    container.add(titleText);
    container.add(descText);
    return { container, titleText, descText, item };
  }

  private createSectionHeader(section: string, index: number): BoxRenderable {
    const id = `${this.id}-section-${index}`;
    const container = new BoxRenderable(this.renderer, {
      id,
      flexDirection: "column",
      width: "100%",
      flexShrink: 0,
      backgroundColor: this.theme.bgElevated,
      paddingLeft: 1,
      paddingTop: index > 0 ? 1 : 0,
    });
    container.add(
      new TextRenderable(this.renderer, {
        id: `${id}-title`,
        content: t`${bold(fg(this.theme.fgSubtle)(section))}`,
      }),
    );
    return container;
  }

  private refreshRowStyles(): void {
    for (let index = 0; index < this.rows.length; index++) {
      const row = this.rows[index];
      const selected = index === this.selectedIndex;
      row.container.backgroundColor =
        selected && this.active ? this.theme.bgSelected : this.theme.bgElevated;
      row.titleText.content = t`${fg(row.item.color)(row.item.title)}`;
      row.descText.content = t`${fg(this.theme.fgMuted)(row.item.description)}`;
    }
  }
}
