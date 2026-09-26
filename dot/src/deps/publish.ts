import { randomUUID } from "node:crypto";
import { dirname, join, relative, resolve } from "node:path";
import { Array, Duration, Effect, FileSystem, Result, Semaphore } from "effect";
import type { DependencyConfig, DependencyPolicy } from "./config.js";
import { skipDependencyCommand } from "./config.js";
import { prepareDependencyEdits, verifyDependencyEdits } from "./edits.js";
import type { DependencyRunLog } from "./log.js";
import type { Dependency, Snapshot } from "./model.js";
import type { PlannedDependency } from "./plan.js";
import type { DependencyLease } from "./lease.js";
import { DependencyRunError, type dependencyRunPaths } from "./state.js";
import { RetryBackoff } from "../services/RetryBackoff.js";

const credentials = [
  "-c",
  "credential.helper=",
  "-c",
  "credential.https://github.com.helper=!gh auth git-credential",
];

/** Git transport uses the authenticated gh account without exporting credentials. */
export function dependencyGit(
  log: DependencyRunLog,
  cwd: string,
  timeout: number,
  retryTimes = 5,
) {
  return (args: readonly string[]) =>
    Effect.gen(function* () {
      const backoff = yield* RetryBackoff;

      const command = log.command(
        "GIT",
        ["git", ...credentials, ...args],
        cwd,
        timeout,
        true,
      );

      // Git reads can safely be repeated. A push may have succeeded remotely
      // before its response failed, so leave its existing lease checks in charge.

      const value =
        args[0] === "ls-remote" || args[0] === "fetch"
          ? yield* backoff.retry(command, {
              initial: "1 second",
              maxDelay: "8 seconds",
              times: retryTimes,
              while: (error) =>
                error instanceof DependencyRunError &&
                error.transientNetwork === true,
              onRetry: (_error, delay) =>
                log.event(
                  `[WAIT] Git network unavailable; retrying ${args[0]} in ${Math.round(Duration.toMillis(delay) / 1000)}s`,
                ),
            })
          : yield* command;

      return value.trim();
    });
}

/** Create an owned worktree pinned to exactly the commit selected by discovery. */
export const prepareDependencyWorkspace = Effect.fn(
  "Dependencies.prepareWorkspace",
)(function* (
  paths: ReturnType<typeof dependencyRunPaths>,
  snapshot: Snapshot,
  log: DependencyRunLog,
  timeout: number,
  identity: { readonly login: string; readonly id: number },
) {
  const fs = yield* FileSystem.FileSystem;
  yield* fs.makeDirectory(paths.repository, { recursive: true, mode: 0o700 });
  const git = dependencyGit(log, paths.repository, timeout);
  const remote = `https://github.com/${snapshot.repository}.git`;

  if (!(yield* fs.exists(join(paths.repository, "HEAD")))) {
    yield* git(["init", "--bare"]);
    yield* git(["remote", "add", "origin", remote]);
  }

  if ((yield* git(["remote", "get-url", "--push", "origin"])) !== remote)
    return yield* new DependencyRunError({
      message: "Owned dependency repository has an unexpected remote",
    });
  yield* git(["config", "user.name", identity.login]);
  yield* git([
    "config",
    "user.email",
    `${identity.id}+${identity.login}@users.noreply.github.com`,
  ]);
  yield* git(["check-ref-format", `refs/heads/${snapshot.target}`]);
  yield* git(["fetch", "--no-tags", "origin", `refs/heads/${snapshot.target}`]);

  const directory = join(paths.run, `worktree-${randomUUID()}`);
  yield* git([
    "worktree",
    "add",
    "-b",
    `deps/${randomUUID()}`,
    directory,
    snapshot.sha,
  ]);
  yield* log.event(`[WORKTREE] ${directory}`);

  return { directory };
});

/** Remove a clean, published run-owned worktree, including its submodules. */
export const removeDependencyWorkspace = Effect.fn(
  "Dependencies.removeWorkspace",
)(function* (
  paths: ReturnType<typeof dependencyRunPaths>,
  directory: string,
  commit: string,
  log: DependencyRunLog,
  timeout: number,
) {
  if (
    dirname(directory) !== paths.run ||
    !/^worktree-[a-f\d-]+$/.test(directory.slice(paths.run.length + 1))
  )
    return yield* new DependencyRunError({
      message: `Refusing to remove a worktree outside this run: ${directory}`,
    });

  const git = dependencyGit(log, directory, timeout);

  if (
    (yield* git(["rev-parse", "HEAD"])) !== commit ||
    (yield* git([
      "status",
      "--porcelain",
      "--untracked-files=all",
      "--ignore-submodules=none",
    ]))
  )
    return yield* new DependencyRunError({
      message: `Published worktree changed; retained ${directory}`,
    });

  // Git requires --force for worktrees containing submodules, even when clean.
  yield* dependencyGit(
    log,
    paths.repository,
    timeout,
  )(["worktree", "remove", "--force", directory]);
  yield* log.event(`[CLEANUP] Removed ${directory}`);
});

