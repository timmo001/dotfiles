---
name: dotfiles-repositories
description: Find related local repositories and open them in agents through the shared dot Herdr launcher. Use for tracked-repository discovery, cross-repository work involving dotfiles or skills, open-in-agent requests, and approved workers in another project workspace. Shares the prefix+s picker and Omarchy Git panel launch path.
compatibility: Repository discovery requires dotfiles repository configuration; launching requires dot, Herdr, and the herdr skill.
---

# Dotfiles Repositories

## Find The Repository

- Start with advertised local project references. For other tracked repositories,
  read the host's `${XDG_CACHE_HOME:-$HOME/.cache}/dot/repo-picker.json` and select
  the relevant `name` and `path`. This is the same list used by `prefix+s`.
  It contains configured repositories and shortcuts, not live workspace state.
- `dot stow` generates that cache from the optional private `dot-git.yml`.
  If it is missing or stale, consult the private source and verify the checkout;
  refresh through `dot stow` when needed. Do not invent paths or maintain a second
  repository list. Keep private entries out of public files and shared reports.
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
     --prompt "$brief" --json "$repo_label" "$repo_path"
   ```

   Omit `--prompt` when the user only wants an agent opened. Worker names use the
   `coord-` prefix from `session-coordination`; the opener checks availability
   before launching and assigns the name before prompting. Omit `--agent` to
   open or focus just the workspace. An empty command instead selects an idle
   shell or creates a pane using the requested layout.
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

## Alternate Runtimes And Focus

- `--agent opencode2` selects the configured OpenCode 2 wrapper and `opencode`
  kind. `--agent` inside OpenCode itself selects a profile, not a version.
  The opener checks the expected
  executable from `mise which opencode2`, waits for readiness, checks the detected
  kind and foreground process, then names the agent and sends any brief. Trust
  that verification on success; no separate runtime lookup or prompt is needed.
- For another wrapper or a command containing extra arguments, verify its actual
  exec target first. Launch through the opener without `--prompt`, identify the
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
