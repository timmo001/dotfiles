import { afterEach, expect, test } from "bun:test";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Effect } from "../../dot/node_modules/effect/dist/index.js";
import { NodeServices } from "../../dot/node_modules/@effect/platform-node/dist/index.js";
import {
  deployOmarchyPlugin,
  exportTrackedPlugin,
  omarchyPluginSubmodules,
} from "../../dot/src/lib/omarchyPluginDeployment.js";
import {
  CommandError,
  CommandExecutor,
} from "../../dot/src/services/CommandExecutor.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0))
    rmSync(root, { recursive: true, force: true });
});

function fixture() {
  const repo = mkdtempSync(join(tmpdir(), "dot-plugin-deploy-"));
  roots.push(repo);
  const source = join(repo, "omarchy/.config/omarchy/plugins/example.pet");
  const home = join(repo, "home");
  const target = join(home, ".config/omarchy/plugins/example.pet");
  mkdirSync(source, { recursive: true });
  mkdirSync(target, { recursive: true });
  writeFileSync(join(source, ".git"), "gitdir: unused-test-metadata\n");
  writeFileSync(join(source, "manifest.json"), '{"id":"example.pet"}\n');
  writeFileSync(join(source, "Service.qml"), "old source\n");
  writeFileSync(join(source, "helper"), "#!/bin/sh\n");
  chmodSync(join(source, "helper"), 0o755);
  symlinkSync(join(source, "Service.qml"), join(target, "Service.qml"));
  const calls: string[] = [];

  const deploy = (rejectStage = false) =>
    Effect.runPromise(
      deployOmarchyPlugin(source, target, repo).pipe(
        Effect.provideService(
          CommandExecutor,
          CommandExecutor.of({
            run: (command, args) => {
              expect(command).toBe("omarchy-plugin-validate");
              const directory = args[0];

              if (!directory) return Effect.die("Missing validation directory");
              calls.push(directory);

              return rejectStage && directory !== source
                ? Effect.fail(
                    new CommandError({
                      command,
                      exitCode: 1,
                      stderr: "Rejected staged plugin",
                    }),
                  )
                : Effect.succeed("");
            },
            stream: () => Effect.die("Unexpected stream"),
            exitCode: () => Effect.die("Unexpected exitCode"),
            inherit: () => Effect.die("Unexpected inherit"),
          }),
        ),
        Effect.provide(NodeServices.layer),
      ),
    );

  return { repo, source, home, target, calls, deploy };
}

test("stow leaves deployed plugin files real, executable and unchanged on repeat", async () => {
  const f = fixture();
  expect(
    await Effect.runPromise(
      omarchyPluginSubmodules(f.repo).pipe(Effect.provide(NodeServices.layer)),
    ),
  ).toEqual([f.source]);
  const result = await f.deploy();
  expect(result?.backup).toBeTruthy();
  expect(f.calls.length).toBe(2);
  expect(existsSync(join(f.target, ".git"))).toBe(false);
  expect(lstatSync(join(f.target, "Service.qml")).isSymbolicLink()).toBe(false);
  expect(lstatSync(join(f.target, "helper")).mode & 0o777).toBe(0o755);

  const stow = Bun.spawnSync([
    "stow",
    "--dir",
    f.repo,
    "--target",
    f.home,
    "--no-folding",
    "--ignore=^\\.config/omarchy/plugins/example\\.pet($|/)",
    "omarchy",
  ]);

  expect(stow.exitCode, stow.stderr.toString()).toBe(0);
  const inode = lstatSync(f.target).ino;
  expect(await f.deploy()).toBe(null);
  expect(lstatSync(f.target).ino).toBe(inode);
});

test("a rejected staged plugin preserves the live directory and removes staging", async () => {
  const f = fixture();
  await expect(f.deploy(true)).rejects.toBeDefined();
  expect(lstatSync(join(f.target, "Service.qml")).isSymbolicLink()).toBe(true);
  expect(existsSync(join(f.repo, "backup"))).toBe(false);
  expect(readdirSync(join(f.home, ".config/omarchy/plugins"))).toEqual([
    "example.pet",
  ]);
});

