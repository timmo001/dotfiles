import { Effect } from "effect";
import { join } from "path";
import { pathExists, readTextOrNull } from "../../lib/fsProbe.js";
import { Config } from "../../services/Config.js";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { transientRemoteRetry } from "../../lib/git.js";
import { displayPath, expandHomePath } from "../../lib/paths.js";
import { ENV, envString } from "../../lib/env.js";
import {
  installedPackageCandidates,
  isPackageInstalled,
  loadPackageList,
  loadPackageLists,
} from "../../lib/archPackages.js";
import { resolvedOmarchyHost } from "../../lib/omarchyHost.js";
import { readListFile } from "../../lib/listFile.js";
import type { ConfigService } from "../../services/Config.js";
import type { CheckResult } from "../types.js";
import {
  publicPackageRepoConfigMatches,
  publicPackageRepoIncludeRegistered,
  publicPacmanRepoConfigPath,
} from "../../commands/SetupPublicRepo.js";

const DEFAULT_PRIVATE_PACMAN_REPO_CONFIG = "/etc/pacman.d/timmo-private.conf";

const DEFAULT_PRIVATE_PACMAN_MAIN_CONFIG = "/etc/pacman.conf";

const PUBLIC_PACKAGE_REPOSITORY = "timmo";

const PACKAGE_CHECK_CONCURRENCY = 8;

/** Private Arch package repository settings loaded from private dotfiles. */
export interface PrivatePackageRepoConfig {
  /** Pacman repository name, e.g. timmo-private. */
  readonly name: string;
  /** Optional GitHub repository to clone when the source path is missing. */
  readonly remote: string | null;
  /** Source repository containing package artifacts. */
  readonly path: string;
  /** Local mirror path served to pacman via file://. */
  readonly mirrorPath: string;
  /** Pacman SigLevel line value for this repository. */
  readonly sigLevel: string;
}

interface PrivatePackageRepoConfigDraft {
  name: string;
  remote: string | null;
  path: string;
  mirrorPath: string;
  sigLevel: string;
}

type PrivatePackageRepoConfigSetter = (
  draft: PrivatePackageRepoConfigDraft,
  value: string,
) => void;

const privatePackageRepoConfigSetters = {
  name: (draft, value) => {
    draft.name = value;
  },
  remote: (draft, value) => {
    draft.remote = value;
  },
  path: (draft, value) => {
    draft.path = expandHomePath(value);
  },
  mirror_path: (draft, value) => {
    draft.mirrorPath = expandHomePath(value);
  },
  siglevel: (draft, value) => {
    draft.sigLevel = value;
  },
} satisfies Readonly<Record<string, PrivatePackageRepoConfigSetter>>;

function privatePackageRepoConfigFile(config: ConfigService): string | null {
  return (
    envString(ENV.DOT_PRIVATE_PACKAGE_REPO_FILE) ??
    (config.privateDotfiles
      ? join(config.privateDotfiles, ".dot-private-package-repo")
      : null)
  );
}

function applyPrivatePackageRepoConfigLine(
  draft: PrivatePackageRepoConfigDraft,
  line: string,
): void {
  const eqIdx = line.indexOf("=");

  if (eqIdx < 0) return;

  const key = line.slice(0, eqIdx).trim();
  const value = line.slice(eqIdx + 1).trim();
  Object.entries(privatePackageRepoConfigSetters).find(
    ([name]) => name === key,
  )?.[1](draft, value);
}

function completePrivatePackageRepoConfig(
  draft: PrivatePackageRepoConfigDraft,
): PrivatePackageRepoConfig | null {
  if (!draft.name || !draft.path || !draft.mirrorPath) return null;

  return {
    name: draft.name,
    remote: draft.remote,
    path: draft.path,
    mirrorPath: draft.mirrorPath,
    sigLevel: draft.sigLevel,
  };
}

