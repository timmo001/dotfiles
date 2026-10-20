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
import { PAGE_CSS, PAGE_SCRIPT } from "./page.js";
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

const esc = (text: string) =>
  text.replace(
    /[&<>"']/g,
    (char) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        char
      ] ?? char,
  );

const escapeMarkdown = (text: string) => text.replace(/([[\]\\*_`])/g, "\\$1");

const signed = (value: number) => (value > 0 ? `+${value}` : `${value}`);

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

const toneOf = (bucket: Bucket) => bucket.tone ?? "neutral";

const fileUrl = (
  result: CodeResult | ChecksResult | DependenciesResult,
  path: string,
) =>
  `https://github.com/${result.checkout.repository}/blob/${result.checkout.branch}/${path}`;

type Tone = NonNullable<Bucket["tone"]>;

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

/** Escape text, then show its backtick spans as code. */
const inlineHtml = (text: string) =>
  esc(text).replace(/`([^`]+)`/g, "<code>$1</code>");

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

function changesHtml(result: SectionResult, changes: RunChanges) {
  const lines = changeLines(result, changes);

  if (lines.length === 0) return "";

  return `<h3>Since last run</h3><ul class="changes">${lines
    .map(
      (line) =>
        `<li>${esc(line.text)}${
          line.items.length > 0
            ? `<ul>${line.items
                .map(
                  (item) =>
                    `<li>${item.url ? `<a href="${esc(item.url)}">${esc(item.text)}</a>` : esc(item.text)}</li>`,
                )
                .join("")}</ul>`
            : ""
        }</li>`,
    )
    .join("")}</ul>`;
}

function meter(result: CodeResult, counts: Readonly<Record<string, number>>) {
  const total =
    Object.values(counts).reduce((sum, count) => sum + count, 0) || 1;

  return result.section.buckets
    .map(
      (bucket) =>
        `<span class="tone-${toneOf(bucket)}" style="width:${(((counts[bucket.id] ?? 0) / total) * 100).toFixed(2)}%"></span>`,
    )
    .join("");
}

function codeHtml(result: CodeResult, run: ReportRun, index: number) {
  const { section } = result;
  const change = run.changes?.[section.id];

  const stats = section.buckets
    .map((bucket) => {
      const moved = change?.counts[bucket.id];

      return `<div class="stat"><b>${result.counts[bucket.id] ?? 0}</b><span><i class="dot tone-${toneOf(bucket)}"></i>${esc(bucket.label)}${moved ? ` <span class="delta">${signed(moved.after - moved.before)}</span>` : ""}</span></div>`;
    })
    .join("");

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

  const rows = [...groups.entries()]
    .sort((a, b) => pending(b[1]) - pending(a[1]))
    .map(
      ([name, counts]) =>
        `<tr><td>${esc(name)}</td>${section.buckets
          .map((bucket) => `<td class="num">${counts[bucket.id] ?? 0}</td>`)
          .join(
            "",
          )}<td><div class="mini">${meter(result, counts)}</div></td></tr>`,
    )
    .join("");

  const total = result.files.length;

  const done = section.buckets
    .filter((bucket) => bucket.tone === "good")
    .reduce((sum, bucket) => sum + (result.counts[bucket.id] ?? 0), 0);

  const totals = `<tfoot><tr><th>Total${total > 0 ? ` <span class="delta">${Math.round((done / total) * 100)}% done</span>` : ""}</th>${section.buckets
    .map((bucket) => `<th class="num">${result.counts[bucket.id] ?? 0}</th>`)
    .join(
      "",
    )}<th><div class="mini">${meter(result, result.counts)}</div></th></tr></tfoot>`;

  const lists = (section.lists ?? [])
    .map((list) => {
      const files = listFiles(result, list);

      return `<details class="group"><summary><span class="name">${esc(list.title)}</span><span class="count">${plural(files.length, "file")}</span></summary><ul class="files">${files
        .map(
          (file) =>
            `<li><a href="${esc(fileUrl(result, file.path))}">${esc(file.path)}</a>${Object.entries(
              file.metrics,
            )
              .map(
                ([name, value]) =>
                  `<span class="delta">${esc(name)} ${value}</span>`,
              )
              .join("")}${file.pullRequests
              .map((number) => `<span class="pill accent">#${number}</span>`)
              .join("")}</li>`,
        )
        .join("")}</ul></details>`;
    })
    .join("");

  const dataId = `ledger-${index}`;

  const data = JSON.stringify({
    base: `https://github.com/${result.checkout.repository}/blob/${result.checkout.branch}/`,
    labels: Object.fromEntries(
      section.buckets.map((bucket) => [bucket.id, bucket.label]),
    ),
    tones: Object.fromEntries(
      section.buckets.map((bucket) => [bucket.id, toneOf(bucket)]),
    ),
    files: result.files.map((file) => ({
      p: file.path,
      b: file.bucket,
      g: file.group,
      a: file.allowed,
      m: file.metrics,
      pr: file.pullRequests,
    })),
  }).replaceAll("</", "<\\/");

  const hasPrs = result.files.some((file) => file.pullRequests.length > 0);
  const hasAllowed = result.files.some((file) => file.allowed);

  return `<section id="${esc(section.id)}">
<h2>${esc(section.title)}</h2>
${section.description ? `<p class="lede">${esc(section.description)}</p>` : ""}
<div class="meter" role="img" aria-label="${esc(section.buckets.map((bucket) => `${result.counts[bucket.id] ?? 0} ${bucket.label}`).join(", "))}">${meter(result, result.counts)}</div>
<div class="stats">${stats}</div>
${changesHtml(result, run.changes)}
<div class="scroll"><table><thead><tr><th>Group</th>${section.buckets
    .map((bucket) => `<th class="num">${esc(bucket.label)}</th>`)
    .join(
      "",
    )}<th>Progress</th></tr></thead><tbody>${rows}</tbody>${totals}</table></div>
${lists}
<div data-ledger="${dataId}">
<h3>All files</h3>
<div class="controls">
<input type="search" placeholder="Filter by path" aria-label="Filter files by path">
${section.buckets
  .map(
    (bucket) =>
      `<button type="button" class="toggle" data-bucket="${esc(bucket.id)}" aria-pressed="false">${esc(bucket.label)}</button>`,
  )
  .join("")}
${hasPrs ? `<button type="button" class="toggle" data-flag="pr" aria-pressed="false">In a PR</button>` : ""}
${hasAllowed ? `<button type="button" class="toggle" data-flag="hideAllowed" aria-pressed="false">Hide allowed</button>` : ""}
<span class="delta result-count"></span>
</div>
<div class="ledger"></div>
<script type="application/json" id="${dataId}">${data}</script>
</div>
</section>`;
}

