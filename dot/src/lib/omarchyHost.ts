import { Effect } from "effect";
import {
  existsSync,
  lstatSync,
  readlinkSync,
  symlinkSync,
  unlinkSync,
} from "fs";
import { dirname, join, resolve } from "path";
import type { ConfigService } from "../services/Config.js";
import type { OutputLogService } from "../services/OutputLog.js";

const HOME = process.env.HOME ?? `/home/${process.env.USER}`;

/** Display an absolute path relative to the user's home directory when possible. */
export function displayPath(path: string): string {
  return path.replace(HOME, "~");
}

/** Resolve a symlink target exactly as the filesystem would from the link path. */
export function resolveLinkTarget(linkPath: string, target: string): string {
  return target.startsWith("/") ? target : resolve(dirname(linkPath), target);
}

/** Return the currently requested Omarchy host, if configured. */
export function currentOmarchyHost(): string | null {
  const host = process.env.OMARCHY_HOST?.trim();
  return host ? host : null;
}

/** Return the base Hypr repository path from the Omarchy repo config. */
export function hyprRepoPath(config: ConfigService): string {
  return join(config.omarchy.repoBase, "hypr");
}

type HostLinkStatus =
  | "missing"
  | "ok"
  | "repair"
  | "not-symlink"
  | "inspect-failed";

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

const hostLinkActions: Record<
  HostLinkStatus,
  (
    request: Extract<HostLinkRequest, { readonly status: "ensure" }>,
  ) => HostLinkAction
> = {
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
};

function isMissingLinkError(error: unknown): boolean {
  return error instanceof Error && error.message.includes("ENOENT");
}

function inspectErrorStatus(error: unknown): HostLinkTarget {
  if (isMissingLinkError(error)) return { status: "missing" };
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
