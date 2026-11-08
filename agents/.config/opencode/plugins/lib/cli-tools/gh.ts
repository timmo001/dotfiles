import { Schema } from "effect";
import { type CliNamespace, defineCliTool } from "./tool";

/**
 * gh commands that only run as detached jobs, since they wait far longer than a tool call should.
 * They are not tools of their own; `jobs.start` runs them as `gh.<name>`. The `gh` namespace
 * itself comes from effect-gh's OpenCode plugin.
 */
export const ghJobs: CliNamespace = {
  kind: "cli",
  command: "gh",
  description: "gh commands run as jobs.",
  tools: [
    defineCliTool({
      name: "run_watch",
      description: "Wait for an Actions run to finish, failing when it does not succeed.",
      access: "read",
      timeout: "3 hours",
      json: false,
      input: Schema.Struct({
        repo: Schema.optionalKey(Schema.String).annotate({ description: "OWNER/REPO (default: the session directory's repository)" }),
        runId: Schema.Int.annotate({ description: "The run's ID, from run_list" }),
      }),
      invocation: (input) => ({
        args: [
          "run",
          "watch",
          "--exit-status",
          "--compact",
          "--interval=30",
          ...(input.repo ? [`--repo=${input.repo}`] : []),
          "--",
          String(input.runId),
        ],
      }),
    }),
  ],
};
