import { Effect } from "effect";
import { readFileSync } from "fs";
import { join } from "path";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";
import { Launcher, LauncherError } from "../services/Launcher.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { GitHub } from "../git/services/GitHub.js";
import {
  scanSkills,
  checkSkill,
  applySkillUpdate,
  writeSha,
  buildSingleDiff,
  type SkillMeta,
  type CheckResult,
} from "../lib/skillUpdates.js";

/** Mode of operation for the skill-updates command */
type Mode = "check" | "update" | "interactive";

/** Collected review item for skills with local edits needing manual review */
interface ReviewItem {
  readonly meta: SkillMeta;
  readonly writeSha: string;
}

/**
 * Check imported skills for upstream changes.
 *
 * Modes:
 * - `check`: Report only, exit with failure if updates available
 * - `update`: Auto-apply changes without prompting
 * - `interactive`: Prompt per skill; launch OpenCode for local-edit conflicts
 */
export const skillUpdates = (opts?: {
  readonly check?: boolean;
  readonly update?: boolean;
  readonly skipReview?: boolean;
}) =>
  Effect.gen(function* () {
    const config = yield* Config;
    const log = yield* OutputLog;
    const launcher = yield* Launcher;
    const executor = yield* CommandExecutor;
    const github = yield* GitHub;

    const mode: Mode = opts?.check
      ? "check"
      : opts?.update
        ? "update"
        : "interactive";

    yield* log.section("Skill Origin Updates");

    // Check for gh CLI availability
    const ghAvailable = yield* github.isAvailable();

    if (!ghAvailable) {
      yield* log.warn("gh CLI not available; skipping skill origin checks");
      return;
    }

    const skillsDir = join(config.publicDotfiles, "agents/.agents/skills");
    const skills = scanSkills(skillsDir);

    if (skills.length === 0) {
      yield* log.info("No imported skills with origin tracking");
      return;
    }

    yield* log.info(
      `Checking ${skills.length} imported skill(s) for upstream changes`,
    );

    // Process each skill
    let errors = 0;
    let available = 0;
    let shaQueryFailed = false;
    const updatedDirs: string[] = [];
    const reviewItems: ReviewItem[] = [];

    for (const meta of skills) {
      const result: CheckResult = yield* checkSkill(meta).pipe(
        Effect.catch((err) =>
          Effect.succeed({
            type: "error" as const,
            reason: String(err),
          }),
        ),
      );

      switch (result.type) {
        case "up-to-date": {
          if (result.cached) {
            yield* log.info(`  ${meta.name}: up to date (cached)`);
          } else {
            // Write the SHA since content matched despite SHA mismatch
            if (mode !== "check") {
              writeSha(join(meta.dir, "SKILL.md"), result.cached ? "" : "");
              // For non-cached up-to-date, need to get the sha from upstream
              // This path means content matches but SHA was different
              // The checkSkill function should have returned writeSha in this case
              // but up-to-date doesn't carry it. We handle this inside checkSkill
              // by writing SHA there.
            }
            yield* log.info(`  ${meta.name}: up to date`);
          }
          break;
        }

        case "error": {
          errors++;
          yield* log.warn(`  ${meta.name}: ${result.reason}`);
          break;
        }

        case "skipped":
          break;

        case "changes": {
          // Report changes
          yield* log.info(`  ${meta.name}: upstream changes detected`);
          yield* log.info(result.summary);

          if (mode === "check") {
            available++;
            break;
          }

          // In update and interactive modes: auto-apply
          const applied = yield* applySkillUpdate(meta, result.writeSha).pipe(
            Effect.catch((err) => {
              return Effect.succeed(false);
            }),
          );

          if (applied) {
            updatedDirs.push(meta.dir);
            yield* log.info(`  ${meta.name}: updated`);
          } else {
            yield* log.warn(
              `  ${meta.name}: could not list upstream directory for apply`,
            );
            errors++;
          }
          break;
        }

        case "local-edits": {
          // Report changes + local edits
          yield* log.info(`  ${meta.name}: upstream changes detected`);
          yield* log.info(
            "    [local edits — diffs expected, skipping auto-apply]",
          );
          for (const edit of meta.localEdits) {
            yield* log.info(`      - ${edit}`);
          }
          yield* log.info(result.summary);

          if (mode === "check") {
            available++;
            break;
          }

          // Queue for review
          reviewItems.push({ meta, writeSha: result.writeSha });
          yield* log.info(
            `  ${meta.name}: queued for review (has local edits)`,
          );
          break;
        }
      }
    }

    // Auto-commit cleanly updated skills
    if (updatedDirs.length > 0) {
      const updatedNames = updatedDirs.map((d) => d.split("/").pop() ?? d);

      // git add all updated dirs
      for (const dir of updatedDirs) {
        yield* launcher.stream(
          `git -C "${config.publicDotfiles}" add "${dir}"`,
        );
      }

      // Check if there are staged changes
      const diffExit = yield* executor.exitCode("git", [
        "-C",
        config.publicDotfiles,
        "diff",
        "--cached",
        "--quiet",
      ]);

      if (diffExit !== 0) {
        // There are staged changes — commit
        const commitMsg = `Update skills: ${updatedNames.join(", ")}`;
        const commitExit = yield* launcher.stream(
          `git -C "${config.publicDotfiles}" commit -m "${commitMsg}" --no-verify`,
        );
        if (commitExit === 0) {
          yield* log.info(`Committed: ${commitMsg}`);
        }
      } else {
        yield* log.info(
          "No staged changes to commit (files unchanged on disk)",
        );
      }
    }

    if (errors > 0) {
      yield* log.warn(`${errors} skill(s) had errors during update check`);
    }

    if (shaQueryFailed) {
      yield* log.warn(
        "Could not query upstream commit SHAs (rate limit or network); cache skipped",
      );
    }

    // Check mode: exit with failure if updates available
    if (mode === "check") {
      const total = available + reviewItems.length;
      if (total > 0) {
        yield* log.info(`${total} skill(s) have upstream updates available`);
        return yield* Effect.fail(
          new LauncherError("Skill updates available", 1),
        );
      }
      return;
    }

    // Interactive mode: handle local-edit skills
    if (mode === "interactive" && reviewItems.length > 0) {
      if (opts?.skipReview) {
        yield* log.section(
          "Skills with local edits — upstream changes available",
        );
        yield* log.info("These skills have local edits and upstream changes.");
        yield* log.info(
          "Run dot skill-updates (without --skip-review) to review in OpenCode.",
        );
        for (const item of reviewItems) {
          yield* log.info(`  ${item.meta.name}  (${item.meta.originUrl})`);
        }
      } else {
        // Launch interactive OpenCode review
        yield* opencodeReview(
          reviewItems,
          config.publicDotfiles,
          launcher,
          log,
        );
      }
    } else if (
      mode === "interactive" &&
      errors === 0 &&
      updatedDirs.length === 0 &&
      reviewItems.length === 0
    ) {
      yield* log.info("All imported skills are up to date");
    }
  });

