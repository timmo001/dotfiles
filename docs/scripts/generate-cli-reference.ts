// Generates the command reference from the executable Effect command tree.
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { commandDocs, commandHelp, dotCommand } from '../../dot/src/cli/spec.ts';

type AnyCommand = (typeof dotCommand.subcommands)[number]['commands'][number];

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const outFile = path.join(root, 'src/content/docs/dot/commands.md');
const lines: string[] = [];
const push = (line = '') => lines.push(line);
const code = (text: string) => `\`${text}\``;

function optionValue(option: { readonly _tag: string; readonly value?: string }): string {
  return option._tag === 'Some' ? (option.value ?? '') : '';
}

function renderCommand(command: AnyCommand, parent: readonly string[], depth: number): void {
  const commandPath = [...parent, command.name];
  const help = commandHelp(command, ['dot', ...commandPath]);
  const docs = commandDocs(command);
  push(`${'#'.repeat(depth)} ${code(`dot ${commandPath.join(' ')}`)}`);
  push();
  if (command.alias) {
    push(`Aliases: ${code(`dot ${[...parent, command.alias].join(' ')}`)}`);
    push();
  }
  push(command.shortDescription ?? command.description ?? '');
  push();
  push('```text');
  push(help.usage);
  push('```');
  push();
  const description = docs?.description ?? command.description;
  if (description && description !== command.shortDescription) {
    push(description);
    push();
  }
  if (docs?.modes?.length) {
    push('**Modes**');
    push();
    push('```text');
    for (const mode of docs.modes) push(mode);
    push('```');
    push();
  }
  const flags = [...help.flags, ...(help.globalFlags ?? [])];
  if (flags.length > 0) {
    push('**Options**');
    push();
    push('| Option | Description |');
    push('| --- | --- |');
    for (const flag of flags) {
      const names = [flag.name, ...flag.aliases].map((name) => code(name.startsWith('-') ? name : `--${name}`)).join(' ');
      push(`| ${names}${flag.type === 'boolean' ? '' : ` ${code(`<${flag.type}>`)}`} | ${optionValue(flag.description)} |`);
    }
    push();
  }
  if (help.args?.length) {
    push('**Arguments**');
    push();
    push('| Argument | Description |');
    push('| --- | --- |');
    for (const argument of help.args) push(`| ${code(`<${argument.name}>`)} | ${optionValue(argument.description) || argument.name} |`);
    push();
  }
  for (const section of docs?.sections ?? []) {
    push(`**${section.title}**`);
    push();
    push('```text');
    for (const line of section.lines) push(line);
    push('```');
    push();
  }
  if (command.examples.length > 0) {
    push('**Examples**');
    push();
    push('```bash');
    for (const example of command.examples) push(example.command);
    push('```');
    push();
  }
  for (const group of command.subcommands) {
    for (const child of group.commands) renderCommand(child as AnyCommand, commandPath, Math.min(depth + 1, 4));
  }
}

push('---');
push('title: Command Reference');
push('description: Every dot command, alias, flag and example, generated from the CLI command tree.');
push('sidebar:');
push('  order: 2');
push('---');
push();
push('<!-- Generated from dot/src/cli/spec.ts by `mise run docs:gen:cli`. Do not edit by hand. -->');
push();
push('This page lists every `dot` command from the same Effect command tree that powers parsing, help, dispatch, and shell completions.');
push();
for (const group of dotCommand.subcommands) for (const command of group.commands) renderCommand(command, [], 2);

await mkdir(path.dirname(outFile), { recursive: true });
await writeFile(outFile, `${lines.join('\n').replace(/\n{3,}/g, '\n\n').trimEnd()}\n`);
console.log(`Wrote ${path.relative(root, outFile)}`);
