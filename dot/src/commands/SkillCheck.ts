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

    if (opts?.diffOrigin) {
      yield* diffSkillOrigins(config.publicDotfiles);
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

      const opencodePrompt = `Skill check results: ${summary}\n\nAnalyse the unreferenced skills and suggest whether they should be explicitly referenced in AGENTS.md or agent definitions, or whether their descriptions are sufficient for the LLM to discover them. Also check if any unreferenced skills might be obsolete.`;

      yield* launcher
        .suspend(`opencode --prompt ${JSON.stringify(opencodePrompt)}`)
        .pipe(Effect.catch(() => Effect.void));
    }
  });

/** Print upstream diffs for every imported public skill with origin tracking. */
const diffSkillOrigins = (publicDotfiles: string) =>
  Effect.gen(function* () {
    const log = yield* OutputLog;
    const github = yield* GitHub;

    yield* log.section("Skill Origin Diff");

    const ghAvailable = yield* github.isAvailable();
    if (!ghAvailable) {
      yield* log.warn("gh CLI not available; skipping skill origin diffs");
      return;
    }

    const skillsDir = join(publicDotfiles, "agents/.agents/skills");
    const skills = scanSkills(skillsDir);

    if (skills.length === 0) {
      yield* log.info("No imported skills with origin tracking");
      return;
    }

    let changed = 0;
    for (const skill of skills) {
      const diff = yield* buildSingleDiff(skill).pipe(
        Effect.catch(() => Effect.succeed("")),
      );
      if (!diff) continue;

      changed++;
      yield* log.info(diff);
    }

    if (changed === 0) {
      yield* log.info("No origin diffs found");
    } else {
      yield* log.info(`${changed} skill(s) differ from origin`);
    }
  });
