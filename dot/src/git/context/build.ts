/**
 * @file The shared branch-context producer.
 *
 * `buildBranchContext` collects a single {@link BranchContextData} snapshot from
 * git and `gh`, honouring {@link BranchContextOptions} to decide which sections
 * to gather. Both the text renderer (`dot git-context`) and the JSON renderer
 * (the OpenCode branch-context plugin) format that one snapshot, so the two
 * consumers can never drift.
 */
import { Effect } from "effect";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { gitOutput } from "../../lib/git.js";
import { GitHub } from "../services/GitHub.js";
import { parseDefaultBranch, resolveDefaultRemote } from "../remotes.js";
import { formatRelativeTimeAgo } from "../services/relativeTime.js";
import { collectPullRequest } from "./pullRequest.js";
import type {
  BranchContextData,
  BranchContextOptions,
  BranchDiff,
  BranchMetadata,
  CommitRange,
  CommitRecord,
  CommitsSection,
  DiffSection,
  FileChange,
  WorkingTreeStatus,
  WorkScope,
} from "./model.js";

/**
 * Minimum number of recent commits to list when HEAD is on the repo's default
 * branch. On a feature branch the full set of branch-unique commits is listed.
 */
const MIN_RECENT_COMMIT_LIMIT = 10;

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

/** Build a {@link FileChange} from a `--name-status` line and numstat counts. */
function toFileChange(
  line: string,
  numstat: Map<string, DiffCounts>,
): FileChange {
  const parts = line.split("\t");
  const path = parts[parts.length - 1] ?? "";
  const counts = numstat.get(path);
  return {
    raw: line,
    status: parts[0] ?? "",
    path,
    countsKnown: counts !== undefined,
    added: counts ? counts.added : null,
    deleted: counts ? counts.deleted : null,
  };
}

/** Parse `--name-status` text into {@link FileChange} records with counts. */
function toFileChanges(
  nameStatus: string,
  numstat: Map<string, DiffCounts>,
): FileChange[] {
  return nameStatus
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => toFileChange(line, numstat));
}

/**
 * Build the full structured branch-context snapshot. Fails only on an
 * unexpected git error; a missing worktree resolves to `{ inRepo: false }` and
 * PR collection failures degrade to warnings.
 */
export function buildBranchContext(
  options: BranchContextOptions,
): Effect.Effect<BranchContextData, Error, CommandExecutor | GitHub> {
  return Effect.gen(function* () {
    const warnings: string[] = [];

    const inRepo =
      (yield* tryGit(["rev-parse", "--is-inside-work-tree"])) === "true";
    if (!inRepo) {
      return { inRepo: false, pullRequest: null, warnings };
    }

    const remotesOutput = yield* tryGit(["remote"]);
    const { remote, remotes } = resolveDefaultRemote(remotesOutput);

    let defaultBranch = "main";
    const symbolicRef = yield* tryGit([
      "symbolic-ref",
      `refs/remotes/${remote}/HEAD`,
    ]);
    if (symbolicRef) defaultBranch = parseDefaultBranch(symbolicRef, remote);

    const branch = yield* tryGit(["branch", "--show-current"]);
    const onDefaultBranch = branch === defaultBranch;

    // Compare against the branch's upstream tracking ref so locally committed
    // work that has not been pushed yet always shows. Fall back to the remote's
    // default branch when no upstream is set.
    const upstream = yield* tryGit([
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{upstream}",
    ]);
    const baseRef = upstream || `${remote}/${defaultBranch}`;

    const defaultBranchRef = `${remote}/${defaultBranch}`;
    const defaultRefExists =
      !onDefaultBranch &&
      (yield* tryGit([
        "rev-parse",
        "--verify",
        "--quiet",
        defaultBranchRef,
      ])) !== "";
    const forkBase = defaultRefExists ? defaultBranchRef : null;

    const branchMetadata: BranchMetadata | undefined = options.branchMetadata
      ? {
          currentBranch: branch,
          defaultRemote: remote,
          defaultBranch,
          baseRef,
          onDefaultBranch,
          remotes,
        }
      : undefined;

    const status = options.status ? yield* collectStatus() : undefined;

    const workScope = options.workScope
      ? yield* collectWorkScope(forkBase)
      : undefined;

    const commits = yield* collectCommits(forkBase, baseRef, options.since);

    const diffs = yield* collectDiffs(options, {
      branch,
      defaultBranch,
      defaultBranchRef,
      onDefaultBranch,
      defaultRefExists,
    });

    const prResult =
      options.pullRequest && !onDefaultBranch && branch
        ? yield* collectPullRequest(options)
        : { data: null, warnings: [] as readonly string[] };
    warnings.push(...prResult.warnings);

    return {
      inRepo,
      branchMetadata,
      status,
      workScope,
      commits,
      diffs,
      pullRequest: prResult.data,
      warnings,
    };
  }).pipe(Effect.withSpan("branchContext.build"));
}

