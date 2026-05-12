import {
  type CliRenderer,
  BoxRenderable,
  TextRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  type SelectOption,
} from "@opentui/core"
import type { MenuItem } from "../types.js"
import { submenus, submenuTitles } from "../menu.js"
import { formatBreadcrumb } from "./breadcrumb.js"
import { formatHelpBar, type HelpEntry } from "./helpBar.js"

/** Help entries for the omarchy menu */
const HELP: readonly HelpEntry[] = [
  { key: "↑↓", action: "navigate" },
  { key: "Enter", action: "select" },
  { key: "Esc/Backspace", action: "back" },
  { key: "q", action: "quit" },
]

/** Configuration callbacks for the omarchy submenu tree */
export interface OmarchyMenuOptions {
  /** Called when the user selects a non-submenu action item */
  readonly onAction: (item: MenuItem) => void
  /** Called when the user navigates back from the root omarchy menu */
  readonly onBack: () => void
}

/** Inline omarchy submenu tree with breadcrumb navigation and nested levels */
export class OmarchyMenu {
  private renderer: CliRenderer
  private callbacks: OmarchyMenuOptions

  private root: BoxRenderable
  private titleText: TextRenderable
  private select: SelectRenderable
  private helpBar: TextRenderable

  /** Stack of submenu IDs for nested navigation */
  private menuStack: string[] = []
  private currentMenuId = "omarchy"
  private currentItems: readonly MenuItem[] = []
  private isVisible = false

  constructor(renderer: CliRenderer, options: OmarchyMenuOptions) {
    this.renderer = renderer
    this.callbacks = options

    this.root = new BoxRenderable(renderer, {
      id: "omarchy-menu-root",
      flexDirection: "column",
      width: "100%",
      height: "100%",
      padding: 1,
    })

    // Title (dynamic based on submenu depth)
    this.titleText = new TextRenderable(renderer, {
      id: "omarchy-menu-title",
      content: this.formatTitle(),
      marginBottom: 1,
    })
    this.root.add(this.titleText)

    // Menu list
    this.select = new SelectRenderable(renderer, {
      id: "omarchy-menu-select",
      flexGrow: 1,
      width: "100%",
      options: [],
      backgroundColor: "#161b22",
      focusedBackgroundColor: "#161b22",
      selectedBackgroundColor: "#1f6feb",
      selectedTextColor: "#ffffff",
      textColor: "#c9d1d9",
      focusedTextColor: "#c9d1d9",
      descriptionColor: "#8b949e",
      selectedDescriptionColor: "#c9d1d9",
      showDescription: true,
      showScrollIndicator: true,
      wrapSelection: true,
    })
    this.root.add(this.select)

    // Help bar
    this.helpBar = new TextRenderable(renderer, {
      id: "omarchy-menu-help",
      content: formatHelpBar(HELP),
      marginTop: 1,
    })
    this.root.add(this.helpBar)

    renderer.root.add(this.root)

    // Re-wrap help bar on terminal resize
    renderer.on("resize", () => {
      this.helpBar.content = formatHelpBar(HELP)
    })

    // Wire up selection
    this.select.on(
      SelectRenderableEvents.ITEM_SELECTED,
      (_index: number, option: SelectOption) => {
        const item = this.currentItems.find((m) => m.id === option.value)
        if (!item) return

        // If this item opens a submenu and the submenu exists, navigate into it
        if (item.action.type === "submenu" && submenus.has(item.action.menuId)) {
          this.pushSubmenu(item.action.menuId)
        } else {
          this.callbacks.onAction(item)
        }
      },
    )

    // Keyboard handling
    renderer.keyInput.on("keypress", (key) => {
      if (!this.isVisible) return

      if (key.name === "escape" || key.name === "backspace") {
        this.handleBack()
      }
    })

    // Load root omarchy menu
    this.loadMenu("omarchy")
  }

  /** Navigate into a submenu */
  pushSubmenu(menuId: string): void {
    this.menuStack.push(this.currentMenuId)
    this.loadMenu(menuId)
  }

  /** Reset to the top-level omarchy menu */
  resetToRoot(): void {
    this.menuStack = []
    this.loadMenu("omarchy")
  }

  /** Show or hide the omarchy menu view */
  setVisible(visible: boolean): void {
    this.root.visible = visible
    this.isVisible = visible
  }

  /** Give keyboard focus to the menu list */
  focus(): void {
    this.select.focus()
  }

  private handleBack(): void {
    const prev = this.menuStack.pop()
    if (prev) {
      // Go up one submenu level
      this.loadMenu(prev)
    } else {
      // At the top of omarchy menu — go back to main menu
      this.callbacks.onBack()
    }
  }

  private loadMenu(menuId: string): void {
    const items = submenus.get(menuId)
    if (!items) return

    this.currentMenuId = menuId
    this.currentItems = items

    // Update title
    this.titleText.content = this.formatTitle()

    // Update list
    this.select.options = items.map((item) => ({
      name: `${item.icon}  ${item.title}`,
      description: item.description,
      value: item.id,
    }))

    // Reset selection to top
    this.select.setSelectedIndex(0)
  }

  private formatTitle() {
    // Build breadcrumb: Dot > Omarchy > Theme > ...
    const parts = ["Dot", "Omarchy"]

    for (const menuId of this.menuStack) {
      if (menuId !== "omarchy") {
        const title = submenuTitles.get(menuId) ?? menuId
        parts.push(title)
      }
    }

    if (this.currentMenuId !== "omarchy") {
      const title = submenuTitles.get(this.currentMenuId) ?? this.currentMenuId
      if (parts[parts.length - 1] !== title) {
        parts.push(title)
      }
    }

    // Show subtitle only at the omarchy root level (Dot › Omarchy)
    const subtitle = parts.length === 2 ? "desktop controls" : undefined
    return formatBreadcrumb(parts, subtitle)
  }

  /** Remove the omarchy menu from the render tree */
  destroy(): void {
    this.renderer.root.remove(this.root.id)
  }
}
