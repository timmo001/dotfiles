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
    expect(merged.bar.centerAnchor).toBe("timmo.clock");
    expect(merged.bar.position).toBe("top");
    expect(merged.bar.layout.center).toContainEqual({
      id: "timmo.clock",
      format: "HH:mm d MMM",
    });

    expect(merged.bar.layout.left[1]).toEqual({
      id: "timmo.workspaces",
      activeOpacity: 1,
      inactiveOpacity: 0.5,
    });
    expect(merged.bar.layout.left.at(-1)?.id).toBe("timmo.command");

    const centerIds = merged.bar.layout.center.map(({ id }) => id);
    expect(centerIds).not.toContain("omarchy.weather");
    expect(centerIds.indexOf("timmo.command")).toBeLessThan(
      centerIds.indexOf("omarchy.system-update"),
    );
    expect(merged.bar.layout.center.at(-1)).toMatchObject({
      id: "timmo.stream-command",
      revealOnHover: true,
    });
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
    expect(networkIndex).toBe(bluetoothIndex + 1);
    expect(merged.bar.layout.right[bluetoothIndex - 1]).toMatchObject({
      onClick: expect.stringContaining("weather.met_office"),
      hideClasses: ["temperature", "hidden"],
    });
    expect(merged.bar.layout.right[bluetoothIndex - 1]?.run).toEqual(
      expect.stringContaining("sensor.weather_station_outdoor_temperature"),
    );
    expect(merged.bar.layout.right[bluetoothIndex - 1]?.run).not.toEqual(
      expect.stringContaining("--icon-only"),
    );
    expect(rightIds).not.toContain("omarchy.weather");
    expect(merged.bar.layout.right).toContainEqual({ id: "omarchy.tray" });
    expect(merged.bar.layout.right).toContainEqual({
      id: "omarchy.agents",
      customAgentField: "preserved",
    });
    expect(
      customEntries(merged).every(
        (entry) =>
          entry.id === "timmo.workspaces" ||
          entry.id === "timmo.clock" ||
          entry.revealOnHover === true,
      ),
    ).toBe(true);
    expect(
      customEntries(merged).find(
        ({ run }) =>
          typeof run === "string" && run.startsWith("package-updates-bar"),
      ),
    ).toMatchObject({ hiddenText: "󰏗 0" });
  });

  test("selects desktop-specific sensors", () => {
    const merged = mergeOmarchyShellConfig(baseConfig(), "desktop");
    const runs = commandRuns([
      ...merged.bar.layout.center,
      ...merged.bar.layout.right,
    ]).join("\n");

    expect(runs).toContain("sensor.meter_d828_temperature");
    expect(runs).toContain("sensor.meter_d828_carbon_dioxide");
    expect(runs).toContain("ha-module-bar");
    expect(runs).toContain("dot git-diff --bar-json");
    expect(runs).toContain("dot git-notifications --bar-json");
    expect(runs).toContain("dot git-workflows --bar-json");
    expect(runs).toContain("package-updates-bar status");
    expect(runs).not.toContain("ha-bar-module");
    expect(runs).not.toContain("voc-alert");
    expect(runs).not.toContain("sensor.meter_plus_433c_temperature");
    expect(runs).not.toContain("--monitor");
    expect(runs).not.toContain("--workspace");
  });

  test("selects laptop-specific layout and sensors", () => {
    const merged = mergeOmarchyShellConfig(baseConfig(), "laptop");
    const runs = commandRuns([
      ...merged.bar.layout.center,
      ...merged.bar.layout.right,
    ]).join("\n");

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
    expect(runs).toContain("sensor.meter_plus_378b_temperature");
    expect(runs).toContain(
      "sensor.weather_station_outdoor_temperature --name 'Weather Station Outdoor Temperature' --icon 󰖙",
    );
    expect(runs).toContain("sensor.apollo_air_1_806d64_co2");
    expect(runs).toContain("voc-alert");
    expect(runs).toContain("sensor.meter_plus_433c_temperature");
    expect(runs).not.toContain("--monitor");
    expect(runs).not.toContain("--workspace");
  });
});
