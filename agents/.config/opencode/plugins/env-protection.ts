/**
 * @file Blocks direct access to .env files, and any extra secret files listed in env-protection.yml, to prevent leaking secrets.
 */

import { Plugin } from "@opencode/plugin/effect";
import { Tool } from "@opencode/schema/tool";
import { NodeFileSystem } from "@effect/platform-node";
import { Effect, FileSystem, Schema } from "effect";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";
import { argRecord, stringArg, targetsProtectedEnv } from "../lib/guard-paths";

interface ProtectedFile {
  readonly path: string;
  readonly directory: string;
  readonly name: string;
}

const EnvProtectionConfig = Schema.Struct({
  paths: Schema.optional(Schema.Array(Schema.String)),
});

const ENV_COMMAND_PATTERN =
  /(?:^|[\s;&|()])(?:cat|cd|cp|env|grep|head|less|ls|more|mv|open|rg|rm|source|tail|test|vim|vi|nvim|\.|<|>|\[)\b|[<>]/;

const HOME = homedir();

const CONFIG_HOME = process.env.XDG_CONFIG_HOME || join(HOME, ".config");

const CONFIG_PATH = join(CONFIG_HOME, "opencode", "env-protection.yml");

const expandShellPath = (value: string) =>
  value
    .replace(/\$\{XDG_CONFIG_HOME(?::?-[^}]*)?\}|\$XDG_CONFIG_HOME\b/g, CONFIG_HOME)
    .replace(/\$\{HOME\}|\$HOME\b/g, HOME)
    .replace(/(^|[\s=:"'(])~(?=\/|$|[\s"')])/g, `$1${HOME}`);

const toProtectedFile = (value: string): ProtectedFile => {
  const path = resolve(expandShellPath(value));

  return { path, directory: dirname(path), name: basename(path) };
};

const loadProtectedFiles = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  if (!(yield* fs.exists(CONFIG_PATH))) return [];

  const text = yield* fs.readFileString(CONFIG_PATH);
  const parsed = yield* Effect.try(() => Bun.YAML.parse(text));
  const config = yield* Schema.decodeUnknownEffect(EnvProtectionConfig)(parsed);

  return (config.paths ?? []).map(toProtectedFile);
}).pipe(
  Effect.provide(NodeFileSystem.layer),
  Effect.catch((error) =>
    Effect.logWarning(`env-protection: ignoring ${CONFIG_PATH}`, error).pipe(
      Effect.as<ReadonlyArray<ProtectedFile>>([]),
    ),
  ),
);

const mentionsName = (command: string, name: string) =>
  command
    .split(/[\s;&|()<>=`'"]+/)
    .some((token) => token === name || token.endsWith(`/${name}`));

const valueTargetsFile = (file: ProtectedFile, value: string, cwd: string, searchesContents: boolean) => {
  if (!value) return false;

  const expanded = expandShellPath(value);

  if (expanded.includes(file.path)) return true;

  const target = resolve(cwd, expanded);

  return (
    target === file.path ||
    (searchesContents && (target === file.directory || file.directory.startsWith(`${target}/`)))
  );
};

const commandTargetsFile = (file: ProtectedFile, command: string, cwd: string) => {
  const expanded = expandShellPath(command);

  if (expanded.includes(file.path)) return true;

  return mentionsName(expanded, file.name) && (cwd === file.directory || expanded.includes(file.directory));
};

const toolTargetsProtectedEnv = (
  tool: string,
  args: ReturnType<typeof argRecord>,
) => {
  if (tool === "read") return targetsProtectedEnv(stringArg(args.filePath) || stringArg(args.path));

  if (tool === "grep") return [args.path, args.include].some((value) => targetsProtectedEnv(stringArg(value)));

  if (tool === "glob") return [args.pattern, args.path].some((value) => targetsProtectedEnv(stringArg(value)));

  return false;
};

const isShellTool = (tool: string) => tool === "shell" || tool === "bash";

export default Plugin.define({
  id: "env-protection",
  effect: (context) =>
    Effect.gen(function* () {
      const protectedFiles = yield* loadProtectedFiles;

      yield* context.tool.hook("execute.before", (event) =>
        Effect.gen(function* () {
          const args = argRecord(event.input);
          const command = stringArg(args.command);
          const shell = isShellTool(event.tool);

          const envBlocked =
            toolTargetsProtectedEnv(event.tool, args) ||
            (shell && targetsProtectedEnv(command) && ENV_COMMAND_PATTERN.test(command));

          if (envBlocked) return yield* Effect.fail(new Tool.Error({ message: "Do not read .env files" }));

          const values = shell
            ? [command]
            : event.tool === "read"
              ? [stringArg(args.filePath) || stringArg(args.path)]
              : event.tool === "grep"
                ? [stringArg(args.path), stringArg(args.include)]
                : event.tool === "glob"
                  ? [stringArg(args.path), stringArg(args.pattern)]
                  : [];

          const candidates = shell ? protectedFiles.filter((file) => command.includes(file.name)) : protectedFiles;

          if (!candidates.length || !values.some(Boolean)) return;

          const workdir = expandShellPath(shell ? stringArg(args.workdir) : "");

          const needsSession = shell
            ? !isAbsolute(workdir)
            : values.some((value) => value && !isAbsolute(expandShellPath(value)));

          const base = needsSession
            ? (yield* context.session.get({ sessionID: event.sessionID }).pipe(Effect.orDie)).location.directory
            : "/";

          const cwd = resolve(base, workdir);

          const blocked = candidates.find((file) =>
            shell
              ? commandTargetsFile(file, command, cwd)
              : values.some((value) => valueTargetsFile(file, value, cwd, event.tool === "grep")),
          );

          if (blocked) return yield* Effect.fail(new Tool.Error({ message: `Do not read ${blocked.path}` }));
        }),
      );
    }),
});
