import { Data, Effect, Match, Option } from "effect";
import {
  Completions,
  type Command,
  type Param,
  type Primitive,
} from "effect/cli";
import { existsSync, mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import { commandConfig, commandHelp, dotCommand } from "../cli/spec.js";
import { Config } from "../services/Config.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { OutputLog } from "../services/OutputLog.js";
import { buildSkillsMaintenance } from "../lib/skillsMaintenance.js";

type ParamWrapper = "Map" | "Transform" | "Optional" | "Variadic";

type InspectableParam<Kind extends Param.ParamKind> = Param.Param<
  Kind,
  unknown
> &
  (
    | Param.Single<Kind, unknown>
    | {
        [Tag in ParamWrapper]: {
          readonly _tag: Tag;
          readonly param: Param.Param<Kind, unknown>;
        };
      }[ParamWrapper]
  );

interface ParamMetadata {
  readonly isOptional: boolean;
  readonly isVariadic: boolean;
}

function isInspectableParam<Kind extends Param.ParamKind>(
  param: Param.Param<Kind, unknown>,
): param is InspectableParam<Kind> {
  return "primitiveType" in param || "param" in param;
}

function isChoicePrimitive(
  primitive: Primitive.Primitive<unknown>,
): primitive is Primitive.Primitive<unknown> & {
  readonly choiceKeys: readonly string[];
} {
  return "choiceKeys" in primitive && Array.isArray(primitive.choiceKeys);
}

function isPathPrimitive(
  primitive: Primitive.Primitive<unknown>,
): primitive is Primitive.Primitive<unknown> & {
  readonly pathType: "file" | "directory" | "either";
} {
  return (
    "pathType" in primitive &&
    (primitive.pathType === "file" ||
      primitive.pathType === "directory" ||
      primitive.pathType === "either")
  );
}

function extractSingleParams<Kind extends Param.ParamKind>(
  param: Param.Param<Kind, unknown>,
): readonly Param.Single<Kind, unknown>[] {
  if (!isInspectableParam(param))
    throw new Error("Unsupported Effect parameter");

  return Match.value(param).pipe(
    Match.tag("Single", (node) => [node]),
    Match.orElse((node) => extractSingleParams(node.param)),
  );
}

function paramMetadata<Kind extends Param.ParamKind>(
  param: Param.Param<Kind, unknown>,
): ParamMetadata {
  if (!isInspectableParam(param))
    throw new Error("Unsupported Effect parameter");

  return Match.value(param).pipe(
    Match.tag("Optional", (node) => {
      const nested = paramMetadata(node.param);

      return { isOptional: true, isVariadic: nested.isVariadic };
    }),
    Match.tag("Variadic", (node) => {
      const nested = paramMetadata(node.param);

      return { isOptional: nested.isOptional, isVariadic: true };
    }),
    Match.tag("Single", () => {
      return { isOptional: false, isVariadic: false };
    }),
    Match.orElse((node) => paramMetadata(node.param)),
  );
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

const CompletionType = Data.taggedEnum<Completions.FlagType>();

function flagType(single: Param.Single<"flag", unknown>): Completions.FlagType {
  return Match.value(single.primitiveType).pipe(
    Match.tag("Boolean", () => CompletionType.Boolean()),
    Match.orElse(() => argumentType(single)),
  );
}

function argumentType(
  single: Param.Single<Param.ParamKind, unknown>,
): Completions.ArgumentType {
  return Match.value(single.primitiveType).pipe(
    Match.tag("Int", () => CompletionType.Int()),
    Match.tag("Finite", () => CompletionType.Finite()),
    Match.tag("Date", () => CompletionType.Date()),
    Match.tag("Choice", () => {
      if (!isChoicePrimitive(single.primitiveType))
        throw new Error("Invalid Effect choice primitive");

      return CompletionType.Choice({ values: single.primitiveType.choiceKeys });
    }),
    Match.tag("Path", () => {
      if (!isPathPrimitive(single.primitiveType))
        throw new Error("Invalid Effect path primitive");

      return CompletionType.Path({ pathType: single.primitiveType.pathType });
    }),
    Match.tag("FileText", "FileParse", "FileSchema", () =>
      CompletionType.Path({ pathType: "file" }),
    ),
    Match.orElse(() => CompletionType.String()),
  );
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
      type: CompletionType.Boolean(),
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

    if (!existsSync(executable)) yield* buildSkillsMaintenance;

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

/** Write completions for one shell. */
export function completions(options: { readonly shell: CompletionShell }) {
  return Effect.gen(function* () {
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
