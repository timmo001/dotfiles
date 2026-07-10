import { afterEach, describe, expect, test } from "bun:test";
import { Effect, Layer, Stream } from "effect";
import { mkdtempSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { OutputLog } from "../services/OutputLog.js";
import { ENV } from "./env.js";
import {
  configureFirewallRules,
  firewallRuleSpecs,
  firewallSetupScript,
  parseUfwAllowTuples,
} from "./firewallSetup.js";

const previousUfwRulesFile = process.env[ENV.DOT_UFW_RULES_FILE];
const tempRoots: string[] = [];

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "dot-firewall-setup-"));
  tempRoots.push(root);
  return root;
}

afterEach(() => {
  if (previousUfwRulesFile === undefined) {
    delete process.env[ENV.DOT_UFW_RULES_FILE];
  } else {
    process.env[ENV.DOT_UFW_RULES_FILE] = previousUfwRulesFile;
  }

  for (const root of tempRoots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

describe("firewallSetupScript", () => {
  test("batches ufw commands into one shell script", () => {
    expect(
      firewallSetupScript([
        ["allow", "8123/tcp", "comment", "Home Assistant"],
        ["reload"],
      ]),
    ).toBe("set -e\nufw allow 8123/tcp comment 'Home Assistant'\nufw reload");
  });

  test("quotes shell-sensitive arguments", () => {
    expect(
      firewallSetupScript([["allow", "4096/tcp", "comment", "Bob's app"]]),
    ).toBe("set -e\nufw allow 4096/tcp comment 'Bob'\"'\"'s app'");
  });

  test("uses explicit protocol syntax for unscoped port ranges", () => {
    const kdeUdp = firewallRuleSpecs().find(
      (spec) => spec.describe === "1714:1764/udp",
    );

    expect(kdeUdp?.addArgs).toEqual([
      "allow",
      "proto",
      "udp",
      "from",
      "any",
      "to",
      "any",
      "port",
      "1714:1764",
    ]);
  });

  test("fails when ufw exits cleanly without persisting managed rules", async () => {
    const rulesFile = join(tempRoot(), "user.rules");
    writeFileSync(rulesFile, "");
    process.env[ENV.DOT_UFW_RULES_FILE] = rulesFile;

    const commandExecutor = Layer.succeed(CommandExecutor, {
      run: () => Effect.die("run should not be called"),
      stream: () => Stream.die("stream should not be called"),
      exitCode: (cmd) => Effect.succeed(cmd === "which" ? 0 : 1),
      inherit: () => Effect.succeed(0),
    });
    const outputLog = Layer.succeed(OutputLog, {
      info: () => Effect.void,
      warn: () => Effect.void,
      error: () => Effect.void,
      section: () => Effect.void,
      stream: Stream.empty,
      flush: Effect.succeed(""),
      withSpinner: (_label, effect) => effect,
      updateSpinner: () => Effect.void,
    });

    await expect(
      Effect.runPromise(
        configureFirewallRules.pipe(
          Effect.provide(Layer.merge(commandExecutor, outputLog)),
        ),
      ),
    ).rejects.toMatchObject({
      message: expect.stringContaining("1714:1764/udp (KDE Connect)"),
    });
  });
});

describe("parseUfwAllowTuples", () => {
  test("keeps differently scoped rules distinct", () => {
    const tuples = parseUfwAllowTuples(
      [
        "### tuple ### allow tcp 8123 0.0.0.0/0 any 192.168.1.0/24 in",
        "### tuple ### allow tcp 8123 0.0.0.0/0 any 0.0.0.0/0 in comment=486f6d6520417373697374616e74",
      ].join("\n"),
    );

    expect(tuples.size).toBe(2);
    expect(
      tuples.get("allow tcp 8123 0.0.0.0/0 any 0.0.0.0/0 in")?.comment,
    ).toBe("Home Assistant");
  });
});
