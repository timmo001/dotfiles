import { Effect } from "effect";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { pathExists } from "../../lib/fsProbe.js";
import type { CheckResult } from "../types.js";

const FILE_MANAGER_DESKTOP = "thunar.desktop";

const NAUTILUS_FILE_MANAGER1_SERVICE =
  "/usr/share/dbus-1/services/org.freedesktop.FileManager1.service";

/** Check Thunar opens folders and owns org.freedesktop.FileManager1. */
export const checkFileManager = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const results: CheckResult[] = [];

  const defaultApp = yield* executor
    .run("xdg-mime", ["query", "default", "inode/directory"])
    .pipe(
      Effect.map((output) => output.trim()),
      Effect.orElseSucceed(() => ""),
    );

  results.push(
    defaultApp === FILE_MANAGER_DESKTOP
      ? { severity: "ok", message: "Thunar is the default folder app" }
      : {
          severity: "warn",
          message: `Default folder app is ${defaultApp || "unset"}, not Thunar`,
          detail: `Run: xdg-mime default ${FILE_MANAGER_DESKTOP} inode/directory`,
        },
  );

  results.push(
    (yield* pathExists(NAUTILUS_FILE_MANAGER1_SERVICE))
      ? {
          severity: "warn",
          message: "Nautilus FileManager1 D-Bus service is enabled",
          detail: `Install the nautilus-filemanager1.hook pacman hook (dot init), then run: pkexec rm -f ${NAUTILUS_FILE_MANAGER1_SERVICE}`,
        }
      : {
          severity: "ok",
          message: "Nautilus FileManager1 D-Bus service is disabled",
        },
  );

  return results;
});
