import * as report from "@timmo001/groundwork-report";
import { plural, signed } from "@timmo001/groundwork-report";
import { reportAssets } from "@timmo001/groundwork-report/assets" with { type: "macro" };
import type { ReportThemes } from "@timmo001/groundwork-report/desktop";
import { listFiles } from "./code.js";
import type {
  Bucket,
  DependenciesSection,
  DependencyCategory,
  Prerequisite,
  ReportConfig,
} from "./config.js";
import { DEPENDENCY_CATEGORIES } from "./config.js";
import { dependencyListFiles } from "./dependencies.js";
import type {
  ChecksResult,
  CodeResult,
  DependenciesResult,
  DependencyFile,
  GithubItem,
  GithubResult,
  SectionResult,
} from "./result.js";
import type { RunChanges, SectionChanges } from "./state.js";

/** Everything one run produced, ready to render. */
export interface ReportRun {
  readonly config: ReportConfig;
  /** Run date as `YYYY-MM-DD`. */
  readonly date: string;
  readonly results: readonly SectionResult[];
  readonly changes: RunChanges;
  /** Model-written "what changed" paragraph, when one was asked for and written. */
  readonly summary:
    { readonly text: string; readonly model: string } | undefined;
}

// Bundled when dot is built, so the compiled binary carries the page's CSS and script
const assets = await reportAssets();

