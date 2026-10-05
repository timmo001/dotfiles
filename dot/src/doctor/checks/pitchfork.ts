import { Effect } from "effect";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import type { CheckResult } from "../types.js";

/** Verify the pitchfork proxy still works, since its iptables redirect is lost on reboot. */
export const checkPitchforkProxy = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  if ((yield* executor.exitCode("which", ["pitchfork"])) !== 0) {
    return [
      { severity: "ok", message: "pitchfork is not installed, skipping" },
    ] satisfies CheckResult[];
  }

  if ((yield* executor.exitCode("pitchfork", ["proxy", "doctor"])) === 0) {
    return [
      { severity: "ok", message: "pitchfork proxy is healthy" },
    ] satisfies CheckResult[];
  }

  return [
    {
      severity: "warn",
      message: "pitchfork proxy doctor reports problems",
      detail:
        "Run `pitchfork proxy setup`, then `pitchfork supervisor start --force`",
    },
  ] satisfies CheckResult[];
});
