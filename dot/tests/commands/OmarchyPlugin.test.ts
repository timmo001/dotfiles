import { afterEach, describe, expect, test } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  UNMANAGED_PLUGIN_EXIT_CODE,
  httpsGitUrl,
  omarchyPlugin,
  type OmarchyPluginPaths,
} from "../../src/commands/OmarchyPlugin.js";
import {
  CommandError,
  CommandExecutor,
} from "../../src/services/CommandExecutor.js";
import { Config, type ConfigService } from "../../src/services/Config.js";
import { emptyDotGitConfig } from "../../src/services/GitConfig.js";
import { emptyMcpConfig } from "../../src/mcp/sync/loadSpec.js";

const roots: string[] = [];
const originalPath = process.env.PATH;
const originalGitAllowProtocol = process.env.GIT_ALLOW_PROTOCOL;
const originalGitConfigGlobal = process.env.GIT_CONFIG_GLOBAL;
const originalInteractive = process.env.OMARCHY_PLUGIN_INTERACTIVE;
const originalExitCode = process.exitCode;

interface Fixture {
  readonly root: string;
  readonly repo: string;
  readonly upstream: string;
  readonly checkout: string;
  readonly source: string;
  readonly paths: OmarchyPluginPaths;
  readonly dotLog: string;
}

