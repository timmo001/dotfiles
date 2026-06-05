import { isAbsolute, relative, resolve } from "node:path"

const GLOB_META_CHARS = new Set(["*", "?", "[", "{"])

export function argRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : {}
}

export function stringArg(value: unknown): string {
  return typeof value === "string" ? value : ""
}

export function expandHome(filePath: string): string {
  const home = process.env.HOME ?? ""
  return home && filePath.startsWith("~/")
    ? `${home}/${filePath.slice(2)}`
    : filePath
}

function isInsideDirectory(parent: string, child: string): boolean {
  const relativePath = relative(resolve(parent), resolve(child))
  return (
    relativePath === "" ||
    (!relativePath.startsWith("..") && !isAbsolute(relativePath))
  )
}

function trimShellSyntax(value: string): string {
  return value.trim().replace(/^[`'";,()[\]{}]+|[`'";,()[\]{}]+$/g, "")
}

function isProtectedEnvSegment(segment: string): boolean {
  const trimmed = trimShellSyntax(segment)
  if (trimmed === ".env.example") return false
  if (trimmed === ".env") return true
  if (trimmed.startsWith(".env.")) return true
  return trimmed.startsWith(".env") && GLOB_META_CHARS.has(trimmed[4] ?? "")
}

export function targetsProtectedEnv(value: string): boolean {
  if (!value) return false
  return value
    .split(/[\s\\/]+/)
    .flatMap((part) => part.split("="))
    .some(isProtectedEnvSegment)
}

export function targetIsInsideDirectory(
  parent: string,
  target: string,
): boolean {
  if (!target) return false
  return isInsideDirectory(
    expandHome(parent),
    expandHome(trimShellSyntax(target)),
  )
}

export function commandMentionsPath(command: string, path: string): boolean {
  if (!command || !path) return false

  const expandedPath = expandHome(path)
  if (command.includes(expandedPath) || command.includes(path)) return true

  const home = process.env.HOME ?? ""
  if (!home || !expandedPath.startsWith(home)) return false

  return command.includes(`~/${expandedPath.slice(home.length + 1)}`)
}
