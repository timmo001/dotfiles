import { describe, expect, test } from "bun:test";
import { createTestRenderer } from "@opentui/core/testing";
import { Effect } from "effect";
import { DiffView } from "../../../src/git/tui/DiffView.js";
import { loadTheme } from "../../../src/theme.js";

describe("DiffView filtering", () => {
  test("filters only the active pane by repo name or path", async () => {
    const setup = await createTestRenderer({
      width: 100,
      height: 30,
      kittyKeyboard: true,
    });
    const view = new DiffView(
      setup.renderer,
      await Effect.runPromise(loadTheme),
      {
        onSelect: () => undefined,
        onOpenEditor: async () => undefined,
        onOpenOpencode: async () => undefined,
        onOpenTerminal: () => undefined,
        onOpenWeb: () => undefined,
        onRefresh: () => undefined,
        onBack: () => undefined,
      },
    );

    try {
      view.setVisible(true);
      view.update({
        changed: [
          {
            name: "dotfiles",
            path: "/home/test/.config/dotfiles",
            locked: false,
          },
          { name: "notes", path: "/home/test/repos/notes", locked: false },
        ],
        unchanged: [
          { name: "skills", path: "/home/test/repos/skills", locked: false },
        ],
        lastChecked: new Date(),
      });

      setup.mockInput.pressKey("/");
      await setup.mockInput.typeText(".config");
      await setup.renderOnce();

      const filtered = setup.captureCharFrame();
      expect(filtered).toContain("Filter Changed: .config");
      expect(filtered).toContain("dotfiles");
      expect(filtered).not.toContain("notes");
      expect(filtered).toContain("skills");

      setup.mockInput.pressEscape();
      await setup.renderOnce();

      const cleared = setup.captureCharFrame();
      expect(cleared).not.toContain("Filter Changed:");
      expect(cleared).toContain("notes");

      setup.mockInput.pressKey("/");
      await setup.mockInput.typeText("notes");
      setup.mockInput.pressEnter();
      await setup.renderOnce();
      expect(setup.captureCharFrame()).toContain("Changed filter: notes");

      setup.mockInput.pressBackspace();
      await setup.renderOnce();
      expect(setup.captureCharFrame()).not.toContain("Changed filter:");
    } finally {
      view.destroy();
      setup.renderer.destroy();
    }
  });
});
