/**
 * @file Injects repo-note context blocks into /note-create and /note-append commands.
 *
 * Hooks into `command.execute.before` to resolve the current repository's
 * owner/repo from the git remote, build the notes directory path, and (for
 * note-append) list existing note files ranked by modification time.
 *
 * Notes are stored at:
 *   $NOTES/repo-notes/{owner}/{repo}/{topic-slug}.md
 *
 * Falls back to ~/Documents/notes when $NOTES is not set.
 */

const NOTE_COMMANDS = new Set(["note-create", "note-append"])

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
    // test -d exits 0 if the directory exists, non-zero otherwise
    const dirCheckResult = await run(() => $`test -d ${notesPath}`.text())
    const notesExist = dirCheckResult.ok

    // --- For note-append: list existing notes sorted by modification time ---
    let existingNotes = []
    if (command === "note-append" && notesExist) {
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

        // Read frontmatter (name + description) from each file for readable labels
        existingNotes = await Promise.all(
          sorted.map(async ({ filename, mtime }) => {
            const filePath = `${notesPath}/${filename}`
            const date = new Date(mtime * 1000).toISOString().slice(0, 10)
            const headResult = await run(() => $`head -20 ${filePath}`.text())
            let name = null
            let description = null
            if (headResult.ok && headResult.text) {
              const nameMatch = headResult.text.match(/^name:\s*(.+)$/m)
              const descMatch = headResult.text.match(/^description:\s*(.+)$/m)
              if (nameMatch) name = nameMatch[1].trim()
              if (descMatch) description = descMatch[1].trim()
            }
            const label = name
              ? description
                ? `${filename} — ${name}: ${description} (last modified: ${date})`
                : `${filename} — ${name} (last modified: ${date})`
              : `${filename} (last modified: ${date})`
            return label
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

    if (command === "note-append") {
      const notesLines =
        existingNotes.length > 0
          ? existingNotes
          : notesExist
            ? ["(no .md files found in notes directory)"]
            : ["(notes directory does not exist yet)"]

      parts.push(
        formatTag(
          "existing-notes",
          "Existing note files for this repository, sorted newest-first by modification time. These are candidates for /note-append.",
          notesLines,
        ),
      )
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
  }
}
