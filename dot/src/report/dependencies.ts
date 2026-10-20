import { Effect, FileSystem } from "effect";
import { join } from "node:path";
import { globFiles } from "./code.js";
import type {
  DependenciesSection,
  DependencyCategory,
  DependencyList,
} from "./config.js";
import { DEPENDENCY_CATEGORIES } from "./config.js";
import type {
  Blocker,
  CodeResult,
  DependenciesResult,
  DependencyFile,
} from "./result.js";

/** Words a helper-call regex catches that are never helpers. */
const KEYWORDS = new Set(["if", "for", "while", "switch", "return", "super"]);

/** A helper exported with a parameter named after the property. */
interface HelperDefinition {
  readonly path: string;
  /** Whether the parameter is the broad type. */
  readonly broad: boolean;
  /** Contexts covering the members it reads; `undefined` when a member is uncovered. */
  readonly contexts: readonly string[] | undefined;
  /** Whether it hands the property on to another call. */
  readonly passes: boolean;
}

const unique = <A>(values: Iterable<A>) => [...new Set(values)];

const escapeRegex = (text: string) =>
  text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** Captures of group 1 of a global regex. */
const captures = (regex: RegExp, text: string) =>
  [...text.matchAll(regex)].flatMap((match) =>
    match[1] === undefined ? [] : [match[1]],
  );

/** The regexes for one property, built once per run. */
function patternsFor(property: string, type: string) {
  const p = escapeRegex(property);

  return {
    reads: new RegExp(`this\\.${p}\\b`, "g"),
    members: new RegExp(`this\\.${p}!?\\.(\\w+)`, "g"),
    calls: new RegExp(
      `\\b([A-Za-z_$][\\w$]*)\\(\\s*(?:[^()]*?,\\s*)?this\\.${p}!?\\s*[,)]`,
      "g",
    ),
    children: new RegExp(
      `<([a-z][\\w-]*-[\\w-]*)\\b(?:(?!<[a-z]).)*?\\.${p}=\\$\\{\\s*this\\.${p}\\s*\\}`,
      "gs",
    ),
    elements: /@customElement\("([^"]+)"\)/g,
    definitions:
      /export (?:const|async function|function) ([\w$]+)\s*(?:=\s*(?:async\s*)?(?:<[^>]*>)?\s*\(|<[^>]*>\s*\(|\()([^)]*?)\)/gs,
    parameter: new RegExp(
      `\\b${p}\\s*\\??:\\s*([\\w<>\\[\\]|" ,]+?)\\s*(?:[,=]|$)`,
    ),
    bodyMembers: new RegExp(`\\b${p}!?\\s*\\.(\\w+)`, "g"),
    passes: new RegExp(`\\(\\s*(?:[^()]*?,\\s*)?${p}\\s*[,)]`),
    type: type.trim(),
  };
}

/** Contexts covering `members`, and the members none covers. */
function contextsOf(
  members: readonly string[],
  contextByMember: ReadonlyMap<string, string>,
) {
  const covered = members.flatMap((member) => {
    const context = contextByMember.get(member);

    return context === undefined ? [] : [context];
  });

  return {
    contexts: unique(covered).sort(),
    uncovered: unique(
      members.filter((member) => !contextByMember.has(member)),
    ).sort(),
  };
}

/** Helpers exported in `text` that take the property. */
function helperDefinitions(
  path: string,
  text: string,
  patterns: ReturnType<typeof patternsFor>,
  contextByMember: ReadonlyMap<string, string>,
): [string, HelperDefinition][] {
  return [...text.matchAll(patterns.definitions)].flatMap((match) => {
    const [, name, params] = match;
    const parameter = params?.match(patterns.parameter)?.[1];

    if (!name || parameter === undefined) return [];

    const rest = text.slice((match.index ?? 0) + match[0].length);
    const next = rest.search(/\nexport /);
    const body = next === -1 ? rest : rest.slice(0, next);

    const { contexts, uncovered } = contextsOf(
      captures(patterns.bodyMembers, body),
      contextByMember,
    );

    return [
      [
        name,
        {
          path,
          broad: parameter.trim() === patterns.type,
          contexts: uncovered.length > 0 ? undefined : contexts,
          passes: patterns.passes.test(body),
        },
      ],
    ];
  });
}