/** Path to the private pacman repository snippet. */
export function privatePacmanRepoConfigPath(): string {
  return (
    envString(ENV.DOT_PRIVATE_PACMAN_REPO_CONFIG) ??
    DEFAULT_PRIVATE_PACMAN_REPO_CONFIG
  );
}

/** Path to the main pacman configuration file. */
export function privatePacmanMainConfigPath(): string {
  return (
    envString(ENV.DOT_PRIVATE_PACMAN_MAIN_CONFIG) ??
    DEFAULT_PRIVATE_PACMAN_MAIN_CONFIG
  );
}

/** Load private pacman repo settings from the private dotfiles config file. */
export const loadPrivatePackageRepoConfig = Effect.fn(
  "Packages.loadPrivatePackageRepoConfig",
)(function* (config: ConfigService) {
  const repoConfigFile = privatePackageRepoConfigFile(config);

  if (!repoConfigFile || !(yield* pathExists(repoConfigFile))) return null;

  const draft: PrivatePackageRepoConfigDraft = {
    name: "",
    remote: null,
    path: "",
    mirrorPath: "",
    sigLevel: "Optional TrustAll",
  };

  const lines = readListFile(repoConfigFile);

  if (!lines) return null;

  for (const line of lines) {
    applyPrivatePackageRepoConfigLine(draft, line);
  }

  return completePrivatePackageRepoConfig(draft);
});

/** Expected contents for the private pacman repo snippet. */
export function privatePackageRepoConfigContents(
  repo: PrivatePackageRepoConfig,
): string {
  return `[${repo.name}]\nSigLevel = ${repo.sigLevel}\nServer = file://${repo.mirrorPath}\n`;
}

/** Include line that registers the private repo snippet with pacman. */
export function privatePackageRepoIncludeLine(): string {
  return `Include = ${privatePacmanRepoConfigPath()}`;
}

/** Whether the private repo snippet exists and declares the expected repo. */
export const privatePackageRepoRegistered = Effect.fn(
  "Packages.privatePackageRepoRegistered",
)(function* (repo: PrivatePackageRepoConfig) {
  const content = yield* readTextOrNull(privatePacmanRepoConfigPath());

  return content?.includes(`[${repo.name}]`) ?? false;
});

/** Whether the private repo snippet exactly matches the expected contents. */
export const privatePackageRepoConfigMatches = Effect.fn(
  "Packages.privatePackageRepoConfigMatches",
)(function* (repo: PrivatePackageRepoConfig) {
  const content = yield* readTextOrNull(privatePacmanRepoConfigPath());

  if (content === null) return false;

  return content.trimEnd() === privatePackageRepoConfigContents(repo).trimEnd();
});

/** Whether the main pacman config includes the private repo snippet. */
export const privatePackageRepoIncludeRegistered = Effect.fn(
  "Packages.privatePackageRepoIncludeRegistered",
)(function* () {
  const content = yield* readTextOrNull(privatePacmanMainConfigPath());

  if (content === null) return false;

  return content
    .split("\n")
    .some((line) => line.trim() === privatePackageRepoIncludeLine());
});

function missingPrivatePackageRepoConfigResult(
  config: ConfigService,
): CheckResult {
  return {
    severity: "warn",
    message: `Missing private package repo config: ${displayPath(
      privatePackageRepoConfigFile(config) ?? "",
    )}`,
  };
}