function githubHtml(result: GithubResult, run: ReportRun) {
  const added = new Set(
    run.changes?.[result.section.id]?.added.map(({ key }) => key) ?? [],
  );

  const cards = result.items
    .map((item) => {
      const pills = [
        item.draft ? `<span class="pill warn">Draft</span>` : "",
        item.state === "MERGED" ? `<span class="pill good">Merged</span>` : "",
        added.has(`#${item.number}`)
          ? `<span class="pill accent">New</span>`
          : "",
        `<span class="pill">${esc(item.author)}</span>`,
        item.additions !== undefined
          ? `<span class="pill">+${item.additions} / −${item.deletions ?? 0}</span>`
          : "",
        `<span class="pill">${esc((item.mergedAt ?? item.updatedAt).slice(0, 10))}</span>`,
        item.files.length > 0
          ? `<span class="pill">${plural(item.files.length, "file")}</span>`
          : "",
      ].join("");

      return `<div class="card"><a class="title" href="${esc(item.url)}">#${item.number} ${esc(item.title)}</a>${pills}</div>`;
    })
    .join("");

  return `<section id="${esc(result.section.id)}">
<h2>${esc(result.section.title)}</h2>
${result.section.description ? `<p class="lede">${esc(result.section.description)}</p>` : ""}
<div class="cards">${cards || `<p class="muted">None.</p>`}</div>
${result.dropped > 0 ? `<p class="note">${plural(result.dropped, "result")} left out as not relevant by the decision model.</p>` : ""}
${changesHtml(result, run.changes)}
</section>`;
}

