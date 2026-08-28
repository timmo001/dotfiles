import { afterEach, describe, expect, test } from "bun:test";
import {
  existsSync,
  lstatSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { decodeJson } from "../../src/lib/schema.js";
import {
  WorkspaceRelayoutError,
  assignLayoutWindows,
  buildLayoutBatch,
  captureLayoutTree,
  decodeLayoutTree,
  decodePresets,
  describeLayoutTree,
  layoutOperations,
  savePresetsAtomically,
  type LayoutTree,
  type LayoutWindow,
} from "../../src/commands/WorkspaceRelayout.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const topBottom: LayoutTree = {
  dir: "tb",
  ratio: 75.29,
  a: "w",
  b: "w",
};

const windows: readonly LayoutWindow[] = [
  { address: "0x1", at: [0, 0], size: [1000, 750] },
  { address: "0x2", at: [0, 750], size: [1000, 250] },
];

describe("workspace relayout trees", () => {
  test("captures the existing two-window ratio", () => {
    expect(captureLayoutTree(windows)).toEqual({
      dir: "tb",
      ratio: 75,
      a: "w",
      b: "w",
    });
  });

  test("rejects malformed and mismatched presets", () => {
    expect(() =>
      decodeLayoutTree({ dir: "lr", ratio: 0, a: "w", b: "w" }),
    ).toThrow(WorkspaceRelayoutError);
    expect(() =>
      decodePresets(
        decodeJson({
          version: 3,
          layouts: {
            3: [{ group: "Rows", name: "Two", tree: topBottom }],
          },
        }),
      ),
    ).toThrow("must have 3 leaves");
  });

  test("generates operations in parent-first build order", () => {
    const tree: LayoutTree = {
      dir: "tb",
      ratio: 60,
      a: "w",
      b: { dir: "lr", ratio: 40, a: "w", b: "w" },
    };
    expect(layoutOperations(tree)).toEqual([
      { dir: "tb", ratio: 60, anchor: 0, next: 1 },
      { dir: "lr", ratio: 40, anchor: 1, next: 2 },
    ]);
    expect(describeLayoutTree(tree)).toBe("1 top / 2 bottom");
  });

  test("keeps windows nearest their target leaves", () => {
    expect(assignLayoutWindows(topBottom, [...windows].reverse())).toEqual([
      "0x1",
      "0x2",
    ]);
  });

  test("builds one checked Hyprland batch with exact split ratios and focus restore", () => {
    const batch = buildLayoutBatch(topBottom, ["0x1", "0x2"], 1, 99, "0x1");
    expect(batch).toContain(
      'dispatch hl.dsp.layout("preselect d") ; dispatch hl.dsp.window.move',
    );
    expect(batch).toContain(
      'dispatch hl.dsp.layout("splitratio 1.5058 exact")',
    );
    expect(batch).toEndWith(
      'dispatch hl.dsp.focus({ window = "address:0x1" })',
    );
  });
});

describe("workspace relayout presets", () => {
  test("writes atomically through a stowed symlink", () => {
    const root = mkdtempSync(join(tmpdir(), "workspace-relayout-"));
    roots.push(root);
    const target = join(root, "presets-target.json");
    const link = join(root, "presets.json");
    writeFileSync(target, "old\n");
    symlinkSync(target, link);

    const presets = decodePresets(
      decodeJson({
        version: 3,
        layouts: {
          2: [{ group: "Top / bottom", name: "75% top", tree: topBottom }],
        },
      }),
    );
    savePresetsAtomically(link, presets);

    expect(lstatSync(link).isSymbolicLink()).toBe(true);
    expect(JSON.parse(readFileSync(target, "utf8"))).toEqual(presets);
    expect(existsSync(link)).toBe(true);
  });
});
