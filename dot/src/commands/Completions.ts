import { Effect, Option } from "effect";
import {
  Completions,
  type Command,
  type Param,
  type Primitive,
} from "effect/unstable/cli";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { commandConfig, commandHelp, dotCommand } from "../cli/spec.js";
import { Config } from "../services/Config.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { OutputLog } from "../services/OutputLog.js";

interface ChoicePrimitive extends Primitive.Primitive<unknown> {
  readonly choiceKeys: readonly string[];
}

interface PathPrimitive extends Primitive.Primitive<unknown> {
  readonly pathType: "file" | "directory" | "either";
}

type InspectableParam<Kind extends Param.ParamKind> =
  | Param.Single<Kind, unknown>
  | {
      readonly _tag: "Map" | "Transform" | "Optional" | "Variadic";
      readonly param: Param.Param<Kind, unknown>;
    };

interface ParamMetadata {
  readonly isOptional: boolean;
  readonly isVariadic: boolean;
}

function extractSingleParams<Kind extends Param.ParamKind>(
  param: Param.Param<Kind, unknown>,
): readonly Param.Single<Kind, unknown>[] {
  // SAFETY: Every non-Single Effect Param combinator stores its wrapped parameter in param.
  const node = param as InspectableParam<Kind>;
  if (node._tag === "Single") return [node];
  return extractSingleParams(node.param);
}

function paramMetadata<Kind extends Param.ParamKind>(
  param: Param.Param<Kind, unknown>,
): ParamMetadata {
  // SAFETY: Every non-Single Effect Param combinator stores its wrapped parameter in param.
  const node = param as InspectableParam<Kind>;
  if (node._tag === "Optional") {
    const nested = paramMetadata(node.param);
    return { isOptional: true, isVariadic: nested.isVariadic };
  }
  if (node._tag === "Variadic") {
    const nested = paramMetadata(node.param);
    return { isOptional: nested.isOptional, isVariadic: true };
  }
  if (node._tag === "Single") {
    return { isOptional: false, isVariadic: false };
  }
  return paramMetadata(node.param);
}

/** Shells supported by Effect's completion generator. */
export const SUPPORTED_SHELLS = ["bash", "fish", "zsh"] as const;

/** Supported completion shell. */
export type CompletionShell = (typeof SUPPORTED_SHELLS)[number];

const COMPLETION_TARGETS = {
  bash: "bash/.local/share/bash-completion/completions/dot",
  fish: "fish/.config/fish/completions/dot.fish",
  zsh: "zsh/.local/share/zsh/site-functions/_dot",
} satisfies Record<CompletionShell, string>;

const SKILL_MAINTENANCE_COMPLETION_TARGETS = {
  bash: "bash/.local/share/bash-completion/completions/skill-maintenance",
  fish: "fish/.config/fish/completions/skill-maintenance.fish",
  zsh: "zsh/.local/share/zsh/site-functions/_skill-maintenance",
} satisfies Record<CompletionShell, string>;

function flagType(single: Param.Single<"flag", unknown>): Completions.FlagType {
  switch (single.primitiveType._tag) {
    case "Boolean":
      return { _tag: "Boolean" };
    case "Integer":
      return { _tag: "Integer" };
    case "Float":
      return { _tag: "Float" };
    case "Date":
      return { _tag: "Date" };
    case "Choice":
      // SAFETY: Effect's Choice primitive stores its constructor keys on choiceKeys.
      return {
        _tag: "Choice",
        values: (single.primitiveType as ChoicePrimitive).choiceKeys,
      };
    case "Path":
      // SAFETY: Effect's Path primitive stores its constructor path type on pathType.
      return {
        _tag: "Path",
        pathType: (single.primitiveType as PathPrimitive).pathType,
      };
    case "FileText":
    case "FileParse":
    case "FileSchema":
      return { _tag: "Path", pathType: "file" };
    default:
      return { _tag: "String" };
  }
}

function argumentType(
  single: Param.Single<"argument", unknown>,
): Completions.ArgumentType {
  switch (single.primitiveType._tag) {
    case "Integer":
      return { _tag: "Integer" };
    case "Float":
      return { _tag: "Float" };
    case "Date":
      return { _tag: "Date" };
    case "Choice":
      // SAFETY: Effect's Choice primitive stores its constructor keys on choiceKeys.
      return {
        _tag: "Choice",
        values: (single.primitiveType as ChoicePrimitive).choiceKeys,
      };
    case "Path":
      // SAFETY: Effect's Path primitive stores its constructor path type on pathType.
      return {
        _tag: "Path",
        pathType: (single.primitiveType as PathPrimitive).pathType,
      };
    case "FileText":
    case "FileParse":
    case "FileSchema":
      return { _tag: "Path", pathType: "file" };
    default:
      return { _tag: "String" };
  }
}

