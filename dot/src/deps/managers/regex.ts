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

    if (manager.strategy && manager.strategy !== "any") {
      blockers.push(`${file}: unsupported regex strategy ${manager.strategy}`);
      continue;
    }

    for (const pattern of manager.patterns) {
      for (const match of text.matchAll(new RegExp(pattern, "g"))) {
        const groups = match.groups ?? {};

        const field = (
          name: keyof typeof manager.templates,
          capture: string,
        ) =>
          manager.templates[name]
            ? renderTemplate(manager.templates[name], groups)
            : groups[capture];

        const name = field("dependency", "depName");
        const current = field("value", "currentValue");
        const datasource = field("datasource", "datasource");

        if (!name || !current || !datasource) {
          blockers.push(
            `${file}: regex match lacks dependency, value or datasource`,
          );
          continue;
        }

        const versioning = field("versioning", "versioning");
        const extractVersion = field("extractVersion", "extractVersion");
        dependencies.push({
          manager: "custom.regex",
          file,
          name,
          package: field("package", "packageName") ?? name,
          current,
          datasource,
          dependencyType: "regex",
          ...Record.filter(
            { digest: groups.currentDigest, versioning, extractVersion },
            Predicate.isNotUndefined,
          ),
        });
      }
    }
  }

  return { dependencies, blockers };
}
