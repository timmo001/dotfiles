import {
  type CliRenderer,
  BoxRenderable,
  TextRenderable,
  SelectRenderable,
  SelectRenderableEvents,
  type SelectOption,
  t,
  bold,
  fg,
} from "@opentui/core"
import type { MenuItem } from "../types.js"
import { submenus, submenuTitles } from "../menu.js"

export interface OmarchyMenuOptions {
  readonly onAction: (item: MenuItem) => void
  readonly onBack: () => void
}

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
      content: t`${fg("#484f58")("↑↓ navigate   Enter select   Esc back   q quit")}`,
      marginTop: 1,
    })
    this.root.add(this.helpBar)

    renderer.root.add(this.root)

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

  setVisible(visible: boolean): void {
    this.root.visible = visible
    this.isVisible = visible
  }

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
    // Build breadcrumb: Omarchy > Theme > ...
    const parts = ["Omarchy"]

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

    if (parts.length === 1) {
      return t`${bold(fg("#58a6ff")("Omarchy"))}${fg("#8b949e")(" — desktop controls")}`
    }

    const last = parts.length - 1

    // Style the whole thing: last part highlighted, rest dim
    if (parts.length === 2) {
      return t`${fg("#8b949e")(parts[0])}${fg("#484f58")(" › ")}${bold(fg("#58a6ff")(parts[1]))}`
    }

    // 3+ parts: dim all but last
    const prefix = parts.slice(0, -1).join(" › ")
    return t`${fg("#8b949e")(prefix)}${fg("#484f58")(" › ")}${bold(fg("#58a6ff")(parts[last]))}`
  }

  destroy(): void {
    this.renderer.root.remove(this.root.id)
  }
}