/** Whether `path` matches a container glob or `text` a container pattern. */
const isContainer = (
  section: DependenciesSection,
  globs: readonly InstanceType<typeof Bun.Glob>[],
  path: string,
  text: string,
) =>
  globs.some((glob) => glob.match(path)) ||
  (section.containers?.patterns ?? []).some((pattern) =>
    new RegExp(pattern, "m").test(text),
  );

/**
 * Work out what keeps each file of the code section's `buckets` on the
 * property: child elements that still need it, helpers typed with the broad
 * type, and members no context covers. Files with none of those are ready.
 */
export const runDependenciesSection = Effect.fn("report.dependencies")(
  function* (section: DependenciesSection, code: CodeResult) {
    const fs = yield* FileSystem.FileSystem;
    const { checkout } = code;
    const patterns = patternsFor(section.property, section.broad_type);

    const contextByMember = new Map(
      Object.entries(section.contexts).flatMap(([context, members]) =>
        members.map((member) => [member, context] as const),
      ),
    );

    const narrowable = new Set(section.narrowable);
    const ignored = new Set(section.ignore_helpers ?? []);
    const allowed = new Set(code.section.allowed ?? []);
    const holding = new Set(section.buckets);

    const containerGlobs = (section.containers?.paths ?? []).map(
      (pattern) => new Bun.Glob(pattern),
    );

    const notes = (section.notes ?? []).map(
      (note) => [note.id, new RegExp(note.pattern, "m")] as const,
    );

    const paths = yield* globFiles(
      checkout.path,
      code.section.include,
      code.section.exclude ?? [],
    );

    const texts = new Map(
      yield* Effect.forEach(
        paths,
        (path) =>
          fs
            .readFileString(join(checkout.path, path))
            .pipe(Effect.map((text) => [path, text] as const)),
        { concurrency: 32 },
      ),
    );

    const elements = new Map<string, string>();
    const helpers = new Map<string, HelperDefinition>();

    for (const [path, text] of texts) {
      for (const tag of captures(patterns.elements, text))
        elements.set(tag, path);

      for (const [name, definition] of helperDefinitions(
        path,
        text,
        patterns,
        contextByMember,
      ))
        // The first definition wins, like a name clash in an import would.
        if (!helpers.has(name)) helpers.set(name, definition);
    }

    const reads = (path: string) =>
      (texts.get(path) ?? "").match(patterns.reads)?.length ?? 0;

    const holdingPaths = new Set(
      code.files
        .filter((file) => holding.has(file.bucket))
        .map((file) => file.path),
    );

    /** A child blocks while its file still holds the property and reads it. */
    const childBlocks = (tag: string) => {
      const path = elements.get(tag);

      return path !== undefined && holdingPaths.has(path) && reads(path) > 0;
    };

    const files = code.files
      .filter((file) => holding.has(file.bucket))
      .map((file): DependencyFile => {
        const text = texts.get(file.path) ?? "";
        const count = reads(file.path);

        const { contexts, uncovered } = contextsOf(
          captures(patterns.members, text),
          contextByMember,
        );

        const called = unique(captures(patterns.calls, text)).filter(
          (name) => !KEYWORDS.has(name) && !ignored.has(name),
        );

        const isNarrowable = (name: string) => {
          const definition = helpers.get(name);

          return (
            definition !== undefined &&
            definition.broad &&
            !definition.passes &&
            definition.contexts !== undefined &&
            definition.contexts.every((context) => narrowable.has(context))
          );
        };

        const blocking = called.filter((name) => {
          const definition = helpers.get(name);

          return definition === undefined || definition.broad;
        });

        const children = unique(captures(patterns.children, text))
          .filter(childBlocks)
          .sort();

        const narrow = blocking.filter(isNarrowable).sort();
        const broad = blocking.filter((name) => !isNarrowable(name)).sort();

        const category: DependencyCategory =
          allowed.has(file.path) ||
          isContainer(section, containerGlobs, file.path, text)
            ? "container"
            : file.pullRequests.length > 0
              ? "pr"
              : count === 0
                ? "unused"
                : children.length > 0
                  ? "child"
                  : broad.length > 0 || uncovered.length > 0
                    ? "other"
                    : narrow.length > 0
                      ? "helper"
                      : "ready";

        return {
          path: file.path,
          group: file.group,
          category,
          reads: count,
          contexts,
          uncovered,
          children,
          narrowable: narrow,
          broad,
          notes: notes.flatMap(([id, regex]) => (regex.test(text) ? [id] : [])),
          pullRequests: file.pullRequests,
        };
      });

    const remaining = files.filter(
      (file) => file.category !== "container" && file.category !== "pr",
    );

    const groupTotals = new Map<string, number>();

    for (const file of remaining)
      groupTotals.set(file.group, (groupTotals.get(file.group) ?? 0) + 1);

    const tally = new Map<
      string,
      {
        kind: Blocker["kind"];
        files: number;
        sole: number;
        groups: Map<string, number>;
      }
    >();

    for (const file of remaining) {
      const names = [
        ...file.children.map((name) => ["child", name] as const),
        ...[...file.narrowable, ...file.broad].map(
          (name) => ["helper", name] as const,
        ),
      ];

      const sole = names.length === 1 && file.uncovered.length === 0;

      for (const [kind, name] of names) {
        const entry = tally.get(name) ?? {
          kind,
          files: 0,
          sole: 0,
          groups: new Map<string, number>(),
        };

        entry.files += 1;

        if (sole) {
          entry.sole += 1;
          entry.groups.set(file.group, (entry.groups.get(file.group) ?? 0) + 1);
        }

        tally.set(name, entry);
      }
    }

    const blockers = [...tally.entries()]
      .map(([name, entry]): Blocker => ({
        kind: entry.kind,
        name,
        path:
          entry.kind === "child" ? elements.get(name) : helpers.get(name)?.path,
        files: entry.files,
        sole: entry.sole,
        soleGroups: [...entry.groups.entries()]
          .map(([group, count]) => ({
            group,
            count,
            of: groupTotals.get(group) ?? count,
          }))
          .sort((a, b) => b.count - a.count),
      }))
      .sort(
        (a, b) =>
          b.sole - a.sole || b.files - a.files || a.name.localeCompare(b.name),
      );

    const tags = unique(
      (section.prerequisites ?? []).flatMap((step) => step.bindings ?? []),
    );

    const bindings = Object.fromEntries(
      tags.map((tag) => {
        const regex = new RegExp(
          `<${escapeRegex(tag)}(?![\\w-])(?:(?!<[a-z]).)*?\\.${escapeRegex(section.property)}=`,
          "gs",
        );

        let total = 0;

        for (const text of texts.values())
          total += text.match(regex)?.length ?? 0;

        return [tag, total] as const;
      }),
    );

    return {
      type: "dependencies",
      section,
      checkout,
      files,
      counts: Object.fromEntries(
        DEPENDENCY_CATEGORIES.map((category) => [
          category,
          files.filter((file) => file.category === category).length,
        ]),
      ),
      blockers,
      bindings,
    } satisfies DependenciesResult;
  },
);

/** Files of a dependencies list, fewest reads first. */
export const dependencyListFiles = (
  result: DependenciesResult,
  list: DependencyList,
) =>
  result.files
    .filter(
      (file) =>
        list.categories.includes(file.category) &&
        (list.prefixes === undefined ||
          list.prefixes.some((prefix) => file.path.startsWith(prefix))) &&
        !(list.exclude_prefixes ?? []).some((prefix) =>
          file.path.startsWith(prefix),
        ) &&
        (list.max_reads === undefined || file.reads <= list.max_reads) &&
        !(list.exclude_notes ?? []).some((note) => file.notes.includes(note)),
    )
    .sort((a, b) => a.reads - b.reads || a.path.localeCompare(b.path));
