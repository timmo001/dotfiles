---
name: agentic-workflows
description: Design, create, update, debug, audit, or upgrade GitHub Agentic Workflows with the `gh aw` extension. Use when work involves workflow Markdown, compiled `.lock.yml` files, agent engines, MCP tools, safe outputs, or `gh aw` commands.
# origin: https://github.com/github/gh-aw/tree/main/.github/skills/agentic-workflows
# upstream-sha: 874225ae1b6249e3288bf5afc06a189fe2ea0579
# local-edits:
#   - SKILL.md: made the upstream router self-contained and replaced unavailable repository-relative prompt loading with official source lookup
---

# Agentic Workflows

Use GitHub's `gh aw` extension for agentic workflows written as Markdown and
compiled to GitHub Actions lock files.

## Workflow

1. Read the workflow Markdown, its compiled `.lock.yml`, and
   `.github/aw/instructions.md` when present. Repository instructions override
   general guidance.
2. Check the installed interface with `gh aw --help` and the relevant
   subcommand help.
3. Read only the relevant current documentation or prompt from the official
   [`github/gh-aw`](https://github.com/github/gh-aw) repository. Use its
   `.github/aw/` guidance for the task type instead of guessing syntax:
   - design: `designer.md`
   - create: `create-agentic-workflow.md`
   - update: `update-agentic-workflow.md`
   - debug or audit: `debug-agentic-workflow.md`
   - upgrade: `upgrade-agentic-workflows.md`
   - engine setup: `configure-agentic-engine.md`
   - shared workflows or MCP wrappers: `create-shared-agentic-workflow.md`
   - permissions and output controls: `safe-outputs.md` and
     `workflow-constraints.md`
4. Edit the Markdown source, not the generated lock file. Compile with the
   repository's documented command and review the generated diff.
5. Run the narrowest available validation or audit command for the workflow.

## Safety

- Treat workflow permissions, credentials, network access, imported tools,
  MCP servers, and safe outputs as security boundaries.
- Keep permissions and network access at the minimum required for the task.
- Prefer safe-output mechanisms over direct write-capable GitHub tools.
- Never hand-edit generated `.lock.yml` files.
- Do not run, enable, push, or dispatch a workflow without the user's explicit
  authorisation for that action.
- Verify current syntax against the installed extension and official source.
  `gh-aw` evolves quickly, so do not rely on remembered flags.
