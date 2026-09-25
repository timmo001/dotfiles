import Handlebars from "handlebars";
import { Predicate, Record } from "effect";
import type { DependencyPolicy } from "../config.js";
import { type Dependency, type Extraction } from "../model.js";
import { matchesPatterns } from "../rules.js";

/** Render imported templates with no user-provided helpers or prototype access. */
export function renderTemplate(
  template: string,
  values: Readonly<Record<string, string>>,
): string {
  return Handlebars.compile(template, { noEscape: true, strict: true })(values);
}

interface RegexRegion {
  text: string;
  index: number;
  groups: Record<string, string>;
  indices: Record<string, [number, number]>;
}

/** Match recursive regions with inherited captures and absolute source offsets. */
export function regexMatches(
  text: string,
  manager: DependencyPolicy["regexManagers"][number],
) {
  const root: RegexRegion = {
    text,
    index: 0,
    groups: {},
    indices: {},
  };

  let regions = [root];
  const matches: typeof regions = [];

  for (const pattern of manager.patterns) {
    regions = (manager.strategy === "recursive" ? regions : [root]).flatMap(
      (region) =>
        [...region.text.matchAll(new RegExp(pattern, "dg"))].map((match) => ({
          text: match[0],
          index: region.index + match.index,
          groups: { ...region.groups, ...match.groups },
          indices: {
            ...region.indices,
            ...Object.fromEntries(
              Object.entries(match.indices?.groups ?? {})
                .filter(([, span]) => span !== undefined)
                .map(([name, span]) => [
                  name,
                  [region.index + span[0], region.index + span[1]],
                ]),
            ),
          },
        })),
    );

    if (manager.strategy !== "recursive") matches.push(...regions);
  }

  return manager.strategy === "recursive" ? regions : matches;
}

/** Resolve one match's identity, including captures inherited from enclosing regions. */
export function regexDependency(
  file: string,
  groups: Readonly<Record<string, string>>,
  templates: DependencyPolicy["regexManagers"][number]["templates"],
): Dependency | undefined {
  const field = (name: keyof typeof templates, capture: string) =>
    templates[name] ? renderTemplate(templates[name], groups) : groups[capture];

  const name = field("dependency", "depName");
  const current = field("value", "currentValue");
  const datasource = field("datasource", "datasource");

  if (!name || !current || !datasource) return undefined;

  return {
    manager: "custom.regex",
    file,
    name,
    package: field("package", "packageName") ?? name,
    current,
    datasource,
    dependencyType: "regex",
    ...Record.filter(
      {
        digest: groups.currentDigest,
        versioning: field("versioning", "versioning"),
        extractVersion: field("extractVersion", "extractVersion"),
      },
      Predicate.isNotUndefined,
    ),
  };
}

/** Extract configured regex identities, preserving digest-only dependencies. */
export function extractRegex(
  file: string,
  text: string,
  managers: DependencyPolicy["regexManagers"],
): Extraction {
  const dependencies: Dependency[] = [];
  const blockers: string[] = [];

  for (const manager of managers) {
    if (!matchesPatterns(file, manager.files)) continue;

    if (manager.strategy && !["any", "recursive"].includes(manager.strategy)) {
      blockers.push(`${file}: unsupported regex strategy ${manager.strategy}`);
      continue;
    }

    for (const match of regexMatches(text, manager)) {
      const dependency = regexDependency(file, match.groups, manager.templates);

      if (!dependency) {
        blockers.push(
          `${file}: regex match lacks dependency, value or datasource`,
        );
        continue;
      }

      dependencies.push(dependency);
    }
  }

  return { dependencies, blockers };
}
