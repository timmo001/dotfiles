/**
 * @file Shared helper for reporting to the interactive OpenCode session.
 *
 * Wraps `client.tui.showToast` with the client-undefined guard and error
 * swallowing every caller needs, so plugins can surface a side-effect or a
 * silent action to the interactive user (a toast on the TUI) without repeating
 * the boilerplate. Toasts show on the TUI regardless of which (sub)agent
 * triggered them, and never enter an agent's tool output.
 */

import type { PluginInput } from "@opencode-ai/plugin"

type ToastClient = PluginInput["client"]

/** A toast to show on the interactive TUI. */
export interface ToastOptions {
  /** Optional bold heading. */
  readonly title?: string
  /** Toast body text. */
  readonly message: string
  /** Visual severity of the toast. */
  readonly variant: "info" | "success" | "warning" | "error"
  /** How long to show the toast, in milliseconds. */
  readonly duration?: number
}

/**
 * Show a toast on the interactive session. A no-op when no client was captured
 * (e.g. a headless run), and best-effort: a failed toast never throws into the
 * caller.
 */
export async function showToast(
  client: ToastClient | undefined,
  options: ToastOptions,
): Promise<void> {
  if (!client) return
  try {
    await client.tui.showToast({ body: { ...options } })
  } catch {}
}
