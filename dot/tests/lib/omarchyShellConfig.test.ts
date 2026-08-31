import { describe, expect, test } from "bun:test";
import { Schema } from "effect";
import {
  mergeOmarchyShellConfig,
  parseManagedPlugins,
} from "../../src/lib/omarchyShellConfig.js";

const managedPlugins = {
  remove: ["omarchy.weather", "omarchy.agents"],
  plugins: [
    {
      id: "timmo.workspaces",
      replace: "omarchy.workspaces",
      inheritSettings: false,
      placement: { section: "left" as const, index: 1 },
      settings: { activeOpacity: 1, inactiveOpacity: 0.5 },
    },
    {
      id: "timmo.twitch",
      placement: {
        section: "center" as const,
        after: "omarchy.keyboard-layout",
      },
      settings: { revealOnHover: true, primaryOnly: true },
      hosts: {
        desktop: { primaryOutput: "HDMI-A-2" },
        laptop: { primaryOutput: "eDP-1" },
      },
    },
    {
      id: "timmo.git",
      placement: { section: "center" as const, after: "timmo.twitch" },
      settings: { revealOnHover: true, primaryOnly: true },
      hosts: {
        desktop: { primaryOutput: "HDMI-A-2" },
        laptop: { primaryOutput: "eDP-1" },
      },
    },
    {
      id: "timmo.command",
      placement: { section: "center" as const, after: "timmo.git" },
      settings: {
        revealOnHover: true,
        primaryOnly: true,
        run: "package-updates-bar status",
        hiddenText: "󰏗 0",
        revealColor: "#e5c07b",
      },
      hosts: {
        desktop: { primaryOutput: "HDMI-A-2" },
        laptop: { primaryOutput: "eDP-1" },
      },
    },
    {
      id: "timmo.home-assistant",
      placement: { section: "right" as const, index: 0 },
      settings: { primaryOnly: true },
      hosts: {
        desktop: { host: "desktop", primaryOutput: "HDMI-A-2" },
        laptop: { host: "laptop", primaryOutput: "eDP-1" },
      },
    },
    {
      id: "timmo.system-bridge",
      placement: {
        section: "right" as const,
        after: "timmo.home-assistant",
      },
      settings: { primaryOnly: true },
      hosts: {
        desktop: { primaryOutput: "HDMI-A-2" },
        laptop: { primaryOutput: "eDP-1" },
      },
    },
    {
      id: "timmo.notes",
      placement: {
        section: "right" as const,
        after: "timmo.system-bridge",
      },
      settings: { primaryOnly: true },
      hosts: {
        desktop: { primaryOutput: "HDMI-A-2" },
        laptop: { primaryOutput: "eDP-1" },
      },
    },
    {
      id: "timmo.momentumctl",
      managed: true,
    },
    {
      id: "timmo.clock",
      replace: "omarchy.clock",
      placement: { section: "right" as const },
      settings: { format: "HH:mm d MMM" },
    },
  ],
};

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
          { id: "omarchy.keyboard-layout" },
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
  entries: ReadonlyArray<{ readonly id: string; readonly run?: string }>,
): string[] {
  return entries.flatMap((entry) => (entry.run ? [entry.run] : []));
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
    const merged = mergeOmarchyShellConfig(base, "desktop", managedPlugins);

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
    expect(merged.bar.layout.center[twitchIndex + 1]?.id).toBe("timmo.git");
    expect(centerIds.filter((id) => id === "timmo.git")).toHaveLength(1);
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
      primaryOnly: true,
      primaryOutput: "HDMI-A-2",
    });
    expect(rightIds.slice(0, 3)).toEqual([
      "timmo.home-assistant",
      "timmo.system-bridge",
      "timmo.notes",
    ]);
    expect(merged.bar.layout.right.slice(1, 3)).toEqual([
      {
        id: "timmo.system-bridge",
        primaryOnly: true,
        primaryOutput: "HDMI-A-2",
      },
      {
        id: "timmo.notes",
        primaryOnly: true,
        primaryOutput: "HDMI-A-2",
      },
    ]);
    expect(trayIndex).toBeGreaterThan(0);
    expect(rightIds).not.toContain("omarchy.weather");
    expect(merged.bar.layout.right).toContainEqual({ id: "omarchy.tray" });
    expect(merged.plugins).toEqual([{ id: "timmo.momentumctl" }]);
    expect(
      customEntries(merged).every(
        (entry) =>
          entry.id === "timmo.workspaces" ||
          entry.id === "timmo.clock" ||
          entry.id === "timmo.home-assistant" ||
          entry.id === "timmo.system-bridge" ||
          entry.id === "timmo.notes" ||
          entry.revealOnHover === true,
      ),
    ).toBe(true);
    expect(
      customEntries(merged).find(
        ({ run }) =>
          Schema.is(Schema.String)(run) &&
          run.startsWith("package-updates-bar"),
      ),
    ).toMatchObject({ hiddenText: "󰏗 0", revealColor: "#e5c07b" });
    expect(merged.bar.layout.center).toContainEqual({
      id: "timmo.twitch",
      revealOnHover: true,
      primaryOnly: true,
      primaryOutput: "HDMI-A-2",
    });
    expect(merged.bar.layout.center).toContainEqual({
      id: "timmo.git",
      revealOnHover: true,
      primaryOnly: true,
      primaryOutput: "HDMI-A-2",
    });
    expect(
      customEntries(merged)
        .filter(({ id }) => id !== "timmo.workspaces" && id !== "timmo.clock")
        .every(
          (entry) =>
            entry.primaryOnly === true && entry.primaryOutput === "HDMI-A-2",
        ),
    ).toBe(true);
    expect(commandRuns(merged.bar.layout.center)).not.toContain(
      "twitch-notifications --status-bar-json --max-chars 60",
    );
  });

  test("selects the desktop Home Assistant dashboard", () => {
    const merged = mergeOmarchyShellConfig(
      baseConfig(),
      "desktop",
      managedPlugins,
    );
    const entries = [
      ...merged.bar.layout.left,
      ...merged.bar.layout.center,
      ...merged.bar.layout.right,
    ];
    const runs = commandRuns(entries).join("\n");

    expect(entries.filter(({ id }) => id === "timmo.home-assistant")).toEqual([
      {
        id: "timmo.home-assistant",
        host: "desktop",
        primaryOnly: true,
        primaryOutput: "HDMI-A-2",
      },
    ]);
    expect(runs).not.toContain("ha-module-bar");
    expect(runs).not.toContain("ha-watch-singleton");
    expect(runs).not.toContain("dot git-diff --bar-json");
    expect(runs).not.toContain("dot git-notifications --bar-json");
    expect(runs).not.toContain("dot git-workflows");
    expect(runs).toContain("package-updates-bar status");
    expect(runs).not.toContain("ha-bar-module");
    expect(runs).not.toContain("--monitor");
    expect(runs).not.toContain("--workspace");
  });

  test("selects the laptop Home Assistant dashboard", () => {
    const merged = mergeOmarchyShellConfig(
      baseConfig(),
      "laptop",
      managedPlugins,
    );
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
      {
        id: "timmo.home-assistant",
        host: "laptop",
        primaryOnly: true,
        primaryOutput: "eDP-1",
      },
    ]);
    expect(entries.filter(({ id }) => id === "timmo.git")).toEqual([
      {
        id: "timmo.git",
        revealOnHover: true,
        primaryOnly: true,
        primaryOutput: "eDP-1",
      },
    ]);
    expect(entries.filter(({ id }) => id === "timmo.system-bridge")).toEqual([
      {
        id: "timmo.system-bridge",
        primaryOnly: true,
        primaryOutput: "eDP-1",
      },
    ]);
    expect(entries.filter(({ id }) => id === "timmo.notes")).toEqual([
      {
        id: "timmo.notes",
        primaryOnly: true,
        primaryOutput: "eDP-1",
      },
    ]);
    expect(
      customEntries(merged)
        .filter(({ id }) => id !== "timmo.workspaces" && id !== "timmo.clock")
        .every(
          (entry) =>
            entry.primaryOnly === true && entry.primaryOutput === "eDP-1",
        ),
    ).toBe(true);
    expect(runs).not.toContain("ha-module-bar");
    expect(runs).not.toContain("ha-watch-singleton");
    expect(runs).not.toContain("--monitor");
    expect(runs).not.toContain("--workspace");
  });

  test("places managed plugins by neighbour and replaces existing instances", () => {
    const base = baseConfig();
    base.bar.layout.left.push({ id: "example.remote", persistent: true });
    const merged = mergeOmarchyShellConfig(base, "desktop", {
      ...managedPlugins,
      plugins: [
        ...managedPlugins.plugins,
        {
          id: "example.remote",
          managed: true,
          placement: {
            section: "right" as const,
            after: "timmo.home-assistant",
          },
        },
      ],
    });
    const allIds = [
      ...merged.bar.layout.left,
      ...merged.bar.layout.center,
      ...merged.bar.layout.right,
    ].map(({ id }) => id);

    expect(allIds.filter((id) => id === "example.remote")).toHaveLength(1);
    expect(merged.bar.layout.right[1]?.id).toBe("example.remote");
    expect(merged.bar.layout.right[1]?.persistent).toBe(true);
    expect(merged.bar.layout.right.slice(0, 5).map(({ id }) => id)).toEqual([
      "timmo.home-assistant",
      "example.remote",
      "timmo.system-bridge",
      "timmo.notes",
      "custom.right",
    ]);
  });
});

