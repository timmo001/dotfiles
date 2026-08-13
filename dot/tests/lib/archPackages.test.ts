import { afterEach, describe, expect, test } from "bun:test";
import { rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadPackageLists } from "../../src/lib/archPackages.js";
import { replacedPublicPackage } from "../../src/lib/packageSetup.js";

const paths: string[] = [];

afterEach(() => {
  for (const path of paths.splice(0)) rmSync(path, { force: true });
});

describe("loadPackageLists", () => {
  test("combines base and host package lists without duplicates", () => {
    const root = process.env.TMPDIR ?? "/tmp";
    const base = join(root, `packages-${process.pid}-${Date.now()}`);
    const host = `${base}--desktop`;
    paths.push(base, host);
    writeFileSync(base, "shared\nduplicate\n");
    writeFileSync(host, "duplicate\ndesktop-only\n");

    expect(loadPackageLists([base, host])).toEqual([
      "shared",
      "duplicate",
      "desktop-only",
    ]);
  });
});

describe("replacedPublicPackage", () => {
  test("migrates mise-bin before installing official mise", () => {
    expect(replacedPublicPackage("mise")).toBe("mise-bin");
    expect(replacedPublicPackage("git")).toBeUndefined();
  });
});
