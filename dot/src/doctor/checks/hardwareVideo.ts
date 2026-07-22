import { Effect } from "effect";
import { existsSync, readFileSync } from "fs";
import { join, basename } from "path";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import { CONFIG_DIR, HOME_DIR, displayPath } from "../../lib/paths.js";
import { ENV, envString } from "../../lib/env.js";
import { isPackageInstalled } from "../../lib/archPackages.js";
import type { CheckResult } from "../types.js";

const obsoleteVideoFeatures = ["VaapiVideoDecodeLinuxGL", "VaapiVideoEncoder"];

const acceleratedVideoFeatures = [
  "AcceleratedVideoDecoder",
  "AcceleratedVideoDecodeLinuxGL",
  "AcceleratedVideoDecodeLinuxZeroCopyGL",
];

/** Assess browser flags that override Chromium's hardware video defaults. */
export function browserVideoFlagResults(
  name: string,
  content: string,
): CheckResult[] {
  const results: CheckResult[] = [];
  const flags = content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("--"));
  const obsolete = obsoleteVideoFeatures.filter((feature) =>
    flags.some((flag) => flag.includes(feature)),
  );
  const disabledFeatures = flags
    .filter((flag) => flag.startsWith("--disable-features="))
    .flatMap((flag) => flag.slice("--disable-features=".length).split(","))
    .map((feature) => feature.trim())
    .filter((feature) => acceleratedVideoFeatures.includes(feature));

  if (obsolete.length > 0) {
    results.push({
      severity: "warn",
      message: `${name}-flags.conf has obsolete video feature overrides`,
      detail: obsolete.join(", "),
    });
  }

  if (
    flags.includes("--disable-accelerated-video-decode") ||
    flags.includes("--disable-gpu") ||
    flags.includes("--disable-gpu-compositing") ||
    disabledFeatures.length > 0
  ) {
    const disabledFlag = flags.find((flag) =>
      [
        "--disable-accelerated-video-decode",
        "--disable-gpu",
        "--disable-gpu-compositing",
      ].includes(flag),
    );
    results.push({
      severity: "warn",
      message: `${name}-flags.conf disables hardware video acceleration`,
      detail:
        disabledFeatures.length > 0
          ? disabledFeatures.join(", ")
          : (disabledFlag ?? "hardware video acceleration"),
    });
  }

  if (flags.includes("--ignore-gpu-blocklist")) {
    results.push({
      severity: "warn",
      message: `${name}-flags.conf bypasses Chromium's GPU blocklist`,
      detail: "Remove --ignore-gpu-blocklist unless it is needed for diagnosis",
    });
  }

  if (results.length === 0) {
    results.push({
      severity: "ok",
      message: `${name}-flags.conf has no harmful hardware video overrides`,
    });
  }

  return results;
}

