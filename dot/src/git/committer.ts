/**
 * @file Shared git commit and push primitives used by every dot committer.
 *
 * The `dot git-commit` gateway, the skill-update and private-package flows,
 * and the repo-notes writer all go through these helpers so staging, the safe
 * rebase-then-push, and `--force-with-lease` on amend behave identically no
 * matter who commits. Callers choose {@link GitIo} `inherit` to stream git's
 * own output to the terminal, or `capture` when the surrounding process emits
 * structured output that raw git text must not corrupt (the repo-notes JSON).
 */

import { Effect } from "effect";
import {
  gitExitCode,
  gitInheritExitCode,
  gitOutput,
  gitRequired,
} from "../lib/git.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { resolveDefaultRemote } from "./remotes.js";

/**
 * Whether a git subprocess inherits the terminal's stdio or has its output
 * captured. CLI committers inherit so the user sees git's own progress; the
 * repo-notes writer captures so git output never leaks into the structured
 * output it returns to OpenCode.
 */
export type GitIo = "inherit" | "capture";

/** A git command's outcome expressed as a value, never a failed Effect. */
export interface GitStepResult {
  /** Whether the command exited zero. */
  readonly ok: boolean;
  /** Trimmed captured output; empty under {@link GitIo} `inherit`. */
  readonly text: string;
  /** Failure message when {@link GitStepResult.ok} is false. */
  readonly error?: string;
}

/** Read a git command's trimmed stdout, resolving to "" on any failure. */
function readGitIn(
  cwd: string | undefined,
  args: readonly string[],
): Effect.Effect<string, never, CommandExecutor> {
  return gitOutput(args, cwd ? { cwd } : undefined).pipe(
    Effect.map((output) => output.trim()),
    Effect.orElseSucceed(() => ""),
  );
}

/** Run a git command under the chosen {@link GitIo}, capturing failures as a value. */
function runStep(
  cwd: string | undefined,
  args: readonly string[],
  io: GitIo,
): Effect.Effect<GitStepResult, never, CommandExecutor> {
  const opts = cwd ? { cwd } : undefined;

  if (io === "capture") {
    return gitOutput(args, opts).pipe(
      Effect.map((text): GitStepResult => ({ ok: true, text: text.trim() })),
      Effect.catch((error) =>
        Effect.succeed<GitStepResult>({
          ok: false,
          text: "",
          error: error.message,
        }),
      ),
    );
  }

  return gitRequired(args, opts).pipe(
    Effect.map((): GitStepResult => ({ ok: true, text: "" })),
    Effect.catch((error) =>
      Effect.succeed<GitStepResult>({
        ok: false,
        text: "",
        error: error.message,
      }),
    ),
  );
}

/** Whether the index holds staged changes (`git diff --cached --quiet`). */
export function hasStagedChanges(
  cwd?: string,
): Effect.Effect<boolean, never, CommandExecutor> {
  return gitExitCode(
    ["diff", "--cached", "--quiet"],
    cwd ? { cwd } : undefined,
  ).pipe(Effect.map((code) => code !== 0));
}

/**
 * Ensure `cwd` is a git worktree, running `git init` when it is not. Used to
 * bootstrap a notes vault that has never been initialised.
 */
export function ensureRepo(
  cwd?: string,
): Effect.Effect<GitStepResult, never, CommandExecutor> {
  return Effect.gen(function* () {
    const inside = yield* readGitIn(cwd, [
      "rev-parse",
      "--is-inside-work-tree",
    ]);

    if (inside === "true") return { ok: true, text: "" };

    return yield* runStep(cwd, ["init"], "capture");
  });
}

/** How to stage before committing: everything, or a set of pathspecs. */
export type StageSpec =
  | { readonly mode: "all" }
  | { readonly mode: "paths"; readonly paths: readonly string[] };

