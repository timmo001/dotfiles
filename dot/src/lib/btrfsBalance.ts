/**
 * @file The monthly light btrfs balance: a root-owned timer that compacts
 * mostly empty data chunks on /, so their space returns to the unallocated
 * pool. Without it, deletes leave free space scattered inside data chunks,
 * unallocated runs out, metadata can't grow, and writes fail with "no space
 * left" while df still shows plenty free. Alongside it, a reading of how much
 * of / is unallocated, for dot doctor.
 */

import { Effect, FileSystem, Option } from "effect";
import { join } from "path";
import { query } from "./boundedQuery.js";
import { runElevated } from "./elevatedCommand.js";
import { Config } from "../services/Config.js";

/** The service that runs the balance. */
const SERVICE = "dot-btrfs-balance.service";

/** The timer that starts it monthly. */
const TIMER = "dot-btrfs-balance.timer";

/** Where the service is installed. */
const ROOT_SERVICE = `/etc/systemd/system/${SERVICE}`;

/** Where the timer is installed. */
const ROOT_TIMER = `/etc/systemd/system/${TIMER}`;

/** Seconds a systemctl or btrfs query may take. */
const QUERY_TIMEOUT = 10;

/** A file in the public dotfiles' btrfs-balance folder. */
const balanceSource = (publicDotfiles: string, name: string) =>
  join(publicDotfiles, "btrfs-balance", name);

/** Whether / is a btrfs filesystem. */
export const rootIsBtrfs = Effect.fn("BtrfsBalance.rootIsBtrfs")(function* () {
  const fs = yield* FileSystem.FileSystem;

  const mounts = yield* fs
    .readFileString("/proc/self/mounts")
    .pipe(Effect.orElseSucceed(() => ""));

  // The last mount on / is the one in effect.
  const root = mounts
    .split("\n")
    .map((line) => line.split(" "))
    .filter((fields) => fields[1] === "/")
    .at(-1);

  return root?.[2] === "btrfs";
});

/**
 * Whether the installed service and timer match the dotfiles, and the timer
 * is enabled and active.
 */
export const btrfsBalanceCurrent = Effect.fn("BtrfsBalance.current")(
  function* () {
    const fs = yield* FileSystem.FileSystem;
    const config = yield* Config;

    const matches = (name: string, installed: string) =>
      Effect.all([
        fs.readFileString(balanceSource(config.publicDotfiles, name)),
        fs.readFileString(installed),
      ]).pipe(
        Effect.map(([left, right]) => left === right),
        Effect.orElseSucceed(() => false),
      );

    const same = yield* Effect.all([
      matches(SERVICE, ROOT_SERVICE),
      matches(TIMER, ROOT_TIMER),
    ]);

    if (!same.every(Boolean)) return false;

    const [enabled, active] = yield* Effect.all([
      query("systemctl", ["is-enabled", "--quiet", TIMER], QUERY_TIMEOUT),
      query("systemctl", ["is-active", "--quiet", TIMER], QUERY_TIMEOUT),
    ]);

    return enabled.code === 0 && active.code === 0;
  },
);

/**
 * Install the service and timer root-owned and enable the timer, on machines
 * whose root is btrfs. Runs when either file differs from the dotfiles or the
 * timer isn't running. Returns whether it changed, or null when the install
 * failed.
 */
export const syncRootBtrfsBalance = Effect.fn("BtrfsBalance.syncRoot")(
  function* () {
    const config = yield* Config;

    if (!(yield* rootIsBtrfs())) return false;

    if (yield* btrfsBalanceCurrent()) return false;

    const exitCode = yield* runElevated("sh", [
      "-c",
      `set -e
install -Dm644 "$1" ${ROOT_SERVICE}
install -Dm644 "$2" ${ROOT_TIMER}
systemctl daemon-reload
systemctl enable --now ${TIMER}`,
      "sh",
      balanceSource(config.publicDotfiles, SERVICE),
      balanceSource(config.publicDotfiles, TIMER),
    ]);

    return exitCode === 0 ? true : null;
  },
);

/**
 * Bytes of the root btrfs filesystem not allocated to any chunk, or none when
 * it can't be read. Needs no root: btrfs prints the overall figures without
 * it and only warns that the per-device breakdown is missing.
 */
export const btrfsUnallocatedBytes = Effect.fn("BtrfsBalance.unallocated")(
  function* () {
    const result = yield* query(
      "btrfs",
      ["filesystem", "usage", "-b", "/"],
      QUERY_TIMEOUT,
    );

    const match = /Device unallocated:\s+(\d+)/.exec(result.stdout);

    return match ? Option.some(Number(match[1])) : Option.none<number>();
  },
);
