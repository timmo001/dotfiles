import { Plugin } from "@opencode-ai/plugin/effect";
import { Effect, Result } from "effect";
import { $ } from "bun";
import {
  parseBranchContextJSON,
  renderBranchContext,
} from "../lib/branch-context-render.ts";

const BRANCH_COMMANDS = new Set([
  "inject-context",
  "refactor-current-work",
  "reset-branch-reapply",
  "code-review",
]);
const WORK_SCOPE_COMMANDS = new Set([
  "refactor-cleanup-variables",
  "refactor-remove-single-use",
  "refactor-enforce-types",
  "all-lit-skills",
  "all-ts-skills",
  "timmo001-private/deslopify",
  "home-assistant/all-frontend-skills",
  "home-assistant/lazy-context",
  "home-assistant/list-components",
  "home-assistant/lit-rendering",
]);
const TARGET_COMMANDS = new Set([...BRANCH_COMMANDS, ...WORK_SCOPE_COMMANDS]);
const MARKER = /<branch-context-command>([^<]+)<\/branch-context-command>/;
const INJECT_CONTEXT_PROMPT =
  "Branch context and codebase stack context have been injected above.";
const escapeXml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

export default Plugin.define({
  id: "branch-context",
  effect: (context) =>
    Effect.gen(function* () {
      yield* context.command.transform((commands) => {
        for (const name of TARGET_COMMANDS) {
          commands.add({
            name,
            execute: (input) =>
              context.session.prompt({
                sessionID: input.sessionID,
                text: `<branch-context-command>${name}</branch-context-command>\n\n${input.prompt.text}`,
                files: input.prompt.files,
                agents: input.prompt.agents,
                skills: input.prompt.skills,
                delivery: input.delivery,
              }).pipe(Effect.asVoid),
          });
        }
      });
      yield* context.session.hook("context", (event) =>
        Effect.gen(function* () {
          const messageText = event.messages
            .findLast((message) => message.role === "user")
            ?.content.filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n");
          const command =
            messageText?.match(MARKER)?.[1] ??
            (messageText?.includes(INJECT_CONTEXT_PROMPT)
              ? "inject-context"
              : undefined);
          if (!command || !TARGET_COMMANDS.has(command)) return;
          const session = yield* context.session
            .get({ sessionID: event.sessionID })
            .pipe(Effect.result);
          if (Result.isFailure(session)) {
            event.system.unshift({
              type: "text",
              text: `<branch-context><warnings>BranchContextPlugin could not resolve the session location: ${escapeXml(String(session.failure))}</warnings></branch-context>`,
            });
            return;
          }
          const includePullRequest = BRANCH_COMMANDS.has(command);
          const args = includePullRequest
            ? [
                "git",
                "--json",
                "--labels",
                "--comments",
                "--reviews",
                "--checks",
              ]
            : ["git", "--json", "--no-pr"];
          const result = yield* Effect.tryPromise({
            try: () =>
              $`context ${args}`.cwd(session.success.location.directory).text(),
            catch: (error) => error,
          }).pipe(Effect.result);
          let text: string;
          if (Result.isFailure(result)) {
            text = `<branch-context><warnings>BranchContextPlugin could not collect git context: ${escapeXml(String(result.failure))}</warnings></branch-context>`;
          } else {
            const data = parseBranchContextJSON(String(result.success).trim());
            text = data
              ? renderBranchContext(data, includePullRequest)
              : "<branch-context><warnings>BranchContextPlugin could not parse context git output.</warnings></branch-context>";
          }
          event.system.unshift({ type: "text", text });
        }),
      );
    }),
});
