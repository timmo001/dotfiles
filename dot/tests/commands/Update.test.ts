import { describe, expect, test } from "bun:test";
import { herdrLazyPluginRoot } from "../../src/commands/Update.js";

describe("herdrLazyPluginRoot", () => {
  test("returns the installed Herdr Lazy plugin root", () => {
    expect(
      herdrLazyPluginRoot(
        JSON.stringify({
          result: {
            plugins: [
              { plugin_id: "other", plugin_root: "/plugins/other" },
              {
                plugin_id: "herdr-lazy",
                plugin_root: "/plugins/herdr-lazy",
              },
            ],
          },
        }),
      ),
    ).toBe("/plugins/herdr-lazy");
  });

  test("returns null for missing or malformed plugin data", () => {
    expect(herdrLazyPluginRoot("not json")).toBeNull();
    expect(herdrLazyPluginRoot('{"result":{"plugins":[]}}')).toBeNull();
    expect(
      herdrLazyPluginRoot(
        '{"result":{"plugins":[{"plugin_id":"herdr-lazy"}]}}',
      ),
    ).toBeNull();
  });
});
