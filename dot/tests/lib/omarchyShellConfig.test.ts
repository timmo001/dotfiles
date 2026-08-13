import { describe, expect, test } from "bun:test";
import { mergeOmarchyShellConfig } from "../../src/lib/omarchyShellConfig.js";

function baseConfig() {
  return {
    version: 1,
    custom: { preserved: true },
    bar: {
      id: "omarchy.bar",
      position: "top",
      customBarField: "preserved",
      layout: {
        left: [
          { id: "custom.left" },
          { id: "omarchy.workspaces", persistent: true },
        ],
        center: [
          { id: "omarchy.clock", format: "HH:mm" },
          { id: "omarchy.weather", location: "home" },
          { id: "omarchy.system-update" },
          { id: "custom.center" },
        ],
        right: [
          { id: "custom.right" },
          { id: "omarchy.tray" },
          { id: "omarchy.agents", customAgentField: "preserved" },
          { id: "omarchy.bluetooth" },
          { id: "omarchy.network" },
        ],
      },
    },
  };
}

function commandRuns(
  entries: ReadonlyArray<{ readonly id: string; readonly run?: unknown }>,
): string[] {
  return entries.flatMap((entry) =>
    typeof entry.run === "string" ? [entry.run] : [],
  );
}

function customEntries(config: ReturnType<typeof mergeOmarchyShellConfig>) {
  return [
    ...config.bar.layout.left,
    ...config.bar.layout.center,
    ...config.bar.layout.right,
  ].filter(({ id }) => id.startsWith("timmo."));
}

describe("mergeOmarchyShellConfig", () => {
  test("preserves defaults while placing personal widgets around their anchors", () => {
    const base = baseConfig();
    const merged = mergeOmarchyShellConfig(base, "desktop");

    expect(merged).toBe(base);
    expect(merged.custom).toEqual({ preserved: true });
    expect(merged.idle).toEqual({ screensaver: 1800, lock: 3600 });
    expect(merged.bar.customBarField).toBe("preserved");
    expect(merged.bar.id).toBe("omarchy.bar");
    expect(merged.bar.centerAnchor).toBe("");
    expect(merged.bar.position).toBe("top");
    expect(merged.bar.layout.center).not.toContainEqual({
      id: "timmo.clock",
      format: "HH:mm d MMM",
    });
    expect(merged.bar.layout.right.at(-1)).toEqual({
      id: "timmo.clock",
      format: "HH:mm d MMM",
    });

    expect(merged.bar.layout.left[1]).toEqual({
      id: "timmo.workspaces",
      activeOpacity: 1,
      inactiveOpacity: 0.5,
    });
    expect(merged.bar.layout.left.at(-1)?.id).toBe("timmo.workspaces");

    const centerIds = merged.bar.layout.center.map(({ id }) => id);
    expect(centerIds).not.toContain("omarchy.weather");
    expect(centerIds.indexOf("timmo.twitch")).toBe(
      centerIds.indexOf("omarchy.keyboard-layout") + 1,
    );
    const twitchIndex = centerIds.indexOf("timmo.twitch");
    expect(merged.bar.layout.center[twitchIndex + 1]?.run).toBe(
      "dot git-diff --bar-json",
    );
    const systemUpdateIndex = centerIds.indexOf("omarchy.system-update");
    expect(merged.bar.layout.center[systemUpdateIndex - 1]?.run).toBe(
      "package-updates-bar status",
    );
    expect(centerIds.indexOf("timmo.command")).toBeLessThan(
      centerIds.indexOf("omarchy.system-update"),
    );
    expect(
      merged.bar.layout.center
        .filter(({ id }) => id.startsWith("timmo."))
        .every(
          (entry) => entry.id === "timmo.clock" || entry.revealOnHover === true,
        ),
    ).toBe(true);

    const rightIds = merged.bar.layout.right.map(({ id }) => id);
    const bluetoothIndex = rightIds.indexOf("omarchy.bluetooth");
    const networkIndex = rightIds.indexOf("omarchy.network");
    const trayIndex = rightIds.indexOf("omarchy.tray");
    expect(networkIndex).toBe(bluetoothIndex + 1);
    expect(rightIds).not.toContain("omarchy.agents");
    expect(merged.bar.layout.right[0]).toEqual({
      id: "timmo.home-assistant",
      host: "desktop",
    });
    expect(trayIndex).toBeGreaterThan(0);
    expect(rightIds).not.toContain("omarchy.weather");
    expect(merged.bar.layout.right).toContainEqual({ id: "omarchy.tray" });
    expect(
      customEntries(merged).every(
        (entry) =>
          entry.id === "timmo.workspaces" ||
          entry.id === "timmo.clock" ||
          entry.id === "timmo.home-assistant" ||
          entry.revealOnHover === true,
      ),
    ).toBe(true);
    expect(
      customEntries(merged).find(
        ({ run }) =>
          typeof run === "string" && run.startsWith("package-updates-bar"),
      ),
    ).toMatchObject({ hiddenText: "󰏗 0", revealColor: "#e5c07b" });
    expect(merged.bar.layout.center).toContainEqual({
      id: "timmo.twitch",
      revealOnHover: true,
    });
    expect(commandRuns(merged.bar.layout.center)).not.toContain(
      "twitch-notifications --status-bar-json --max-chars 60",
    );
  });

  test("selects the desktop Home Assistant dashboard", () => {
    const merged = mergeOmarchyShellConfig(baseConfig(), "desktop");
    const entries = [
      ...merged.bar.layout.left,
      ...merged.bar.layout.center,
      ...merged.bar.layout.right,
    ];
    const runs = commandRuns(entries).join("\n");

    expect(entries.filter(({ id }) => id === "timmo.home-assistant")).toEqual([
      { id: "timmo.home-assistant", host: "desktop" },
    ]);
    expect(runs).not.toContain("ha-module-bar");
    expect(runs).not.toContain("ha-watch-singleton");
    expect(runs).toContain("dot git-diff --bar-json");
    expect(runs).toContain("dot git-notifications --bar-json");
    expect(runs).not.toContain("dot git-workflows");
    expect(runs).toContain("package-updates-bar status");
    expect(runs).not.toContain("ha-bar-module");
    expect(runs).not.toContain("--monitor");
    expect(runs).not.toContain("--workspace");
  });

  test("selects the laptop Home Assistant dashboard", () => {
    const merged = mergeOmarchyShellConfig(baseConfig(), "laptop");
    const entries = [
      ...merged.bar.layout.left,
      ...merged.bar.layout.center,
      ...merged.bar.layout.right,
    ];
    const runs = commandRuns(entries).join("\n");

    expect(merged.bar.position).toBe("bottom");
    expect(merged.bar.centerAnchor).toBe("");
    expect(merged.idle).toEqual({ screensaver: 150, lock: 300 });
    expect(merged.bar.layout.center.map(({ id }) => id)).not.toContain(
      "timmo.clock",
    );
    expect(merged.bar.layout.right.at(-1)).toEqual({
      id: "timmo.clock",
      format: "HH:mm d MMM",
    });
    expect(entries.filter(({ id }) => id === "timmo.home-assistant")).toEqual([
      { id: "timmo.home-assistant", host: "laptop" },
    ]);
    expect(runs).not.toContain("ha-module-bar");
    expect(runs).not.toContain("ha-watch-singleton");
    expect(runs).not.toContain("--monitor");
    expect(runs).not.toContain("--workspace");
  });
});