const STATE_PILLS = {
  active: `<span class="pill bad">Active</span>`,
  resolved: `<span class="pill good">Resolved</span>`,
  missing: `<span class="pill warn">File missing</span>`,
} as const;

function checksHtml(result: ChecksResult, run: ReportRun) {
  const verdicts = result.checks.some((check) => check.verdict !== undefined);

  const rows = result.checks
    .map(
      (check) =>
        `<tr><td>${esc(check.title)}<br><a class="mono" href="${esc(fileUrl(result, check.file))}">${esc(check.file)}</a></td><td>${STATE_PILLS[check.state]}</td><td class="muted">${esc(check.finding)}</td>${
          verdicts
            ? `<td>${check.verdict && check.state === "active" ? `<span class="pill ${check.tone ?? "neutral"}">${esc(check.verdict)}</span>` : ""}</td>`
            : ""
        }</tr>`,
    )
    .join("");

  return `<section id="${esc(result.section.id)}">
<h2>${esc(result.section.title)}</h2>
${result.section.description ? `<p class="lede">${esc(result.section.description)}</p>` : ""}
<div class="scroll"><table><thead><tr><th>Check</th><th>State</th><th>Finding</th>${verdicts ? "<th>Verdict</th>" : ""}</tr></thead><tbody>${rows}</tbody></table></div>
${changesHtml(result, run.changes)}
</section>`;
}

const fileRow = (result: DependenciesResult, file: DependencyFile) => {
  const chips = [
    ...file.contexts.map(
      (context) => `<span class="pill">${esc(context)}</span>`,
    ),
    ...file.uncovered.map(
      (member) => `<span class="pill bad">.${esc(member)}</span>`,
    ),
    ...[...file.children, ...file.narrowable, ...file.broad].map(
      (name) => `<span class="pill warn">${esc(name)}</span>`,
    ),
    ...file.notes.map((id) => {
      const note = result.section.notes?.find((entry) => entry.id === id);

      return `<span class="pill ${note?.tone ?? "warn"}">${esc(note?.label ?? id)}</span>`;
    }),
    ...file.pullRequests.map(
      (number) => `<span class="pill accent">#${number}</span>`,
    ),
  ].join("");

  return `<tr><td><a class="mono" href="${esc(fileUrl(result, file.path))}">${esc(file.path)}</a></td><td class="num">${file.reads}</td><td>${chips}</td></tr>`;
};

const fileTable = (
  result: DependenciesResult,
  files: readonly DependencyFile[],
) =>
  `<div class="scroll"><table><thead><tr><th>File</th><th class="num">Reads</th><th>Uses and blockers</th></tr></thead><tbody>${files
    .map((file) => fileRow(result, file))
    .join("")}</tbody></table></div>`;

