import { Effect } from "effect";
import { gitInheritExitCode, gitOutput, gitRequired } from "../../lib/git.js";
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

/** A git remote and its normalised GitHub `owner/repo` slug, if any. */
export interface RemoteRef {
  /** Remote name, e.g. `origin` or `upstream`. */
  readonly name: string;
  /** Normalised `owner/repo` slug, or null when not a GitHub remote. */
  readonly slug: string | null;
}

/** Parse `git remote -v` output into one {@link RemoteRef} per remote name. */
export function parseRemotes(remoteVerbose: string): readonly RemoteRef[] {
  const byName = new Map<string, string | null>();
  for (const line of remoteVerbose.split("\n")) {
    const [name, url] = line.trim().split(/\s+/);
    if (!name || !url) continue;
    if (!byName.has(name)) byName.set(name, normalizeGitHubSlug(url));
  }
  return [...byName].map(([name, slug]) => ({ name, slug }));
}

/**
 * Return the `owner/repo` slug of a remote owned by someone outside the user's
 * `dot.owner` allowlist, marking the repo as one to PR to rather than commit to
 * directly. This catches both a direct clone of someone else's repo (foreign
 * `origin`) and a fork kept for upstream PRs (foreign `upstream`). Prefers
 * `upstream`, then `origin`, then any other remote. Returns null when every
 * remote is the user's own (including a takeover fork with no foreign remote)
 * or when no owners are configured, keeping the guard opt-in. Pure.
 */
export function foreignRemoteSlug(
  remotes: readonly RemoteRef[],
  myOwners: readonly string[],
): string | null {
  if (myOwners.length === 0) return null;
  const mine = new Set(myOwners.map((owner) => owner.toLowerCase()));
  const isForeign = (remote: RemoteRef): boolean =>
    remote.slug !== null &&
    !mine.has((remote.slug.split("/")[0] ?? "").toLowerCase());

  const foreign =
    remotes.find((remote) => remote.name === "upstream" && isForeign(remote)) ??
    remotes.find((remote) => remote.name === "origin" && isForeign(remote)) ??
    remotes.find(isForeign);
  return foreign?.slug ?? null;
}

/** Inputs for the base-branch guard, all pre-resolved. */
export interface BaseBranchGuardInput {
  /** Slug of a repo to PR to, or null when the repo is the user's own. */
  readonly foreignSlug: string | null;
  /** Current branch name (empty when detached). */
  readonly branch: string;
  /** The repo's resolved base/default branch, or null when unresolved. */
  readonly baseBranch: string | null;
}

/**
 * Return a rejection reason when the commit targets the base branch of a repo
 * the user does not own, otherwise null. Working directly on the base branch of
 * someone else's repo, including a fork kept for upstream PRs, is refused; use a
 * feature branch. The user's own repos, takeover forks with no foreign remote,
 * and every non-base branch are allowed. Pure and side-effect free.
 */
export function branchProtectionError(
  input: BaseBranchGuardInput,
): string | null {
  if (!input.foreignSlug || !input.branch || !input.baseBranch) return null;
  if (input.branch.toLowerCase() !== input.baseBranch.toLowerCase()) {
    return null;
  }
  return `Refusing to commit to base branch '${input.branch}' of ${input.foreignSlug}: do not work on the base branch of a repo you do not own. Use a feature branch.`;
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
 * Resolve the base-branch guard: refuse committing to the base branch of a repo
 * the user does not own (a foreign origin, or a fork with a foreign upstream),
 * returning a rejection reason or null.
 */
function checkBranchProtection(): Effect.Effect<
  string | null,
  never,
  CommandExecutor
> {
  return Effect.gen(function* () {
    const remotes = parseRemotes(yield* readGit(["remote", "-v"]));
    const myOwners = yield* readGitConfigAll("dot.owner");
    const foreignSlug = foreignRemoteSlug(remotes, myOwners);
    if (!foreignSlug) return null;

    const branch = yield* readGit(["branch", "--show-current"]);
    const baseBranch = yield* resolveBaseBranch();
    return branchProtectionError({ foreignSlug, branch, baseBranch });
  });
}

/**
 * Resolve the repo's base branch from `origin/HEAD`. This is the branch you
 * should not commit to directly on a repo you do not own; no branch names are
 * assumed. Returns null when it cannot be resolved, so the guard fails open
 * rather than blocking on a guess.
 */
function resolveBaseBranch(): Effect.Effect<
  string | null,
  never,
  CommandExecutor
> {
  return Effect.gen(function* () {
    const symbolicRef = yield* readGit([
      "symbolic-ref",
      "refs/remotes/origin/HEAD",
    ]);
    return symbolicRef ? parseDefaultBranch(symbolicRef, "origin") : null;
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
      const { target, hasUpstream } = yield* describePushTarget;
      lines.push(
        hasUpstream
          ? `[dry-run] Would pull --rebase then push: ${target}`
          : `[dry-run] Would push: ${target}`,
      );
    }
    yield* writeText(`${lines.join("\n")}\n`);
  });
}

/** A resolved push target and whether it already has an upstream to rebase on. */
interface PushTarget {
  /** Human description of where the current branch would push to. */
  readonly target: string;
  /** True when an upstream is set, so a real run would pull --rebase first. */
  readonly hasUpstream: boolean;
}

/** Resolve where the current branch would push to and whether it has an upstream. */
const describePushTarget: Effect.Effect<PushTarget, never, CommandExecutor> =
  Effect.gen(function* () {
    const branch = yield* readGit(["branch", "--show-current"]);
    const upstream = yield* readGit([
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{upstream}",
    ]);
    if (upstream) return { target: upstream, hasUpstream: true };
    const { remote } = resolveDefaultRemote(yield* readGit(["remote"]));
    return {
      target: `${remote}/${branch || "(detached)"} (new upstream)`,
      hasUpstream: false,
    };
  });

/**
 * Rebase the current branch onto its upstream before pushing, so a remote that
 * moved ahead (a teammate or bot pushed while you worked) fast-forwards instead
 * of rejecting the push. Autostashes unstaged changes so a scoped `--path`
 * commit that left other edits behind still rebases. On a conflict or any other
 * failure it aborts the rebase to restore the pre-pull state and fails with
 * guidance, keeping the local commit for manual integration. Never force-pushes.
 */
const rebaseOnUpstreamBeforePush = Effect.gen(function* () {
  const exitCode = yield* gitInheritExitCode([
    "pull",
    "--rebase",
    "--autostash",
    "--no-edit",
  ]);
  if (exitCode === 0) return;
  yield* gitInheritExitCode(["rebase", "--abort"]);
  return yield* failCommit(
    "Could not rebase on the upstream before pushing; aborted the rebase and kept your local commit. Integrate the remote changes manually with git pull --rebase, then push.",
  );
});

/**
 * Push the current branch. When an upstream is set, rebases onto it first (see
 * {@link rebaseOnUpstreamBeforePush}) so a moved-ahead remote fast-forwards;
 * otherwise sets a new upstream via `-u` against the resolved default remote.
 * Never force-pushes.
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
    yield* rebaseOnUpstreamBeforePush;
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
