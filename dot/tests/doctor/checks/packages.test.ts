import { describe, expect, test } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import {
  isInstalledVersionOlder,
  packageUpdateResult,
  publicPackageKeyTrusted,
} from "../../../src/doctor/checks/packages.js";
import { CommandExecutor } from "../../../src/services/CommandExecutor.js";

describe("isInstalledVersionOlder", () => {
  test("only treats an older installed version as outdated", () => {
    expect(isInstalledVersionOlder("-1\n")).toBe(true);
    expect(isInstalledVersionOlder("0\n")).toBe(false);
    expect(isInstalledVersionOlder("1\n")).toBe(false);
  });
});

describe("packageUpdateResult", () => {
  test("prefers an explicitly qualified package repository over AUR", async () => {
    const commands: string[] = [];
    const executor = Layer.succeed(CommandExecutor, {
      run: (command, args) =>
        Effect.sync(() => {
          commands.push([command, ...args].join(" "));
          if (args[0] === "-Q") return "context-git 1.0.0-1\n";
          if (args[1] === "timmo/context-git") {
            return "Repository : timmo\nVersion : 1.1.0-1\n";
          }
          if (command === "vercmp") return "-1\n";
          return "";
        }),
      stream: () => Stream.die("stream should not be called"),
      exitCode: () => Effect.die("exitCode should not be called"),
      inherit: () => Effect.die("inherit should not be called"),
    });

    const result = await Effect.runPromise(
      packageUpdateResult("context-git", "timmo", true).pipe(
        Effect.provide(executor),
      ),
    );

    expect(result?.message).toBe(
      "context-git is older than timmo (1.0.0-1 installed, 1.1.0-1 available)",
    );
    expect(commands).not.toContain("yay -Si --aur context-git");
  });

  test("uses an AUR-only lookup when the preferred repository has no package", async () => {
    const commands: string[] = [];
    const executor = Layer.succeed(CommandExecutor, {
      run: (command, args) =>
        Effect.sync(() => {
          commands.push([command, ...args].join(" "));
          if (args[0] === "-Q") return "topgrade-bin 1.0.0-1\n";
          if (command === "yay") return "Repository : aur\nVersion : 1.1.0-1\n";
          if (command === "vercmp") return "-1\n";
          return "";
        }),
      stream: () => Stream.die("stream should not be called"),
      exitCode: () => Effect.die("exitCode should not be called"),
      inherit: () => Effect.die("inherit should not be called"),
    });

    const result = await Effect.runPromise(
      packageUpdateResult("topgrade-bin", "timmo", true).pipe(
        Effect.provide(executor),
      ),
    );

    expect(result?.message).toBe(
      "topgrade-bin is older than AUR (1.0.0-1 installed, 1.1.0-1 available)",
    );
    expect(commands).toContain("pacman -Si timmo/topgrade-bin");
    expect(commands).toContain("yay -Si --aur topgrade-bin");
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
