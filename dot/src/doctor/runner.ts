import { Effect } from "effect";
import { Config } from "../services/Config.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { GitHub } from "../git/services/GitHub.js";
import { checkDependencies } from "./checks/dependencies.js";
import { checkGhExtensions } from "./checks/ghExtensions.js";
import { checkLocale } from "./checks/locale.js";
import { checkSecretService } from "./checks/secretService.js";
import { checkRepos, checkPrivateAccess } from "./checks/repos.js";
import { checkStow } from "./checks/stow.js";
import { checkOpencode } from "./checks/opencode.js";
import { checkGitConfig } from "../git/doctor/gitConfig.js";
import { checkOriginHead } from "../git/doctor/originHead.js";
import {
  checkGitNotifications,
  checkWorkflowRuns,
  checkDoctorStartup,
  checkDailyVolumeReset,
  checkMhoc303ClockSync,
  checkLocalBinPath,
} from "./checks/systemd.js";
import { checkOmarchy } from "./checks/omarchy.js";
import { checkLegacyHyprRepo } from "./checks/legacyHypr.js";
import { checkBrowserFlags } from "./checks/browserFlags.js";
import { checkHardwareVideo } from "./checks/hardwareVideo.js";
import { checkBrowserExtensions } from "./checks/browserExtensions.js";
import {
  checkPublicPackages,
  checkPrivatePackageRepo,
  checkPrivatePackages,
} from "./checks/packages.js";
import { checkPacmanHooks } from "./checks/pacmanHooks.js";
import type { CheckResult, CheckSection, DoctorReport } from "./types.js";

/** A section definition: name, check effect, and whether it requires private access */
interface SectionDef {
  readonly name: string;
  // Allow any error type — the runner catches all errors per-section
  readonly check: Effect.Effect<
    CheckResult[],
    unknown,
    Config | CommandExecutor | GitHub
  >;
  readonly requiresPrivate?: boolean;
}

/** All doctor check sections in display order */
const sections: readonly SectionDef[] = [
  { name: "Dependency checks", check: checkDependencies },
  { name: "gh extension checks", check: checkGhExtensions },
  { name: "Locale", check: checkLocale },
  { name: "Secret Service checks", check: checkSecretService },
  { name: "Repository checks", check: checkRepos },
  { name: "Origin HEAD freshness", check: checkOriginHead },
  { name: "Stow integrity", check: checkStow },
  { name: "OpenCode location checks", check: checkOpencode },
  { name: "Git config include", check: checkGitConfig },
  { name: "Workflow runs checks", check: checkWorkflowRuns },
  { name: "Git notification checks", check: checkGitNotifications },
  { name: "Doctor startup notification", check: checkDoctorStartup },
  { name: "uwsm session PATH", check: checkLocalBinPath },
  { name: "Daily volume reset", check: checkDailyVolumeReset },
  { name: "MHO-C303 clock sync", check: checkMhoc303ClockSync },
  { name: "Omarchy repository checks", check: checkOmarchy },
  { name: "Legacy Hypr repo check", check: checkLegacyHyprRepo },
  { name: "Private access", check: checkPrivateAccess },
  { name: "Browser flags", check: checkBrowserFlags },
  { name: "Hardware video decode", check: checkHardwareVideo },
  {
    name: "Browser extension checks",
    check: checkBrowserExtensions,
    requiresPrivate: true,
  },
  { name: "Public package checks", check: checkPublicPackages },
  {
    name: "Private package repo checks",
    check: checkPrivatePackageRepo,
    requiresPrivate: true,
  },
  {
    name: "Private package checks",
    check: checkPrivatePackages,
    requiresPrivate: true,
  },
  { name: "Pacman hooks", check: checkPacmanHooks },
];

/** Run all doctor checks in parallel and produce a structured report */
export const runDoctor: Effect.Effect<
  DoctorReport,
  never,
  Config | CommandExecutor | GitHub
> = Effect.gen(function* () {
  const config = yield* Config;

  // Filter out private-only checks when private is unavailable
  // (individual checks also handle this gracefully, but this avoids unnecessary work)
  const applicable = sections.filter(
    (s) => !s.requiresPrivate || config.canUsePrivate,
  );

  // Run all checks in parallel, catching crashes per-section
  const completedSections = yield* Effect.all(
    applicable.map((s) =>
      s.check.pipe(
        Effect.map((results): CheckSection => ({ name: s.name, results })),
        Effect.catch((err: unknown) =>
          Effect.succeed({
            name: s.name,
            results: [
              { severity: "error" as const, message: `Check crashed: ${err}` },
            ],
          }),
        ),
      ),
    ),
    { concurrency: "unbounded" },
  );

  const allResults = completedSections.flatMap((s) => s.results);
  const warnings = allResults.filter((r) => r.severity === "warn").length;
  const errors = allResults.filter((r) => r.severity === "error").length;

  return {
    sections: completedSections,
    warnings,
    errors,
    timestamp: Date.now(),
  };
});
