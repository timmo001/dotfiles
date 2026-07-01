import { Effect } from "effect";
import { detectNvimThemeLink } from "../../lib/omarchyNvim.js";
import { displayPath } from "../../lib/paths.js";
import type { CheckResult } from "../types.js";

/**
 * Flag a broken omarchy-nvim theme spec symlink.
 *
 * `~/.config/nvim/lua/plugins/theme.lua` is created by the omarchy-nvim package
 * and should point at the omarchy current theme's `neovim.lua`. A `2026.6.17`
 * package regression pointed it at a non-existent `~/.local/state` path, so the
 * link dangled and Neovim silently fell back to the LazyVim default colorscheme
 * instead of the selected omarchy theme. `dot update` repairs it; this surfaces
 * the state.
 */
export const checkNvimThemeLink = Effect.sync(() => {
  const link = detectNvimThemeLink();
  const path = displayPath(link.linkPath);

  if (link.status === "not-installed") {
    return [
      { severity: "ok", message: "Neovim config not present (skipped)" },
    ] satisfies CheckResult[];
  }

  if (link.status === "ok") {
    return [
      {
        severity: "ok",
        message: `Neovim theme link OK (${path})`,
        detail: link.currentTarget
          ? `-> ${displayPath(link.currentTarget)}`
          : undefined,
      },
    ] satisfies CheckResult[];
  }

  if (link.status === "not-symlink") {
    return [
      {
        severity: "warn",
        message: `Neovim theme link is not a symlink (${path})`,
        detail:
          "A real file occupies the path; move it aside so dot can manage the link.",
      },
    ] satisfies CheckResult[];
  }

  if (link.status === "no-theme") {
    return [
      {
        severity: "warn",
        message: `Neovim theme link broken (${path})`,
        detail:
          "No omarchy current theme spec found; set an omarchy theme, then run dot update.",
      },
    ] satisfies CheckResult[];
  }

  return [
    {
      severity: "warn",
      message: `Neovim theme link broken (${path})`,
      detail: `Points nowhere (omarchy-nvim mislocated link); run dot update to repair -> ${link.desiredLinkContent}`,
    },
  ] satisfies CheckResult[];
});
