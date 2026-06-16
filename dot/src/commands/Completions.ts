import { Effect } from "effect";
import { mkdirSync, writeFileSync } from "fs";
import { dirname, join } from "path";
import {
  cliCommands,
  type CliArgumentSpec,
  type CliCommandSpec,
  type CliOptionSpec,
  type CliValueChoice,
} from "../cli/spec.js";
import { renderHelp } from "../cli/help.js";
import { Config } from "../services/Config.js";
import { OutputLog } from "../services/OutputLog.js";

const SUPPORTED_SHELLS = ["bash", "fish", "zsh"] as const;

type CompletionShell = (typeof SUPPORTED_SHELLS)[number];

const BASH_COMPLETION_RELATIVE_PATH =
  "bash/.local/share/bash-completion/completions/dot";
const FISH_COMPLETION_RELATIVE_PATH = "fish/.config/fish/completions/dot.fish";
const ZSH_COMPLETION_RELATIVE_PATH = "zsh/.local/share/zsh/site-functions/_dot";
const ZSH_CONTINUATION = ` ${"\\"}`;

const COMPLETION_TARGETS = {
  bash: BASH_COMPLETION_RELATIVE_PATH,
  fish: FISH_COMPLETION_RELATIVE_PATH,
  zsh: ZSH_COMPLETION_RELATIVE_PATH,
} satisfies Record<CompletionShell, string>;

interface CompletionOptions {
  readonly shell: CompletionShell;
  readonly stdout?: boolean;
}

function isCompletionShell(shell: string): shell is CompletionShell {
  return (SUPPORTED_SHELLS as readonly string[]).includes(shell);
}

function shellList(): string {
  return SUPPORTED_SHELLS.join(", ");
}

function shellIdentifier(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, "_");
}

function zshQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function zshIdentifier(value: string): string {
  return shellIdentifier(value);
}

function zshDescription(value: string): string {
  return value.replaceAll("\\", "\\\\").replaceAll("]", "\\]");
}

function zshActionWord(value: string): string {
  return value
    .replaceAll("\\", "\\\\")
    .replaceAll(":", "\\:")
    .replaceAll(" ", "\\ ")
    .replaceAll("(", "\\(")
    .replaceAll(")", "\\)");
}

function zshChoice(choice: CliValueChoice): string {
  const value = zshActionWord(choice.value);
  if (!choice.description) return value;
  return `${value}:${zshActionWord(choice.description)}`;
}

function zshChoiceList(choices: readonly CliValueChoice[]): string {
  return choices.some((choice) => choice.description)
    ? `((${choices.map(zshChoice).join(" ")}))`
    : `(${choices.map((choice) => choice.value).join(" ")})`;
}

function zshAction(
  spec: Pick<CliOptionSpec | CliArgumentSpec, "choices" | "completion">,
): string | undefined {
  if (spec.choices) return zshChoiceList(spec.choices);
  if (spec.completion === "file") return "_files";
  return undefined;
}

function zshValueCompletion(
  valueName: string,
  spec: Pick<CliOptionSpec | CliArgumentSpec, "choices" | "completion">,
): string {
  const action = zshAction(spec);
  return action ? `:${valueName}:${action}` : `:${valueName}:`;
}

function zshOptionSpecs(option: CliOptionSpec): readonly string[] {
  const valueCompletion = option.valueName
    ? zshValueCompletion(option.valueName, option)
    : "";

  if (option.short) {
    const exclusion = `(${option.short} ${option.name})`;
    const description = `[${zshDescription(option.description)}]`;
    return [
      `${exclusion}${option.short}${description}${valueCompletion}`,
      `${exclusion}${option.name}${description}${valueCompletion}`,
    ];
  }

  return [
    `${option.name}[${zshDescription(option.description)}]${valueCompletion}`,
  ];
}

function zshArgumentSpec(argument: CliArgumentSpec, index: number): string {
  const action = zshAction(argument);
  const prefix = argument.repeatable ? "*" : String(index);
  const description = argument.description ?? argument.name;
  return action
    ? `${prefix}:${description}:${action}`
    : `${prefix}:${description}:`;
}

function continued(
  lines: readonly string[],
  indent = "    ",
): readonly string[] {
  return lines.map(
    (line, index) =>
      `${indent}${zshQuote(line)}${index === lines.length - 1 ? "" : ZSH_CONTINUATION}`,
  );
}

function zshArguments(specs: readonly string[]): string {
  return [`  _arguments -S ${"\\"}`, ...continued(specs)].join("\n");
}

function commandFunctionName(command: CliCommandSpec, parent?: string): string {
  return `_dot_cmd_${zshIdentifier(parent ? `${parent}_${command.name}` : command.name)}`;
}

function commandEntries(
  commands: readonly CliCommandSpec[],
): readonly string[] {
  return commands.flatMap((command) => [
    `${command.name}:${command.summary}`,
    ...(command.aliases?.map((alias) => `${alias}:Alias for ${command.name}`) ??
      []),
  ]);
}

function commandPatterns(command: CliCommandSpec): string {
  return [command.name, ...(command.aliases ?? [])].join("|");
}

