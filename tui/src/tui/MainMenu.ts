import {
  type CliRenderer,
  BoxRenderable,
  TextRenderable,
  t,
  bold,
  fg,
} from "@opentui/core"
import type { MenuItem } from "../types.js"
import { mainMenuItems } from "../menu.js"
import { formatHelpBar, type HelpEntry } from "./helpBar.js"
import { MenuList } from "./MenuList.js"

/** Help entries for the main menu */
const HELP: readonly HelpEntry[] = [
  { key: "↑↓", action: "navigate" },
  { key: "Enter", action: "select" },
  { key: "q", action: "quit" },
]

/** Configuration callbacks for the main menu */
export interface MainMenuOptions {
  /** Called when the user selects a menu item */
  readonly onSelect: (item: MenuItem) => void
  /** If set, pre-select the item with this ID on startup */
  readonly initialSelectedId?: string
}

/** Top-level dot menu rendered as a {@link MenuList} */
export class MainMenu {
  private renderer: CliRenderer
  private root: BoxRenderable
  private menuList: MenuList
  private helpBar: TextRenderable
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

    // Menu list — icons on the left, full-height rows
    const initialIdx = options.initialSelectedId
      ? Math.max(0, mainMenuItems.findIndex((m) => m.id === options.initialSelectedId))
      : 0

    this.menuList = new MenuList(renderer, {
      id: "main-menu-list",
      items: mainMenuItems,
      onSelect: (item) => this.callbacks.onSelect(item),
      initialSelectedIndex: initialIdx,
      wrapSelection: true,
    })
    this.root.add(this.menuList)

    // Help bar
    this.helpBar = new TextRenderable(renderer, {
      id: "main-menu-help",
      content: formatHelpBar(HELP),
      marginTop: 1,
    })
    this.root.add(this.helpBar)

    renderer.root.add(this.root)

    // Re-wrap help bar on terminal resize
    renderer.on("resize", () => {
      this.helpBar.content = formatHelpBar(HELP)
    })
  }

  /** Show or hide the main menu view */
  setVisible(visible: boolean): void {
    this.root.visible = visible
  }

  /** Give keyboard focus to the menu list */
  focus(): void {
    this.menuList.focus()
  }

  /** Remove the main menu from the render tree */
  destroy(): void {
    this.renderer.root.remove(this.root.id)
  }
}
