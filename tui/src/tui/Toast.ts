import {
  type CliRenderer,
  BoxRenderable,
  TextRenderable,
  t,
  bold,
  fg,
} from "@opentui/core"
import type { ToastVariant } from "../types.js"

/** Auto-dismiss delay per variant (milliseconds) */
const DISMISS_MS: Record<ToastVariant, number> = {
  info: 5000,
  success: 3000,
  error: 8000,
}

/** Border colour per variant */
const BORDER_COLOR: Record<ToastVariant, string> = {
  info: "#58a6ff",
  success: "#3fb950",
  error: "#f85149",
}

/** Icon per variant */
const ICON: Record<ToastVariant, string> = {
  info: "󰋼",
  success: "󰄬",
  error: "󰅚",
}

/**
 * Single-slot toast notification overlay.
 *
 * Positioned absolutely in the top-right corner of the terminal.
 * Supports ID-based replacement: calling {@link show} with the same `id`
 * replaces the current toast in-place instead of stacking.
 */
export class Toast {
  private root: BoxRenderable
  private text: TextRenderable
  private currentId: string | null = null
  private timeout: ReturnType<typeof setTimeout> | null = null

  constructor(renderer: CliRenderer) {
    this.root = new BoxRenderable(renderer, {
      id: "toast-root",
      position: "absolute",
      top: 1,
      right: 2,
      width: 50,
      height: 3,
      borderStyle: "rounded",
      borderColor: BORDER_COLOR.info,
      backgroundColor: "#161b22",
      paddingLeft: 1,
      paddingRight: 1,
      alignItems: "center",
      zIndex: 200,
      visible: false,
    })

    this.text = new TextRenderable(renderer, {
      id: "toast-text",
      content: "",
    })
    this.root.add(this.text)

    renderer.root.add(this.root)
  }

  /**
   * Show a toast notification.
   *
   * If `id` matches the current toast, the message and variant are replaced
   * in-place. Otherwise the previous toast is dismissed and a new one shown.
   *
   * @param id - Stable grouping identifier (e.g. "memory", "restart.waybar")
   * @param message - Display text
   * @param variant - Controls border colour and auto-dismiss timing
   */
  show(id: string, message: string, variant: ToastVariant): void {
    // Clear any pending dismiss timer
    if (this.timeout) {
      clearTimeout(this.timeout)
      this.timeout = null
    }

    this.currentId = id
    this.root.borderColor = BORDER_COLOR[variant]
    this.text.content = t`${fg(BORDER_COLOR[variant])(ICON[variant])}  ${bold(fg("#c9d1d9")(message))}`
    this.root.visible = true

    this.timeout = setTimeout(() => {
      this.dismiss()
    }, DISMISS_MS[variant])
  }

  /** Hide the current toast and clear state */
  dismiss(): void {
    if (this.timeout) {
      clearTimeout(this.timeout)
      this.timeout = null
    }
    this.currentId = null
    this.root.visible = false
  }

  /** Remove the toast from the render tree */
  destroy(): void {
    this.dismiss()
  }
}
