import { Effect } from "effect";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import type { CheckResult } from "../types.js";

const INSTALL_HERDR_COMMAND = "mise install herdr";
const INSTALL_OPENCODE_INTEGRATION_COMMAND =
  "herdr integration install opencode";

/** Verify Herdr and its OpenCode integration are installed. */
export const checkHerdr = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  if ((yield* executor.exitCode("which", ["herdr"])) !== 0) {
    return [
      {
        severity: "warn",
        message: "Herdr is missing",
        detail: `Run ${INSTALL_HERDR_COMMAND}`,
      },
    ] satisfies CheckResult[];
  }

  const status = yield* executor
    .run("herdr", ["integration", "status"])
    .pipe(Effect.catch(() => Effect.succeed("")));
  const opencodeStatus = status
    .split("\n")
    .find((line) => line.startsWith("opencode:"));

  if (opencodeStatus?.includes("current")) {
    return [
      {
        severity: "ok",
        message: "Herdr OpenCode integration is installed",
      },
    ] satisfies CheckResult[];
  }

  return [
    {
      severity: "warn",
      message: "Herdr OpenCode integration is missing",
      detail: `Run ${INSTALL_OPENCODE_INTEGRATION_COMMAND}`,
    },
  ] satisfies CheckResult[];
});