// ---------------------------------------------------------------------------
// OpenCode Interactive Review
// ---------------------------------------------------------------------------

/** Process skills with local edits: launch OpenCode, show diff, prompt */
const opencodeReview = (
  items: readonly ReviewItem[],
  publicDotfiles: string,
  launcher: {
    readonly suspend: (
      cmd: string,
      opts?: { readonly waitForKey?: boolean },
    ) => Effect.Effect<void, LauncherError>;
  },
  log: {
    readonly info: (msg: string) => Effect.Effect<void>;
    readonly warn: (msg: string) => Effect.Effect<void>;
    readonly error: (msg: string) => Effect.Effect<void>;
    readonly section: (title: string) => Effect.Effect<void>;
  },
) =>
  Effect.gen(function* () {
    // Check opencode is available
    const executor = yield* CommandExecutor;
    const ocAvailable = yield* executor
      .exitCode("which", ["opencode"])
      .pipe(Effect.map((code) => code === 0));

    if (!ocAvailable) {
      yield* log.error(
        "opencode command not found. Skipping OpenCode handoff.",
      );
      return;
    }

    for (const { meta, writeSha: sha } of items) {
      yield* log.section(`Skill Review: ${meta.name}`);
      yield* log.info(`Origin: ${meta.originUrl}`);
      yield* log.info(`Path:   ${meta.dir}`);

      // Write SHA before the OpenCode session
      if (sha) {
        writeSha(join(meta.dir, "SKILL.md"), sha);
      }

      // Build the diff report
      const diffContent = yield* buildSingleDiff(meta).pipe(
        Effect.catch(() => Effect.succeed("")),
      );

      if (!diffContent) {
        yield* log.info(`  No upstream diff to review for ${meta.name}.`);
        continue;
      }

      // Compose the prompt
      const prompt = buildOpenCodePrompt(meta.name, diffContent);

      yield* log.info(
        "Launching interactive OpenCode session with plan agent...",
      );

      // Launch opencode with the prompt
      const escapedPrompt = prompt.replace(/'/g, "'\\''");
      yield* launcher
        .suspend(`opencode --prompt '${escapedPrompt}' --agent plan`)
        .pipe(
          Effect.catch((err) => {
            return log.error("OpenCode session exited with an error.");
          }),
        );

      // Check for changes after session
      const diffOutput = yield* executor
        .run("git", ["-C", publicDotfiles, "diff", "--", meta.dir])
        .pipe(Effect.catch(() => Effect.succeed("")));

      if (diffOutput.trim()) {
        yield* log.section(`Changes in ${meta.name}`);
        yield* log.info(diffOutput);

        // Prompt: commit / skip / quit
        const choice = yield* promptReviewAction(meta.name, launcher, log);
        if (choice === "commit") {
          yield* launcher
            .suspend(
              `git -C "${publicDotfiles}" add "${meta.dir}" && git -C "${publicDotfiles}" commit -m "Update skill: ${meta.name}" --no-verify`,
            )
            .pipe(Effect.catch(() => Effect.void));
          yield* log.info(`Committed: Update skill: ${meta.name}`);
        } else if (choice === "quit") {
          yield* log.info("Quitting skill review.");
          return;
        } else {
          yield* log.info(`Skipped commit for ${meta.name}`);
        }
      } else {
        yield* log.info(`No changes made to ${meta.name}.`);
      }
    }
  });

/** Build the OpenCode prompt for a skill review session */
function buildOpenCodePrompt(skillName: string, diffContent: string): string {
  return `The following diff report shows upstream changes to the imported skill "${skillName}" which has local edits.
All diff content is provided below — do NOT fetch from GitHub or run git commands to obtain this information.
Use the Read tool to read the current local skill files when applying changes.

IMPORTANT: The \`# upstream-sha:\` value in frontmatter has already been updated by
the script. Do NOT modify it. Use the diff below to compare what changed upstream
and integrate those changes into the local files.

Steps:
1. Summarise what changed upstream (new sections, removed content, reworded guidance, new patterns).
2. Identify which local edits should be preserved (noted in the local-edits frontmatter or intentional divergences).
3. If the diff introduces NO new upstream content (only removes locally-added sections, or all
   changes are already covered by local edits), state "no changes needed" and stop immediately.
   Do NOT ask questions or propose edits in this case.
4. Propose a plan for integrating worthwhile upstream changes while preserving local edits.
5. Ask clarifying questions before applying any changes.
6. After applying changes, run \`dot stow\` to re-link.

<skill-updates-diff>
${diffContent}
</skill-updates-diff>`;
}

/** Prompt user for review action (commit/skip/quit) using gum */
const promptReviewAction = (
  skillName: string,
  launcher: {
    readonly suspend: (
      cmd: string,
      opts?: { readonly waitForKey?: boolean },
    ) => Effect.Effect<void, LauncherError>;
  },
  log: {
    readonly info: (msg: string) => Effect.Effect<void>;
  },
): Effect.Effect<"commit" | "skip" | "quit", never, CommandExecutor> =>
  Effect.gen(function* () {
    const executor = yield* CommandExecutor;

    // Use gum choose for the interactive prompt
    const result = yield* executor
      .run("gum", [
        "choose",
        `Commit changes to ${skillName}`,
        "Skip (continue without committing)",
        "Quit (stop processing remaining skills)",
      ])
      .pipe(Effect.catch(() => Effect.succeed("Skip")));

    const trimmed = result.trim();
    if (trimmed.startsWith("Commit")) return "commit" as const;
    if (trimmed.startsWith("Quit")) return "quit" as const;
    return "skip" as const;
  });
