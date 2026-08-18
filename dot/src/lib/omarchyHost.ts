import { Effect } from "effect";
import {
  existsSync,
  lstatSync,
  readlinkSync,
  renameSync,
  symlinkSync,
  unlinkSync,
} from "fs";
import { homedir } from "os";
import { dirname, join, relative, resolve } from "path";
import type { ConfigService } from "../services/Config.js";
import type { OutputLogService } from "../services/OutputLog.js";
import { gitRemoteOriginSync, isGitRepo } from "./git.js";
import { displayPath } from "./paths.js";
import { ENV, envString } from "./env.js";

/** Resolve a symlink target exactly as the filesystem would from the link path. */
export function resolveLinkTarget(linkPath: string, target: string): string {
  return target.startsWith("/") ? target : resolve(dirname(linkPath), target);
}

/** Return the currently requested Omarchy host, if configured. */
export function currentOmarchyHost(): string | null {
  const host = envString(ENV.OMARCHY_HOST)?.trim();
  return host ? host : null;
}

/** Return the active host selected by `~/.config/hypr/host`, if available. */
export function currentHyprHostLink(config: ConfigService): string | null {
  const hostLink = join(hyprRepoPath(config), "host");
  try {
    const stat = lstatSync(hostLink);
    if (!stat.isSymbolicLink()) return null;
    const target = resolveLinkTarget(hostLink, readlinkSync(hostLink));
    const host = relative(join(hyprRepoPath(config), "hosts"), target);
    return host && !host.startsWith("..") && !host.includes("/") ? host : null;
  } catch {
    return null;
  }
}

/** Resolve the active Omarchy host from the session env, then the Hypr host link. */
export function resolvedOmarchyHost(config: ConfigService): string | null {
  return currentOmarchyHost() ?? currentHyprHostLink(config);
}

/** Return the base Hypr repository path from the Omarchy repo config. */
export function hyprRepoPath(config: ConfigService): string {
  return join(config.omarchy.repoBase, "hypr");
}

/** Remote slug of the retired external Hypr config repo, now vendored into dotfiles. */
export const LEGACY_HYPR_REPO_SLUG = "timmo001/omarchy-hypr";

/** Result of probing `~/.config/hypr` for the retired external Hypr clone. */
export interface LegacyHyprRepo {
  /** Whether `~/.config/hypr` is still the retired `omarchy-hypr` git clone. */
  readonly present: boolean;
  /** Absolute path probed (`~/.config/hypr`). */
  readonly repoPath: string;
  /** The `origin` remote URL found, if any. */
  readonly remote: string;
}

/**
 * Detect whether `~/.config/hypr` is still the retired external Hypr clone.
 *
 * The Hypr config is now a stowed dotfiles package; a machine still tracking
 * {@link LEGACY_HYPR_REPO_SLUG} at `~/.config/hypr` must back it up before stow
 * can take over. Used by the doctor check and the `dot update` migration halt.
 */
export function detectLegacyHyprRepo(config: ConfigService): LegacyHyprRepo {
  const repoPath = hyprRepoPath(config);
  if (!isGitRepo(repoPath)) {
    return { present: false, repoPath, remote: "" };
  }
  const remote = gitRemoteOriginSync(repoPath);
  return {
    present: remote.includes(LEGACY_HYPR_REPO_SLUG),
    repoPath,
    remote,
  };
}

type HostLinkStatus =
  "missing" | "ok" | "repair" | "not-symlink" | "inspect-failed";

type HostLinkRequest =
  | { readonly status: "disabled" }
  | { readonly status: "skip"; readonly message: string }
  | {
      readonly status: "ensure";
      readonly host: string;
      readonly hostDir: string;
      readonly hostLink: string;
    };

type HostLinkAction =
  | { readonly kind: "create" }
  | { readonly kind: "repair" }
  | { readonly kind: "ok"; readonly message: string }
  | { readonly kind: "skip"; readonly message: string };

type HostLinkTarget =
  | { readonly status: "target"; readonly target: string }
  | { readonly status: "missing" | "not-symlink" | "inspect-failed" };

const hostLinkActions = {
  missing: () => ({ kind: "create" }),
  repair: () => ({ kind: "repair" }),
  ok: (request) => ({
    kind: "ok",
    message: `Hypr host link OK (${displayPath(request.hostLink)} -> hosts/${request.host})`,
  }),
  "not-symlink": (request) => ({
    kind: "skip",
    message: `Skipping Hypr host link (${displayPath(request.hostLink)} exists and is not a symlink)`,
  }),
  "inspect-failed": (request) => ({
    kind: "skip",
    message: `Skipping Hypr host link (could not inspect ${displayPath(request.hostLink)})`,
  }),
} satisfies Record<
  HostLinkStatus,
  (
    request: Extract<HostLinkRequest, { readonly status: "ensure" }>,
  ) => HostLinkAction
>;

function isMissingLinkError(cause: unknown): boolean {
  return cause instanceof Error && cause.message.includes("ENOENT");
}

function inspectErrorStatus(cause: unknown): HostLinkTarget {
  if (isMissingLinkError(cause)) return { status: "missing" };
  return { status: "inspect-failed" };
}

function readHostLinkTarget(hostLink: string): HostLinkTarget {
  try {
    const stat = lstatSync(hostLink);
    if (!stat.isSymbolicLink()) return { status: "not-symlink" };
    return {
      status: "target",
      target: resolveLinkTarget(hostLink, readlinkSync(hostLink)),
    };
  } catch (error) {
    return inspectErrorStatus(error);
  }
}

