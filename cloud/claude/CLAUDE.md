# Cloud Session

These notes come from the `distro/cloud` dotfiles and apply to Claude Code cloud sessions. Any global instructions after them were written for my own machines: where the two disagree, these notes win.

- This is an ephemeral Ubuntu VM running as root. Attached repositories are cloned under `/home/user`, and anything not committed and pushed is lost when the VM is reclaimed.
- `~/.config/dotfiles` is a shallow clone of `distro/cloud` that only provides `dot`, its mise toolchain and these settings. It is not a working copy: make dotfiles changes in an attached `timmo001/dotfiles` checkout.
- `dot` and `mise` are on `PATH`. No stow packages, user services or private machine config are installed, so `dot update`, `dot stow`, `dot doctor`, Herdr, Plannotator, the `notes` and `context` tools and local paths such as `~/repos` are not available.
- Skills from `timmo001/skills` are linked into `~/.claude/skills`.
- `~/.config/dotfiles-private` is a clone of the private dotfiles, or a link to the attached checkout, so `dot repo list` and `dot repo search` can look up tracked repositories. Their paths point at my machines' layout: an attached repository is under `/home/user` instead, and the rest aren't cloned.
- GitHub goes through the session's GitHub tools and proxy. Only attached repositories can be read through the API or pushed to, and `gh` commands that use GraphQL, such as `gh pr` and `gh issue`, are blocked.
