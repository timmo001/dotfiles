import { Effect } from "effect";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { Launcher } from "../services/Launcher.js";
import { checkSkills } from "../lib/skillCheck.js";
import { buildSingleDiff, scanSkills } from "../lib/skillUpdates.js";
import { GitHub } from "../git/services/GitHub.js";
import { join } from "path";

/**
 * Validate skill references across AGENTS.md, agent definitions, and commands.
 *
 * Reports:
 * - Broken references (skill names that don't correspond to a skill directory)
 * - Unreferenced skills (skill directories never mentioned anywhere)
 *
 * Exit code 1 if broken references are found; 0 otherwise.
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

    yield* log.section("Skill Reference Check");

    const result = checkSkills(config.publicDotfiles, config.privateDotfiles);

    // Summary
    yield* log.info(`Skills discovered: ${result.skills.length}`);
    yield* log.info(`References found: ${result.references.length}`);
    yield* log.info(
      `Branch-context consumers found: ${result.branchContextConsumers.length}`,
    );

    // Broken references
    if (result.broken.length > 0) {
      yield* log.section("Broken References");
      for (const ref of result.broken) {
        yield* log.error(
          `\`${ref.name}\` referenced in ${ref.file}:${ref.line} — no matching skill directory`,
        );
      }
    }

    // Unreferenced skills (informational)
    if (result.unreferenced.length > 0) {
      yield* log.section("Unreferenced Skills");
      for (const entry of result.unreferenced) {
        const scope = entry.local ? "repo-local" : "global";
        yield* log.info(
          `\`${entry.name}\` (${scope}) — not referenced in any scanned file`,
        );
      }
    }

    if (result.branchContextIssues.length > 0) {
      yield* log.section("Branch Context Registration Issues");
      for (const issue of result.branchContextIssues) {
        yield* log.error(
          `${issue.command} in ${issue.file}:${issue.line} — ${issue.reason}`,
        );
      }
    }

    // Verdict
    if (result.broken.length > 0 || result.branchContextIssues.length > 0) {
      yield* log.error(`${result.broken.length} broken reference(s) found.`);
      yield* log.error(
        `${result.branchContextIssues.length} branch context registration issue(s) found.`,
      );
      yield* Effect.sync(() => {
        process.exitCode = 1;
      });
    } else {
      yield* log.info(
        "No broken references. All skill names resolve correctly and branch-context commands are registered.",
      );
    }

    // --open-opencode: hand off to opencode for analysis
    if (opts?.openOpencode) {
      const summary = [
        `${result.skills.length} skills, ${result.references.length} references.`,
        result.broken.length > 0
          ? `${result.broken.length} broken reference(s): ${result.broken.map((r) => r.name).join(", ")}`
          : "No broken references.",
        result.unreferenced.length > 0
          ? `${result.unreferenced.length} unreferenced skill(s): ${result.unreferenced.map((s) => s.name).join(", ")}`
          : "All skills referenced.",
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

      const opencodePrompt = `Skill check results: ${summary}\n\nAnalyse the unreferenced skills and suggest whether they should be explicitly referenced in AGENTS.md or agent definitions, or whether their descriptions are sufficient for the LLM to discover them. Also check if any unreferenced skills might be obsolete.${diffInstruction}`;

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
