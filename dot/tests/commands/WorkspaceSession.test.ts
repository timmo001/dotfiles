import { describe, expect, test } from "bun:test";
import { decodeJson } from "../../src/lib/schema.js";
import {
  WorkspaceSessionError,
  decodeWorkspaceLaunchPolicy,
  decodeWorkspaceSession,
  expandWorkspacePolicyArg,
  renderWorkspaceLaunchCommand,
  restoreTargetForClient,
  type WorkspaceSessionClient,
} from "../../src/commands/WorkspaceSession.js";

const webapp: WorkspaceSessionClient = {
  address: "0x1",
  class: "chrome-example.com__app",
  initialClass: "",
  title: "Example",
  workspace: { id: 1 },
  browser_url: "https://example.com/?a=1&b=$(touch /tmp/injected)'quote",
};

describe("workspace session schemas", () => {
  test("accepts version 2 and pre-version captures", () => {
    const base = { active_workspace: {}, clients: [webapp] };
    expect(
      decodeWorkspaceSession(decodeJson({ version: 2, ...base })).version,
    ).toBe(2);
    expect(decodeWorkspaceSession(decodeJson(base)).version).toBeUndefined();
  });

  test("rejects unsupported versions and invalid workspace ids", () => {
    expect(() =>
      decodeWorkspaceSession(
        decodeJson({ version: 3, active_workspace: {}, clients: [] }),
      ),
    ).toThrow(WorkspaceSessionError);
    expect(() =>
      decodeWorkspaceSession(
        decodeJson({
          active_workspace: {},
          clients: [{ workspace: { id: 1.5 } }],
        }),
      ),
    ).toThrow("must be integers");
  });

  test("validates private launch rule regular expressions", () => {
    expect(() =>
      decodeWorkspaceLaunchPolicy(
        decodeJson({
          version: 1,
          launchRules: [
            {
              label: "Broken",
              matches: ["["],
              command: { executable: "false", args: [] },
            },
          ],
        }),
      ),
    ).toThrow("launch policy");
  });
});

describe("workspace restore launch commands", () => {
  test("keeps a hostile browser URL in one quoted argument", () => {
    const target = restoreTargetForClient(webapp, []);
    if (!target) throw new Error("Expected a webapp restore target");
    expect(target?.label).toBe("chrome-example.com__app (Example)");
    expect(renderWorkspaceLaunchCommand(target.command)).toBe(
      `omarchy-launch-webapp 'https://example.com/?a=1&b=$(touch /tmp/injected)'"'"'quote'`,
    );
  });

  test("prefers private class policy over generic webapp handling", () => {
    const rules = decodeWorkspaceLaunchPolicy(
      decodeJson({
        version: 1,
        launchRules: [
          {
            label: "Private browser",
            matches: ["^chrome-example\\.com__app$"],
            command: {
              executable: "browser",
              args: ["--profile", "Work Profile"],
            },
          },
        ],
      }),
    );
    const target = restoreTargetForClient(webapp, rules);
    if (!target) throw new Error("Expected a private restore target");
    expect(target?.label).toBe("Private browser");
    expect(renderWorkspaceLaunchCommand(target.command)).toBe(
      "browser --profile 'Work Profile'",
    );
  });

  test("separates captured classes from broader live-window matches", () => {
    const rules = decodeWorkspaceLaunchPolicy(
      decodeJson({
        version: 1,
        launchRules: [
          {
            label: "Work browser",
            matches: ["^work-browser$"],
            liveMatches: ["^work-browser$", "^google-chrome$"],
            command: { executable: "browser", args: [] },
          },
        ],
      }),
    );
    expect(
      restoreTargetForClient(
        { class: "google-chrome", workspace: { id: 1 } },
        rules,
      ),
    ).toBeUndefined();
    expect(
      restoreTargetForClient(
        { class: "work-browser", workspace: { id: 1 } },
        rules,
      )?.classPattern,
    ).toContain("google-chrome");
  });

  test("preserves hyphens in Twitch paths", () => {
    const target = restoreTargetForClient(
      {
        class: "changed-class",
        initialClass: "chrome-www.twitch.tv__some-channel-Default",
        workspace: { id: 1 },
      },
      [],
    );
    expect(target?.command.args).toEqual([
      "https://www.twitch.tv/some-channel",
    ]);
  });

  test("expands a home path after an option equals sign", () => {
    expect(expandWorkspacePolicyArg("--data=~/.config/browser")).toMatch(
      /^--data=\/home\/[^/]+\/\.config\/browser$/,
    );
  });

  test("uses argv-safe Ghostty working-directory arguments", () => {
    const target = restoreTargetForClient(
      {
        class: "com.mitchellh.ghostty",
        workspace: { id: 1 },
        process: { cwd: "/tmp" },
      },
      [],
    );
    expect(target?.command.args).toEqual([
      "app",
      "--",
      "ghostty-host-config",
      "--working-directory=/tmp",
    ]);
  });
});
