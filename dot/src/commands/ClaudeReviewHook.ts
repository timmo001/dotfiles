/**
 * @file `dot agent review hook`: hold Claude Code to change-review-handoff.
 *
 * Runs as a Claude Code `Stop` hook. When the turn edited files and nothing
 * after the last edit opened a Plannotator review, loaded the
 * `change-review-handoff` skill or messaged the Plannotator Inbox, it blocks
 * the stop once and tells the agent to hand the change off. A second stop in
 * the same turn always goes through, so the agent can say why it skipped.
 * Any failure lets the stop through rather than blocking.
 */
import { Effect, Option, Schema } from "effect";
import { HOME_DIR } from "../lib/paths.js";
import { readTextOrNull } from "../lib/fsProbe.js";
import { isString } from "../lib/schema.js";

/** Shared with the OpenCode `review-handoff-guard` plugin; keep them in step. */
const REVIEW_NUDGE =
  "You changed files in this turn but have not handed the change off for review. " +
  "Apply the change-review-handoff skill now. " +
  "If it does not apply (the user said not to review, they already reviewed this exact diff, " +
  "or the change is not finished because you are stopping to ask the user something), " +
  "say which in one line and end the turn.";

const EDIT_TOOLS = new Set(["Edit", "MultiEdit", "Write", "NotebookEdit"]);

// Scratch files and Claude Code's own memory are not part of a changeset.
const IGNORED_ROOTS = ["/tmp/", `${HOME_DIR}/.claude/`];

const decodeHookInput = Schema.decodeUnknownOption(
  Schema.fromJsonString(
    Schema.Struct({
      transcript_path: Schema.String,
      stop_hook_active: Schema.optional(Schema.Boolean),
    }),
  ),
);

const ToolUse = Schema.Struct({
  type: Schema.String,
  name: Schema.optional(Schema.String),
  input: Schema.optional(Schema.Record(Schema.String, Schema.Json)),
});

const Entry = Schema.Struct({
  type: Schema.String,
  isMeta: Schema.optional(Schema.Boolean),
  message: Schema.optional(
    Schema.Struct({
      content: Schema.Union([Schema.String, Schema.Array(ToolUse)]),
    }),
  ),
});

const decodeEntry = Schema.decodeUnknownOption(Schema.fromJsonString(Entry));

/** A prompt the user typed, as opposed to tool results or injected skill text. */
const isUserPrompt = (entry: typeof Entry.Type) =>
  entry.type === "user" &&
  entry.isMeta !== true &&
  isString(entry.message?.content);

const toolUses = (entry: typeof Entry.Type) =>
  entry.type === "assistant" && Array.isArray(entry.message?.content)
    ? entry.message.content.filter((part) => part.type === "tool_use")
    : [];

const isEdit = ({ name, input }: typeof ToolUse.Type) => {
  const path = input?.["file_path"] ?? input?.["notebook_path"];

  return (
    name !== undefined &&
    EDIT_TOOLS.has(name) &&
    !(isString(path) && IGNORED_ROOTS.some((root) => path.startsWith(root)))
  );
};

const isHandoff = ({ name, input }: typeof ToolUse.Type) =>
  name?.startsWith("mcp__plannotator__") === true ||
  (name === "Skill" && input?.["skill"] === "change-review-handoff") ||
  (name === "Bash" &&
    isString(input?.["command"]) &&
    /\bplannotator\b/.test(input["command"]));

/** Read a `Stop` event from stdin and block the stop when a handoff is missing. */
export const claudeReviewHook = Effect.gen(function* () {
  const event = decodeHookInput(yield* Effect.promise(() => Bun.stdin.text()));

  if (Option.isNone(event) || event.value.stop_hook_active === true) return;

  const transcript = yield* readTextOrNull(event.value.transcript_path);

  if (transcript === null) return;

  const entries = transcript
    .split("\n")
    .flatMap((line) => Option.toArray(decodeEntry(line)));

  const tools = entries
    .slice(entries.findLastIndex(isUserPrompt) + 1)
    .flatMap(toolUses);

  const lastEdit = tools.findLastIndex(isEdit);

  if (lastEdit === -1 || tools.slice(lastEdit + 1).some(isHandoff)) return;

  yield* Effect.sync(() => {
    process.stdout.write(
      `${JSON.stringify({ decision: "block", reason: REVIEW_NUDGE })}\n`,
    );
  });
}).pipe(Effect.withSpan("ClaudeReviewHook"));
