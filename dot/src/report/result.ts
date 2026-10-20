import type { Checkout } from "./checkout.js";
import type {
  Check,
  ChecksSection,
  CodeSection,
  DependenciesSection,
  DependencyCategory,
  GithubSection,
} from "./config.js";

/** One scanned file in a code section. */
export interface CodeFile {
  /** Path relative to the checkout. */
  readonly path: string;
  /** Id of the bucket it fell into. */
  readonly bucket: string;
  /** Label of the group its path belongs to. */
  readonly group: string;
  /** Whether it's on the section's `allowed` list. */
  readonly allowed: boolean;
  /** Match counts of the section's metrics. */
  readonly metrics: Readonly<Record<string, number>>;
  /** Pull request numbers from a GitHub section that change it. */
  readonly pullRequests: readonly number[];
}

/** Result of a code section. */
export interface CodeResult {
  readonly type: "code";
  readonly section: CodeSection;
  readonly checkout: Checkout;
  readonly files: readonly CodeFile[];
  /** Files per bucket id. */
  readonly counts: Readonly<Record<string, number>>;
}

/** One issue or pull request found by a GitHub section. */
export interface GithubItem {
  readonly kind: "pr" | "issue";
  readonly number: number;
  readonly title: string;
  readonly url: string;
  readonly repository: string;
  readonly author: string;
  /** GitHub state, such as `OPEN`, `MERGED` or `CLOSED`. */
  readonly state: string;
  readonly draft: boolean;
  readonly additions: number | undefined;
  readonly deletions: number | undefined;
  readonly updatedAt: string;
  readonly mergedAt: string | undefined;
  /** Changed file paths, only fetched for sections with `files_for`. */
  readonly files: readonly string[];
  /** Decision model relevance, when the section uses `decide`. */
  readonly relevance: number | undefined;
}

/** Result of a GitHub section. */
export interface GithubResult {
  readonly type: "github";
  readonly section: GithubSection;
  readonly items: readonly GithubItem[];
  /** Results the decision model dropped as not relevant. */
  readonly dropped: number;
}

/** State of one check: its finding holds, no longer holds, or the file is gone. */
export type CheckState = "active" | "resolved" | "missing";

/** Result of a checks section. */
export interface ChecksResult {
  readonly type: "checks";
  readonly section: ChecksSection;
  readonly checkout: Checkout;
  readonly checks: readonly {
    readonly title: string;
    readonly file: string;
    readonly finding: string;
    readonly state: CheckState;
    readonly verdict: string | undefined;
    readonly tone: Check["tone"];
  }[];
}

/** One file still holding the property, with what blocks it. */
export interface DependencyFile {
  readonly path: string;
  /** Group label from the code section. */
  readonly group: string;
  readonly category: DependencyCategory;
  /** Times the file reads the property. */
  readonly reads: number;
  /** Contexts covering the members it reads. */
  readonly contexts: readonly string[];
  /** Members it reads that no context covers. */
  readonly uncovered: readonly string[];
  /** Child element tags it binds the property on that still need it. */
  readonly children: readonly string[];
  /** Helpers it hands the property to that can be narrowed. */
  readonly narrowable: readonly string[];
  /** Helpers it hands the property to that need more than narrowing, or that weren't found. */
  readonly broad: readonly string[];
  /** Ids of the section notes whose pattern matches it. */
  readonly notes: readonly string[];
  /** Pull request numbers that change it. */
  readonly pullRequests: readonly number[];
}

/** A child element or helper that keeps files on the property. */
export interface Blocker {
  readonly kind: "child" | "helper";
  readonly name: string;
  /** File defining it, when found. */
  readonly path: string | undefined;
  /** Files it blocks. */
  readonly files: number;
  /** Files it's the only blocker of. */
  readonly sole: number;
  /** Groups where it's the only blocker, with how many files remain there. */
  readonly soleGroups: readonly {
    readonly group: string;
    readonly count: number;
    readonly of: number;
  }[];
}

/** Result of a dependencies section. */
export interface DependenciesResult {
  readonly type: "dependencies";
  readonly section: DependenciesSection;
  readonly checkout: Checkout;
  readonly files: readonly DependencyFile[];
  /** Files per category. */
  readonly counts: Readonly<Record<string, number>>;
  /** Blockers, most files they alone unblock first. */
  readonly blockers: readonly Blocker[];
  /** Property bindings per child tag named in the prerequisites. */
  readonly bindings: Readonly<Record<string, number>>;
}

/** Result of any section. */
export type SectionResult =
  CodeResult | GithubResult | ChecksResult | DependenciesResult;