/** Refuse repository paths whose parent or command working directory escapes through symlinks. */
export const dependencyWorkPath = Effect.fn("Dependencies.workPath")(function* (
  root: string,
  path: string,
  directory = false,
) {
  const fs = yield* FileSystem.FileSystem;
  const location = join(root, path);
  const resolved = yield* fs.realPath(directory ? location : dirname(location));
  const parent = relative(root, resolved);

  if (parent === ".." || parent.startsWith("../") || parent.startsWith("/"))
    return yield* new DependencyRunError({
      message: `Repository path escapes worktree: ${path}`,
    });

  if (
    !directory &&
    (yield* fs.exists(location)) &&
    (yield* fs.stat(location)).type === "SymbolicLink"
  )
    return yield* new DependencyRunError({
      message: `Refusing symlink edit: ${path}`,
    });

  return location;
});

/** Apply group edits and regenerate only its Bun lockfiles, then verify all dependency identities. */
export const applyDependencyGroup = Effect.fn("Dependencies.applyGroup")(
  function* (
    directory: string,
    snapshot: Snapshot,
    policy: DependencyPolicy,
    entries: readonly PlannedDependency[],
    log: DependencyRunLog,
    timeout: number,
    repository?: Semaphore.Semaphore,
  ) {
    const fs = yield* FileSystem.FileSystem;
    const git = dependencyGit(log, directory, timeout);
    const edits = yield* prepareDependencyEdits(snapshot, policy, entries);

    for (const [file, text] of Object.entries(edits.files)) {
      const path = yield* dependencyWorkPath(directory, file);

      if ((yield* fs.readFileString(path)) !== snapshot.files[file])
        return yield* new DependencyRunError({
          message: `Pinned file changed before editing: ${file}`,
        });
      yield* fs.writeFileString(path, text);
    }

    const submodules = Effect.forEach(
      Object.entries(edits.gitlinks),
      Effect.fn("Dependencies.updateSubmodule")(function* ([file, digest]) {
        yield* dependencyWorkPath(directory, file);
        yield* git(["update-index", "--cacheinfo", `160000,${digest},${file}`]);
        yield* git(["submodule", "update", "--init", "--", file]);
      }),
      { discard: true },
    );

    yield* repository ? repository.withPermit(submodules) : submodules;

    for (const [file, pinned] of Object.entries(edits.pinned)) {
      const path = yield* dependencyWorkPath(directory, file);
      const cwd = yield* dependencyWorkPath(directory, dirname(file), true);
      yield* fs.writeFileString(path, pinned);
      yield* log.command(
        "LOCKFILE",
        ["bun", "install", "--lockfile-only", "--ignore-scripts"],
        cwd,
        timeout,
      );
      yield* fs.writeFileString(path, edits.files[file]);
      yield* log.command(
        "LOCKFILE",
        ["bun", "install", "--lockfile-only", "--ignore-scripts"],
        cwd,
        timeout,
      );
    }

    const files = { ...snapshot.files };

    for (const file of Object.keys(files))
      files[file] = yield* fs.readFileString(
        yield* dependencyWorkPath(directory, file),
      );

    const tree = snapshot.tree.map((entry) => ({
      ...entry,
      sha: edits.gitlinks[entry.path] ?? entry.sha,
    }));

    yield* verifyDependencyEdits(
      snapshot,
      { ...snapshot, files, tree },
      policy,
      entries,
    );

    return edits.allowed;
  },
);

/** Run configured commands with repository-relative paths and explicit process deadlines. */
export const validateDependencyGroup = Effect.fn("Dependencies.validateGroup")(
  function* (
    directory: string,
    config: DependencyConfig,
    log: DependencyRunLog,
    updates: readonly Dependency[],
    concurrency = 4,
    limits?: {
      readonly repository: Semaphore.Semaphore;
      readonly checks: Semaphore.Semaphore;
    },
  ) {
    const setup = Effect.forEach(
      config.validation.setup,
      Effect.fn("Dependencies.setupCommand")(function* (command) {
        if (skipDependencyCommand(command, updates)) {
          yield* log.event(
            `[SKIP SETUP] ${JSON.stringify(command.argv)}: all updates match skipFor`,
          );

          return;
        }

        const cwd = yield* dependencyWorkPath(directory, command.cwd, true);
        yield* log.command("SETUP", command.argv, cwd, command.timeout);
      }),
      { discard: true },
    );

    // Setup may initialise shared submodule configuration or install host tools.
    yield* limits ? limits.repository.withPermit(setup) : setup;

    const checks = limits?.checks ?? (yield* Semaphore.make(concurrency));

    if (!Array.isReadonlyArrayNonEmpty(config.validation.checks)) return;

    for (const batch of Array.groupWith(
      config.validation.checks,
      (left, right) => left.parallel === true && right.parallel === true,
    ))
      yield* Effect.forEach(
        batch,
        Effect.fn("Dependencies.validateCheck")(function* (check) {
          for (const command of check.commands) {
            if (skipDependencyCommand(command, updates)) {
              yield* log.event(
                `[SKIP CHECK ${check.context}] ${JSON.stringify(command.argv)}: all updates match skipFor`,
              );
              continue;
            }

            const cwd = yield* dependencyWorkPath(directory, command.cwd, true);
            yield* log
              .command(
                `CHECK ${check.context}`,
                command.argv,
                cwd,
                command.timeout,
              )
              .pipe(Semaphore.withPermit(checks));
          }
        }),
        { concurrency, discard: true },
      );
  },
);

