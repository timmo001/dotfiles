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
import {
  deployOmarchyPlugin,
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
      ),
    );

  return { repo, source, home, target, calls, deploy };
}

test("stow leaves deployed plugin files real, executable and unchanged on repeat", async () => {
  const f = fixture();
  expect(omarchyPluginSubmodules(f.repo)).toEqual([f.source]);
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