/** Check VAAPI hardware video decode support */
export const checkHardwareVideo = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const results: CheckResult[] = [];

  // Check for vainfo
  const hasVainfo = (yield* executor.exitCode("which", ["vainfo"])) === 0;
  if (!hasVainfo) {
    results.push({
      severity: "warn",
      message: "vainfo is missing \u2014 install libva-utils to diagnose VAAPI",
    });
  }

  // Identify render nodes and their drivers
  const renderNodesOutput = yield* executor
    .run("bash", ["-c", "ls -d /sys/class/drm/renderD* 2>/dev/null || true"])
    .pipe(Effect.catch(() => Effect.succeed("")));

  let vaapiDriverExpected = "";
  let hasNvidiaNode = false;
  for (const nodePath of renderNodesOutput.trim().split("\n").filter(Boolean)) {
    const driverLink = join(nodePath, "device", "driver");
    if (!existsSync(driverLink)) continue;

    const driverResult = yield* executor
      .run("readlink", ["-f", driverLink])
      .pipe(Effect.catch(() => Effect.succeed("")));
    const driverName = basename(driverResult.trim());
    const nodeName = basename(nodePath);

    results.push({ severity: "ok", message: `${nodeName} -> ${driverName}` });

    switch (driverName) {
      case "i915":
      case "xe":
        vaapiDriverExpected = "iHD";
        break;
      case "amdgpu":
        vaapiDriverExpected = "radeonsi";
        break;
      case "nvidia":
        hasNvidiaNode = true;
        break;
    }
  }

  // VAAPI driver env
  const currentVaapiDriver = envString(ENV.LIBVA_DRIVER_NAME) ?? "auto";
  results.push({
    severity: "ok",
    message: `LIBVA_DRIVER_NAME=${currentVaapiDriver} (session default)`,
  });

  // Test VAAPI on render nodes (only if vainfo available)
  if (hasVainfo) {
    const devNodesOutput = yield* executor
      .run("bash", ["-c", "ls /dev/dri/renderD* 2>/dev/null || true"])
      .pipe(Effect.catch(() => Effect.succeed("")));

    let vaapiWorking = false;
    for (const renderNode of devNodesOutput
      .trim()
      .split("\n")
      .filter(Boolean)) {
      const nodeName = basename(renderNode);
      const sysNode = join("/sys/class/drm", nodeName);

      // Determine per-node driver
      let renderDriverName = "";
      const driverLink = join(sysNode, "device", "driver");
      if (existsSync(driverLink)) {
        const driverResult = yield* executor
          .run("readlink", ["-f", driverLink])
          .pipe(Effect.catch(() => Effect.succeed("")));
        renderDriverName = basename(driverResult.trim());
      }

      let renderVaapiDriver = "";
      switch (renderDriverName) {
        case "i915":
        case "xe":
          renderVaapiDriver = "iHD";
          break;
        case "amdgpu":
          renderVaapiDriver = "radeonsi";
          break;
        case "nvidia":
          renderVaapiDriver = "nvidia";
          break;
      }

      const driverLabel = renderVaapiDriver || currentVaapiDriver || "auto";
      const envPrefix = renderVaapiDriver
        ? `LIBVA_DRIVER_NAME="${renderVaapiDriver}" `
        : "";
      const vainfoResult = yield* executor
        .run("bash", [
          "-c",
          `${envPrefix}vainfo --display drm --device ${renderNode} 2>&1`,
        ])
        .pipe(Effect.catch(() => Effect.succeed("")));

      if (!vainfoResult.trim()) {
        results.push({
          severity: "warn",
          message: `${nodeName}: vainfo failed with LIBVA_DRIVER_NAME=${driverLabel}`,
        });
        continue;
      }

      const driverMatch = vainfoResult.match(/Driver version: (.+)/);
      const profileCount = (vainfoResult.match(/VAEntrypoint/g) ?? []).length;

      if (driverMatch) {
        results.push({
          severity: "ok",
          message: `${nodeName}: ${driverMatch[1]} (${profileCount} profiles, LIBVA_DRIVER_NAME=${driverLabel})`,
        });
        vaapiWorking = true;
      } else {
        results.push({
          severity: "warn",
          message: `${nodeName}: vainfo failed with LIBVA_DRIVER_NAME=${driverLabel}`,
        });
      }
    }

    if (!vaapiWorking) {
      results.push({
        severity: "error",
        message: "No working VAAPI driver found on any render node",
      });
    }
  }

  // Check browser wrappers
  const browsers: Array<{ name: string; wrapper: string }> = [
    { name: "Chromium", wrapper: join(HOME_DIR, ".local", "bin", "chromium") },
    {
      name: "Chrome",
      wrapper: join(HOME_DIR, ".local", "bin", "google-chrome-stable"),
    },
  ];

  for (const { name, wrapper } of browsers) {
    if (existsSync(wrapper)) {
      const content = readTextFile(wrapper);
      if (content !== null) {
        const driverMatch = content.match(
          /^\s*export\s+LIBVA_DRIVER_NAME=(\S+)/m,
        );
        if (driverMatch) {
          results.push({
            severity: "ok",
            message: `${name} wrapper overrides LIBVA_DRIVER_NAME=${driverMatch[1]}`,
          });
        }
        if (content.includes("__EGL_VENDOR_LIBRARY_FILENAMES")) {
          results.push({
            severity: "ok",
            message: `${name} wrapper forces Mesa EGL (hybrid GPU fix)`,
          });
        }
      }
    }
  }

  // Check flags.conf for overrides to Chromium's video defaults
  const flagsFiles: Array<{ name: string; path: string }> = [
    { name: "chromium", path: join(CONFIG_DIR, "chromium-flags.conf") },
    { name: "chrome", path: join(CONFIG_DIR, "chrome-flags.conf") },
  ];

  for (const { name, path } of flagsFiles) {
    if (existsSync(path)) {
      const content = readTextFile(path);
      if (content !== null) {
        results.push(...browserVideoFlagResults(name, content));
      }
    }
  }

  // Check required VAAPI packages
  if (!(yield* isPackageInstalled("libva"))) {
    results.push({
      severity: "error",
      message: "libva is not installed (required for VAAPI)",
    });
  }

  let hasVaapiDriverPkg = false;
  for (const pkg of [
    "intel-media-driver",
    "libva-intel-driver",
    "libva-nvidia-driver",
    "libva-mesa-driver",
  ]) {
    if (yield* isPackageInstalled(pkg)) {
      results.push({ severity: "ok", message: `${pkg} is installed` });
      hasVaapiDriverPkg = true;
    }
  }
  if (!hasVaapiDriverPkg) {
    results.push({
      severity: "error",
      message:
        "No VAAPI driver package installed (need intel-media-driver, libva-mesa-driver, or similar)",
    });
  }

  // On NVIDIA hybrid setups the dGPU render node only exposes VAAPI through the
  // VAAPI->NVDEC shim, which lives in libva-nvidia-driver.
  if (hasNvidiaNode) {
    if (!(yield* isPackageInstalled("libva-nvidia-driver"))) {
      results.push({
        severity: "warn",
        message:
          "libva-nvidia-driver is not installed (needed for NVIDIA VAAPI/NVDEC)",
        detail: "Install with: pacman -S libva-nvidia-driver",
      });
    }
  }

  return results;
});

function readTextFile(path: string): string | null {
  try {
    return readFileSync(path, "utf-8");
  } catch {
    return null;
  }
}
