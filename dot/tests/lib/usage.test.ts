import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  extractFlagNames,
  readAllEvents,
  usageCommandKey,
  usageEventKey,
  type UsageEvent,
} from "../../src/lib/usage.js";

describe("extractFlagNames", () => {
  test("records only recognised flags", () => {
    expect(
      extractFlagNames(
        ["-m", "-private message", "--push", "--unknown=value"],
        new Set(["-m", "--push"]),
      ),
    ).toEqual(["--push", "-m"]);
  });
});

describe("readAllEvents", () => {
  test("reads event collections larger than the argument limit", () => {
    const root = mkdtempSync(join(tmpdir(), "dot-usage-"));
    const eventsDir = join(root, "events", "desktop");
    const eventCount = 150_000;

    try {
      mkdirSync(eventsDir, { recursive: true });
      writeFileSync(
        join(eventsDir, "2026-07-23.ndjson"),
        `${'{"ts":"2026-07-23T00:00:00.000Z","tool":"dot"}\n'.repeat(eventCount)}`,
      );

      expect(readAllEvents([root])).toHaveLength(eventCount);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});

describe("usageEventKey", () => {
  test("identifies repeated history events", () => {
    const event: UsageEvent = {
      ts: "2026-07-10T10:00:00.000Z",
      machine: "desktop",
      tool: "dot",
      invokedAs: "dot",
      command: ["update"],
      flags: [],
      exitCode: null,
      durationMs: null,
      source: "history",
      invoker: "human",
    };
    expect(usageEventKey(event)).toBe(usageEventKey({ ...event }));
    expect(usageCommandKey(event)).toBe(
      usageCommandKey({ ...event, source: "live" }),
    );
  });
});
