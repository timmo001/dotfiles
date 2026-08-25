import { Plugin } from "@opencode-ai/plugin/effect";
import { Effect, Result } from "effect";
import { $ } from "bun";
import {
  isEmptyStackContext,
  parseStackContextJSON,
  renderStackContext,
} from "../lib/stack-context-render.ts";

type JsonRecord = Record<string, unknown>;
interface StackRenderer {
  isEmptyStackContext(data: JsonRecord): boolean;
  parseStackContextJSON(text: string): JsonRecord | null;
  renderStackContext(data: JsonRecord): string;
}

const defaultRenderer: StackRenderer = {
  isEmptyStackContext,
  parseStackContextJSON,
  renderStackContext,
};

const TARGET_COMMANDS = new Set(["inject-stack", "inject-context"]);
const MARKER = /<stack-context-command>([^<]+)<\/stack-context-command>/;
const parseWarning =
  "<stack-context><warnings>StackContextPlugin could not parse the `context stack --json` output.</warnings></stack-context>";

export const stackContextFromOutput = (
  output: string,
  explicit: boolean,
  renderer: StackRenderer = defaultRenderer,
): string | undefined => {
  const data = renderer.parseStackContextJSON(output.trim());
  if (!data) return explicit ? parseWarning : undefined;
  if (!explicit && renderer.isEmptyStackContext(data)) return;
  return renderer.renderStackContext(data);
};

export default Plugin.define({
  id: "stack-context",
  effect: (context) =>
    Effect.gen(function* () {
      const injectedSessions = new Set<string>();
      yield* context.command.transform((commands) => {
        for (const name of TARGET_COMMANDS) {
          commands.update(name, (command) => {
            command.template = `<stack-context-command>${name}</stack-context-command>\n\n${command.template}`;
          });
        }
      });
      yield* context.session.hook("context", (event) =>
        Effect.gen(function* () {
          const command = event.messages
            .findLast((message) => message.role === "user")
            ?.content.filter((part) => part.type === "text")
            .map((part) => part.text)
            .join("\n")
            .match(MARKER)?.[1];
          if (injectedSessions.has(event.sessionID) && !command) return;
          const session = yield* context.session
            .get({ sessionID: event.sessionID })
            .pipe(Effect.result);
          if (Result.isFailure(session)) {
            if (command) {
              event.system.unshift({
                type: "text",
                text: "<stack-context><warnings>StackContextPlugin could not resolve the session location.</warnings></stack-context>",
              });
            }
            return;
          }
          const rootResult = yield* Effect.tryPromise({
            try: () =>
              $`git rev-parse --show-toplevel`
                .cwd(session.success.location.directory)
                .text(),
            catch: (error) => error,
          }).pipe(Effect.result);
          if (Result.isFailure(rootResult)) return;
          const root = String(rootResult.success).trim();
          const stackResult = yield* Effect.tryPromise({
            try: () =>
              $`context stack ${root} --json`
                .cwd(session.success.location.directory)
                .text(),
            catch: (error) => error,
          }).pipe(Effect.result);
          if (Result.isFailure(stackResult)) {
            if (command)
              event.system.unshift({
                type: "text",
                text: "<stack-context><warnings>StackContextPlugin could not collect stack context.</warnings></stack-context>",
              });
            return;
          }
          const text = stackContextFromOutput(
            String(stackResult.success),
            Boolean(command),
          );
          if (!text) return;
          event.system.unshift({ type: "text", text });
          injectedSessions.add(event.sessionID);
        }),
      );
    }),
});
