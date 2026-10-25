import { Effect, Match } from "effect";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { GitHub, viewerLogin } from "../../git/services/GitHub.js";
import { githubWorkflowScope } from "../../lib/githubWorkflowScope.js";
import type { CheckResult } from "../types.js";

interface ToolDef {
  readonly name: string;
  readonly purpose: string;
  readonly required: boolean;
}

const TOOLS: readonly ToolDef[] = [
  { name: "git", purpose: "repo sync/diff", required: true },
  { name: "stow", purpose: "dotfile linking", required: true },
  { name: "bash", purpose: "dot runtime", required: true },
  {
    name: "mise",
    purpose: "managed Bun, Node, pnpm, and language tool versions",
    required: false,
  },
  {
    name: "gh",
    purpose: "GitHub notifications",
    required: false,
  },
];

/** Check that required and optional CLI tools are available */
export const checkDependencies = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const github = yield* GitHub;
  const results: CheckResult[] = [];

  for (const tool of TOOLS) {
    const exit = yield* executor.exitCode("which", [tool.name]);

    if (exit === 0) {
      results.push({
        severity: "ok",
        message: `${tool.name} is available (${tool.purpose})`,
      });
    } else if (tool.required) {
      results.push({
        severity: "error",
        message: `${tool.name} is missing (${tool.purpose})`,
      });
    } else {
      results.push({
        severity: "warn",
        message: `${tool.name} is missing (${tool.purpose})`,
      });
    }
  }

  // gh authentication check
  const ghAvailable = yield* github.isAvailable;

  if (ghAvailable) {
    const username = yield* github
      .read("user", viewerLogin)
      .pipe(Effect.orElseSucceed(() => ""));

    if (username) {
      results.push({
        severity: "ok",
        message: `gh authentication is active (${username})`,
      });

      const scope = yield* githubWorkflowScope().pipe(
        Effect.orElseSucceed(() => "unavailable" as const),
      );

      results.push(
        scope === "granted"
          ? {
              severity: "ok",
              message:
                "GitHub workflow scope is available (dependency workflow updates)",
            }
          : {
              severity: "warn",
              message:
                scope === "missing"
                  ? "GitHub workflow scope is missing (dependency workflow updates cannot be pushed)"
                  : "Could not verify GitHub workflow scope",
              detail: Match.value(scope).pipe(
                Match.when(
                  "missing",
                  () =>
                    "Run: gh auth refresh --hostname github.com --scopes workflow",
                ),
                Match.when(
                  "unknown",
                  () =>
                    "This token does not expose OAuth scopes; check that it has Workflows write permission for the target repository",
                ),
                Match.orElse(
                  () => "Check GitHub API access, then rerun dot doctor",
                ),
              ),
            },
      );
    } else {
      results.push({
        severity: "warn",
        message:
          "gh is installed but not authenticated (branch discovery may be rate-limited)",
      });
    }
  }

  return results;
});
