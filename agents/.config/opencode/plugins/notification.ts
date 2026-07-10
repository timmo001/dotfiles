/**
 * @file Sends contextual desktop and terminal notifications for agent events.
 *
 * Uses OSC 777 so supported terminals can focus the originating surface when
 * the notification is clicked, BEL to request attention, and `paplay` for the
 * freedesktop message sound. Main session completions and permission prompts
 * include the session title, while background task completions stay silent.
 */

import type { Plugin } from "@opencode-ai/plugin";

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {};
}

function dataOrValue(value: unknown): unknown {
  const record = recordFromUnknown(value);
  return "data" in record && record.data !== undefined ? record.data : value;
}

export const NotificationPlugin = (async ({ $, client }) => {
  const soundPath = "/usr/share/sounds/freedesktop/stereo/message.oga";
  let canPlaySound: boolean | undefined;

  const sanitizeNotificationText = (value: string, fallback: string) => {
    const sanitized = [...value]
      .map((character) => {
        const codePoint = character.codePointAt(0) ?? 0;
        return codePoint < 32 ||
          (codePoint >= 127 && codePoint <= 159) ||
          character === ";"
          ? " "
          : character;
      })
      .join("")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 160);
    return sanitized || fallback;
  };

  const checkPaplay = async () => {
    if (canPlaySound !== undefined) {
      return canPlaySound;
    }

    try {
      await $`sh -lc "command -v paplay >/dev/null 2>&1"`;
      canPlaySound = true;
    } catch {
      canPlaySound = false;
    }

    return canPlaySound;
  };

  const playSound = async () => {
    if (!(await checkPaplay())) {
      return;
    }

    try {
      await $`paplay ${soundPath}`;
    } catch {}
  };

  const getSession = async (sessionID: string) => {
    try {
      const result = await client.session.get({ path: { id: sessionID } });
      return recordFromUnknown(dataOrValue(result));
    } catch {
      return {};
    }
  };

  const notifyTerminal = (title: string, body: string) => {
    const safeTitle = sanitizeNotificationText(title, "OpenCode");
    const safeBody = sanitizeNotificationText(body, "Attention required");

    try {
      process.stdout.write(
        `\u001b]777;notify;${safeTitle};${safeBody}\u001b\\\u0007`,
      );
    } catch {}
  };

  const notify = async (title: string, body: string) => {
    notifyTerminal(title, body);
    await playSound();
  };

  const sessionIDFromEvent = (event: {
    readonly properties?: Record<string, unknown>;
  }) => {
    const sessionID = event.properties?.sessionID;
    return typeof sessionID === "string" ? sessionID : "";
  };

  return {
    event: async ({ event }) => {
      // Only notify for main session events, not background subagents
      if (event.type === "session.idle") {
        const sessionID = sessionIDFromEvent(event);
        const session = await getSession(sessionID);
        if (session.parentID) return;

        const sessionTitle =
          typeof session.title === "string"
            ? session.title
            : "OpenCode session";
        await notify("OpenCode: Task complete", sessionTitle);
      }

      // Permission prompt created
      if (event.type === "permission.asked") {
        const sessionID = sessionIDFromEvent(event);
        const session = await getSession(sessionID);
        const sessionTitle =
          typeof session.title === "string"
            ? session.title
            : "OpenCode session";
        const permission = event.properties?.permission;
        const detail =
          typeof permission === "string"
            ? `${sessionTitle} needs permission: ${permission}`
            : `${sessionTitle} needs permission`;
        await notify("OpenCode: Permission required", detail);
      }
    },
  };
}) satisfies Plugin;

export default NotificationPlugin;
