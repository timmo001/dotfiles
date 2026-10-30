import { Effect } from "effect";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import type { CheckResult } from "../types.js";

/** Check Hex is installed for the dictation bindings and Hyprland autostart. */
export const checkHex = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const exit = yield* executor.exitCode("which", ["hex"]);

  const result: CheckResult =
    exit === 0
      ? { severity: "ok", message: "Hex is installed (voice dictation)" }
      : {
          severity: "warn",
          message:
            "Hex is missing (Alt+Space and F9 dictation, Hyprland autostart)",
          detail:
            "Run: curl -fsSL https://anoma.ly/hex/files/install-linux.sh | sh && ~/.local/bin/hex model install",
        };

  return [result];
});