const escapeMarkdown = (text: string) => text.replace(/([[\]\\*_`])/g, "\\$1");

const fileUrl = (
  result: CodeResult | ChecksResult | DependenciesResult,
  path: string,
) =>
  `https://github.com/${result.checkout.repository}/blob/${result.checkout.branch}/${path}`;

type Tone = NonNullable<Bucket["tone"]>;

const reportTones: Readonly<Record<Tone, report.Tone>> = {
  good: "success",
  warn: "warning",
  bad: "danger",
  neutral: "neutral",
};

/** A config tone as the report's status tone. */
const toneOf = (tone: Tone | undefined) => reportTones[tone ?? "neutral"];

/** Label, explanation and tone of each dependency category. */
function categoryInfo(
  section: DependenciesSection,
): Record<DependencyCategory, { label: string; detail: string; tone: Tone }> {
  const p = `\`${section.property}\``;

  return {
    ready: {
      label: "Ready now",
      detail: "Only reads members that existing contexts cover.",
      tone: "good",
    },
    unused: {
      label: "Never read",
      detail: `Declares ${p} but never reads it, so the field and its bindings can go.`,
      tone: "good",
    },
    helper: {
      label: "Narrow helpers first",
      detail: `Blocked only by helpers typed \`${section.broad_type}\` that just need a narrower type.`,
      tone: "warn",
    },
    child: {
      label: "Blocked by a child",
      detail: `Binds \`.${section.property}\` on a child element that still needs it.`,
      tone: "bad",
    },
    other: {
      label: "Broader work",
      detail:
        "Calls helpers that need more than a narrower type, or reads members no context covers.",
      tone: "bad",
    },
    pr: {
      label: "In an open PR",
      detail: "Already changed by an open pull request.",
      tone: "neutral",
    },
    container: {
      label: `Keeps ${section.property}`,
      detail: `Containers, routers and providers expected to keep ${p}.`,
      tone: "neutral",
    },
  };
}

const isRemaining = (file: DependencyFile) =>
  file.category !== "container" && file.category !== "pr";

const blockersOf = (file: DependencyFile) => [
  ...file.children,
  ...file.narrowable,
  ...file.broad,
];

/** "16 of 22 State summary rows" for the groups with most of `files`. */
function groupShares(
  files: readonly DependencyFile[],
  remaining: readonly DependencyFile[],
  limit: number,
) {
  const counts = new Map<string, number>();

  for (const file of files)
    counts.set(file.group, (counts.get(file.group) ?? 0) + 1);

  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(
      ([group, count]) =>
        `${count} of ${remaining.filter((file) => file.group === group).length} ${group.toLowerCase()}`,
    );
}

/** A prerequisite's numbers from this run. */
interface Impact {
  readonly text: string;
  readonly tone: Tone;
}

function prerequisiteImpact(
  result: DependenciesResult,
  step: Prerequisite,
): Impact[] {
  const remaining = result.files.filter(isRemaining);
  const impacts: Impact[] = [];

  if (step.blockers && step.blockers.length > 0) {
    const names = new Set(step.blockers);

    const blocked = remaining.filter((file) =>
      blockersOf(file).some((name) => names.has(name)),
    );

    const freed = blocked.filter(
      (file) =>
        file.uncovered.length === 0 &&
        blockersOf(file).every((name) => names.has(name)),
    );

    impacts.push(
      { text: plural(freed.length, "file") + " unblocked", tone: "good" },
      ...groupShares(freed, remaining, 2).map((text) => ({
        text,
        tone: "good" as const,
      })),
      { text: `${blocked.length} blocked in all`, tone: "neutral" },
    );
  }

  if (step.bindings && step.bindings.length > 0) {
    const counts = step.bindings.map(
      (tag) => [tag, result.bindings[tag] ?? 0] as const,
    );

    const total = counts.reduce((sum, [, count]) => sum + count, 0);

    impacts.push(
      { text: `${plural(total, "binding")} to remove`, tone: "good" },
      {
        text: counts.map(([tag, count]) => `${count} ${tag}`).join(", "),
        tone: "neutral",
      },
    );
  }

  if (step.category) {
    const info = categoryInfo(result.section)[step.category];

    impacts.push({
      text: `${plural(result.counts[step.category] ?? 0, "file")}: ${info.label.toLowerCase()}`,
      tone: info.tone,
    });
  }

  if (step.note) {
    const note = result.section.notes?.find((entry) => entry.id === step.note);

    const count = remaining.filter((file) =>
      file.notes.includes(step.note ?? ""),
    ).length;

    impacts.push({
      text: `${plural(count, "file")}: ${note?.label ?? step.note}`,
      tone: note?.tone ?? "warn",
    });
  }

  return impacts;
}

/** Helpers to narrow, most files first, for prerequisites about the helper category. */
const topHelpers = (result: DependenciesResult, limit: number) =>
  result.blockers
    .filter(
      (blocker) =>
        blocker.kind === "helper" &&
        result.files.some((file) => file.narrowable.includes(blocker.name)),
    )
    .sort((a, b) => b.files - a.files || a.name.localeCompare(b.name))
    .slice(0, limit);

/** Bucket label by id, falling back to the id. */
const bucketLabels = (result: CodeResult) =>
  new Map(result.section.buckets.map((bucket) => [bucket.id, bucket.label]));

/** One line of a section's changes, with optional sub-items. */
interface ChangeLine {
  readonly text: string;
  readonly items: readonly { readonly text: string; readonly url?: string }[];
}

const SHOWN = 10;

function codeChanges(result: CodeResult, change: SectionChanges): ChangeLine[] {
  const labels = bucketLabels(result);
  const label = (id: string) => labels.get(id) ?? id;

  const counts = result.section.buckets.flatMap((bucket) => {
    const moved = change.counts[bucket.id];

    return moved
      ? [
          `${bucket.label} ${moved.before} → ${moved.after} (${signed(moved.after - moved.before)})`,
        ]
      : [];
  });

  const byMove = new Map<string, string[]>();

  for (const { key, from, to } of change.moved) {
    const name = `${label(from)} → ${label(to)}`;

    byMove.set(name, [...(byMove.get(name) ?? []), key]);
  }

  return [
    ...(counts.length > 0 ? [{ text: counts.join(", "), items: [] }] : []),
    ...[...byMove.entries()].map(([name, paths]) => ({
      text: `${plural(paths.length, "file")} moved ${name}`,
      items: paths
        .slice(0, SHOWN)
        .map((path) => ({ text: path, url: fileUrl(result, path) })),
    })),
    ...(change.added.length > 0
      ? [
          {
            text: `${plural(change.added.length, "file")} newly counted`,
            items: [],
          },
        ]
      : []),
    ...(change.removed.length > 0
      ? [
          {
            text: `${plural(change.removed.length, "file")} no longer counted (removed or no longer matching)`,
            items: [],
          },
        ]
      : []),
  ];
}

function githubChanges(
  result: GithubResult,
  change: SectionChanges,
): ChangeLine[] {
  const byKey = new Map(result.items.map((item) => [`#${item.number}`, item]));

  return [
    ...(change.added.length > 0
      ? [
          {
            text: `New: ${change.added.length}`,
            items: change.added.map(({ key, to }) => ({
              text: `${key} ${to}`,
              url: byKey.get(key)?.url,
            })),
          },
        ]
      : []),
    ...(change.removed.length > 0
      ? [
          {
            text: `No longer matched by the search: ${change.removed.length}`,
            items: change.removed.map(({ key, from }) => ({
              text: `${key} ${from}`,
            })),
          },
        ]
      : []),
  ];
}

function checksChanges(change: SectionChanges): ChangeLine[] {
  return change.moved.length > 0 || change.added.length > 0
    ? [
        {
          text: `${plural(change.moved.length + change.added.length, "check")} changed`,
          items: [
            ...change.moved.map(({ key, from, to }) => ({
              text: `${key}: ${from} → ${to}`,
            })),
            ...change.added.map(({ key, to }) => ({
              text: `${key}: new, ${to}`,
            })),
          ],
        },
      ]
    : [];
}

function dependencyChanges(
  result: DependenciesResult,
  change: SectionChanges,
): ChangeLine[] {
  const info = categoryInfo(result.section);

  const label = (id: string) => {
    const category = DEPENDENCY_CATEGORIES.find((entry) => entry === id);

    return category ? info[category].label : id;
  };

  const counts = DEPENDENCY_CATEGORIES.flatMap((category) => {
    const moved = change.counts[category];

    return moved
      ? [
          `${info[category].label} ${moved.before} → ${moved.after} (${signed(moved.after - moved.before)})`,
        ]
      : [];
  });

  const byMove = new Map<string, string[]>();

  for (const { key, from, to } of change.moved) {
    const name = `${label(from)} → ${label(to)}`;

    byMove.set(name, [...(byMove.get(name) ?? []), key]);
  }

  return [
    ...(counts.length > 0 ? [{ text: counts.join(", "), items: [] }] : []),
    ...[...byMove.entries()].map(([name, paths]) => ({
      text: `${plural(paths.length, "file")} moved ${name}`,
      items: paths
        .slice(0, SHOWN)
        .map((path) => ({ text: path, url: fileUrl(result, path) })),
    })),
    ...(change.removed.length > 0
      ? [
          {
            text: `${plural(change.removed.length, "file")} no longer hold it`,
            items: change.removed
              .slice(0, SHOWN)
              .map(({ key }) => ({ text: key, url: fileUrl(result, key) })),
          },
        ]
      : []),
  ];
}

/** A section's changes since the last run, as lines; empty when nothing moved. */
export function changeLines(
  result: SectionResult,
  changes: RunChanges,
): ChangeLine[] {
  const change = changes?.[result.section.id];

  if (!change) return [];

  switch (result.type) {
    case "code":
      return codeChanges(result, change);
    case "github":
      return githubChanges(result, change);
    case "checks":
      return checksChanges(change);
    case "dependencies":
      return dependencyChanges(result, change);
  }
}

/** One-line headline of a run, for `[RESULT]` and the Inbox subject line. */
export function headline(run: ReportRun): string {
  return run.results
    .map((result) => {
      switch (result.type) {
        case "code":
          return result.section.buckets
            .map((bucket) => {
              const moved = run.changes?.[result.section.id]?.counts[bucket.id];

              return `${result.counts[bucket.id] ?? 0} ${bucket.label.toLowerCase()}${moved ? ` (${signed(moved.after - moved.before)})` : ""}`;
            })
            .join(", ");
        case "github":
          return `${result.items.length} ${result.section.title.toLowerCase()}`;
        case "checks":
          return `${result.checks.filter((check) => check.state === "active").length} of ${result.checks.length} checks active`;
        case "dependencies": {
          const info = categoryInfo(result.section);

          return (["ready", "unused", "helper"] as const)
            .map(
              (category) =>
                `${result.counts[category] ?? 0} ${info[category].label.toLowerCase()}`,
            )
            .join(", ");
        }
      }
    })
    .join(" · ");
}

/** Markdown lines of a dependencies section for the Inbox message. */
function dependenciesMarkdown(result: DependenciesResult): string[] {
  const { section } = result;
  const info = categoryInfo(section);

  const lines = [
    DEPENDENCY_CATEGORIES.map(
      (category) =>
        `${info[category].label}: **${result.counts[category] ?? 0}**`,
    ).join(" · "),
  ];

  if (section.prerequisites && section.prerequisites.length > 0)
    lines.push(
      "",
      "Next steps:",
      ...section.prerequisites.map(
        (step, index) =>
          `${index + 1}. **${escapeMarkdown(step.title)}**: ${prerequisiteImpact(
            result,
            step,
          )
            .map((impact) => escapeMarkdown(impact.text))
            .join(", ")}`,
      ),
    );

  const blockers = result.blockers.filter((blocker) => blocker.sole > 0);

  if (blockers.length > 0)
    lines.push(
      "",
      "Biggest blockers:",
      ...blockers
        .slice(0, 5)
        .map(
          (blocker) =>
            `- \`${blocker.name}\` (${blocker.kind}): only blocker of ${plural(blocker.sole, "file")}, blocks ${blocker.files}`,
        ),
    );

  for (const list of section.lists ?? []) {
    const files = dependencyListFiles(result, list);

    lines.push(
      "",
      `${escapeMarkdown(list.title)}: ${plural(files.length, "file")}`,
      ...files
        .slice(0, 5)
        .map(
          (file) =>
            `- [${escapeMarkdown(file.path)}](${fileUrl(result, file.path)}), reads ${file.reads}`,
        ),
      ...(files.length > 5 ? [`- and ${files.length - 5} more`] : []),
    );
  }

  return lines;
}

function githubMarkdown(item: GithubItem) {
  return `[#${item.number} ${escapeMarkdown(item.title)}](${item.url}) by ${escapeMarkdown(item.author)}${item.draft ? ", draft" : ""}`;
}

/** The Inbox message body: headline numbers, changes and the summary paragraph. */
export function renderMarkdown(run: ReportRun, pageFile: string | undefined) {
  const lines = [
    `**${escapeMarkdown(run.config.title)}** · ${run.date}`,
    "",
    ...(run.summary ? [run.summary.text, ""] : []),
    ...(run.changes
      ? []
      : ["First run, so changes show from the next one.", ""]),
  ];

  for (const result of run.results) {
    lines.push(`### ${escapeMarkdown(result.section.title)}`, "");

    if (result.type === "code")
      lines.push(
        result.section.buckets
          .map(
            (bucket) => `${bucket.label}: **${result.counts[bucket.id] ?? 0}**`,
          )
          .join(" · "),
      );

    if (result.type === "github")
      lines.push(
        ...(result.items.length > 0
          ? result.items
              .slice(0, SHOWN)
              .map((item) => `- ${githubMarkdown(item)}`)
          : ["None."]),
        ...(result.items.length > SHOWN
          ? [`- and ${result.items.length - SHOWN} more`]
          : []),
      );

    if (result.type === "checks")
      lines.push(
        ...result.checks
          .filter((check) => check.state !== "resolved")
          .map(
            (check) =>
              `- **${escapeMarkdown(check.title)}**${check.state === "missing" ? " (file missing)" : ""}: ${escapeMarkdown(check.finding)}`,
          ),
        `${result.checks.filter((check) => check.state === "resolved").length} resolved.`,
      );

    if (result.type === "dependencies")
      lines.push(...dependenciesMarkdown(result));

    const changes = changeLines(result, run.changes);

    if (changes.length > 0) {
      lines.push("", "Since last run:");

      for (const change of changes) {
        lines.push(`- ${escapeMarkdown(change.text)}`);

        for (const item of change.items)
          lines.push(
            `  - ${item.url ? `[${escapeMarkdown(item.text)}](${item.url})` : escapeMarkdown(item.text)}`,
          );
      }
    }

    lines.push("");
  }

  if (pageFile)
    lines.push(
      `[Full report](${pageFile})`,
      "",
      // Like the brief, the open question keeps the report in the Inbox's list until it's answered.
      ":::question",
      "Anything to follow up on from this report?",
      "",
      "Answering takes the report off your waiting list. The next run withdraws this question if it's still open.",
      "",
      "- [ ] Nothing, it's read",
      "- [ ] Yes, I'll reply with a note",
      "",
      "Recommended: Nothing, it's read",
      ":::",
    );

  return lines.join("\n").trimEnd();
}

/** A section's changes since the last run, under a heading. */
function changesBlock(
  result: SectionResult,
  changes: RunChanges,
): report.Content {
  const lines = changeLines(result, changes);

  if (lines.length === 0) return null;

  return [
    report.heading("Since last run"),
    report.list(
      lines.map((line) => ({
        content: line.text,
        items: line.items.map((item) =>
          item.url ? report.link(item.text, item.url) : item.text,
        ),
      })),
    ),
  ];
}

/** Each section's anchor and title row. */
const sectionOptions = (section: {
  readonly id: string;
  readonly title: string;
  readonly description?: string | undefined;
}) => ({
  id: section.id,
  title: section.title,
  description:
    section.description === undefined
      ? undefined
      : report.prose(section.description),
});

const yesNo = (value: boolean) => [value ? "yes" : "no"];

function codeBlock(result: CodeResult, run: ReportRun): report.Content {
  const { section } = result;
  const change = run.changes?.[section.id];

  const segments = (
    counts: Readonly<Record<string, number>>,
  ): report.Segment[] =>
    section.buckets.map((bucket) => ({
      label: bucket.label,
      value: counts[bucket.id] ?? 0,
      tone: toneOf(bucket.tone),
    }));

  const groups = new Map<string, Record<string, number>>();

  for (const file of result.files) {
    const counts = groups.get(file.group) ?? {};

    counts[file.bucket] = (counts[file.bucket] ?? 0) + 1;
    groups.set(file.group, counts);
  }

  const pending = (counts: Record<string, number>) =>
    section.buckets
      .filter((bucket) => bucket.tone !== "good")
      .reduce((sum, bucket) => sum + (counts[bucket.id] ?? 0), 0);

  const byGroup = [...groups.entries()].sort(
    (a, b) => pending(b[1]) - pending(a[1]),
  );

  const total = result.files.length;

  const done = section.buckets
    .filter((bucket) => bucket.tone === "good")
    .reduce((sum, bucket) => sum + (result.counts[bucket.id] ?? 0), 0);

  const buckets = new Map(section.buckets.map((bucket) => [bucket.id, bucket]));
  const hasPrs = result.files.some((file) => file.pullRequests.length > 0);
  const hasAllowed = result.files.some((file) => file.allowed);

  const pullRequestChips = (numbers: readonly number[]) =>
    numbers.map((number) => ({ text: `#${number}`, tone: "accent" as const }));

  return report.section(
    sectionOptions(section),
    report.breakdown(segments(result.counts)),
    report.stats(
      section.buckets.map((bucket) => {
        const moved = change?.counts[bucket.id];

        return {
          label: bucket.label,
          value: result.counts[bucket.id] ?? 0,
          tone: toneOf(bucket.tone),
          delta: moved ? signed(moved.after - moved.before) : undefined,
        };
      }),
    ),
    changesBlock(result, run.changes),
    report.heading(
      "By group",
      total > 0 ? `${Math.round((done / total) * 100)}% done` : undefined,
    ),
    report.table({
      label: `${section.title} by group`,
      columns: [
        { id: "group", header: "Group", wide: true },
        ...section.buckets.map((bucket) => ({
          id: bucket.id,
          header: bucket.label,
          numeric: true,
        })),
        { id: "progress", header: "Progress", sortable: false },
      ],
      rows: byGroup.map(([name, counts]) => ({
        group: name,
        ...Object.fromEntries(
          section.buckets.map((bucket) => [bucket.id, counts[bucket.id] ?? 0]),
        ),
        progress: { segments: segments(counts) },
      })),
    }),
    (section.lists ?? []).map((entry) => {
      const files = listFiles(result, entry);

      return report.expansion(
        {
          heading: entry.title,
          aside: report.chip(plural(files.length, "file")),
        },
        report.list(
          files.map((file) =>
            report.chips(
              report.link(file.path, fileUrl(result, file.path), {
                mono: true,
              }),
              Object.entries(file.metrics).map(([name, value]) =>
                report.delta(`${name} ${value}`),
              ),
              file.pullRequests.map((number) =>
                report.chip(`#${number}`, { tone: "accent" }),
              ),
            ),
          ),
        ),
      );
    }),
    report.heading("All files"),
    report.table({
      label: `${section.title}: all files`,
      group: "group",
      groupsCollapsed: true,
      // Every file is a long list: scrolled in its own frame, its header and
      // the open group's heading stay in view
      contained: true,
      sort: "path",
      search: "always",
      searchLabel: "Filter by path",
      columns: [
        { id: "path", header: "File", wide: true },
        { id: "group", header: "Group" },
        { id: "state", header: "State" },
        { id: "notes", header: "", sortable: false, searchable: false },
      ],
      filters: [
        {
          id: "bucket",
          label: "State",
          options: section.buckets.map((bucket) => ({
            value: bucket.id,
            label: bucket.label,
          })),
        },
        ...(hasPrs
          ? [
              {
                id: "pr",
                label: "Pull request",
                options: [
                  { value: "yes", label: "In a PR" },
                  { value: "no", label: "Not in a PR" },
                ],
              },
            ]
          : []),
        ...(hasAllowed
          ? [
              {
                id: "allowed",
                label: "Allowed",
                options: [
                  { value: "yes", label: "Allowed" },
                  { value: "no", label: "Not allowed" },
                ],
              },
            ]
          : []),
      ],
      rows: result.files.map((file) => {
        const bucket = buckets.get(file.bucket);
        const label = bucket?.label ?? file.bucket;

        return {
          path: {
            text: file.path,
            href: fileUrl(result, file.path),
            mono: true,
          },
          group: file.group,
          state: {
            value: label,
            badges: [{ text: label, tone: toneOf(bucket?.tone) }],
          },
          notes: {
            value: "",
            chips: [
              ...Object.entries(file.metrics)
                .filter(([, value]) => value > 0)
                .map(([name, value]) => ({ text: `${name} ${value}` })),
              ...pullRequestChips(file.pullRequests),
              ...(file.allowed ? [{ text: "Allowed" }] : []),
            ],
          },
          bucket: [file.bucket],
          pr: yesNo(file.pullRequests.length > 0),
          allowed: yesNo(file.allowed),
        };
      }),
    }),
  );
}

function githubBlock(result: GithubResult, run: ReportRun): report.Content {
  const added = new Set(
    run.changes?.[result.section.id]?.added.map(({ key }) => key) ?? [],
  );

  return report.section(
    {
      ...sectionOptions(result.section),
      actions: report.chip(plural(result.items.length, "result")),
    },
    report.cards(
      result.items.map((item) => ({
        heading: `#${item.number} ${item.title}`,
        href: item.url,
        content: report.chips(
          added.has(`#${item.number}`)
            ? report.chip("New", { tone: "accent" })
            : null,
          item.draft ? report.badge("Draft", { tone: "warning" }) : null,
          item.state === "MERGED"
            ? report.badge("Merged", { tone: "success" })
            : null,
          report.chip(item.author),
          item.additions === undefined
            ? null
            : report.chip(`+${item.additions} / −${item.deletions ?? 0}`),
          report.chip((item.mergedAt ?? item.updatedAt).slice(0, 10)),
          item.files.length > 0
            ? report.chip(plural(item.files.length, "file"))
            : null,
        ),
      })),
    ),
    result.dropped > 0
      ? report.note(
          `${plural(result.dropped, "result")} left out as not relevant by the decision model.`,
        )
      : null,
    changesBlock(result, run.changes),
  );
}

const checkStates = {
  active: { label: "Active", tone: "danger" },
  resolved: { label: "Resolved", tone: "success" },
  missing: { label: "File missing", tone: "warning" },
} as const satisfies Record<string, { label: string; tone: report.Tone }>;

function checksBlock(result: ChecksResult, run: ReportRun): report.Content {
  const verdicts = result.checks.some((check) => check.verdict !== undefined);

  return report.section(
    sectionOptions(result.section),
    report.table({
      label: result.section.title,
      columns: [
        { id: "check", header: "Check" },
        { id: "state", header: "State" },
        { id: "finding", header: "Finding", wide: true },
        ...(verdicts ? [{ id: "verdict", header: "Verdict" }] : []),
      ],
      rows: result.checks.map((check) => {
        const state = checkStates[check.state];

        return {
          check: {
            text: check.title,
            detail: {
              text: check.file,
              href: fileUrl(result, check.file),
              mono: true,
            },
          },
          state: {
            value: state.label,
            badges: [{ text: state.label, tone: state.tone }],
          },
          finding: { text: check.finding, muted: true },
          verdict:
            check.verdict !== undefined && check.state === "active"
              ? {
                  value: check.verdict,
                  badges: [{ text: check.verdict, tone: toneOf(check.tone) }],
                }
              : null,
        };
      }),
    }),
    changesBlock(result, run.changes),
  );
}

/** A table of files still holding the property, grouped when `grouped`. */
function dependencyTable(
  result: DependenciesResult,
  label: string,
  files: readonly DependencyFile[],
  grouped: boolean,
) {
  return report.table({
    label,
    group: grouped ? "group" : undefined,
    groupsCollapsed: grouped,
    contained: grouped,
    columns: [
      { id: "path", header: "File", wide: true },
      ...(grouped ? [{ id: "group", header: "Group" }] : []),
      { id: "reads", header: "Reads", numeric: true },
      {
        id: "uses",
        header: "Uses and blockers",
        sortable: false,
        searchable: false,
      },
    ],
    rows: files.map((file) => ({
      path: { text: file.path, href: fileUrl(result, file.path), mono: true },
      group: file.group,
      reads: file.reads,
      uses: {
        value: "",
        chips: [
          ...file.contexts.map((context) => ({ text: context })),
          ...file.uncovered.map((member) => ({
            text: `.${member}`,
            tone: "danger" as const,
          })),
          ...blockersOf(file).map((name) => ({
            text: name,
            tone: "warning" as const,
          })),
          ...file.notes.map((id) => {
            const note = result.section.notes?.find((entry) => entry.id === id);

            return {
              text: note?.label ?? id,
              tone: toneOf(note?.tone ?? "warn"),
            };
          }),
          ...file.pullRequests.map((number) => ({
            text: `#${number}`,
            tone: "accent" as const,
          })),
        ],
      },
    })),
  });
}

function dependenciesBlock(
  result: DependenciesResult,
  run: ReportRun,
): report.Content {
  const { section } = result;
  const info = categoryInfo(section);
  const change = run.changes?.[section.id];
  const steps = section.prerequisites ?? [];
  const blockers = result.blockers.slice(0, 15);

  return report.section(
    sectionOptions(section),
    report.stats(
      DEPENDENCY_CATEGORIES.map((category) => {
        const moved = change?.counts[category];

        return {
          label: info[category].label,
          value: result.counts[category] ?? 0,
          tone: toneOf(info[category].tone),
          delta: moved ? signed(moved.after - moved.before) : undefined,
          hint: info[category].detail.replaceAll("`", ""),
        };
      }),
    ),
    report.expansion(
      { heading: "What the categories mean" },
      report.list(
        DEPENDENCY_CATEGORIES.map((category) => [
          report.html`<strong>${info[category].label}</strong>: `,
          report.prose(info[category].detail),
        ]),
      ),
    ),
    changesBlock(result, run.changes),
    steps.length > 0
      ? [
          report.heading("Next steps"),
          report.list(
            steps.map((step) => ({
              content: [
                report.html`<strong>${step.title}</strong>`,
                report.paragraph(report.prose(step.text)),
                report.chips(
                  prerequisiteImpact(result, step).map((impact) =>
                    report.chip(impact.text, { tone: toneOf(impact.tone) }),
                  ),
                  step.category === "helper"
                    ? topHelpers(result, 8).map((blocker) =>
                        report.chip(`${blocker.name} ${blocker.files}`),
                      )
                    : null,
                ),
              ],
            })),
            { ordered: true },
          ),
        ]
      : null,
    blockers.length > 0
      ? [
          report.heading("Biggest blockers"),
          report.table({
            label: `${section.title}: biggest blockers`,
            columns: [
              { id: "blocker", header: "Blocker" },
              { id: "kind", header: "Kind" },
              { id: "sole", header: "Only blocker of", numeric: true },
              { id: "files", header: "Blocks", numeric: true },
              { id: "where", header: "Where it's the only one", wide: true },
            ],
            rows: blockers.map((blocker) => ({
              blocker: {
                text: blocker.name,
                href: blocker.path ? fileUrl(result, blocker.path) : undefined,
                mono: true,
              },
              kind: blocker.kind,
              sole: blocker.sole,
              files: blocker.files,
              where: {
                text: blocker.soleGroups
                  .slice(0, 3)
                  .map(
                    (group) =>
                      `${group.count} of ${group.of} ${group.group.toLowerCase()}`,
                  )
                  .join(", "),
                muted: true,
              },
            })),
          }),
        ]
      : null,
    (section.lists ?? []).map((entry) => {
      const files = dependencyListFiles(result, entry);

      return [
        report.heading(entry.title, plural(files.length, "file")),
        entry.description
          ? report.paragraph(report.prose(entry.description))
          : null,
        dependencyTable(
          result,
          `${section.title}: ${entry.title}`,
          files,
          entry.grouped === true,
        ),
      ];
    }),
  );
}

/** The full report page, on Groundwork's report template. */
export function renderHtml(run: ReportRun, themes: ReportThemes) {
  const checkouts = [
    ...new Map(
      run.results.flatMap((result) =>
        result.type === "github"
          ? []
          : [
              [
                `${result.checkout.repository}@${result.checkout.branch}`,
                result.checkout,
              ] as const,
            ],
      ),
    ).values(),
  ];

  const sections = run.results.map((result) => {
    switch (result.type) {
      case "code":
        return codeBlock(result, run);
      case "github":
        return githubBlock(result, run);
      case "checks":
        return checksBlock(result, run);
      case "dependencies":
        return dependenciesBlock(result, run);
    }
  });

  return report.reportPage({
    ...themes,
    title: run.config.title,
    description: run.config.description,
    lang: "en-GB",
    brand: "dot report",
    storageKey: "dot-report:theme",
    meta: [
      report.chip(run.date),
      ...checkouts.map((checkout) =>
        report.chip(
          `${checkout.repository}@${checkout.branch} ${checkout.commit}`,
          {
            href: `https://github.com/${checkout.repository}/commit/${checkout.commit}`,
          },
        ),
      ),
    ],
    assets,
    body: [
      run.summary
        ? report.alert({ tone: "info", heading: "What changed" }, [
            run.summary.text,
            " ",
            report.delta(run.summary.model),
          ])
        : null,
      run.changes
        ? null
        : report.note("First run, so changes show from the next one."),
      sections,
    ],
  });
}
