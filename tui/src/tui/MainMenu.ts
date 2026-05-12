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
import { mainMenuItems } from "../menu.js"

/** Configuration callbacks for the main menu */
export interface MainMenuOptions {
  /** Called when the user selects a menu item */
  readonly onSelect: (item: MenuItem) => void
  /** If set, pre-select the item with this ID on startup */
  readonly initialSelectedId?: string
}

/** Top-level dot menu rendered as a {@link SelectRenderable} list */
export class MainMenu {
  private renderer: CliRenderer
  private root: BoxRenderable
  private select: SelectRenderable
  private callbacks: MainMenuOptions

  constructor(renderer: CliRenderer, options: MainMenuOptions) {
    this.renderer = renderer
    this.callbacks = options

    this.root = new BoxRenderable(renderer, {
      id: "main-menu-root",
      flexDirection: "column",
      width: "100%",
      height: "100%",
      padding: 1,
    })

    // Title
    const titleBar = new TextRenderable(renderer, {
      id: "main-menu-title",
      content: t`${bold(fg("#58a6ff")("Dot"))}${fg("#8b949e")(" — dotfiles manager")}`,
      marginBottom: 1,
    })
    this.root.add(titleBar)

    // Menu list
    this.select = new SelectRenderable(renderer, {
      id: "main-menu-select",
      flexGrow: 1,
      width: "100%",
      options: mainMenuItems.map((item) => ({
        name: `${item.icon}  ${item.title}`,
        description: item.description,
        value: item.id,
      })),
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
    const helpBar = new TextRenderable(renderer, {
      id: "main-menu-help",
      content: t`${fg("#484f58")("↑↓ navigate   Enter select   q quit")}`,
      marginTop: 1,
    })
    this.root.add(helpBar)

    renderer.root.add(this.root)

    // Wire up selection
    this.select.on(
      SelectRenderableEvents.ITEM_SELECTED,
      (_index: number, option: SelectOption) => {
        const item = mainMenuItems.find((m) => m.id === option.value)
        if (item) this.callbacks.onSelect(item)
      },
    )

    // Pre-select a specific item if requested
    if (options.initialSelectedId) {
      const idx = mainMenuItems.findIndex((m) => m.id === options.initialSelectedId)
      if (idx >= 0) this.select.setSelectedIndex(idx)
    }
  }

  /** Show or hide the main menu view */
  setVisible(visible: boolean): void {
    this.root.visible = visible
  }

  /** Give keyboard focus to the menu list */
  focus(): void {
    this.select.focus()
  }

  /** Remove the main menu from the render tree */
  destroy(): void {
    this.renderer.root.remove(this.root.id)
  }
}
