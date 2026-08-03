import { describe, expect, test } from "bun:test";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import {
  collectSessionMessages,
  dataOrValue,
  MAX_COMMIT_CONTEXT_SESSIONS,
  renderCommitContext,
  renderCommitContexts,
  sessionTouchedFiles,
} from "../../agents/.config/opencode/lib/commit-context";

const repositoryRoot = "/tmp/repository";
const root = resolve(import.meta.dir, "../..");

const context = ({
  staged = "",
  unstaged = "",
  untracked = "",
  warnings = [],
  truncations = [],
}: {
  readonly staged?: string;
  readonly unstaged?: string;
  readonly untracked?: string;
  readonly warnings?: readonly string[];
  readonly truncations?: readonly Record<string, unknown>[];
} = {}) => ({
  inRepo: true,
  branchMetadata: {
    repositoryRoot,
    currentBranch: "feature/commit-context",
  },
  status: { staged, unstaged, untracked },
  commits: "abc1234 Add previous feature",
  warnings,
  truncations,
});

const messages = (...files: string[]) => [
  {
    projectID: "project-a",
    directory: repositoryRoot,
    messages: {
      data: [
        {
          info: { role: "assistant" },
          parts: [{ type: "patch", files }],
        },
      ],
    },
  },
];

const section = (text: string, name: string): string =>
  text.match(new RegExp(`<${name}>[\\s\\S]*?</${name}>`))?.[0] ?? "";

describe("commit scope", () => {
  test("extracts absolute paths from successful mutation tools", () => {
    const sessions = [
      {
        projectID: "project-a",
        directory: repositoryRoot,
        messages: {
          data: [
            {
              parts: [
                {
                  type: "tool",
                  tool: "edit",
                  state: {
                    status: "completed",
                    input: { filePath: "src/edited.ts" },
                  },
                },
                {
                  type: "tool",
                  tool: "apply_patch",
                  state: {
                    status: "completed",
                    input: {
                      patchText: `*** Begin Patch
*** Update File: /tmp/private/AGENTS.md
*** Move to: /tmp/private/INSTRUCTIONS.md
*** End Patch`,
                    },
                  },
                },
                {
                  type: "tool",
                  tool: "write",
                  state: {
                    status: "error",
                    input: { filePath: "/tmp/ignored.ts" },
                  },
                },
              ],
            },
          ],
        },
      },
    ];

    expect(sessionTouchedFiles(sessions)).toEqual([
      "/tmp/private/AGENTS.md",
      "/tmp/private/INSTRUCTIONS.md",
      `${repositoryRoot}/src/edited.ts`,
    ]);
  });

  test("uses the existing staged set and excludes other dirty paths", () => {
    const rendered = renderCommitContext({
      context: context({
        staged: "M\tsrc/staged.ts",
        unstaged: "M\tsrc/other.ts",
        untracked: "?\tnew.txt",
      }),
      sessions: messages("src/other.ts"),
      diffStat: "src/staged.ts | 2 +-",
    });

    expect(section(rendered, "candidate-paths")).toContain("src/staged.ts");
    expect(section(rendered, "candidate-paths")).not.toContain("src/other.ts");
    expect(section(rendered, "excluded-paths")).toContain("src/other.ts");
    expect(section(rendered, "excluded-paths")).toContain("new.txt");
    expect(section(rendered, "scope-status")).toContain("Status: complete");
    expect(section(rendered, "diff-stat")).toContain("src/staged.ts");
    expect(rendered).not.toContain("<diff-evidence>");
  });

  test("limits recent commit style evidence to five lines", () => {
    const rendered = renderCommitContext({
      context: {
        ...context(),
        commits: "one\ntwo\nthree\nfour\nfive\nsix",
      },
      sessions: [],
      diffStat: "(none)",
    });

    expect(section(rendered, "recent-commits")).toContain("five");
    expect(section(rendered, "recent-commits")).not.toContain("six");
  });

  test("selects only current dirty paths touched by the session tree", () => {
    const rendered = renderCommitContext({
      context: context({
        unstaged: "M\tsrc/owned.ts\nM\tsrc/unrelated.ts",
        untracked: "?\tsrc/new.ts",
      }),
      sessions: [
        ...messages("src/owned.ts", "src/reverted.ts"),
        ...messages(`${repositoryRoot}/src/new.ts`, "src/owned.ts"),
      ],
      diffStat: "src/owned.ts | 2 +-",
    });

    expect(section(rendered, "candidate-paths")).toContain("src/owned.ts");
    expect(section(rendered, "candidate-paths")).toContain("src/new.ts");
    expect(section(rendered, "candidate-paths")).not.toContain(
      "src/reverted.ts",
    );
    expect(section(rendered, "excluded-paths")).toContain("src/unrelated.ts");
    expect(section(rendered, "candidate-paths")).toContain(
      "Treat this as a discovery superset",
    );
    expect(section(rendered, "scope-status")).toContain(
      "This does not make every candidate relevant to or authorised by the current user request",
    );
    expect(rendered).not.toContain("<session-touched-paths>");
    expect(rendered).not.toContain("<worktree-state>");
  });

  test("uses the destination path for renamed status rows", () => {
    const rendered = renderCommitContext({
      context: context({ staged: "R100\told.ts\tnew.ts\nD\tdeleted.ts" }),
      sessions: [],
      diffStat: "new.ts | 2 +-",
    });

    expect(section(rendered, "candidate-paths")).toContain("new.ts");
    expect(section(rendered, "candidate-paths")).toContain("deleted.ts");
    expect(section(rendered, "candidate-paths")).not.toContain("old.ts");
  });

  test("requires explicit verification for escaped control characters", () => {
    const rendered = renderCommitContext({
      context: context({ staged: "M\tline\\nbreak.ts" }),
      sessions: [],
      diffStat: "line\\nbreak.ts | 2 +-",
    });

    expect(section(rendered, "scope-status")).toContain("Status: partial");
    expect(section(rendered, "warnings")).toContain(
      "escaped control characters",
    );
  });

  test("marks unattributed dirty work as partial and excluded", () => {
    const rendered = renderCommitContext({
      context: context({ unstaged: "M\tunrelated.ts" }),
      sessions: [],
      diffStat: "unrelated.ts | 2 +-",
    });

    expect(section(rendered, "candidate-paths")).toContain("(none)");
    expect(section(rendered, "excluded-paths")).toContain("unrelated.ts");
    expect(section(rendered, "scope-status")).toContain("Status: partial");
    expect(section(rendered, "warnings")).toContain(
      "No current dirty paths could be attributed",
    );
  });
});

