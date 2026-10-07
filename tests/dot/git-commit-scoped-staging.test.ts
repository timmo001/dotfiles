import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { NodeServices } from "../../dot/node_modules/@effect/platform-node/dist/index.js";
import { Effect } from "../../dot/node_modules/effect/dist/index.js";
import { commitScopedIn } from "../../dot/src/git/committer.js";
import { CommandExecutor } from "../../dot/src/services/CommandExecutor.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

const env = {
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "Fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
};

function fixture(files: Record<string, string>) {
  const repo = mkdtempSync(join(tmpdir(), "dot-git-commit-"));
  roots.push(repo);

  const git = (args: string[], input?: string) => {
    const result = Bun.spawnSync(["git", ...args], {
      cwd: repo,
      env: { ...process.env, ...env },
      stdin: input === undefined ? "ignore" : new TextEncoder().encode(input),
    });

    expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);

    return new TextDecoder().decode(result.stdout).trim();
  };

  git(["init", "--initial-branch=main"]);

  for (const [path, contents] of Object.entries(files)) writeFileSync(join(repo, path), contents);
  git(["add", "-A"]);
  git(["commit", "-m", "Initial"]);

  const commit = async (paths: string[]) => {
    const saved = { ...process.env };
    Object.assign(process.env, env);

    try {
      return await Effect.runPromise(commitScopedIn({ cwd: repo, message: "Scoped", paths, io: "capture" }).pipe(
        Effect.provide(CommandExecutor.layer),
        Effect.provide(NodeServices.layer),
      ));
    } finally {
      process.env = saved;
    }
  };

  return { repo, git, commit };
}

test("a git mv rename edited afterwards commits the edits with the rename", async () => {
  const f = fixture({ a: "original\n" });
  f.git(["mv", "a", "b"]);
  writeFileSync(join(f.repo, "b"), "original\nedited\n");

  expect((await f.commit(["a", "b"])).ok).toBe(true);
  expect(f.git(["show", "HEAD:b"])).toBe("original\nedited");
  expect(f.git(["status", "--porcelain"])).toBe("");
});

test("partially staged content is kept and the rest stays unstaged", async () => {
  const f = fixture({ c: "one\n" });
  const blob = f.git(["hash-object", "-w", "--stdin"], "one\nstaged\n");
  f.git(["update-index", "--cacheinfo", `100644,${blob},c`]);
  writeFileSync(join(f.repo, "c"), "one\nstaged\nunstaged\n");

  expect((await f.commit(["c"])).ok).toBe(true);
  expect(f.git(["show", "HEAD:c"])).toBe("one\nstaged");
  expect(f.git(["status", "--porcelain"])).toBe("M c");
});
