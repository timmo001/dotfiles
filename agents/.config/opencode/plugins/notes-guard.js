/**
 * @file Blocks direct LLM file tool access to the notes vault.
 *
 * The notes vault ($NOTES/repo-notes/) is exclusively managed by the
 * note_read and note_write plugin tools registered in repo-notes.js.
 *
 * This plugin prevents the LLM from bypassing that contract by using
 * the built-in read, write, edit, or bash tools on vault paths.
 *
 * Pattern mirrors the .env protection example from the OpenCode plugin docs.
 */

const NOTES_SUBDIR = "repo-notes"

/** Resolve the notes vault root path at plugin init time. */
const resolveNotesVaultPath = async ($) => {
  let notesRoot = null
  try {
    const env = String(await $`printenv NOTES`.text()).trim()
    if (env) notesRoot = env
  } catch {}
  if (!notesRoot) {
    try {
      const home = String(await $`printenv HOME`.text()).trim()
      if (home) notesRoot = `${home}/Documents/notes`
    } catch {}
  }
  if (!notesRoot) notesRoot = `${process.env.HOME ?? "~"}/Documents/notes`
  return `${notesRoot}/${NOTES_SUBDIR}`
}

export const NotesGuardPlugin = async ({ $ }) => {
  const vaultPath = await resolveNotesVaultPath($)

  const isInsideVault = (filePath) => {
    if (!filePath || typeof filePath !== "string") return false
    // Normalise leading ~ to home so comparisons are consistent
    const home = process.env.HOME ?? ""
    const abs = filePath.startsWith("~/") ? `${home}/${filePath.slice(2)}` : filePath
    return abs.startsWith(vaultPath)
  }

  const BLOCKED_FILE_TOOLS = new Set(["read", "write", "edit"])

  const guardMessage = (tool) =>
    `Direct '${tool}' access to the notes vault is blocked.\n` +
    `The vault at ${vaultPath} is exclusively managed by the note_read and note_write tools.\n` +
    `Use note_read to read a note file, or note_write to create or update one.`

  return {
    "tool.execute.before": async (input, output) => {
      const tool = input.tool

      // Block read / write / edit tools on vault paths
      if (BLOCKED_FILE_TOOLS.has(tool)) {
        const filePath = output.args?.filePath ?? output.args?.path ?? ""
        if (isInsideVault(filePath)) {
          throw new Error(guardMessage(tool))
        }
      }

      // Block bash commands that reference the vault path
      if (tool === "bash") {
        const cmd = output.args?.command ?? ""
        if (cmd.includes(vaultPath)) {
          throw new Error(guardMessage("bash"))
        }
        // Also catch ~ form in case the command uses unexpanded paths
        const home = process.env.HOME ?? ""
        if (home && vaultPath.startsWith(home)) {
          const tildeVault = `~/${vaultPath.slice(home.length + 1)}`
          if (cmd.includes(tildeVault)) {
            throw new Error(guardMessage("bash"))
          }
        }
      }
    },
  }
}
