/**
 * @file Restricts file tools to the repository notes directory for note commands.
 *
 * Blocks read/write/edit/grep/glob/list tool calls that target paths outside the
 * notes vault while a note command is running, so agents cannot reach other files.
 */

import type { Plugin } from "@opencode-ai/plugin"
import {
  argRecord,
  commandMentionsPath,
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
    const proc = Bun.spawn(["dot", "notes", "root", "--repo-notes"], {
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
    `The vault at ${expandedVaultPath} is exclusively managed by the note_read, note_write, and note_delete tools.\n` +
    "Use note_read to read a note, note_write to create or update one, or note_delete to remove one."

  return {
    "tool.execute.before": async (input, output) => {
      const tool = input.tool
      const args = argRecord(output.args)

      if (toolTargetsVault(tool, args)) throw new Error(guardMessage(tool))

      if (tool === "bash") {
        const cmd = stringArg(args.command)
        if (
          commandMentionsPath(cmd, expandedVaultPath) ||
          commandMentionsPath(cmd, vaultPath)
        )
          throw new Error(guardMessage("bash"))
      }
    },
  }
}) satisfies Plugin

export default NotesGuardPlugin
