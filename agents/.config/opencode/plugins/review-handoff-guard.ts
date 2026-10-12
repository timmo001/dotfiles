/**
 * @file Nudges a session that goes idle with edited files and no change-review-handoff.
 */

import { Plugin } from "@opencode/plugin/effect";
import { Effect, Option, Schema, Stream } from "effect";

/** Shared with `dot agent review hook` for Claude Code; keep them in step. */
const REVIEW_NUDGE =
  "You changed files in this turn but have not handed the change off for review. " +
  "Apply the change-review-handoff skill now. " +
  "If it does not apply (the user said not to review, they already reviewed this exact diff, " +
  "or the change is not finished because you are stopping to ask the user something), " +
  "say which in one line and end the turn.";

const EDIT_TOOLS = new Set(["edit", "write", "patch", "apply_patch"]);

// The input fields of the edit, skill and shell tools that matter here.
const ToolInput = Schema.Struct({
  path: Schema.optional(Schema.String),
  id: Schema.optional(Schema.String),
  command: Schema.optional(Schema.String),
});

const decodeToolInput = Schema.decodeUnknownOption(ToolInput);

const isEdit = (tool: string, { path }: typeof ToolInput.Type) =>
  EDIT_TOOLS.has(tool) && path?.startsWith("/tmp/") !== true;

const isHandoff = (tool: string, { id, command }: typeof ToolInput.Type) =>
  tool === "plannotator" ||
  tool === "plannotator_inbox" ||
  (tool === "skill" && id === "change-review-handoff") ||
  ((tool === "bash" || tool === "shell") && command !== undefined && /\bplannotator\b/.test(command));

export default Plugin.define({
  id: "review-handoff-guard",
  effect: (context) =>
    Effect.gen(function* () {
      // Sessions with edits not yet handed off, and whether they were already nudged.
      const pending = new Map<string, { nudged: boolean }>();

      yield* context.tool.hook("execute.after", (event) =>
        Effect.sync(() => {
          const input = Option.getOrElse(decodeToolInput(event.input), () => ({}));

          if (isEdit(event.tool, input)) pending.set(event.sessionID, { nudged: false });
          else if (isHandoff(event.tool, input)) pending.delete(event.sessionID);
        }),
      );

      yield* context.event.subscribe().pipe(
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            if (event.type !== "session.idle") return;

            const state = pending.get(event.data.sessionID);

            if (!state || state.nudged) return;

            const session = yield* context.session
              .get({ sessionID: event.data.sessionID })
              .pipe(Effect.catch(() => Effect.succeed(undefined)));

            // Subagents report to their parent, which owns the handoff.
            if (session?.parentID) return;

            state.nudged = true;

            yield* context.session
              .synthetic({ sessionID: event.data.sessionID, text: REVIEW_NUDGE, resume: true })
              .pipe(Effect.ignore);
          }),
        ),
        Effect.orDie,
        Effect.forkScoped,
      );
    }),
});
