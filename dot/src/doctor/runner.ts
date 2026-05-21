import { Effect } from "effect";
import { Config } from "../services/Config.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { checkDependencies } from "./checks/dependencies.js";
import { checkSecretService } from "./checks/secretService.js";
import { checkRepos } from "./checks/repos.js";
import { checkStow } from "./checks/stow.js";
import { checkOpencode } from "./checks/opencode.js";
import { checkGitConfig } from "./checks/gitConfig.js";
import { checkWorkflowWatch, checkDoctorStartup, checkDailyVolumeReset } from "./checks/systemd.js";
import { checkOmarchy } from "./checks/omarchy.js";
import { checkBrowserFlags } from "./checks/browserFlags.js";
import { checkHardwareVideo } from "./checks/hardwareVideo.js";
import { checkBrowserExtensions } from "./checks/browserExtensions.js";
import { checkPublicPackages, checkPrivatePackageRepo, checkPrivatePackages } from "./checks/packages.js";
import { checkPacmanHooks } from "./checks/pacmanHooks.js";
import type { CheckResult, CheckSection, DoctorReport } from "./types.js";

/** A section definition: name, check effect, and whether it requires private access */
interface SectionDef {
  readonly name: string;
  // Allow any error type — the runner catches all errors per-section
  readonly check: Effect.Effect<CheckResult[], unknown, Config | CommandExecutor>;
  readonly requiresPrivate?: boolean;
}

/** All doctor check sections in display order */
const sections: readonly SectionDef[] = [
  { name: "Dependency checks", check: checkDependencies },
  { name: "Secret Service checks", check: checkSecretService },
  { name: "Repository checks", check: checkRepos },
  { name: "Stow integrity", check: checkStow },
  { name: "OpenCode location checks", check: checkOpencode },
  { name: "Git config include", check: checkGitConfig },
  { name: "Workflow watch checks", check: checkWorkflowWatch },
  { name: "Doctor startup notification", check: checkDoctorStartup },
  { name: "Daily volume reset", check: checkDailyVolumeReset },
  { name: "Omarchy repository checks", check: checkOmarchy },
  { name: "Browser flags", check: checkBrowserFlags },
  { name: "Hardware video decode", check: checkHardwareVideo },
  { name: "Browser extension checks", check: checkBrowserExtensions, requiresPrivate: true },
  { name: "Public package checks", check: checkPublicPackages },
  { name: "Private package repo checks", check: checkPrivatePackageRepo, requiresPrivate: true },
  { name: "Private package checks", check: checkPrivatePackages, requiresPrivate: true },
  { name: "Pacman hooks", check: checkPacmanHooks },
];

/** Run all doctor checks in parallel and produce a structured report */
export const runDoctor: Effect.Effect<DoctorReport, never, Config | CommandExecutor> = Effect.gen(function* () {
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
            results: [{ severity: "error" as const, message: `Check crashed: ${err}` }],
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
