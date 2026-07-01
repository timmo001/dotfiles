import { Effect } from "effect";
import { gitOutput, gitRequired } from "../../lib/git.js";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { normalizeGitHubSlug } from "../../services/GitConfig.js";
import { GitStaging } from "../services/GitStaging.js";
import { resolveDefaultRemote, parseDefaultBranch } from "../remotes.js";
import { handleCommandError, writeText } from "./rows.js";

/**
 * Soft length threshold for a commit subject. Subjects longer than this warn on
 * stderr but still commit. Derived from the maintainer's hand-written commit
 * history (median 38, p90 62), nudging toward the concise end without blocking
 * legitimate descriptive subjects.
 */
export const COMMIT_SUBJECT_SOFT = 60;

/**
 * Hard length limit for a commit subject. Subjects longer than this are
 * rejected. Set well above the maintainer's p99 (86) so it only stops runaway
 * multi-clause subjects, not normal commits.
 */
export const COMMIT_SUBJECT_MAX = 120;

/** Result of validating a commit subject against the message guards. */
export interface CommitMessageCheck {
  /** Whether the subject passed every hard guard. */
  readonly ok: boolean;
  /** Normalised (trimmed) subject to commit with. */
  readonly subject: string;
  /** Hard-guard failures that block the commit. */
  readonly errors: readonly string[];
  /** Soft-guard notes that warn but do not block. */
  readonly warnings: readonly string[];
}

/**
 * Characters rejected in a commit subject, with the guidance shown when one is
 * found. The maintainer's writing style forbids em- and en-dashes (and their
 * longer typographic cousins) as sentence punctuation; a hyphen is the
 * replacement.
 */
const FORBIDDEN_CHARACTERS: readonly {
  readonly char: string;
  readonly label: string;
}[] = [
  { char: "\u2014", label: "em-dash (\u2014)" },
  { char: "\u2013", label: "en-dash (\u2013)" },
  { char: "\u2015", label: "horizontal bar (\u2015)" },
  { char: "\u2012", label: "figure dash (\u2012)" },
];

/**
 * C0 control characters (excluding the `\r`/`\n` caught by the single-line
 * guard) that must never appear in a subject, tab included.
 */
const CONTROL_CHARACTERS = /[\u0000-\u0009\u000B\u000C\u000E-\u001F]/;

/** Curly/smart quotes that should be plain straight quotes in a subject. */
const SMART_QUOTES = /[\u2018\u2019\u201C\u201D]/;

/** Two or more consecutive spaces, usually an accidental double space. */
const DOUBLE_SPACE = / {2,}/;

/** Inputs for the branch-protection guard, all pre-resolved. */
export interface BranchProtectionInput {
  /** Owner segment of the origin repo slug, or null when not a GitHub remote. */
  readonly owner: string | null;
  /** Full origin `owner/repo` slug for the message, or null. */
  readonly slug: string | null;
  /** Current branch name (empty when detached). */
  readonly branch: string;
  /** Owners the user controls, from `git config --get-all dot.owner`. */
  readonly myOwners: readonly string[];
  /** Branch names treated as protected. */
  readonly protectedBranches: readonly string[];
}

/**
 * Return a rejection reason when the commit targets a protected branch on a
 * repo the user does not own, otherwise null. The guard is opt-in: with no
 * `dot.owner` configured it never fires, and a repo whose owner is in
 * `dot.owner` is always allowed (you commit to your own default branches
 * freely). Pure and side-effect free.
 */
export function branchProtectionError(
  input: BranchProtectionInput,
): string | null {
  if (input.myOwners.length === 0) return null;
  if (!input.owner || !input.slug || !input.branch) return null;

  const mine = new Set(input.myOwners.map((owner) => owner.toLowerCase()));
  if (mine.has(input.owner.toLowerCase())) return null;

  const protectedSet = new Set(
    input.protectedBranches.map((branch) => branch.toLowerCase()),
  );
  if (!protectedSet.has(input.branch.toLowerCase())) return null;

  return `Refusing to commit to protected branch '${input.branch}' on ${input.slug}: you do not own this repo. Use a feature branch.`;
}

/**
 * Validate a commit subject against the maintainer's style guards: single line,
 * non-empty, no forbidden punctuation, no trailing full stop, and within the
 * length limits. Conventional Commit prefixes are intentionally left alone so
 * the gateway works in repos that use them. Pure and side-effect free.
 */
