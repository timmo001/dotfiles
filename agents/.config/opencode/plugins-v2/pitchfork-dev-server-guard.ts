import { Plugin } from "@opencode-ai/plugin/effect";
import { Tool } from "@opencode-ai/schema/tool";
import { Effect } from "effect";
import { access, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, dirname, isAbsolute, join, resolve } from "node:path";

interface PitchforkProject {
  readonly root: string;
  readonly tasks: ReadonlySet<string>;
  readonly daemons: ReadonlySet<string>;
}

interface RedirectNotice {
  readonly command: string;
  readonly replacement: string;
}

type CommandCandidate =
  | { readonly kind: "run-aggregate" }
  | { readonly kind: "dev-aggregate" }
  | { readonly kind: "target"; readonly target: string };

const MANAGEMENT_SERVE_TASKS = new Set([
  "serve:logs",
  "serve:restart",
  "serve:status",
  "serve:stop",
]);

const PITCHFORK_CONFIG_FILES = [
  "pitchfork.toml",
  "pitchfork.local.toml",
  ".config/pitchfork.toml",
  ".config/pitchfork.local.toml",
];

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? { ...value } : {};
}

function stringArg(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function expandHome(path: string): string {
  return path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

function resolveToolWorkdir(value: unknown, fallback: string): string {
  const raw = expandHome(stringArg(value));
  if (!raw) return fallback;
  return isAbsolute(raw) ? raw : resolve(fallback, raw);
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function stripLeadingEnv(command: string): string {
  return command.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s+)*/, "");
}

function withoutLeadingCd(command: string, cwd: string): { command: string; cwd: string } {
  const match = command.match(/^cd\s+((?:"[^"]+"|'[^']+'|[^\s;&|]+))\s*&&\s*(.+)$/);
  if (!match) return { command, cwd };

  const nextDir = unquote(match[1]);
  return {
    command: match[2].trim(),
    cwd: isAbsolute(nextDir) ? nextDir : resolve(cwd, nextDir),
  };
}

function fileExists(path: string) {
  return Effect.tryPromise(() => access(path)).pipe(
    Effect.as(true),
    Effect.catch(() => Effect.succeed(false)),
  );
}

function readText(path: string) {
  return Effect.tryPromise({
    try: () => readFile(path, "utf8"),
    catch: (error) =>
      new Tool.Error({ message: `Failed to read ${path}`, error }),
  });
}

function findFirstExistingConfig(root: string) {
  return Effect.gen(function* () {
    for (const file of PITCHFORK_CONFIG_FILES) {
      const candidate = join(root, file);
      if (yield* fileExists(candidate)) return candidate;
    }
    return null;
  });
}

function parseMiseTasks(text: string): Set<string> {
  const tasks = new Set<string>();
  for (const match of text.matchAll(/^\s*\[tasks(?:\."([^"]+)"|\.([A-Za-z0-9_:-]+))\]\s*$/gm)) {
    const task = match[1] ?? match[2];
    if (task) tasks.add(task);
  }
  return tasks;
}

function parsePitchforkDaemons(text: string): Set<string> {
  const daemons = new Set<string>();
  for (const match of text.matchAll(/^\s*\[daemons(?:\."([^"]+)"|\.([A-Za-z0-9_.-]+))\]\s*$/gm)) {
    const daemon = match[1] ?? match[2];
    if (daemon) daemons.add(daemon);
  }
  return daemons;
}

function readTasks(root: string) {
  return Effect.gen(function* () {
    const misePath = join(root, "mise.toml");
    if (!(yield* fileExists(misePath))) return new Set<string>();
    return parseMiseTasks(yield* readText(misePath));
  });
}

function findPitchforkProject(cwd: string) {
  return Effect.gen(function* () {
    let current = resolve(cwd);
    while (true) {
      const configPath = yield* findFirstExistingConfig(current);
      if (configPath) {
        return {
          root: current,
          tasks: yield* readTasks(current),
          daemons: parsePitchforkDaemons(yield* readText(configPath)),
        } satisfies PitchforkProject;
      }

      const parent = dirname(current);
      if (parent === current) return null;
      current = parent;
    }
  });
}

function isPitchforkCommand(command: string): boolean {
  return /(?:^|\s)(?:pitchfork|mise\s+run\s+serve:[A-Za-z0-9_-]+)/.test(command);
}

function candidateFromCommand(command: string, cwd: string, projectRoot: string): CommandCandidate | null {
  const stripped = stripLeadingEnv(command.trim());
  if (isPitchforkCommand(stripped)) return null;

  const miseRunMatch = stripped.match(/^mise\s+run\s+run(?::([A-Za-z0-9_-]+))?(?:\s|$)/);
  if (miseRunMatch) {
    return miseRunMatch[1]
      ? { kind: "target", target: miseRunMatch[1] }
      : { kind: "run-aggregate" };
  }
  if (/^(?:mise\s+run\s+dev|mise\s+dev)(?:\s|$)/.test(stripped)) return { kind: "dev-aggregate" };
  if (/^(?:(?:bun|npm|yarn)\s+run\s+dev|pnpm\s+(?:run\s+)?dev|vite)(?:\s|$)/.test(stripped)) {
    return cwd === projectRoot
      ? { kind: "dev-aggregate" }
      : { kind: "target", target: basename(cwd) };
  }
  if (/\bha\s+bridge\s+serve(?:\s|$)/.test(stripped)) return { kind: "target", target: "ha-bridge" };
  if (/\bsystem-bridge(?:-linux)?\s+backend(?:\s|$)/.test(stripped)) {
    return { kind: "target", target: "backend" };
  }
  return null;
}

function startTasks(project: PitchforkProject): string[] {
  return [...project.tasks]
    .filter((task) => task.startsWith("serve:") && !MANAGEMENT_SERVE_TASKS.has(task))
    .sort();
}

function targetAliases(target: string): string[] {
  const aliases = [target];
  if (target.endsWith("-dev")) aliases.push(target.replace(/-dev$/, ""));
  if (target.endsWith("-client")) aliases.push(target.replace(/-client$/, ""));
  if (target.includes("web")) aliases.push("web", "frontend", "client");
  if (target.includes("front")) aliases.push("frontend", "web");
  if (target.includes("back")) aliases.push("backend", "api");
  if (target.includes("bridge") || target.includes("home-assistant")) aliases.push("ha-bridge", "bridge");
  return [...new Set(aliases)];
}

function commandForTarget(project: PitchforkProject, target: string): string | null {
  for (const alias of targetAliases(target)) {
    const task = `serve:${alias}`;
    if (project.tasks.has(task)) return `mise run ${task}`;
    if (project.daemons.has(alias)) return `pitchfork start ${alias}`;
  }
  return null;
}

function commandForCandidate(project: PitchforkProject, candidate: CommandCandidate): string | null {
  if (candidate.kind === "target") return commandForTarget(project, candidate.target);
  if (project.tasks.has("serve:all")) return "mise run serve:all";
  if (candidate.kind === "run-aggregate") return null;

  const tasks = startTasks(project);
  if (tasks.length === 1) return `mise run ${tasks[0]}`;
  if (project.daemons.size > 0) return "pitchfork start -l";
  return null;
}

function pitchforkHint(project: PitchforkProject): string {
  const tasks = startTasks(project);
  if (tasks.length) return tasks.map((task) => `mise run ${task}`).join(", ");
  if (project.daemons.size) return "pitchfork start -l";
  return "add a serve:* task or run pitchfork from the project root";
}

function foregroundServerError(command: string, replacement: string | null, project: PitchforkProject) {
  return new Tool.Error({
    message:
      `Foreground dev-server command blocked: ${command}\n` +
      `This project declares pitchfork dev servers. Run ${replacement ?? pitchforkHint(project)} instead.`,
  });
}

export default Plugin.define({
  id: "pitchfork-dev-server-guard",
  effect: (context) =>
    Effect.gen(function* () {
      const redirects = new Map<Tool.CallID, RedirectNotice>();

      yield* context.tool.hook("execute.before", (event) =>
        Effect.gen(function* () {
          if (event.tool !== "shell" && event.tool !== "bash") return;

          const args = recordFromUnknown(event.input);
          const command = stringArg(args.command);
          if (!command) return;

          const session = yield* context.session.get({ sessionID: event.sessionID }).pipe(Effect.orDie);
          const baseDirectory = session.location.directory;
          const initialCwd = resolveToolWorkdir(args.workdir, baseDirectory);
          const normalized = withoutLeadingCd(command.trim(), initialCwd);
          const project = yield* findPitchforkProject(normalized.cwd);
          if (!project) return;

          const candidate = candidateFromCommand(normalized.command, normalized.cwd, project.root);
          if (!candidate) return;

          const replacement = commandForCandidate(project, candidate);
          if (!replacement && (candidate.kind === "target" || candidate.kind === "run-aggregate")) return;
          if (!replacement) return yield* Effect.fail(foregroundServerError(normalized.command, replacement, project));

          redirects.set(event.id, { command: normalized.command, replacement });
          event.input = { ...args, command: replacement, workdir: project.root };
        }),
      );

      yield* context.tool.hook("execute.after", (event) =>
        Effect.sync(() => {
          if (event.tool !== "shell" && event.tool !== "bash") return;

          const notice = redirects.get(event.id);
          if (!notice) return;
          redirects.delete(event.id);
          if (event.status !== "completed") return;

          const message =
            `pitchfork-dev-server-guard: ${notice.command} was replaced with ${notice.replacement} ` +
            "because this project declares pitchfork dev servers.";
          const content = Array.isArray(event.result.content)
            ? [{ type: "text" as const, text: message }, ...event.result.content]
            : [message, event.result.content].filter(Boolean).join("\n\n");
          event.result = {
            ...event.result,
            content,
            metadata: {
              ...recordFromUnknown(event.result.metadata),
              pitchfork_dev_server_guard: notice,
            },
          };
        }),
      );
    }),
});
