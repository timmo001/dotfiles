---
name: dotfiles-repositories
description: Find tracked local repositories with `dot repo list` or the fuzzy `dot repo search`, induct new ones with `dot repo induct`, and open them in agents through the shared dot Herdr launcher. Use whenever the user names a repository, refers to one by its purpose, or says things like "look at my dotfiles", "my skills", "my ha repos" or "check my tracked repos for x", asks which repositories are tracked or wants one tracked, and for cross-repository work involving dotfiles or skills, open-in-agent requests, and approved workers in another project workspace. Shares the prefix+s picker and Omarchy Git panel launch path.
compatibility: Repository discovery requires dotfiles repository configuration; launching requires dot, Herdr, and the herdr skill.
metadata:
  author: timmo001
---

# Dotfiles Repositories

## Find The Repository

Whenever the user says "my ... repo(s)", "my dotfiles", "my skills" or names
any repository, resolve it with `dot repo` before guessing a path:

| The user says                                       | Run                                                                                              |
| --------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| "look at my dotfiles", "my skills", "the notes CLI" | `dot repo search <words>`; use the top result when it clearly leads                              |
| "look at my ha repos for x" (a group)               | `dot repo search <group> --all`; keep every result sharing the group's name prefix or alias stem |
| "check my tracked repos for y"                      | `dot repo list`; work through every entry                                                        |
| an exact name, alias or `owner/repo`                | `dot repo list <query>`                                                                          |
| a purpose not in any name ("the pacman repo")       | `dot repo list`; choose by name, slug and project reference descriptions                         |

- `search` is fuzzy and typo-tolerant over name, aliases, GitHub repository name
  and slug, directory and path. Every term must match; results are ranked with
  `score` (1 to 100) and `matched`, top 10 unless `--all`. When the top scores
  are close and the user meant one repository, ask which.
- Both print JSON under an agent with `name`, `path`, `github`, `aliases`,
  `kind`, `exists`, `current` and `herdr`, and exit 1 when nothing matches. A
  miss means the words are not in any name; fall back to the full list.
- "My dotfiles" can cover the public repository and its private overlay; follow
  where the thing asked about actually lives.
- For a group or all tracked repositories, skip `exists: false`, search the
  checkouts read-only (for example one `rg` over all their paths) and report
  findings per repository. Don't open sessions per repository unless asked.
- `herdr` is live state from the shared Herdr server: `open`, the matching
  `workspaces` (IDs, focus, counts, aggregate agent status, linked worktrees)
  and the `agents` running in them (name, kind, status, pane and cwd). Use it
  to tell whether a repository is already open or has a busy agent before
  opening or delegating. It is `null` when Herdr is unreachable; agent status is
  a snapshot, not proof that work has finished.
- `dot repo` reads the optional private `dot-git.yml` directly: the same
  configured repositories and shortcuts as `prefix+s`, with live state only in
  `herdr`. `exists: false` means the checkout is missing. Do not invent paths
  or maintain a second repository list. Keep private entries out of public
  files and shared reports.
- To track a new repository, use `dot repo induct <path> --noninteractive` with
  the chosen flags to preview, then repeat with `--commit` only after the user
  approves the preview. In a terminal without flags it runs a wizard.
- For related changes, follow the actual dependency or consumer to its writable
  checkout. Read that repository's instructions and check its remote, visibility,
  and working tree before editing. A reference or tracked entry is context, not
  permission to expand the task or create a session.
- Use each owning source: shared dotfiles behaviour, private host configuration,
  and authored skills may live in different repositories. Follow the host's source
  paths and skill-authoring rules; do not edit installed skills, pinned submodules,
  generated mirrors, or OpenCode's cached reference clones as writable sources.

## Open In An Agent

Apply `session-coordination` for delegation and its evidence-backed approval
before creating sessions or panes. An explicit request to open a named repository
in an agent can cover that launch; a general preference for parallel work cannot.
Discovery alone needs no new session. Keep focused work in the current session.

1. Load `herdr` and pass its managed-pane check before control. Keep its socket
   context; do not silently switch servers. For a new agent, let the opener find
   an idle shell or create a pane. Inspect live state when reusing an existing
   worker, and only reuse one that belongs to this assignment.
2. Read `dot herdr repo-open --help`. Select the requested launcher with `--agent`
   (for example `opencode2`); otherwise match the current runtime. Use
   `dot herdr agents` when the launcher identity is unknown. The opener resolves
   its executable, label and kind; do not repeat that discovery or substitute
   the executable selected by `herdr agent start --kind`.
