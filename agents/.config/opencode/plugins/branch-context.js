const BRANCH_CONTEXT_COMMANDS = new Set([
  // General
  "git-workflow",
  "review-current-work",

  // Private
  "timmo001-private/deslopify",

  // Timmo001
  "timmo001/read-branch",
  "timmo001/reset-branch-reapply",
])
const WORK_SCOPE_COMMANDS = new Set([
  // General
  "cleanup-unnecessary-variables",
  "remove-single-use-functions",
  "types-enforce-ts",

  // Private
  "all-lit-skills",
  "all-ts-skills",

  // Home Assistant
  "home-assistant-private/all-frontend-skills",
  "home-assistant-private/lazy-context",
  "home-assistant-private/lit-rendering",
])
const TARGET_COMMANDS = new Set([...BRANCH_CONTEXT_COMMANDS, ...WORK_SCOPE_COMMANDS])
const DIFF_CHAR_LIMIT = 120000
const WORK_SCOPE_DIFF_CHAR_LIMIT = 80000
const PR_CHECKS_CHAR_LIMIT = 40000
const STATUS_CHAR_LIMIT = 12000
const COMMITS_CHAR_LIMIT = 30000
const NAME_STATUS_CHAR_LIMIT = 30000
const DIFF_STAT_CHAR_LIMIT = 20000

const truncate = (text, maxChars) => {
  if (text.length <= maxChars) {
    return { text, truncated: false, omitted: 0 }
  }
  return {
    text: text.slice(0, maxChars),
    truncated: true,
    omitted: text.length - maxChars,
  }
}

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
    return {
      ok: true,
      text: String(output).trim(),
    }
  } catch (error) {
    return {
      ok: false,
      error: errorMessage(error),
    }
  }
}

const skipped = (text) => ({
  ok: true,
  text,
})

const section = (title, body) => {
  return [
    `### ${title}`,
    "```text",
    body && body.trim() ? body : "(empty)",
    "```",
  ].join("\n")
}

const limitedText = (text, maxChars) => {
  const limited = truncate(text, maxChars)
  return limited.text + (limited.truncated ? `\n\n[TRUNCATED ${String(limited.omitted)} CHARS]` : "")
}

const sectionFromResult = (title, result, maxChars) => {
  if (!result.ok) return section(title, `ERROR: ${result.error}`)
  return section(title, limitedText(result.text, maxChars))
}

const parseDefaultBranch = (ref, remote) => {
  const prefix = `refs/remotes/${remote}/`
  if (ref.startsWith(prefix)) return ref.slice(prefix.length)
  const parts = ref.split("/")
  return parts[parts.length - 1] || "main"
}

