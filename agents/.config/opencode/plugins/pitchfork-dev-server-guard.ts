/**
 * @file Routes foreground dev-server shell commands to pitchfork-backed repo tasks.
 *
 * Keeps agent-started long-running servers in pitchfork when a project already
 * declares `pitchfork.toml`, while leaving unrelated one-shot commands alone.
 */

import type { Plugin } from "@opencode-ai/plugin"
import { access, readFile } from "node:fs/promises"
import { basename, dirname, isAbsolute, join, resolve } from "node:path"
import { homedir } from "node:os"

interface PitchforkProject {
  readonly root: string
  readonly tasks: ReadonlySet<string>
  readonly daemons: ReadonlySet<string>
}

type CommandCandidate =
  | { readonly kind: "run-aggregate" }
  | { readonly kind: "dev-aggregate" }
  | { readonly kind: "target"; readonly target: string }

const MANAGEMENT_SERVE_TASKS = new Set([
  "serve:logs",
  "serve:restart",
  "serve:status",
  "serve:stop",
])

const PITCHFORK_CONFIG_FILES = [
  "pitchfork.toml",
  "pitchfork.local.toml",
  ".config/pitchfork.toml",
  ".config/pitchfork.local.toml",
]

function recordFromUnknown(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
}

function stringArg(value: unknown): string {
  return typeof value === "string" ? value : ""
}

function expandHome(path: string): string {
  return path === "~" || path.startsWith("~/") ? join(homedir(), path.slice(2)) : path
}

function resolveToolWorkdir(value: unknown, fallback: string): string {
  const raw = expandHome(stringArg(value))
  if (!raw) return fallback
  return isAbsolute(raw) ? raw : resolve(fallback, raw)
}

function unquote(value: string): string {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1)
  }
  return value
}

function stripLeadingEnv(command: string): string {
  return command.replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=(?:"[^"]*"|'[^']*'|\S+)\s+)*/, "")
}