afterEach(() => {
  process.env.PATH = originalPath;
  if (originalGitAllowProtocol === undefined) {
    delete process.env.GIT_ALLOW_PROTOCOL;
  } else {
    process.env.GIT_ALLOW_PROTOCOL = originalGitAllowProtocol;
  }
  if (originalGitConfigGlobal === undefined) {
    delete process.env.GIT_CONFIG_GLOBAL;
  } else {
    process.env.GIT_CONFIG_GLOBAL = originalGitConfigGlobal;
  }
  if (originalInteractive === undefined) {
    delete process.env.OMARCHY_PLUGIN_INTERACTIVE;
  } else {
    process.env.OMARCHY_PLUGIN_INTERACTIVE = originalInteractive;
  }
  process.exitCode = originalExitCode ?? 0;
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function run(command: string, args: readonly string[], cwd?: string): string {
  const proc = Bun.spawnSync([command, ...args], {
    cwd,
    env: { ...process.env, GIT_ALLOW_PROTOCOL: "file" },
    stdout: "pipe",
    stderr: "pipe",
  });
  if (proc.exitCode !== 0) {
    throw new Error(
      `${command} ${args.join(" ")} failed: ${proc.stderr.toString()}`,
    );
  }
  return proc.stdout.toString().trim();
}

function executable(path: string, contents: string): void {
  writeFileSync(path, contents, { mode: 0o755 });
}

function config(repo: string): ConfigService {
  return {
    publicDotfiles: repo,
    privateDotfiles: null,
    canUsePrivate: false,
    privateReason: "test",
    notesDir: join(repo, "notes"),
    omarchy: {
      repoBase: repo,
      diffRepos: [],
      worktreeRepos: [],
      worktreeBranches: [],
      expectedBranches: {},
      enabled: true,
    },
    gitConfig: emptyDotGitConfig(join(repo, "dot-git.yml")),
    mcpConfig: emptyMcpConfig(join(repo, "mcp.yml")),
    cacheDir: join(repo, ".cache"),
    stateDir: join(repo, ".state"),
    logDir: join(repo, ".state", "logs"),
  };
}

function createFixture(): Fixture {
  const root = mkdtempSync(join(tmpdir(), "dot-omarchy-plugin-"));
  roots.push(root);
  const repo = join(root, "dotfiles");
  const upstream = join(root, "upstream");
  const home = join(root, "home");
  const live = join(home, ".config", "omarchy", "plugins");
  const bin = join(root, "bin");
  const dotLog = join(root, "dot.log");
  mkdirSync(join(repo, "omarchy", ".config", "omarchy", "plugins"), {
    recursive: true,
  });
  mkdirSync(live, { recursive: true });
  mkdirSync(bin);

  run("git", ["init", "-q", "-b", "main", upstream]);
  run("git", ["config", "user.name", "Test"], upstream);
  run("git", ["config", "user.email", "test@example.com"], upstream);
  writeFileSync(
    join(upstream, "manifest.json"),
    JSON.stringify({
      id: "example.plugin",
      kinds: ["bar-widget"],
      barWidget: { defaultSection: "right" },
    }),
  );
  writeFileSync(join(upstream, "Widget.qml"), "first\n");
  run("git", ["add", "."], upstream);
  run("git", ["commit", "-qm", "first"], upstream);

  run("git", ["init", "-q", "-b", "main", repo]);
  run("git", ["config", "user.name", "Test"], repo);
  run("git", ["config", "user.email", "test@example.com"], repo);
  writeFileSync(join(repo, "omarchy-plugins.json"), '{ "plugins": [] }\n');
  writeFileSync(join(repo, ".gitmodules"), "");
  run("git", ["add", "."], repo);
  run("git", ["commit", "-qm", "initial"], repo);

  executable(
    join(bin, "dot"),
    `#!/bin/bash
if [[ $1 == stow ]]; then
  mkdir -p ${JSON.stringify(live)}
  for source in ${JSON.stringify(join(repo, "omarchy", ".config", "omarchy", "plugins"))}/*; do
    [[ -e $source ]] || continue
    ln -sfn "$source" ${JSON.stringify(live)}/"$(basename "$source")"
  done
elif [[ $1 == git-commit ]]; then
  printf '%s\n' "$*" >>${JSON.stringify(dotLog)}
fi
`,
  );
  executable(join(bin, "omarchy-shell"), "#!/bin/sh\nexit 0\n");
  executable(
    join(bin, "omarchy-plugin-validate"),
    '#!/bin/sh\n[ "${VALIDATE_FAIL:-0}" != 1 ]\n',
  );
  executable(
    join(bin, "gum"),
    '#!/bin/sh\nif [ "$1" = choose ]; then [ "$#" -ge 7 ] || exit 2; printf "%s\\n" "${GUM_CHOICE:-No}"; else exit "${GUM_CONFIRM_EXIT:-0}"; fi\n',
  );
  process.env.PATH = `${bin}:${originalPath ?? ""}`;
  delete process.env.GIT_ALLOW_PROTOCOL;
  process.env.GIT_CONFIG_GLOBAL = join(root, "gitconfig");
  run("git", ["config", "--global", "protocol.file.allow", "always"]);

  const checkout = join(live, "example.plugin");
  run("git", ["clone", "-q", upstream, checkout]);
  const source = join(
    repo,
    "omarchy",
    ".config",
    "omarchy",
    "plugins",
    "example.plugin",
  );
  return {
    root,
    repo,
    upstream,
    checkout,
    source,
    dotLog,
    paths: {
      repo,
      registry: join(repo, "omarchy-plugins.json"),
      pluginsSource: join(repo, "omarchy", ".config", "omarchy", "plugins"),
      pluginsLive: live,
      prettier: join(
        import.meta.dir,
        "..",
        "..",
        "node_modules",
        ".bin",
        "prettier",
      ),
    },
  };
}

function runPlugin(fixture: Fixture, args: readonly string[]) {
  const spawn = (
    command: string,
    commandArgs: readonly string[],
    cwd?: string,
  ) =>
    Bun.spawnSync([command, ...commandArgs], {
      cwd,
      env: { ...process.env, GIT_ALLOW_PROTOCOL: "file" },
      stdout: "pipe",
      stderr: "pipe",
    });
  const executor = Layer.succeed(CommandExecutor, {
    run: (command, commandArgs, options) =>
      Effect.suspend(() => {
        const result = spawn(command, commandArgs, options?.cwd);
        return result.exitCode === 0
          ? Effect.succeed(result.stdout.toString())
          : Effect.fail(
              new CommandError({
                command: `${command} ${commandArgs.join(" ")}`,
                exitCode: result.exitCode,
                stderr: result.stderr.toString().trim(),
              }),
            );
      }),
    stream: () => Stream.die("stream should not be called"),
    exitCode: (command, commandArgs, options) =>
      Effect.sync(() => spawn(command, commandArgs, options?.cwd).exitCode),
    inherit: (command, commandArgs, options) =>
      Effect.sync(() => spawn(command, commandArgs, options?.cwd).exitCode),
  });
  return Effect.runPromise(
    omarchyPlugin(args, fixture.paths).pipe(
      Effect.provide(
        Layer.merge(Layer.succeed(Config, config(fixture.repo)), executor),
      ),
    ),
  );
}

function expectRemoved(fixture: Fixture): void {
  const submodulePath = "omarchy/.config/omarchy/plugins/example.plugin";
  expect(existsSync(fixture.source)).toBe(false);
  expect(existsSync(join(fixture.paths.pluginsLive, "example.plugin"))).toBe(
    false,
  );
  expect(existsSync(join(fixture.repo, ".git", "modules", submodulePath))).toBe(
    false,
  );
  expect(
    JSON.parse(readFileSync(fixture.paths.registry, "utf8")).plugins,
  ).toEqual([]);
  expect(readFileSync(join(fixture.repo, ".gitmodules"), "utf8")).not.toContain(
    "example.plugin",
  );
}

describe("managed Omarchy plugins", () => {
  test("normalises GitHub SSH URLs", () => {
    expect(httpsGitUrl("git@github.com:example/plugin.git")).toBe(
      "https://github.com/example/plugin.git",
    );
    expect(httpsGitUrl("ssh://git@github.com/example/plugin.git")).toBe(
      "https://github.com/example/plugin.git",
    );
  });

  test("adds, formats, stows, and removes a managed plugin", async () => {
    const fixture = createFixture();
    const firstSha = run("git", ["rev-parse", "HEAD"], fixture.upstream);
    await runPlugin(fixture, [
      "add",
      "example.plugin",
      fixture.upstream,
      fixture.checkout,
      "--section",
      "right",
      "--after",
      "omarchy.tray",
    ]);

    expect(run("git", ["rev-parse", "HEAD"], fixture.source)).toBe(firstSha);
    expect(JSON.parse(readFileSync(fixture.paths.registry, "utf8"))).toEqual({
      plugins: [
        {
          id: "example.plugin",
          managed: true,
          placement: { section: "right", after: "omarchy.tray" },
        },
      ],
    });
    expect(lstatSync(fixture.checkout).isSymbolicLink()).toBe(true);
    expect(run("git", ["diff", "--cached", "--name-only"], fixture.repo)).toBe(
      "",
    );
    run(fixture.paths.prettier, [
      "--check",
      "--parser",
      "json",
      fixture.paths.registry,
    ]);

    rmSync(fixture.checkout);
    mkdirSync(fixture.checkout);
    writeFileSync(
      join(fixture.checkout, "manifest.json"),
      readFileSync(join(fixture.source, "manifest.json")),
    );

    await runPlugin(fixture, [
      "remove",
      "example.plugin",
      "1",
      "--no-commit-offer",
    ]);
    expectRemoved(fixture);
    expect(run("git", ["diff", "--cached", "--name-only"], fixture.repo)).toBe(
      "",
    );
  });

  test("updates managed plugins and rolls back failed validation", async () => {
    const fixture = createFixture();
    await runPlugin(fixture, [
      "add",
      "example.plugin",
      fixture.upstream,
      fixture.checkout,
    ]);
    run(
      "git",
      [
        "add",
        ".gitmodules",
        "omarchy-plugins.json",
        "omarchy/.config/omarchy/plugins/example.plugin",
      ],
      fixture.repo,
    );
    run("git", ["commit", "-qm", "managed"], fixture.repo);

    writeFileSync(join(fixture.upstream, "Widget.qml"), "second\n");
    run("git", ["add", "Widget.qml"], fixture.upstream);
    run("git", ["commit", "-qm", "second"], fixture.upstream);
    const secondSha = run("git", ["rev-parse", "HEAD"], fixture.upstream);
    await runPlugin(fixture, ["update", "example.plugin", "1"]);
    expect(run("git", ["rev-parse", "HEAD"], fixture.source)).toBe(secondSha);

    writeFileSync(join(fixture.upstream, "Widget.qml"), "third\n");
    run("git", ["add", "Widget.qml"], fixture.upstream);
    run("git", ["commit", "-qm", "third"], fixture.upstream);
    process.env.VALIDATE_FAIL = "1";
    let validationError: unknown;
    try {
      await runPlugin(fixture, ["update", "example.plugin", "1"]);
    } catch (error) {
      validationError = error;
    }
    expect(String(validationError)).toContain("failed validation; rolled back");
    delete process.env.VALIDATE_FAIL;
    expect(run("git", ["rev-parse", "HEAD"], fixture.source)).toBe(secondSha);
  });

  test("offers the guarded commit and push handoff", async () => {
    const fixture = createFixture();
    await runPlugin(fixture, [
      "add",
      "example.plugin",
      fixture.upstream,
      fixture.checkout,
    ]);
    run(
      "git",
      [
        "add",
        ".gitmodules",
        "omarchy-plugins.json",
        "omarchy/.config/omarchy/plugins/example.plugin",
      ],
      fixture.repo,
    );
    run("git", ["commit", "-qm", "managed"], fixture.repo);

    process.env.OMARCHY_PLUGIN_INTERACTIVE = "1";
    process.env.GUM_CHOICE = "Commit and push";
    await runPlugin(fixture, ["remove", "example.plugin", "1"]);
    expect(readFileSync(fixture.dotLog, "utf8").trim()).toBe(
      "git-commit -m Remove example.plugin Omarchy plugin --path .gitmodules --path omarchy-plugins.json --path omarchy/.config/omarchy/plugins/example.plugin --push",
    );
    delete process.env.GUM_CHOICE;
  });

  test("discards a newly managed plugin from the interactive choice", async () => {
    const fixture = createFixture();
    const registryBeforeAdd = readFileSync(fixture.paths.registry, "utf8");
    process.env.OMARCHY_PLUGIN_INTERACTIVE = "1";
    process.env.GUM_CHOICE = "Discard plugin";
    await runPlugin(fixture, [
      "add",
      "example.plugin",
      fixture.upstream,
      fixture.checkout,
    ]);
    expectRemoved(fixture);
    expect(readFileSync(fixture.paths.registry, "utf8")).toBe(
      registryBeforeAdd,
    );
    expect(existsSync(fixture.dotLog)).toBe(false);
    delete process.env.GUM_CHOICE;
  });

  test("returns exit 20 for unmanaged lifecycle operations", async () => {
    const fixture = createFixture();
    await runPlugin(fixture, ["remove", "unmanaged.plugin", "1"]);
    expect(process.exitCode).toBe(UNMANAGED_PLUGIN_EXIT_CODE);
  });
});