export function validateCommitMessage(raw: string): CommitMessageCheck {
  const subject = raw.trim();
  const errors: string[] = [];
  const warnings: string[] = [];

  if (subject.length === 0) {
    return {
      ok: false,
      subject,
      errors: ["Commit message is empty."],
      warnings,
    };
  }

  if (/[\r\n]/.test(subject)) {
    errors.push(
      "Commit message must be a single line: one concise subject, no body.",
    );
  }
  if (CONTROL_CHARACTERS.test(subject)) {
    errors.push("Commit subject must not contain tabs or control characters.");
  }
  for (const { char, label } of FORBIDDEN_CHARACTERS) {
    if (subject.includes(char)) {
      errors.push(`Commit subject must not contain an ${label}; use a hyphen.`);
    }
  }
  if (subject.endsWith(".")) {
    errors.push("Commit subject must not end with a full stop.");
  }

  // Count Unicode code points so the limit reflects visible characters.
  const length = [...subject].length;
  if (length > COMMIT_SUBJECT_MAX) {
    errors.push(
      `Commit subject is ${length} characters; keep it under ${COMMIT_SUBJECT_MAX}.`,
    );
  } else if (length > COMMIT_SUBJECT_SOFT) {
    warnings.push(
      `Commit subject is ${length} characters; aim for ${COMMIT_SUBJECT_SOFT} or fewer.`,
    );
  }

  if (SMART_QUOTES.test(subject)) {
    warnings.push("Commit subject uses curly quotes; prefer straight quotes.");
  }
  if (subject.includes("\u00A0")) {
    warnings.push("Commit subject contains a non-breaking space (U+00A0).");
  }
  if (DOUBLE_SPACE.test(subject)) {
    warnings.push("Commit subject has a double space.");
  }
  if (!/\s/.test(subject)) {
    warnings.push(
      "Commit subject is a single word; prefer a few words describing the change.",
    );
  }

  return { ok: errors.length === 0, subject, errors, warnings };
}

/** Options controlling a single `dot git-commit` invocation. */
export interface GitCommitOptions {
  /** Commit subject from `--message`/`-m`. */
  readonly message: string | undefined;
  /** Explicit file scope from repeated `--path`; empty commits the staged set. */
  readonly paths: readonly string[];
  /** Whether to push the current branch after committing. */
  readonly push: boolean;
  /** Preview the plan without staging, committing, or pushing. */
  readonly dryRun: boolean;
}

const handleCommitError = handleCommandError("dot git-commit");

/** Fail the command with a plain message rendered by {@link handleCommitError}. */
function failCommit(message: string): Effect.Effect<never, Error> {
  return Effect.fail(new Error(message));
}

/** Run a read-only git command, resolving to trimmed stdout or "" on failure. */
function readGit(
  args: readonly string[],
): Effect.Effect<string, never, CommandExecutor> {
  return gitOutput(args).pipe(
    Effect.map((output) => output.trim()),
    Effect.catch(() => Effect.succeed("")),
  );
}

/** Read a multi-valued git config key into trimmed, non-empty values. */
function readGitConfigAll(
  key: string,
): Effect.Effect<readonly string[], never, CommandExecutor> {
  return gitOutput(["config", "--get-all", key]).pipe(
    Effect.map((output) =>
      output
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    ),
    Effect.catch(() => Effect.succeed([] as readonly string[])),
  );
}

/**
 * Resolve the protected-branch guard against the origin repo owner and the
 * configured owner allowlist, returning a rejection reason or null.
 */
function checkBranchProtection(): Effect.Effect<
  string | null,
  never,
  CommandExecutor
> {
  return Effect.gen(function* () {
    const branch = yield* readGit(["branch", "--show-current"]);
    const slug = normalizeGitHubSlug(
      yield* readGit(["remote", "get-url", "origin"]),
    );
    const owner = slug ? (slug.split("/")[0] ?? null) : null;
    const myOwners = yield* readGitConfigAll("dot.owner");
    const extraProtected = yield* readGitConfigAll("dot.protectedBranch");
    return branchProtectionError({
      owner,
      slug,
      branch,
      myOwners,
      protectedBranches: [
        ...(yield* resolveDefaultBranch()),
        ...extraProtected,
      ],
    });
  });
}

/**
 * Resolve the repo's default branch from `<remote>/HEAD`. This is the branch you
 * should not commit to directly on a repo you do not own; no branch names are
 * assumed. Returns an empty list when it cannot be resolved, so the guard fails
 * open rather than blocking on a guess.
 */
function resolveDefaultBranch(): Effect.Effect<
  readonly string[],
  never,
  CommandExecutor
> {
  return Effect.gen(function* () {
    const { remote } = resolveDefaultRemote(yield* readGit(["remote"]));
    const symbolicRef = yield* readGit([
      "symbolic-ref",
      `refs/remotes/${remote}/HEAD`,
    ]);
    return symbolicRef ? [parseDefaultBranch(symbolicRef, remote)] : [];
  });
}

/** Write a line to stderr without failing. */
function writeStderr(text: string): Effect.Effect<void> {
  return Effect.sync(() => process.stderr.write(text));
}

/**
 * CLI entry point: the safe commit gateway agents use instead of raw
 * `git commit`. Validates the subject against the style guards, commits either
 * the staged set or an explicit `--path` scope (never `git add -A`), and
 * optionally pushes the current branch without ever forcing.
 */
