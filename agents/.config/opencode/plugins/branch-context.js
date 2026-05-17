/**
 * @file Injects branch-context blocks into command prompts before execution.
 *
 * Hooks into `command.execute.before` to collect git/gh state (branch, status,
 * diff, PR info) and inject a `<branch-context>` XML block into the command
 * prompt. Supports two tiers: full branch-context commands and work-scope-only
 * commands that receive a narrower diff.
 */

const BRANCH_CONTEXT_COMMANDS = new Set([
  // General
  "inject-context",
  "refactor-current-work",
  "reset-branch-reapply",
  "review-current-work",

  // Private
  "timmo001-private/deslopify",
])
const WORK_SCOPE_COMMANDS = new Set([
  // General
  "refactor-cleanup-variables",
  "refactor-remove-single-use",
  "refactor-enforce-types",

  // Private
  "all-lit-skills",
  "all-ts-skills",

  // Home Assistant
  "home-assistant-private/all-frontend-skills",
  "home-assistant-private/lazy-context",
  "home-assistant-private/lit-rendering",
])
const TARGET_COMMANDS = new Set([...BRANCH_CONTEXT_COMMANDS, ...WORK_SCOPE_COMMANDS])
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

const limitedText = (text, maxChars) => {
  const limited = truncate(text, maxChars)
  return limited.text + (limited.truncated ? `\n\n[TRUNCATED ${String(limited.omitted)} CHARS]` : "")
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

const formatTag = (name, description, lines) => {
  const body = [
    `Description: ${description}`,
    ...lines.filter(Boolean),
  ]
    .join("\n")
    .trim()

  return [`<${name}>`, body || "(empty)", `</${name}>`].join("\n")
}

const formatErrorContext = (message, error) => {
  return [
    "<branch-context>",
    formatTag(
      "context-metadata",
      "Information about how this branch context snapshot was generated.",
      [`Generated at: ${new Date().toISOString()}`],
    ),
    formatTag(
      "warnings",
      "Non-fatal collection issues, fallbacks, missing data, or truncation notices that may affect interpretation.",
      [message, error ? `Error: ${error}` : ""],
    ),
    "</branch-context>",
  ]
    .filter(Boolean)
    .join("\n\n")
}

const formatList = (title, value) => {
  const text = value && value.trim() ? value.trim() : "(empty)"
  return `${title}:\n${text}`
}

const collectBranchMetadata = ({
  branchResult,
  defaultRemote,
  defaultBranch,
  baseRef,
  onDefaultBranch,
  remotes,
}) => {
  return [
    `Current branch: ${branchResult.ok && branchResult.text ? branchResult.text : "(unknown)"}`,
    `Default remote: ${defaultRemote}`,
    `Default branch: ${defaultBranch}`,
    `Base ref: ${baseRef}`,
    `On default branch: ${onDefaultBranch ? "yes" : "no"}`,
    `Known remotes: ${remotes.length ? remotes.join(", ") : "(none)"}`,
  ]
}

const collectStatus = (statusResult) => {
  if (!statusResult.ok) return [`ERROR: ${statusResult.error}`]
  return [statusResult.text || "(empty)"]
}

const collectWorkScope = ({
  unstagedNameStatusResult,
  stagedNameStatusResult,
  commitsResult,
  nameStatusResult,
  statResult,
}) => {
  return [
    formatList(
      "Unstaged changed files",
      unstagedNameStatusResult.ok ? limitedText(unstagedNameStatusResult.text, NAME_STATUS_CHAR_LIMIT) : `ERROR: ${unstagedNameStatusResult.error}`,
    ),
    "",
    formatList(
      "Staged changed files",
      stagedNameStatusResult.ok ? limitedText(stagedNameStatusResult.text, NAME_STATUS_CHAR_LIMIT) : `ERROR: ${stagedNameStatusResult.error}`,
    ),
    "",
    formatList(
      "Branch-only commits",
      commitsResult.ok ? limitedText(commitsResult.text, COMMITS_CHAR_LIMIT) : `ERROR: ${commitsResult.error}`,
    ),
    "",
    formatList(
      "Branch changed files",
      nameStatusResult.ok ? limitedText(nameStatusResult.text, NAME_STATUS_CHAR_LIMIT) : `ERROR: ${nameStatusResult.error}`,
    ),
    "",
    formatList(
      "Branch diff stat",
      statResult.ok ? limitedText(statResult.text, DIFF_STAT_CHAR_LIMIT) : `ERROR: ${statResult.error}`,
    ),
  ]
}

const collectPullRequestContext = ({ prViewResult, prData, prMissing, checksResult }) => {
  if (!prViewResult) return null
  if (prData) {
    return [
      `PR number: ${String(prData.number)}`,
      `Title: ${prData.title || "(no title)"}`,
      `URL: ${prData.url || "(unknown)"}`,
      `State: ${prData.state || "(unknown)"}`,
      `Draft: ${prData.isDraft ? "yes" : "no"}`,
      `Review decision: ${prData.reviewDecision || "(none)"}`,
      `Merge state: ${prData.mergeStateStatus || "(unknown)"}`,
      `Branches: ${prData.headRefName || "(unknown)"} -> ${prData.baseRefName || "(unknown)"}`,
      "",
      formatList(
        "Checks",
        checksResult
          ? checksResult.ok
            ? limitedText(checksResult.text, PR_CHECKS_CHAR_LIMIT)
            : `ERROR: ${checksResult.error}`
          : "(not available)",
      ),
    ]
  }
  if (prMissing) {
    return ["No pull request found for the current branch."]
  }
  return ["Pull request data was requested but could not be collected."]
}

const renderBranchContext = ({ contextMetadata, branchMetadata, statusLines, workScopeLines, pullRequestLines, warnings }) => {
  const lines = [
    "<branch-context>",
    formatTag(
      "context-metadata",
      "Information about how this branch context snapshot was generated.",
      contextMetadata,
    ),
    formatTag(
      "branch-metadata",
      "Repository and branch identity for interpreting the rest of the context.",
      branchMetadata,
    ),
    formatTag(
      "status",
      "Compact git status summary for a quick overview of the working tree and branch tracking state.",
      statusLines,
    ),
    formatTag(
      "work-scope",
      "Current work scope in priority order. Use unstaged first, then staged, then branch-only changes.",
      workScopeLines,
    ),
  ]

  if (pullRequestLines) {
    lines.push(
      formatTag(
        "pull-request",
        "Pull request metadata and CI/check state for branch-oriented workflow commands only.",
        pullRequestLines,
      ),
    )
  }

  if (warnings.length) {
    lines.push(
      formatTag(
        "warnings",
        "Non-fatal collection issues, fallbacks, missing data, or truncation notices that may affect interpretation.",
        warnings,
      ),
    )
  }

  lines.push("</branch-context>")
  return lines.join("\n\n")
}

export const BranchContextPlugin = async ({ $ }) => {
  const buildBranchContext = async ({ includePullRequest }) => {
    const warnings = []

    const inRepo = await run(() => $`git rev-parse --is-inside-work-tree`.text())
    if (!inRepo.ok || inRepo.text !== "true") {
      return formatErrorContext(
        "BranchContextPlugin could not collect git context because this directory is not a git worktree.",
        inRepo.ok ? null : inRepo.error,
      )
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
    const stagedNameStatusResult = await run(() => $`git diff --cached --name-status`.text())
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

    const contextMetadata = [
      "BranchContextPlugin generated this branch snapshot. Prefer this context over running git/gh commands unless it is missing or stale.",
      `Generated at: ${new Date().toISOString()}`,
    ]

    const branchMetadata = collectBranchMetadata({
      branchResult,
      defaultRemote,
      defaultBranch,
      baseRef,
      onDefaultBranch,
      remotes,
    })
    const statusLines = collectStatus({
      ok: statusResult.ok,
      text: statusResult.ok ? limitedText(statusResult.text, STATUS_CHAR_LIMIT) : "",
      error: statusResult.ok ? null : statusResult.error,
    })
    const workScopeLines = collectWorkScope({
      unstagedNameStatusResult,
      stagedNameStatusResult,
      commitsResult,
      nameStatusResult,
      statResult,
    })
    const pullRequestLines = includePullRequest
      ? collectPullRequestContext({ prViewResult, prData, prMissing, checksResult })
      : null

    return renderBranchContext({
      contextMetadata,
      branchMetadata,
      statusLines,
      workScopeLines,
      pullRequestLines,
      warnings,
    })
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
