/**
 * @file Doctor check for btrfs on /: enough space should stay unallocated for
 * metadata to grow, and the monthly light balance that keeps it that way
 * should be installed, current and enabled. Machines whose root isn't btrfs
 * pass.
 */
import { Effect, Option } from "effect";
import {
  btrfsBalanceCurrent,
  btrfsUnallocatedBytes,
  rootIsBtrfs,
} from "../../lib/btrfsBalance.js";
import type { CheckResult } from "../types.js";

/** One GiB in bytes. */
const GIB = 1024 ** 3;

/** Below this much unallocated space, warn. */
const WARN_BELOW = 10 * GIB;

/** Below this much, writes are about to fail, so it's an error. */
const ERROR_BELOW = GIB;

/** Rate the unallocated space on /. */
const unallocatedResult = (bytes: Option.Option<number>): CheckResult =>
  Option.match(bytes, {
    onNone: () => ({
      severity: "warn",
      message: "Could not read the unallocated space on /",
      detail: "Check with btrfs filesystem usage /",
    }),
    onSome: (value) => {
      const gib = (value / GIB).toFixed(1);

      if (value >= WARN_BELOW)
        return { severity: "ok", message: `${gib} GiB of / is unallocated` };

      return {
        severity: value < ERROR_BELOW ? "error" : "warn",
        message: `Only ${gib} GiB of / is unallocated: once metadata can't grow, writes fail while df still shows free space`,
        detail:
          "Run sudo btrfs balance start -dusage=10 /, and clear caches or old snapshots if it can't free enough",
      };
    },
  });

/** Check unallocated space on / and the monthly balance timer. */
export const checkBtrfs = Effect.gen(function* () {
  if (!(yield* rootIsBtrfs()))
    return [
      { severity: "ok", message: "Root filesystem isn't btrfs" },
    ] satisfies CheckResult[];

  const [unallocated, current] = yield* Effect.all([
    btrfsUnallocatedBytes(),
    btrfsBalanceCurrent(),
  ]);

  return [
    unallocatedResult(unallocated),
    current
      ? { severity: "ok", message: "Monthly btrfs balance timer is current" }
      : {
          severity: "warn",
          message:
            "Monthly btrfs balance timer is missing, out of date or disabled",
          detail: "Run dot up and tick System, or rerun dot init",
        },
  ] satisfies CheckResult[];
}).pipe(Effect.withSpan("Doctor.btrfs"));