function withoutLeadingCd(command: string, cwd: string): { command: string; cwd: string } {
  const match = command.match(/^cd\s+((?:"[^"]+"|'[^']+'|[^\s;&|]+))\s*&&\s*(.+)$/)
  if (!match) return { command, cwd }

  const nextDir = unquote(match[1])
  return {
    command: match[2].trim(),
    cwd: isAbsolute(nextDir) ? nextDir : resolve(cwd, nextDir),
  }
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

async function findFirstExistingConfig(root: string): Promise<string | null> {
  for (const file of PITCHFORK_CONFIG_FILES) {
    const candidate = join(root, file)
    if (await fileExists(candidate)) return candidate
  }
  return null
}

function parseMiseTasks(text: string): Set<string> {
  const tasks = new Set<string>()
  for (const match of text.matchAll(/^\s*\[tasks(?:\."([^"]+)"|\.([A-Za-z0-9_:-]+))\]\s*$/gm)) {
    const task = match[1] ?? match[2]
    if (task) tasks.add(task)
  }
  return tasks
}

function parsePitchforkDaemons(text: string): Set<string> {
  const daemons = new Set<string>()
  for (const match of text.matchAll(/^\s*\[daemons(?:\."([^"]+)"|\.([A-Za-z0-9_.-]+))\]\s*$/gm)) {
    const daemon = match[1] ?? match[2]
    if (daemon) daemons.add(daemon)
  }
  return daemons
}

async function readTasks(root: string): Promise<Set<string>> {
  const misePath = join(root, "mise.toml")
  if (!(await fileExists(misePath))) return new Set()
  return parseMiseTasks(await readFile(misePath, "utf8"))
}

async function readDaemons(configPath: string): Promise<Set<string>> {
  return parsePitchforkDaemons(await readFile(configPath, "utf8"))
}

async function findPitchforkProject(cwd: string): Promise<PitchforkProject | null> {
  let current = resolve(cwd)
  while (true) {
    const configPath = await findFirstExistingConfig(current)
    if (configPath) {
      return {
        root: current,
        tasks: await readTasks(current),
        daemons: await readDaemons(configPath),
      }
    }

    const parent = dirname(current)
    if (parent === current) return null
    current = parent
  }
}

function isPitchforkCommand(command: string): boolean {
  return /(?:^|\s)(?:pitchfork|mise\s+run\s+serve:[A-Za-z0-9_-]+)/.test(command)
}

function candidateFromCommand(command: string, cwd: string, projectRoot: string): CommandCandidate | null {
  const stripped = stripLeadingEnv(command.trim())

  if (isPitchforkCommand(stripped)) return null

  const miseRunMatch = stripped.match(/^mise\s+run\s+run(?::([A-Za-z0-9_-]+))?(?:\s|$)/)
  if (miseRunMatch) {
    return miseRunMatch[1]
      ? { kind: "target", target: miseRunMatch[1] }
      : { kind: "run-aggregate" }
  }

  if (/^(?:mise\s+run\s+dev|mise\s+dev)(?:\s|$)/.test(stripped)) {
    return { kind: "dev-aggregate" }
  }

  if (/^(?:(?:bun|npm|yarn)\s+run\s+dev|pnpm\s+(?:run\s+)?dev|astro\s+dev|vite)(?:\s|$)/.test(stripped)) {
    return cwd === projectRoot
      ? { kind: "dev-aggregate" }
      : { kind: "target", target: basename(cwd) }
  }

  if (/\bha\s+bridge\s+serve(?:\s|$)/.test(stripped)) {
    return { kind: "target", target: "ha-bridge" }
  }

  if (/\bsystem-bridge(?:-linux)?\s+backend(?:\s|$)/.test(stripped)) {
    return { kind: "target", target: "backend" }
  }

  return null
}

function startTasks(project: PitchforkProject): string[] {
  return [...project.tasks]
    .filter((task) => task.startsWith("serve:") && !MANAGEMENT_SERVE_TASKS.has(task))
    .sort()
}

function targetAliases(target: string): string[] {
  const aliases = [target]

  if (target.endsWith("-dev")) aliases.push(target.replace(/-dev$/, ""))
  if (target.endsWith("-client")) aliases.push(target.replace(/-client$/, ""))
  if (target.includes("web")) aliases.push("web", "frontend", "client")
  if (target.includes("front")) aliases.push("frontend", "web")
  if (target.includes("back")) aliases.push("backend", "api")
  if (target.includes("bridge") || target.includes("home-assistant")) aliases.push("ha-bridge", "bridge")

  return [...new Set(aliases)]
}

function commandForTarget(project: PitchforkProject, target: string): string | null {
  for (const alias of targetAliases(target)) {
    const task = `serve:${alias}`
    if (project.tasks.has(task)) return `mise run ${task}`
    if (project.daemons.has(alias)) return `pitchfork start ${alias}`
  }
  return null
}

function commandForCandidate(project: PitchforkProject, candidate: CommandCandidate): string | null {
  if (candidate.kind === "target") return commandForTarget(project, candidate.target)

  if (project.tasks.has("serve:all")) return "mise run serve:all"
  if (candidate.kind === "run-aggregate") return null

  const tasks = startTasks(project)
  if (tasks.length === 1) return `mise run ${tasks[0]}`
  if (project.daemons.size > 0) return "pitchfork start -l"
  return null
}

function pitchforkHint(project: PitchforkProject): string {
  const tasks = startTasks(project)
  if (tasks.length) return tasks.map((task) => `mise run ${task}`).join(", ")
  if (project.daemons.size) return "pitchfork start -l"
  return "add a serve:* task or run pitchfork from the project root"
}

export const PitchforkDevServerGuard = (async ({ directory }) => {
  const baseDirectory = directory || process.cwd()

  return {
    "tool.execute.before": async (input, output) => {
      if (input.tool !== "bash") return

      const args = recordFromUnknown(output.args)
      const command = stringArg(args.command)
      if (!command) return

      const initialCwd = resolveToolWorkdir(args.workdir, baseDirectory)
      const normalized = withoutLeadingCd(command.trim(), initialCwd)
      const project = await findPitchforkProject(normalized.cwd)
      if (!project) return

      const candidate = candidateFromCommand(normalized.command, normalized.cwd, project.root)
      if (!candidate) return

      const replacement = commandForCandidate(project, candidate)
      if (!replacement && candidate.kind === "target") return
      if (!replacement && candidate.kind === "run-aggregate") return

      if (!replacement) {
        throw new Error(
          `This project uses pitchfork for background dev servers. Use ${pitchforkHint(project)} instead of running a foreground server.`,
        )
      }

      args.command = replacement
      args.workdir = project.root
      output.args = args
    },
  }
}) satisfies Plugin

export default PitchforkDevServerGuard
