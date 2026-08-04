import { describe, expect, test } from "bun:test";
import {
  isInstalledVersionOlder,
  publicPackageKeyTrusted,
} from "../../../src/doctor/checks/packages.js";

describe("isInstalledVersionOlder", () => {
  test("only treats an older installed version as outdated", () => {
    expect(isInstalledVersionOlder("-1\n")).toBe(true);
    expect(isInstalledVersionOlder("0\n")).toBe(false);
    expect(isInstalledVersionOlder("1\n")).toBe(false);
  });
});

describe("publicPackageKeyTrusted", () => {
  const fingerprint = "F94469C08E3B717014E2815FA026A3671E9151DA";
  const key = `pub:f:255:22:A026A3671E9151DA:0:0::::::\nfpr:::::::::${fingerprint}:\nuid:f::::::::Timmo Arch Repository:::::::::\nsig:::1:BFD389129B2D99EF:0::::Pacman Keyring Master Key:10l::B6D4FDD5C39CDCFAF4B1072ABFD389129B2D99EF:`;

  test("requires a valid key with the exact primary fingerprint and local signature", () => {
    expect(publicPackageKeyTrusted(key, fingerprint)).toBe(true);
    expect(
      publicPackageKeyTrusted(key.replace(":10l:", ":10x:"), fingerprint),
    ).toBe(false);
    expect(
      publicPackageKeyTrusted(key, "0000000000000000000000000000000000000000"),
    ).toBe(false);
    expect(
      publicPackageKeyTrusted(key.replace("pub:f:", "pub:-:"), fingerprint),
    ).toBe(false);
  });
});
