/**
 * @file Doctor check for the first-party upgrade unit: on a machine with the
 * [timmo] repository, the unit, its pacman config and its polkit rule should
 * be installed root-owned and match the dotfiles.
 */
import { Effect, FileSystem } from "effect";
import { publicPacmanRepoConfigPath } from "../../commands/SetupPublicRepo.js";
import { firstPartyRootCurrent } from "../../lib/firstPartyPackages.js";
import type { CheckResult } from "../types.js";

/** Check the first-party upgrade unit is installed and current. */
export const checkFirstParty = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  if (
    !(yield* fs
      .exists(publicPacmanRepoConfigPath())
      .pipe(Effect.orElseSucceed(() => false)))
  )
    return [] satisfies CheckResult[];

  return [
    (yield* firstPartyRootCurrent())
      ? { severity: "ok", message: "First-party upgrade unit is current" }
      : {
          severity: "warn",
          message: "First-party upgrade unit is missing or out of date",
          detail:
            "Run dot up and tick System or First-party packages, or rerun dot init",
        },
  ] satisfies CheckResult[];
}).pipe(Effect.withSpan("Doctor.firstParty"));
