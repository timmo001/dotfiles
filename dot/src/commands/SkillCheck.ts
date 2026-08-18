import { Effect } from "effect";
import { existsSync } from "fs";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { Launcher } from "../services/Launcher.js";
import { checkSkills } from "../lib/skillCheck.js";
import {
  buildSingleDiff,
  checkSkill,
  scanSkills,
  type SkillMeta,
} from "../lib/skillUpdates.js";
import { GitHub } from "../git/services/GitHub.js";
import { join } from "path";
import { HOME_DIR } from "../lib/paths.js";
import { detectAgent } from "../lib/agent.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { LauncherError } from "../services/Launcher.js";

/**
 * Validate skill-related maintenance wiring.
 *
 * Reports:
 * - Branch-context commands missing from or mismatched with BranchContextPlugin
 * - Adapted imported skills that no longer differ from their complete source
 *
 * Exit code 1 if maintenance issues are found; 0 otherwise.
 * With `--open-opencode`, launches an OpenCode session to analyse the results.
 */
export const skillCheck = (opts?: {
  readonly openOpencode?: boolean;
  readonly diffOrigin?: boolean;
  readonly skill?: string;
}) =>
  Effect.gen(function* () {
    const config = yield* Config;
    const log = yield* OutputLog;
    const launcher = yield* Launcher;
    const github = yield* GitHub;
    const executor = yield* CommandExecutor;

    if (opts?.diffOrigin && !opts.openOpencode) {
      yield* printSkillOriginDiff(config.publicDotfiles, opts.skill);
      return;
    }

    yield* log.section("Skill Maintenance Check");

    const result = checkSkills(config.publicDotfiles, config.privateDotfiles);
    const skillsRepo = join(HOME_DIR, "repos", "skills");
    const skillsDir = existsSync(join(skillsRepo, ".git"))
      ? skillsRepo
      : join(config.publicDotfiles, "agents/.agents/skills");
    const localEditSkills = scanSkills(skillsDir).filter(
      (skill) => skill.localEdits.length > 0,
    );
    const selectedSkills = opts?.skill
      ? localEditSkills.filter((skill) => skill.name === opts.skill)
      : localEditSkills;
    if (opts?.skill && selectedSkills.length === 0) {
      return yield* new LauncherError({
        message: `Adapted imported skill not found: ${opts.skill}`,
        exitCode: 1,
      });
    }
    const exactSourceMatches: SkillMeta[] = [];

    if (!opts?.skill) {
      yield* log.info(
        `Branch-context consumers found: ${result.branchContextConsumers.length}`,
      );
    }

    if (yield* github.isAvailable()) {
      yield* log.info(
        `Adapted imported skills checked: ${selectedSkills.length}`,
      );
      for (const skill of selectedSkills) {
        const comparison = yield* checkSkill(skill, {
          forceContentComparison: true,
        });
        if (comparison.type === "up-to-date") exactSourceMatches.push(skill);
      }
    } else {
      yield* log.warn(
        "gh CLI not available; skipping adapted skill source comparisons",
      );
    }

    const branchContextIssues = opts?.skill ? [] : result.branchContextIssues;
    if (branchContextIssues.length > 0) {
      yield* log.section("Branch Context Registration Issues");
      for (const issue of branchContextIssues) {
        yield* log.error(
          `${issue.command} in ${issue.file}:${issue.line} — ${issue.reason}`,
        );
      }
    }

    if (exactSourceMatches.length > 0) {
      yield* log.section("Adapted Skills Matching Their Source");
      for (const skill of exactSourceMatches) {
        yield* log.error(
          `${skill.name} matches every file from ${skill.originUrl}`,
        );
      }
    }

    // Verdict
    const issueCount = branchContextIssues.length + exactSourceMatches.length;
    if (issueCount > 0) {
      yield* log.error(`${issueCount} skill maintenance issue(s) found.`);
      yield* Effect.sync(() => {
        process.exitCode = 1;
      });
    } else {
      yield* log.info(
        opts?.skill
          ? `${opts.skill} differs from its complete source.`
          : "All branch-context registrations and adapted skill sources are valid.",
      );
    }

    if (exactSourceMatches.length > 0) {
      const isAgent = detectAgent().isAgent;
      for (const skill of exactSourceMatches) {
        const command = skillReimportCommand(skill.originUrl);
        if (isAgent) {
          yield* log.info(`Reimport ${skill.name} with: ${command}`);
          continue;
        }

        const choice = yield* executor
          .run("gum", [
            "choose",
            `Reimport ${skill.name} from its source`,
            "Skip",
          ])
          .pipe(Effect.option);
        if (choice._tag === "None") {
          yield* log.info(`Reimport ${skill.name} with: ${command}`);
          continue;
        }
        if (!choice.value.trim().startsWith("Reimport")) {
          yield* log.info(`Skipped reimport for ${skill.name}`);
          continue;
        }

        yield* launcher
          .suspendArgv([
            "mise",
            "exec",
            "npm:skills",
            "--",
            "skills",
            "add",
            skill.originUrl,
            "--global",
          ])
          .pipe(
            Effect.catch(() =>
              log.error(`Could not reimport ${skill.name}. Run: ${command}`),
            ),
          );
      }
    }

    // --open-opencode: hand off to opencode for analysis
    if (opts?.openOpencode) {
      const summary = [
        branchContextIssues.length > 0
          ? `${branchContextIssues.length} branch-context registration issue(s): ${branchContextIssues.map((issue) => issue.command).join(", ")}`
          : "All branch-context commands are registered.",
        exactSourceMatches.length > 0
          ? `${exactSourceMatches.length} adapted skill(s) exactly match their source: ${exactSourceMatches.map((skill) => skill.name).join(", ")}`
          : "All adapted skills differ from their source.",
      ].join(" ");

      const originDiff = opts?.diffOrigin
        ? yield* collectSkillOriginDiff(config.publicDotfiles, opts.skill)
        : "";

      const diffInstruction = originDiff
        ? `\n\nThe following diff report compares imported skills against their upstream origins. Analyse whether local adaptations should be kept, upstream removals should be mirrored, or any files should be updated.\n\n<skill-origin-diff>\n${originDiff}\n</skill-origin-diff>`
        : "";

      const opencodePrompt = `Skill check results: ${summary}\n\nAnalyse the branch-context command registrations and any skill origin diffs included below. Do not analyse whether skills are referenced by AGENTS.md, commands, or agent definitions; skills self-define through their descriptions.${diffInstruction}`;

      yield* launcher
        .suspendArgv(["opencode", "--prompt", opencodePrompt])
        .pipe(Effect.ignore);
    }
  });

