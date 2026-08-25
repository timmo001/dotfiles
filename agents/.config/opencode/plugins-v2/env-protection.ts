import { Plugin } from "@opencode-ai/plugin/effect";
import { Tool } from "@opencode-ai/schema/tool";
import { Effect } from "effect";
import { argRecord, stringArg, targetsProtectedEnv } from "../lib/guard-paths";

const ENV_COMMAND_PATTERN =
  /(?:^|[\s;&|()])(?:cat|cd|cp|env|grep|head|less|ls|more|mv|open|rg|rm|source|tail|test|vim|vi|nvim|\.|<|>|\[)\b|[<>]/;

const toolTargetsProtectedEnv = (
  tool: string,
  args: ReturnType<typeof argRecord>,
) => {
  if (tool === "read") return targetsProtectedEnv(stringArg(args.filePath) || stringArg(args.path));
  if (tool === "grep") return [args.path, args.include].some((value) => targetsProtectedEnv(stringArg(value)));
  if (tool === "glob") return [args.pattern, args.path].some((value) => targetsProtectedEnv(stringArg(value)));
  return false;
};

export default Plugin.define({
  id: "env-protection",
  effect: (context) =>
    Effect.gen(function* () {
      yield* context.tool.hook("execute.before", (event) => {
        const args = argRecord(event.input);
        const command = stringArg(args.command);
        const blocked =
          toolTargetsProtectedEnv(event.tool, args) ||
          ((event.tool === "shell" || event.tool === "bash") &&
            targetsProtectedEnv(command) &&
            ENV_COMMAND_PATTERN.test(command));
        return blocked
          ? Effect.fail(new Tool.Error({ message: "Do not read .env files" }))
          : Effect.void;
      });
    }),
});
