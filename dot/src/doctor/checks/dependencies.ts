import { Effect } from "effect";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { GitHub } from "../../git/services/GitHub.js";
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
    name: "omarchy-pkg-add",
    purpose: "dot setup installs stow when missing",
    required: false,
  },
  {
    name: "omarchy-pkg-aur-add",
    purpose: "dot init installs missing AUR packages",
    required: false,
  },
  {
    name: "yay",
    purpose: "used by omarchy-pkg-aur-add and AUR version checks",
    required: false,
  },
  {
    name: "gh",
    purpose: "branch discovery + authenticated clone convenience",
    required: false,
  },
  { name: "gum", purpose: "interactive init questionnaire", required: false },
  {
    name: "notify-send",
    purpose: "desktop workflow notifications",
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

  // wpctl is informational only
  const wpctlExit = yield* executor.exitCode("which", ["wpctl"]);
  results.push({
    severity: "ok",
    message:
      wpctlExit === 0
        ? "wpctl is available (optional daily 5am volume reset on PipeWire/WirePlumber)"
        : "wpctl is missing (optional daily 5am volume reset on PipeWire/WirePlumber)",
  });

  // gh authentication check
  const ghAvailable = yield* github.isAvailable();
  if (ghAvailable) {
    const ghUser = yield* github
      .api("user", { jq: ".login" })
      .pipe(Effect.catch(() => Effect.succeed("")));
    const username = ghUser.trim();
    if (username) {
      results.push({
        severity: "ok",
        message: `gh authentication is active (${username})`,
      });
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
