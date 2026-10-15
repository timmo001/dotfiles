import { Effect } from "effect";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import type { CheckResult } from "../types.js";

const DOT_LINK_DESKTOP = "dot-link.desktop";

const DOT_LINK_TYPE = "x-scheme-handler/dot";

/** Check `dot://` links reach `dot link open`. */
export const checkDotLinks = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  const handler = yield* executor
    .run("xdg-mime", ["query", "default", DOT_LINK_TYPE])
    .pipe(
      Effect.map((output) => output.trim()),
      Effect.orElseSucceed(() => ""),
    );

  return [
    handler === DOT_LINK_DESKTOP
      ? { severity: "ok", message: "dot:// links open through dot link open" }
      : {
          severity: "warn",
          message: `dot:// links are handled by ${handler || "nothing"}`,
          detail: `Run: xdg-mime default ${DOT_LINK_DESKTOP} ${DOT_LINK_TYPE}`,
        },
  ] satisfies CheckResult[];
});
