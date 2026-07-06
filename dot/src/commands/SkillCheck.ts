import { Effect } from "effect";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { Launcher } from "../services/Launcher.js";
import { checkSkills } from "../lib/skillCheck.js";
import { buildSingleDiff, scanSkills } from "../lib/skillUpdates.js";
import { GitHub } from "../git/services/GitHub.js";
import { join } from "path";

/**
 * Validate skill-related maintenance wiring.
 *
 * Reports:
 * - Branch-context commands missing from or mismatched with BranchContextPlugin
 *
 * Exit code 1 if registration issues are found; 0 otherwise.
 * With `--open-opencode`, launches an OpenCode session to analyse the results.
 */
export const skillCheck = (opts?: {
  readonly openOpencode?: boolean;
  readonly diffOrigin?: boolean;
}) =>
  Effect.gen(function* () {
    const config = yield* Config;
    const log = yield* OutputLog;
    const launcher = yield* Launcher;

    if (opts?.diffOrigin && !opts.openOpencode) {
      yield* printSkillOriginDiff(config.publicDotfiles);
      return;
    }

    yield* log.section("Skill Maintenance Check");

    const result = checkSkills(config.publicDotfiles, config.privateDotfiles);

    yield* log.info(
      `Branch-context consumers found: ${result.branchContextConsumers.length}`,
    );

    if (result.branchContextIssues.length > 0) {
      yield* log.section("Branch Context Registration Issues");
      for (const issue of result.branchContextIssues) {
        yield* log.error(
          `${issue.command} in ${issue.file}:${issue.line} — ${issue.reason}`,
        );
      }
    }

    // Verdict
    if (result.branchContextIssues.length > 0) {
      yield* log.error(
        `${result.branchContextIssues.length} branch context registration issue(s) found.`,
      );
      yield* Effect.sync(() => {
        process.exitCode = 1;
      });
    } else {
      yield* log.info(
        "All branch-context commands are registered with the expected mode.",
      );
    }

    // --open-opencode: hand off to opencode for analysis
    if (opts?.openOpencode) {
      const summary = [
        result.branchContextIssues.length > 0
          ? `${result.branchContextIssues.length} branch-context registration issue(s): ${result.branchContextIssues.map((issue) => issue.command).join(", ")}`
          : "All branch-context commands are registered.",
      ].join(" ");

      const originDiff = opts?.diffOrigin
        ? yield* collectSkillOriginDiff(config.publicDotfiles)
        : "";

      const diffInstruction = originDiff
        ? `\n\nThe following diff report compares imported skills against their upstream origins. Analyse whether local adaptations should be kept, upstream removals should be mirrored, or any files should be updated.\n\n<skill-origin-diff>\n${originDiff}\n</skill-origin-diff>`
        : "";

      const opencodePrompt = `Skill check results: ${summary}\n\nAnalyse the branch-context command registrations and any skill origin diffs included below. Do not analyse whether skills are referenced by AGENTS.md, commands, or agent definitions; skills self-define through their descriptions.${diffInstruction}`;

      yield* launcher
        .suspend(`opencode --prompt ${JSON.stringify(opencodePrompt)}`)
        .pipe(Effect.catch(() => Effect.void));
    }
  });

/** Collect upstream diffs for every imported public skill with origin tracking. */
const collectSkillOriginDiff = (publicDotfiles: string) =>
  Effect.gen(function* () {
    const github = yield* GitHub;

    const ghAvailable = yield* github.isAvailable();
    if (!ghAvailable) {
      return "gh CLI not available; skipping skill origin diffs";
    }

    const skillsDir = join(publicDotfiles, "agents/.agents/skills");
    const skills = scanSkills(skillsDir);

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
const printSkillOriginDiff = (publicDotfiles: string) =>
  Effect.gen(function* () {
    const log = yield* OutputLog;
    yield* log.section("Skill Origin Diff");

    const diff = yield* collectSkillOriginDiff(publicDotfiles);
    if (diff.includes("gh CLI not available")) {
      yield* log.warn(diff);
    } else {
      yield* log.info(diff);
    }
  });