const privatePackageRepoStatusResult = Effect.fn(
  "Packages.privatePackageRepoStatusResult",
)(function* (repo: PrivatePackageRepoConfig) {
  const checks: readonly {
    readonly when: boolean;
    readonly result: CheckResult;
  }[] = [
    {
      when: !(yield* pathExists(repo.mirrorPath)),
      result: {
        severity: "warn",
        message: `Missing private package repo mirror: ${displayPath(repo.mirrorPath)}`,
        detail: "Run dot setup-private-repo to sync the mirror",
      },
    },
    {
      when: !(yield* privatePackageRepoRegistered(repo)),
      result: {
        severity: "warn",
        message: `Private pacman repo is not configured in ${displayPath(
          privatePacmanRepoConfigPath(),
        )}`,
        detail: "Run dot setup-private-repo to configure it",
      },
    },
    {
      when: !(yield* privatePackageRepoIncludeRegistered()),
      result: {
        severity: "warn",
        message: `Private pacman repo include is missing from ${displayPath(
          privatePacmanMainConfigPath(),
        )}`,
        detail: "Run dot setup-private-repo to add it",
      },
    },
    {
      when: !(yield* privatePackageRepoConfigMatches(repo)),
      result: {
        severity: "warn",
        message: `Private pacman repo config differs from expected contents: ${displayPath(
          privatePacmanRepoConfigPath(),
        )}`,
        detail: "Run dot setup-private-repo to rewrite it",
      },
    },
  ];

  return checks.find(({ when }) => when)?.result ?? null;
});

const privatePackageRepoResults = Effect.fn(
  "Packages.privatePackageRepoResults",
)(function* (config: ConfigService) {
  if (!config.canUsePrivate) {
    return [
      {
        severity: "warn",
        message: `Skipping private package repo checks (${config.privateReason})`,
      },
    ] satisfies CheckResult[];
  }

  const repo = yield* loadPrivatePackageRepoConfig(config);

  if (!repo)
    return [
      missingPrivatePackageRepoConfigResult(config),
    ] satisfies CheckResult[];

  const cloneResult: CheckResult[] = !(yield* pathExists(repo.path))
    ? [
        {
          severity: "warn",
          message: `Missing private package repo clone: ${displayPath(repo.path)}`,
        },
      ]
    : [];

  const repoStatus = yield* privatePackageRepoStatusResult(repo);

  if (repoStatus) return [...cloneResult, repoStatus];

  return [
    ...cloneResult,
    {
      severity: "ok",
      message: `Private pacman repo is configured (${displayPath(
        privatePacmanRepoConfigPath(),
      )})`,
    },
  ] satisfies CheckResult[];
});

/** Human-facing package label, annotating aliased AUR names. */
function packageDisplayName(name: string): string {
  return name === "go-automate-git" ? "go-automate (go-automate-git)" : name;
}

/** Whether `vercmp` reports the installed version as older than the candidate. */
export function isInstalledVersionOlder(vercmpOutput: string): boolean {
  return Number.parseInt(vercmpOutput.trim(), 10) < 0;
}

function packageVersionFromInfo(info: string): string | null {
  return info.match(/^Version\s*:\s*(\S+)/m)?.[1] ?? null;
}

function packageRepositoryFromInfo(info: string): string | null {
  return info.match(/^Repository\s*:\s*(\S+)/m)?.[1] ?? null;
}

function installedPackageVersion(packageName: string) {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;

    for (const candidate of installedPackageCandidates(packageName)) {
      const info = yield* executor
        .run("pacman", ["-Q", candidate])
        .pipe(Effect.orElseSucceed(() => ""));

      const version = info.trim().split(/\s+/)[1];

      if (version) return version;
    }

    return null;
  });
}

function repositoryPackageVersion(packageName: string, repository: string) {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;

    const info = yield* executor
      .run("pacman", ["-Si", `${repository}/${packageName}`])
      .pipe(Effect.orElseSucceed(() => ""));

    return packageVersionFromInfo(info);
  });
}

function syncPackageVersion(packageName: string) {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;

    const info = yield* executor
      .run("pacman", ["-Si", packageName])
      .pipe(Effect.orElseSucceed(() => ""));

    const repository = packageRepositoryFromInfo(info);
    const version = packageVersionFromInfo(info);

    return repository && version ? { repository, version } : null;
  });
}

/**
 * AUR RPC failures from yay worth another attempt, beside the shared
 * connection errors. Rate limiting (429) is left alone: the AUR limit is
 * daily, so retrying would only spend more of it.
 */
const TRANSIENT_AUR_ERROR =
  /no such host|i\/o timeout|tls handshake timeout|context deadline exceeded|unexpected eof|\b50[234]\b/i;

