import { Effect } from "effect";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { gitOutput } from "../../lib/git.js";
import { parseDefaultBranch, resolveDefaultRemote } from "../remotes.js";
import { formatRelativeTimeAgo } from "../services/relativeTime.js";
import { handleCommandError, writeText } from "./rows.js";

/** Extra diff detail controls for {@link gitStatusRaw}. */
export interface GitStatusOptions {
  /**
   * Append the full unified diffs of unstaged and staged changes beneath the
   * respective working-tree sections.
   */
  readonly diff: boolean;
  /**
   * Append the full diff of the current branch against the default branch,
   * measured from their merge base so committed branch work and uncommitted
   * edits both show. Fails when HEAD is already on the default branch.
   */
  readonly branchDiff: boolean;
}

const handleStatusError = handleCommandError("dot git-status");

/**
 * Number of recent commits to list when HEAD is on the repo's default branch.
 * On a feature branch the full set of branch-unique commits is listed instead,
 * with no limit.
 */
const RECENT_COMMIT_LIMIT = 10;

/**
 * Record separator (0x1E) prefixing each commit header in the `git log`
 * format string. File status lines from `--name-status` never start with this
 * byte, so it cleanly delimits commit headers from their file lists.
 */
const COMMIT_SEPARATOR = "\x1e";

/** Attempt to run a git command, returning empty string on failure. */
function tryGit(
  args: readonly string[],
): Effect.Effect<string, never, CommandExecutor> {
  return gitOutput(args).pipe(
    Effect.map((output) => output.trim()),
    Effect.catch(() => Effect.succeed("")),
  );
}

/** Added/deleted line counts for a single file. `null` denotes a binary file. */
interface DiffCounts {
  readonly added: number | null;
  readonly deleted: number | null;
}

/**
 * Parse `git diff --numstat` output (`added\tdeleted\tpath`) into a map keyed
 * by path. Binary files report `-` for both counts and map to `null`.
 */
function parseNumstat(numstat: string): Map<string, DiffCounts> {
  const map = new Map<string, DiffCounts>();
  for (const line of numstat.split("\n")) {
    if (!line.trim()) continue;
    const [addedField = "", deletedField = "", ...pathParts] = line.split("\t");
    const path = pathParts.join("\t");
    if (!path) continue;
    map.set(path, {
      added: addedField === "-" ? null : Number(addedField),
      deleted: deletedField === "-" ? null : Number(deletedField),
    });
  }
  return map;
}

/**
 * Append a `(+added -deleted)` (or `(binary)`) suffix to a `--name-status`
 * line using counts looked up by its path. Returns the line unchanged when no
 * counts are available (e.g. renames whose numstat key differs).
 */
function formatFileWithCounts(
  line: string,
  numstat: Map<string, DiffCounts>,
): string {
  const parts = line.split("\t");
  const path = parts[parts.length - 1] ?? "";
  const counts = numstat.get(path);
  if (!counts) return line;
  if (counts.added === null || counts.deleted === null)
    return `${line}  (binary)`;
  return `${line}  (+${counts.added} -${counts.deleted})`;
}

/** Render `--name-status` text with per-file line counts merged in. */
function appendCounts(
  nameStatus: string,
  numstat: Map<string, DiffCounts>,
): string {
  return nameStatus
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => formatFileWithCounts(line, numstat))
    .join("\n");
}

/**
 * Parse `git log --numstat` output delimited by {@link COMMIT_SEPARATOR} into a
 * per-commit map of path → counts, keyed by full commit hash.
 */
function parseNumstatLog(output: string): Map<string, Map<string, DiffCounts>> {
  const byCommit = new Map<string, Map<string, DiffCounts>>();
  let current: Map<string, DiffCounts> | null = null;
  for (const line of output.split("\n")) {
    if (line.startsWith(COMMIT_SEPARATOR)) {
      current = new Map<string, DiffCounts>();
      byCommit.set(line.slice(COMMIT_SEPARATOR.length).trim(), current);
    } else if (current && line.trim()) {
      const [addedField = "", deletedField = "", ...pathParts] =
        line.split("\t");
      const path = pathParts.join("\t");
      if (!path) continue;
      current.set(path, {
        added: addedField === "-" ? null : Number(addedField),
        deleted: deletedField === "-" ? null : Number(deletedField),
      });
    }
  }
  return byCommit;
}

