import { Effect } from "effect";
import { existsSync, readFileSync } from "fs";
import { join, basename } from "path";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import type { CheckResult } from "../types.js";

const HOME = process.env.HOME ?? `/home/${process.env.USER}`;

function displayPath(p: string): string {
  return p.replace(HOME, "~");
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
    }
  }

  // VAAPI driver env
  const currentVaapiDriver = process.env.LIBVA_DRIVER_NAME ?? "auto";
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
    { name: "Chromium", wrapper: join(HOME, ".local", "bin", "chromium") },
    {
      name: "Chrome",
      wrapper: join(HOME, ".local", "bin", "google-chrome-stable"),
    },
  ];

  for (const { name, wrapper } of browsers) {
    if (existsSync(wrapper)) {
      try {
        const content = readFileSync(wrapper, "utf-8");
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
      } catch {
        /* ignore */
      }
    }
  }

  // Check flags.conf for video decode features
  const flagsFiles: Array<{ name: string; path: string }> = [
    { name: "chromium", path: join(HOME, ".config", "chromium-flags.conf") },
    { name: "chrome", path: join(HOME, ".config", "chrome-flags.conf") },
  ];

  for (const { name, path } of flagsFiles) {
    if (existsSync(path)) {
      try {
        const content = readFileSync(path, "utf-8");
        if (
          /AcceleratedVideoDecodeLinuxGL|VaapiVideoDecodeLinuxGL/.test(content)
        ) {
          results.push({
            severity: "ok",
            message: `${name}-flags.conf has hardware video decode feature flag enabled`,
          });
        } else {
          results.push({
            severity: "warn",
            message: `${name}-flags.conf missing hardware video decode feature flag`,
            detail: "AcceleratedVideoDecodeLinuxGL or VaapiVideoDecodeLinuxGL",
          });
        }
      } catch {
        /* ignore */
      }
    }
  }

  // Check required VAAPI packages
  const libvaExit = yield* executor.exitCode("pacman", ["-Qi", "libva"]);
  if (libvaExit !== 0) {
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
    const pkgExit = yield* executor.exitCode("pacman", ["-Qi", pkg]);
    if (pkgExit === 0) {
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

  return results;
});
