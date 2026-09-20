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
   context; do not silently switch servers. Inspect existing workspace and pane
   state, including the directory behind a matching label. Reuse an existing
   worker only when it belongs to this assignment; never prompt an unrelated agent.
2. Read `dot herdr repo-open --help` and `dot herdr agents`. Select the requested
   target's `executable`, `label`, and `kind`; otherwise match the current runtime.
   Verify the exact launcher before opening anything. Do not substitute the
   executable selected by `herdr agent start --kind` for a configured launcher.
3. Use the shared opener directly rather than driving the picker or Git panel.
   With values resolved from those sources, the one-command launch is:

   ```sh
   dot herdr repo-open --agent-kind "$kind" --prompt "$brief" \
     "$repo_label" "$repo_path" "$agent_label" "$launcher"
   ```

   Omit both prompt flags when the user only wants an agent opened. Omit the
   command argument to open or focus just the workspace. An empty command instead
   selects an idle shell or creates a pane using the requested layout.
4. The opener uses the picker label to reuse a workspace or creates one when
   absent. Commands reuse an idle shell, searching the focused pane, its tab,
   then other tabs; otherwise they split right. Existing agents and foreground
   commands are skipped. Use `--layout vertical`, `horizontal`, or `tab` for an
   agreed explicit placement. Same-project workers normally use sibling panes;
   retain direct Herdr splitting when exact pane targeting is required.
5. Record the target pane and agent from live Herdr state after launching. The
   opener currently returns no pane IDs, so launch serially and compare before
   and after state. Do not guess IDs or infer ownership from focus or a label.
   For workers, assign the coordination name with `herdr agent rename` once
   identified. Reusing a pre-existing shell does not make its pane yours to close.

## Alternate Runtimes And Focus

- OpenCode 2 is advertised by `dot herdr agents` with its configured wrapper as
  `executable` and `opencode` as `kind`. Use those values together. `opencode2`
  is not a Herdr kind; `--agent` inside OpenCode selects a profile, not a version.
  With the exact standard wrapper and `--prompt`, the opener checks the expected
  executable from `mise which opencode2`, waits for readiness, checks the detected
  kind and foreground process, then sends the brief. No second prompt is needed.
- For another wrapper or a command containing extra arguments, verify its actual
  exec target first. Launch through the opener without `--prompt`, identify the
  pane, and check `herdr pane process-info` against that target. Wait for the
  detected agent to be ready, then use `herdr agent prompt`. Do not pretend that
  kind detection alone verifies an alternate runtime, or fall back to a different
  agent when detection fails. Inspect blocked or failed launches before retrying:
  failure can leave a live agent or an already-delivered prompt.
- The opener focuses the destination and has no `--no-focus`. Leave it focused
  for an explicit open-in-agent request. For approved background workers, retain
  the caller pane ID and restore it with `herdr agent focus` after launch, including
  failed launches. This can briefly switch focus. If focus must never move, use
  direct Herdr `--no-focus` placement in an existing workspace, or ask before
  creating a missing workspace through a different route.
- Keep launch, verification, and any manual prompt steps sequential. Let workers
  run in parallel only after their identity and assignment are established.

The shared implementation is `dot/src/commands/HerdrRepoOpen.ts`; the picker and
Omarchy Git panel are consumers. `herdr` owns live control and `session-coordination`
owns assignments, approval, result collection, and cleanup.
