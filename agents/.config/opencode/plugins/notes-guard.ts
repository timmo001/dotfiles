import { isAbsolute, relative, resolve } from "node:path"
import type { Plugin } from "@opencode-ai/plugin"

function expandHome(filePath: string): string {
  const home = process.env.HOME ?? ""
  return home && filePath.startsWith("~/") ? `${home}/${filePath.slice(2)}` : filePath
}

function isInsideDirectory(parent: string, child: string): boolean {
  const relativePath = relative(resolve(parent), resolve(child))
  return relativePath === "" || (!relativePath.startsWith("..") && !isAbsolute(relativePath))
}

function argRecord(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null ? (value as Record<string, unknown>) : {}
}

function stringArg(value: unknown): string {
  return typeof value === "string" ? value : ""
}

async function dotRepoNotesRoot(): Promise<string | null> {
  try {
    const proc = Bun.spawn(["dot", "notes", "root", "--repo-notes"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    })
    const [stdout, exitCode] = await Promise.all([new Response(proc.stdout).text(), proc.exited])
    if (exitCode === 0 && stdout.trim()) return stdout.trim()
  } catch {}
  return null
}

async function fallbackRepoNotesRoot(): Promise<string> {
  const notesRoot = process.env.NOTES || process.env.DOT_NOTES_DIR || `${process.env.HOME ?? "~"}/Documents/notes`
  return `${notesRoot}/repo-notes`
}

async function resolveNotesVaultPath(): Promise<string> {
  return (await dotRepoNotesRoot()) ?? (await fallbackRepoNotesRoot())
}

export const NotesGuardPlugin = (async () => {
  const vaultPath = await resolveNotesVaultPath()
  const expandedVaultPath = expandHome(vaultPath)

  const isInsideVault = (filePath: string) => {
    if (!filePath) return false
    return isInsideDirectory(expandedVaultPath, expandHome(filePath))
  }

  const guardMessage = (tool: string) =>
    `Direct '${tool}' access to the notes vault is blocked.\n` +
    `The vault at ${expandedVaultPath} is exclusively managed by the note_read, note_write, and note_delete tools.\n` +
    "Use note_read to read a note, note_write to create or update one, or note_delete to remove one."

  return {
    "tool.execute.before": async (input, output) => {
      const tool = input.tool
      const args = argRecord(output.args)

      if (tool === "read" || tool === "write" || tool === "edit") {
        const filePath = stringArg(args.filePath) || stringArg(args.path)
        if (isInsideVault(filePath)) throw new Error(guardMessage(tool))
      }

      if (tool === "bash") {
        const cmd = stringArg(args.command)
        if (cmd.includes(expandedVaultPath) || cmd.includes(vaultPath)) {
          throw new Error(guardMessage("bash"))
        }

        const home = process.env.HOME ?? ""
        if (home && expandedVaultPath.startsWith(home)) {
          const tildeVault = `~/${expandedVaultPath.slice(home.length + 1)}`
          if (cmd.includes(tildeVault)) throw new Error(guardMessage("bash"))
        }
      }
    },
  }
}) satisfies Plugin

export default NotesGuardPlugin
