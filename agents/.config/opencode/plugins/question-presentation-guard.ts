/**
 * @file Rejects question tool calls that are not preceded by findings in chat.
 */

import { Plugin } from "@opencode/plugin/effect";
import { Tool } from "@opencode/schema/tool";
import type { SessionMessage } from "@opencode/schema/session-message";
import { Effect } from "effect";

const MIN_WORDS = 20;

// Only text from the same step counts, so progress notes written between earlier tool calls do not.
const stepText = (messages: ReadonlyArray<SessionMessage.Info>, callID: string) => {
  const last = messages.at(-1);

  const step =
    messages.find(
      (message) =>
        message.type === "assistant" &&
        message.content.some((part) => part.type === "tool" && part.id === callID),
    ) ?? last;

  if (step?.type !== "assistant") return "";

  const callIndex = step.content.findIndex((part) => part.type === "tool" && part.id === callID);

  return step.content
    .slice(0, callIndex === -1 ? undefined : callIndex)
    .flatMap((part) => (part.type === "text" ? [part.text] : []))
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

          const words = wordCount(stepText(messages, event.id));

          if (words >= MIN_WORDS) return;

          return yield* Effect.fail(
            new Tool.Error({
              message:
                `Question rejected: found ${words} words of chat text in this response before the question call; ${MIN_WORDS} are needed. ` +
                "Only chat text written in the same response as the question call counts. " +
                "Reasoning, tool input and progress notes from earlier steps do not, and the question tool shows the user labels only. " +
                "Do not end your turn instead. In one response, first answer any question the user asked, then write a short chat explainer " +
                "of the findings the choice depends on, what each option means and your recommendation, then call the question tool.",
            }),
          );
        }),
      );
    }),
});
