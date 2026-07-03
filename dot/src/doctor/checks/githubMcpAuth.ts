import { Effect } from "effect";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import type { CheckResult } from "../types.js";

/**
 * Check that a GitHub MCP bearer can be sourced from gh. The public `.zshrc`
 * export `DOT_GH_MCP_BEARER="$(gh auth token)"` feeds the read-only GitHub MCP
 * server used by OpenCode and Cursor, so a logged-out gh leaves it empty and the
 * server returns 401. Uses `exitCode` (stdout ignored) so the token value is
 * never captured into the saved doctor report.
 */
export const checkGithubMcpAuth = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const results: CheckResult[] = [];

  if ((yield* executor.exitCode("which", ["gh"])) !== 0) {
    results.push({
      severity: "warn",
      message:
        "gh is missing; GitHub MCP bearer (DOT_GH_MCP_BEARER) cannot be sourced",
      detail: "Install gh and run: gh auth login",
    });
    return results;
  }

  if ((yield* executor.exitCode("gh", ["auth", "token"])) === 0) {
    results.push({
      severity: "ok",
      message:
        "GitHub MCP bearer available (gh auth token feeds DOT_GH_MCP_BEARER)",
    });
  } else {
    results.push({
      severity: "warn",
      message:
        "gh has no token; the GitHub MCP server will fail to authenticate",
      detail: "Run: gh auth login",
    });
  }

  return results;
});