describe("multiple repository scopes", () => {
  test("renders independently labelled repository scopes", () => {
    const rendered = renderCommitContexts([
      {
        context: context({ unstaged: "M\tpublic.ts" }),
        sessions: [],
        touchedFiles: [`${repositoryRoot}/public.ts`],
        diffStat: "public.ts | 2 +-",
      },
      {
        context: {
          ...context({ unstaged: "M\tprivate.ts" }),
          branchMetadata: {
            repositoryRoot: "/tmp/private",
            currentBranch: "master",
          },
        },
        sessions: [],
        touchedFiles: ["/tmp/private/private.ts"],
        diffStat: "private.ts | 2 +-",
      },
    ]);

    expect(section(rendered, "repository-count")).toContain("2");
    expect(rendered.match(/<repository-scope>/g)).toHaveLength(2);
    expect(rendered).toContain(`Repository root: ${repositoryRoot}`);
    expect(rendered).toContain("Repository root: /tmp/private");
    expect(rendered).toContain("- public.ts");
    expect(rendered).toContain("- private.ts");
  });

  test("renders a fail-closed block when no repository resolves", () => {
    const rendered = renderCommitContexts([], ["Could not resolve repository"]);

    expect(section(rendered, "scope-status")).toContain("Status: partial");
    expect(section(rendered, "scope-status")).toContain(
      "Stop rather than inferring scope",
    );
    expect(section(rendered, "warnings")).toContain(
      "Could not resolve repository",
    );
  });
});

