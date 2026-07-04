// Generates docs/src/content/docs/dot/commands.md from the dot CLI command
// registry at dot/src/cli/spec.ts - the same source that drives `dot help`
// and shell completions. Run with: mise run docs:gen:cli
//
// Do not edit the generated page by hand. Change dot/src/cli/spec.ts instead
// and re-run this script (alongside `dot completions zsh`).
import { writeFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import {
  cliCommands,
  type CliCommandSpec,
  type CliOptionSpec,
  type CliArgumentSpec,
} from '../../dot/src/cli/spec.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outFile = path.join(root, 'src/content/docs/dot/commands.md');

const lines: string[] = [];
const push = (line = '') => lines.push(line);

const code = (text: string) => `\`${text}\``;

function optionLabel(option: CliOptionSpec): string {
  const parts = [code(option.name)];
  if (option.short) parts.push(code(option.short));
  if (option.valueName) parts.push(code(`<${option.valueName}>`));
  return parts.join(' ');
}

function optionDescription(option: CliOptionSpec): string {
  let desc = option.description;
  if (option.choices?.length) {
    const values = option.choices.map((c) => code(c.value)).join(', ');
    desc += ` (one of: ${values})`;
  }
  return desc;
}

function renderOptions(options: readonly CliOptionSpec[]): void {
  const visible = options.filter((o) => o.name !== '--help');
  if (!visible.length) return;
  push('**Options**');
  push();
  push('| Option | Description |');
  push('| --- | --- |');
  for (const option of visible) {
    push(`| ${optionLabel(option)} | ${optionDescription(option)} |`);
  }
  push();
}

function renderArguments(args: readonly CliArgumentSpec[]): void {
  if (!args.length) return;
  push('**Arguments**');
  push();
  push('| Argument | Description |');
  push('| --- | --- |');
  for (const arg of args) {
    let desc = arg.description ?? '';
    if (arg.repeatable) desc += desc ? ' (repeatable)' : 'Repeatable.';
    if (arg.choices?.length) {
      const values = arg.choices.map((c) => code(c.value)).join(', ');
      desc += `${desc ? ' ' : ''}One of: ${values}.`;
    }
    push(`| ${code(`<${arg.name}>`)} | ${desc.trim()} |`);
  }
  push();
}

function renderSections(sections: CliCommandSpec['sections']): void {
  if (!sections?.length) return;
  for (const section of sections) {
    push(`**${section.title}**`);
    push();
    push('```text');
    for (const line of section.lines) push(line);
    push('```');
    push();
  }
}

function renderCommand(command: CliCommandSpec, prefix: string, depth: number): void {
  const heading = '#'.repeat(depth);
  const fullName = `${prefix}${command.name}`.trim();
  push(`${heading} ${code(`dot ${fullName}`)}`);
  push();

  if (command.aliases?.length) {
    const aliasList = command.aliases.map((a) => code(`dot ${a}`)).join(', ');
    push(`Aliases: ${aliasList}`);
    push();
  }

  push(command.summary);
  push();

  push('```text');
  push(`dot ${fullName}${command.usage ? ` ${command.usage}` : ''}`);
  push('```');
  push();

  if (command.description?.length) {
    for (const paragraph of command.description) {
      push(paragraph);
    }
    push();
  }

  if (command.modes?.length) {
    push('**Modes**');
    push();
    push('```text');
    for (const mode of command.modes) push(mode);
    push('```');
    push();
  }

  if (command.options?.length) renderOptions(command.options);
  if (command.arguments?.length) renderArguments(command.arguments);
  renderSections(command.sections);

  if (command.examples?.length) {
    push('**Examples**');
    push();
    push('```bash');
    for (const example of command.examples) push(example);
    push('```');
    push();
  }

  if (command.commands?.length) {
    for (const sub of command.commands) {
      renderCommand(sub, `${fullName} `, Math.min(depth + 1, 4));
    }
  }
}

push('---');
push('title: Command Reference');
push(
  'description: Every dot command, alias, flag and example, generated from the CLI registry.',
);
push('---');
push();
push(
  '<!-- Generated from dot/src/cli/spec.ts by `mise run docs:gen:cli`. Do not edit by hand. -->',
);
push();
push(
  'This page lists every `dot` command, generated from the same registry that powers `dot help` and shell completions. Run any command with `--help` to see the same details at the terminal.',
);
push();

for (const command of cliCommands) {
  renderCommand(command, '', 2);
}

await mkdir(path.dirname(outFile), { recursive: true });
await writeFile(outFile, `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`);
console.log(`Wrote ${path.relative(root, outFile)}`);