/** Stage changes with `git add`, capturing failures as a {@link GitStepResult}. */
export function stageIn(
  spec: StageSpec,
  opts?: { readonly cwd?: string; readonly io?: GitIo },
): Effect.Effect<GitStepResult, never, CommandExecutor> {
  if (spec.mode === "paths" && spec.paths.length === 0) {
    return Effect.succeed({ ok: true, text: "" });
  }

  const args =
    spec.mode === "all" ? ["add", "-A"] : ["add", "--", ...spec.paths];

  return runStep(opts?.cwd, args, opts?.io ?? "inherit");
}

/** A commit request against a single repository. */
export interface CommitStep {
  /** Repository working directory; defaults to the process cwd. */
  readonly cwd?: string;
  /** Commit subject; omit with {@link CommitStep.amend} to keep HEAD's message. */
  readonly message?: string;
  /** Pathspecs to scope the commit to (`git commit -- <paths>`). */
  readonly paths?: readonly string[];
  /** Rewrite HEAD via `git commit --amend` instead of a new commit. */
  readonly amend?: boolean;
  /** Pass `--no-verify` to skip commit hooks. */
  readonly noVerify?: boolean;
  /** Inherit git output or capture it; defaults to `inherit`. */
  readonly io?: GitIo;
  /**
   * When set, a non-amend commit with nothing staged resolves to
   * {@link CommitOutcome.committed} `false` instead of failing.
   */
  readonly tolerateEmpty?: boolean;
}

/** The result of a {@link commitIn} call. */
export interface CommitOutcome {
  /** Whether the commit step completed without a real error. */
  readonly ok: boolean;
  /** Whether a commit was actually created (false when nothing was staged). */
  readonly committed: boolean;
  /** Captured commit output; empty under {@link GitIo} `inherit`. */
  readonly text: string;
  /** Failure message when {@link CommitOutcome.ok} is false. */
  readonly error?: string;
}

/**
 * Commit already-staged changes (or an explicit `paths` scope) with the shared
 * argument layout: optional `--amend`, `-m <message>` or `--no-edit`, optional
 * `--no-verify`, and a trailing pathspec. With {@link CommitStep.tolerateEmpty}
 * a non-amend commit that has nothing staged returns `committed: false` rather
 * than failing, matching the pre-commit `git diff --cached --quiet` check the
 * CLI committers already run.
 */
export function commitIn(
  step: CommitStep,
): Effect.Effect<CommitOutcome, never, CommandExecutor> {
  const io = step.io ?? "inherit";

  return Effect.gen(function* () {
    if (step.tolerateEmpty && !step.amend) {
      const staged = yield* hasStagedChanges(step.cwd);

      if (!staged)
        return { ok: true, committed: false, text: "nothing to commit" };
    }

    const args = [
      "commit",
      ...(step.amend ? ["--amend"] : []),
      ...(step.message !== undefined ? ["-m", step.message] : ["--no-edit"]),
      ...(step.noVerify ? ["--no-verify"] : []),
      ...(step.paths && step.paths.length > 0 ? ["--", ...step.paths] : []),
    ];

    const result = yield* runStep(step.cwd, args, io);

    return result.ok
      ? { ok: true, committed: true, text: result.text }
      : { ok: false, committed: false, text: result.text, error: result.error };
  });
}

/** A {@link commitIn} request limited to an explicit set of pathspecs. */
export interface ScopedCommitStep extends Omit<
  CommitStep,
  "paths" | "tolerateEmpty"
> {
  /** Pathspecs, relative to {@link CommitStep.cwd}, that make up the commit. */
  readonly paths: readonly string[];
}

/** Pathspec that matches a repository-root-relative path exactly. */
const topLiteral = (path: string) => `:(top,literal)${path}`;

/** Split NUL-terminated git output into its non-empty fields. */
const splitNul = (output: string) =>
  output.split("\0").filter((field) => field.length > 0);

/**
 * Staged paths, root-relative, plus the path pairs git detects as renames and
 * the rename targets whose staged content is unchanged from their source.
 */
interface StagedIndex {
  readonly paths: ReadonlySet<string>;
  readonly renames: readonly (readonly [string, string])[];
  readonly pureRenames: ReadonlySet<string>;
}