/** Collect working-tree status: unstaged/staged file lists plus `-sb` text. */
function collectStatus(): Effect.Effect<
  WorkingTreeStatus,
  never,
  CommandExecutor
> {
  return Effect.gen(function* () {
    // `--name-status` gives the change type (M/A/D/R); `--numstat` gives line
    // counts. Git emits only one when both are passed, so fetch separately.
    const unstaged = toFileChanges(
      yield* tryGit(["diff", "--name-status"]),
      parseNumstat(yield* tryGit(["diff", "--numstat"])),
    );
    const staged = toFileChanges(
      yield* tryGit(["diff", "--cached", "--name-status"]),
      parseNumstat(yield* tryGit(["diff", "--cached", "--numstat"])),
    );
    const short = yield* tryGit(["status", "-sb"]);
    return { unstaged, staged, short };
  });
}

/**
 * Collect branch-scope aggregates against the fork base: branch-only commits,
 * branch changed files, and the branch diff stat. Skipped (empty) when HEAD is
 * on the default branch or the fork base cannot be resolved.
 */
function collectWorkScope(
  forkBase: string | null,
): Effect.Effect<WorkScope, never, CommandExecutor> {
  return Effect.gen(function* () {
    if (!forkBase) {
      return {
        skipped: true,
        branchCommits: [],
        branchFiles: [],
        branchDiffStat: "",
      };
    }

    const onelineLog = yield* tryGit(["log", "--oneline", `${forkBase}..HEAD`]);
    const branchCommits = onelineLog
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const spaceIndex = line.indexOf(" ");
        return spaceIndex === -1
          ? { hash: line, subject: "" }
          : {
              hash: line.slice(0, spaceIndex),
              subject: line.slice(spaceIndex + 1),
            };
      });

    const branchFiles = toFileChanges(
      yield* tryGit(["diff", "--name-status", `${forkBase}...HEAD`]),
      parseNumstat(yield* tryGit(["diff", "--numstat", `${forkBase}...HEAD`])),
    );
    const branchDiffStat = yield* tryGit([
      "diff",
      "--stat",
      `${forkBase}...HEAD`,
    ]);

    return { skipped: false, branchCommits, branchFiles, branchDiffStat };
  });
}

/** Collect the recent-commit list (git-context core) with push markers. */
function collectCommits(
  forkBase: string | null,
  baseRef: string,
  since: string | undefined,
): Effect.Effect<CommitsSection, never, CommandExecutor> {
  return Effect.gen(function* () {
    // A commit is "pushed" when it is reachable from the base ref. `rev-list
    // base..HEAD` lists exactly the local commits not yet on the remote.
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

    const range = yield* resolveCommitRange(forkBase, since);

    const logOutput = yield* tryGit([
      "log",
      "--name-status",
      `--format=${COMMIT_SEPARATOR}%H%x09%h%x09%cI%x09%s`,
      ...range.args,
    ]);
    const numstatLog = yield* tryGit([
      "log",
      "--numstat",
      `--format=${COMMIT_SEPARATOR}%H`,
      ...range.args,
    ]);
    const records = parseCommits(
      logOutput,
      aheadHashes,
      baseExists,
      parseNumstatLog(numstatLog),
    );
    return { range, records };
  });
}

