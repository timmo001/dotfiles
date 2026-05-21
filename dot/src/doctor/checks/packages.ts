import { Effect } from "effect";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { Config } from "../../services/Config.js";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import type { CheckResult } from "../types.js";

const HOME = process.env.HOME ?? `/home/${process.env.USER}`;

function displayPath(p: string): string {
  return p.replace(HOME, "~");
}

/** Special package name alias handling (matches dot-lib) */
function resolvePackageName(name: string): { display: string; installed: string } {
  if (name === "go-automate-git") {
    return { display: "go-automate (go-automate-git)", installed: "go-automate-git" };
  }
  return { display: name, installed: name };
}

/** Load package list from a file (one per line, skip comments/blanks) */
function loadPackageList(filePath: string): string[] {
  try {
    if (!existsSync(filePath)) return [];
    return readFileSync(filePath, "utf-8")
      .split("\n")
      .map((l) => l.trim())
      .filter((l) => l && !l.startsWith("#"));
  } catch {
    return [];
  }
}

/** Check public AUR packages are installed and up-to-date */
export const checkPublicPackages = Effect.gen(function* () {
  const config = yield* Config;
  const executor = yield* CommandExecutor;
  const results: CheckResult[] = [];
  const missingPackages: string[] = [];
  const updatePackages: string[] = [];

  const packagesFile =
    process.env.DOT_PUBLIC_PACKAGES_FILE ??
    join(config.publicDotfiles, ".dot-public-packages");

  const packages = loadPackageList(packagesFile);
  if (packages.length === 0) {
    results.push({ severity: "warn", message: "Could not load public packages file" });
    return results;
  }

  for (const pkg of packages) {
    const { display, installed } = resolvePackageName(pkg);

    // Check if installed (try both names for aliased packages)
    const isInstalled = yield* executor.exitCode("pacman", ["-Q", installed]);
    const altInstalled = pkg !== installed
      ? yield* executor.exitCode("pacman", ["-Q", pkg])
      : isInstalled;

    if (isInstalled !== 0 && altInstalled !== 0) {
      results.push({ severity: "warn", message: `${display} is missing` });
      missingPackages.push(pkg);
      continue;
    }

    results.push({ severity: "ok", message: `${display} is installed` });

    // Version comparison (best effort)
    const installedVersion = yield* executor
      .run("bash", ["-c", `pacman -Q ${installed} 2>/dev/null | awk '{ print $2 }'`])
      .pipe(Effect.catch(() => Effect.succeed("")));

    const hasYay = (yield* executor.exitCode("which", ["yay"])) === 0;
    if (hasYay) {
      const latestVersion = yield* executor
        .run("bash", ["-c", `yay -Si ${pkg} 2>/dev/null | grep '^Version' | awk '{ print $3 }'`])
        .pipe(Effect.catch(() => Effect.succeed("")));

      const iv = installedVersion.trim();
      const lv = latestVersion.trim();
      if (iv && lv && iv !== lv) {
        results.push({
          severity: "warn",
          message: `${pkg} version differs from latest AUR (${iv} installed, ${lv} latest)`,
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

/** Check private package repo configuration */
export const checkPrivatePackageRepo = Effect.gen(function* () {
  const config = yield* Config;
  const executor = yield* CommandExecutor;
  const results: CheckResult[] = [];

  if (!config.canUsePrivate) {
    results.push({ severity: "warn", message: `Skipping private package repo checks (${config.privateReason})` });
    return results;
  }

  // Check for private package repo config
  const repoConfigFile =
    process.env.DOT_PRIVATE_PACKAGE_REPO_FILE ??
    (config.privateDotfiles ? join(config.privateDotfiles, ".dot-private-package-repo") : null);

  if (!repoConfigFile || !existsSync(repoConfigFile)) {
    results.push({
      severity: "warn",
      message: `Missing private package repo config: ${displayPath(repoConfigFile ?? "")}`,
    });
    return results;
  }

  // Parse config: first line is repo path, second is mirror
  let repoPath = "";
  let mirrorPath = "";
  try {
    const lines = readFileSync(repoConfigFile, "utf-8").split("\n").filter((l) => l.trim());
    repoPath = (lines[0] ?? "").trim().replace(/^~/, HOME);
    mirrorPath = (lines[1] ?? "").trim().replace(/^~/, HOME);
  } catch { /* ignore */ }

  if (repoPath && !existsSync(repoPath)) {
    results.push({ severity: "warn", message: `Missing private package repo clone: ${displayPath(repoPath)}` });
  }

  if (mirrorPath && !existsSync(mirrorPath)) {
    results.push({
      severity: "warn",
      message: `Missing private package repo mirror: ${displayPath(mirrorPath)}`,
      detail: "Run dot setup-private-repo to sync the mirror",
    });
  } else if (mirrorPath) {
    results.push({ severity: "ok", message: `Private pacman repo is configured` });
  }

  return results;
});

/** Check private packages are installed */
export const checkPrivatePackages = Effect.gen(function* () {
  const config = yield* Config;
  const executor = yield* CommandExecutor;
  const results: CheckResult[] = [];

  if (!config.canUsePrivate) {
    results.push({ severity: "warn", message: `Skipping private package checks (${config.privateReason})` });
    return results;
  }

  const packagesFile =
    process.env.DOT_PRIVATE_PACKAGES_FILE ??
    (config.privateDotfiles ? join(config.privateDotfiles, ".dot-private-packages") : null);

  if (!packagesFile || !existsSync(packagesFile)) {
    results.push({ severity: "warn", message: `Missing private package list: ${displayPath(packagesFile ?? "")}` });
    return results;
  }

  const packages = loadPackageList(packagesFile);
  if (packages.length === 0) {
    results.push({ severity: "ok", message: "No private packages configured" });
    return results;
  }

  const missingPackages: string[] = [];
  for (const pkg of packages) {
    const isInstalled = yield* executor.exitCode("pacman", ["-Q", pkg]);
    if (isInstalled === 0) {
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
