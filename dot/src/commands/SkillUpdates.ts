import { Effect, Option } from "effect";
import { readFileSync, existsSync } from "fs";
import { join } from "path";
import { Config } from "../services/Config.js";
import { OutputLog, type OutputLogService } from "../services/OutputLog.js";
import {
  Launcher,
  LauncherError,
  type LauncherService,
} from "../services/Launcher.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { GitHub } from "../git/services/GitHub.js";
import { commitIn, stageIn } from "../git/committer.js";
import {
  scanSkillEntries,
  checkSkill,
  buildSingleDiff,
  cleanupSkillDiffCache,
  type SkillMeta,
  type CheckResult,
  type SkillScanEntry,
} from "../lib/skillUpdates.js";
import { withSpinnerTimeout } from "../lib/workflowStep.js";
import { HOME_DIR } from "../lib/paths.js";

/** Mode of operation for the skill-updates command */
type Mode = "check" | "update" | "interactive";

/** Machine-readable state for one imported skill. */
export interface SkillUpdateReportItem {
  readonly name: string;
  readonly directory: string;
  readonly state:
    | "up-to-date"
    | "update-available"
    | "manual-review"
    | "invalid-origin"
    | "origin-gone"
    | "error";
  readonly origin: string;
  readonly storedSha: string | null;
  readonly upstreamSha: string | null;
  readonly files: readonly {
    readonly path: string;
    readonly status: "modified" | "removed-upstream" | "added-upstream";
  }[];
  readonly localEdits: readonly string[];
  readonly reason?: string;
}

/** Machine-readable imported-skill update report. */
export interface SkillUpdateReport {
  readonly version: 1;
  readonly skills: readonly SkillUpdateReportItem[];
  readonly error?: string;
}

const SKILL_CHECK_TIMEOUT_SECONDS = 45;
const SKILL_APPLY_TIMEOUT_SECONDS = 60;
const SKILL_DIFF_TIMEOUT_SECONDS = 45;

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
 *
 * Resolves to `true` when a skill update commit was created (a reviewable
 * diff now exists), otherwise `false`.
 */