/** Collect full-diff blocks requested by `--diff` / `--branch-diff`. */
function collectDiffs(
  options: BranchContextOptions,
  context: BranchDiffContext,
): Effect.Effect<DiffSection | undefined, Error, CommandExecutor> {
  return Effect.gen(function* () {
    if (!options.diff && !options.branchDiff) return undefined;

    const unstaged = options.diff ? yield* tryGit(["diff"]) : undefined;
    const staged = options.diff
      ? yield* tryGit(["diff", "--cached"])
      : undefined;
    const branch = options.branchDiff
      ? yield* resolveBranchDiff(context)
      : undefined;

    return {
      ...(unstaged !== undefined ? { unstaged } : {}),
      ...(staged !== undefined ? { staged } : {}),
      ...(branch !== undefined ? { branch } : {}),
    };
  });
}

/** Inputs needed to resolve the `--branch-diff` section. */
interface BranchDiffContext {
  readonly branch: string;
  readonly defaultBranch: string;
  readonly defaultBranchRef: string;
  readonly onDefaultBranch: boolean;
  readonly defaultRefExists: boolean;
}

/**
 * Compute the merge-base diff of HEAD against the default branch. Fails (with a
 * CLI-friendly message) when HEAD is on the default branch or the default
 * branch ref or merge base cannot be resolved.
 */
function resolveBranchDiff(
  context: BranchDiffContext,
): Effect.Effect<BranchDiff, Error, CommandExecutor> {
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

/**
 * Build the trailing `git log` revision arguments and heading metadata that
 * scope which commits the context lists. On a feature branch, list every commit
 * unique to the branch; on the default branch, list whichever is larger: the
 * commits from today or the last {@link MIN_RECENT_COMMIT_LIMIT} commits.
 */
function resolveCommitRange(
  forkBase: string | null,
  since: string | undefined,
): Effect.Effect<CommitRange, never, CommandExecutor> {
  return Effect.gen(function* () {
    if (forkBase) {
      return {
        args: [`${forkBase}..HEAD`],
        kind: "branch",
        sinceRef: forkBase,
      };
    }
    if (since) {
      return { args: ["--since", since, "HEAD"], kind: "since", since };
    }

    const todaysCount = Number(
      yield* tryGit(["rev-list", "--count", "--since=midnight", "HEAD"]),
    );
    const limit = Math.max(
      MIN_RECENT_COMMIT_LIMIT,
      Number.isFinite(todaysCount) ? todaysCount : 0,
    );
    return {
      args: ["-n", String(limit), "HEAD"],
      kind: todaysCount > MIN_RECENT_COMMIT_LIMIT ? "today" : "recent",
    };
  });
}

/**
 * Parse `git log --name-status` output into structured commit records, marking
 * each as pushed or local and merging per-file line counts.
 */
function parseCommits(
  logOutput: string,
  aheadHashes: ReadonlySet<string>,
  baseExists: boolean,
  numstatByCommit: Map<string, Map<string, DiffCounts>>,
): CommitRecord[] {
  const records: {
    shortHash: string;
    relativeTime: string;
    subject: string;
    pushed: boolean;
    isoDate: string;
    files: FileChange[];
  }[] = [];
  let currentNumstat: Map<string, DiffCounts> = new Map();

  for (const rawLine of logOutput.split("\n")) {
    if (rawLine.startsWith(COMMIT_SEPARATOR)) {
      const [fullHash = "", shortHash = "", isoDate = "", subject = ""] =
        rawLine.slice(COMMIT_SEPARATOR.length).split("\t");
      currentNumstat = numstatByCommit.get(fullHash) ?? new Map();
      records.push({
        isoDate,
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
        current.files.push(toFileChange(trimmed, currentNumstat));
      }
    }
  }

  return records;
}
