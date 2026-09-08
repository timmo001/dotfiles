import { expect, test } from "bun:test";
import { agentOxlintOptInText } from "../../dot/src/lib/agentOxlintOptIn.js";

test("inserts exactly one line, retaining comments, inline lists and CRLF", () => {
  const source = "# keep\r\nrepositories:\r\n  - name: First\r\n    path: /first\r\n    aliases: [first] # unchanged\r\n  - name: Second\r\n    path: /second # target\r\n    aliases: [second]\r\n";
  expect(agentOxlintOptInText(source, 1)).toBe(source.replace(
    "    path: /second # target\r\n",
    "    path: /second # target\r\n    agent_oxlint: true\r\n",
  ));
});

test("replaces only false on the target line and preserves missing final newline", () => {
  const source = "repositories:\n  - path: /first\n    agent_oxlint: false # keep first\n  - path: /second\n    agent_oxlint: false # keep second";
  const updated = source.replace("false # keep second", "true # keep second");
  expect(agentOxlintOptInText(source, 1)).toBe(updated);
  expect(agentOxlintOptInText(updated, 1)).toBe(updated);
});

test("does not edit matching text inside a block scalar", () => {
  const source = "repositories:\n  - path: /first\n    post_update: |\n      agent_oxlint: false\n    agent_oxlint: false # real\n";
  expect(agentOxlintOptInText(source, 0)).toBe(source.replace("false # real", "true # real"));
});

test("refuses layouts requiring more than a single-line edit", () => {
  expect(() => agentOxlintOptInText("repositories: [{path: /first}]\n", 0)).toThrow("single-line");
  expect(() => agentOxlintOptInText("repositories:\n  - path: /first\n", 1)).toThrow("missing");
});
