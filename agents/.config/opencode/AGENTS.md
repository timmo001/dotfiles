# AGENTS

Instructions for coding agents working in this repository.

## Source

This repo is a published snapshot of OpenCode configuration from [`timmo001/dotfiles`](https://github.com/timmo001/dotfiles).

Source files: [`agents/.config/opencode/`](https://github.com/timmo001/dotfiles/tree/main/agents/.config/opencode)

Do not edit files here directly. Make changes in the [source dotfiles repo](https://github.com/timmo001/dotfiles) and publish with `dot opencode-publish`.

## Structure

```
skills/      OpenCode skills (SKILL.md per directory, optional references/)
agents/      Agent definitions (YAML frontmatter + Markdown body)
commands/    Slash commands (YAML frontmatter + Markdown workflow)
plugins/     Lifecycle plugins (ESM JavaScript)
```

## Skills

Each skill is a directory containing a `SKILL.md` with YAML frontmatter (`name`, `description`) and a Markdown body with checklists and guidance. Some skills include a `references/` subdirectory with supporting documents.

Imported skills include `# origin:` and `# upstream-sha:` comments in their frontmatter for tracking upstream changes.

## Importing

To import a skill into your own OpenCode setup, use the `import-external-skill` workflow with a GitHub tree URL pointing at the skill directory:

```
https://github.com/timmo001/opencode-config/tree/main/skills/<skill-name>
```

Agents, commands, and plugins can be copied directly into your OpenCode config directory.
