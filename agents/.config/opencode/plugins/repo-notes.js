/**
 * @file Injects repo-note context blocks into note commands.
 *
 * Hooks into `command.execute.before` to resolve the current repository's
 * owner/repo from the git remote, build the notes directory path, list
 * existing note files with frontmatter, and (for note-reference) pre-inject
 * full note content.
 *
 * Notes are stored at:
 *   $NOTES/repo-notes/{owner}/{repo}/{topic-slug}.md
 *
 * Falls back to ~/Documents/notes when $NOTES is not set.
 */

const NOTE_COMMANDS = new Set([
  "note-create",
  "note-append",
  "notes-list",
  "notes-search",
  "note-reference",
  "handoff",
  "handoffs-list",
])

/** Commands that need the existing-notes list injected. */
const COMMANDS_NEEDING_LIST = new Set([
  "note-append",
  "notes-list",
  "notes-search",
  "note-reference",
  "handoffs-list",
])

const NOTES_SUBDIR = "repo-notes"

const errorMessage = (error) => {
  if (!error) return "Unknown error"
  if (typeof error === "string") return error
  if (error.stderr) {
    const stderr = String(error.stderr).trim()
    if (stderr) return stderr
  }
  if (error.message) return error.message
  return String(error)
}

const run = async (execute) => {
  try {
    const output = await execute()
    return { ok: true, text: String(output).trim() }
  } catch (error) {
    return { ok: false, error: errorMessage(error) }
  }
}

/**
 * Parse an owner/repo pair from a git remote URL.
 * Handles:
 *   git@github.com:owner/repo.git
 *   https://github.com/owner/repo.git
 *   https://github.com/owner/repo
 *   ssh://git@github.com/owner/repo.git
 */
const parseRemoteUrl = (url) => {
  if (!url) return null

  // SSH short form: git@host:owner/repo.git
  const sshMatch = url.match(/^[^@]+@[^:]+:([^/]+)\/(.+?)(?:\.git)?$/)
  if (sshMatch) return { owner: sshMatch[1], repo: sshMatch[2] }

  // HTTPS / SSH long form: https://host/owner/repo.git
  const httpsMatch = url.match(/^(?:https?|ssh):\/\/[^/]+\/([^/]+)\/(.+?)(?:\.git)?$/)
  if (httpsMatch) return { owner: httpsMatch[1], repo: httpsMatch[2] }

  return null
}

/**
 * Read frontmatter fields (name, description, tags) from a note file.
 * Only reads the first 20 lines to keep I/O light.
 */
