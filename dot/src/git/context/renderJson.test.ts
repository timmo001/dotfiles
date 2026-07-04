import { describe, expect, test } from "bun:test";
import { renderBranchContextJson } from "./renderJson.js";
import { CHAR_LIMITS } from "./model.js";
import type {
  BranchContextData,
  BranchMetadata,
  CommitRecord,
  FileChange,
  PullRequestData,
  WorkingTreeStatus,
} from "./model.js";

/** Parsed shape of the fields the branch-context plugin reads by key. */
interface ParsedPayload {
  readonly inRepo: boolean;
  readonly branchMetadata?: { readonly repositoryName?: string };
  readonly status?: {
    readonly short?: string;
    readonly unstaged?: string;
    readonly staged?: string;
    readonly untracked?: string;
  };
  readonly workScope?: {
    readonly skipped?: boolean;
    readonly branchCommits?: string;
    readonly branchFiles?: string;
    readonly branchDiffStat?: string;
  };
  readonly commits?: string;
  readonly pullRequest: {
    readonly summary?: { readonly number?: number };
  } | null;
  readonly warnings?: readonly string[];
}

function file(raw: string, status: string, path: string): FileChange {
  return { raw, status, path, countsKnown: false, added: null, deleted: null };
}

function commit(over: Partial<CommitRecord>): CommitRecord {
  return {
    isoDate: "2024-01-01T00:00:00Z",
    shortHash: "0000000",
    relativeTime: "1h ago",
    subject: "Subject",
    pushed: false,
    files: [],
    ...over,
  };
}

const metadata: BranchMetadata = {
  repositoryRoot: "/repo",
  repositoryName: "repo",
  currentBranch: "feature",
  headSha: "abc1234",
  defaultRemote: "origin",
  defaultBranch: "main",
  baseRef: "origin/main",
  upstreamRef: "origin/feature",
  ahead: 2,
  behind: 0,
  onDefaultBranch: false,
  remotes: ["origin"],
};

const status: WorkingTreeStatus = {
  unstaged: [file("M\tsrc/a.ts", "M", "src/a.ts")],
  staged: [file("A\tsrc/b.ts", "A", "src/b.ts")],
  untracked: [file("??\tsrc/c.ts", "??", "src/c.ts")],
  short: "## feature...origin/feature",
};

const pullRequest: PullRequestData = {
  summary: {
    number: 42,
    state: "OPEN",
    title: "My PR",
    commentCount: 3,
    reviewDecision: "REVIEW_REQUIRED",
    url: "https://github.com/o/r/pull/42",
    isDraft: false,
    mergeStateStatus: "CLEAN",
    headRefName: "feature",
    baseRefName: "main",
  },
};

const featureData: BranchContextData = {
  inRepo: true,
  branchMetadata: metadata,
  status,
  workScope: {
    skipped: false,
    branchCommits: [{ hash: "abc1234", subject: "Add thing" }],
    branchFiles: [file("M\tsrc/a.ts", "M", "src/a.ts")],
    branchDiffStat: " src/a.ts | 2 +-",
  },
  commits: {
    range: {
      args: ["origin/main..HEAD"],
      kind: "branch",
      sinceRef: "origin/main",
    },
    records: [
      commit({ shortHash: "abc1234", subject: "Add thing", pushed: false }),
    ],
  },
  pullRequest,
  warnings: [],
};

const defaultBranchData: BranchContextData = {
  inRepo: true,
  branchMetadata: { ...metadata, currentBranch: "main", onDefaultBranch: true },
  status,
  workScope: {
    skipped: true,
    branchCommits: [],
    branchFiles: [],
    branchDiffStat: "",
  },
  commits: {
    range: { args: ["-n", "10", "HEAD"], kind: "recent" },
    records: [
      commit({ shortHash: "aaa1111", subject: "Recent one", pushed: true }),
      commit({ shortHash: "bbb2222", subject: "Recent two", pushed: false }),
    ],
  },
  pullRequest: null,
  warnings: [],
};

const parse = (data: BranchContextData): ParsedPayload =>
  JSON.parse(renderBranchContextJson(data)) as ParsedPayload;

describe("renderBranchContextJson", () => {
  test("emits only inRepo/pullRequest/warnings when not in a repo", () => {
    const parsed = parse({
      inRepo: false,
      pullRequest: null,
      warnings: ["no worktree"],
    });
    expect(parsed).toEqual({
      inRepo: false,
      pullRequest: null,
      warnings: ["no worktree"],
    });
  });

  test("serialises the payload keys the plugin reads on a feature branch", () => {
    expect(parse(featureData)).toMatchObject({
      inRepo: true,
      branchMetadata: { repositoryName: "repo" },
      status: {
        short: "## feature...origin/feature",
        unstaged: "M\tsrc/a.ts",
        staged: "A\tsrc/b.ts",
        untracked: "??\tsrc/c.ts",
      },
      workScope: {
        skipped: false,
        branchCommits: "abc1234 Add thing",
        branchFiles: "M\tsrc/a.ts",
      },
      pullRequest: { summary: { number: 42 } },
    });
  });

  test("omits the commits block on a feature branch, where branch scope covers it", () => {
    expect(parse(featureData).commits).toBeUndefined();
  });

  test("includes recent commits only when branch scope is skipped", () => {
    const parsed = parse(defaultBranchData);
    expect(parsed.workScope?.skipped).toBe(true);
    expect(parsed.workScope?.branchCommits).toBe("");
    expect(parsed.commits).toBe(
      "\u2713 aaa1111 1h ago Recent one\n\u2191 bbb2222 1h ago Recent two",
    );
  });

  test("truncates oversized blocks with a notice", () => {
    const longShort = "x".repeat(CHAR_LIMITS.status + 10);
    const parsed = parse({
      ...defaultBranchData,
      status: { ...status, short: longShort },
    });
    expect(
      parsed.status?.short?.startsWith("x".repeat(CHAR_LIMITS.status)),
    ).toBe(true);
    expect(parsed.status?.short).toContain("[TRUNCATED 10 CHARS]");
  });

  test("passes warnings through unchanged", () => {
    const parsed = parse({ ...featureData, warnings: ["gh missing"] });
    expect(parsed.warnings).toEqual(["gh missing"]);
  });
});
