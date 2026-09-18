import { Gh } from "@timmo001/effect-gh";
import { Effect } from "effect";

/** Check the active github.com credential's workflow scope without reading its token. */
export const githubWorkflowScope = Effect.fn("GitHub.workflowScope")(
  function* () {
    const gh = yield* Gh;

    const response = yield* gh.execute(
      [
        "api",
        "--hostname",
        "github.com",
        "--method",
        "HEAD",
        "--include",
        "user",
      ],
      { timeout: 30000 },
    );

    const scopes = /^x-oauth-scopes:[ \t]*([^\r\n]*)/im.exec(response.stdout);

    // Fine-grained and installation tokens do not expose classic OAuth scopes.
    if (!scopes) return "unknown" as const;

    return scopes[1].split(",").some((scope) => scope.trim() === "workflow")
      ? ("granted" as const)
      : ("missing" as const);
  },
);