test("a tracked plugin exports only the remote branch's committed files", async () => {
  const root = mkdtempSync(join(tmpdir(), "dot-plugin-export-"));
  roots.push(root);

  const env = {
    ...process.env,
    GIT_CONFIG_GLOBAL: "/dev/null",
    GIT_CONFIG_NOSYSTEM: "1",
    GIT_AUTHOR_NAME: "Fixture",
    GIT_AUTHOR_EMAIL: "fixture@example.invalid",
    GIT_COMMITTER_NAME: "Fixture",
    GIT_COMMITTER_EMAIL: "fixture@example.invalid",
  };

  const git = (cwd: string, args: string[]) => {
    const result = Bun.spawnSync(["git", ...args], { cwd, env });
    expect(result.exitCode, result.stderr.toString()).toBe(0);

    return result.stdout.toString().trim();
  };

  const origin = join(root, "origin");
  const plugin = join(origin, "omarchy-plugin");
  mkdirSync(plugin, { recursive: true });
  git(root, ["init", "--initial-branch=main", origin]);
  writeFileSync(join(origin, ".gitignore"), "node_modules/\n");
  writeFileSync(join(origin, "README.md"), "outside the plugin\n");
  writeFileSync(join(plugin, "manifest.json"), '{"id":"example.pet"}\n');
  writeFileSync(join(plugin, "Service.qml"), "pushed\n");
  writeFileSync(join(plugin, "helper"), "#!/bin/sh\n");
  chmodSync(join(plugin, "helper"), 0o755);
  git(origin, ["add", "-A"]);
  git(origin, ["commit", "-q", "-m", "Pushed plugin"]);

  const checkout = join(root, "checkout");
  git(root, ["clone", "-q", origin, checkout]);
  const local = join(checkout, "omarchy-plugin");
  writeFileSync(join(local, "Local.qml"), "unpushed\n");
  git(checkout, ["add", "-A"]);
  git(checkout, ["commit", "-q", "-m", "Unpushed work"]);
  writeFileSync(join(local, "Service.qml"), "uncommitted\n");
  writeFileSync(join(local, "Untracked.qml"), "untracked\n");
  mkdirSync(join(local, "node_modules"));
  writeFileSync(join(local, "node_modules/ignored.js"), "ignored\n");

  const exported = await Effect.runPromise(
    Effect.scoped(
      Effect.gen(function* () {
        const result = yield* exportTrackedPlugin(checkout, "omarchy-plugin");

        return {
          ...result,
          names: readdirSync(result.files).sort(),
          service: readFileSync(join(result.files, "Service.qml"), "utf8"),
          helperMode: lstatSync(join(result.files, "helper")).mode & 0o777,
        };
      }),
    ).pipe(
      Effect.provide(CommandExecutor.layer),
      Effect.provide(NodeServices.layer),
    ),
  );

  expect(exported.ref).toBe("origin/main");
  expect(exported.sha).toBe(git(origin, ["rev-parse", "HEAD"]));
  expect(exported.names).toEqual(["Service.qml", "helper", "manifest.json"]);
  expect(exported.service).toBe("pushed\n");
  expect(exported.helperMode).toBe(0o755);
  expect(existsSync(exported.files)).toBe(false);
});

test("source updates replace the copy and preserve live edits in the backup", async () => {
  const f = fixture();
  await f.deploy();
  writeFileSync(join(f.target, "Service.qml"), "local edit\n");
  writeFileSync(join(f.source, "Service.qml"), "updated source\n");
  const result = await f.deploy();
  expect(readFileSync(join(f.target, "Service.qml"), "utf8")).toBe(
    "updated source\n",
  );

  if (!result?.backup) throw new Error("Missing backup");
  expect(readFileSync(join(result.backup, "Service.qml"), "utf8")).toBe(
    "local edit\n",
  );
});
