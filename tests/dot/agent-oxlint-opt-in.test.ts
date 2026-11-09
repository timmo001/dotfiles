import { expect, test } from "bun:test";
import { agentOxlintOptInText } from "../../dot/src/lib/agentOxlintOptIn.js";
import { appendGitRepository } from "../../dot/src/lib/gitRepoConfig.js";
import { parseDotGitConfigText, type GitManagedRepo } from "../../dot/src/services/GitConfig.js";

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

const repository: GitManagedRepo = {
  name: "Example",
  path: "/example",
  github: "example/example",
  aliases: ["example_repo"],
  postUpdate: "echo 'hello: world'\necho done",
  agentOxlint: false,
  activity: { enabled: true, schedule: "* * * * *" },
  notifications: {
    enabled: true,
    schedule: "* * * * *",
    bar: { ignoreBotActivity: true },
  },
};

test("induction inserts only a block before the next section, preserving CRLF and scalar content", () => {
  const prefix = appendGitRepository("---\r\nschema_version: 2\r\nrepositories: []\r\n", { ...repository, name: "First", path: "/first", github: "example/first", aliases: ["first_repo"] }) + "  # keep this comment\r\n";
  const suffix = "shortcuts: [] # keep this too\r\n";
  const updated = appendGitRepository(prefix + suffix, repository);
  expect(updated.startsWith(prefix)).toBe(true);
  expect(updated.endsWith(suffix)).toBe(true);
  expect(updated).toContain('    aliases:\r\n      - "example_repo"\r\n');
  const parsed = parseDotGitConfigText(updated, "dot-git.yml");
  expect(parsed.valid).toBe(true);
  expect(parsed.repositories[1]).toEqual(repository);
});

test("induction preserves existing entries and validates duplicates across sections", () => {
  const first = appendGitRepository("schema_version: 2\nrepositories: []\n", repository);
  const updated = appendGitRepository(first + "shortcuts: []\n", { ...repository, name: "Second", path: "/second", github: "example/second", aliases: ["second_repo"] });
  expect(updated.startsWith(first)).toBe(true);
  expect(updated.endsWith("shortcuts: []\n")).toBe(true);
  expect(parseDotGitConfigText(updated, "dot-git.yml").valid).toBe(true);
  const duplicate = appendGitRepository(first + "shortcuts: []\n", repository);
  expect(parseDotGitConfigText(duplicate, "dot-git.yml").diagnostics).toContain("Duplicate repository path: /example");
});
