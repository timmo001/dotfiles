import { Auth } from "@timmo001/effect-gh";
import { Effect, Option } from "effect";

/** Check the active github.com credential's workflow scope without reading its token. */
export const githubWorkflowScope = Effect.fn("GitHub.workflowScope")(
  function* () {
    const scopes = yield* Auth.scopes("github.com", { timeout: 30000 });

    // Fine-grained and installation tokens do not expose classic OAuth scopes.
    if (Option.isNone(scopes)) return "unknown" as const;

    return scopes.value.includes("workflow")
      ? ("granted" as const)
      : ("missing" as const);
  },
);