function aurPackageVersion(packageName: string) {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;

    const info = yield* executor.run("yay", ["-Si", "--aur", packageName]).pipe(
      Effect.retry(
        transientRemoteRetry<{ readonly stderr: string }>(
          (error) => error.stderr,
          TRANSIENT_AUR_ERROR,
        ),
      ),
      Effect.orElseSucceed(() => ""),
    );

    return packageVersionFromInfo(info);
  });
}

/** Return an outdated-package warning using pacman repositories before optional AUR fallback. */
export function packageUpdateResult(
  packageName: string,
  repository: string,
  sourceFallback: boolean,
) {
  return Effect.gen(function* () {
    const executor = yield* CommandExecutor;
    const installedVersion = yield* installedPackageVersion(packageName);

    const repositoryVersion = yield* repositoryPackageVersion(
      packageName,
      repository,
    );

    const syncPackage =
      !repositoryVersion && sourceFallback
        ? yield* syncPackageVersion(packageName)
        : null;

    const source = repositoryVersion
      ? repository
      : (syncPackage?.repository ?? (sourceFallback ? "AUR" : null));

    const latestVersion =
      repositoryVersion ??
      syncPackage?.version ??
      (sourceFallback ? yield* aurPackageVersion(packageName) : null);

    if (!installedVersion || !latestVersion || !source) return null;

    const comparison = yield* executor
      .run("vercmp", [installedVersion, latestVersion])
      .pipe(Effect.orElseSucceed(() => "0"));

    return isInstalledVersionOlder(comparison)
      ? {
          severity: "warn" as const,
          message: `${packageName} is older than ${source} (${installedVersion} installed, ${latestVersion} available)`,
        }
      : null;
  });
}

/** Whether GnuPG reports the expected key as valid and locally signed. */
export function publicPackageKeyTrusted(
  gpgOutput: string,
  fingerprint: string,
): boolean {
  const records = gpgOutput.split("\n").map((line) => line.split(":"));
  const publicKey = records.find(([type]) => type === "pub");
  const primaryFingerprint = records.find(([type]) => type === "fpr")?.[9];

  const hasLocalSignature = records.some(
    ([type, , , , , , , , , , signatureClass]) =>
      type === "sig" && signatureClass?.includes("l"),
  );

  return (
    (publicKey?.[1] === "f" || publicKey?.[1] === "u") &&
    primaryFingerprint === fingerprint &&
    hasLocalSignature
  );
}

/**
 * Report whether each package is installed and current, ending with one
 * install/update command for every missing or outdated package.
 */
function packageListResults<R>(
  packages: readonly string[],
  display: (pkg: string) => string,
  updateFor: (pkg: string) => Effect.Effect<CheckResult | null, never, R>,
) {
  return Effect.gen(function* () {
    const results: CheckResult[] = [];
    const pending: string[] = [];

    const checked = yield* Effect.forEach(
      packages,
      (pkg) =>
        Effect.gen(function* () {
          if (!(yield* isPackageInstalled(pkg)))
            return { pkg, installed: false, update: null };

          return { pkg, installed: true, update: yield* updateFor(pkg) };
        }),
      { concurrency: PACKAGE_CHECK_CONCURRENCY },
    );

    const updates: string[] = [];

    for (const { pkg, installed, update } of checked) {
      if (!installed) {
        results.push({
          severity: "warn",
          message: `${display(pkg)} is missing`,
        });
        pending.push(pkg);
        continue;
      }

      results.push({ severity: "ok", message: `${display(pkg)} is installed` });

      if (update) {
        results.push(update);
        updates.push(pkg);
      }
    }

    pending.push(...updates);

    if (pending.length > 0)
      results.push({
        severity: "warn",
        message: `Install/update with: omarchy-pkg-aur-add ${pending.join(" ")}`,
      });

    return results;
  });
}

