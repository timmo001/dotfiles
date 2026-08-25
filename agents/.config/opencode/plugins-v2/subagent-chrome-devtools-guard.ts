import { Plugin } from "@opencode-ai/plugin/effect";
import { Tool } from "@opencode-ai/schema/tool";
import { Effect } from "effect";

const isChromeDevToolsTool = (tool: string) =>
  tool.startsWith("chrome-devtools_") || tool.startsWith("chrome_devtools_");

export default Plugin.define({
  id: "subagent-chrome-devtools-guard",
  effect: (context) =>
    Effect.gen(function* () {
      yield* context.tool.hook("execute.before", (event) => {
        if (!isChromeDevToolsTool(event.tool)) return Effect.void;
        return context.session.get({ sessionID: event.sessionID }).pipe(
          Effect.map((session) => Boolean(session.parentID)),
          Effect.catch(() => Effect.succeed(true)),
          Effect.flatMap((blocked) =>
            blocked
              ? Effect.fail(
                  new Tool.Error({
                    message:
                      "Chrome DevTools tools are only allowed from top-level sessions for browser/UI debugging.",
                  }),
                )
              : Effect.void,
          ),
        );
      });
    }),
});
