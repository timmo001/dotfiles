---
name: omarchy-shell-quickshell
description: "Customise, test and reload the Omarchy shell (omarchy-shell) - the Quickshell process behind the bar, notifications, OSD, launcher, and settings - and its plugins, in dotfiles or a plugin's own repository. Use when working with the Omarchy shell or Quickshell: editing omarchy/.config/omarchy/plugins/ in dotfiles, an omarchy-plugin/ folder or an omarchy-* plugin repository, the shell.json generator dot/src/lib/omarchyShellConfig.ts, shell.json, BarWidget/WidgetButton or other Quickshell QML, running omarchy plugin or omarchy restart shell, referencing upstream Quickshell, or when a shell or bar change is not showing up. Also use before pushing a change to a shell plugin's source, so the dotfiles bump is agreed with the push."
metadata:
  author: timmo001
---

# Omarchy Shell (Quickshell)

## Upstream contract

- The Omarchy shell is one long-running Quickshell process that hosts the bar, panels, overlays, menus, notifications, lock surface, and shell services as plugins.
- This work targets the `quattro` branch of `basecamp/omarchy`. Use the advertised `omarchy` reference for current source and compare its revision with `origin/quattro` when recency matters.
- `$OMARCHY_PATH` owns the installed Omarchy source, normally `/usr/share/omarchy`. Treat it as read-only because package updates replace it.
- Use the advertised `quickshell` reference for backend implementation details and compare its revision with upstream `master` when recency matters. The installed runtime version and revision are reported by `qs --version`.

Read the owning sources before relying on remembered plugin or backend behaviour:

- `$OMARCHY_PATH/docs/omarchy-shell.md` and `$OMARCHY_PATH/shell/README.md` for the shell and plugin contracts.
- `$OMARCHY_PATH/default/agents/skills/omarchy/plugins.md` for current end-user operations.
- `$OMARCHY_PATH/shell/services/PluginRegistry.qml` for manifest validation and discovery behaviour.
- `$OMARCHY_PATH/shell/plugins/` for maintained manifest and QML patterns. Use built-ins as locations to inspect, not templates to copy verbatim.
- `$OMARCHY_PATH/bin/omarchy-launch-shell`, `$OMARCHY_PATH/bin/omarchy-restart-shell`, and `$OMARCHY_PATH/bin/omarchy-shell` for lifecycle and IPC behaviour.
- The `quickshell` reference source for `WlrLayershell`, `IpcHandler`, reload semantics, and CLI behaviour.

## Source of truth (never edit live)

Repo paths below are relative to the dotfiles checkout at `~/.config/dotfiles`.

- Custom shell content ships as **user plugins**. Plugins that live in dotfiles are edited at the stow source `omarchy/.config/omarchy/plugins/<id>/` (stows to `~/.config/omarchy/plugins/<id>/`).
- Managed plugins (submodules in `.gitmodules`) are edited only in their actual source repository: the publishing repo's `omarchy-plugin/` folder when one publishes it, otherwise the plugin repository itself. Find the local checkout with `dot repo search`, and ask before cloning if there is none. Never edit, commit in, or push from the submodule checkout, and never copy plugin files between the source repo, the submodule, and the live directory by hand. Changes reach dotfiles only through the bump flow below.
- `~/.config/omarchy/shell.json` is **generated, not hand-edited**. It is rendered by `dot` from `dot/src/lib/omarchyShellConfig.ts` (`mergeOmarchyShellConfig`), starting from Omarchy's default and inserting personal modules. Edit the generator, rebuild `dot`, then `dot stow` regenerates the file. The live file is mode `0600` and tracked by neither dotfiles repo.

## Plugin workflow

- Confirm the current manifest contract in `PluginRegistry.qml` and inspect the nearest built-in under `$OMARCHY_PATH/shell/plugins/` before creating or changing a plugin.
- Keep third-party ids namespaced outside the reserved `omarchy.*` namespace.
- Prefer Omarchy's `omarchy plugin` and `omarchy bar` commands when they cover the operation. They own validation, enabled state, placement, and persisted layout.
- For a new manually installed plugin, run `dot stow`, rescan plugins, then enable the plugin. Rescanning discovers code but does not enable it.
- Omarchy watches user-plugin files, but dotfiles requires an explicit restart after edits to verify the final stowed state.
- Plugins run unsandboxed in the shell process. Review all plugin code before enabling it.

`~/.config/omarchy/plugins/` is a real directory with per-plugin symlinks. A new stowed plugin is invisible until `dot stow` creates its symlink. Existing plugin files are already live through their symlinks.

## Working in a plugin's source repository

- The bar runs the published copy deployed from dotfiles, so `dot stow` and `dot reload shell` do not show a source edit. It goes live only after it is pushed, published and bumped through the flow below.
- Run and test the plugin with the repository's own workflow from its `AGENTS.md` or mise tasks (upnext, for example, runs a development panel with `mise run dev:start`). Do not copy files into dotfiles or the live plugin directory to try a change.
- Lint with the repository's own QML check (for example the qmllint step in its `publish-omarchy-plugin.yml`), falling back to dotfiles' `.github/workflows/quickshell-lint.yml` when it has none.
- Follow the repository's own versioning rules for the plugin manifest; publishing usually depends on them.