describe("commit context failures", () => {
  test("marks malformed status and truncated producer output as partial", () => {
    const rendered = renderCommitContext({
      context: context({
        unstaged: "malformed",
        truncations: [{ path: "status.unstaged", retained: 1, original: 2 }],
      }),
      sessions: [],
      diffStat: "malformed | 1 +",
    });

    expect(section(rendered, "scope-status")).toContain("Status: partial");
    expect(section(rendered, "warnings")).toContain(
      "Could not parse 1 working-tree status row",
    );
    expect(section(rendered, "warnings")).toContain("truncated");
  });

  test("reports paths outside the active repository", () => {
    const rendered = renderCommitContext({
      context: context({ unstaged: "M\tinside.ts" }),
      sessions: messages("/tmp/another/outside.ts"),
      diffStat: "inside.ts | 2 +-",
    });

    expect(section(rendered, "outside-repository-paths")).toContain(
      "/tmp/another/outside.ts",
    );
    expect(section(rendered, "scope-status")).toContain("Status: partial");
  });

  test("fails closed when context collection is unavailable", () => {
    const rendered = renderCommitContext({
      context: null,
      sessions: messages("src/file.ts"),
      collectionWarnings: ["Could not collect git context"],
    });

    expect(section(rendered, "candidate-paths")).toContain("(none)");
    expect(section(rendered, "scope-status")).toContain("Status: partial");
    expect(section(rendered, "warnings")).toContain(
      "Git context payload is unavailable",
    );
  });

  test("escapes XML and bounds diff stat", () => {
    const rendered = renderCommitContext({
      context: context({
        staged: "M\ta&b.ts",
      }),
      sessions: [],
      diffStat: `<script>${"x".repeat(2_100)}</script>`,
    });

    expect(rendered).toContain("a&amp;b.ts");
    expect(rendered).toContain("&lt;script&gt;");
    expect(rendered).toContain("[TRUNCATED");
    expect(rendered).not.toContain("<script>");
    expect(section(rendered, "scope-status")).toContain("Status: partial");
  });

  test("unwraps SDK data responses", () => {
    expect(dataOrValue({ data: [1, 2] })).toEqual([1, 2]);
    expect(dataOrValue([1, 2])).toEqual([1, 2]);
  });

  test("fails closed for an incomplete Context payload", () => {
    const rendered = renderCommitContext({
      context: {
        inRepo: false,
        branchMetadata: { repositoryRoot },
        status: { staged: 1 },
      },
      sessions: [],
      diffStat: "",
    });

    expect(section(rendered, "scope-status")).toContain("Status: partial");
    expect(section(rendered, "warnings")).toContain(
      "did not confirm a git worktree",
    );
    expect(section(rendered, "warnings")).toContain(
      "status field 'staged' is unavailable",
    );
    expect(section(rendered, "warnings")).toContain(
      "Context warnings are unavailable",
    );
    expect(section(rendered, "warnings")).toContain(
      "Context truncation metadata is unavailable",
    );
  });

  test("excludes descendant sessions from another repository", () => {
    const rendered = renderCommitContext({
      context: context({ unstaged: "M\tsrc/shared.ts" }),
      sessions: [
        {
          projectID: "project-a",
          directory: repositoryRoot,
          messages: { data: [] },
        },
        {
          projectID: "project-b",
          directory: "/tmp/another",
          messages: messages("src/shared.ts")[0].messages,
        },
      ],
      diffStat: "src/shared.ts | 2 +-",
    });

    expect(section(rendered, "candidate-paths")).toContain("(none)");
    expect(section(rendered, "excluded-paths")).toContain("src/shared.ts");
    expect(section(rendered, "warnings")).toContain("another repository");
  });

  test("bounds descendant session traversal", async () => {
    const reader = {
      session: async () => ({
        data: { projectID: "project-a", directory: repositoryRoot },
      }),
      messages: async (sessionID: string) => ({
        data: [{ info: { id: sessionID }, parts: [] }],
      }),
      children: async (sessionID: string) => ({
        data: [{ id: `${sessionID}-child` }],
      }),
    };

    const result = await collectSessionMessages(reader, "root");

    expect(result.sessions).toHaveLength(MAX_COMMIT_CONTEXT_SESSIONS);
    expect(result.warnings).toEqual([
      `Session traversal stopped after ${MAX_COMMIT_CONTEXT_SESSIONS} sessions.`,
    ]);
  });
});

