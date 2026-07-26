import { afterEach, describe, expect, test } from "bun:test";
import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { opencodeServerResults } from "../../../src/doctor/checks/opencodeServer.js";

const tempRoots: string[] = [];

afterEach(() => {
  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function tempPaths() {
  const root = join(
    process.env.TMPDIR ?? "/tmp",
    `opencode-server-test-${process.pid}-${Date.now()}-${tempRoots.length}`,
  );
  const autostartPath = join(root, "hypr", "autostart.conf");
  const envPath = join(root, "opencode", ".env");
  mkdirSync(join(root, "hypr"), { recursive: true });
  mkdirSync(join(root, "opencode"), { recursive: true });
  tempRoots.push(root);
  return { autostartPath, envPath };
}

describe("opencodeServerResults", () => {
  test("accepts desktop autostart and a configured password", () => {
    const { autostartPath, envPath } = tempPaths();
    writeFileSync(autostartPath, "exec-once = opencode-server\n");
    writeFileSync(envPath, "OPENCODE_SERVER_PASSWORD='configured'\n");

    expect(opencodeServerResults(autostartPath, envPath)).toEqual([
      {
        severity: "ok",
        message: "OpenCode server autostarts on the desktop host",
      },
      {
        severity: "ok",
        message: `OpenCode server password is configured in ${envPath}`,
      },
    ]);
  });

  test("warns when desktop autostart does not start the server", () => {
    const { autostartPath, envPath } = tempPaths();
    writeFileSync(autostartPath, "exec-once = another-service\n");

    expect(opencodeServerResults(autostartPath, envPath)).toEqual([
      {
        severity: "warn",
        message: "OpenCode server does not autostart on the desktop host",
        detail: `Expected ${autostartPath} to start opencode-server`,
      },
    ]);
  });

  test("checks the local password whenever desktop autostart is enabled", () => {
    const { autostartPath, envPath } = tempPaths();
    writeFileSync(autostartPath, "exec-once = opencode-server\n");

    expect(opencodeServerResults(autostartPath, envPath)[1]).toEqual({
      severity: "warn",
      message: `OpenCode server password file missing: ${envPath}`,
      detail: "Create it with mode 600 and set OPENCODE_SERVER_PASSWORD",
    });
  });
});
