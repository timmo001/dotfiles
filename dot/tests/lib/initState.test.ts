import { afterEach, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "fs";
import { tmpdir } from "os";
import { join } from "path";
import {
  ensureInitCompleteMarker,
  initCompleteMarker,
  initInProgressMarker,
  writeInitCompleteMarker,
  writeInitInProgressMarker,
} from "../../src/lib/initState.js";
import type { ConfigService } from "../../src/services/Config.js";

const tempRoots: string[] = [];

function config(stateDir = tempRoot()): ConfigService {
  return {
    publicDotfiles: "/tmp/public",
    privateDotfiles: null,
    canUsePrivate: false,
    privateReason: "test",
    notesDir: "/tmp/notes",
    omarchy: {
      repoBase: "/tmp",
      diffRepos: [],
      worktreeRepos: [],
      worktreeBranches: [],
      expectedBranches: {},
      enabled: false,
    },
    gitConfig: {
      filePath: "/tmp/dot-git.yml",
      present: false,
      valid: true,
      repositories: [],
      diagnostics: [],
    },
    mcpConfig: {
      filePath: "/tmp/mcp.yml",
      present: false,
      valid: true,
      spec: { servers: [] },
      diagnostics: [],
    },
    cacheDir: "/tmp/cache",
    stateDir,
    logDir: join(stateDir, "logs"),
  };
}

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "dot-init-state-"));
  tempRoots.push(root);
  return root;
}

function readJson(path: string): Record<string, unknown> {
  return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
}

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("init state markers", () => {
  test("writes an in-progress marker with options and a timestamp", async () => {
    const service = config();

    await Effect.runPromise(
      writeInitInProgressMarker(service, {
        host: "laptop",
        noninteractive: true,
      }),
    );

    const path = initInProgressMarker(service);
    expect(readFileSync(path, "utf8")).toEndWith("\n");
    expect(readJson(path)).toMatchObject({
      status: "in-progress",
      options: { host: "laptop", noninteractive: true },
      startedAt: expect.any(String),
    });
    expect(Number.isNaN(Date.parse(String(readJson(path).startedAt)))).toBe(
      false,
    );
  });

  test("writes completion state and removes the in-progress marker", async () => {
    const service = config();
    writeFileSync(initInProgressMarker(service), "stale");

    await Effect.runPromise(writeInitCompleteMarker(service, "init"));

    expect(existsSync(initInProgressMarker(service))).toBe(false);
    expect(readFileSync(initCompleteMarker(service), "utf8")).toEndWith("\n");
    const marker = readJson(initCompleteMarker(service));
    expect(Number.isNaN(Date.parse(String(marker.completedAt)))).toBe(false);
    expect(marker).toMatchObject({
      status: "complete",
      source: "init",
      completedAt: expect.any(String),
    });
  });

  test("reports existing and in-progress markers without overwriting them", async () => {
    const service = config();
    writeFileSync(initInProgressMarker(service), "in progress");

    expect(
      await Effect.runPromise(ensureInitCompleteMarker(service, "update")),
    ).toBe("in-progress");
    expect(existsSync(initCompleteMarker(service))).toBe(false);

    writeFileSync(initCompleteMarker(service), "complete");
    expect(
      await Effect.runPromise(ensureInitCompleteMarker(service, "update")),
    ).toBe("exists");
    expect(readFileSync(initCompleteMarker(service), "utf8")).toBe("complete");
  });

  test("creates a completion marker when no state exists", async () => {
    const service = config();

    expect(
      await Effect.runPromise(ensureInitCompleteMarker(service, "update")),
    ).toBe("created");
    expect(readJson(initCompleteMarker(service))).toMatchObject({
      status: "complete",
      source: "update",
    });
  });

  test("converts write failures into InitStateError", async () => {
    const root = tempRoot();
    const service = config(join(root, "missing", "state"));

    await expect(
      Effect.runPromise(writeInitInProgressMarker(service, {})),
    ).rejects.toMatchObject({
      _tag: "InitStateError",
      message: expect.stringContaining("Could not write"),
    });
  });

  test("converts stale marker removal failures into InitStateError", async () => {
    const service = config();
    mkdirSync(initInProgressMarker(service));

    await expect(
      Effect.runPromise(writeInitCompleteMarker(service, "init")),
    ).rejects.toMatchObject({
      _tag: "InitStateError",
      message: expect.stringContaining("Could not remove"),
    });
    expect(existsSync(initCompleteMarker(service))).toBe(true);
  });
});
