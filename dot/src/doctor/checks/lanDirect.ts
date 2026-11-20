/**
 * @file Doctor check for the LAN-direct unit: it should be installed
 * root-owned, match the dotfiles, and be enabled and active, so this machine
 * reaches its own networks directly rather than through Tailscale. Its
 * systemd-resolved .local drop-in should match the dotfiles too.
 */
import { Effect } from "effect";
import { lanDirectCurrent } from "../../lib/lanDirect.js";
import type { CheckResult } from "../types.js";

/** Check the LAN-direct unit is installed, current and running. */
export const checkLanDirect = Effect.gen(function* () {
  return [
    (yield* lanDirectCurrent())
      ? {
          severity: "ok",
          message: "LAN-direct routing unit is current and active",
        }
      : {
          severity: "warn",
          message:
            "LAN-direct routing unit or .local resolver config is missing, out of date or stopped",
          detail: "Run dot up and tick System, or rerun dot init",
        },
  ] satisfies CheckResult[];
}).pipe(Effect.withSpan("Doctor.lanDirect"));