function renderLeafCommandFunction(
  command: CliCommandSpec,
  parent?: string,
): string {
  const functionName = commandFunctionName(command, parent);
  const optionSpecs = (command.options ?? []).flatMap(zshOptionSpecs);
  const argumentSpecs = (command.arguments ?? []).map((argument, index) =>
    zshArgumentSpec(argument, index + 1),
  );
  return `${functionName}() {\n${zshArguments([...optionSpecs, ...argumentSpecs, "*::arg:->args"])}\n}`;
}

function renderBranchCommandFunction(command: CliCommandSpec): string {
  const functionName = commandFunctionName(command);
  const nestedArray = `${functionName}_commands`;
  const optionSpecs = (command.options ?? []).flatMap(zshOptionSpecs);
  const specs = [
    ...optionSpecs,
    `1:${command.name} command:->command`,
    "*::arg:->args",
  ];
  const body = [
    `local -a ${nestedArray}`,
    `${nestedArray}=(`,
    ...commandEntries(command.commands ?? []).map(
      (entry) => `  ${zshQuote(entry)}`,
    ),
    ")",
    "local state",
    `_arguments -C -S ${"\\"}`,
    ...continued(specs, "  "),
    "",
    "case $state in",
    "  command)",
    `    _describe -t commands '${command.name} command' ${nestedArray}`,
    "    ;;",
    "  args)",
    "    local subcommand=${words[2]}",
    "    shift words",
    "    (( CURRENT-- ))",
    "    case $subcommand in",
    ...(command.commands ?? []).flatMap((subcommand) => [
      `      ${commandPatterns(subcommand)})`,
      `        ${commandFunctionName(subcommand, command.name)}`,
      "        ;;",
    ]),
    "    esac",
    "    ;;",
    "esac",
  ].join("\n");

  return `${functionName}() {\n${indent(body)}\n}`;
}

function renderCommandFunction(command: CliCommandSpec): string {
  return command.commands && command.commands.length > 0
    ? renderBranchCommandFunction(command)
    : renderLeafCommandFunction(command);
}

function indent(value: string): string {
  return value
    .split("\n")
    .map((line) => (line.length > 0 ? `  ${line}` : line))
    .join("\n");
}

function renderNestedCommandFunctions(
  command: CliCommandSpec,
): readonly string[] {
  return (
    command.commands?.map((subcommand) =>
      renderLeafCommandFunction(subcommand, command.name),
    ) ?? []
  );
}

function renderZshDispatcher(): string {
  return [
    "_dot_complete_command() {",
    "  local command=$1",
    "",
    "  case $command in",
    ...cliCommands.flatMap((command) => [
      `    ${commandPatterns(command)})`,
      `      ${commandFunctionName(command)}`,
      "      ;;",
    ]),
    "  esac",
    "}",
    "",
    "if (( CURRENT > 2 )); then",
    "  local command=${words[2]}",
    "  shift words",
    "  (( CURRENT-- ))",
    '  _dot_complete_command "$command"',
    "  return",
    "fi",
    "",
    "local state",
    `_arguments -C -S ${"\\"}`,
    "  '(-h --help)-h[Show help message]' \\",
    "  '(-h --help)--help[Show help message]' \\",
    "  '1:dot command:->command' && return",
    "",
    "case $state in",
    "  command)",
    "    _describe -t commands 'dot command' dot_commands",
    "    ;;",
    "esac",
  ].join("\n");
}

/** Render the Zsh completion script for `dot`. */
export function renderZshCompletions(): string {
  return [
    "#compdef dot",
    "# Generated by dot completions zsh. Do not edit by hand.",
    "",
    "local -a dot_commands",
    "dot_commands=(",
    ...commandEntries(cliCommands).map((entry) => `  ${zshQuote(entry)}`),
    ")",
    "",
    ...cliCommands.flatMap((command) => [
      renderCommandFunction(command),
      ...renderNestedCommandFunctions(command),
    ]),
    renderZshDispatcher(),
    "",
  ].join("\n");
}

function parseCompletionArgs(args: readonly string[]): CompletionOptions {
  const shellArg = args.find((arg) => !arg.startsWith("-"));
  const shell = shellArg ?? "zsh";
  if (shell !== "zsh") {
    console.error(`dot completions: unsupported shell '${shell}'`);
    process.exit(1);
  }

  return { shell, stdout: args.includes("--stdout") };
}

/** Write generated Zsh completions into the public dotfiles stow package. */
export const writeZshCompletions = Effect.gen(function* () {
  const config = yield* Config;
  const target = join(config.publicDotfiles, ZSH_COMPLETION_RELATIVE_PATH);
  yield* Effect.sync(() => {
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, renderZshCompletions());
  });
  return target;
});

/** Generate shell completions for `dot`. */
export function completions(args: readonly string[] = []) {
  return Effect.gen(function* () {
    if (args.includes("--help") || args.includes("-h")) {
      yield* Effect.sync(() => console.log(renderHelp("completions")));
      return;
    }

    const options = parseCompletionArgs(args);
    if (options.stdout) {
      yield* Effect.sync(() => process.stdout.write(renderZshCompletions()));
      return;
    }

    const target = yield* writeZshCompletions;
    const log = yield* OutputLog;
    yield* log.info(
      `Generated ${options.shell ?? "zsh"} completions: ${target}`,
    );
  });
}
