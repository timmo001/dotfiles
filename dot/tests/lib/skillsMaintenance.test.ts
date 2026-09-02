import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { mkdtempSync } from "fs";
import { skillsMaintenanceSource } from "../../src/lib/skillsMaintenance.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true });
});

describe("skill-maintenance source selection", () => {
  test("prefers the writable skills checkout", () => {
    const root = mkdtempSync(join(tmpdir(), "dot-skills-source-"));
    roots.push(root);
    const writable = join(root, "home", "repos", "skills", "src");
    mkdirSync(writable, { recursive: true });
    writeFileSync(join(writable, "index.ts"), "");

    expect(
      skillsMaintenanceSource(join(root, "dotfiles"), join(root, "home")),
    ).toBe(join(root, "home", "repos", "skills"));
  });

  test("falls back to the pinned submodule", () => {
    const root = mkdtempSync(join(tmpdir(), "dot-skills-source-"));
    roots.push(root);
    const publicDotfiles = join(root, "dotfiles");

    expect(skillsMaintenanceSource(publicDotfiles, join(root, "home"))).toBe(
      join(publicDotfiles, "agents", ".agents", "skills"),
    );
  });
});
