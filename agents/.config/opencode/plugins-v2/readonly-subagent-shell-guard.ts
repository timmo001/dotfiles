import { Plugin } from "@opencode-ai/plugin/effect";
import { Tool } from "@opencode-ai/schema/tool";
import { Effect } from "effect";
import { argRecord, stringArg } from "../lib/guard-paths";

const GUARDED_AGENTS = new Set(["general-readonly", "researcher", "researcher-readonly"]);

const unsafeReason = (command: string) => {
  if (/\r|\n/.test(command)) return "multi-line shell commands are not permitted";
  if (/\$\(|`/.test(command)) return "command substitution is not permitted";
  if (/&&/.test(command)) return "command chaining is not permitted";
  if (/[<>|;]/.test(command)) return "redirection, pipes, and command chaining are not permitted";
  if (/(^|[^&])&($|[^&])/.test(command)) return "background shell jobs are not permitted";
  if (/(?:^|\s)--(?:out|output)(?:=|\s|$)/.test(command)) return "output flags are not permitted";
};

export default Plugin.define({
  id: "readonly-subagent-shell-guard",
  effect: (context) =>
    Effect.gen(function* () {
      yield* context.tool.hook("execute.before", (event) => {
        if ((event.tool !== "shell" && event.tool !== "bash") || !GUARDED_AGENTS.has(event.agent)) {
          return Effect.void;
        }
        const reason = unsafeReason(stringArg(argRecord(event.input).command));
        return reason
          ? Effect.fail(new Tool.Error({ message: `${event.agent} shell rejected: ${reason}` }))
          : Effect.void;
      });
    }),
});