function descriptor(
  command: Command.Command.Any,
  path: readonly string[],
): Completions.CommandDescriptor {
  const config = commandConfig(command);
  const globalFlags = (commandHelp(command, path).globalFlags ?? []).map(
    (flag) => ({
      name: flag.name,
      aliases: flag.aliases.map((alias) => alias.replace(/^-+/, "")),
      description: Option.getOrUndefined(flag.description),
      type: { _tag: "Boolean" as const },
    }),
  );
  const flags = config.flags.flatMap((flag) =>
    extractSingleParams(flag).flatMap((single) =>
      single.kind === "flag" && !single.hidden
        ? [
            {
              name: single.name,
              aliases: single.aliases,
              description: Option.getOrUndefined(single.description),
              type: flagType(single),
            },
          ]
        : [],
    ),
  );
  const arguments_ = config.arguments.flatMap((argument) => {
    const metadata = paramMetadata(argument);
    return extractSingleParams(argument).flatMap((single) =>
      single.kind === "argument"
        ? [
            {
              name: single.name,
              description: Option.getOrUndefined(single.description),
              required: !metadata.isOptional,
              variadic: metadata.isVariadic,
              type: argumentType(single),
            },
          ]
        : [],
    );
  });
  const subcommands = command.subcommands.flatMap((group) => group.commands);
  return {
    name: command.name,
    description: command.shortDescription ?? command.description,
    flags: [...flags, ...globalFlags],
    arguments: arguments_,
    subcommands: subcommands.flatMap((subcommand) => [
      descriptor(subcommand, [...path, subcommand.name]),
      ...(subcommand.alias
        ? [
            {
              ...descriptor(subcommand, [...path, subcommand.name]),
              name: subcommand.alias,
              description: `Alias for ${subcommand.name}`,
            },
          ]
        : []),
    ]),
  };
}

function unsupportedNegations(
  command: Command.Command.Any,
  path: readonly string[],
): readonly string[] {
  const help = commandHelp(command, path);
  return [
    ...help.flags
      .map((flag) => flag.name)
      .filter((name) => name.startsWith("no-"))
      .map((name) => `no-${name}`),
    ...command.subcommands.flatMap((group) =>
      group.commands.flatMap((subcommand) =>
        unsupportedNegations(subcommand, [...path, subcommand.name]),
      ),
    ),
  ];
}

function removeUnsupportedNegations(script: string): string {
  const names = ["no-help", ...unsupportedNegations(dotCommand, ["dot"])];
  const blockedLines = names.map((name) => `Disable ${name.slice(3)}`);
  let output = script
    .split("\n")
    .filter(
      (line) => !blockedLines.some((description) => line.includes(description)),
    )
    .join("\n");
  for (const name of names) {
    output = output.replaceAll(`|--${name}`, "").replaceAll(` --${name}`, "");
  }
  return output;
}

/** Render completions directly from the executable Effect command tree. */
export function renderCompletions(shell: CompletionShell): string {
  return removeUnsupportedNegations(
    Completions.generate("dot", shell, descriptor(dotCommand, ["dot"])),
  );
}

/** Write generated completions into the public dotfiles stow package. */
export function writeCompletions(shell: CompletionShell) {
  return Effect.gen(function* () {
    const config = yield* Config;
    const target = join(config.publicDotfiles, COMPLETION_TARGETS[shell]);
    yield* Effect.sync(() => {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, renderCompletions(shell));
    });
    return target;
  });
}

/** Generate and write standalone skill-maintenance completions. */
export function writeSkillsMaintenanceCompletions(shell: CompletionShell) {
  return Effect.gen(function* () {
    const config = yield* Config;
    const executor = yield* CommandExecutor;
    const executable = join(
      config.publicDotfiles,
      "scripts",
      ".local",
      "bin",
      "skill-maintenance",
    );
    const target = join(
      config.publicDotfiles,
      SKILL_MAINTENANCE_COMPLETION_TARGETS[shell],
    );
    const output = yield* executor.run(executable, ["--completions", shell]);
    yield* Effect.sync(() => {
      mkdirSync(dirname(target), { recursive: true });
      writeFileSync(target, output);
    });
    return target;
  });
}

/** Write generated completions for every supported shell. */
export const writeAllCompletions = Effect.all([
  ...SUPPORTED_SHELLS.map(writeCompletions),
  ...SUPPORTED_SHELLS.map(writeSkillsMaintenanceCompletions),
]);

/** Generate or write completions for one shell. */
export function completions(options: {
  readonly shell: CompletionShell;
  readonly stdout: boolean;
}) {
  return Effect.gen(function* () {
    if (options.stdout) {
      yield* Effect.sync(() =>
        process.stdout.write(renderCompletions(options.shell)),
      );
      return;
    }
    const targets = yield* Effect.all([
      writeCompletions(options.shell),
      writeSkillsMaintenanceCompletions(options.shell),
    ]);
    const log = yield* OutputLog;
    for (const target of targets) {
      yield* log.info(`Generated ${options.shell} completions: ${target}`);
    }
  });
}
