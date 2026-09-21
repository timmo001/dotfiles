import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { Effect } from "../../dot/node_modules/effect/dist/index.js";
import { gitPullFastForward } from "../../dot/src/lib/git.js";
import { CommandExecutor } from "../../dot/src/services/CommandExecutor.js";
import { Launcher } from "../../dot/src/services/Launcher.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "dot-git-pull-"));
  roots.push(root);

  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: "protocol.file.allow",
    GIT_CONFIG_VALUE_0: "always",
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  };

  const git = (cwd: string, args: string[], input?: string) => {
    const result = Bun.spawnSync(["git", ...args], {
      cwd, env, stdin: input === undefined ? "ignore" : new TextEncoder().encode(input),
    });

    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);

    return new TextDecoder().decode(result.stdout).trim();
  };

  const revision = (repo: string, files: Record<string, string>, parent?: string, pin?: string) => {
    for (const [path, contents] of Object.entries(files)) {
      const blob = git(repo, ["hash-object", "-w", "--stdin"], contents);
      git(repo, ["update-index", "--add", "--cacheinfo", `100644,${blob},${path}`]);
    }

    if (pin) git(repo, ["update-index", "--add", "--cacheinfo", `160000,${pin},nested`]);
    const tree = git(repo, ["write-tree"]);
    const commit = git(repo, ["commit-tree", tree, ...(parent ? ["-p", parent] : [])], "Fixture revision\n");
    git(repo, ["update-ref", "refs/heads/main", commit]);
    git(repo, ["reset", "--hard", commit]);

    return commit;
  };

  const origin = join(root, "origin");
  git(root, ["init", "--initial-branch=main", origin]);
  const first = revision(origin, { incoming: "old\n", staged: "old\n", unstaged: "old\n" });
  const repo = join(root, "checkout");
  git(root, ["clone", origin, repo]);
  git(repo, ["config", "pull.rebase", "true"]);
  git(repo, ["config", "pull.squash", "true"]);
  git(repo, ["config", "rebase.autoStash", "true"]);
  git(repo, ["config", "merge.autoStash", "true"]);

  const pull = (path = repo) => Effect.runPromise(gitPullFastForward(path).pipe(
    Effect.provideService(Launcher, Launcher.of({
      stream: (command, options) => Effect.sync(() => Bun.spawnSync(["bash", "-c", command], { cwd: options?.cwd, env }).exitCode),
      suspend: () => Effect.die("Unexpected suspend"),
      suspendArgv: () => Effect.die("Unexpected suspendArgv"),
      silent: () => Effect.die("Unexpected silent"),
    })),
    Effect.provide(CommandExecutor.layer),
  ));

  return { root, origin, repo, first, git, revision, pull };
}

test("fast-forward preserves staged, unstaged and untracked work despite autostash settings", async () => {
  const f = fixture();
  writeFileSync(join(f.repo, "staged"), "staged work\n");
  f.git(f.repo, ["add", "staged"]);
  writeFileSync(join(f.repo, "unstaged"), "unstaged work\n");
  writeFileSync(join(f.repo, "untracked"), "untracked work\n");
  const before = f.git(f.repo, ["status", "--porcelain"]);
  const next = f.revision(f.origin, { incoming: "new\n" }, f.first);

  expect(await f.pull()).toBe(true);
  expect(f.git(f.repo, ["rev-parse", "HEAD"])).toBe(next);
  expect(f.git(f.repo, ["status", "--porcelain"])).toBe(before);
  expect(readFileSync(join(f.repo, "staged"), "utf8")).toBe("staged work\n");
  expect(readFileSync(join(f.repo, "unstaged"), "utf8")).toBe("unstaged work\n");
  expect(readFileSync(join(f.repo, "untracked"), "utf8")).toBe("untracked work\n");
  expect(f.git(f.repo, ["stash", "list"])).toBe("");
});

test("overlapping edits refuse the pull without changing HEAD, index or working files", async () => {
  const f = fixture();
  writeFileSync(join(f.repo, "incoming"), "local work\n");
  const index = f.git(f.repo, ["ls-files", "--stage"]);
  f.revision(f.origin, { incoming: "upstream work\n" }, f.first);

  expect(await f.pull()).toBe(false);
  expect(f.git(f.repo, ["rev-parse", "HEAD"])).toBe(f.first);
  expect(f.git(f.repo, ["ls-files", "--stage"])).toBe(index);
  expect(readFileSync(join(f.repo, "incoming"), "utf8")).toBe("local work\n");
  expect(f.git(f.repo, ["ls-files", "--unmerged"])).toBe("");
  expect(f.git(f.repo, ["stash", "list"])).toBe("");
});

test("divergent commits are left intact instead of being rebased or merged", async () => {
  const f = fixture();
  const local = f.revision(f.repo, { staged: "local commit\n" }, f.first);
  f.revision(f.origin, { incoming: "upstream commit\n" }, f.first);

  expect(await f.pull()).toBe(false);
  expect(f.git(f.repo, ["rev-parse", "HEAD"])).toBe(local);
  expect(f.git(f.repo, ["status", "--porcelain"])).toBe("");
});

test("a changed submodule pin cannot overwrite local submodule edits", async () => {
  const f = fixture();
  const nestedOrigin = join(f.root, "nested-origin");
  f.git(f.root, ["init", "--initial-branch=main", nestedOrigin]);
  const nestedFirst = f.revision(nestedOrigin, { value: "old\n" });

  const parent = f.revision(f.origin, {
    ".gitmodules": `[submodule "nested"]\n\tpath = nested\n\turl = ${nestedOrigin}\n`,
  }, f.first, nestedFirst);

  expect(await f.pull()).toBe(true);
  writeFileSync(join(f.repo, "nested/value"), "local submodule work\n");
  const nestedNext = f.revision(nestedOrigin, { value: "upstream\n" }, nestedFirst);
  f.revision(f.origin, {}, parent, nestedNext);

  expect(await f.pull()).toBe(false);
  expect(f.git(f.repo, ["rev-parse", "HEAD"])).toBe(parent);
  expect(readFileSync(join(f.repo, "nested/value"), "utf8")).toBe("local submodule work\n");
  expect(f.git(join(f.repo, "nested"), ["rev-parse", "HEAD"])).toBe(nestedFirst);
  expect(f.git(join(f.repo, "nested"), ["ls-files", "--unmerged"])).toBe("");
});