export function gitCommitRaw(
  options: GitCommitOptions,
): Effect.Effect<void, never, CommandExecutor | GitStaging> {
  return Effect.gen(function* () {
    const insideWorkTree = yield* readGit([
      "rev-parse",
      "--is-inside-work-tree",
    ]);
    if (insideWorkTree !== "true") {
      return yield* failCommit("Not inside a git repository.");
    }

    const protection = yield* checkBranchProtection();
    if (protection) {
      return yield* failCommit(protection);
    }

    if (options.message === undefined) {
      return yield* failCommit(
        'A commit message is required. Pass --message "<subject>".',
      );
    }

    const check = validateCommitMessage(options.message);
    for (const warning of check.warnings) {
      yield* writeStderr(`[dot git-commit] warning: ${warning}\n`);
    }
    if (!check.ok) {
      return yield* failCommit(check.errors.join(" "));
    }
    const subject = check.subject;

    const staging = yield* GitStaging;
    const status = yield* staging.getStatus(process.cwd());
    const stagedFiles = [
      ...new Set(status.filter((file) => file.staged).map((file) => file.path)),
    ];
    const scoped = options.paths.length > 0;

    if (options.dryRun) {
      return yield* reportDryRun({
        subject,
        scoped,
        paths: options.paths,
        staged: stagedFiles,
        push: options.push,
      });
    }

    if (scoped) {
      for (const path of options.paths) {
        yield* staging.stageFile(process.cwd(), path);
      }
      yield* staging.commit(process.cwd(), subject, options.paths);
    } else {
      if (stagedFiles.length === 0) {
        return yield* failCommit(
          "Nothing staged. Stage changes first, or pass --path <file> to commit specific files.",
        );
      }
      yield* staging.commit(process.cwd(), subject);
    }

    const shortHash = yield* readGit(["rev-parse", "--short", "HEAD"]);
    const committed = scoped ? options.paths : stagedFiles;
    yield* writeText(formatCommitReport(shortHash, subject, committed));

    if (options.push) {
      yield* pushCurrentBranch;
    }
  }).pipe(Effect.withSpan("gitCommit.raw"), handleCommitError);
}

/** Inputs for the `--dry-run` plan preview. */
interface DryRunInput {
  readonly subject: string;
  readonly scoped: boolean;
  readonly paths: readonly string[];
  readonly staged: readonly string[];
  readonly push: boolean;
}

/** Print what a real run would stage, commit, and push, changing nothing. */
function reportDryRun(
  input: DryRunInput,
): Effect.Effect<void, never, CommandExecutor> {
  return Effect.gen(function* () {
    const lines = [`[dry-run] Would commit: ${input.subject}`];
    const files = input.scoped ? input.paths : input.staged;
    if (!input.scoped && input.staged.length === 0) {
      lines.push("  nothing staged (would fail without --path)");
    } else {
      lines.push(`  ${files.length} file(s): ${files.join(", ")}`);
    }
    if (input.push) {
      lines.push(`[dry-run] Would push: ${yield* describePushTarget}`);
    }
    yield* writeText(`${lines.join("\n")}\n`);
  });
}

/** Resolve a human description of where the current branch would push to. */
const describePushTarget: Effect.Effect<string, never, CommandExecutor> =
  Effect.gen(function* () {
    const branch = yield* readGit(["branch", "--show-current"]);
    const upstream = yield* readGit([
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{upstream}",
    ]);
    if (upstream) return upstream;
    const { remote } = resolveDefaultRemote(yield* readGit(["remote"]));
    return `${remote}/${branch || "(detached)"} (new upstream)`;
  });

/**
 * Push the current branch. Uses the existing upstream when set, otherwise sets
 * one via `-u` against the resolved default remote. Never force-pushes.
 */
const pushCurrentBranch = Effect.gen(function* () {
  const branch = yield* readGit(["branch", "--show-current"]);
  if (!branch) {
    return yield* failCommit("Cannot push from a detached HEAD.");
  }
  const upstream = yield* readGit([
    "rev-parse",
    "--abbrev-ref",
    "--symbolic-full-name",
    "@{upstream}",
  ]);
  if (upstream) {
    yield* gitRequired(["push"]);
    yield* writeText(`Pushed to ${upstream}\n`);
  } else {
    const { remote } = resolveDefaultRemote(yield* readGit(["remote"]));
    yield* gitRequired(["push", "-u", remote, branch]);
    yield* writeText(`Pushed to ${remote}/${branch} (new upstream)\n`);
  }
});

/** Format the post-commit summary line and its file list. */
function formatCommitReport(
  shortHash: string,
  subject: string,
  files: readonly string[],
): string {
  const list =
    files.length > 0 ? `\n  ${files.length} file(s): ${files.join(", ")}` : "";
  const hash = shortHash ? `${shortHash} ` : "";
  return `Committed ${hash}${subject}${list}\n`;
}
