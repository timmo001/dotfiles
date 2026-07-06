import { cliCommands, getCliCommand, type CliCommandSpec } from "./spec.js";

const rootExamples = [
  "dot                      Main menu",
  "dot dashboard            Full-screen dashboard",
  "dot init --noninteractive --confirm",
  "dot update",
  "dot stow",
  "dot doctor",
  "dot git-diff             Interactive diff TUI",
  "dot git-diff --raw       Text diff summary",
  "dot git-diff --bar-json  Status bar JSON output",
  "dot git-log              Recent commits TUI",
  "dot git-log --raw        Text commit history summary",
  "dot git-workflows        Watched workflow runs TUI",
  "dot git-workflows --bar-json Status bar JSON output",
  "dot git-notifications    GitHub notifications TUI",
  "dot git-notifications --bar-json Status bar JSON output",
  "notes list               Repository notes CLI",
  "notes handoffs           Handoff notes CLI",
  "dot setup-private-repo Repair private pacman repo include",
  "dot private-pkg-publish twitch-notifications --install",
  "dot completions zsh",
  "dot omarchy theme        Omarchy theme submenu",
  "dot omarchy theme set    Execute omarchy theme set",
];

function usageFor(command: CliCommandSpec): string {
  return `Usage: dot ${command.name}${command.usage ? ` ${command.usage}` : ""}`;
}

function optionLabel(
  option: NonNullable<CliCommandSpec["options"]>[number],
): string {
  const names = option.short ? `${option.name}, ${option.short}` : option.name;
  return option.valueName ? `${names} <${option.valueName}>` : names;
}

function renderAligned(
  title: string,
  rows: readonly [string, string][],
): string[] {
  if (rows.length === 0) return [];
  const width = Math.max(...rows.map(([label]) => label.length));
  return [
    `${title}:`,
    ...rows.map(
      ([label, description]) => `  ${label.padEnd(width)}  ${description}`,
    ),
  ];
}

function renderCommand(command: CliCommandSpec): string {
  const lines: string[] = [usageFor(command), ""];

  if (command.description) lines.push(...command.description, "");
  if (command.modes)
    lines.push(...renderAligned("Modes", parseRows(command.modes)), "");
  if (command.commands) {
    lines.push(
      ...renderAligned(
        "Commands",
        command.commands.map((subcommand) => [
          commandLine(subcommand),
          subcommand.summary,
        ]),
      ),
      "",
    );
  }
  if (command.options) {
    lines.push(
      ...renderAligned(
        "Options",
        command.options.map((option) => [
          optionLabel(option),
          option.description,
        ]),
      ),
      "",
    );
  }
  if (command.sections) {
    for (const section of command.sections) {
      lines.push(
        `${section.title}:`,
        ...section.lines.map((line) => `  ${line}`),
        "",
      );
    }
  }
  if (command.examples)
    lines.push(
      "Examples:",
      ...command.examples.map((example) => `  ${example}`),
    );

  return trimBlankTail(lines).join("\n");
}

function commandLine(command: CliCommandSpec): string {
  const args =
    command.arguments?.map((arg) =>
      arg.repeatable ? `[${arg.name}...]` : `<${arg.name}>`,
    ) ?? [];
  const options = command.options?.length ? " [options]" : "";
  return `${command.name}${options}${args.length ? ` ${args.join(" ")}` : ""}`;
}

function parseRows(lines: readonly string[]): readonly [string, string][] {
  return lines.map((line) => {
    const match = /^(\S+(?:\s+\S+)*)\s{2,}(.+)$/.exec(line.trimEnd());
    return match ? [match[1], match[2]] : [line, ""];
  });
}

function trimBlankTail(lines: string[]): string[] {
  while (lines[lines.length - 1] === "") lines.pop();
  return lines;
}

function renderRootHelp(): string {
  return [
    "Usage: dot [subcommand] [options]",
    "",
    "Launch the dot TUI. Without a subcommand, opens the main menu.",
    "",
    ...renderAligned(
      "Subcommands",
      cliCommands.map((command) => [
        command.name === "omarchy" ? "omarchy [submenu..]" : command.name,
        command.summary,
      ]),
    ),
    "",
    "Options:",
    "  --help, -h  Show this help message",
    "",
    "Examples:",
    ...rootExamples.map((example) => `  ${example}`),
    "",
    "Run 'dot <subcommand> --help' for subcommand-specific options.",
  ].join("\n");
}

/** Render root or command-specific CLI help from the command registry. */
export function renderHelp(subcommand?: string): string {
  if (!subcommand) return renderRootHelp();
  return renderCommand(getCliCommand(subcommand) ?? getCliCommand("help")!);
}