export const skillUpdates = (opts?: {
  readonly check?: boolean;
  readonly update?: boolean;
  readonly skipReview?: boolean;
  readonly json?: boolean;
  readonly skill?: string;
  readonly noCommit?: boolean;
}) =>
  Effect.gen(function* () {
    const config = yield* Config;
    const log = yield* OutputLog;
    const launcher = yield* Launcher;
    const github = yield* GitHub;
    const executor = yield* CommandExecutor;

    const mode: Mode =
      opts?.json || opts?.check
        ? "check"
        : opts?.update
          ? "update"
          : "interactive";

    // Sweep any leftover diff temp files from prior or interrupted runs.
    yield* Effect.sync(cleanupSkillDiffCache);

    // Check for gh CLI availability
    const ghAvailable = yield* github.isAvailable();

    if (!ghAvailable) {
      if (opts?.json) {
        yield* Effect.sync(() =>
          process.stdout.write(
            `${JSON.stringify({ version: 1, skills: [], error: "gh CLI not available" })}\n`,
          ),
        );
        return false;
      }
      yield* log.warn("gh CLI not available; skipping skill origin checks");
      return false;
    }

    const skillsRepo = join(HOME_DIR, "repos", "skills");
    const writableSkillsRepo = existsSync(join(skillsRepo, ".git"));
    const skillsDir = writableSkillsRepo
      ? skillsRepo
      : join(config.publicDotfiles, "agents/.agents/skills");
    const entries = scanSkillEntries(skillsDir);
    const selectedEntries = opts?.skill
      ? entries.filter((entry) => entry.meta.name === opts.skill)
      : entries;
    const skills = selectedEntries.flatMap((entry) =>
      entry.type === "skill" ? [entry.meta] : [],
    );

    if (opts?.skill && selectedEntries.length === 0) {
      return yield* new LauncherError({
        message: `Imported skill not found: ${opts.skill}`,
        exitCode: 1,
      });
    }

    if (opts?.json) {
      const report = yield* buildSkillUpdateReport(selectedEntries);
      yield* Effect.sync(() =>
        process.stdout.write(`${JSON.stringify(report, null, 2)}\n`),
      );
      return false;
    }

    yield* log.section("Skill Origin Updates");

    for (const entry of selectedEntries) {
      if (entry.type === "invalid-origin") {
        yield* log.warn(
          `  ${entry.meta.name}: invalid origin ${entry.meta.originUrl} (${entry.meta.reason})`,
        );
      }
    }

    const invalidOrigins = selectedEntries.filter(
      (entry) => entry.type === "invalid-origin",
    ).length;

    if (skills.length === 0) {
      yield* log.info("No imported skills with origin tracking");
      return false;
    }

    yield* log.info(
      `Checking ${skills.length} imported skill(s) for upstream changes`,
    );

    // Process each skill
    let errors = invalidOrigins;
    let available = 0;
    let committed = false;
    const updatedDirs: string[] = [];
    const reviewItems: ReviewItem[] = [];

    for (const meta of skills) {
      const checked = yield* withSpinnerTimeout(
        `Checking ${meta.name}`,
        SKILL_CHECK_TIMEOUT_SECONDS,
        checkSkill(meta),
      );
      const result: CheckResult = yield* Option.match(checked, {
        onNone: () =>
          Effect.succeed({
            type: "error" as const,
            reason: `timed out after ${SKILL_CHECK_TIMEOUT_SECONDS}s`,
          }),
        onSome: (value) => Effect.succeed(value),
      });

      if (Option.isNone(checked)) {
        yield* log.warn(
          `  ${meta.name}: check timed out after ${SKILL_CHECK_TIMEOUT_SECONDS}s`,
        );
      }

      switch (result.type) {
        case "up-to-date": {
          if (result.cached) {
            yield* log.info(`  ${meta.name}: up to date (cached)`);
          } else {
            // Write the SHA since content matched despite SHA mismatch
            if (mode !== "check" && result.writeSha && writableSkillsRepo) {
              const exitCode = yield* executor.exitCode(
                "python",
                [
                  "scripts/import_skill.py",
                  meta.name,
                  "--reviewed-sha",
                  result.writeSha,
                  "--metadata-only",
                ],
                { cwd: skillsRepo },
              );
              if (exitCode !== 0) {
                errors++;
                yield* log.warn(
                  `  ${meta.name}: could not advance reviewed metadata`,
                );
              } else {
                updatedDirs.push(meta.dir);
              }
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

        case "origin-gone": {
          errors++;
          yield* log.warn(
            `  ${meta.name}: upstream origin not found (${result.reason}); skipping, not deleting. Update the # origin: path or remove the skill manually.`,
          );
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
          if (!writableSkillsRepo) {
            return yield* new LauncherError({
              message: `Writable skills checkout not found: ${skillsRepo}`,
              exitCode: 1,
            });
          }
          const appliedResult = yield* withSpinnerTimeout(
            `Applying ${meta.name}`,
            SKILL_APPLY_TIMEOUT_SECONDS,
            executor
              .exitCode(
                "python",
                ["scripts/import_skill.py", meta.name, "--apply"],
                { cwd: skillsRepo },
              )
              .pipe(Effect.map((code) => code === 0)),
          );
          const applied = Option.getOrElse(appliedResult, () => false);

          if (Option.isNone(appliedResult)) {
            yield* log.warn(
              `  ${meta.name}: apply timed out after ${SKILL_APPLY_TIMEOUT_SECONDS}s`,
            );
          }

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
            "    [local edits, diffs expected, skipping auto-apply]",
          );
          for (const edit of meta.localEdits) {
            yield* log.info(`      - ${edit}`);
          }
          yield* log.info(result.summary);

          if (mode === "check") {
            available++;
            break;
          }

          if (opts?.skill) {
            return yield* new LauncherError({
              message: `Skill ${meta.name} has local edits and requires manual review`,
              exitCode: 1,
            });
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
    if (updatedDirs.length > 0 && !opts?.noCommit) {
      const updatedNames = updatedDirs.map((d) => d.split("/").pop() ?? d);

      const staged = yield* stageIn(
        {
          mode: "paths",
          paths: [...updatedDirs, join(skillsRepo, "imports.json")],
        },
        { cwd: skillsRepo },
      );
      if (!staged.ok) {
        return yield* new LauncherError({
          message: staged.error ?? "git add failed",
          exitCode: 1,
        });
      }

      const commitMsg = `Update skills: ${updatedNames.join(", ")}`;
      const outcome = yield* commitIn({
        cwd: skillsRepo,
        message: commitMsg,
        paths: [...updatedDirs, join(skillsRepo, "imports.json")],
        noVerify: true,
        tolerateEmpty: true,
      });
      if (!outcome.ok) {
        return yield* new LauncherError({
          message: outcome.error ?? "git commit failed",
          exitCode: 1,
        });
      }
      if (outcome.committed) {
        yield* log.info(`Committed: ${commitMsg}`);
        committed = true;
      } else {
        yield* log.info(
          "No staged changes to commit (files unchanged on disk)",
        );
      }
    }

    if (errors > 0) {
      yield* log.warn(`${errors} skill(s) had errors during update check`);
    }

    // Check mode: exit with failure if updates available
    if (mode === "check") {
      const total = available + reviewItems.length;
      if (total > 0) {
        yield* log.info(`${total} skill(s) have upstream updates available`);
        return yield* new LauncherError({
          message: "Skill updates available",
          exitCode: 1,
        });
      }
      return false;
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
        yield* opencodeReview(reviewItems, skillsRepo, launcher, log);
      }
    } else if (
      mode === "interactive" &&
      errors === 0 &&
      updatedDirs.length === 0 &&
      reviewItems.length === 0
    ) {
      yield* log.info("All imported skills are up to date");
    }

    return committed;
  });

/** Check discovered skills and return their stable machine-readable states. */
export const buildSkillUpdateReport = (entries: readonly SkillScanEntry[]) =>
  Effect.gen(function* () {
    const skills: SkillUpdateReportItem[] = [];

    for (const entry of entries) {
      if (entry.type === "invalid-origin") {
        skills.push({
          name: entry.meta.name,
          directory: entry.meta.dir.split("/").pop() ?? entry.meta.name,
          state: "invalid-origin",
          origin: entry.meta.originUrl,
          storedSha: null,
          upstreamSha: null,
          files: [],
          localEdits: [],
          reason: entry.meta.reason,
        });
        continue;
      }

      const result = yield* checkSkill(entry.meta);
      skills.push(reportItem(entry.meta, result));
    }

    return { version: 1, skills } satisfies SkillUpdateReport;
  });

/** Convert one internal check result to the public JSON report contract. */
export function reportItem(
  meta: SkillMeta,
  result: CheckResult,
): SkillUpdateReportItem {
  const base = {
    name: meta.name,
    directory: meta.dir.split("/").pop() ?? meta.name,
    origin: meta.originUrl,
    storedSha: meta.storedSha,
    localEdits: meta.localEdits,
  };

  switch (result.type) {
    case "up-to-date":
      return {
        ...base,
        state: "up-to-date",
        upstreamSha: result.upstreamSha,
        files: [],
      };
    case "changes":
    case "local-edits":
      return {
        ...base,
        state: result.type === "changes" ? "update-available" : "manual-review",
        upstreamSha: result.upstreamSha,
        files: result.files.map(({ path, status }) => ({ path, status })),
      };
    case "origin-gone":
      return {
        ...base,
        state: "origin-gone",
        upstreamSha: null,
        files: [],
        reason: result.reason,
      };
    case "error":
      return {
        ...base,
        state: "error",
        upstreamSha: null,
        files: [],
        reason: result.reason,
      };
    case "skipped":
      return {
        ...base,
        state: "error",
        upstreamSha: null,
        files: [],
        reason: "check skipped",
      };
  }
}

// ---------------------------------------------------------------------------
// OpenCode Interactive Review
// ---------------------------------------------------------------------------

/** Process skills with local edits: launch OpenCode, show diff, prompt */
const opencodeReview = (
  items: readonly ReviewItem[],
  publicDotfiles: string,
  launcher: Pick<LauncherService, "suspend" | "suspendArgv">,
  log: OutputLogService,
) =>
  Effect.gen(function* () {
    const executor = yield* CommandExecutor;

    for (const { meta, writeSha: sha } of items) {
      yield* log.section(`Skill Review: ${meta.name}`);
      yield* log.info(`Origin: ${meta.originUrl}`);
      yield* log.info(`Path:   ${meta.dir}`);

      // Build the diff report
      const diffResult = yield* withSpinnerTimeout(
        `Building diff for ${meta.name}`,
        SKILL_DIFF_TIMEOUT_SECONDS,
        buildSingleDiff(meta),
      );
      const diffContent = Option.getOrElse(diffResult, () => "");

      if (Option.isNone(diffResult)) {
        yield* log.warn(
          `  ${meta.name}: diff build timed out after ${SKILL_DIFF_TIMEOUT_SECONDS}s`,
        );
      }

      if (!diffContent) {
        yield* log.info(`  No upstream diff to review for ${meta.name}.`);
        continue;
      }

      // Check opencode is available only when there is a real diff to review.
      const ocAvailable = yield* executor
        .exitCode("which", ["opencode"])
        .pipe(Effect.map((code) => code === 0));

      if (!ocAvailable) {
        yield* log.error(
          "opencode command not found. Skipping OpenCode handoff.",
        );
        return;
      }

      // Compose the prompt
      const prompt = buildOpenCodePrompt(meta.name, sha, diffContent);

      yield* log.info(
        "Launching interactive OpenCode session with plan agent...",
      );

      yield* launcher
        .suspendArgv(["opencode", "--prompt", prompt, "--agent", "plan"], {
          cwd: publicDotfiles,
        })
        .pipe(
          Effect.catch((err) => {
            return log.error("OpenCode session exited with an error.");
          }),
        );

      // Check for changes after session
      const diffOutput = yield* executor
        .run("git", [
          "-C",
          publicDotfiles,
          "diff",
          "--",
          meta.dir,
          join(publicDotfiles, "imports.json"),
        ])
        .pipe(Effect.catch(() => Effect.succeed("")));

      if (diffOutput.trim()) {
        yield* log.section(`Changes in ${meta.name}`);
        yield* log.info(diffOutput);

        // Prompt: commit / skip / quit
        const choice = yield* promptReviewAction(meta.name, launcher, log);
        if (choice === "commit") {
          if (!existsSync(join(meta.dir, "SKILL.md"))) {
            yield* log.warn(
              `  ${meta.name}: SKILL.md was removed during review; not auto-committing a skill deletion. If intended, remove and commit it manually; otherwise restore with: git -C "${publicDotfiles}" checkout -- "${meta.dir}"`,
            );
          } else {
            const paths = [meta.dir, join(publicDotfiles, "imports.json")];
            const staged = yield* stageIn(
              { mode: "paths", paths },
              { cwd: publicDotfiles },
            );
            if (!staged.ok) {
              yield* log.error(staged.error ?? "git add failed");
              continue;
            }
            const message = `Update skill: ${meta.name}`;
            const outcome = yield* commitIn({
              cwd: publicDotfiles,
              message,
              paths,
              noVerify: true,
              tolerateEmpty: true,
            });
            if (!outcome.ok) {
              yield* log.error(outcome.error ?? "git commit failed");
              continue;
            }
            if (outcome.committed) yield* log.info(`Committed: ${message}`);
          }
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
function buildOpenCodePrompt(
  skillName: string,
  upstreamSha: string,
  diffContent: string,
): string {
  return `The following diff report shows upstream changes to the imported skill "${skillName}" which has local edits.
All diff content is provided below — do NOT fetch from GitHub or run git commands to obtain this information.
Use the Read tool to read the current local skill files when applying changes.

IMPORTANT: \`imports.json\` is the maintenance metadata source. Preserve its
origin, licence, and local-edits fields. After accepting or deliberately rejecting
the reviewed upstream changes, set this skill's \`upstreamSha\` to
\`${upstreamSha}\`, then run \`python scripts/import_skill.py ${skillName} --metadata-only\`
to materialise the metadata into SKILL.md.

Steps:
1. Summarise what changed upstream (new sections, removed content, reworded guidance, new patterns).
2. Identify which local edits should be preserved (noted in the local-edits frontmatter or intentional divergences).
3. If the diff introduces NO new upstream content (only removes locally-added sections, or all
   changes are already covered by local edits), state "no changes needed" and stop immediately.
   Do NOT ask questions or propose edits in this case.
4. Propose a plan for integrating worthwhile upstream changes while preserving local edits.
5. Ask clarifying questions before applying any changes.
6. Run \`python scripts/validate.py\` after applying changes.

<skill-updates-diff>
${diffContent}
</skill-updates-diff>`;
}

/** Prompt user for review action (commit/skip/quit) using gum */
const promptReviewAction = (
  skillName: string,
  launcher: Pick<LauncherService, "suspend">,
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
