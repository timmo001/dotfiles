import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { NodeServices } from "../../dot/node_modules/@effect/platform-node/dist/index.js";
import { Effect, Layer } from "../../dot/node_modules/effect/dist/index.js";
import { abortGitRebase } from "../../dot/src/commands/HomeAssistant.js";
import { CommandExecutor } from "../../dot/src/services/CommandExecutor.js";
import { Launcher } from "../../dot/src/services/Launcher.js";
import { OutputLog } from "../../dot/src/services/OutputLog.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

const gitEnv = {
  ...process.env,
  GIT_CONFIG_GLOBAL: "/dev/null",
  GIT_CONFIG_NOSYSTEM: "1",
  GIT_AUTHOR_NAME: "Fixture",
  GIT_AUTHOR_EMAIL: "fixture@example.invalid",
  GIT_COMMITTER_NAME: "Fixture",
  GIT_COMMITTER_EMAIL: "fixture@example.invalid",
};

function git(cwd: string, args: string[], input?: string) {
  const result = Bun.spawnSync(["git", ...args], {
    cwd,
    env: gitEnv,
    stdin: input === undefined ? "ignore" : new TextEncoder().encode(input),
  });

  expect(result.exitCode, new TextDecoder().decode(result.stderr)).toBe(0);

  return new TextDecoder().decode(result.stdout).trim();
}

function runAbort(cwd: string) {
  const saved = { ...process.env };
  Object.assign(process.env, gitEnv);

  return Effect.runPromise(
    abortGitRebase(cwd).pipe(
      Effect.provideService(
        Launcher,
        Launcher.of({
          stream: () => Effect.die("Unexpected stream"),
          suspend: () => Effect.die("Unexpected suspend"),
          suspendArgv: () => Effect.die("Unexpected suspendArgv"),
          silent: () => Effect.die("Unexpected silent"),
        }),
      ),
      Effect.provide(
        Layer.mock(OutputLog, {
          warn: () => Effect.void,
          info: () => Effect.void,
          withSpinnerPaused: (effect) => effect,
        }),
      ),
      Effect.provide(CommandExecutor.layer),
      Effect.provide(NodeServices.layer),
    ),
  ).finally(() => {
    process.env = saved;
  });
}

test("aborting a conflicted rebase restores the branch and its files", async () => {
  const root = mkdtempSync(join(tmpdir(), "dot-ha-rebase-"));
  roots.push(root);
  git(root, ["init", "--initial-branch=dev"]);
  writeFileSync(join(root, "core"), "base\n");
  git(root, ["add", "core"]);
  git(root, ["commit", "-m", "base"]);
  git(root, ["branch", "upstream"]);
  writeFileSync(join(root, "core"), "local\n");
  git(root, ["commit", "-am", "local"]);
  git(root, ["switch", "upstream"]);
  writeFileSync(join(root, "core"), "upstream\n");
  git(root, ["commit", "-am", "upstream"]);
  git(root, ["switch", "dev"]);
  const head = git(root, ["rev-parse", "HEAD"]);

  const rebase = Bun.spawnSync(["git", "rebase", "upstream"], {
    cwd: root,
    env: gitEnv,
  });

  expect(rebase.exitCode).not.toBe(0);
  expect(readFileSync(join(root, "core"), "utf8")).toContain("<<<<<<");

  expect(await runAbort(root)).toBe(true);
  expect(git(root, ["rev-parse", "HEAD"])).toBe(head);
  expect(readFileSync(join(root, "core"), "utf8")).toBe("local\n");
  expect(git(root, ["status", "--porcelain"])).toBe("");

  const marker = Bun.spawnSync(
    ["git", "rev-parse", "-q", "--verify", "REBASE_HEAD"],
    { cwd: root, env: gitEnv },
  );

  expect(marker.exitCode).not.toBe(0);
});