/** Capture the exact prepared tree and reject all unplanned tracked or untracked paths. */
export const dependencyCandidateTree = Effect.fn("Dependencies.candidateTree")(
  function* (
    directory: string,
    allowed: readonly string[],
    base: string,
    log: DependencyRunLog,
    timeout: number,
  ) {
    const git = dependencyGit(log, directory, timeout);

    if ((yield* git(["rev-parse", "HEAD"])) !== base)
      return yield* new DependencyRunError({
        message: "Candidate HEAD changed during preparation or checks",
      });

    const names = [
      ...new Set(
        [
          ...(yield* git(["diff", "--name-only", "-z", base, "--"])).split(
            "\0",
          ),
          ...(yield* git([
            "ls-files",
            "--others",
            "--exclude-standard",
            "-z",
          ])).split("\0"),
        ].filter(Boolean),
      ),
    ];

    if (!names.length)
      return yield* new DependencyRunError({
        message: "Group produced no changes",
      });

    if (names.some((name) => !allowed.includes(name)))
      return yield* new DependencyRunError({
        message: `Changes escaped planned scope: ${names.filter((name) => !allowed.includes(name)).join(", ")}`,
      });
    yield* git(["add", "--", ...allowed]);
    yield* git(["diff", "--cached", "--check"]);

    return yield* git(["write-tree"]);
  },
);

/** Commit only the checked tree, verify hooks, then push that explicit commit without rebasing. */
export const publishDependencyGroup = Effect.fn("Dependencies.publishGroup")(
  function* (
    directory: string,
    snapshot: Snapshot,
    group: string,
    tree: string,
    allowed: readonly string[],
    log: DependencyRunLog,
    timeout: number,
    lease: DependencyLease,
  ) {
    const git = dependencyGit(log, directory, timeout);
    const fs = yield* FileSystem.FileSystem;

    const hook = resolve(
      directory,
      yield* git(["rev-parse", "--git-path", "hooks/pre-push"]),
    );

    if ((yield* fs.exists(hook)) && (yield* fs.stat(hook)).mode & 0o111)
      return yield* new DependencyRunError({
        message:
          "Active pre-push hooks cannot be validated before the push; publication refused",
      });
    yield* log.command(
      "COMMIT",
      [
        "dot",
        "git-commit",
        "-m",
        `Update dependencies in ${group
          .replace(/[\u0000-\u001f\u2013\u2014]/g, " ")
          .slice(0, 80)
          .replace(/\.+$/, "")}`,
        ...allowed.flatMap((file) => ["--path", file]),
      ],
      directory,
      timeout,
    );
    const commit = yield* git(["rev-parse", "HEAD"]);

    if (
      (yield* git(["rev-parse", "HEAD^{tree}"])) !== tree ||
      (yield* git(["rev-list", "--parents", "-n", "1", "HEAD"])) !==
        `${commit} ${snapshot.sha}` ||
      (yield* git(["status", "--porcelain", "--untracked-files=all"]))
    )
      return yield* new DependencyRunError({
        message:
          "Commit hooks changed the checked candidate; publication refused",
      });
    yield* log.event(
      `[COMMIT] ${commit}; checked tree ${tree}; parent ${snapshot.sha}`,
    );
    const ref = `refs/heads/${snapshot.target}`;
    const destination = `https://github.com/${snapshot.repository}.git`;
    const before = (yield* git(["ls-remote", destination, ref])).split(/\s/)[0];

    if (before !== snapshot.sha) return { status: "moved" as const, commit };

    const pushed = yield* lease
      .publish(directory, commit, snapshot.target, snapshot.sha)
      .pipe(Effect.result);

    // Both a successful push and a lost response are reconciled against remote ancestry.
    yield* git(["fetch", "--no-tags", destination, ref]);
    const remote = yield* git(["rev-parse", "FETCH_HEAD"]);
    const ancestors = yield* git(["merge-base", commit, remote]);

    if (ancestors === commit)
      return { status: "published" as const, commit, remote };

    if (remote !== snapshot.sha) return { status: "moved" as const, commit };

    return yield* new DependencyRunError({
      message: `Push ${Result.isSuccess(pushed) ? "was not observed" : `failed: ${pushed.failure.message}`}; retained ${commit} for inspection`,
    });
  },
);
