import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { ENV } from "../../src/lib/env.js";
import { scanShellHistory } from "../../src/lib/usageHistory.js";

const previousDataHome = process.env[ENV.XDG_DATA_HOME];
const previousHistfile = process.env[ENV.HISTFILE];
const previousHost = process.env[ENV.OMARCHY_HOST];
const tempRoots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "dot-usage-history-"));
  tempRoots.push(root);
  return root;
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

afterEach(() => {
  restoreEnv(ENV.XDG_DATA_HOME, previousDataHome);
  restoreEnv(ENV.HISTFILE, previousHistfile);
  restoreEnv(ENV.OMARCHY_HOST, previousHost);
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("scanShellHistory", () => {
  test("imports paired fish entries and canonicalises dot aliases", () => {
    const root = tempRoot();
    const fishDir = join(root, "fish");
    mkdirSync(fishDir);
    writeFileSync(
      join(fishDir, "fish_history"),
      `- cmd: /home/test/.local/bin/dot diff --raw --unknown
  when: 1710000000
- cmd: unrelated --raw
  when: 1710000001
- cmd: dot doctor
`,
    );
    process.env[ENV.XDG_DATA_HOME] = root;
    process.env[ENV.HISTFILE] = join(root, "missing-zsh-history");
    process.env[ENV.OMARCHY_HOST] = "test-host";

    const scan = scanShellHistory();

    expect(scan.events).toEqual([
      {
        ts: "2024-03-09T16:00:00.000Z",
        machine: "test-host",
        tool: "dot",
        invokedAs: "dot",
        command: ["git-diff"],
        flags: ["--raw"],
        exitCode: null,
        durationMs: null,
        source: "history",
        invoker: "human",
      },
    ]);
    expect(scan.sources.find(({ shell }) => shell === "fish")).toMatchObject({
      found: true,
      imported: 1,
    });
    expect(scan.sources.find(({ shell }) => shell === "zsh")).toMatchObject({
      found: false,
      imported: 0,
    });
  });

  test("imports zsh aliases while skipping malformed and unlisted commands", () => {
    const root = tempRoot();
    const histfile = join(root, "zsh_history");
    writeFileSync(
      histfile,
      `: 1710000000:2;note create --tag=work
: 1710000001:0;handoff latest
: invalid:0;notes list
: 1710000002:0;git status
notes list
`,
    );
    process.env[ENV.XDG_DATA_HOME] = join(root, "missing-data");
    process.env[ENV.HISTFILE] = histfile;
    process.env[ENV.OMARCHY_HOST] = "test-host";

    const scan = scanShellHistory();

    expect(scan.events).toHaveLength(2);
    expect(scan.events).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          tool: "notes",
          invokedAs: "note",
          command: ["create"],
          flags: ["--tag"],
        }),
        expect.objectContaining({
          tool: "notes",
          invokedAs: "handoff",
          command: ["latest"],
          flags: [],
        }),
      ]),
    );
    expect(scan.sources.find(({ shell }) => shell === "zsh")).toMatchObject({
      found: true,
      imported: 2,
    });
  });

  test("explains an existing zsh history with no importable entries", () => {
    const root = tempRoot();
    const histfile = join(root, "zsh_history");
    writeFileSync(histfile, "dot doctor\n");
    process.env[ENV.XDG_DATA_HOME] = join(root, "missing-data");
    process.env[ENV.HISTFILE] = histfile;

    const scan = scanShellHistory();

    expect(scan.events).toEqual([]);
    expect(scan.sources.find(({ shell }) => shell === "zsh")).toMatchObject({
      found: true,
      imported: 0,
      note: "no whitelisted entries (needs extended history with timestamps)",
    });
  });
});