describe("parseManagedPlugins", () => {
  test("accepts neighbour and index placements", () => {
    expect(
      parseManagedPlugins({
        remove: [],
        plugins: [
          {
            id: "example.after",
            placement: { section: "right", after: "omarchy.tray" },
          },
          {
            id: "example.index",
            placement: { section: "left", index: 0 },
          },
        ],
      }),
    ).toEqual({
      remove: [],
      plugins: [
        {
          id: "example.after",
          placement: { section: "right", after: "omarchy.tray" },
        },
        {
          id: "example.index",
          placement: { section: "left", index: 0 },
        },
      ],
    });
  });

  test("accepts a managed non-widget plugin without placement", () => {
    expect(
      parseManagedPlugins({
        remove: [],
        plugins: [{ id: "example.panel", managed: true }],
      }),
    ).toEqual({
      remove: [],
      plugins: [{ id: "example.panel", managed: true }],
    });
  });

  test("rejects bar settings without placement", () => {
    expect(
      parseManagedPlugins({
        remove: [],
        plugins: [{ id: "example.panel", settings: { primaryOnly: true } }],
      }),
    ).toBeNull();
  });

  test("rejects ambiguous placements", () => {
    expect(
      parseManagedPlugins({
        remove: [],
        plugins: [
          {
            id: "example.invalid",
            placement: {
              section: "right",
              before: "omarchy.tray",
              after: "omarchy.network",
            },
          },
        ],
      }),
    ).toBeNull();
  });

  test("rejects unsafe and duplicate plugin ids", () => {
    expect(
      parseManagedPlugins({
        remove: [],
        plugins: [{ id: "../unsafe", placement: { section: "right" } }],
      }),
    ).toBeNull();
    expect(
      parseManagedPlugins({
        remove: [],
        plugins: [
          { id: "duplicate", placement: { section: "left" } },
          { id: "duplicate", placement: { section: "right" } },
        ],
      }),
    ).toBeNull();
  });
});
