import { Effect, FileSystem } from "effect";
import { cliStyler } from "./ansi.js";
import { pathExists, readLinkOrNull } from "./fsProbe.js";
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
const readLinkTarget = Effect.fn("OmarchyNvim.readLinkTarget")(function* (
  linkPath: string,
) {
  const content = yield* readLinkOrNull(linkPath);

  if (content !== null) {
    return {
      kind: "target",
      target: resolveLinkTarget(linkPath, content),
    } as const;
  }

  return (yield* pathExists(linkPath))
    ? ({ kind: "not-symlink" } as const)
    : ({ kind: "missing" } as const);
});

/**
 * Probe the omarchy-nvim theme spec symlink and classify it for repair.
 *
 * Returns `not-installed` when the omarchy-nvim plugin directory is absent,
 * `ok` when the link resolves to an existing spec (regardless of which omarchy
 * location it uses), `not-symlink` when a real file occupies the path, `no-theme`
 * when the link is broken and no omarchy current theme spec exists to repair to,
 * and `repairable` when the link is missing or broken but a valid target exists.
 */
export const detectNvimThemeLink = Effect.fn("OmarchyNvim.detect")(
  function* () {
    const linkPath = nvimThemeLinkPath();
    let desiredTarget: string | null = null;

    for (const candidate of themeSpecCandidates()) {
      if (yield* pathExists(candidate)) {
        desiredTarget = candidate;
        break;
      }
    }

    const desiredLinkContent = desiredTarget
      ? relative(dirname(linkPath), desiredTarget)
      : null;

    const base = { linkPath, desiredTarget, desiredLinkContent };

    if (!(yield* pathExists(nvimPluginsDir()))) {
      return {
        ...base,
        status: "not-installed",
        currentTarget: null,
      } satisfies NvimThemeLink;
    }

    const link = yield* readLinkTarget(linkPath);

    if (link.kind === "not-symlink") {
      return {
        ...base,
        status: "not-symlink",
        currentTarget: null,
      } satisfies NvimThemeLink;
    }

    const currentTarget = link.kind === "target" ? link.target : null;

    if (currentTarget && (yield* pathExists(currentTarget))) {
      return { ...base, status: "ok", currentTarget } satisfies NvimThemeLink;
    }

    return {
      ...base,
      status: desiredTarget ? "repairable" : "no-theme",
      currentTarget,
    } satisfies NvimThemeLink;
  },
);

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
  log: Pick<OutputLogService, "info" | "success" | "warn">,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const link = yield* detectNvimThemeLink();
    const path = displayPath(link.linkPath);

    if (link.status === "not-installed") return;

    if (link.status === "ok") {
      yield* log.info(cliStyler().dim(`Neovim theme link OK (${path})`));

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
      yield* fs.remove(link.linkPath).pipe(Effect.ignore);
    }

    yield* fs
      .symlink(link.desiredLinkContent, link.linkPath)
      .pipe(Effect.orDie);
    yield* log.success(
      `Repaired Neovim theme link (${path} -> ${link.desiredLinkContent})`,
    );
  });
