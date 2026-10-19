import type { Checkout } from "./checkout.js";
import type { ChecksSection, CodeSection, GithubSection } from "./config.js";

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
  }[];
}

/** Result of any section. */
export type SectionResult = CodeResult | GithubResult | ChecksResult;
