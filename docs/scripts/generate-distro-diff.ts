// Generates the page listing what this distro branch removed, changed and
// added compared with the default branch, measured from their merge base.
import { existsSync } from 'node:fs';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { currentDistro } from '../current-distro.ts';
import { distroById, distros } from '../distros.ts';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const repoRoot = path.resolve(root, '..');
const outFile = path.join(root, 'src/content/docs/server/changes.md');
const blobBase = 'https://github.com/timmo001/dotfiles/blob';

const current = distroById(currentDistro);
const base = distros[0];

if (current.id === base.id) {
  console.log('On the default branch, nothing to compare');
  process.exit(0);
}

function git(...args: string[]): string {
  const result = Bun.spawnSync(['git', ...args], { cwd: repoRoot, stderr: 'pipe' });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(' ')} failed: ${result.stderr.toString().trim()}`);
  }
  return result.stdout.toString();
}

const succeeds = (...args: string[]) =>
  Bun.spawnSync(['git', ...args], { cwd: repoRoot, stdout: 'ignore', stderr: 'ignore' }).exitCode === 0;

const baseRef = `origin/${base.branch}`;

// Build clones are shallow and may only have this branch, so fetch the
// default branch and the full history from the public repository when the
// merge base is out of reach.
if (!succeeds('merge-base', baseRef, 'HEAD')) {
  const shallow = git('rev-parse', '--is-shallow-repository').trim() === 'true';
  git(
    'fetch',
    '--quiet',
    ...(shallow ? ['--unshallow'] : []),
    'https://github.com/timmo001/dotfiles.git',
    `+refs/heads/${base.branch}:refs/remotes/${baseRef}`,
  );
}

const mergeBase = git('merge-base', baseRef, 'HEAD').trim();
const lines = (text: string) => text.split('\n').filter((line) => line !== '');

interface Change {
  readonly status: 'A' | 'D' | 'M' | 'R';
  readonly path: string;
  readonly from?: string;
}

// Compare with the working tree, so regenerating before a commit includes it.
const untracked = lines(git('ls-files', '--others', '--exclude-standard')).filter(
  (file) => path.join(repoRoot, file) !== outFile,
);
const changes: Change[] = [
  ...lines(git('diff', '--name-status', '--find-renames', mergeBase))
    .filter((line) => !line.endsWith(`\t${path.relative(repoRoot, outFile)}`))
    .map((line): Change => {
    const [code = '', first = '', second] = line.split('\t');
    const status = code.charAt(0);
    if (status === 'R' && second) return { status: 'R', path: second, from: first };
    if (status === 'A' || status === 'D') return { status, path: first };
    return { status: 'M', path: first };
  }),
  ...untracked.map((file): Change => ({ status: 'A', path: file })),
];

const numstat = new Map<string, string>();
for (const line of lines(git('diff', '--numstat', '--find-renames', mergeBase))) {
  const [added = '', removed = '', ...rest] = line.split('\t');
  const file = rest.join('\t').replace(/^(.*)\{(.*) => (.*)\}(.*)$/, '$1$3$4').replace(/^.* => /, '');
  numstat.set(file, added === '-' ? 'binary' : `+${added} -${removed}`);
}
for (const file of untracked) {
  numstat.set(file, `+${(await Bun.file(path.join(repoRoot, file)).text()).split('\n').length - 1} -0`);
}

const topLevel = (file: string) => (file.includes('/') ? file.slice(0, file.indexOf('/')) : null);

const removedFolders = new Map<string, number>();
const removedFiles: string[] = [];
for (const change of changes) {
  if (change.status !== 'D') continue;
  const folder = topLevel(change.path);
  if (folder && !existsSync(path.join(repoRoot, folder))) {
    removedFolders.set(folder, (removedFolders.get(folder) ?? 0) + 1);
  } else {
    removedFiles.push(change.path);
  }
}

const code = (text: string) => `\`${text}\``;
const baseLink = (file: string) => `[desktop](${blobBase}/${mergeBase}/${file})`;
const headLink = (file: string) => `[server](${blobBase}/${current.branch}/${file})`;
const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`;
const byPath = (a: string, b: string) => a.localeCompare(b);

const out: string[] = [];
const push = (line = '') => out.push(line);

push('---');
push('title: Changes from the desktop');
push(`description: What the ${current.label} branch removed, changed and added compared with ${base.branch}.`);
push('---');
push();
push('<!-- Generated from git by `mise run docs:gen:distro-diff`. Do not edit by hand. -->');
push();
push(
  `This page compares ${code(current.branch)} with the default branch, ${code(base.branch)} ([${base.label}](https://${base.site}/)), from the commit they last shared: ${code(mergeBase.slice(0, 7))}. It moves when this branch changes or is rebased onto the default branch, not on every desktop commit.`,
);
push();

push('## Removed folders');
push();
if (removedFolders.size === 0) {
  push('None.');
} else {
  push('Whole top-level folders (mostly stow packages) that this branch does not ship.');
  push();
  push('| Folder | Files |');
  push('| --- | --- |');
  for (const [folder, count] of [...removedFolders].sort(([a], [b]) => byPath(a, b))) {
    push(`| [${code(`${folder}/`)}](https://github.com/timmo001/dotfiles/tree/${mergeBase}/${folder}) | ${count} |`);
  }
}
push();

push('## Removed files');
push();
if (removedFiles.length === 0) {
  push('None.');
} else {
  push(`${plural(removedFiles.length, 'file')} removed from folders that stay.`);
  push();
  push('| File | Was |');
  push('| --- | --- |');
  for (const file of removedFiles.sort(byPath)) push(`| ${code(file)} | ${baseLink(file)} |`);
}
push();

const changed = changes.filter((change) => change.status === 'M' || change.status === 'R').sort((a, b) => byPath(a.path, b.path));
push('## Changed files');
push();
if (changed.length === 0) {
  push('None.');
} else {
  push(`${plural(changed.length, 'file')} in both branches with different contents.`);
  push();
  push('| File | Lines | Compare |');
  push('| --- | --- | --- |');
  for (const change of changed) {
    const name = change.from ? `${code(change.path)} (was ${code(change.from)})` : code(change.path);
    push(`| ${name} | ${numstat.get(change.path) ?? ''} | ${baseLink(change.from ?? change.path)}, ${headLink(change.path)} |`);
  }
}
push();

const added = changes.filter((change) => change.status === 'A').map((change) => change.path).sort(byPath);
push('## Added files');
push();
if (added.length === 0) {
  push('None.');
} else {
  push(`${plural(added.length, 'file')} only on this branch.`);
  push();
  push('| File | Lines |');
  push('| --- | --- |');
  for (const file of added) push(`| [${code(file)}](${blobBase}/${current.branch}/${file}) | ${numstat.get(file) ?? ''} |`);
}

await mkdir(path.dirname(outFile), { recursive: true });
await writeFile(outFile, `${out.join('\n')}\n`);
console.log(`Wrote ${path.relative(root, outFile)}`);