/** Check public AUR packages are installed and up-to-date */
export const checkPublicPackages = Effect.gen(function* () {
  const config = yield* Config;
  const executor = yield* CommandExecutor;
  const results: CheckResult[] = [];

  const packagesFile =
    envString(ENV.DOT_PUBLIC_PACKAGES_FILE) ??
    join(config.publicDotfiles, ".dot-public-packages");

  const packages = loadPackageList(packagesFile);

  if (packages.length === 0) {
    results.push({
      severity: "warn",
      message: "Could not load public packages file",
    });

    return results;
  }

  const hasYay = (yield* executor.exitCode("which", ["yay"])) === 0;

  return yield* packageListResults(packages, packageDisplayName, (pkg) =>
    packageUpdateResult(pkg, PUBLIC_PACKAGE_REPOSITORY, hasYay),
  );
});

/** Check the signed public package repository configuration and trusted key. */
export const checkPublicPackageRepo = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const fingerprint = "F94469C08E3B717014E2815FA026A3671E9151DA";
  const results: CheckResult[] = [];

  if (!(yield* publicPackageRepoConfigMatches())) {
    results.push({
      severity: "warn",
      message: `Public pacman repo config is missing or differs from the signed configuration: ${displayPath(publicPacmanRepoConfigPath())}`,
      detail: "Run dot setup-public-repo to repair it",
    });
  } else if (!(yield* publicPackageRepoIncludeRegistered())) {
    results.push({
      severity: "warn",
      message:
        "Public pacman repo include is missing or ordered after another repository",
      detail: "Run dot setup-public-repo to repair it",
    });
  } else {
    results.push({
      severity: "ok",
      message: `Public pacman repo is configured (${displayPath(publicPacmanRepoConfigPath())})`,
    });
  }

  const keyDetails = yield* executor
    .run("gpg", [
      "--homedir",
      "/etc/pacman.d/gnupg",
      "--batch",
      "--with-colons",
      "--list-sigs",
      fingerprint,
    ])
    .pipe(Effect.orElseSucceed(() => ""));

  const keyTrusted = publicPackageKeyTrusted(keyDetails, fingerprint);
  results.push(
    keyTrusted
      ? { severity: "ok", message: "Public package signing key is trusted" }
      : {
          severity: "warn",
          message: "Public package signing key is not trusted",
          detail: "Run dot setup-public-repo to verify and trust it",
        },
  );

  return results;
});

/** Check private package repo configuration */
export const checkPrivatePackageRepo = Effect.gen(function* () {
  const config = yield* Config;

  return yield* privatePackageRepoResults(config);
});

/** Check private packages are installed */
export const checkPrivatePackages = Effect.gen(function* () {
  const config = yield* Config;
  const results: CheckResult[] = [];

  if (!config.canUsePrivate) {
    results.push({
      severity: "warn",
      message: `Skipping private package checks (${config.privateReason})`,
    });

    return results;
  }

  const packagesOverride = envString(ENV.DOT_PRIVATE_PACKAGES_FILE);

  const packagesFile =
    packagesOverride ??
    (config.privateDotfiles
      ? join(config.privateDotfiles, ".dot-private-packages")
      : null);

  if (!packagesFile || !(yield* pathExists(packagesFile))) {
    results.push({
      severity: "warn",
      message: `Missing private package list: ${displayPath(packagesFile ?? "")}`,
    });

    return results;
  }

  const host = yield* resolvedOmarchyHost(config);

  const packages = loadPackageLists([
    packagesFile,
    ...(packagesOverride || !host ? [] : [`${packagesFile}--${host}`]),
  ]);

  if (packages.length === 0) {
    results.push({ severity: "ok", message: "No private packages configured" });

    return results;
  }

  const repository = (yield* loadPrivatePackageRepoConfig(config))?.name;

  return yield* packageListResults(
    packages,
    (pkg) => pkg,
    (pkg) =>
      repository
        ? packageUpdateResult(pkg, repository, false)
        : Effect.succeed(null),
  );
});
