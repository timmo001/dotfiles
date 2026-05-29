import {
  type CliRenderer,
  BoxRenderable,
  TextRenderable,
  t,
  fg,
} from "@opentui/core";
import type { MenuItem } from "../types.js";
import type { Theme } from "../theme.js";
import { submenus, submenuTitles } from "../menu.js";
import { formatBreadcrumb } from "./breadcrumb.js";
import {
  addResponsiveHelpBar,
  GLOBAL_HELP,
  type HelpEntry,
} from "./helpBar.js";
import { MenuList } from "./MenuList.js";

/** Help entries for the omarchy menu */
const HELP: readonly HelpEntry[] = [
  { key: "↑↓", action: "navigate" },
  { key: "Enter", action: "select" },
  { key: "type", action: "filter" },
  { key: "Esc", action: "back" },
  { key: "Backspace", action: "back" },
  ...GLOBAL_HELP,
];

/** Configuration callbacks for the omarchy submenu tree */
export interface OmarchyMenuOptions {
  /** Called when the user selects a non-submenu action item */
  readonly onAction: (item: MenuItem) => void;
  /** Called when the user navigates back from the root omarchy menu */
  readonly onBack: () => void;
  /** Called when the submenu changes so the terminal title can be updated */
  readonly onTitleChange?: (titleParts: readonly string[]) => void;
}

/** Inline omarchy submenu tree with breadcrumb navigation, nested levels, and type-to-filter */
export class OmarchyMenu {
  private renderer: CliRenderer;
  private theme: Theme;
  private callbacks: OmarchyMenuOptions;

  private root: BoxRenderable;
  private titleText: TextRenderable;
  private filterBar: TextRenderable;
  private menuList: MenuList;
  private helpBar: TextRenderable;

  /** Stack of submenu IDs for nested navigation */
  private menuStack: string[] = [];
  private currentMenuId = "omarchy";
  private currentItems: readonly MenuItem[] = [];
  private isVisible = false;

  constructor(
    renderer: CliRenderer,
    theme: Theme,
    options: OmarchyMenuOptions,
  ) {
    this.renderer = renderer;
    this.theme = theme;
    this.callbacks = options;

    this.root = new BoxRenderable(renderer, {
      id: "omarchy-menu-root",
      flexDirection: "column",
      width: "100%",
      height: "100%",
      padding: 1,
    });

    // Title (dynamic based on submenu depth)
    this.titleText = new TextRenderable(renderer, {
      id: "omarchy-menu-title",
      content: this.formatTitle(),
      marginBottom: 1,
    });
    this.root.add(this.titleText);

    // Filter bar — always visible to avoid layout shifts
    this.filterBar = new TextRenderable(renderer, {
      id: "omarchy-menu-filter",
      content: t`${fg(theme.fgSubtle)("/")}`,
      marginBottom: 1,
    });
    this.root.add(this.filterBar);

    // Menu list — created fresh on each loadMenu call
    const initialItems = submenus.get("omarchy") ?? [];
    this.menuList = this.createMenuList(initialItems);
    this.root.add(this.menuList);

    this.helpBar = addResponsiveHelpBar(renderer, this.root, {
      id: "omarchy-menu-help",
      theme,
      entries: HELP,
      marginTop: 1,
    });

    renderer.root.add(this.root);

    this.currentItems = initialItems;
  }

  /** Navigate into a submenu */
  pushSubmenu(menuId: string): void {
    this.menuStack.push(this.currentMenuId);
    this.loadMenu(menuId);
  }

  /** Reset to the top-level omarchy menu */
  resetToRoot(): void {
    this.menuStack = [];
    this.loadMenu("omarchy");
  }

  /** Show or hide the omarchy menu view */
  setVisible(visible: boolean): void {
    this.root.visible = visible;
    this.isVisible = visible;
  }

  /** Give keyboard focus to the menu list */
  focus(): void {
    this.menuList.focus();
  }

  /** Reset filter state and give keyboard focus to the menu list */
  resetAndFocus(): void {
    this.menuList.resetFilter();
    this.menuList.focus();
  }

  /** Remove keyboard focus from the menu list */
  blur(): void {
    this.menuList.blur();
  }

  private handleBack(): void {
    const prev = this.menuStack.pop();
    if (prev) {
      // Go up one submenu level
      this.loadMenu(prev);
    } else {
      // At the top of omarchy menu — go back to main menu
      this.callbacks.onBack();
    }
  }

  private loadMenu(menuId: string): void {
    const items = submenus.get(menuId);
    if (!items) return;

    this.currentMenuId = menuId;
    this.currentItems = items;

    // Update title
    this.titleText.content = this.formatTitle();

    // Notify parent of title change for terminal tab title
    this.callbacks.onTitleChange?.(this.getTitleParts());

    // Reset filter bar (new menu = no filter)
    this.filterBar.content = t`${fg(this.theme.fgSubtle)("/")}`;

    // Recreate the menu list with new items (ensures correct 2-row layout)
    this.root.remove(this.menuList.id);
    this.menuList = this.createMenuList(items);
    this.root.insertBefore(this.menuList, this.helpBar);
    this.menuList.focus();
  }

  private createMenuList(items: readonly MenuItem[]): MenuList {
    return new MenuList(this.renderer, {
      id: "omarchy-menu-list",
      items,
      theme: this.theme,
      onSelect: (item) => {
        if (
          item.action.type === "submenu" &&
          submenus.has(item.action.menuId)
        ) {
          this.pushSubmenu(item.action.menuId);
        } else {
          this.callbacks.onAction(item);
        }
      },
      onFilterChange: (filter) => this.updateFilterBar(filter),
      onEscape: () => this.handleBack(),
      onBack: () => this.handleBack(),
      wrapSelection: true,
    });
  }

  /** Update the filter bar display based on current filter text */
  private updateFilterBar(filter: string): void {
    if (filter.length === 0) {
      this.filterBar.content = t`${fg(this.theme.fgSubtle)("/")}`;
    } else {
      this.filterBar.content = t`${fg(this.theme.accent)("/")} ${fg(this.theme.fg)(filter)}`;
    }
  }

  private formatTitle() {
    const parts = this.getTitleParts();

    // Show subtitle only at the omarchy root level (Dot › Omarchy)
    const subtitle = parts.length === 2 ? "desktop controls" : undefined;
    return formatBreadcrumb(this.theme, parts, subtitle);
  }

  /** Build the plain-text breadcrumb segments for the current submenu depth */
  private getTitleParts(): string[] {
    const parts = ["Dot", "Omarchy"];

    for (const menuId of this.menuStack) {
      if (menuId !== "omarchy") {
        const title = submenuTitles.get(menuId) ?? menuId;
        parts.push(title);
      }
    }

    if (this.currentMenuId !== "omarchy") {
      const title = submenuTitles.get(this.currentMenuId) ?? this.currentMenuId;
      if (parts[parts.length - 1] !== title) {
        parts.push(title);
      }
    }

    return parts;
  }

  /** Remove the omarchy menu from the render tree */
  destroy(): void {
    this.renderer.root.remove(this.root.id);
  }
}