/** Build the standard global Skills CLI command for an upstream skill source. */
export function skillReimportCommand(originUrl: string): string {
  return `mise exec npm:skills -- skills add '${originUrl.replaceAll("'", "'\\''")}' --global`;
}

/** Collect upstream diffs for every imported public skill with origin tracking. */
const collectSkillOriginDiff = (publicDotfiles: string, skillName?: string) =>
  Effect.gen(function* () {
    const github = yield* GitHub;

    const ghAvailable = yield* github.isAvailable();
    if (!ghAvailable) {
      return "gh CLI not available; skipping skill origin diffs";
    }

    const skillsDir = join(publicDotfiles, "agents/.agents/skills");
    const skills = scanSkills(skillsDir).filter(
      (skill) => !skillName || skill.name === skillName,
    );

    if (skills.length === 0) {
      return "No imported skills with origin tracking";
    }

    const parts: string[] = [];
    for (const skill of skills) {
      const diff = yield* buildSingleDiff(skill);
      if (!diff) continue;

      parts.push(diff);
    }

    if (parts.length === 0) {
      return "No origin diffs found";
    }
    return `${parts.join("\n\n")}\n\n${parts.length} skill(s) differ from origin`;
  });

/** Print upstream diffs for every imported public skill with origin tracking. */
const printSkillOriginDiff = (publicDotfiles: string, skillName?: string) =>
  Effect.gen(function* () {
    const log = yield* OutputLog;
    yield* log.section("Skill Origin Diff");

    const diff = yield* collectSkillOriginDiff(publicDotfiles, skillName);
    if (diff.includes("gh CLI not available")) {
      yield* log.warn(diff);
    } else {
      yield* log.info(diff);
    }
  });