function inspectHostLink(hostLink: string, hostDir: string): HostLinkStatus {
  const link = readHostLinkTarget(hostLink);
  if (link.status !== "target") return link.status;
  return link.target === hostDir ? "ok" : "repair";
}

function requestedOmarchyHost(hostOverride?: string): string | null {
  return hostOverride?.trim() || currentOmarchyHost();
}

function hostLinkRequestForHost(
  config: ConfigService,
  host: string,
): HostLinkRequest {
  const repoPath = hyprRepoPath(config);
  const hostDir = join(repoPath, "hosts", host);

  return existsSync(hostDir)
    ? { status: "ensure", host, hostDir, hostLink: join(repoPath, "host") }
    : {
        status: "skip",
        message: `Skipping Hypr host link (missing ${displayPath(hostDir)})`,
      };
}

function hyprHostLinkRequest(
  config: ConfigService,
  hostOverride?: string,
): HostLinkRequest {
  if (!config.omarchy.enabled) return { status: "disabled" };

  const host = requestedOmarchyHost(hostOverride);
  if (!host) {
    return {
      status: "skip",
      message: "Skipping Hypr host link (OMARCHY_HOST is unset)",
    };
  }

  return hostLinkRequestForHost(config, host);
}

const updateHyprHostLink = (
  request: Extract<HostLinkRequest, { readonly status: "ensure" }>,
  log: Pick<OutputLogService, "info" | "warn">,
) =>
  Effect.gen(function* () {
    const action =
      hostLinkActions[inspectHostLink(request.hostLink, request.hostDir)](
        request,
      );

    if (action.kind === "ok") {
      yield* log.info(action.message);
      return;
    }

    if (action.kind === "skip") {
      yield* log.warn(action.message);
      return;
    }

    if (action.kind === "repair") {
      unlinkSync(request.hostLink);
    }

    symlinkSync(request.hostDir, request.hostLink, "dir");
    yield* log.info(
      `Hypr host link set (${displayPath(request.hostLink)} -> hosts/${request.host})`,
    );
  });

/** Path of the Hypr main config within both the hypr stow package and `~`. */
const HYPR_CONFIG_REL = join(".config", "hypr", "hyprland.lua");

/**
 * Spell a packaged file's symlink the way GNU Stow does: relative to the stow
 * target root (`~`), walking up to the root and back down through the stow
 * directory. Stow only treats a link as its own when the spelling matches
 * exactly, so a repaired link must reproduce this form rather than a
 * shortest-path or absolute link.
 */
function stowLinkContent(
  targetRoot: string,
  linkPath: string,
  sourceFile: string,
): string {
  return join(
    relative(dirname(linkPath), targetRoot),
    relative(targetRoot, sourceFile),
  );
}

/**
 * Atomically ensure `~/.config/hypr/hyprland.lua` is the stow-owned symlink
 * before the hypr package is stowed.
 *
 * Hyprland enables config autoreload by default and writes a default stub
 * config the instant the file goes missing. The previous unstow-then-restow
 * stow flow removed this link, so Hyprland regenerated a stub real file that
 * then blocked the restow. Replacing it through an atomic rename leaves no
 * missing-file window, so Hyprland never regenerates and stow accepts the link
 * as its own. A no-op when the link is already correct, or when the source or
 * live `~/.config/hypr` directory is absent (a fresh machine stows cleanly).
 */
export const ensureHyprConfigLink = (
  repoDir: string,
  log: Pick<OutputLogService, "info" | "warn">,
) =>
  Effect.gen(function* () {
    const home = homedir();
    const linkPath = join(home, HYPR_CONFIG_REL);
    const sourceFile = join(repoDir, "hypr", HYPR_CONFIG_REL);

    if (!existsSync(sourceFile)) return;
    if (!existsSync(dirname(linkPath))) return;

    const linkContent = stowLinkContent(home, linkPath, sourceFile);

    const currentLink = inspectLink(linkPath, linkContent);
    if (currentLink.type === "matching") return;
    if (currentLink.type === "unreadable") {
      yield* log.warn(
        `Skipping Hypr config link repair (could not inspect ${displayPath(linkPath)})`,
      );
      return;
    }

    const tmpLink = `${linkPath}.dot-${process.pid}`;
    removeIfPresent(tmpLink);
    symlinkSync(linkContent, tmpLink);
    renameSync(tmpLink, linkPath);
    yield* log.info(
      `Repaired Hypr config link (${displayPath(linkPath)} -> hyprland.lua)`,
    );
  });

interface LinkInspection {
  readonly type: "matching" | "different" | "missing" | "unreadable";
}

function inspectLink(
  linkPath: string,
  expectedContent: string,
): LinkInspection {
  try {
    const stat = lstatSync(linkPath);
    if (stat.isSymbolicLink() && readlinkSync(linkPath) === expectedContent) {
      return { type: "matching" };
    }
    return { type: "different" };
  } catch (error) {
    return isMissingLinkError(error)
      ? { type: "missing" }
      : { type: "unreadable" };
  }
}

function removeIfPresent(path: string): void {
  try {
    unlinkSync(path);
  } catch {
    // No stale temp link to clear.
  }
}

/** Create or repair the host-selected Hypr config symlink used by one-branch config. */
export const ensureHyprHostLink = (
  config: ConfigService,
  log: Pick<OutputLogService, "info" | "warn">,
  opts?: { readonly host?: string },
) =>
  Effect.gen(function* () {
    const request = hyprHostLinkRequest(config, opts?.host);
    if (request.status === "disabled") return;

    if (request.status === "skip") {
      yield* log.warn(request.message);
      return;
    }

    yield* updateHyprHostLink(request, log);
  });
