/**
 * @file Plays a desktop notification sound when agent tasks complete.
 *
 * Uses `paplay` with the freedesktop message sound. Only fires for main
 * (non-subagent) session idle events and permission prompts so background
 * work stays silent.
 */

import type { Plugin } from "@opencode-ai/plugin"

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
}

function dataOrValue(value: unknown): unknown {
  const record = recordFromUnknown(value)
  return "data" in record && record.data !== undefined ? record.data : value
}

export const NotificationPlugin = (async ({ $, client }) => {
  const soundPath = "/usr/share/sounds/freedesktop/stereo/message.oga"
  let canPlaySound: boolean | undefined

  const checkPaplay = async () => {
    if (canPlaySound !== undefined) {
      return canPlaySound
    }

    try {
      await $`sh -lc "command -v paplay >/dev/null 2>&1"`
      canPlaySound = true
    } catch {
      canPlaySound = false
    }

    return canPlaySound
  }

  const playSound = async () => {
    if (!(await checkPaplay())) {
      return
    }

    try {
      await $`paplay ${soundPath}`
    } catch {}
  }

  // Check if a session is a main (non-subagent) session
  const isMainSession = async (sessionID: string) => {
    try {
      const result = await client.session.get({ path: { id: sessionID } })
      const session = recordFromUnknown(dataOrValue(result))
      return !session.parentID
    } catch {
      // If we can't fetch the session, assume it's main to avoid missing notifications
      return true
    }
  }

  const sessionIDFromEvent = (event: { readonly properties?: Record<string, unknown> }) => {
    const sessionID = event.properties?.sessionID
    return typeof sessionID === "string" ? sessionID : ""
  }

  return {
    event: async ({ event }) => {
      // Only notify for main session events, not background subagents
      if (event.type === "session.idle") {
        const sessionID = sessionIDFromEvent(event)
        if (await isMainSession(sessionID)) {
          await playSound()
        }
      }

      // Permission prompt created
      if (event.type === "permission.asked") {
        await playSound()
      }
    },
  }
}) satisfies Plugin

export default NotificationPlugin
