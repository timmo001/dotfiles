import { Effect, FileSystem, Match, PlatformError } from "effect";
import { cliStyler } from "./ansi.js";
import { homedir } from "os";
import { dirname, join, relative, resolve } from "path";

import type { ConfigService } from "../services/Config.js";
import type { OutputLogService } from "../services/OutputLog.js";
import { gitRemoteOrigin, isGitRepo } from "./git.js";
import { pathExists, readLinkOrNull } from "./fsProbe.js";
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
export const currentHyprHostLink = Effect.fn("OmarchyHost.currentHyprHostLink")(
  function* (config: ConfigService) {
    const hostLink = join(hyprRepoPath(config), "host");
    const linkTarget = yield* readLinkOrNull(hostLink);

    if (linkTarget === null) return null;
    const target = resolveLinkTarget(hostLink, linkTarget);
    const host = relative(join(hyprRepoPath(config), "hosts"), target);

    return host && !host.startsWith("..") && !host.includes("/") ? host : null;
  },
);

/** Resolve the active Omarchy host from the session env, then the Hypr host link. */
export const resolvedOmarchyHost = Effect.fn("OmarchyHost.resolvedOmarchyHost")(
  function* (config: ConfigService) {
    return currentOmarchyHost() ?? (yield* currentHyprHostLink(config));
  },
);

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
export const detectLegacyHyprRepo = Effect.fn(
  "OmarchyHost.detectLegacyHyprRepo",
)(function* (config: ConfigService) {
  const repoPath = hyprRepoPath(config);

  if (!(yield* isGitRepo(repoPath))) {
    return { present: false, repoPath, remote: "" } satisfies LegacyHyprRepo;
  }

  const remote = yield* gitRemoteOrigin(repoPath);

  return {
    present: remote.includes(LEGACY_HYPR_REPO_SLUG),
    repoPath,
    remote,
  } satisfies LegacyHyprRepo;
});

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

type LinkReadFailure = "missing" | "not-symlink" | "inspect-failed";

const linkInspectionTypeByFailure = {
  missing: "missing",
  "not-symlink": "different",
  "inspect-failed": "unreadable",
} as const satisfies Record<LinkReadFailure, LinkInspection["type"]>;

const readLinkFailureStatus = Effect.fn("OmarchyHost.readLinkFailureStatus")(
  function* (linkPath: string, error: PlatformError.PlatformError) {
    const known = Match.value(error.reason._tag).pipe(
      Match.when("NotFound", () => "missing" as const),
      Match.when("PermissionDenied", () => "inspect-failed" as const),
      Match.orElse(() => undefined),
    );

    if (known) return known;

    const fallback: LinkReadFailure = (yield* pathExists(linkPath))
      ? "not-symlink"
      : "inspect-failed";

    return fallback;
  },
);

const readHostLinkTarget = Effect.fn("OmarchyHost.readHostLinkTarget")(
  function* (hostLink: string) {
    const fs = yield* FileSystem.FileSystem;

    return yield* fs.readLink(hostLink).pipe(
      Effect.map((target): HostLinkTarget => ({
        status: "target",
        target: resolveLinkTarget(hostLink, target),
      })),
      Effect.catch((error) =>
        readLinkFailureStatus(hostLink, error).pipe(
          Effect.map((status): HostLinkTarget => ({ status })),
        ),
      ),
    );
  },
);

const inspectHostLink = Effect.fn("OmarchyHost.inspectHostLink")(function* (
  hostLink: string,
  hostDir: string,
) {
  const link = yield* readHostLinkTarget(hostLink);

  if (link.status !== "target") return link.status;

  return link.target === hostDir ? "ok" : "repair";
});

function requestedOmarchyHost(hostOverride?: string): string | null {
  return hostOverride?.trim() || currentOmarchyHost();
}