3. Use the shared opener directly rather than driving the picker or Git panel.
   The one-command launch is:

   ```sh
   dot herdr repo-open --agent "$launcher" --agent-name "$worker_name" \
     --prompt-file "$brief_file" --json "$repo_label" "$repo_path"
   ```

   Write multi-line briefs, or any text containing backticks, quotes or `$`, to
   a file and pass `--prompt-file`; inline shell quoting keeps `\n` literal and
   runs backticks or `$(...)`. Use `--prompt "$text"` only for a short
   single-line prompt. A missing or empty file fails before anything launches.

   For OpenCode 2 with a requested model, add `--model "$model"` to this
   command. The opener validates against `opencode2 models`, creates an OpenCode
   session with it, then starts the full TUI on that session before sending the
   brief. An ambiguous model name fails with the matching choices; use the full
   `provider/model` ID to disambiguate. Do not select the model through TUI keys
   or substitute `opencode mini`.
   For effort or another variant, use `--model "opus 5.5#low"` or
   `--model "opus 5.5" --variant low`, not both forms together. Variants are
   checked against that model's catalogue in the target project before creating
   the session. Do not assume every model offers the same effort levels.
   Omit the prompt flags when the user only wants an agent opened. Worker names
   use the `coord-` prefix from `session-coordination`; the opener checks
   availability before launching and assigns the name before prompting. Omit
   `--agent` to open or focus just the workspace. An empty command instead
   selects an idle shell or creates a pane using the requested layout.
4. The opener uses the picker label to reuse a workspace or creates one when
   absent. Commands reuse an idle shell, searching the focused pane, its tab,
   then other tabs; otherwise they split right. Existing agents and foreground
   commands are skipped. Use `--layout vertical`, `horizontal`, or `tab` for an
   agreed explicit placement. Same-project workers normally use sibling panes;
   retain direct Herdr splitting when exact pane targeting is required.
5. Use the returned `workspaceId`, `tabId`, `paneId`, `agent` and `promptSent`
   directly. `created.pane` distinguishes a new pane from a reused shell; reuse
   does not make its pane yours to close. `agent.session` is optional, and agent
   status is a snapshot, not proof that work has completed. Do not list all agents
   again to rediscover these IDs or rename an agent already named by the opener.
   A workspace-only focus may return a null `paneId` because no pane was selected.

To switch the model of an existing Herdr OpenCode 2 agent, identify its unique
live name or pane ID, then use `dot herdr model <target> <model>`. It checks the
running OpenCode 2 executable and Herdr-reported session ID, resolves the model
in that session's project, and switches it through the OpenCode API without
starting a new session or sending a prompt. Do not assume a model change is
authorised for a worker you do not own; ask before changing another agent's
active work.

Use `dot herdr model <target> "opus 5.5#low"` or
`dot herdr model <target> "opus 5.5" --variant low` to switch effort as well.
For an effort-only request, retain the session's current provider and model and
pass them with the requested variant. Apply `session-status` and query the exact
OpenCode session ID before preserving its settings; the injected identity does
not include the variant. Omitting the variant selects the model's
default settings. The command verifies the resulting session model and variant;
an already-running request keeps the settings it started with.

## Alternate Runtimes And Focus

- `--agent opencode2` selects the configured OpenCode 2 wrapper and `opencode`
  kind. `--agent` inside OpenCode itself selects a profile, not a version.
  The opener checks the expected
  executable from `mise which opencode2`, waits for readiness, checks the detected
  kind and foreground process, then names the agent and sends any brief. Trust
  that verification on success; no separate runtime lookup or prompt is needed.
- For another wrapper or a command containing extra arguments, verify its actual
  exec target first. Launch through the opener without a prompt flag, identify the
  pane, and check `herdr pane process-info` against that target. Wait for the
  detected agent to be ready, then use `herdr agent prompt`. Do not pretend that
  kind detection alone verifies an alternate runtime, or fall back to a different
  agent when detection fails. Inspect blocked or failed launches before retrying:
  failure can leave a live agent or an already-delivered prompt.
- Leave the default focus behaviour for an explicit open-in-agent request. Use
  `--no-focus` for approved background workers; it skips focus changes and terminal
  client attachment, including when creating a workspace. No focus-restoration
  call is needed.
- Keep launch, verification, and any manual prompt steps sequential. Let workers
  run in parallel only after their identity and assignment are established.

The shared implementation is `dot/src/commands/HerdrRepoOpen.ts`; the picker and
Omarchy Git panel are consumers. `herdr` owns live control and `session-coordination`
owns assignments, approval, result collection, and cleanup.
