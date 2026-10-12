import { Effect } from "effect";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { Config } from "../../services/Config.js";
import type { CheckResult } from "../types.js";

const BROWSER_DESKTOP = "link-browser.desktop";

const LINK_TYPES = ["x-scheme-handler/http", "x-scheme-handler/https"];

/** Check links reach `dot link open` when dot-git.yml routes them. */
export const checkDefaultBrowser = Effect.gen(function* () {
  const { gitConfig } = yield* Config;
  const executor = yield* CommandExecutor;

  if (!gitConfig.links)
    return [
      { severity: "ok", message: "Link routing is not configured" },
    ] satisfies CheckResult[];

  const handlers = yield* Effect.forEach(LINK_TYPES, (type) =>
    executor.run("xdg-mime", ["query", "default", type]).pipe(
      Effect.map((output) => output.trim()),
      Effect.orElseSucceed(() => ""),
    ),
  );

  const other = handlers.find((handler) => handler !== BROWSER_DESKTOP);

  return [
    other === undefined
      ? { severity: "ok", message: "Links open through dot link open" }
      : {
          severity: "warn",
          message: `Default browser is ${other || "unset"}, so links skip dot link open`,
          detail: `Run: xdg-mime default ${BROWSER_DESKTOP} ${LINK_TYPES.join(" ")}`,
        },
  ] satisfies CheckResult[];
});
