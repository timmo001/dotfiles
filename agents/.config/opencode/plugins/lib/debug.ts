/**
 * @file Temporary dismiss diagnostics shared by the server and TUI plugin halves. Remove once the dismiss fix lands.
 */

import { appendFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

/** JSON-lines file both plugin halves append to. */
export const DEBUG_LOG = "/tmp/opencode/dismiss-debug.log";

/** JSON-safe value written to a diagnostic line. */
export type DebugValue =
  | string
  | number
  | boolean
  | null
  | undefined
  | ReadonlyArray<DebugValue>
  | { readonly [key: string]: DebugValue };

/** Extra fields for one diagnostic line. */
export type DebugFields = { readonly [key: string]: DebugValue };

/** What a failed plugin call rejects with: an Error, or the plain object failed RPC calls throw. */
export type Rejection = Error | { readonly type: string; readonly message: string };

/** Renders a rejection for the log. */
export const describe = (error: Rejection) =>
  error instanceof Error ? `${error.name}: ${error.message}` : `${error.type}: ${error.message}`;

/** Appends one diagnostic line; never throws. */
export const debugLog = (plugin: string, side: "server" | "tui", message: string, data: DebugFields = {}) => {
  try {
    mkdirSync(dirname(DEBUG_LOG), { recursive: true });
    appendFileSync(
      DEBUG_LOG,
      `${JSON.stringify({ time: new Date().toISOString(), pid: process.pid, plugin, side, message, ...data })}\n`,
    );
  } catch {
    // Diagnostics must not break the plugin.
  }
};
