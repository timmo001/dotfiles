import { describe, expect, test } from "bun:test";
import { resolve } from "node:path";
import {
  generatedArtifactForPath,
  generatedArtifactFromPatch,
  generatedArtifactFromShell,
} from "../../agents/.config/opencode/lib/generated-artifacts";

const root = "/tmp/dotfiles";
const generatedDocs = "docs/src/content/docs/reference/plugins.md";

describe("generated artefact paths", () => {
  test("matches exact relative and absolute generated paths", () => {
    expect(generatedArtifactForPath(root, generatedDocs)?.command).toBe(
      "mise run docs:gen:opencode",
    );
    expect(
      generatedArtifactForPath(root, resolve(root, generatedDocs))?.command,
    ).toBe("mise run docs:gen:opencode");
    expect(
      generatedArtifactForPath(root, `docs/../${generatedDocs}`)?.command,
    ).toBe("mise run docs:gen:opencode");
  });

  test("allows source files, siblings, and paths outside the repository", () => {
    expect(
      generatedArtifactForPath(
        root,
        "agents/.config/opencode/plugins/generated-artifact-guard.ts",
      ),
    ).toBeUndefined();
    expect(
      generatedArtifactForPath(root, `${generatedDocs}.backup`),
    ).toBeUndefined();
    expect(
      generatedArtifactForPath(root, "/tmp/elsewhere/docs/public/og.png"),
    ).toBeUndefined();
  });

  test("resolves paths from a nested tool workdir", () => {
    expect(
      generatedArtifactForPath(
        root,
        "src/content/docs/reference/plugins.md",
        resolve(root, "docs"),
      )?.path,
    ).toBe(generatedDocs);
  });
});

describe("apply_patch mutations", () => {
  test.each(["Add", "Delete", "Update"])("blocks %s operations", (action) => {
    const patch = `*** Begin Patch\n*** ${action} File: ${generatedDocs}\n*** End Patch`;
    expect(generatedArtifactFromPatch(root, patch)?.path).toBe(generatedDocs);
  });

  test("blocks protected move destinations in multi-file patches", () => {
    const patch = `*** Begin Patch
*** Update File: source.md
*** Move to: ${generatedDocs}
*** Update File: unrelated.md
*** End Patch`;
    expect(generatedArtifactFromPatch(root, patch)?.path).toBe(generatedDocs);
  });

  test("resolves patch paths from a nested tool workdir", () => {
    const patch = `*** Begin Patch
*** Update File: src/content/docs/reference/plugins.md
*** End Patch`;
    expect(
      generatedArtifactFromPatch(root, patch, resolve(root, "docs"))?.path,
    ).toBe(generatedDocs);
  });
});

describe("shell mutations", () => {
  test.each([
    `rm ${generatedDocs}`,
    `cp replacement ${generatedDocs}`,
    `sed -i s/a/b/ ${generatedDocs}`,
    `printf content > ${generatedDocs}`,
    `printf content | tee ${generatedDocs}`,
    `python -c 'open("${generatedDocs}", "w").write("x")'`,
    `git restore ${generatedDocs}`,
  ])("blocks %s", (command) => {
    expect(generatedArtifactFromShell(root, command)?.path).toBe(generatedDocs);
  });

  test("allows reads, generators, and unrelated mutations", () => {
    expect(
      generatedArtifactFromShell(root, `rg pattern ${generatedDocs}`),
    ).toBeUndefined();
    expect(
      generatedArtifactFromShell(root, "mise run docs:gen:opencode"),
    ).toBeUndefined();
    expect(
      generatedArtifactFromShell(root, "rm docs/src/content/docs/ordinary.md"),
    ).toBeUndefined();
    expect(
      generatedArtifactFromShell(
        root,
        `rm /tmp/unrelated; rg pattern ${generatedDocs}`,
      ),
    ).toBeUndefined();
  });

  test("resolves shell paths from a nested tool workdir", () => {
    expect(
      generatedArtifactFromShell(
        root,
        "rm src/content/docs/reference/plugins.md",
        resolve(root, "docs"),
      )?.path,
    ).toBe(generatedDocs);
  });
});
