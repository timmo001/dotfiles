import { describe, expect, test } from "bun:test";
import { enabledHerdrPluginIds } from "../../../src/doctor/checks/herdr.js";

describe("enabledHerdrPluginIds", () => {
  test("returns only enabled plugin IDs", () => {
    expect(
      enabledHerdrPluginIds(
        JSON.stringify({
          result: {
            plugins: [
              { plugin_id: "dotfiles.terminal-title", enabled: true },
              { plugin_id: "dotfiles.yazi", enabled: false },
              { enabled: true },
            ],
          },
        }),
      ),
    ).toEqual(new Set(["dotfiles.terminal-title"]));
  });

  test("returns an empty set for malformed plugin data", () => {
    expect(enabledHerdrPluginIds("not json")).toEqual(new Set());
    expect(enabledHerdrPluginIds('{"result":{"plugins":{}}}')).toEqual(
      new Set(),
    );
  });
});
