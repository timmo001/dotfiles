import { ContextLayer, gitContext, stackContext } from "@timmo001/effect-context";
import { Effect, Layer, Schema } from "effect";
import { resolve } from "node:path";
import { type ClientNamespace, clientTools, commandExists } from "./tool";

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
    description: "Directory to inspect, relative to the session's directory (default: the session's directory)",
  }),
});

const tool = clientTools(Layer.empty);

/** Git branch and tech-stack context, run in-process through @timmo001/effect-context. */
export const contextNamespace: ClientNamespace = {
  kind: "client",
  command: "context",
  description:
    "Branch context and tech-stack detection through @timmo001/effect-context, in-process, for the session's directory.",
  available: commandExists("git"),
  tools: [
    tool({
      name: "git",
      description:
        "Branch context for the session's repository: branch and base, HEAD, ahead/behind, pull request, working-tree status, branch work scope and recent commits.",
      access: "read",
      pinned: true,
      input: GitInput,
      run: (input, { directory }) =>
        gitContext({
          cwd: directory,
          comments: input.comments ?? false,
          reviews: input.reviews ?? false,
          labels: input.labels ?? false,
          checks: input.checks ?? false,
          description: !(input.noDescription ?? false),
          pullRequest: !(input.noPr ?? false),
          remoteDetails: input.remotes ?? false,
          branchMetadata: !(input.noBranchMetadata ?? false),
          status: !(input.noStatus ?? false),
          workScope: !(input.noWorkScope ?? false),
          since: input.since,
        }).pipe(Effect.provide(ContextLayer.make({ cwd: directory }))),
    }),
    tool({
      name: "stack",
      description:
        "Deterministic tech-stack summary for a directory: languages, ecosystems, tooling and frameworks.",
      access: "read",
      input: StackInput,
      run: (input, { directory }) =>
        stackContext({ root: resolve(directory, input.dir ?? ".") }).pipe(
          Effect.provide(ContextLayer.make({ cwd: directory })),
        ),
    }),
  ],
};
