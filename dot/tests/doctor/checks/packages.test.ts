import { describe, expect, test } from "bun:test";
import { isInstalledVersionOlder } from "../../../src/doctor/checks/packages.js";

describe("isInstalledVersionOlder", () => {
  test("only treats an older installed version as outdated", () => {
    expect(isInstalledVersionOlder("-1\n")).toBe(true);
    expect(isInstalledVersionOlder("0\n")).toBe(false);
    expect(isInstalledVersionOlder("1\n")).toBe(false);
  });
});
