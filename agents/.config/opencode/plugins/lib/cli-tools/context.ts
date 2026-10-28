import { Schema } from "effect";
import { type CliTool, defineCliTool, switchFlag, valueFlag } from "./tool";

const optionalBoolean = (description: string) =>
  Schema.optionalKey(Schema.Boolean).annotate({ description });

const GitInput = Schema.Struct({
  comments: optionalBoolean("Include pull request conversation comments"),
  reviews: optionalBoolean("Include individual pull request reviews"),
  labels: optionalBoolean("Include pull request labels"),
  checks: optionalBoolean("Include CI check runs (makes a second gh call)"),
  noDescription: optionalBoolean("Omit the pull request description"),
  noPr: optionalBoolean("Omit the pull request block entirely"),
  remotes: optionalBoolean("Include remote fetch and push URLs in branch metadata"),
  noBranchMetadata: optionalBoolean("Omit the branch metadata block"),
  noStatus: optionalBoolean("Omit the working-tree status block"),
  noWorkScope: optionalBoolean("Omit the branch work-scope block"),
  since: Schema.optionalKey(Schema.String).annotate({
    description: "Show recent commits since this date or relative duration, such as 2 days ago",
  }),
});

const StackInput = Schema.Struct({
  dir: Schema.optionalKey(Schema.String).annotate({
    description: "Directory to inspect (default: the session's directory)",
  }),
});

/** Context CLI commands exposed as Code Mode tools. */
export const contextTools: readonly CliTool[] = [
  defineCliTool({
    name: "git",
    description:
      "Branch context for the session's repository: branch and base, HEAD, ahead/behind, pull request, working-tree status, branch work scope and recent commits.",
    access: "read",
    pinned: true,
    json: true,
    input: GitInput,
    invocation: (input) => ({
      args: [
        "git",
        "--json",
        ...switchFlag("comments", input.comments),
        ...switchFlag("reviews", input.reviews),
        ...switchFlag("labels", input.labels),
        ...switchFlag("checks", input.checks),
        ...switchFlag("no-description", input.noDescription),
        ...switchFlag("no-pr", input.noPr),
        ...switchFlag("remotes", input.remotes),
        ...switchFlag("no-branch-metadata", input.noBranchMetadata),
        ...switchFlag("no-status", input.noStatus),
        ...switchFlag("no-work-scope", input.noWorkScope),
        ...valueFlag("since", input.since),
      ],
    }),
  }),
  defineCliTool({
    name: "stack",
    description:
      "Deterministic tech-stack summary for a directory: languages, ecosystems, tooling and frameworks.",
    access: "read",
    json: true,
    input: StackInput,
    invocation: (input) => ({
      args: ["stack", "--json", ...(input.dir === undefined ? [] : [input.dir])],
    }),
  }),
];