/** Read the staged set with `git diff --cached --raw -z -M`. */
function readStagedIndex(
  cwd: string | undefined,
): Effect.Effect<StagedIndex, never, CommandExecutor> {
  return Effect.gen(function* () {
    const fields = splitNul(
      yield* readGitIn(cwd, [
        "diff",
        "--cached",
        "--raw",
        "--no-abbrev",
        "-z",
        "-M",
      ]),
    );

    const paths = new Set<string>();
    const renames: (readonly [string, string])[] = [];
    const pureRenames = new Set<string>();

    for (let index = 0; index < fields.length;) {
      const [srcMode, dstMode, srcOid, dstOid, status = ""] = (
        fields[index] ?? ""
      )
        .replace(/^:/, "")
        .split(" ");

      if (status.startsWith("R") || status.startsWith("C")) {
        const from = fields[index + 1];
        const to = fields[index + 2];

        if (from !== undefined && to !== undefined) {
          if (status.startsWith("R")) {
            paths.add(from);
            renames.push([from, to]);

            if (srcMode === dstMode && srcOid === dstOid) pureRenames.add(to);
          }

          paths.add(to);
        }

        index += 3;
      } else {
        const path = fields[index + 1];

        if (path !== undefined) paths.add(path);
        index += 2;
      }
    }

    return { paths, renames, pureRenames };
  });
}

/** Root-relative staged paths matching `pathspecs`, without rename pairing. */
function stagedMatching(
  cwd: string | undefined,
  pathspecs: readonly string[],
): Effect.Effect<readonly string[], never, CommandExecutor> {
  return readGitIn(cwd, [
    "diff",
    "--cached",
    "--name-only",
    "-z",
    "--no-renames",
    "--",
    ...pathspecs,
  ]).pipe(Effect.map(splitNul));
}

/**
 * Stage each scoped pathspec without disturbing what is already staged. A
 * pathspec with nothing staged is added as a whole, exactly as before. A
 * pathspec that already matches staged entries (deletions, renames, partially
 * staged files) keeps those entries as they are, and only its changed files
 * that are not staged at all are added. A rename staged with unchanged content
 * (`git mv`) carries no partial staging, so later edits to it are added too.
 */
function stageScope(
  cwd: string | undefined,
  top: string,
  paths: readonly string[],
  io: GitIo,
): Effect.Effect<GitStepResult, never, CommandExecutor> {
  return Effect.gen(function* () {
    const { paths: staged, pureRenames } = yield* readStagedIndex(cwd);

    for (const path of paths) {
      if ((yield* stagedMatching(cwd, [path])).length === 0) {
        const added = yield* runStep(cwd, ["add", "--", path], io);

        if (!added.ok) return added;
        continue;
      }

      const unstaged = [
        ...new Set(
          splitNul(
            yield* readGitIn(cwd, [
              "ls-files",
              "-z",
              "--full-name",
              "--modified",
              "--others",
              "--exclude-standard",
              "--",
              path,
            ]),
          ),
        ),
      ].filter((file) => !staged.has(file) || pureRenames.has(file));

      if (unstaged.length === 0) continue;

      const added = yield* runStep(
        top,
        ["add", "--", ...unstaged.map(topLiteral)],
        io,
      );

      if (!added.ok) return added;
    }

    return { ok: true, text: "" };
  });
}

/**
 * Commit exactly the scoped paths while leaving every other staged entry
 * staged. Scoped paths are staged by {@link stageScope}; staged entries outside
 * the scope (keeping both sides of a staged rename together) have their index
 * entries saved, are unstaged for a plain `git commit` of the prepared index,
 * and are written back afterwards, whether the commit succeeds, fails, or is
 * interrupted. Restoring the saved blobs rather than re-adding worktree files
 * keeps partially staged content intact.
 */
