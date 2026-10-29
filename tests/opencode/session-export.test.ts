import { expect, test } from "bun:test";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  defaultSessionExportPath,
  sessionExportArgv,
  sessionExportId,
} from "../../agents/.config/opencode/plugins/lib/cli-tools/session-export.ts";

// Mimics anomalyco/opencode#57266: a pipe gets a truncated prefix and exit 0; a file gets the full JSON.
const fakeExporter = () => {
  const dir = mkdtempSync(join(tmpdir(), "session-export-"));
  const bin = join(dir, "opencode2");

  writeFileSync(
    bin,
    `#!/usr/bin/env bun
import { fstatSync } from "node:fs";

const sessionID = process.argv.find((arg) => arg.startsWith("ses_"));
const payload = JSON.stringify({ session: sessionID, ok: true, body: "x".repeat(300_000) });

// A pipe or socket stands in for opencode's stdout pipe. A bash file redirect is a regular file.
if (!fstatSync(1).isFile()) {
  process.stdout.write(payload.slice(0, 64));
  process.exit(0);
}

process.stdout.write(payload);
`,
  );
  chmodSync(bin, 0o755);

  return { dir, bin };
};

test("session export ids cannot escape the default directory", () => {
  expect(sessionExportId.test("ses_abc-123")).toBe(true);
  expect(sessionExportId.test("ses/../../.bashrc")).toBe(false);
  expect(sessionExportId.test("ses_../passwd")).toBe(false);
  expect(defaultSessionExportPath("ses_abc")).toBe("/tmp/opencode/session-exports/ses_abc.json");
});

test("session export writes complete JSON to a file and a pipe truncates it", async () => {
  const { dir, bin } = fakeExporter();
  const sessionID = "ses_abc";

  const piped = Bun.spawn([bin, "session", "export", sessionID], { stdout: "pipe" });
  const truncated = await new Response(piped.stdout).text();

  expect(await piped.exited).toBe(0);
  expect(() => JSON.parse(truncated)).toThrow();

  const output = join(dir, "export.json");

  const exported = Bun.spawn(["bash", ...sessionExportArgv(bin, sessionID, output, false)], {
    stdout: "pipe",
    stderr: "pipe",
  });

  const stderr = await new Response(exported.stderr).text();

  expect(await exported.exited).toBe(0);
  expect(stderr).toBe("");
  expect(JSON.parse(readFileSync(output, "utf8"))).toMatchObject({ session: sessionID, ok: true });
  expect(sessionExportArgv(bin, sessionID, output, true)).toContain("--sanitize");
});

test("the Code Mode session export tool redirects to a file and checks the JSON", async () => {
  const source = await Bun.file("agents/.config/opencode/plugins/lib/cli-tools/opencode2.ts").text();
  const start = source.indexOf('name: "session_export"');
  const end = source.indexOf('name: "service_status"');
  const tool = source.slice(start, end);

  expect(tool).toContain("sessionExportArgv");
  expect(tool).toContain("sessionExportId");
  expect(tool).toContain("isn't complete JSON");
  expect(tool).not.toContain("runCliText(\n            COMMAND");
});
