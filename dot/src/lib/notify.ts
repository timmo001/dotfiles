import { Effect } from "effect";
import { CommandExecutor } from "../services/CommandExecutor.js";

/** How urgent a {@link notify} message is. */
export type NotifyUrgency = "normal" | "critical";

/**
 * Notify on Station, which has no `omarchy notification send`. The message
 * always goes to the user journal under the `dot` tag (`journalctl --user -t
 * dot`), since Station is usually headless, and also shows through
 * `notify-send` when a Plasma or gaming session is running to show it. Never
 * fails: a notification is best effort.
 */
export const notify = Effect.fn("notify")(function* (
  title: string,
  body = "",
  urgency: NotifyUrgency = "normal",
) {
  const executor = yield* CommandExecutor;

  yield* executor.exitCode("systemd-cat", [
    "-t",
    "dot",
    "-p",
    urgency === "critical" ? "err" : "notice",
    "printf",
    "%s\\n",
    body ? `${title}: ${body.replace(/\s+/g, " ")}` : title,
  ]);

  yield* executor.exitCode(
    "notify-send",
    ["--app-name", "dot", "--urgency", urgency, title, ...(body ? [body] : [])],
    {
      env: {
        DBUS_SESSION_BUS_ADDRESS: `unix:path=/run/user/${process.getuid?.() ?? 1000}/bus`,
      },
    },
  );
});
