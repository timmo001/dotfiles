import { dirname, join } from "node:path";
import {
  applyEdits,
  findNodeAtLocation,
  modify,
  parseTree,
} from "jsonc-parser";
import { Effect, Schema } from "effect";
import type { DependencyPolicy } from "./config.js";
import { extractDependencies } from "./extract.js";
import { dependencyIdentity, type Snapshot } from "./model.js";
import type { PlannedDependency } from "./plan.js";
import { extractRegex, renderTemplate } from "./managers/regex.js";
import { matchesPatterns } from "./rules.js";
import { DependencyRunError } from "./state.js";

function replaceOne(text: string, before: string, after: string) {
  if (
    !before ||
    text.indexOf(before) < 0 ||
    text.indexOf(before) !== text.lastIndexOf(before)
  )
    throw new DependencyRunError({
      message: "Dependency edit is missing or ambiguous",
    });

  return text.replace(before, () => after);
}

function npmValue(text: string, entry: PlannedDependency, exact: boolean) {
  const dependency = entry.dependency;
  const path = [dependency.dependencyType, dependency.name];
  const tree = parseTree(text);

  if (!tree)
    throw new DependencyRunError({
      message: `Invalid manifest: ${dependency.file}`,
    });
  const value = findNodeAtLocation(tree, path)?.value;

  if (!Schema.is(Schema.String)(value))
    throw new DependencyRunError({
      message: `Missing manifest value: ${dependency.name}`,
    });

  if (value.startsWith("$")) return text;
  const release = entry.selection.release;

  if (!release)
    throw new DependencyRunError({ message: "Missing selected release" });

  const candidate = exact
    ? release.version
    : (entry.selection.candidate ?? release.version);

  const next =
    dependency.datasource === "npm"
      ? value.startsWith("npm:")
        ? value.slice(0, value.lastIndexOf("@") + 1) + candidate
        : candidate
      : value.split("#")[0] + "#" + (release.digest ?? candidate);

  return applyEdits(text, modify(text, path, next, {}));
}