/**
 * CLI output: concise branch status for agent consumption.
 *
 * Outputs unstaged files, staged files, and recent commits — each with a
 * compact relative timestamp, a pushed/local remote marker, and its changed
 * files inline — in a single invocation. On a feature branch the commit list
 * covers every commit unique to the branch (`<defaultBranch>..HEAD`) with no
 * limit; on the default branch it covers the last {@link RECENT_COMMIT_LIMIT}
 * commits. Designed to be the one command agents run to get full working-tree
 * and branch context.
 *
 * {@link GitStatusOptions} layer optional detail on top of the summary:
 * `diff` appends full unstaged and staged diffs under their sections, and
 * `branchDiff` appends the merge-base diff against the default branch (and
 * fails when HEAD is on the default branch, where that range is empty).
 */
export function gitStatusRaw(
  options: GitStatusOptions,
): Effect.Effect<void, never, CommandExecutor> {
  return Effect.gen(function* () {
    const branch = yield* tryGit(["branch", "--show-current"]);
    const remotesOutput = yield* tryGit(["remote"]);
    const { remote } = resolveDefaultRemote(remotesOutput);

    let defaultBranch = "main";
    const symbolicRef = yield* tryGit([
      "symbolic-ref",
      `refs/remotes/${remote}/HEAD`,
    ]);
    if (symbolicRef) {
      defaultBranch = parseDefaultBranch(symbolicRef, remote);
    }

    // Compare against the branch's upstream tracking ref so locally committed
    // work that has not been pushed yet always shows, even on the default
    // branch. Fall back to the remote's default branch when no upstream is set.
    const upstream = yield* tryGit([
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{upstream}",
    ]);
    const baseRef = upstream || `${remote}/${defaultBranch}`;

    // `--name-status` gives the change type (M/A/D/R); `--numstat` gives line
    // counts. Git emits only one when both are passed, so fetch separately and
    // merge by path to show each file's status and `(+added -deleted)`.
    const unstaged = appendCounts(
      yield* tryGit(["diff", "--name-status"]),
      parseNumstat(yield* tryGit(["diff", "--numstat"])),
    );
    const staged = appendCounts(
      yield* tryGit(["diff", "--cached", "--name-status"]),
      parseNumstat(yield* tryGit(["diff", "--cached", "--numstat"])),
    );

    // Full working-tree diffs, only fetched when --diff is requested. Empty
    // output means the section has no changes and renders no diff block.
    const unstagedDiff = options.diff ? yield* tryGit(["diff"]) : "";
    const stagedDiff = options.diff ? yield* tryGit(["diff", "--cached"]) : "";

    // A commit is "pushed" when it is reachable from the base ref. `rev-list
    // base..HEAD` lists exactly the local commits not yet on the remote;
    // everything else in recent history is already pushed. When the base ref
    // does not exist (no remote tracking), treat all commits as local.
    const baseExists =
      (yield* tryGit(["rev-parse", "--verify", "--quiet", baseRef])) !== "";
    const aheadOutput = baseExists
      ? yield* tryGit(["rev-list", `${baseRef}..HEAD`])
      : "";
    const aheadHashes = new Set(
      aheadOutput
        .split("\n")
        .map((line) => line.trim())
        .filter(Boolean),
    );

    // Scope the recent-commit list. On a feature branch, list every commit
    // unique to the branch (`<defaultBranch>..HEAD`) with no count limit so the
    // full branch story shows. On the default branch itself — or when its remote
    // ref cannot be resolved — fall back to the last RECENT_COMMIT_LIMIT commits.
    // The fork base uses the remote's default branch (origin/HEAD), independent
    // of the current branch's own upstream used for push-status above.
    const defaultBranchRef = `${remote}/${defaultBranch}`;
    const onDefaultBranch = branch === defaultBranch;
    const defaultRefExists =
      !onDefaultBranch &&
      (yield* tryGit([
        "rev-parse",
        "--verify",
        "--quiet",
        defaultBranchRef,
      ])) !== "";

    // Resolve --branch-diff before emitting any output so failures surface
    // cleanly instead of trailing a half-printed status. The diff is measured
    // from the merge base so committed branch work and uncommitted edits show.
    const branchDiff = options.branchDiff
      ? yield* resolveBranchDiff({
          branch,
          defaultBranch,
          defaultBranchRef,
          onDefaultBranch,
          defaultRefExists,
        })
      : undefined;

    const forkBase = defaultRefExists ? defaultBranchRef : null;
    const rangeArgs = commitRangeArgs(forkBase);

    // Fields per commit: full hash, short hash, committer ISO date, subject.
    // `--name-status` appends each commit's changed files beneath its header so
    // they render inline and contextual to the commit that made them. A parallel
    // `--numstat` log supplies per-file line counts merged in during parsing.
    const logOutput = yield* tryGit([
      "log",
      "--name-status",
      `--format=${COMMIT_SEPARATOR}%H%x09%h%x09%cI%x09%s`,
      ...rangeArgs,
    ]);
    const numstatLog = yield* tryGit([
      "log",
      "--numstat",
      `--format=${COMMIT_SEPARATOR}%H`,
      ...rangeArgs,
    ]);
    const commits = parseCommits(
      logOutput,
      aheadHashes,
      baseExists,
      parseNumstatLog(numstatLog),
    );

    // On the basic command (no detail flag), point at the contextual full-diff
    // flag. --branch-diff only works on a feature branch with a resolvable
    // default ref (forkBase set), so the default branch falls back to --diff.
    const hint =
      options.diff || options.branchDiff
        ? undefined
        : forkBase
          ? `Run \`dot git-status --branch-diff\` for the full diff vs ${forkBase}.`
          : "Run `dot git-status --diff` for the full staged and unstaged diff.";

    yield* writeText(
      formatStatus({
        branch,
        baseRef,
        unstaged,
        staged,
        unstagedDiff: options.diff ? unstagedDiff : undefined,
        stagedDiff: options.diff ? stagedDiff : undefined,
        branchDiff,
        commits,
        commitsHeading: forkBase
          ? `Branch commits since ${forkBase} (↑ local, ✓ pushed):`
          : "Recent commits (↑ local, ✓ pushed):",
        hint,
      }),
    );
  }).pipe(Effect.withSpan("gitStatus.raw"), handleStatusError);
}

