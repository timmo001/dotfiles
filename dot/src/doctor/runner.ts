import { Cause, Effect, Option } from "effect";
import { Config } from "../services/Config.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { GitHub } from "../git/services/GitHub.js";
import { checkDependencies } from "./checks/dependencies.js";
import { checkGhExtensions } from "./checks/ghExtensions.js";
import { checkLocale } from "./checks/locale.js";
import { checkZshKeybindings } from "./checks/zshKeybindings.js";
import { checkRepos, checkPrivateAccess } from "./checks/repos.js";
import { checkStow } from "./checks/stow.js";
import { checkOpencode } from "./checks/opencode.js";
import { checkOpencodeServer } from "./checks/opencodeServer.js";
import { checkHerdr } from "./checks/herdr.js";
import { checkGithubMcpAuth } from "./checks/githubMcpAuth.js";
import { checkGitConfig } from "../git/doctor/gitConfig.js";
import { checkOriginHead } from "../git/doctor/originHead.js";
import {
  checkGitNotifications,
  checkWorkflowRuns,
  checkDoctorStartup,
  checkDailyVolumeReset,
  checkLocalBinPath,
} from "./checks/systemd.js";
import { checkOmarchy } from "./checks/omarchy.js";
import { checkLegacyHyprRepo } from "./checks/legacyHypr.js";
import { checkNvimThemeLink } from "./checks/omarchyNvim.js";
import { checkBrowserFlags } from "./checks/browserFlags.js";
import { checkHardwareVideo } from "./checks/hardwareVideo.js";
import { checkBrowserExtensions } from "./checks/browserExtensions.js";
import {
  checkPublicPackages,
  checkPrivatePackageRepo,
  checkPrivatePackages,
} from "./checks/packages.js";
import { checkPacmanHooks } from "./checks/pacmanHooks.js";
import { checkFirewall } from "./checks/firewall.js";
import { withTimeoutOption } from "../lib/workflowStep.js";
import type { CheckResult, CheckSection, DoctorReport } from "./types.js";

/**
 * Per-check backstop timeout. Individual git commands are already bounded (see
 * `gitRemoteOutput`), but this guards any check from hanging the whole run on a
 * stalled subprocess or network call; on timeout the check is interrupted (its
 * spawned processes killed) and reported as a warning rather than blocking.
 */
export const DOCTOR_CHECK_TIMEOUT_SECONDS = 45;

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
  { name: "Zsh key bindings", check: checkZshKeybindings },
  { name: "Repository checks", check: checkRepos },
  { name: "Origin HEAD freshness", check: checkOriginHead },
  { name: "Stow integrity", check: checkStow },
  { name: "OpenCode location checks", check: checkOpencode },
  { name: "OpenCode server checks", check: checkOpencodeServer },
  { name: "Herdr integration", check: checkHerdr },
  { name: "GitHub MCP auth", check: checkGithubMcpAuth },
  { name: "Git config include", check: checkGitConfig },
  { name: "Workflow runs checks", check: checkWorkflowRuns },
  { name: "Git notification checks", check: checkGitNotifications },
  { name: "Doctor startup notification", check: checkDoctorStartup },
  { name: "uwsm session PATH", check: checkLocalBinPath },
  { name: "Daily volume reset", check: checkDailyVolumeReset },
  { name: "Omarchy repository checks", check: checkOmarchy },
  { name: "Legacy Hypr repo check", check: checkLegacyHyprRepo },
  { name: "Neovim theme link", check: checkNvimThemeLink },
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
  { name: "Firewall rules", check: checkFirewall },
];

/**
 * Run all doctor checks in parallel and produce a structured report.
 *
 * `onStart` is called once with every applicable check name before the checks
 * run, so callers can seed a live "running" view (all checks start at once
 * under unbounded concurrency). `onSection` is then invoked with each section
 * as soon as its check resolves, in completion order (not declaration order),
 * letting callers stream per-check results and retire the check from that view
 * while the rest are still running. The returned report's `sections` array
 * stays in declaration order (`Effect.all` preserves input order regardless of
 * concurrency), so the ordered final summary is unaffected.
 *
 * @param onSection - Effect run per section on completion; defaults to a no-op.
 * @param onStart - Effect run once with all applicable check names before the
 *   checks start; defaults to a no-op.
 */
export const runDoctor = (
  onSection: (section: CheckSection) => Effect.Effect<void> = () => Effect.void,
  onStart: (names: readonly string[]) => Effect.Effect<void> = () =>
    Effect.void,
): Effect.Effect<DoctorReport, never, Config | CommandExecutor | GitHub> =>
  Effect.gen(function* () {
    const config = yield* Config;

    // Filter out private-only checks when private is unavailable
    // (individual checks also handle this gracefully, but this avoids unnecessary work)
    const applicable = sections.filter(
      (s) => !s.requiresPrivate || config.canUsePrivate,
    );

    // Seed the running view before any check starts; under unbounded
    // concurrency they all begin at once.
    yield* onStart(applicable.map((s) => s.name));

    // Run all checks in parallel, each bounded by a backstop timeout, catching
    // crashes per-section, and stream each section to `onSection` as it resolves
    // (completion order).
    const completedSections = yield* Effect.all(
      applicable.map((s) =>
        s.check.pipe(
          Effect.map((results): CheckSection => ({ name: s.name, results })),
          (check) => withTimeoutOption(check, DOCTOR_CHECK_TIMEOUT_SECONDS),
          Effect.map((timed): CheckSection =>
            Option.isSome(timed)
              ? timed.value
              : {
                  name: s.name,
                  results: [
                    {
                      severity: "warn" as const,
                      message: `Check timed out after ${DOCTOR_CHECK_TIMEOUT_SECONDS}s`,
                    },
                  ],
                },
          ),
          Effect.catchCause((cause): Effect.Effect<CheckSection> =>
            Effect.succeed({
              name: s.name,
              results: [
                {
                  severity: "error" as const,
                  message: `Check crashed: ${Cause.pretty(cause)}`,
                },
              ],
            }),
          ),
          Effect.tap((section) => onSection(section)),
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
