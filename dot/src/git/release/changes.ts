import { createHash } from "node:crypto";
import { dirname, join } from "node:path";
import { existsSync, mkdirSync } from "node:fs";
import { Effect } from "effect";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import {
  decodeJsonObject,
  formatCause,
  isJsonObject,
  isString,
  type JsonObject,
  type JsonValue,
} from "../../lib/schema.js";
import {
  ReleaseError,
  type DependencyRole,
  type ReleaseCommit,
  type ReleaseFact,
  type ReleaseSettings,
} from "./types.js";
import {
  releaseRuleMatches,
  separatelyPublishedPath,
  SYSTEM_BRIDGE_BUILD_DEPENDENCIES,
} from "./policy.js";

/** Canonical representation for evidence hashes and structural comparisons. */
export function canonical(value: JsonValue | undefined): string {
  if (value === undefined) return "undefined";
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (isJsonObject(value))
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
      .join(",")}}`;
  return JSON.stringify(value) ?? "null";
}

/** Stable evidence identity, independent of scan time and branch head. */
export function evidenceId(value: JsonValue): string {
  return createHash("sha256").update(canonical(value)).digest("hex");
}

/** Construct a fact whose identity follows its actual old/new content. */
export function releaseFact(
  input: Omit<ReleaseFact, "id"> & { readonly id?: string },
): ReleaseFact {
  const {
    id: _id,
    complete: _complete,
    subjects: _subjects,
    evidenceUrl: _evidenceUrl,
    changedLines: _changedLines,
    ...evidence
  } = input;
  return { ...input, id: evidenceId(evidence) };
}

function object(value: JsonValue | undefined): JsonObject {
  if (value === undefined) return {};
  return decodeJsonObject(value);
}

function values(source: JsonObject, field: string): JsonObject {
  return object(source[field]);
}

function dependencyFact(
  path: string,
  name: string,
  role: DependencyRole,
  before: JsonValue | undefined,
  after: JsonValue | undefined,
  detail: string,
): ReleaseFact {
  return releaseFact({
    kind: "dependency",
    path,
    previousPath: null,
    changeType:
      before === undefined
        ? "added"
        : after === undefined
          ? "deleted"
          : "modified",
    before: before === undefined ? null : canonical(before),
    after: after === undefined ? null : canonical(after),
    dependency: name,
    role,
    submodule: null,
    subject: null,
    detail,
    complete: role !== "unknown",
  });
}

function buildDependency(name: string, settings: ReleaseSettings): boolean {
  return (
    settings.policy === "system-bridge" &&
    SYSTEM_BRIDGE_BUILD_DEPENDENCIES.some((dependency) => dependency === name)
  );
}

/** Split package manifests into dependency-role facts and other changed metadata. */
export function manifestChanges(
  path: string,
  before: string | null,
  after: string | null,
  settings: ReleaseSettings,
): ReleaseFact[] {
  const old = before === null ? {} : decodeJsonObject(JSON.parse(before));
  const next = after === null ? {} : decodeJsonObject(JSON.parse(after));
  const facts: ReleaseFact[] = [];
  const fields = [
    "dependencies",
    "optionalDependencies",
    "peerDependencies",
    "devDependencies",
  ];
  for (const field of fields) {
    const a = values(old, field);
    const b = values(next, field);
    for (const name of new Set([...Object.keys(a), ...Object.keys(b)])) {
      if (canonical(a[name]) === canonical(b[name])) continue;
      const runtime = [old, next].some(
        (manifest) =>
          name in values(manifest, "dependencies") ||
          name in values(manifest, "optionalDependencies"),
      );
      const role =
        field === "peerDependencies"
          ? "peer"
          : field !== "devDependencies" || runtime
            ? "runtime"
            : buildDependency(name, settings)
              ? "build"
              : "development";
      facts.push(
        dependencyFact(path, name, role, a[name], b[name], `${field}: ${name}`),
      );
    }
  }
  for (const key of new Set([...Object.keys(old), ...Object.keys(next)])) {
    if (fields.includes(key) || canonical(old[key]) === canonical(next[key]))
      continue;
    facts.push(
      releaseFact({
        kind: "metadata",
        path,
        previousPath: null,
        changeType: "modified",
        before: canonical(old[key]),
        after: canonical(next[key]),
        dependency: null,
        role: null,
        submodule: null,
        subject: null,
        detail: `Package metadata: ${key}`,
        complete: true,
      }),
    );
  }
  return facts;
}

interface LockGraph {
  readonly packages: JsonObject;
  readonly roles: ReadonlyMap<string, DependencyRole>;
  readonly errors: readonly string[];
}

function lockGraph(
  source: string | null,
  settings: ReleaseSettings,
): LockGraph {
  if (source === null) return { packages: {}, roles: new Map(), errors: [] };
  const lock = decodeJsonObject(Bun.JSONC.parse(source));
  if (lock.lockfileVersion !== 1 && lock.lockfileVersion !== 2)
    throw new Error("Unsupported Bun lockfile version");
  const packages = values(lock, "packages");
  const workspaces = values(lock, "workspaces");
  if (!Object.keys(workspaces).length)
    throw new Error("Bun lockfile has no workspace dependency roots");
  const roles = new Map<string, DependencyRole>();
  const errors = new Set<string>();
  const queue: { key: string; role: DependencyRole }[] = [];
  const rank = { unknown: 0, development: 1, peer: 2, build: 3, runtime: 4 };
  const resolve = (name: string, parent: string) => {
    for (
      let scope = parent;
      scope;
      scope = scope.includes("/") ? scope.slice(0, scope.lastIndexOf("/")) : ""
    ) {
      if (`${scope}/${name}` in packages) return `${scope}/${name}`;
    }
    return name in packages ? name : undefined;
  };
  const enqueue = (
    name: string,
    parent: string,
    role: DependencyRole,
    optional: boolean,
  ) => {
    const key = resolve(name, parent);
    if (key === undefined) {
      if (!optional)
        errors.add(
          `Unresolved Bun dependency ${name} from ${parent || "root"}`,
        );
      return;
    }
    if (rank[roles.get(key) ?? "unknown"] >= rank[role]) return;
    roles.set(key, role);
    queue.push({ key, role });
  };
  for (const [workspace, value] of Object.entries(workspaces)) {
    const manifest = object(value);
    for (const field of [
      "dependencies",
      "optionalDependencies",
      "devDependencies",
    ]) {
      for (const name of Object.keys(values(manifest, field)))
        enqueue(
          name,
          workspace,
          field === "devDependencies"
            ? buildDependency(name, settings)
              ? "build"
              : "development"
            : "runtime",
          field === "optionalDependencies",
        );
    }
  }
  for (let index = 0; index < queue.length; index++) {
    const { key, role } = queue[index];
    const record = packages[key];
    if (!Array.isArray(record) || !isString(record[0]))
      throw new Error(`Invalid Bun package record: ${key}`);
    const workspacePath = record[0].split("@workspace:")[1];
    const metadata =
      workspacePath !== undefined
        ? object(workspaces[workspacePath])
        : object(record[2]);
    for (const field of [
      "dependencies",
      "optionalDependencies",
      "peerDependencies",
    ]) {
      for (const name of Object.keys(values(metadata, field))) {
        const optionalPeers = metadata.optionalPeers;
        const optional =
          field === "optionalDependencies" ||
          (field === "peerDependencies" &&
            Array.isArray(optionalPeers) &&
            optionalPeers.includes(name));
        enqueue(name, key, role, optional);
      }
    }
  }
  return { packages, roles, errors: [...errors] };
}

function lockedValue(record: JsonValue | undefined): JsonValue | undefined {
  if (record === undefined) return undefined;
  if (!Array.isArray(record)) throw new Error("Invalid Bun package record");
  // The trailing integrity hash alone does not change a resolved package.
  return record.slice(0, 3);
}

/** Classify lockfile-only updates using both old and new dependency reachability. */
export function bunLockChanges(
  path: string,
  before: string | null,
  after: string | null,
  settings: ReleaseSettings,
) {
  const old = lockGraph(before, settings);
  const next = lockGraph(after, settings);
  const facts: ReleaseFact[] = [];
  const errors = [...new Set([...old.errors, ...next.errors])];
  for (const key of new Set([
    ...Object.keys(old.packages),
    ...Object.keys(next.packages),
  ])) {
    const a = lockedValue(old.packages[key]);
    const b = lockedValue(next.packages[key]);
    if (canonical(a) === canonical(b)) continue;
    const roles = [old.roles.get(key), next.roles.get(key)];
    const role = roles.includes("runtime")
      ? "runtime"
      : roles.includes("build")
        ? "build"
        : roles.includes("development") && errors.length === 0
          ? "development"
          : "unknown";
    const record = next.packages[key] ?? old.packages[key];
    const locator =
      Array.isArray(record) && isString(record[0]) ? record[0] : key;
    const name = locator.slice(0, locator.lastIndexOf("@")) || key;
    facts.push(
      dependencyFact(path, name, role, a, b, `Locked package: ${key}`),
    );
    if (role === "unknown")
      errors.push(
        `Cannot establish runtime/development reachability for ${path}: ${key}`,
      );
  }
  return { facts, errors };
}

function goModule(source: string | null): Map<string, string> {
  const result = new Map<string, string>();
  let block = "";
  for (const raw of (source ?? "").split("\n")) {
    const line = raw.replace(/\/\/.*$/, "").trim();
    if (!line) continue;
    if (line === ")") {
      block = "";
      continue;
    }
    const start = /^(require|replace|exclude|retract|tool)\s*\($/.exec(line);
    if (start) {
      block = start[1];
      continue;
    }
    const fields: string[] = line.match(/"(?:[^"\\]|\\.)*"|\S+/g) ?? [];
    const directive = block || fields.shift();
    if (!directive || !fields.length)
      throw new Error(`Unsupported go.mod line: ${line}`);
    if (directive === "replace") {
      const arrow = fields.indexOf("=>");
      if (arrow < 1 || arrow === fields.length - 1)
        throw new Error(`Invalid Go replacement: ${line}`);
      result.set(
        `replace ${fields.slice(0, arrow).join(" ")}`,
        fields.slice(arrow + 1).join(" "),
      );
    } else if (["require", "exclude"].includes(directive)) {
      if (fields.length !== 2)
        throw new Error(`Invalid Go requirement: ${line}`);
      result.set(`${directive} ${fields[0]}`, fields[1]);
    } else
      result.set(
        `${directive} ${["tool", "retract"].includes(directive) ? fields.join(" ") : ""}`.trim(),
        fields.join(" "),
      );
  }
  if (block) throw new Error("Unclosed go.mod block");
  return result;
}

/** Compare Go requirements, replacements and toolchain metadata structurally. */
export function goModuleChanges(
  path: string,
  before: string | null,
  after: string | null,
): ReleaseFact[] {
  const old = goModule(before);
  const next = goModule(after);
  return [...new Set([...old.keys(), ...next.keys()])]
    .filter((key) => old.get(key) !== next.get(key))
    .map((key) => {
      const [directive, name] = key.split(" ");
      return dependencyFact(
        path,
        name ?? directive,
        directive === "tool" ? "development" : "runtime",
        old.get(key),
        next.get(key),
        `Go ${key}`,
      );
    });
}

/** Net changes and all commit summaries collected from immutable Git objects. */
export interface ReleaseChanges {
  /** Facts including quiet and missing evidence. */
  readonly facts: readonly ReleaseFact[];
  /** Unfiltered net file changes for review. */
  readonly files: readonly ReleaseFact[];
  /** Complete commit range, including upstream submodule commits. */
  readonly commits: readonly ReleaseCommit[];
  /** Evidence collection failures. */
  readonly errors: readonly string[];
}

const git = Effect.fn("releases.git")(function* (
  cwd: string,
  args: readonly string[],
) {
  const executor = yield* CommandExecutor;
  return yield* executor
    .run("git", args, {
      cwd,
      env: { GIT_TERMINAL_PROMPT: "0", GIT_OPTIONAL_LOCKS: "0" },
    })
    .pipe(
      Effect.mapError(
        (error) => new ReleaseError({ message: error.stderr || error.command }),
      ),
    );
});

function parseRawDiff(output: string, submodule: string | null): ReleaseFact[] {
  const parts = output.split("\0");
  const facts: ReleaseFact[] = [];
  for (let index = 0; index < parts.length && parts[index];) {
    const header = /^:(\d+) (\d+) ([a-f0-9]+) ([a-f0-9]+) ([A-Z])\d*$/.exec(
      parts[index++],
    );
    if (!header) throw new Error("Could not parse Git raw diff");
    const path = parts[index++];
    const renamed = header[5] === "R";
    const nextPath = renamed ? parts[index++] : path;
    if (!path || !nextPath) throw new Error("Missing Git diff path");
    const prefix = submodule ? `${submodule}/` : "";
    facts.push(
      releaseFact({
        kind:
          header[1] === "160000" || header[2] === "160000"
            ? "submodule"
            : "file",
        path: prefix + nextPath,
        previousPath: renamed ? prefix + path : null,
        changeType: renamed
          ? "renamed"
          : header[5] === "A"
            ? "added"
            : header[5] === "D"
              ? "deleted"
              : "modified",
        before: /^0+$/.test(header[3]) ? null : `${header[1]}:${header[3]}`,
        after: /^0+$/.test(header[4]) ? null : `${header[2]}:${header[4]}`,
        dependency: null,
        role: null,
        submodule,
        subject: null,
        detail: `${header[5]} ${prefix}${nextPath}`,
        complete: true,
      }),
    );
  }
  return facts;
}

function parseLog(output: string, submodule: string | null): ReleaseCommit[] {
  const parts = output.split("\0");
  const commits: ReleaseCommit[] = [];
  for (let index = 0; index + 2 < parts.length; index += 3) {
    const id = parts[index].trim();
    if (!/^[a-f0-9]{40,64}$/.test(id))
      throw new Error("Invalid commit ID in Git log");
    commits.push({
      id,
      subject: parts[index + 1],
      date: parts[index + 2],
      submodule,
    });
  }
  return commits;
}

function parseNumstat(output: string): Map<string, number | null> {
  const records = output.split("\0");
  const counts = new Map<string, number | null>();
  for (let index = 0; index < records.length && records[index];) {
    const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(records[index++]);
    if (!match) throw new Error("Could not parse Git line counts");
    let path = match[3];
    if (!path) {
      index++; // Renames carry separate old and new path records.
      path = records[index++];
    }
    if (!path) throw new Error("Missing Git line-count path");
    counts.set(
      path,
      match[1] === "-" || match[2] === "-"
        ? null
        : Number(match[1]) + Number(match[2]),
    );
  }
  return counts;
}

const range = Effect.fn("releases.range")(function* (
  cwd: string,
  before: string,
  after: string,
  submodule: string | null,
) {
  const diff = yield* git(cwd, [
    "diff",
    "--raw",
    "-z",
    "--no-abbrev",
    "--no-ext-diff",
    "--no-textconv",
    "--ignore-submodules=none",
    "-M",
    before,
    after,
    "--",
  ]);
  const log = yield* git(cwd, [
    "log",
    "-z",
    "--format=%H%x00%s%x00%cI",
    `${before}..${after}`,
    "--",
  ]);
  const numstat = yield* git(cwd, [
    "diff",
    "--numstat",
    "-z",
    "--no-ext-diff",
    "--no-textconv",
    "--diff-algorithm=myers",
    "--no-indent-heuristic",
    "--ignore-submodules=none",
    "-M",
    before,
    after,
    "--",
  ]);
  return yield* Effect.try({
    try: () => {
      const counts = parseNumstat(numstat);
      return {
        facts: parseRawDiff(diff, submodule).map((fact) => {
          const path = submodule
            ? fact.path.slice(submodule.length + 1)
            : fact.path;
          if (!counts.has(path))
            throw new Error(`Missing Git line count for ${fact.path}`);
          return { ...fact, changedLines: counts.get(path) };
        }),
        commits: parseLog(log, submodule),
      };
    },
    catch: (error) => new ReleaseError({ message: formatCause(error) }),
  });
});

const blob = (cwd: string, value: string | null) =>
  value === null
    ? Effect.succeed(null)
    : git(cwd, ["cat-file", "blob", value.slice(value.indexOf(":") + 1)]);

const submoduleUrl = Effect.fn("releases.submoduleUrl")(function* (
  cwd: string,
  commit: string,
  path: string,
) {
  const output = yield* git(cwd, [
    "config",
    "--blob",
    `${commit}:.gitmodules`,
    "--get-regexp",
    "^submodule\\..*\\.(path|url)$",
  ]);
  const entries = output
    .trim()
    .split("\n")
    .map((line) => {
      const index = line.indexOf(" ");
      return [line.slice(0, index), line.slice(index + 1)] as const;
    });
  const name = entries
    .find(([key, value]) => key.endsWith(".path") && value === path)?.[0]
    .slice(0, -5);
  const url = entries.find(([key]) => key === `${name}.url`)?.[1];
  if (
    !url ||
    !/^(https:\/\/github\.com\/|git@github\.com:)[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(?:\.git)?$/.test(
      url,
    )
  )
    return yield* new ReleaseError({
      message: `Missing or unsupported upstream URL for ${path}`,
    });
  return url;
});

interface ChangedLines {
  readonly added: ReadonlySet<number>;
  readonly removed: ReadonlySet<number>;
}

function changedLines(diff: string): ChangedLines {
  const added = new Set<number>();
  const removed = new Set<number>();
  let oldLine = 0;
  let newLine = 0;
  let inHunk = false;
  for (const line of diff.split("\n")) {
    const hunk = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/.exec(line);
    if (hunk) {
      oldLine = Number(hunk[1]);
      newLine = Number(hunk[2]);
      inHunk = true;
    } else if (inHunk && line.startsWith("-")) removed.add(oldLine++);
    else if (inHunk && line.startsWith("+")) added.add(newLine++);
    else if (inHunk && line.startsWith(" ")) {
      oldLine++;
      newLine++;
    } else if (!line.startsWith("\\")) inHunk = false;
  }
  return { added, removed };
}

interface BlamedLine {
  readonly commit: string;
  readonly finalLine: number;
}

function blameLines(output: string): BlamedLine[] {
  const lines: BlamedLine[] = [];
  for (const line of output.split("\n")) {
    const header = /^([a-f0-9]{40,64}) (\d+) (\d+)(?: \d+)?$/.exec(line);
    if (header) lines.push({ commit: header[1], finalLine: Number(header[3]) });
  }
  return lines;
}

/** Attribute subject selectors to surviving source lines or individual structured values, once per net fact. */
export const attributeReleaseSubjects = Effect.fn("releases.attributeSubjects")(
  function* (
    cwd: string,
    before: string,
    after: string,
    facts: readonly ReleaseFact[],
    commits: readonly ReleaseCommit[],
    settings: ReleaseSettings,
    submodule: string | null = null,
  ): Effect.fn.Return<readonly ReleaseFact[], ReleaseError, CommandExecutor> {
    const rules = settings.overrides?.filter((rule) => rule.subjects) ?? [];
    if (
      !rules.length ||
      !commits.some((commit) =>
        rules.some((rule) =>
          rule.subjects?.some((pattern) =>
            new RegExp(pattern).test(commit.subject),
          ),
        ),
      )
    )
      return facts;
    const graph = new Map(
      (yield* git(cwd, ["rev-list", "--parents", `${before}..${after}`]))
        .trim()
        .split("\n")
        .filter(Boolean)
        .map((line) => {
          const [commit, ...parents] = line.split(" ");
          return [commit, parents] as const;
        }),
    );
    const trees = new Map<string, string | null>();
    const sources = new Map<string, string | null>();
    const structured = new Map<string, readonly ReleaseFact[]>();
    const diffs = new Map<string, ChangedLines>();
    const gitPath = (path: string) =>
      submodule === null ? path : path.slice(submodule.length + 1);
    const tree = Effect.fn("releases.lineageTree")(function* (
      commit: string,
      path: string,
    ) {
      const key = `${commit}:${path}`;
      if (trees.has(key)) return trees.get(key) ?? null;
      const output = yield* git(cwd, [
        "ls-tree",
        "-z",
        commit,
        "--",
        `:(literal)${gitPath(path)}`,
      ]);
      const record = /^(\d+) (?:blob|commit) ([a-f0-9]+)\t/.exec(output);
      const value = record ? `${record[1]}:${record[2]}` : null;
      trees.set(key, value);
      return value;
    });
    const source = Effect.fn("releases.lineageSource")(function* (
      commit: string,
      path: string,
    ) {
      const key = `${commit}:${path}`;
      if (sources.has(key)) return sources.get(key) ?? null;
      const value = yield* blob(cwd, yield* tree(commit, path));
      sources.set(key, value);
      return value;
    });
    const value = Effect.fn("releases.lineageValue")(function* (
      commit: string,
      fact: ReleaseFact,
    ) {
      if (fact.kind !== "dependency" && fact.kind !== "metadata")
        return yield* tree(commit, fact.path);
      const key = `${commit}:${fact.path}`;
      if (!structured.has(key)) {
        const text = yield* source(commit, fact.path);
        const parsed = yield* Effect.try({
          try: () =>
            fact.path.endsWith("package.json")
              ? manifestChanges(fact.path, null, text, settings)
              : fact.path.endsWith("bun.lock")
                ? bunLockChanges(fact.path, null, text, settings).facts
                : goModuleChanges(fact.path, null, text),
          catch: (error) =>
            new ReleaseError({
              message: `Cannot attribute ${fact.path} at ${commit}: ${formatCause(error)}`,
            }),
        });
        structured.set(key, parsed);
      }
      return (
        structured
          .get(key)
          ?.find(
            (candidate) =>
              candidate.detail === fact.detail &&
              candidate.kind === fact.kind &&
              candidate.dependency === fact.dependency,
          )?.after ?? (fact.kind === "metadata" ? "undefined" : null)
      );
    });
    const valueOwners = Effect.fn("releases.valueOwners")(function* (
      fact: ReleaseFact,
    ) {
      const expected = yield* value(after, fact);
      const owners = new Set<string>();
      const pending = [after];
      const visited = new Set<string>();
      for (let index = 0; index < pending.length; index++) {
        const commit = pending[index];
        if (visited.has(commit) || !graph.has(commit)) continue;
        visited.add(commit);
        const inherited: string[] = [];
        for (const parent of graph.get(commit) ?? [])
          if ((yield* value(parent, fact)) === expected) inherited.push(parent);
        if (inherited.length) pending.push(...inherited);
        else owners.add(commit);
      }
      return owners;
    });
    const lineDiff = Effect.fn("releases.lineDiff")(function* (
      old: string,
      next: string,
      path: string,
      previousPath: string | null = null,
    ) {
      const key = `${old}:${next}:${path}:${previousPath ?? ""}`;
      const cached = diffs.get(key);
      if (cached) return cached;
      const output = yield* git(cwd, [
        "diff",
        "--no-ext-diff",
        "--no-textconv",
        "--diff-algorithm=myers",
        "--no-indent-heuristic",
        "--unified=0",
        "--inter-hunk-context=0",
        "-M",
        old,
        next,
        "--",
        `:(literal)${gitPath(path)}`,
        ...(previousPath === null
          ? []
          : [`:(literal)${gitPath(previousPath)}`]),
      ]);
      const result = changedLines(output);
      diffs.set(key, result);
      return result;
    });
    const blame = Effect.fn("releases.lineageBlame")(function* (
      args: readonly string[],
      path: string,
    ) {
      const output = yield* git(cwd, [
        "blame",
        "--root",
        "--line-porcelain",
        "--diff-algorithm=myers",
        "--ignore-revs-file",
        "",
        ...args,
        "--",
        gitPath(path),
      ]);
      return yield* Effect.try({
        try: () => blameLines(output),
        catch: (error) =>
          new ReleaseError({
            message: `Cannot read source lineage for ${path}: ${formatCause(error)}`,
          }),
      });
    });
    const removalOwners = Effect.fn("releases.removalOwners")(function* (
      fact: ReleaseFact,
      line: number,
    ) {
      const owners = new Set<string>();
      const pending = [after];
      const visited = new Set<string>();
      for (let index = 0; index < pending.length; index++) {
        const commit = pending[index];
        if (visited.has(commit) || !graph.has(commit)) continue;
        visited.add(commit);
        const inherited: string[] = [];
        // Compare each parent with the baseline so a restored line ends the old removal's lineage.
        for (const parent of graph.get(commit) ?? [])
          if (
            (yield* lineDiff(
              before,
              parent,
              fact.path,
              fact.previousPath,
            )).removed.has(line)
          )
            inherited.push(parent);
        if (inherited.length) pending.push(...inherited);
        else owners.add(commit);
      }
      return owners;
    });
    const attributed: ReleaseFact[] = [];
    for (const fact of facts) {
      if (
        !fact.complete ||
        !rules.some((rule) =>
          releaseRuleMatches({ ...rule, subjects: undefined }, fact),
        )
      ) {
        attributed.push(fact);
        continue;
      }
      const result = yield* Effect.gen(function* () {
        let owners: ReadonlySet<string>;
        if (fact.kind === "dependency" || fact.kind === "metadata")
          owners = yield* valueOwners(fact);
        else {
          const net = yield* lineDiff(
            before,
            after,
            fact.path,
            fact.previousPath,
          );
          if (!net.added.size && !net.removed.size)
            owners = yield* valueOwners(fact);
          else {
            const contentOwners = new Set<string>();
            if (net.added.size) {
              const added = yield* blame([after], fact.path);
              if (
                [...net.added].some(
                  (line) => !added.some((entry) => entry.finalLine === line),
                )
              )
                return yield* new ReleaseError({
                  message: `Incomplete added-line lineage for ${fact.path}`,
                });
              for (const line of added)
                if (net.added.has(line.finalLine))
                  contentOwners.add(line.commit);
            }
            for (const line of net.removed)
              for (const owner of yield* removalOwners(fact, line))
                contentOwners.add(owner);
            owners = contentOwners;
          }
        }
        return {
          ...fact,
          subjects: [
            ...new Set(
              commits
                .filter((commit) => owners.has(commit.id))
                .map((commit) => commit.subject),
            ),
          ].sort(),
        };
      }).pipe(Effect.result);
      attributed.push(
        result._tag === "Success"
          ? result.success
          : {
              ...fact,
              complete: false,
              detail: `${fact.detail}: ${result.failure.message}`,
            },
      );
    }
    return attributed;
  },
);

/** Collect complete local and configured upstream comparisons without checking out files. */
export const collectReleaseChanges = Effect.fn("releases.collect")(function* (
  cwd: string,
  before: string,
  after: string,
  settings: ReleaseSettings,
  cacheDirectory: string,
): Effect.fn.Return<ReleaseChanges, ReleaseError, CommandExecutor> {
  const comparison = yield* range(cwd, before, after, null);
  const facts: ReleaseFact[] = [];
  const commits = [...comparison.commits];
  const errors: string[] = [];
  for (const fact of comparison.facts) {
    if (
      separatelyPublishedPath(fact.path, settings) &&
      (fact.previousPath === null ||
        separatelyPublishedPath(fact.previousPath, settings))
    ) {
      facts.push(fact);
      continue;
    }
    if (fact.kind === "submodule") {
      const upstream = yield* Effect.gen(function* () {
        if (
          fact.path !== "vendor/anti-slop" ||
          settings.policy !== "oxlint-rules"
        )
          return yield* new ReleaseError({
            message: `No upstream shipped-content policy for ${fact.path}`,
          });
        if (!fact.before || !fact.after)
          return yield* new ReleaseError({
            message: `Submodule added or removed: ${fact.path}; upstream comparison needs review`,
          });
        const oldUrl = yield* submoduleUrl(
          cwd,
          before,
          fact.previousPath ?? fact.path,
        );
        const url = yield* submoduleUrl(cwd, after, fact.path);
        if (url !== oldUrl)
          return yield* new ReleaseError({
            message: `Submodule URL changed: ${fact.path}; upstream comparison needs review`,
          });
        const directory = join(
          cacheDirectory,
          "upstream",
          evidenceId(fact.path),
        );
        yield* Effect.try({
          try: () => mkdirSync(dirname(directory), { recursive: true }),
          catch: (error) => new ReleaseError({ message: formatCause(error) }),
        });
        if (!existsSync(directory))
          yield* git(cwd, ["init", "--bare", directory]);
        const oldCommit = fact.before.split(":")[1];
        const nextCommit = fact.after.split(":")[1];
        yield* git(directory, [
          "fetch",
          "--no-write-fetch-head",
          "--no-tags",
          "--no-recurse-submodules",
          url,
          `+${oldCommit}:refs/dot-release/base`,
          `+${nextCommit}:refs/dot-release/head`,
        ]);
        const upstream = yield* range(
          directory,
          oldCommit,
          nextCommit,
          fact.path,
        );
        return {
          ...upstream,
          evidenceUrl: `${url.replace(/^git@github.com:/, "https://github.com/").replace(/\.git$/, "")}/compare/${oldCommit}...${nextCommit}`,
          commits: upstream.commits.map((commit) => ({
            ...commit,
            url: `${url.replace(/^git@github.com:/, "https://github.com/").replace(/\.git$/, "")}/commit/${commit.id}`,
          })),
          facts: yield* attributeReleaseSubjects(
            directory,
            oldCommit,
            nextCommit,
            upstream.facts,
            upstream.commits,
            settings,
            fact.path,
          ),
        };
      }).pipe(Effect.result);
      if (upstream._tag === "Success") {
        facts.push(
          {
            ...fact,
            submodule: fact.path,
            evidenceUrl: upstream.success.evidenceUrl,
          },
          ...upstream.success.facts.map((finding) => ({
            ...finding,
            evidenceUrl: upstream.success.evidenceUrl,
          })),
        );
        commits.push(...upstream.success.commits);
      } else {
        facts.push({ ...fact, submodule: fact.path, complete: false });
        errors.push(upstream.failure.message);
      }
      continue;
    }
    if (
      fact.path.endsWith("/package.json") ||
      fact.path === "package.json" ||
      fact.path.endsWith("/bun.lock") ||
      fact.path === "bun.lock" ||
      fact.path.endsWith("/go.mod") ||
      fact.path === "go.mod"
    ) {
      if (fact.previousPath !== null) facts.push(fact);
      const parsed = yield* Effect.gen(function* () {
        const old = yield* blob(cwd, fact.before);
        const next = yield* blob(cwd, fact.after);
        return yield* Effect.try({
          try: () =>
            fact.path.endsWith("package.json")
              ? {
                  facts: manifestChanges(fact.path, old, next, settings),
                  errors: [],
                }
              : fact.path.endsWith("bun.lock")
                ? bunLockChanges(fact.path, old, next, settings)
                : { facts: goModuleChanges(fact.path, old, next), errors: [] },
          catch: (error) =>
            new ReleaseError({
              message: `${fact.path}: ${formatCause(error)}`,
            }),
        });
      }).pipe(Effect.result);
      if (parsed._tag === "Failure") {
        facts.push({ ...fact, complete: false });
        errors.push(parsed.failure.message);
      } else {
        facts.push(...parsed.success.facts);
        errors.push(...parsed.success.errors);
        if (parsed.success.facts.length === 0)
          facts.push({
            ...fact,
            kind: "checksum",
            detail: `Formatting or checksum-only change: ${fact.path}`,
          });
      }
    } else
      facts.push(
        fact.path.endsWith("go.sum")
          ? { ...fact, kind: "checksum" }
          : fact.path.endsWith("bun.lockb")
            ? {
                ...fact,
                complete: false,
                detail:
                  "Binary Bun lockfile cannot be classified; text lockfile evidence required",
              }
            : fact,
      );
  }
  const localFacts = yield* attributeReleaseSubjects(
    cwd,
    before,
    after,
    facts.filter((fact) => fact.submodule === null),
    comparison.commits,
    settings,
  );
  const attributedById = new Map(localFacts.map((fact) => [fact.id, fact]));
  const attributed = facts.map((fact) => attributedById.get(fact.id) ?? fact);
  for (const fact of attributed)
    if (!fact.complete && !errors.includes(fact.detail))
      errors.push(fact.detail);
  return {
    facts: attributed,
    files: [
      ...comparison.facts,
      ...attributed.filter(
        (fact) => fact.submodule !== null && fact.kind !== "submodule",
      ),
    ],
    commits,
    errors,
  };
});
