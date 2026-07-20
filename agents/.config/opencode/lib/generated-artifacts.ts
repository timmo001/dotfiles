import { isAbsolute, relative, resolve } from "node:path";

interface GeneratedArtifact {
  readonly path: string;
  readonly command: string;
}

const GENERATED_ARTIFACTS = [
  {
    path: "docs/src/content/docs/dot/commands.md",
    command: "mise run docs:gen:cli",
  },
  ...["agents.md", "commands.md", "skills.md", "plugins.md"].map((name) => ({
    path: `docs/src/content/docs/reference/${name}`,
    command: "mise run docs:gen:opencode",
  })),
  {
    path: "bash/.local/share/bash-completion/completions/dot",
    command: "scripts/.local/bin/dot completions bash",
  },
  {
    path: "fish/.config/fish/completions/dot.fish",
    command: "scripts/.local/bin/dot completions fish",
  },
  {
    path: "zsh/.local/share/zsh/site-functions/_dot",
    command: "scripts/.local/bin/dot completions zsh",
  },
  {
    path: "scripts/.local/bin/dot",
    command: "mise run dot:build",
  },
  {
    path: "docs/public/og.png",
    command: "mise run docs:og",
  },
] satisfies readonly GeneratedArtifact[];

const PATCH_PATH_PATTERN = /^\*\*\* (?:Add|Delete|Update) File: (.+)$/gm;
const PATCH_MOVE_PATTERN = /^\*\*\* Move to: (.+)$/gm;
const SHELL_SEGMENT_PATTERN = /(?:&&|\|\||[;|])/g;
const READ_ONLY_SHELL_COMMANDS = new Set([
  "bat",
  "cat",
  "diff",
  "file",
  "git add",
  "git diff",
  "git show",
  "less",
  "ls",
  "more",
  "rg",
  "stat",
  "test",
  "wc",
]);

function repositoryRelativePath(root: string, target: string): string | null {
  const absoluteTarget = isAbsolute(target)
    ? resolve(target)
    : resolve(root, target);
  const relativeTarget = relative(resolve(root), absoluteTarget);
  return relativeTarget.startsWith("..") || isAbsolute(relativeTarget)
    ? null
    : relativeTarget;
}

export function generatedArtifactForPath(
  root: string,
  target: string,
  base = root,
): GeneratedArtifact | undefined {
  const absoluteTarget = isAbsolute(target) ? target : resolve(base, target);
  const relativeTarget = repositoryRelativePath(root, absoluteTarget);
  return GENERATED_ARTIFACTS.find(({ path }) => path === relativeTarget);
}

export function generatedArtifactFromPatch(
  root: string,
  patch: string,
  base = root,
): GeneratedArtifact | undefined {
  for (const pattern of [PATCH_PATH_PATTERN, PATCH_MOVE_PATTERN]) {
    pattern.lastIndex = 0;
    for (const match of patch.matchAll(pattern)) {
      const artifact = generatedArtifactForPath(root, match[1].trim(), base);
      if (artifact) return artifact;
    }
  }
  return undefined;
}

export function generatedArtifactFromShell(
  root: string,
  command: string,
  base = root,
): GeneratedArtifact | undefined {
  for (const segment of command.split(SHELL_SEGMENT_PATTERN)) {
    const trimmed = segment.trim();
    const artifact = GENERATED_ARTIFACTS.find(({ path }) => {
      const absolutePath = resolve(root, path);
      const workdirRelativePath = relative(base, absolutePath);
      return (
        trimmed.includes(path) ||
        trimmed.includes(absolutePath) ||
        trimmed.includes(workdirRelativePath)
      );
    });
    if (!artifact) continue;

    const normalized = trimmed.replace(
      /^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s+)*/,
      "",
    );
    const readOnly = [...READ_ONLY_SHELL_COMMANDS].some(
      (prefix) => normalized === prefix || normalized.startsWith(`${prefix} `),
    );
    if (!readOnly) return artifact;
  }
  return undefined;
}