describe("commit command contract", () => {
  test("plugin modules export functions only", async () => {
    const plugin =
      await import("../../agents/.config/opencode/plugins/commit-context");

    expect(
      Object.values(plugin).every((value) => typeof value === "function"),
    ).toBe(true);
  });

  test.each(["commit", "commit-push"])(
    "%s stays in the parent session and consumes injected context",
    async (command) => {
      const source = await readFile(
        resolve(root, `agents/.config/opencode/commands/${command}.md`),
        "utf8",
      );
      const frontmatter = source.split("---", 3)[1];

      expect(frontmatter).not.toContain("agent:");
      expect(frontmatter).not.toContain("model:");
      expect(frontmatter).not.toContain("variant:");
      expect(frontmatter).not.toContain("subtask:");
      expect(source).toContain("injected `<commit-context>`");
      expect(source).toContain("`git-commit`");
      expect(source).toMatch(/current\s+requested changeset/);
      expect(source).toMatch(/never fall back to raw\s+Git/);
    },
  );

  test("git-commit skill treats candidates as evidence, not authorisation", async () => {
    const source = await readFile(
      resolve(root, "agents/.agents/skills/git-commit/SKILL.md"),
      "utf8",
    );

    expect(source).toContain(
      "Candidate paths are attribution evidence, not authorisation",
    );
    expect(source).toMatch(
      /Never\s+commit a path merely because it is listed, staged, session-touched, or forms\s+a separate coherent change/,
    );
  });

  test("commit-push delegates pushed workflow checks in the background", async () => {
    const source = await readFile(
      resolve(root, "agents/.config/opencode/commands/commit-push.md"),
      "utf8",
    );

    expect(source).toContain("`workflows-watch`");
    expect(source).toContain("one final push per repository");
    expect(source).toContain("<commit-context>");
  });

  test("workflows watch defaults to reporting and gates fix mode", async () => {
    const source = await readFile(
      resolve(
        root,
        "agents/.agents/skills/workflows-watch/SKILL.md",
      ),
      "utf8",
    );

    expect(source).toContain("name: workflows-watch");
    expect(source).toContain("background: true");
    expect(source).toContain("Do not poll");
    expect(source).toContain("Watch mode is the default");
    expect(source).toContain("Fix mode is explicit");
    expect(source).toContain("make no edits");
    expect(source).toContain("Do not launch a workflow watch from one-shot");
    expect(source).toContain("smallest scoped fix");
    expect(source).toContain("Discovery belongs to the host");
    expect(source).toContain("must not repeat target discovery");
    expect(source).toContain("dedicated `workflow-watcher` subagent");
    expect(source).toMatch(/Never commit, push, rerun, cancel, or dispatch/);
  });

  test("workflow watcher denies generic GitHub API calls", async () => {
    const source = await readFile(
      resolve(
        root,
        "agents/.config/opencode/agents/workflow-watcher.md",
      ),
      "utf8",
    );

    expect(source).toContain("mode: subagent");
    expect(source).toContain('"github_*": deny');
    expect(source).toContain("github_actions_list: allow");
    expect(source).toContain("github_actions_get: allow");
    expect(source).toContain("github_get_job_logs: allow");
    expect(source).toContain('"gh api*": deny');
    expect(source).toContain('"gh run watch*": allow');
    expect(source).toContain("Do not discover");
  });

  test("workflow manifest centralises host discovery", async () => {
    const source = await readFile(
      resolve(
        root,
        "agents/.config/opencode/plugins/workflow-manifest.ts",
      ),
      "utf8",
    );

    expect(source).toContain("workflow_manifest: tool(");
    expect(source).toContain("gh run list --commit");
    expect(source).toContain("gh run view");
    expect(source).toContain("quick:");
    expect(source).toContain("full:");
  });
});
