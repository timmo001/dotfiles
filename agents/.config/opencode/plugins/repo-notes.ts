/**
 * @file Injects repo-note context into OpenCode note commands.
 *
 * Runs `dot notes context` before note-create, note-append, notes-list,
 * notes-search, note-reference, handoff, and handoffs-list so each command sees
 * the resolved owner, repo, and notes path. Reading, writing, and deleting note
 * files is handled by the `dot mcp` server's note tools, not this plugin.
 */

import type { Plugin } from "@opencode-ai/plugin"

const NOTE_COMMANDS = new Set([
  "note-create",
  "note-append",
  "notes-list",
  "notes-search",
  "note-reference",
  "handoff",
  "handoffs-list",
])

async function runDot(args: readonly string[]): Promise<string> {
  const proc = Bun.spawn(["dot", ...args], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
    env: process.env,
  })

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ])

  if (exitCode !== 0) {
    throw new Error(
      stderr.trim() || stdout.trim() || `dot ${args.join(" ")} failed`,
    )
  }

  return stdout.trimEnd()
}

export const RepoNotesPlugin = (async () => {
  return {
    "command.execute.before": async (input, output) => {
      if (!NOTE_COMMANDS.has(input.command)) return
      const text = await runDot(["notes", "context", "--command", input.command])
      output.parts.unshift({ type: "text", text })
    },
  }
}) satisfies Plugin

export default RepoNotesPlugin
