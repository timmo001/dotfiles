/**
 * @file The LAN-direct unit: a root-owned oneshot that adds a routing rule
 * ahead of Tailscale's, so a machine reaches the networks it's directly on
 * directly instead of through a subnet router that advertises the same range.
 */

import { Effect, FileSystem } from "effect";
import { join } from "path";
import { query } from "./boundedQuery.js";
import { runElevated } from "./elevatedCommand.js";
import { Config } from "../services/Config.js";

/** The unit's name. */
const UNIT = "dot-lan-direct.service";

/** Where the unit is installed. */
const ROOT_UNIT = `/etc/systemd/system/${UNIT}`;

/** Seconds a systemctl query may take. */
const QUERY_TIMEOUT = 10;

/** The unit in the public dotfiles. */
const lanDirectSource = (publicDotfiles: string) =>
  join(publicDotfiles, "lan-direct", UNIT);

/** Whether the installed unit matches the dotfiles and is enabled and active. */
export const lanDirectCurrent = Effect.fn("LanDirect.current")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const config = yield* Config;

  const same = yield* Effect.all([
    fs.readFileString(lanDirectSource(config.publicDotfiles)),
    fs.readFileString(ROOT_UNIT),
  ]).pipe(
    Effect.map(([left, right]) => left === right),
    Effect.orElseSucceed(() => false),
  );

  if (!same) return false;

  const [enabled, active] = yield* Effect.all([
    query("systemctl", ["is-enabled", "--quiet", UNIT], QUERY_TIMEOUT),
    query("systemctl", ["is-active", "--quiet", UNIT], QUERY_TIMEOUT),
  ]);

  return enabled.code === 0 && active.code === 0;
});

/**
 * Install the unit root-owned, then enable and restart it so its rules apply
 * now, when it differs from the dotfiles or isn't running. Returns whether it
 * changed, or null when the install failed.
 */
export const syncRootLanDirect = Effect.fn("LanDirect.syncRoot")(function* () {
  const config = yield* Config;

  if (yield* lanDirectCurrent()) return false;

  const exitCode = yield* runElevated("sh", [
    "-c",
    `set -e
install -Dm644 "$1" ${ROOT_UNIT}
systemctl daemon-reload
systemctl enable ${UNIT}
systemctl restart ${UNIT}`,
    "sh",
    lanDirectSource(config.publicDotfiles),
  ]);

  return exitCode === 0 ? true : null;
});
