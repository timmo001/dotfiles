import { Effect } from "effect";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { Config } from "../../services/Config.js";
import type { CheckResult } from "../types.js";

const BROWSER_DESKTOP = "link-browser.desktop";

const OMARCHY_BROWSER_DESKTOP = "omarchy-browser.desktop";

const LINK_TYPES = ["x-scheme-handler/http", "x-scheme-handler/https"];

/** Check links reach `dot link open` when dot-git.yml routes them. */
export const checkDefaultBrowser = Effect.gen(function* () {
  const { gitConfig } = yield* Config;
  const executor = yield* CommandExecutor;

  if (!gitConfig.links)
    return [
      { severity: "ok", message: "Link routing is not configured" },
    ] satisfies CheckResult[];

  const query = (command: string, args: ReadonlyArray<string>) =>
    executor.run(command, args).pipe(
      Effect.map((output) => output.trim()),
      Effect.orElseSucceed(() => ""),
    );

  const handlers = yield* Effect.forEach(LINK_TYPES, (type) =>
    query("xdg-mime", ["query", "default", type]),
  );

  // Omarchy's Hyprland list sends links to omarchy-browser.desktop, which hands
  // them on to the default browser it resolves from the lists after it.
  const omarchyBrowser = handlers.includes(OMARCHY_BROWSER_DESKTOP)
    ? yield* query("omarchy-cmd-default-browser", [])
    : "";

  const other = handlers
    .map((handler) =>
      handler === OMARCHY_BROWSER_DESKTOP ? omarchyBrowser : handler,
    )
    .find((handler) => handler !== BROWSER_DESKTOP);

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
