/**
 * @file Rejects question tool calls that are not preceded by findings in chat.
 */

import { Plugin } from "@opencode/plugin/effect";
import { Tool } from "@opencode/schema/tool";
import type { SessionMessage } from "@opencode/schema/session-message";
import { Effect } from "effect";

const MIN_WORDS = 20;

const turnText = (messages: ReadonlyArray<SessionMessage.Info>) => {
  const lastUser = messages.findLastIndex((message) => message.type === "user");

  return messages
    .slice(lastUser + 1)
    .flatMap((message) => (message.type === "assistant" ? message.content : []))
    .flatMap((content) => (content.type === "text" ? [content.text] : []))
    .join(" ");
};

const wordCount = (text: string) => text.split(/\s+/).filter(Boolean).length;

export default Plugin.define({
  id: "question-presentation-guard",
  effect: (context) =>
    Effect.gen(function* () {
      yield* context.tool.hook("execute.before", (event) =>
        Effect.gen(function* () {
          if (event.tool !== "question") return;

          const messages = yield* context.session
            .context({ sessionID: event.sessionID })
            .pipe(Effect.catch(() => Effect.succeed(null)));

          if (!messages) return;

          const words = wordCount(turnText(messages));

          if (words >= MIN_WORDS) return;

          return yield* Effect.fail(
            new Tool.Error({
              message:
                `Question rejected: only ${words} words of chat precede it this turn. ` +
                "Reasoning is not shown as chat, and the question tool shows the user labels only. " +
                "First answer any question the user asked, then write a short chat explainer of the findings " +
                "the choice depends on, what each option means and your recommendation. " +
                "Then call the question tool again.",
            }),
          );
        }),
      );
    }),
});
