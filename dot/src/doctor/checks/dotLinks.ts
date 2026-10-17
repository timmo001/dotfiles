import { Effect } from "effect";
import {
  dotLinksHostManifest,
  dotLinksHostManifestPath,
} from "../../lib/dotLinksExtension.js";
import { readTextOrNull } from "../../lib/fsProbe.js";
import { displayPath } from "../../lib/paths.js";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { Config } from "../../services/Config.js";
import type { CheckResult } from "../types.js";

const DOT_LINK_DESKTOP = "dot-link.desktop";

const DOT_LINK_TYPE = "x-scheme-handler/dot";

/** Check `dot://` links reach `dot link open`, and the dot links extension can reach `dot`. */
export const checkDotLinks = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const config = yield* Config;

  const handler = yield* executor
    .run("xdg-mime", ["query", "default", DOT_LINK_TYPE])
    .pipe(
      Effect.map((output) => output.trim()),
      Effect.orElseSucceed(() => ""),
    );

  const results: CheckResult[] = [
    handler === DOT_LINK_DESKTOP
      ? { severity: "ok", message: "dot:// links open through dot link open" }
      : {
          severity: "warn",
          message: `dot:// links are handled by ${handler || "nothing"}`,
          detail: `Run: xdg-mime default ${DOT_LINK_DESKTOP} ${DOT_LINK_TYPE}`,
        },
  ];

  for (const dir of config.gitConfig.links?.extension?.user_data_dirs ?? []) {
    const manifest = dotLinksHostManifestPath(dir);

    results.push(
      (yield* readTextOrNull(manifest)) === dotLinksHostManifest()
        ? {
            severity: "ok",
            message: `dot links extension host is set up in ${displayPath(dir)}`,
          }
        : {
            severity: "warn",
            message: `dot links extension host is missing or stale: ${displayPath(manifest)}`,
            detail: "Run: dot stow",
          },
    );
  }

  return results;
});
