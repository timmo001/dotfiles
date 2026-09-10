import type {
  Impact,
  ReleaseFact,
  ReleaseFinding,
  ReleaseRule,
  ReleaseSettings,
} from "./types.js";

/** Portable shipped-content boundaries; increment when classification semantics change. */
export const RELEASE_POLICY_VERSION = 5;

/** Build dependencies whose output is shipped by the application. */
export const SYSTEM_BRIDGE_BUILD_DEPENDENCIES = [
  "vite",
  "@tailwindcss/vite",
  "tailwindcss",
  "@tailwindcss/node",
  "@tailwindcss/oxide",
  "postcss",
] as const;

/** Independent products contribute file evidence, not application dependency graphs. */
export function separatelyPublishedPath(
  path: string,
  settings: ReleaseSettings,
): boolean {
  return (
    settings.policy === "system-bridge" &&
    ["docs", "omarchy-plugin"].some(
      (root) => path === root || path.startsWith(`${root}/`),
    )
  );
}

const tests: ReleaseRule = {
  paths: [
    "**/*.test.*",
    "**/*.spec.*",
    "**/*_test.go",
    "**/test/**",
    "**/tests/**",
    "**/__tests__/**",
    "**/testdata/**",
  ],
  impact: "none",
  reason: "Tests are not shipped",
};
const dependencies: readonly ReleaseRule[] = [
  {
    roles: ["runtime", "build"],
    impact: "patch",
    reason:
      "Runtime or build-output dependency changed; dependency semver does not set consumer impact",
  },
  {
    roles: ["peer"],
    impact: "patch",
    reason: "Published peer requirement changed",
  },
  {
    roles: ["development"],
    impact: "none",
    reason: "Development-only dependency changed",
  },
];

const presets: Record<ReleaseSettings["policy"], readonly ReleaseRule[]> = {
  "oxlint-rules": [
    tests,
    ...dependencies,
    {
      paths: ["vendor/anti-slop/src/**", "vendor/anti-slop/LICENSE"],
      impact: "patch",
      reason: "Upstream shipped rule content changed",
    },
    {
      submodules: ["vendor/anti-slop"],
      impact: "none",
      reason:
        "Upstream change outside shipped content; inspect the pin and upstream findings",
    },
    {
      paths: [
        ".github/**",
        ".agents/**",
        "tests/**",
        "tsconfig.json",
        "renovate.json",
        ".prettier*",
        ".oxlint*",
        "scripts/test.ts",
      ],
      impact: "none",
      reason: "Development tooling or CI-only change",
    },
    {
      paths: [
        "src/**",
        "dist/**",
        "skills/**",
        "scripts/build.ts",
        "README.md",
        "LICENSE",
        "THIRD_PARTY_NOTICES.md",
        "package.json",
      ],
      impact: "patch",
      reason: "Shipped package content or build definition changed",
    },
  ],
  "system-bridge": [
    {
      paths: ["docs/**", "omarchy-plugin/**"],
      impact: "none",
      reason: "Separately deployed docs or independently published plugin",
    },
    tests,
    {
      dependencies: [
        "github.com/stretchr/testify",
        "github.com/davecgh/go-spew",
        "github.com/pmezard/go-difflib",
      ],
      impact: "none",
      reason: "Go test support dependency changed",
    },
    ...dependencies,
    {
      paths: [
        ".github/actions/build-client-web/**",
        ".github/scripts/bash/package-*.sh",
        ".github/scripts/powershell/package-*.ps1",
        ".resources/**",
        "build/**",
      ],
      impact: "patch",
      reason: "Shipped package content or build definition changed",
    },
    {
      paths: [
        ".github/**",
        ".agents/**",
        ".cursor/**",
        ".vscode/**",
        "docs/**",
        "**/eslint*",
        "**/.prettier*",
        "**/tsconfig*",
        ".golangci.yml",
        ".markdownlint*",
        ".yamllint*",
        "renovate.json",
        "opencode.json",
        "pitchfork.toml",
        "README.md",
        "AGENTS.md",
        "CLAUDE.md",
        "package.json",
        "mise.lock",
      ],
      impact: "none",
      reason: "Documentation, lint/type tooling or CI-only change",
    },
    {
      paths: [
        "**/*.go",
        "web-client/**",
        "tui/**",
        "go.mod",
        "go.sum",
        "mise.toml",
        "LICENSE",
      ],
      impact: "patch",
      reason:
        "Shipped application, embedded client, TUI or package content changed",
    },
  ],
};