function dependenciesHtml(result: DependenciesResult, run: ReportRun) {
  const { section } = result;
  const info = categoryInfo(section);
  const change = run.changes?.[section.id];

  const stats = DEPENDENCY_CATEGORIES.map((category) => {
    const moved = change?.counts[category];

    return `<div class="stat" title="${esc(info[category].detail.replaceAll("`", ""))}"><b>${result.counts[category] ?? 0}</b><span><i class="dot tone-${info[category].tone}"></i>${esc(info[category].label)}${moved ? ` <span class="delta">${signed(moved.after - moved.before)}</span>` : ""}</span></div>`;
  }).join("");

  const legend = DEPENDENCY_CATEGORIES.map(
    (category) =>
      `<li><b>${esc(info[category].label)}</b>: ${inlineHtml(info[category].detail)}</li>`,
  ).join("");

  const steps = (section.prerequisites ?? [])
    .map((step) => {
      const helpers =
        step.category === "helper"
          ? topHelpers(result, 8)
              .map(
                (blocker) =>
                  `<span class="pill">${esc(blocker.name)} ${blocker.files}</span>`,
              )
              .join("")
          : "";

      return `<li><b>${esc(step.title)}</b><p>${inlineHtml(step.text)}</p><div>${prerequisiteImpact(
        result,
        step,
      )
        .map(
          (impact) =>
            `<span class="pill ${impact.tone}">${esc(impact.text)}</span>`,
        )
        .join("")}${helpers}</div></li>`;
    })
    .join("");

  const blockerRows = result.blockers
    .slice(0, 15)
    .map(
      (blocker) =>
        `<tr><td>${blocker.path ? `<a class="mono" href="${esc(fileUrl(result, blocker.path))}">${esc(blocker.name)}</a>` : `<span class="mono">${esc(blocker.name)}</span>`}</td><td>${blocker.kind}</td><td class="num">${blocker.sole}</td><td class="num">${blocker.files}</td><td class="muted">${blocker.soleGroups
          .slice(0, 3)
          .map(
            (group) =>
              `${group.count} of ${group.of} ${esc(group.group.toLowerCase())}`,
          )
          .join(", ")}</td></tr>`,
    )
    .join("");

  const lists = (section.lists ?? [])
    .map((list) => {
      const files = dependencyListFiles(result, list);
      const header = `<h3>${esc(list.title)} <span class="delta">${plural(files.length, "file")}</span></h3>${list.description ? `<p class="lede">${inlineHtml(list.description)}</p>` : ""}`;

      if (!list.grouped) return header + fileTable(result, files);

      const groups = new Map<string, DependencyFile[]>();

      for (const file of files)
        groups.set(file.group, [...(groups.get(file.group) ?? []), file]);

      return (
        header +
        [...groups.entries()]
          .sort((a, b) => b[1].length - a[1].length)
          .map(
            ([group, entries]) =>
              `<details class="group"><summary><span class="name">${esc(group)}</span><span class="count">${plural(entries.length, "file")}</span></summary>${fileTable(result, entries)}</details>`,
          )
          .join("")
      );
    })
    .join("");

  return `<section id="${esc(section.id)}">
<h2>${esc(section.title)}</h2>
${section.description ? `<p class="lede">${esc(section.description)}</p>` : ""}
<div class="stats">${stats}</div>
<details class="group"><summary><span class="name">What the categories mean</span></summary><ul class="files">${legend}</ul></details>
${changesHtml(result, run.changes)}
${steps ? `<h3>Next steps</h3><ol class="steps">${steps}</ol>` : ""}
${blockerRows ? `<h3>Biggest blockers</h3><div class="scroll"><table><thead><tr><th>Blocker</th><th>Kind</th><th class="num">Only blocker of</th><th class="num">Blocks</th><th>Where it's the only one</th></tr></thead><tbody>${blockerRows}</tbody></table></div>` : ""}
${lists}
</section>`;
}

/** The full report page. */
export function renderHtml(run: ReportRun) {
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

  const sections = run.results
    .map((result, index) => {
      switch (result.type) {
        case "code":
          return codeHtml(result, run, index);
        case "github":
          return githubHtml(result, run);
        case "checks":
          return checksHtml(result, run);
        case "dependencies":
          return dependenciesHtml(result, run);
      }
    })
    .join("\n");

  return `<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<title>${esc(run.config.title)}</title>
<style>${PAGE_CSS}</style>
</head>
<body>
<div class="wrap">
<header>
<h1>${esc(run.config.title)}</h1>
${run.config.description ? `<p class="lede">${esc(run.config.description)}</p>` : ""}
<div class="meta"><span>${esc(run.date)}</span>${checkouts
    .map(
      (checkout) =>
        `<span><a href="https://github.com/${esc(checkout.repository)}/commit/${esc(checkout.commit)}">${esc(checkout.repository)}@${esc(checkout.branch)} ${esc(checkout.commit)}</a></span>`,
    )
    .join("")}</div>
${run.summary ? `<p class="summary">${esc(run.summary.text)} <span class="delta">${esc(run.summary.model)}</span></p>` : ""}
${run.changes ? "" : `<p class="note">First run, so changes show from the next one.</p>`}
</header>
${sections}
</div>
<script>${PAGE_SCRIPT}</script>
</body>
</html>
`;
}
