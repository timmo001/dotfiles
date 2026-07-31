import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { browserExtensionResults } from "../../../src/doctor/checks/browserExtensions.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function profileWithExtension(name: string) {
  const root = join(
    process.env.TMPDIR ?? "/tmp",
    `browser-extension-test-${process.pid}-${Date.now()}-${tempRoots.length}`,
  );
  const extension = join(root, "extension");
  mkdirSync(extension, { recursive: true });
  writeFileSync(
    join(extension, "manifest.json"),
    JSON.stringify({ name }, null, 2),
  );
  writeFileSync(
    join(root, "Preferences"),
    JSON.stringify({
      extensions: { settings: { extension: { path: extension } } },
    }),
  );
  tempRoots.push(root);
  return root;
}

describe("browserExtensionResults", () => {
  test("accepts a required extension", () => {
    const profile = profileWithExtension("Browser Control");

    expect(
      browserExtensionResults(
        `chromium-name|${profile}|Browser Control|Browser Control|Install it`,
      ),
    ).toEqual([
      {
        severity: "ok",
        message: `Browser Control is installed in ${profile}`,
      },
    ]);
  });

  test("rejects a forbidden extension", () => {
    const profile = profileWithExtension("Browser Control");

    expect(
      browserExtensionResults(
        `chromium-name-absent|${profile}|Browser Control|Browser Control in Chrome|Remove it`,
      ),
    ).toEqual([
      {
        severity: "error",
        message: `Browser Control in Chrome must be removed from ${profile}`,
        detail: "Remove it",
      },
    ]);
  });

  test("accepts an absent forbidden extension", () => {
    const profile = profileWithExtension("Another Extension");

    expect(
      browserExtensionResults(
        `chromium-name-absent|${profile}|Browser Control|Browser Control in Chrome|Remove it`,
      ),
    ).toEqual([]);
  });
});
