import { Effect } from "effect";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { Launcher } from "../services/Launcher.js";
import { checkSkills } from "../lib/skillCheck.js";

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
export const skillCheck = (opts?: { readonly openOpencode?: boolean }) =>
  Effect.gen(function* () {
    const config = yield* Config;
    const log = yield* OutputLog;
    const launcher = yield* Launcher;

    yield* log.section("Skill Reference Check");

    const result = checkSkills(config.publicDotfiles, config.privateDotfiles);

    // Summary
    yield* log.info(`Skills discovered: ${result.skills.length}`);
    yield* log.info(`References found: ${result.references.length}`);

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

    // Verdict
    if (result.broken.length > 0) {
      yield* log.error(`${result.broken.length} broken reference(s) found.`);
      yield* Effect.sync(() => {
        process.exitCode = 1;
      });
    } else {
      yield* log.info(
        "No broken references. All skill names resolve correctly.",
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
      ].join(" ");

      const opencodePrompt = `Skill check results: ${summary}\n\nAnalyse the unreferenced skills and suggest whether they should be explicitly referenced in AGENTS.md or agent definitions, or whether their descriptions are sufficient for the LLM to discover them. Also check if any unreferenced skills might be obsolete.`;

      yield* launcher
        .suspend(`opencode --prompt ${JSON.stringify(opencodePrompt)}`)
        .pipe(Effect.catch(() => Effect.void));
    }
  });