/** Resolved default-branch diff details rendered by `--branch-diff`. */
interface BranchDiffSection {
  /** Default branch ref the diff is computed against (e.g. `origin/main`). */
  readonly ref: string;
  /** Abbreviated merge-base commit the working tree is diffed against. */
  readonly mergeBase: string;
  /** Full unified diff: committed branch work plus uncommitted edits. */
  readonly diff: string;
}

/** Inputs needed to resolve the `--branch-diff` section. */
interface BranchDiffContext {
  /** Current branch name, empty when HEAD is detached. */
  readonly branch: string;
  /** Resolved default branch name (e.g. `main`). */
  readonly defaultBranch: string;
  /** Remote-qualified default branch ref (e.g. `origin/main`). */
  readonly defaultBranchRef: string;
  /** Whether HEAD is on the default branch. */
  readonly onDefaultBranch: boolean;
  /** Whether {@link BranchDiffContext.defaultBranchRef} resolves to a commit. */
  readonly defaultRefExists: boolean;
}

/**
 * Compute the merge-base diff of HEAD against the default branch for
 * `--branch-diff`. Fails (with a CLI-friendly message) when HEAD is on the
 * default branch — where the range is empty by definition — or when the
 * default branch ref or merge base cannot be resolved.
 */
function resolveBranchDiff(
  context: BranchDiffContext,
): Effect.Effect<BranchDiffSection, Error, CommandExecutor> {
  return Effect.gen(function* () {
    if (context.onDefaultBranch) {
      return yield* Effect.fail(
        new Error(
          `On the default branch (${context.defaultBranch}); --branch-diff requires a feature branch.`,
        ),
      );
    }
    if (!context.defaultRefExists) {
      return yield* Effect.fail(
        new Error(
          `Cannot resolve default branch ref '${context.defaultBranchRef}' for --branch-diff.`,
        ),
      );
    }

    // Diff from the merge base (not the branch tip) so committed branch work
    // and uncommitted working-tree edits both appear in one diff.
    const mergeBase = yield* tryGit([
      "merge-base",
      context.defaultBranchRef,
      "HEAD",
    ]);
    if (!mergeBase) {
      return yield* Effect.fail(
        new Error(
          `Cannot find a merge base between ${context.defaultBranchRef} and HEAD for --branch-diff.`,
        ),
      );
    }

    const diff = yield* tryGit(["diff", mergeBase]);
    return {
      ref: context.defaultBranchRef,
      mergeBase: mergeBase.slice(0, 7),
      diff,
    };
  });
}

/** A single recent commit with its remote status and changed files. */
interface CommitRecord {
  /** Abbreviated commit hash. */
  readonly shortHash: string;
  /** Compact relative time since the commit was made (e.g. "2h ago"). */
  readonly relativeTime: string;
  /** Commit subject line. */
  readonly subject: string;
  /** Whether the commit is reachable from the remote base ref. */
  readonly pushed: boolean;
  /** `--name-status` lines for files changed by the commit, with line counts. */
  readonly files: readonly string[];
}

