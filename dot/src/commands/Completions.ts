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

const COMPLETION_TARGETS = {
  bash: "bash/.local/share/bash-completion/completions/dot",
  fish: "fish/.config/fish/completions/dot.fish",
  zsh: "zsh/.local/share/zsh/site-functions/_dot",
} satisfies Record<CompletionShell, string>;

const ZSH_CONTINUATION = ` ${"\\"}`;

interface CompletionOptions {
  readonly shell: CompletionShell;
  readonly stdout?: boolean;
}

function isCompletionShell(shell: string): shell is CompletionShell {
  return SUPPORTED_SHELLS.some((supported) => supported === shell);
}

function shellList(): string {
  return SUPPORTED_SHELLS.join(", ");
}

function shellIdentifier(value: string): string {
  return value.replace(/[^A-Za-z0-9_]/g, "_");
}

function bashQuote(value: string): string {
  return `'${value.replaceAll("'", "'\\''")}'`;
}

function fishQuote(value: string): string {
  return `'${value.replaceAll("\\", "\\\\").replaceAll("'", "\\'")}'`;
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

function commandWords(command: CliCommandSpec): readonly string[] {
  return [command.name, ...(command.aliases ?? [])];
}

function optionWords(options: readonly CliOptionSpec[]): readonly string[] {
  return options.flatMap((option) => [
    option.name,
    ...(option.short ? [option.short] : []),
  ]);
}

function choiceWords(choices: readonly CliValueChoice[]): string {
  return choices.map((choice) => choice.value).join(" ");
}

function bashValueCases(options: readonly CliOptionSpec[]): readonly string[] {
  const cases = options.flatMap((option) => {
    if (!option.valueName) return [];
    const patterns = [
      option.name,
      ...(option.short ? [option.short] : []),
    ].join("|");
    const completion = option.choices
      ? `COMPREPLY=( $(compgen -W ${bashQuote(choiceWords(option.choices))} -- "$cur") )`
      : option.completion === "file"
        ? 'COMPREPLY=( $(compgen -f -- "$cur") )'
        : undefined;
    if (!completion) return [];
    return [
      `    ${patterns})`,
      `      ${completion}`,
      "      return",
      "      ;;",
    ];
  });
  if (cases.length === 0) return [];
  return ["  case $prev in", ...cases, "  esac", ""];
}

function bashArgumentLines(
  command: CliCommandSpec,
  baseIndex: number,
): readonly string[] {
  return (command.arguments ?? []).flatMap((argument, index) => {
    const position = baseIndex + index;
    const guard = argument.repeatable
      ? `(( cword >= ${position} ))`
      : `(( cword == ${position} ))`;
    const completion = argument.choices
      ? `COMPREPLY=( $(compgen -W ${bashQuote(choiceWords(argument.choices))} -- "$cur") )`
      : argument.completion === "file"
        ? 'COMPREPLY=( $(compgen -f -- "$cur") )'
        : undefined;
    if (!completion) return [];
    return [`  if ${guard}; then`, `    ${completion}`, "    return", "  fi"];
  });
}

function bashOptionLines(options: readonly CliOptionSpec[]): readonly string[] {
  const words = optionWords(options);
  if (words.length === 0) return [];
  return [
    "  if [[ $cur == -* ]]; then",
    `    COMPREPLY=( $(compgen -W ${bashQuote(words.join(" "))} -- "$cur") )`,
    "    return",
    "  fi",
  ];
}

function renderBashLeafCommandFunction(
  command: CliCommandSpec,
  parent?: string,
): string {
  const functionName = commandFunctionName(command, parent);
  const options = command.options ?? [];
  const baseIndex = parent ? 3 : 2;
  return [
    `${functionName}() {`,
    "  local cur prev cword",
    "  cur=${COMP_WORDS[COMP_CWORD]}",
    "  prev=${COMP_WORDS[COMP_CWORD-1]}",
    "  cword=$COMP_CWORD",
    ...bashValueCases(options),
    ...bashOptionLines(options),
    ...bashArgumentLines(command, baseIndex),
    "}",
  ].join("\n");
}

function renderBashBranchCommandFunction(command: CliCommandSpec): string {
  const functionName = commandFunctionName(command);
  const options = command.options ?? [];
  const subcommands = command.commands ?? [];
  const subcommandWords = subcommands.flatMap(commandWords).join(" ");
  const topWords = [
    ...optionWords(options),
    ...subcommands.flatMap(commandWords),
  ];
  return [
    `${functionName}() {`,
    "  local cur prev cword subcommand",
    "  cur=${COMP_WORDS[COMP_CWORD]}",
    "  prev=${COMP_WORDS[COMP_CWORD-1]}",
    "  cword=$COMP_CWORD",
    "  subcommand=${COMP_WORDS[2]-}",
    ...bashValueCases(options),
    "  if (( cword > 2 )); then",
    "    case $subcommand in",
    ...subcommands.flatMap((subcommand) => [
      `      ${commandPatterns(subcommand)})`,
      `        ${commandFunctionName(subcommand, command.name)}`,
      "        return",
      "        ;;",
    ]),
    "    esac",
    "  fi",
    ...bashOptionLines(options),
    "  if (( cword == 2 )); then",
    `    COMPREPLY=( $(compgen -W ${bashQuote(topWords.join(" "))} -- "$cur") )`,
    "    return",
    "  fi",
    ...(subcommandWords
      ? [
          `  COMPREPLY=( $(compgen -W ${bashQuote(subcommandWords)} -- "$cur") )`,
        ]
      : []),
    "}",
  ].join("\n");
}

function renderBashCommandFunction(command: CliCommandSpec): string {
  return command.commands && command.commands.length > 0
    ? renderBashBranchCommandFunction(command)
    : renderBashLeafCommandFunction(command);
}

function renderBashDispatcher(): string {
  const rootWords = [...cliCommands.flatMap(commandWords), "-h", "--help"].join(
    " ",
  );
  return [
    "_dot() {",
    "  local cur cword command",
    "  COMPREPLY=()",
    "  cur=${COMP_WORDS[COMP_CWORD]}",
    "  cword=$COMP_CWORD",
    "  command=${COMP_WORDS[1]-}",
    "",
    "  if (( cword == 1 )); then",
    `    COMPREPLY=( $(compgen -W ${bashQuote(rootWords)} -- "$cur") )`,
    "    return",
    "  fi",
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
    "complete -F _dot dot",
  ].join("\n");
}

/** Render the Bash completion script for `dot`. */
export function renderBashCompletions(): string {
  return [
    "# bash completion for dot",
    "# Generated by dot completions bash. Do not edit by hand.",
    "",
    ...cliCommands.flatMap((command) => [
      renderBashCommandFunction(command),
      ...(command.commands?.map((subcommand) =>
        renderBashLeafCommandFunction(subcommand, command.name),
      ) ?? []),
    ]),
    renderBashDispatcher(),
    "",
  ].join("\n");
}

function fishCommandCondition(command: CliCommandSpec): string {
  return `__fish_seen_subcommand_from ${commandWords(command).join(" ")}`;
}

function fishChildCondition(
  command: CliCommandSpec,
  child?: CliCommandSpec,
): string {
  const parentCondition = fishCommandCondition(command);
  if (child) return `${parentCondition}; and ${fishCommandCondition(child)}`;
  const childWords = command.commands?.flatMap(commandWords).join(" ");
  return childWords
    ? `${parentCondition}; and not __fish_seen_subcommand_from ${childWords}`
    : parentCondition;
}

function fishOptionParts(option: CliOptionSpec): readonly string[] {
  const parts = ["complete", "-c", "dot"];
  if (option.short) parts.push("-s", option.short.slice(1));
  parts.push("-l", option.name.slice(2), "-d", fishQuote(option.description));
  if (option.valueName) parts.push("-r");
  if (option.completion === "file") parts.push("-F");
  if (option.choices) parts.push("-a", fishQuote(choiceWords(option.choices)));
  return parts;
}

function fishOptionLine(condition: string, option: CliOptionSpec): string {
  return [...fishOptionParts(option), "-n", fishQuote(condition)].join(" ");
}

function fishArgumentLines(
  condition: string,
  command: CliCommandSpec,
): readonly string[] {
  return (command.arguments ?? []).flatMap((argument) => {
    if (!argument.choices) return [];
    return [
      `complete -c dot -n ${fishQuote(condition)} -a ${fishQuote(choiceWords(argument.choices))}`,
    ];
  });
}

/** Render the Fish completion script for `dot`. */
export function renderFishCompletions(): string {
  const lines = [
    "# fish completion for dot",
    "# Generated by dot completions fish. Do not edit by hand.",
    "",
    "complete -c dot -f",
    "complete -c dot -s h -l help -d 'Show help message'",
  ];

  for (const command of cliCommands) {
    for (const word of commandWords(command)) {
      const description =
        word === command.name ? command.summary : `Alias for ${command.name}`;
      lines.push(
        `complete -c dot -n '__fish_use_subcommand' -a ${fishQuote(word)} -d ${fishQuote(description)}`,
      );
    }
    const condition = fishChildCondition(command);
    for (const option of command.options ?? []) {
      lines.push(fishOptionLine(condition, option));
    }
    lines.push(...fishArgumentLines(condition, command));
    for (const child of command.commands ?? []) {
      for (const word of commandWords(child)) {
        const description =
          word === child.name ? child.summary : `Alias for ${child.name}`;
        lines.push(
          `complete -c dot -n ${fishQuote(fishChildCondition(command))} -a ${fishQuote(word)} -d ${fishQuote(description)}`,
        );
      }
      const childCondition = fishChildCondition(command, child);
      for (const option of child.options ?? []) {
        lines.push(fishOptionLine(childCondition, option));
      }
      lines.push(...fishArgumentLines(childCondition, child));
    }
  }

  return `${lines.join("\n")}\n`;
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

/** Render the completion script for `dot` and a supported shell. */
export function renderCompletions(shell: CompletionShell): string {
  switch (shell) {
    case "bash":
      return renderBashCompletions();
    case "fish":
      return renderFishCompletions();
    case "zsh":
      return renderZshCompletions();
  }
}

function parseCompletionArgs(args: readonly string[]): CompletionOptions {
  const shellArg = args.find((arg) => !arg.startsWith("-"));
  const shell = shellArg ?? "zsh";
  if (!isCompletionShell(shell)) {
    console.error(
      `dot completions: unsupported shell '${shell}' (expected: ${shellList()})`,
    );
    process.exit(1);
  }

  return { shell, stdout: args.includes("--stdout") };
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

/** Write generated completions for every supported shell. */
export const writeAllCompletions = Effect.all(
  SUPPORTED_SHELLS.map((shell) => writeCompletions(shell)),
);

/** Backwards-compatible Zsh completion writer for existing callers. */
export const writeZshCompletions = writeCompletions("zsh");

/** Generate shell completions for `dot`. */
export function completions(args: readonly string[] = []) {
  return Effect.gen(function* () {
    if (args.includes("--help") || args.includes("-h")) {
      yield* Effect.sync(() => console.log(renderHelp("completions")));
      return;
    }

    const options = parseCompletionArgs(args);
    if (options.stdout) {
      yield* Effect.sync(() =>
        process.stdout.write(renderCompletions(options.shell)),
      );
      return;
    }

    const target = yield* writeCompletions(options.shell);
    const log = yield* OutputLog;
    yield* log.info(`Generated ${options.shell} completions: ${target}`);
  });
}