## After pushing a shell plugin change

Managed plugins are submodules listed in `.gitmodules` under `omarchy/.config/omarchy/plugins/`. Some are published from another repository: a source repo with `.github/workflows/publish-omarchy-plugin.yml` copies its `omarchy-plugin/` folder into the `repository:` that workflow names (for example `upnext` to `omarchy-upnext`). Others, such as `omarchy-clock`, are the plugin repository itself.

Whenever an authorised push lands a change to a managed plugin, follow through to dotfiles. This usually starts from the plugin's source repository, so check before pushing there:

1. Map the pushed repo to its plugin ID by matching the publish target (or the repo itself) against the submodule URLs in dotfiles' `.gitmodules`. Stop if it is not a managed plugin.
2. Settle permission for the dotfiles bump in the same turn as the source push, before waiting. It is granted when the user's request already covers it (for example "push and bump dotfiles" or "ship it to the bar"). Otherwise ask once with the question tool: commit, commit and push, or leave the bump unstaged. A push to the source repo alone does not authorise a dotfiles commit.
3. For published plugins, check the pushed commits touched the workflow's `paths` on its publish branch; if not, nothing is published, so stop. Otherwise wait for the run in a background shell and carry on with other work:

   ```bash
   dot run --timeout '30 minutes' -- bash -c 'until id=$(gh run list -R <owner/source-repo> --workflow publish-omarchy-plugin.yml --commit <sha> --event push --json databaseId -q ".[0].databaseId") && [ -n "$id" ]; do sleep 10; done; gh run watch "$id" -R <owner/source-repo> --exit-status'
   ```

   Plugin repositories that are the submodule itself need no wait.
   `<sha>` must be the full commit hash. A run that already finished is reported straight away.
4. If the run fails, report it with the failing job and stop. On success, run `dot omarchy-plugin update <id> --yes` from `~/.config/dotfiles`. It validates, deploys and rescans the plugin, leaving the bump unstaged. If it reports the plugin is up to date, the publish was a no-op; say so and stop.
5. Then `dot reload shell` and act on the permission from step 2 through the `dot-git-commit` skill, scoped with `--path omarchy/.config/omarchy/plugins/<id>`.

## Reload matrix (dotfiles changes)

| Change | Action |
| --- | --- |
| `shell.json` layout/settings, existing modules only | `dot stow`, then `dot reload shell` |
| User plugin QML edited | `dot stow`, then `dot reload shell` |
| New manual plugin added | `dot stow`, rescan, enable, then `dot reload shell` |
| Rescan or automatic reload cannot recover | `dot reload shell` |

`dot reload shell` reloads only the shell: it clears a stuck workspace lock, regenerates `shell.json`, runs `omarchy restart shell`, rescans plugins and refreshes shell modules. Bare `dot reload` also rechecks upnext, refreshes updates and starts a doctor check; reload only the parts a change needs.

Use `$OMARCHY_PATH/docs/omarchy-shell.md` for current IPC method names and return values. A full `omarchy restart shell` protects an active lock session, stops matching Quickshell instances, and asks Hyprland to launch the replacement with the canonical session environment.

## Shell lifecycle

- Do not recreate shell launch or termination logic. Use `dot reload shell`, which wraps `omarchy restart shell`, and inspect the current launch scripts when diagnosing lifecycle behaviour.
- Current Quattro launches the replacement through Hyprland so it inherits the session environment rather than transient terminal, SSH, or agent variables. `dot update` retains an existing `QT_QPA_PLATFORM=wayland` override on its restart call for compatibility; do not copy it into new callers or treat it as the source of the replacement process's environment.
- Omarchy disables Quickshell's whole-config file watcher for the packaged shell and restarts deliberately during lifecycle operations. Shell-owned `FileView` and plugin-directory watchers still handle `shell.json` and user-plugin updates.
- `dot update` restarts the shell only when the generated `shell.json` changed. Standalone `dot stow` does not restart it.

## Lint (required after every final QML change)

After every final QML edit, lint the touched files with the Qt 6 `qmllint`. In dotfiles, use `.github/workflows/quickshell-lint.yml` as the source of truth for the binary, import path, warning policy, and CI backend version. The workflow deliberately performs a syntax-focused check because Omarchy's private `qs.*` modules are not packaged with the stable Quickshell syntax proxy. Lint must exit successfully before a QML change is done.

## Verify

- Use the current `omarchy plugin` command help to confirm registration, enabled state, and validation behaviour. Validation rejects symlinked plugin folders, which is expected for stowed plugins.
- Inspect `$OMARCHY_PATH/docs/omarchy-shell.md` and `$OMARCHY_PATH/shell/shell.qml` for available shell IPC diagnostics before invoking them.
- Use compositor layer inspection and a targeted screenshot when visual geometry matters; confirm that the bar remains a layer-shell surface after any full restart.
- After editing the generator: `mise run dot:check`.
