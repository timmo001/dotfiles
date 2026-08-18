import { afterEach, describe, expect, test } from "bun:test";
import { Schema } from "effect";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  activeVersionId,
  captureRepositoryOptions,
  liveCaptureConfig,
  mergeCaptureRepositories,
  writePrivateConfig,
} from "../../src/commands/NotesCaptureSync.js";
import { writeCaptureRepositoryOptions } from "../../src/lib/repoShortcuts.js";
import type { GitManagedRepo } from "../../src/services/GitConfig.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function repository(
  name: string,
  github: string,
  notificationsEnabled: boolean,
): GitManagedRepo {
  return {
    name,
    path: `/tmp/${name}`,
    github,
    aliases: [],
    postUpdate: null,
    activity: { enabled: true, schedule: "* * * * *" },
    notifications: {
      enabled: notificationsEnabled,
      schedule: "* * * * *",
      bar: { ignoreBotActivity: true },
    },
  };
}

describe("captureRepositoryOptions", () => {
  test("puts core tooling first and preserves config order for the rest", () => {
    expect(
      captureRepositoryOptions([
        repository("Zulu", "owner/zulu", true),
        repository("Context", "owner/context", true),
        repository("Ignored", "owner/ignored", false),
        repository("Skills", "owner/skills", true),
        repository("Dotfiles", "owner/dotfiles", true),
        repository("Alpha", "owner/alpha", true),
      ]),
    ).toEqual([
      { label: "Dotfiles", repository: "owner/dotfiles" },
      { label: "Skills", repository: "owner/skills" },
      { label: "Context", repository: "owner/context" },
      { label: "Zulu", repository: "owner/zulu" },
      { label: "Alpha", repository: "owner/alpha" },
    ]);
  });

  test("writes the local Shell picker cache", () => {
    const root = mkdtempSync(join(tmpdir(), "notes-capture-repositories-"));
    tempRoots.push(root);
    const options = [{ label: "Notes", repository: "owner/notes" }];

    const path = writeCaptureRepositoryOptions(root, options);

    expect(JSON.parse(readFileSync(path, "utf-8"))).toEqual(options);
  });
});

describe("live Worker config", () => {
  test("finds the fully active deployment version", () => {
    expect(
      activeVersionId(
        JSON.stringify({
          versions: [
            { version_id: "preview", percentage: 0 },
            { version_id: "active", percentage: 100 },
          ],
        }),
      ),
    ).toBe("active");
  });

  test("copies plain vars and KV bindings without secrets", () => {
    expect(
      liveCaptureConfig(
        JSON.stringify({
          resources: {
            script_runtime: {
              compatibility_date: "2026-07-21",
              compatibility_flags: ["nodejs_compat"],
            },
            bindings: [
              { name: "OWNER", text: "owner", type: "plain_text" },
              { name: "TOKEN", type: "secret_text" },
              { name: "SESSION", namespace_id: "kv-id", type: "kv_namespace" },
            ],
          },
        }),
      ),
    ).toEqual({
      compatibilityDate: "2026-07-21",
      compatibilityFlags: ["nodejs_compat"],
      vars: { OWNER: "owner" },
      kvNamespaces: [{ binding: "SESSION", id: "kv-id" }],
    });
  });
});

describe("mergeCaptureRepositories", () => {
  test("preserves unrelated config and replaces only the picker variable", () => {
    const repositories = [{ label: "Notes", repository: "owner/notes" }];
    const output = mergeCaptureRepositories(
      `{
        // Private deployment settings
        "name": "notes-capture",
        "vars": { "GITHUB_OWNER": "owner", "CAPTURE_REPOSITORIES": "old" }
      }`,
      repositories,
    );
    const parsed = Schema.decodeUnknownSync(
      Schema.Struct({
        name: Schema.String,
        vars: Schema.Record(Schema.String, Schema.String),
      }),
    )(JSON.parse(output));

    expect(parsed.name).toBe("notes-capture");
    expect(parsed.vars.GITHUB_OWNER).toBe("owner");
    expect(JSON.parse(parsed.vars.CAPTURE_REPOSITORIES)).toEqual(repositories);
    expect(mergeCaptureRepositories(output, repositories)).toBe(output);
  });

  test("rejects a non-object vars value", () => {
    expect(() => mergeCaptureRepositories('{ "vars": [] }', [])).toThrow(
      "vars configuration",
    );
  });
});

describe("writePrivateConfig", () => {
  test("creates private files with restrictive permissions", () => {
    const root = mkdtempSync(join(tmpdir(), "notes-capture-sync-"));
    tempRoots.push(root);
    const destination = join(root, "wrangler.local.jsonc");

    writePrivateConfig(destination, "private");

    expect(readFileSync(destination, "utf-8")).toBe("private");
    expect(statSync(destination).mode & 0o777).toBe(0o600);
  });

  test("preserves existing permissions", () => {
    const root = mkdtempSync(join(tmpdir(), "notes-capture-sync-"));
    tempRoots.push(root);
    const destination = join(root, "wrangler.local.jsonc");
    writeFileSync(destination, "old", { mode: 0o640 });

    writePrivateConfig(destination, "new");

    expect(statSync(destination).mode & 0o777).toBe(0o640);
  });
});
