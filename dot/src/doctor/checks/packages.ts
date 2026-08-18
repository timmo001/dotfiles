import { Effect } from "effect";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { Config } from "../../services/Config.js";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { displayPath, expandHomePath } from "../../lib/paths.js";
import { ENV, envString } from "../../lib/env.js";
import {
  isPackageInstalled,
  loadPackageList,
  loadPackageLists,
} from "../../lib/archPackages.js";
import { resolvedOmarchyHost } from "../../lib/omarchyHost.js";
import type { ConfigService } from "../../services/Config.js";
import type { CheckResult } from "../types.js";
import {
  publicPackageRepoConfigMatches,
  publicPackageRepoIncludeRegistered,
  publicPacmanRepoConfigPath,
} from "../../commands/SetupPublicRepo.js";

const DEFAULT_PRIVATE_PACMAN_REPO_CONFIG = "/etc/pacman.d/timmo-private.conf";
const DEFAULT_PRIVATE_PACMAN_MAIN_CONFIG = "/etc/pacman.conf";

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

function readPrivatePackageRepoConfigLines(filePath: string): string[] | null {
  try {
    return readFileSync(filePath, "utf-8")
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"));
  } catch {
    return null;
  }
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
export function loadPrivatePackageRepoConfig(
  config: ConfigService,
): PrivatePackageRepoConfig | null {
  const repoConfigFile = privatePackageRepoConfigFile(config);

  if (!repoConfigFile || !existsSync(repoConfigFile)) return null;

  const draft: PrivatePackageRepoConfigDraft = {
    name: "",
    remote: null,
    path: "",
    mirrorPath: "",
    sigLevel: "Optional TrustAll",
  };

  const lines = readPrivatePackageRepoConfigLines(repoConfigFile);
  if (!lines) return null;

  for (const line of lines) {
    applyPrivatePackageRepoConfigLine(draft, line);
  }

  return completePrivatePackageRepoConfig(draft);
}

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
export function privatePackageRepoRegistered(
  repo: PrivatePackageRepoConfig,
): boolean {
  const configPath = privatePacmanRepoConfigPath();
  if (!existsSync(configPath)) return false;
  return readFileSync(configPath, "utf-8").includes(`[${repo.name}]`);
}

/** Whether the private repo snippet exactly matches the expected contents. */
export function privatePackageRepoConfigMatches(
  repo: PrivatePackageRepoConfig,
): boolean {
  const configPath = privatePacmanRepoConfigPath();
  if (!existsSync(configPath)) return false;
  const actual = readFileSync(configPath, "utf-8").trimEnd();
  return actual === privatePackageRepoConfigContents(repo).trimEnd();
}

/** Whether the main pacman config includes the private repo snippet. */
export function privatePackageRepoIncludeRegistered(): boolean {
  const mainConfigPath = privatePacmanMainConfigPath();
  if (!existsSync(mainConfigPath)) return false;
  return readFileSync(mainConfigPath, "utf-8")
    .split("\n")
    .some((line) => line.trim() === privatePackageRepoIncludeLine());
}

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

function privatePackageRepoStatusResult(
  repo: PrivatePackageRepoConfig,
): CheckResult | null {
  const checks: readonly {
    readonly when: boolean;
    readonly result: CheckResult;
  }[] = [
    {
      when: !existsSync(repo.mirrorPath),
      result: {
        severity: "warn",
        message: `Missing private package repo mirror: ${displayPath(repo.mirrorPath)}`,
        detail: "Run dot setup-private-repo to sync the mirror",
      },
    },
    {
      when: !privatePackageRepoRegistered(repo),
      result: {
        severity: "warn",
        message: `Private pacman repo is not configured in ${displayPath(
          privatePacmanRepoConfigPath(),
        )}`,
        detail: "Run dot setup-private-repo to configure it",
      },
    },
    {
      when: !privatePackageRepoIncludeRegistered(),
      result: {
        severity: "warn",
        message: `Private pacman repo include is missing from ${displayPath(
          privatePacmanMainConfigPath(),
        )}`,
        detail: "Run dot setup-private-repo to add it",
      },
    },
    {
      when: !privatePackageRepoConfigMatches(repo),
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
}

function privatePackageRepoResults(config: ConfigService): CheckResult[] {
  if (!config.canUsePrivate) {
    return [
      {
        severity: "warn",
        message: `Skipping private package repo checks (${config.privateReason})`,
      },
    ];
  }

  const repo = loadPrivatePackageRepoConfig(config);
  if (!repo) return [missingPrivatePackageRepoConfigResult(config)];

  const cloneResult = !existsSync(repo.path)
    ? [
        {
          severity: "warn" as const,
          message: `Missing private package repo clone: ${displayPath(repo.path)}`,
        },
      ]
    : [];
  const repoStatus = privatePackageRepoStatusResult(repo);
  if (repoStatus) return [...cloneResult, repoStatus];

  return [
    ...cloneResult,
    {
      severity: "ok",
      message: `Private pacman repo is configured (${displayPath(
        privatePacmanRepoConfigPath(),
      )})`,
    },
  ];
}

/** Human-facing package label, annotating aliased AUR names. */
function packageDisplayName(name: string): string {
  return name === "go-automate-git" ? "go-automate (go-automate-git)" : name;
}

/** Whether `vercmp` reports the installed version as older than the candidate. */
export function isInstalledVersionOlder(vercmpOutput: string): boolean {
  return Number.parseInt(vercmpOutput.trim(), 10) < 0;
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

/** Check public AUR packages are installed and up-to-date */
export const checkPublicPackages = Effect.gen(function* () {
  const config = yield* Config;
  const executor = yield* CommandExecutor;
  const results: CheckResult[] = [];
  const missingPackages: string[] = [];
  const updatePackages: string[] = [];

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

  for (const pkg of packages) {
    const display = packageDisplayName(pkg);

    if (!(yield* isPackageInstalled(pkg))) {
      results.push({ severity: "warn", message: `${display} is missing` });
      missingPackages.push(pkg);
      continue;
    }

    results.push({ severity: "ok", message: `${display} is installed` });

    // Version comparison (best effort)
    const installedVersion = yield* executor
      .run("bash", ["-c", `pacman -Q ${pkg} 2>/dev/null | awk '{ print $2 }'`])
      .pipe(Effect.catch(() => Effect.succeed("")));

    const hasYay = (yield* executor.exitCode("which", ["yay"])) === 0;
    if (hasYay) {
      const latestVersion = yield* executor
        .run("bash", [
          "-c",
          `yay -Si ${pkg} 2>/dev/null | grep '^Version' | awk '{ print $3 }'`,
        ])
        .pipe(Effect.catch(() => Effect.succeed("")));

      const iv = installedVersion.trim();
      const lv = latestVersion.trim();
      const comparison =
        iv && lv
          ? yield* executor
              .run("vercmp", [iv, lv])
              .pipe(Effect.catch(() => Effect.succeed("0")))
          : "0";
      if (isInstalledVersionOlder(comparison)) {
        results.push({
          severity: "warn",
          message: `${pkg} is older than latest AUR (${iv} installed, ${lv} latest)`,
        });
        updatePackages.push(pkg);
      }
    }
  }

  if (missingPackages.length > 0 || updatePackages.length > 0) {
    const combined = [...missingPackages, ...updatePackages];
    results.push({
      severity: "warn",
      message: `Install/update with: omarchy-pkg-aur-add ${combined.join(" ")}`,
    });
  }

  return results;
});

/** Check the signed public package repository configuration and trusted key. */
export const checkPublicPackageRepo = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const fingerprint = "F94469C08E3B717014E2815FA026A3671E9151DA";
  const results: CheckResult[] = [];

  if (!publicPackageRepoConfigMatches()) {
    results.push({
      severity: "warn",
      message: `Public pacman repo config is missing or differs from the signed configuration: ${displayPath(publicPacmanRepoConfigPath())}`,
      detail: "Run dot setup-public-repo to repair it",
    });
  } else if (!publicPackageRepoIncludeRegistered()) {
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
    .pipe(Effect.catch(() => Effect.succeed("")));
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
  return privatePackageRepoResults(config);
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

  if (!packagesFile || !existsSync(packagesFile)) {
    results.push({
      severity: "warn",
      message: `Missing private package list: ${displayPath(packagesFile ?? "")}`,
    });
    return results;
  }

  const host = resolvedOmarchyHost(config);
  const packages = loadPackageLists([
    packagesFile,
    ...(packagesOverride || !host ? [] : [`${packagesFile}--${host}`]),
  ]);
  if (packages.length === 0) {
    results.push({ severity: "ok", message: "No private packages configured" });
    return results;
  }

  const missingPackages: string[] = [];
  for (const pkg of packages) {
    if (yield* isPackageInstalled(pkg)) {
      results.push({ severity: "ok", message: `${pkg} is installed` });
    } else {
      results.push({ severity: "warn", message: `${pkg} is missing` });
      missingPackages.push(pkg);
    }
  }

  if (missingPackages.length > 0) {
    results.push({
      severity: "warn",
      message: `Install with: omarchy-pkg-aur-add ${missingPackages.join(" ")}`,
    });
  }

  return results;
});