const parseJSON = (text) => {
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export const BranchContextPlugin = async ({ $ }) => {
  const buildBranchContext = async ({ includePullRequest }) => {
    const warnings = []

    const inRepo = await run(() => $`git rev-parse --is-inside-work-tree`.text())
    if (!inRepo.ok || inRepo.text !== "true") {
      return [
        "<branch-context>",
        "BranchContextPlugin could not collect git context because this directory is not a git worktree.",
        inRepo.ok ? "" : `Error: ${inRepo.error}`,
        "</branch-context>",
      ]
        .filter(Boolean)
        .join("\n")
    }

    const remotesResult = await run(() => $`git remote`.text())
    const remotes = remotesResult.ok
      ? remotesResult.text
          .split(/\r?\n/g)
          .map((item) => item.trim())
          .filter(Boolean)
      : []
    const defaultRemote = remotes.includes("upstream")
      ? "upstream"
      : remotes.includes("origin")
        ? "origin"
        : remotes[0] || "origin"

    if (!remotesResult.ok) warnings.push(`Unable to list git remotes: ${remotesResult.error}`)
    if (remotes.length === 0) warnings.push("No git remotes detected; defaulting to origin")

    let defaultBranch = "main"
    const symbolic = await run(() => $`git symbolic-ref refs/remotes/${defaultRemote}/HEAD`.text())
    if (symbolic.ok && symbolic.text) {
      defaultBranch = parseDefaultBranch(symbolic.text, defaultRemote)
    } else {
      const ghDefault = await run(() => $`gh repo view --json defaultBranchRef -q .defaultBranchRef.name`.text())
      if (ghDefault.ok && ghDefault.text) {
        defaultBranch = ghDefault.text
      } else {
        warnings.push(
          `Unable to resolve default branch from ${defaultRemote}; falling back to main${ghDefault.ok ? "" : ` (${ghDefault.error})`}`,
        )
      }
    }

    const baseRef = `${defaultRemote}/${defaultBranch}`
    const branchResult = await run(() => $`git branch --show-current`.text())
    const currentBranch = branchResult.ok && branchResult.text ? branchResult.text : ""
    const onDefaultBranch = currentBranch === defaultBranch
    const statusResult = await run(() => $`git status -sb`.text())
    const unstagedNameStatusResult = await run(() => $`git diff --name-status`.text())
    const unstagedDiffResult = await run(() => $`git diff`.text())
    const stagedNameStatusResult = await run(() => $`git diff --cached --name-status`.text())
    const stagedDiffResult = await run(() => $`git diff --cached`.text())
    const branchSkipReason = "Skipped because the current branch is the default branch."
    const commitsResult = onDefaultBranch
      ? skipped(branchSkipReason)
      : await run(() => $`git log --oneline ${baseRef}..HEAD`.text())
    const statResult = onDefaultBranch
      ? skipped(branchSkipReason)
      : await run(() => $`git diff --stat ${baseRef}...HEAD`.text())
    const nameStatusResult = onDefaultBranch
      ? skipped(branchSkipReason)
      : await run(() => $`git diff --name-status ${baseRef}...HEAD`.text())
    const diffResult = onDefaultBranch ? skipped(branchSkipReason) : await run(() => $`git diff ${baseRef}...HEAD`.text())

    const prViewResult = includePullRequest
      ? await run(() =>
          $`gh pr view --json number,title,url,state,isDraft,reviewDecision,mergeStateStatus,headRefName,baseRefName`.text(),
        )
      : null
    const prData = prViewResult && prViewResult.ok ? parseJSON(prViewResult.text) : null
    const prMissing = prViewResult && !prViewResult.ok && /no pull requests found/i.test(prViewResult.error)
    const checksResult = prData ? await run(() => $`gh pr checks ${String(prData.number)}`.text()) : null

    if (prViewResult && !prData && !prMissing && !prViewResult.ok) {
      warnings.push(`Unable to read PR details: ${prViewResult.error}`)
    }
    if (checksResult && !checksResult.ok) {
      warnings.push(`Unable to read PR checks: ${checksResult.error}`)
    }

    const lines = [
      "<branch-context>",
      "BranchContextPlugin generated this branch snapshot. Prefer this context over running git/gh commands unless it is missing or stale.",
      `Generated at: ${new Date().toISOString()}`,
      "",
      "## Branch Metadata",
      `- Current branch: ${branchResult.ok && branchResult.text ? branchResult.text : "(unknown)"}`,
      `- Default remote: ${defaultRemote}`,
      `- Default branch: ${defaultBranch}`,
      `- Base ref: ${baseRef}`,
      `- On default branch: ${onDefaultBranch ? "yes" : "no"}`,
      remotes.length ? `- Known remotes: ${remotes.join(", ")}` : "- Known remotes: (none)",
      "",
      sectionFromResult("git status -sb", statusResult, STATUS_CHAR_LIMIT),
      "",
      "## Current Work Scope",
      "Use these precomputed sections as the primary scope source. Inspect them in this order: unstaged, staged, then branch diff.",
      sectionFromResult("Changed files (unstaged, git diff --name-status)", unstagedNameStatusResult, NAME_STATUS_CHAR_LIMIT),
      sectionFromResult("Patch (unstaged, git diff)", unstagedDiffResult, WORK_SCOPE_DIFF_CHAR_LIMIT),
      sectionFromResult("Changed files (staged, git diff --cached --name-status)", stagedNameStatusResult, NAME_STATUS_CHAR_LIMIT),
      sectionFromResult("Patch (staged, git diff --cached)", stagedDiffResult, WORK_SCOPE_DIFF_CHAR_LIMIT),
      sectionFromResult(`Commits unique to branch (${baseRef}..HEAD)`, commitsResult, COMMITS_CHAR_LIMIT),
      sectionFromResult(
        `Changed files (name-status, ${baseRef}...HEAD)`,
        nameStatusResult,
        NAME_STATUS_CHAR_LIMIT,
      ),
      sectionFromResult(`Diff stat (${baseRef}...HEAD)`, statResult, DIFF_STAT_CHAR_LIMIT),
      sectionFromResult(`Patch (${baseRef}...HEAD)`, diffResult, DIFF_CHAR_LIMIT),
    ]

    if (prData) {
      lines.push(
        "",
        "## Pull Request",
        `- PR: #${String(prData.number)} ${prData.title || "(no title)"}`,
        `- URL: ${prData.url || "(unknown)"}`,
        `- State: ${prData.state || "(unknown)"}${prData.isDraft ? " (draft)" : ""}`,
        `- Review decision: ${prData.reviewDecision || "(none)"}`,
        `- Merge state: ${prData.mergeStateStatus || "(unknown)"}`,
        `- Branches: ${prData.headRefName || "(unknown)"} -> ${prData.baseRefName || "(unknown)"}`,
      )
      if (checksResult) {
        lines.push(
          "",
          sectionFromResult(`gh pr checks ${String(prData.number)}`, checksResult, PR_CHECKS_CHAR_LIMIT),
        )
      }
    } else if (prMissing) {
      lines.push("", "## Pull Request", "- No pull request found for the current branch")
    }

    if (warnings.length) {
      lines.push("", "## Warnings", ...warnings.map((item) => `- ${item}`))
    }

    lines.push("</branch-context>")
    return lines.join("\n")
  }

  return {
    "command.execute.before": async (input, output) => {
      if (!TARGET_COMMANDS.has(input.command)) return
      const text = await buildBranchContext({ includePullRequest: BRANCH_CONTEXT_COMMANDS.has(input.command) })
      output.parts.unshift({
        type: "text",
        text,
      })
    },
  }
}