/**
 * Build the trailing `git log` revision arguments that scope which commits the
 * status output lists.
 *
 * On a feature branch (HEAD is not the repo's default branch and the default
 * branch ref is resolvable), every commit unique to the branch is listed via
 * `<defaultBranch>..HEAD`, with no count limit. On the default branch — or when
 * the fork base cannot be resolved — the last {@link RECENT_COMMIT_LIMIT}
 * commits reachable from `HEAD` are listed instead.
 */
function commitRangeArgs(forkBase: string | null): readonly string[] {
  if (forkBase) return [`${forkBase}..HEAD`];
  return ["-n", String(RECENT_COMMIT_LIMIT), "HEAD"];
}

/**
 * Parse `git log --name-status` output (delimited by {@link COMMIT_SEPARATOR})
 * into structured commit records, marking each as pushed or local and merging
 * per-file line counts from {@link parseNumstatLog}.
 */
function parseCommits(
  logOutput: string,
  aheadHashes: ReadonlySet<string>,
  baseExists: boolean,
  numstatByCommit: Map<string, Map<string, DiffCounts>>,
): readonly CommitRecord[] {
  const records: {
    shortHash: string;
    relativeTime: string;
    subject: string;
    pushed: boolean;
    files: string[];
  }[] = [];
  let currentNumstat: Map<string, DiffCounts> = new Map();

  for (const rawLine of logOutput.split("\n")) {
    if (rawLine.startsWith(COMMIT_SEPARATOR)) {
      const [fullHash = "", shortHash = "", isoDate = "", subject = ""] =
        rawLine.slice(COMMIT_SEPARATOR.length).split("\t");
      currentNumstat = numstatByCommit.get(fullHash) ?? new Map();
      records.push({
        shortHash,
        relativeTime: formatRelativeTimeAgo(isoDate),
        subject,
        pushed: baseExists && !aheadHashes.has(fullHash),
        files: [],
      });
    } else {
      const trimmed = rawLine.trim();
      const current = records[records.length - 1];
      if (current && trimmed) {
        current.files.push(formatFileWithCounts(trimmed, currentNumstat));
      }
    }
  }

  return records;
}

/** Aggregated working-tree and recent-commit status for rendering. */
interface StatusData {
  readonly branch: string;
  readonly baseRef: string;
  readonly unstaged: string;
  readonly staged: string;
  /** Full unstaged diff to render under the section, when `--diff` is set. */
  readonly unstagedDiff?: string;
  /** Full staged diff to render under the section, when `--diff` is set. */
  readonly stagedDiff?: string;
  /** Default-branch diff to append, when `--branch-diff` is set. */
  readonly branchDiff?: BranchDiffSection;
  readonly commits: readonly CommitRecord[];
  /** Heading for the commit list, reflecting its scope (branch vs recent). */
  readonly commitsHeading: string;
  /** Trailing discoverability tip for the full-diff flags, when applicable. */
  readonly hint?: string;
}

/**
 * Append a blank separator line followed by a unified diff, but only when the
 * diff has content. A `--diff` section with no changes (empty string) or one
 * not requested (`undefined`) adds nothing beyond the file list above it.
 */
function appendDiffBlock(lines: string[], diff: string | undefined): void {
  if (!diff) return;
  lines.push("");
  lines.push(diff);
}

function formatStatus(data: StatusData): string {
  const lines: string[] = [];

  lines.push(`Branch: ${data.branch || "(detached)"}`);
  lines.push(`Base: ${data.baseRef}`);
  lines.push("");

  lines.push("Unstaged:");
  lines.push(data.unstaged || "  (none)");
  appendDiffBlock(lines, data.unstagedDiff);
  lines.push("");

  lines.push("Staged:");
  lines.push(data.staged || "  (none)");
  appendDiffBlock(lines, data.stagedDiff);
  lines.push("");

  lines.push(data.commitsHeading);
  if (data.commits.length === 0) {
    lines.push("  (none)");
  } else {
    for (const commit of data.commits) {
      const marker = commit.pushed ? "✓" : "↑";
      lines.push(
        `${marker} ${commit.shortHash} ${commit.relativeTime} — ${commit.subject}`,
      );
      for (const file of commit.files) {
        lines.push(`    ${file}`);
      }
    }
  }

  if (data.branchDiff) {
    lines.push("");
    lines.push(
      `Diff vs ${data.branchDiff.ref} (merge-base ${data.branchDiff.mergeBase}):`,
    );
    lines.push(data.branchDiff.diff || "  (no differences)");
  }

  if (data.hint) {
    lines.push("");
    lines.push(data.hint);
  }

  return lines.join("\n") + "\n";
}