export function commitScopedIn(
  step: ScopedCommitStep,
): Effect.Effect<CommitOutcome, never, CommandExecutor> {
  const io = step.io ?? "inherit";

  return Effect.gen(function* () {
    const failed = (error: string): CommitOutcome => ({
      ok: false,
      committed: false,
      text: "",
      error,
    });

    const top = yield* readGitIn(step.cwd, ["rev-parse", "--show-toplevel"]);

    if (!top) return failed("Not inside a git work tree.");
    const staged = yield* stageScope(step.cwd, top, step.paths, io);

    if (!staged.ok) return failed(staged.error ?? "git add failed");
    const index = yield* readStagedIndex(top);
    const scope = new Set(yield* stagedMatching(step.cwd, step.paths));

    for (const [from, to] of index.renames) {
      if (scope.has(from) || scope.has(to)) {
        scope.add(from);
        scope.add(to);
      }
    }

    const others = [...index.paths].filter((path) => !scope.has(path));
    const commitStep: CommitStep = { ...step, paths: undefined };

    if (others.length === 0) return yield* commitIn(commitStep);

    const saved = splitNul(
      yield* readGitIn(top, [
        "ls-files",
        "-s",
        "-z",
        "--",
        ...others.map(topLiteral),
      ]),
    ).flatMap((line) => {
      const match = /^(\d+) ([0-9a-f]+) (\d)\t(.+)$/s.exec(line);

      return match
        ? [
            {
              mode: match[1] ?? "",
              oid: match[2] ?? "",
              stage: match[3] ?? "",
              path: match[4] ?? "",
            },
          ]
        : [];
    });

    if (saved.some((entry) => entry.stage !== "0")) {
      return failed(
        "Cannot scope a commit while the index has unresolved conflicts.",
      );
    }

    const savedPaths = new Set(saved.map((entry) => entry.path));
    const removed = others.filter((path) => !savedPaths.has(path));

    const restore = Effect.gen(function* () {
      const results: GitStepResult[] = [];

      if (saved.length > 0) {
        results.push(
          yield* runStep(
            top,
            [
              "update-index",
              "--add",
              ...saved.flatMap((entry) => [
                "--cacheinfo",
                `${entry.mode},${entry.oid},${entry.path}`,
              ]),
            ],
            "capture",
          ),
        );
      }

      if (removed.length > 0) {
        results.push(
          yield* runStep(
            top,
            ["update-index", "--force-remove", "--", ...removed],
            "capture",
          ),
        );
      }

      return results.find((result) => !result.ok);
    });

    const outcome = yield* Effect.gen(function* () {
      const reset = yield* runStep(
        top,
        ["reset", "-q", "--", ...others.map(topLiteral)],
        "capture",
      );

      if (!reset.ok) return failed(reset.error ?? "git reset failed");

      return yield* commitIn(commitStep);
    }).pipe(Effect.onInterrupt(() => restore));

    const restoreFailure = yield* restore;

    if (!restoreFailure) return outcome;

    return {
      ...outcome,
      ok: false,
      error: `Could not restore staged files outside the commit scope (${others.join(", ")}): ${restoreFailure.error ?? "git update-index failed"}`,
    };
  });
}

/** Options for {@link pushBranch}. */
export interface PushOptions {
  /** Repository working directory; defaults to the process cwd. */
  readonly cwd?: string;
  /** Push a rewritten HEAD with `--force-with-lease` instead of rebasing first. */
  readonly amend?: boolean;
  /** Inherit git output or capture it; defaults to `inherit`. */
  readonly io?: GitIo;
}

/** The result of a {@link pushBranch} call. */
export interface PushOutcome {
  /** Whether the push completed. */
  readonly ok: boolean;
  /** Human summary of what was pushed, e.g. `Pushed to origin/main`. */
  readonly message: string;
  /** Failure message when {@link PushOutcome.ok} is false. */
  readonly error?: string;
}