const readNoteFrontmatter = async ($, filePath) => {
  const headResult = await run(() => $`head -20 ${filePath}`.text())
  let name = null
  let description = null
  let tags = []
  if (headResult.ok && headResult.text) {
    const nameMatch = headResult.text.match(/^name:\s*(.+)$/m)
    const descMatch = headResult.text.match(/^description:\s*(.+)$/m)
    const tagsMatch = headResult.text.match(/^tags:\s*\[(.+)\]$/m)
    if (nameMatch) name = nameMatch[1].trim()
    if (descMatch) description = descMatch[1].trim()
    if (tagsMatch) {
      tags = tagsMatch[1]
        .split(",")
        .map((t) => t.trim().replace(/^['"]|['"]$/g, ""))
        .filter(Boolean)
    }
  }
  return { name, description, tags }
}

/**
 * Build a human-readable label for a note entry.
 * Format: filename — Name: Description [tags: a, b, c] (last modified: date)
 */
const buildNoteLabel = (filename, mtime, { name, description, tags }) => {
  const date = new Date(mtime * 1000).toISOString().slice(0, 10)
  const tagPart = tags.length ? ` [tags: ${tags.join(", ")}]` : ""
  if (name && description) return `${filename} — ${name}: ${description}${tagPart} (last modified: ${date})`
  if (name) return `${filename} — ${name}${tagPart} (last modified: ${date})`
  return `${filename}${tagPart} (last modified: ${date})`
}

const formatTag = (name, description, lines) => {
  const body = [`Description: ${description}`, ...lines.filter(Boolean)].join("\n").trim()
  return [`<${name}>`, body || "(empty)", `</${name}>`].join("\n")
}

const formatErrorContext = (message, error) => {
  return [
    "<repo-note-context>",
    formatTag(
      "metadata",
      "Information about how this repo-note context was generated.",
      [`Generated at: ${new Date().toISOString()}`],
    ),
    formatTag(
      "warnings",
      "Issues encountered while collecting repo context.",
      [message, error ? `Error: ${error}` : ""].filter(Boolean),
    ),
    "</repo-note-context>",
  ].join("\n\n")
}

export const RepoNotesPlugin = async ({ $ }) => {
  // Custom tools for note I/O.
  // Args use plain JSON Schema 7 objects — OpenCode falls back to legacyJsonSchema
  // when args are not Zod types, so no imports are required.
  // Direct read/write/edit/bash access to the notes vault is blocked by notes-guard.js;
  // these tools are the only permitted path for note file I/O.

  /**
   * Resolve the notes root directory (git repo root for the vault).
   * Falls back to ~/Documents/notes when $NOTES is not set.
   */
  const resolveNotesRoot = async () => {
    const notesEnv = await run(() => $`printenv NOTES`.text())
    if (notesEnv.ok && notesEnv.text) return notesEnv.text
    const homeEnv = await run(() => $`printenv HOME`.text())
    const home = homeEnv.ok && homeEnv.text ? homeEnv.text : "~"
    return `${home}/Documents/notes`
  }

  /**
   * Git-commit a file change in the notes vault.
   * Initialises the repo if it doesn't exist yet.
   * Non-fatal: logs warnings but does not fail the tool call.
   */
  const gitCommit = async (filePath, message) => {
    const notesRoot = await resolveNotesRoot()
    // Ensure the notes root is a git repo
    const isRepo = await run(() => $`git -C ${notesRoot} rev-parse --is-inside-work-tree`.text())
    if (!isRepo.ok) {
      const init = await run(() => $`git -C ${notesRoot} init`.text())
      if (!init.ok) return { ok: false, error: `git init failed: ${init.error}` }
    }
    const add = await run(() => $`git -C ${notesRoot} add ${filePath}`.text())
    if (!add.ok) return { ok: false, error: `git add failed: ${add.error}` }
    const commit = await run(() => $`git -C ${notesRoot} commit -m ${message} --no-verify`.text())
    if (!commit.ok) {
      // "nothing to commit" is not an error
      if (commit.error?.includes("nothing to commit")) return { ok: true, text: "nothing to commit" }
      return { ok: false, error: `git commit failed: ${commit.error}` }
    }
    return { ok: true, text: commit.text }
  }

  const note_read = {
    description:
      "Read the full content of a note file from the notes vault. " +
      "Use this to read an existing note before appending to it. " +
      "This is the ONLY permitted way to read note files — the built-in read tool is blocked for the notes vault.",
    args: {
      path: {
        type: "string",
        description: "Absolute path to the note file (e.g. /home/user/Documents/notes/repo-notes/owner/repo/slug.md)",
      },
    },
    async execute(args) {
      try {
        const content = await Bun.file(args.path).text()
        return content
      } catch (e) {
        throw new Error(`note_read: failed to read file ${args.path}: ${errorMessage(e)}`)
      }
    },
  }

  const note_write = {
    description:
      "Write a note file to the notes vault. " +
      "Used exclusively by note-create and note-append to persist generated note content to disk. " +
      "Creates parent directories automatically. " +
      "This is the ONLY permitted way to write note files — the built-in write, edit, and bash tools are blocked for the notes vault.",
    args: {
      path: {
        type: "string",
        description: "Absolute path to the note file (e.g. /home/user/Documents/notes/repo-notes/owner/repo/slug.md)",
      },
      content: {
        type: "string",
        description: "Full file content to write, including frontmatter and all sections",
      },
    },
    async execute(args) {
      const dir = args.path.substring(0, args.path.lastIndexOf("/"))
      const filename = args.path.split("/").pop()
      if (dir) {
        try {
          await $`mkdir -p ${dir}`.text()
        } catch (e) {
          throw new Error(`note_write: failed to create directory ${dir}: ${errorMessage(e)}`)
        }
      }
      try {
        await Bun.write(args.path, args.content)
      } catch (e) {
        throw new Error(`note_write: failed to write file ${args.path}: ${errorMessage(e)}`)
      }

      // Commit the write to git
      const commitResult = await gitCommit(args.path, `notes: write ${filename}`)

      const output = [
        `Written: ${args.path}`,
        "",
        "```markdown",
        args.content,
        "```",
      ]
      if (commitResult.ok) {
        output.push("", `Committed to git: \`notes: write ${filename}\``)
      }
      output.push(
        "",
        "## How to undo",
        "",
        "```sh",
        `# Revert to the previous version`,
        `cd ${dir} && git log --oneline -5 -- ${filename}`,
        `cd ${dir} && git checkout HEAD~1 -- ${filename}`,
        "```",
      )
      return { title: args.path, output: output.join("\n") }
    },
  }

  const note_delete = {
    description:
      "Delete a note file from the notes vault. " +
      "Use this to remove notes that are no longer needed (e.g. superseded handoffs, stale references). " +
      "IMPORTANT: Always confirm with the user before calling this tool — deletion is irreversible. " +
      "Show the filename and ask for explicit approval before proceeding. " +
      "This is the ONLY permitted way to delete note files — the built-in bash and edit tools are blocked for the notes vault.",
    args: {
      path: {
        type: "string",
        description: "Absolute path to the note file to delete (e.g. /home/user/Documents/notes/repo-notes/owner/repo/slug.md)",
      },
    },
    async execute(args) {
      const { unlink } = await import("node:fs/promises")
      const dir = args.path.substring(0, args.path.lastIndexOf("/"))
      const filename = args.path.split("/").pop()
      try {
        await unlink(args.path)
      } catch (e) {
        if (e.code === "ENOENT") {
          throw new Error(`note_delete: file does not exist: ${args.path}`)
        }
        throw new Error(`note_delete: failed to delete file ${args.path}: ${errorMessage(e)}`)
      }

      // Commit the deletion to git
      const commitResult = await gitCommit(args.path, `notes: delete ${filename}`)

      const output = [`Deleted: ${args.path}`]
      if (commitResult.ok) {
        output.push("", `Committed to git: \`notes: delete ${filename}\``)
      }
      output.push(
        "",
        "## How to undo",
        "",
        "```sh",
        "# Restore the deleted file",
        `cd ${dir} && git revert --no-commit HEAD && git checkout HEAD -- ${filename}`,
        "",
        "# Or restore directly from the commit before deletion",
        `cd ${dir} && git checkout HEAD~1 -- ${filename}`,
        "```",
      )
      return output.join("\n")
    },
  }

  const buildRepoNoteContext = async ({ command }) => {
    const warnings = []

    // --- Resolve notes root from $NOTES env var, fall back to ~/Documents/notes ---
    const notesEnvResult = await run(() => $`printenv NOTES`.text())
    const homeResult = await run(() => $`printenv HOME`.text())
    const home = homeResult.ok && homeResult.text ? homeResult.text : "~"
    const notesRoot =
      notesEnvResult.ok && notesEnvResult.text
        ? notesEnvResult.text
        : `${home}/Documents/notes`

    // --- Ensure we are in a git repo ---
    const inRepo = await run(() => $`git rev-parse --is-inside-work-tree`.text())
    if (!inRepo.ok || inRepo.text !== "true") {
      return formatErrorContext(
        "RepoNotesPlugin: not inside a git worktree — cannot resolve owner/repo.",
        inRepo.ok ? null : inRepo.error,
      )
    }

    // --- Resolve remote URL ---
    const remotesResult = await run(() => $`git remote`.text())
    const remotes = remotesResult.ok
      ? remotesResult.text.split(/\r?\n/g).map((r) => r.trim()).filter(Boolean)
      : []

    if (!remotesResult.ok) warnings.push(`Unable to list git remotes: ${remotesResult.error}`)
    if (remotes.length === 0) warnings.push("No git remotes detected; defaulting to origin")

    const preferredRemote = remotes.includes("upstream")
      ? "upstream"
      : remotes.includes("origin")
        ? "origin"
        : remotes[0] || "origin"

    const remoteUrlResult = await run(() => $`git remote get-url ${preferredRemote}`.text())
    if (!remoteUrlResult.ok) {
      return formatErrorContext(
        `RepoNotesPlugin: unable to read URL for remote "${preferredRemote}".`,
        remoteUrlResult.error,
      )
    }

    const parsed = parseRemoteUrl(remoteUrlResult.text)
    if (!parsed) {
      return formatErrorContext(
        `RepoNotesPlugin: could not parse owner/repo from remote URL: ${remoteUrlResult.text}`,
        null,
      )
    }

    const { owner, repo } = parsed

    // --- Resolve branch ---
    const branchResult = await run(() => $`git branch --show-current`.text())
    const branch = branchResult.ok && branchResult.text ? branchResult.text : "(unknown)"

    // --- Build notes path ---
    const notesPath = `${notesRoot}/${NOTES_SUBDIR}/${owner}/${repo}`

    // --- Check if notes directory exists ---
    const dirCheckResult = await run(() => $`test -d ${notesPath}`.text())
    const notesExist = dirCheckResult.ok

    // --- Build sorted note entries with frontmatter for list-aware commands ---
    let noteEntries = []
    if (COMMANDS_NEEDING_LIST.has(command) && notesExist) {
      const listResult = await run(() =>
        $`find ${notesPath} -maxdepth 1 -name "*.md" -printf "%T@ %f\n"`.text(),
      )
      if (listResult.ok && listResult.text) {
        const sorted = listResult.text
          .split(/\r?\n/g)
          .map((line) => {
            const spaceIdx = line.trim().indexOf(" ")
            if (spaceIdx === -1) return null
            const mtime = parseFloat(line.trim().slice(0, spaceIdx))
            const filename = line.trim().slice(spaceIdx + 1)
            return { filename, mtime }
          })
          .filter(Boolean)
          .filter((e) => e.filename)
          .sort((a, b) => b.mtime - a.mtime)

        noteEntries = await Promise.all(
          sorted.map(async ({ filename, mtime }) => {
            const filePath = `${notesPath}/${filename}`
            const frontmatter = await readNoteFrontmatter($, filePath)
            return { filename, filePath, mtime, ...frontmatter }
          }),
        )
      } else if (!listResult.ok) {
        warnings.push(`Unable to list existing notes: ${listResult.error}`)
      }
    }

    // --- Render context block ---
    const metadataLines = [
      "RepoNotesPlugin generated this context. Use it to locate and manage notes for this repository.",
      `Generated at: ${new Date().toISOString()}`,
    ]

    const repoLines = [
      `Owner: ${owner}`,
      `Repo: ${repo}`,
      `Remote: ${preferredRemote} (${remoteUrlResult.text})`,
      `Branch: ${branch}`,
      `Notes root: ${notesRoot}`,
      `Notes path: ${notesPath}`,
      `Notes directory exists: ${notesExist ? "yes" : "no"}`,
    ]

    const parts = [
      "<repo-note-context>",
      formatTag("metadata", "How this context was generated.", metadataLines),
      formatTag("repository", "Current repository identity and resolved notes path.", repoLines),
    ]

    if (COMMANDS_NEEDING_LIST.has(command)) {
      const notesLines =
        noteEntries.length > 0
          ? noteEntries.map((e) => buildNoteLabel(e.filename, e.mtime, e))
          : notesExist
            ? ["(no .md files found in notes directory)"]
            : ["(notes directory does not exist yet)"]

      parts.push(
        formatTag(
          "existing-notes",
          "Existing note files for this repository, sorted newest-first by modification time.",
          notesLines,
        ),
      )
    }

    // --- For note-reference: pre-inject full content of all notes ---
    if (command === "note-reference" && noteEntries.length > 0) {
      const contentParts = ["<note-contents>", "Description: Full content of all note files for this repository."]
      for (const entry of noteEntries) {
        const bodyResult = await run(() => $`cat ${entry.filePath}`.text())
        const body = bodyResult.ok ? bodyResult.text : `(error reading file: ${bodyResult.error})`
        contentParts.push(`<note file="${entry.filename}">`)
        contentParts.push(body)
        contentParts.push(`</note>`)
      }
      contentParts.push("</note-contents>")
      parts.push(contentParts.join("\n"))
    }

    if (warnings.length) {
      parts.push(
        formatTag(
          "warnings",
          "Non-fatal issues encountered while collecting repo note context.",
          warnings,
        ),
      )
    }

    parts.push("</repo-note-context>")
    return parts.join("\n\n")
  }

  return {
    "command.execute.before": async (input, output) => {
      if (!NOTE_COMMANDS.has(input.command)) return
      const text = await buildRepoNoteContext({ command: input.command })
      output.parts.unshift({ type: "text", text })
    },
    tool: {
      note_read,
      note_write,
      note_delete,
    },
  }
}