const hostLinkRequestForHost = Effect.fn("OmarchyHost.hostLinkRequestForHost")(
  function* (config: ConfigService, host: string) {
    const repoPath = hyprRepoPath(config);
    const hostDir = join(repoPath, "hosts", host);

    return (yield* pathExists(hostDir))
      ? ({
          status: "ensure",
          host,
          hostDir,
          hostLink: join(repoPath, "host"),
        } satisfies HostLinkRequest)
      : ({
          status: "skip",
          message: `Skipping Hypr host link (missing ${displayPath(hostDir)})`,
        } satisfies HostLinkRequest);
  },
);

const hyprHostLinkRequest = Effect.fn("OmarchyHost.hyprHostLinkRequest")(
  function* (config: ConfigService, hostOverride?: string) {
    if (!config.omarchy.enabled) {
      return { status: "disabled" } satisfies HostLinkRequest;
    }

    const host = requestedOmarchyHost(hostOverride);

    if (!host) {
      return {
        status: "skip",
        message: "Skipping Hypr host link (OMARCHY_HOST is unset)",
      } satisfies HostLinkRequest;
    }

    return yield* hostLinkRequestForHost(config, host);
  },
);

const updateHyprHostLink = (
  request: Extract<HostLinkRequest, { readonly status: "ensure" }>,
  log: Pick<OutputLogService, "info" | "success" | "warn">,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;

    const action =
      hostLinkActions[
        yield* inspectHostLink(request.hostLink, request.hostDir)
      ](request);

    if (action.kind === "ok") {
      yield* log.info(cliStyler().dim(action.message));

      return;
    }

    if (action.kind === "skip") {
      yield* log.warn(action.message);

      return;
    }

    if (action.kind === "repair") {
      yield* fs.remove(request.hostLink).pipe(Effect.orDie);
    }

    yield* fs.symlink(request.hostDir, request.hostLink).pipe(Effect.orDie);
    yield* log.success(
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
  log: Pick<OutputLogService, "info" | "success" | "warn">,
) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem;
    const home = homedir();
    const linkPath = join(home, HYPR_CONFIG_REL);
    const sourceFile = join(repoDir, "hypr", HYPR_CONFIG_REL);

    if (!(yield* pathExists(sourceFile))) return;

    if (!(yield* pathExists(dirname(linkPath)))) return;

    const linkContent = stowLinkContent(home, linkPath, sourceFile);

    const currentLink = yield* inspectLink(linkPath, linkContent);

    if (currentLink.type === "matching") return;

    if (currentLink.type === "unreadable") {
      yield* log.warn(
        `Skipping Hypr config link repair (could not inspect ${displayPath(linkPath)})`,
      );

      return;
    }

    const tmpLink = `${linkPath}.dot-${process.pid}`;
    yield* fs.remove(tmpLink).pipe(Effect.ignore);
    yield* fs.symlink(linkContent, tmpLink).pipe(Effect.orDie);
    yield* fs.rename(tmpLink, linkPath).pipe(Effect.orDie);
    yield* log.success(
      `Repaired Hypr config link (${displayPath(linkPath)} -> hyprland.lua)`,
    );
  });

interface LinkInspection {
  readonly type: "matching" | "different" | "missing" | "unreadable";
}

const inspectLink = Effect.fn("OmarchyHost.inspectLink")(function* (
  linkPath: string,
  expectedContent: string,
) {
  const fs = yield* FileSystem.FileSystem;

  return yield* fs.readLink(linkPath).pipe(
    Effect.map((content): LinkInspection => ({
      type: content === expectedContent ? "matching" : "different",
    })),
    Effect.catch((error) =>
      readLinkFailureStatus(linkPath, error).pipe(
        Effect.map((status): LinkInspection => ({
          type: linkInspectionTypeByFailure[status],
        })),
      ),
    ),
  );
});

/** Create or repair the host-selected Hypr config symlink used by one-branch config. */
export const ensureHyprHostLink = (
  config: ConfigService,
  log: Pick<OutputLogService, "info" | "success" | "warn">,
  opts?: { readonly host?: string },
) =>
  Effect.gen(function* () {
    const request = yield* hyprHostLinkRequest(config, opts?.host);

    if (request.status === "disabled") return;

    if (request.status === "skip") {
      yield* log.warn(request.message);

      return;
    }

    yield* updateHyprHostLink(request, log);
  });