function editText(
  text: string,
  entry: PlannedDependency,
  policy: DependencyPolicy,
) {
  const dependency = entry.dependency;
  const release = entry.selection.release;

  if (!release)
    throw new DependencyRunError({ message: "Missing selected release" });
  const next = entry.selection.candidate ?? release.version;

  if (dependency.manager === "npm") return npmValue(text, entry, false);

  if (dependency.manager === "github-actions") {
    const before = `${dependency.name}@${dependency.digest ?? dependency.current}`;
    const after = `${dependency.name}@${release.digest && (dependency.digest || entry.selection.settings.pinDigests) ? release.digest : next}`;
    let count = 0;

    const updated = text.replace(
      /^(\s*(?:-\s*)?uses:\s*["']?)([^\s"'#]+)(["']?)([^\r\n]*)/gm,
      (line, prefix: string, value: string, quote: string, suffix: string) => {
        if (value !== before) return line;
        count++;

        const comment =
          dependency.digest && dependency.current !== "HEAD"
            ? suffix.replace(/(#\s*)\S+/, `$1${next}`)
            : suffix;

        return `${prefix}${after}${quote}${comment}`;
      },
    );

    if (!count)
      throw new DependencyRunError({
        message: `Cannot locate action ${before}`,
      });

    return updated;
  }

  if (dependency.manager === "mise") {
    let tools = false;
    let count = 0;

    const updated = text.replace(/[^\r\n]+/g, (line) => {
      if (/^\s*\[/.test(line)) tools = /^\s*\[tools\]\s*(?:#.*)?$/.test(line);

      if (!tools) return line;

      const key = /^\s*(?:"([^"\n]+)"|'([^'\n]+)'|([^\s=]+))\s*=\s*(.*)$/.exec(
        line,
      );

      if (!key || (key[1] ?? key[2] ?? key[3]) !== dependency.name) return line;

      const before =
        dependency.datasource === "git-refs"
          ? dependency.digest
            ? `rev:${dependency.digest}`
            : undefined
          : dependency.current;

      if (before === undefined)
        throw new DependencyRunError({
          message: `Pin the mise Git reference for ${dependency.name} before updating`,
        });

      const value =
        dependency.datasource === "git-refs" ? `rev:${release.digest}` : next;

      const literal = [JSON.stringify(before), `'${before}'`].find(
        (candidate) => key[4].includes(candidate),
      );

      if (!literal)
        throw new DependencyRunError({
          message: `Cannot locate mise pin ${dependency.name}`,
        });
      count++;

      return replaceOne(
        line,
        literal,
        literal[0] === "'" ? `'${value}'` : JSON.stringify(value),
      );
    });

    if (count !== 1)
      throw new DependencyRunError({
        message: `Ambiguous mise pin ${dependency.name}`,
      });

    return updated;
  }

  if (dependency.manager === "custom.regex") {
    const edits: { start: number; end: number; value: string }[] = [];

    for (const manager of policy.regexManagers) {
      if (!matchesPatterns(dependency.file, manager.files)) continue;

      for (const pattern of manager.patterns) {
        for (const match of text.matchAll(new RegExp(pattern, "dg"))) {
          const extracted = extractRegex(dependency.file, match[0], [manager]);

          if (
            !extracted.dependencies.some(
              (item) =>
                dependencyIdentity(item) === dependencyIdentity(dependency) &&
                item.current === dependency.current &&
                item.digest === dependency.digest,
            )
          )
            continue;

          if (manager.templates.replacement) {
            edits.push({
              start: match.index,
              end: match.index + match[0].length,
              value: renderTemplate(manager.templates.replacement, {
                ...match.groups,
                newValue: next,
                newDigest: release.digest ?? "",
              }),
            });
          } else {
            const value = match.indices?.groups?.currentValue;
            const digest = match.indices?.groups?.currentDigest;

            if (!value || (dependency.digest && (!digest || !release.digest)))
              throw new DependencyRunError({
                message: `Regex ${dependency.name} needs an explicit replacement template`,
              });
            edits.push({ start: value[0], end: value[1], value: next });

            if (digest && release.digest)
              edits.push({
                start: digest[0],
                end: digest[1],
                value: release.digest,
              });
          }
        }
      }
    }

    if (!edits.length)
      throw new DependencyRunError({
        message: `Cannot locate regex dependency ${dependency.name}`,
      });
    let end = text.length;

    for (const edit of edits.sort((a, b) => b.start - a.start)) {
      if (edit.end > end)
        throw new DependencyRunError({
          message: `Overlapping regex edits for ${dependency.name}`,
        });
      text = text.slice(0, edit.start) + edit.value + text.slice(edit.end);
      end = edit.start;
    }

    return text;
  }

  throw new DependencyRunError({
    message: `Unsupported native edit manager: ${dependency.manager}`,
  });
}

/** Prepare exact text changes and temporary exact npm pins for deterministic lock regeneration. */
export const prepareDependencyEdits = Effect.fn("Dependencies.prepareEdits")(
  function* (
    snapshot: Snapshot,
    policy: DependencyPolicy,
    entries: readonly PlannedDependency[],
  ) {
    const files: Record<string, string> = {};
    const pinned: Record<string, string> = {};
    const gitlinks: Record<string, string> = {};
    const seen = new Set<string>();

    for (const entry of entries) {
      const dependency = entry.dependency;

      const key = JSON.stringify([
        dependencyIdentity(dependency),
        dependency.current,
        dependency.digest,
      ]);

      if (seen.has(key)) continue;
      seen.add(key);

      if (dependency.manager === "git-submodules") {
        const digest = entry.selection.release?.digest;

        if (!digest || !/^[a-f\d]{40}$/i.test(digest))
          return yield* new DependencyRunError({
            message: "Missing submodule commit",
          });
        gitlinks[dependency.name] = digest;
        continue;
      }

      const original =
        files[dependency.file] ?? snapshot.files[dependency.file];

      if (original === undefined)
        return yield* new DependencyRunError({
          message: `Missing pinned file ${dependency.file}`,
        });
      files[dependency.file] = yield* Effect.try({
        try: () => editText(original, entry, policy),
        catch: (error) =>
          error instanceof DependencyRunError
            ? error
            : new DependencyRunError({
                message: `Cannot prepare ${dependency.file}`,
              }),
      });

      if (dependency.manager === "npm") {
        const lock = join(dirname(dependency.file), "bun.lock");

        if (!(lock in snapshot.files))
          return yield* new DependencyRunError({
            message: `${dependency.file}: publication requires an adjacent text Bun lockfile`,
          });
        pinned[dependency.file] = files[dependency.file];
      }
    }

    for (const entry of entries)
      if (entry.dependency.manager === "npm")
        pinned[entry.dependency.file] = yield* Effect.try({
          try: () => npmValue(pinned[entry.dependency.file], entry, true),
          catch: () =>
            new DependencyRunError({
              message: "Cannot prepare exact Bun resolution",
            }),
        });

    return {
      files,
      pinned,
      gitlinks,
      allowed: [
        ...new Set([
          ...Object.keys(files),
          ...Object.keys(gitlinks),
          ...Object.keys(pinned).map((file) => join(dirname(file), "bun.lock")),
        ]),
      ],
    };
  },
);

/** Reject dependency changes outside the group and require every selected resolution. */
export const verifyDependencyEdits = Effect.fn("Dependencies.verifyEdits")(
  function* (
    before: Snapshot,
    after: Snapshot,
    policy: DependencyPolicy,
    entries: readonly PlannedDependency[],
  ) {
    const original = yield* extractDependencies(before, policy);
    const prepared = yield* extractDependencies(after, policy);

    if (prepared.blockers.length)
      return yield* new DependencyRunError({
        message: prepared.blockers.join("; "),
      });

    const remaining = [...prepared.dependencies];

    for (const dependency of original.dependencies) {
      const key = dependencyIdentity(dependency);

      const entry = entries.find(
        (item) =>
          dependencyIdentity(item.dependency) === key &&
          item.dependency.current === dependency.current &&
          item.dependency.digest === dependency.digest,
      );

      const release = entry?.selection.release;

      const digest =
        entry &&
        (dependency.digest ||
          dependency.datasource === "git-refs" ||
          entry.selection.settings.pinDigests);

      const index = remaining.findIndex((next) => {
        if (dependencyIdentity(next) !== key) return false;

        if (!entry || !release)
          return (
            next.current === dependency.current &&
            next.digest === dependency.digest &&
            next.resolved === dependency.resolved
          );

        if (
          digest
            ? next.digest !== release.digest
            : next.current !== (entry.selection.candidate ?? release.version)
        )
          return false;

        return (
          dependency.manager !== "npm" ||
          dependency.datasource !== "npm" ||
          next.resolved === release.version
        );
      });

      if (index < 0)
        return yield* new DependencyRunError({
          message: `Unexpected prepared dependency value or Bun resolution: ${dependency.name}`,
        });
      remaining.splice(index, 1);
    }

    if (remaining.length)
      return yield* new DependencyRunError({
        message: "Prepared dependency identities changed",
      });
  },
);
