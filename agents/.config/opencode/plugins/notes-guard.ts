/**
 * @file Blocks direct file access to the repository notes vault.
 *
 * Notes are read, written, and deleted through the Notes CLI, which
 * keeps vault changes auditable and prevents bypassing notes-specific guards.
 */

import type { Plugin } from "@opencode-ai/plugin"
import {
  argRecord,
  expandHome,
  stringArg,
  targetIsInsideDirectory,
} from "../lib/guard-paths"

const PATH_ARG_TOOLS = new Set([
  "read",
  "write",
  "edit",
  "grep",
  "glob",
  "list",
])

async function dotRepoNotesRoot(): Promise<string | null> {
  try {
    const proc = Bun.spawn(["notes", "root", "--repo-notes"], {
      stdin: "ignore",
      stdout: "pipe",
      stderr: "pipe",
      env: process.env,
    })
    const [stdout, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ])
    if (exitCode === 0 && stdout.trim()) return stdout.trim()
  } catch {}
  return null
}

async function fallbackRepoNotesRoot(): Promise<string> {
  const notesRoot =
    process.env.NOTES ||
    process.env.DOT_NOTES_DIR ||
    `${process.env.HOME ?? "~"}/Documents/notes`
  return `${notesRoot}/repo-notes`
}

async function resolveNotesVaultPath(): Promise<string> {
  return (await dotRepoNotesRoot()) ?? (await fallbackRepoNotesRoot())
}

export const NotesGuardPlugin = (async () => {
  const vaultPath = await resolveNotesVaultPath()
  const expandedVaultPath = expandHome(vaultPath)

  const isInsideVault = (filePath: string) => {
    return targetIsInsideDirectory(expandedVaultPath, filePath)
  }

  const toolTargetsVault = (tool: string, args: Record<string, unknown>) => {
    if (!PATH_ARG_TOOLS.has(tool)) return false

    return [args.filePath, args.path, args.pattern].some((value) =>
      isInsideVault(stringArg(value)),
    )
  }

  const guardMessage = (tool: string) =>
    `Direct '${tool}' access to the notes vault is blocked.\n` +
    `Use the Notes CLI to access the vault at ${expandedVaultPath}.\n` +
    "Use notes read, notes write, or notes delete."

  return {
    "tool.execute.before": async (input, output) => {
      const tool = input.tool
      const args = argRecord(output.args)

      if (toolTargetsVault(tool, args)) throw new Error(guardMessage(tool))
    },
  }
}) satisfies Plugin

export default NotesGuardPlugin