/** Match ordered selectors without inferring intent from ordinary commit prose. */
export function releaseRuleMatches(
  rule: ReleaseRule,
  fact: ReleaseFact,
): boolean {
  return (
    (!rule.paths ||
      rule.paths.some(
        (path) =>
          new Bun.Glob(path).match(fact.path) ||
          (fact.previousPath !== null &&
            new Bun.Glob(path).match(fact.previousPath)),
      )) &&
    (!rule.change_types || rule.change_types.includes(fact.changeType)) &&
    (!rule.dependencies ||
      (fact.dependency !== null &&
        rule.dependencies.includes(fact.dependency))) &&
    (!rule.roles || (fact.role !== null && rule.roles.includes(fact.role))) &&
    (!rule.submodules ||
      (fact.submodule !== null && rule.submodules.includes(fact.submodule))) &&
    (!rule.subjects ||
      rule.subjects.some((pattern) =>
        (fact.subjects ?? (fact.subject === null ? [] : [fact.subject])).some(
          (subject) => new RegExp(pattern).test(subject),
        ),
      ))
  );
}

/** Classify every net fact, retaining quiet and incomplete findings for inspection. */
export function classifyReleaseFacts(
  facts: readonly ReleaseFact[],
  settings: ReleaseSettings,
): ReleaseFinding[] {
  const findings = facts.map((fact) => {
    const override = settings.overrides?.find((rule) =>
      releaseRuleMatches(rule, fact),
    );
    const endpoints = [
      fact.path,
      ...(fact.previousPath === null ? [] : [fact.previousPath]),
    ].map((path) => {
      const match = presets[settings.policy].find((rule) =>
        releaseRuleMatches(rule, { ...fact, path, previousPath: null }),
      );
      return {
        impact: match?.impact ?? "patch",
        reason: match?.reason ?? "Policy default: patch; review this change",
      };
    });
    const affectedImpact = highestImpact(
      endpoints.map((endpoint) => endpoint.impact),
    );
    const match = endpoints.find(
      (endpoint) => endpoint.impact === affectedImpact,
    );
    const quietEvidence = fact.kind === "checksum" || fact.kind === "submodule";
    const impact =
      override?.impact ?? (quietEvidence ? "none" : affectedImpact);
    return {
      ...fact,
      automaticImpact: impact,
      impact,
      reason:
        override?.reason ??
        (quietEvidence
          ? fact.kind === "checksum"
            ? "Checksum or lock metadata only; package resolution unchanged"
            : "Pin changed; upstream net findings determine impact"
          : (match?.reason ?? "Policy default: patch; review this change")),
      reviewed: false,
    };
  });
  if (settings.source_minor_threshold === undefined) return findings;
  const sourceFindings = new Set(
    findings.filter(
      (finding) =>
        finding.kind === "file" &&
        finding.complete &&
        finding.automaticImpact !== "none" &&
        !/(^|\/)(package\.json|bun\.lockb?|go\.mod|go\.sum)$/.test(
          finding.path,
        ) &&
        !settings.overrides?.some((rule) =>
          releaseRuleMatches(rule, finding),
        ) &&
        [finding.path, finding.previousPath].some(
          (path) =>
            path !== null &&
            !(settings.source_excludes ?? []).some((pattern) =>
              new Bun.Glob(pattern).match(path),
            ),
        ),
    ),
  );
  const changedLines = [...sourceFindings].reduce(
    (total, finding) => total + (finding.changedLines ?? 0),
    0,
  );
  if (changedLines <= settings.source_minor_threshold) return findings;
  return findings.map((finding) =>
    sourceFindings.has(finding) && (finding.changedLines ?? 0) > 0
      ? {
          ...finding,
          automaticImpact: "minor",
          impact: "minor",
          reason: `Source size heuristic: ${changedLines} added/deleted lines across non-excluded shipped source (over ${settings.source_minor_threshold})`,
        }
      : finding,
  );
}

/** Return the highest suggested consumer impact. */
export function highestImpact(impacts: readonly Impact[]): Impact {
  const order: readonly Impact[] = ["none", "patch", "minor", "major"];
  return impacts.reduce(
    (highest, impact) =>
      order.indexOf(impact) > order.indexOf(highest) ? impact : highest,
    "none",
  );
}
