import { describe, expect, test } from "bun:test";
import {
  extractFlagNames,
  usageCommandKey,
  usageEventKey,
  type UsageEvent,
} from "./usage.js";

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
