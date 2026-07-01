import { Effect } from "effect";
import {
  existsSync,
  lstatSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
} from "fs";
import { dirname, join, relative } from "path";
import type { OutputLogService } from "../services/OutputLog.js";
import { resolveLinkTarget } from "./omarchyHost.js";
import { CONFIG_DIR, STATE_DIR, displayPath } from "./paths.js";

/** Path of the omarchy-nvim theme spec symlink within `~/.config`. */
const nvimThemeLinkPath = (): string =>
  join(CONFIG_DIR, "nvim", "lua", "plugins", "theme.lua");

/** Directory the omarchy-nvim package populates; absent when nvim is not set up. */
const nvimPluginsDir = (): string => join(CONFIG_DIR, "nvim", "lua", "plugins");

/**
 * Candidate omarchy "current theme" Neovim spec paths, in preference order.
 *
 * The active theme lives at `~/.config/omarchy/current/theme/neovim.lua` on
 * current Omarchy. A `2026.6.17` regression in the omarchy-nvim package pointed
 * the link at `~/.local/state/omarchy/current/theme/neovim.lua`, which no
 * omarchy-theme-* script populates, so the link dangled and Neovim fell back to
 * the LazyVim default colorscheme. Repair targets the first candidate that
 * exists so the fix stays correct if Omarchy later relocates `current`.
 */
const themeSpecCandidates = (): readonly string[] => [
  join(CONFIG_DIR, "omarchy", "current", "theme", "neovim.lua"),
  join(STATE_DIR, "omarchy", "current", "theme", "neovim.lua"),
];

/** Status of the omarchy-nvim theme spec symlink. */
export type NvimThemeLinkStatus =
  "not-installed" | "ok" | "not-symlink" | "repairable" | "no-theme";

/** Result of probing `~/.config/nvim/lua/plugins/theme.lua`. */
export interface NvimThemeLink {
  /** Classified link state driving both the doctor report and the repair. */
  readonly status: NvimThemeLinkStatus;
  /** Absolute path of the theme spec symlink. */
  readonly linkPath: string;
  /** Resolved target the current symlink points at, if it is a symlink. */
  readonly currentTarget: string | null;
  /** Omarchy theme spec the link should point at, if one exists on disk. */
  readonly desiredTarget: string | null;
  /** Relative symlink content that reproduces {@link NvimThemeLink.desiredTarget}. */
  readonly desiredLinkContent: string | null;
}

/** Read the symlink target at `linkPath`, or classify why it could not be read. */
function readLinkTarget(linkPath: string):
  | { readonly kind: "target"; readonly target: string }
  | {
      readonly kind: "missing" | "not-symlink";
    } {
  try {
    const stat = lstatSync(linkPath);
    if (!stat.isSymbolicLink()) return { kind: "not-symlink" };
    return {
      kind: "target",
      target: resolveLinkTarget(linkPath, readlinkSync(linkPath)),
    };
  } catch {
    return { kind: "missing" };
  }
}

/**
 * Probe the omarchy-nvim theme spec symlink and classify it for repair.
 *
 * Returns `not-installed` when the omarchy-nvim plugin directory is absent,
 * `ok` when the link resolves to an existing spec (regardless of which omarchy
 * location it uses), `not-symlink` when a real file occupies the path, `no-theme`
 * when the link is broken and no omarchy current theme spec exists to repair to,
 * and `repairable` when the link is missing or broken but a valid target exists.
 */
export function detectNvimThemeLink(): NvimThemeLink {
  const linkPath = nvimThemeLinkPath();
  const desiredTarget = themeSpecCandidates().find(existsSync) ?? null;
  const desiredLinkContent = desiredTarget
    ? relative(dirname(linkPath), desiredTarget)
    : null;
  const base = { linkPath, desiredTarget, desiredLinkContent };

  if (!existsSync(nvimPluginsDir())) {
    return { ...base, status: "not-installed", currentTarget: null };
  }

  const link = readLinkTarget(linkPath);
  if (link.kind === "not-symlink") {
    return { ...base, status: "not-symlink", currentTarget: null };
  }

  const currentTarget = link.kind === "target" ? link.target : null;
  if (currentTarget && existsSync(currentTarget)) {
    return { ...base, status: "ok", currentTarget };
  }

  return {
    ...base,
    status: desiredTarget ? "repairable" : "no-theme",
    currentTarget,
  };
}

/**
 * Create or repair `~/.config/nvim/lua/plugins/theme.lua` so it points at the
 * omarchy current theme's Neovim spec.
 *
 * A no-op when nvim is not set up, the link already resolves, a real file
 * occupies the path, or no omarchy theme spec exists to target. Otherwise the
 * stale link is removed and replaced with a relative symlink to the current
 * theme spec, undoing the omarchy-nvim package's mislocated link.
 */
export const ensureNvimThemeLink = (
  log: Pick<OutputLogService, "info" | "warn">,
) =>
  Effect.gen(function* () {
    const link = detectNvimThemeLink();
    const path = displayPath(link.linkPath);

    if (link.status === "not-installed") return;

    if (link.status === "ok") {
      yield* log.info(`Neovim theme link OK (${path})`);
      return;
    }

    if (link.status === "not-symlink") {
      yield* log.warn(`Skipping Neovim theme link (${path} is not a symlink)`);
      return;
    }

    if (link.status === "no-theme" || !link.desiredLinkContent) {
      yield* log.warn(
        `Skipping Neovim theme link (no omarchy current theme spec to target)`,
      );
      return;
    }

    if (link.currentTarget !== null) {
      yield* Effect.sync(() => {
        try {
          unlinkSync(link.linkPath);
        } catch {
          // Nothing to remove — treat as already clear.
        }
      });
    }

    symlinkSync(link.desiredLinkContent, link.linkPath);
    yield* log.info(
      `Repaired Neovim theme link (${path} -> ${link.desiredLinkContent})`,
    );
  });
