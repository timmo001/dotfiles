import { Effect } from "effect";
import { CommandExecutor } from "../services/CommandExecutor.js";

/** How urgent a {@link notify} message is. */
export type NotifyUrgency = "normal" | "critical";

/**
 * Record a notification in the user journal under the `dot` tag, where a
 * headless server keeps them (`journalctl --user -t dot`). Fails when
 * `systemd-cat` does.
 */
export const notify = Effect.fn("notify")(function* (
  title: string,
  body = "",
  urgency: NotifyUrgency = "normal",
) {
  const executor = yield* CommandExecutor;

  yield* executor.run("systemd-cat", [
    "-t",
    "dot",
    "-p",
    urgency === "critical" ? "err" : "warning",
    "printf",
    "%s\\n",
    body ? `${title}: ${body.replace(/\s+/g, " ")}` : title,
  ]);
});