/**
 * Rebase the current branch onto its upstream before pushing so a remote that
 * moved ahead fast-forwards instead of rejecting the push. Autostashes so a
 * scoped commit that left other edits behind still rebases. On any failure it
 * aborts the rebase to restore the pre-pull state and reports an error, keeping
 * the local commit for manual integration. Never force-pushes.
 */
function rebaseOnUpstream(
  cwd: string | undefined,
  io: GitIo,
): Effect.Effect<GitStepResult, never, CommandExecutor> {
  const opts = cwd ? { cwd } : undefined;
  const run = io === "inherit" ? gitInheritExitCode : gitExitCode;

  return Effect.gen(function* () {
    const code = yield* run(
      ["pull", "--rebase", "--autostash", "--no-edit"],
      opts,
    );

    if (code === 0) return { ok: true, text: "" };
    yield* run(["rebase", "--abort"], opts);

    return {
      ok: false,
      text: "",
      error:
        "Could not rebase on the upstream before pushing; aborted the rebase and kept your local commit. Integrate the remote changes manually with git pull --rebase, then push.",
    };
  });
}

/**
 * Push the current branch. With an upstream a normal commit rebases onto it
 * first (see {@link rebaseOnUpstream}) so a moved-ahead remote fast-forwards,
 * while an amend force-pushes with `--force-with-lease`. Without an upstream it
 * sets one via `-u` against the resolved default remote. Never runs a plain
 * (leaseless) force-push. Failures are returned as {@link PushOutcome}, so
 * callers decide whether a failed push is fatal (the gateway) or best-effort
 * (the notes writer).
 */
export function pushBranch(
  options: PushOptions = {},
): Effect.Effect<PushOutcome, never, CommandExecutor> {
  const { cwd, amend = false, io = "inherit" } = options;

  return Effect.gen(function* () {
    const branch = yield* readGitIn(cwd, ["branch", "--show-current"]);

    if (!branch) {
      return {
        ok: false,
        message: "",
        error: "Cannot push from a detached HEAD.",
      };
    }

    const upstream = yield* readGitIn(cwd, [
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{upstream}",
    ]);

    if (upstream) {
      if (amend) {
        const pushed = yield* runStep(cwd, ["push", "--force-with-lease"], io);

        return pushed.ok
          ? { ok: true, message: `Force-pushed (with lease) to ${upstream}` }
          : { ok: false, message: "", error: pushed.error };
      }

      const rebased = yield* rebaseOnUpstream(cwd, io);

      if (!rebased.ok) return { ok: false, message: "", error: rebased.error };
      const pushed = yield* runStep(cwd, ["push"], io);

      return pushed.ok
        ? { ok: true, message: `Pushed to ${upstream}` }
        : { ok: false, message: "", error: pushed.error };
    }

    const { remote } = resolveDefaultRemote(yield* readGitIn(cwd, ["remote"]));
    const pushed = yield* runStep(cwd, ["push", "-u", remote, branch], io);

    return pushed.ok
      ? { ok: true, message: `Pushed to ${remote}/${branch} (new upstream)` }
      : { ok: false, message: "", error: pushed.error };
  });
}

/** Where the current branch would push to, for a dry-run preview. */
export interface PushTarget {
  /** Human description of the push destination. */
  readonly target: string;
  /** Whether an upstream is set, so a real push would rebase first. */
  readonly hasUpstream: boolean;
}

/** Resolve where the current branch would push and whether it has an upstream. */
export function describePushTarget(
  cwd?: string,
): Effect.Effect<PushTarget, never, CommandExecutor> {
  return Effect.gen(function* () {
    const branch = yield* readGitIn(cwd, ["branch", "--show-current"]);

    const upstream = yield* readGitIn(cwd, [
      "rev-parse",
      "--abbrev-ref",
      "--symbolic-full-name",
      "@{upstream}",
    ]);

    if (upstream) return { target: upstream, hasUpstream: true };
    const { remote } = resolveDefaultRemote(yield* readGitIn(cwd, ["remote"]));

    return {
      target: `${remote}/${branch || "(detached)"} (new upstream)`,
      hasUpstream: false,
    };
  });
}
