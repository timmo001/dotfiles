import { Effect } from "effect";
import { join } from "path";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { pathExists } from "../../lib/fsProbe.js";
import { CONFIG_DIR, STATE_DIR, displayPath } from "../../lib/paths.js";
import type { CheckResult } from "../types.js";

interface RetiredApp {
  readonly name: string;
  readonly replacement: string;
  readonly packages: readonly string[];
  readonly units: readonly string[];
  readonly paths: readonly string[];
}

const RETIRED_APPS: readonly RetiredApp[] = [
  {
    name: "twitch-notifications",
    replacement: "upnext",
    packages: [
      "twitch-notifications",
      "twitch-notifications-bin",
      "twitch-notifications-git",
    ],
    units: [],
    paths: [
      join(CONFIG_DIR, "twitch-notifications"),
      join(STATE_DIR, "twitch-notifications"),
      join(CONFIG_DIR, "omarchy", "plugins", "timmo.twitch"),
    ],
  },
  {
    name: "plannotator tunnel",
    replacement: "the timmo tunnel",
    packages: [],
    units: ["dot-tunnel@plannotator.service"],
    paths: [
      join(CONFIG_DIR, "dot", "tunnels", "plannotator.token"),
      join(STATE_DIR, "dot", "tunnels", "plannotator"),
    ],
  },
];

const checkRetiredApp = Effect.fn("doctor.checkRetiredApp")(function* (
  app: RetiredApp,
) {
  const executor = yield* CommandExecutor;

  // pacman -Q also matches a package that provides the name, such as the
  // replacement, so only count an exact name.
  const packages = yield* Effect.filter(app.packages, (name) =>
    executor.run("pacman", ["-Qq", name]).pipe(
      Effect.map((installed) => installed.trim() === name),
      Effect.orElseSucceed(() => false),
    ),
  );

  const units = yield* Effect.filter(app.units, (unit) =>
    Effect.all(
      [
        executor.exitCode("systemctl", [
          "--user",
          "is-enabled",
          "--quiet",
          unit,
        ]),
        executor.exitCode("systemctl", [
          "--user",
          "is-active",
          "--quiet",
          unit,
        ]),
      ],
      { concurrency: "unbounded" },
    ).pipe(Effect.map((codes) => codes.includes(0))),
  );

  const paths = yield* Effect.filter(app.paths, (path) => pathExists(path));
  const results: CheckResult[] = [];

  if (packages.length > 0) {
    results.push({
      severity: "warn",
      message: `${app.name} is still installed (replaced by ${app.replacement})`,
      detail: `Remove it: pkexec pacman -Rns ${packages.join(" ")}`,
    });
  }

  if (units.length > 0) {
    results.push({
      severity: "warn",
      message: `${app.name} is still enabled or running (replaced by ${app.replacement})`,
      detail: `Disable it: systemctl --user disable --now ${units.join(" ")}`,
    });
  }

  if (paths.length > 0) {
    results.push({
      severity: "warn",
      message: `${app.name} files left behind (replaced by ${app.replacement})`,
      detail: `Remove them: rm -rf ${paths.map(displayPath).join(" ")}`,
    });
  }

  if (results.length > 0) return results;

  return [
    { severity: "ok", message: `${app.name} removed` },
  ] satisfies CheckResult[];
});

/** Flag apps that have been replaced but are still installed, enabled or left files behind. */
export const checkRetiredApps = Effect.forEach(RETIRED_APPS, checkRetiredApp, {
  concurrency: "unbounded",
}).pipe(Effect.map((results): CheckResult[] => results.flat()));
