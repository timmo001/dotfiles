/**
 * @file The LAN-direct unit: a root-owned oneshot that adds a routing rule
 * ahead of Tailscale's, so a machine reaches the networks it's directly on
 * directly instead of through a subnet router that advertises the same range.
 * Alongside it, a systemd-resolved drop-in resolves .local names over mDNS, so
 * programs that skip NSS find LAN machines by name too.
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

/** The systemd-resolved drop-in that resolves .local names over mDNS. */
const MDNS_CONF = "30-dot-mdns-resolve.conf";

/** Where the drop-in is installed. */
const ROOT_MDNS_CONF = `/etc/systemd/resolved.conf.d/${MDNS_CONF}`;

/** Seconds a systemctl query may take. */
const QUERY_TIMEOUT = 10;

/** A file in the public dotfiles' lan-direct folder. */
const lanDirectSource = (publicDotfiles: string, name: string) =>
  join(publicDotfiles, "lan-direct", name);

/**
 * Whether the installed unit and resolved drop-in match the dotfiles, and the
 * unit is enabled and active.
 */
export const lanDirectCurrent = Effect.fn("LanDirect.current")(function* () {
  const fs = yield* FileSystem.FileSystem;
  const config = yield* Config;

  const matches = (name: string, installed: string) =>
    Effect.all([
      fs.readFileString(lanDirectSource(config.publicDotfiles, name)),
      fs.readFileString(installed),
    ]).pipe(
      Effect.map(([left, right]) => left === right),
      Effect.orElseSucceed(() => false),
    );

  const same = yield* Effect.all([
    matches(UNIT, ROOT_UNIT),
    matches(MDNS_CONF, ROOT_MDNS_CONF),
  ]);

  if (!same.every(Boolean)) return false;

  const [enabled, active] = yield* Effect.all([
    query("systemctl", ["is-enabled", "--quiet", UNIT], QUERY_TIMEOUT),
    query("systemctl", ["is-active", "--quiet", UNIT], QUERY_TIMEOUT),
  ]);

  return enabled.code === 0 && active.code === 0;
});

/**
 * Install the unit and resolved drop-in root-owned, then enable and restart
 * the unit so its rules apply now, and restart systemd-resolved when the
 * drop-in changed. Runs when either differs from the dotfiles or the unit
 * isn't running. Returns whether it changed, or null when the install failed.
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
systemctl restart ${UNIT}
if ! cmp -s "$2" ${ROOT_MDNS_CONF}; then
  install -Dm644 "$2" ${ROOT_MDNS_CONF}
  systemctl restart systemd-resolved
fi`,
    "sh",
    lanDirectSource(config.publicDotfiles, UNIT),
    lanDirectSource(config.publicDotfiles, MDNS_CONF),
  ]);

  return exitCode === 0 ? true : null;
});
