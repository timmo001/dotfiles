import { minimatch } from "minimatch";
import semver from "semver";
import { Predicate, Record } from "effect";
import type { DependencyPolicy } from "./config.js";
import type { Dependency, Releases, Release } from "./model.js";

/** Settings after ordered manager and package-rule evaluation. */
export type DependencySettings = DependencyPolicy["settings"];

/** Validate matcher syntax before any selector can influence discovery. */
export function validateDependencyPatterns(policy: DependencyPolicy): void {
  for (const pattern of [
    ...(policy.ignorePaths ?? []),
    ...Object.values(policy.managers).flatMap((manager) => manager.files ?? []),
    ...policy.rules.flatMap((rule) =>
      Object.values(rule.match).flatMap((patterns) => patterns ?? []),
    ),
    ...policy.regexManagers.flatMap((manager) => manager.files),
  ])
    matchesPatterns("", [pattern]);

  for (const manager of policy.regexManagers)
    for (const pattern of manager.patterns) new RegExp(pattern, "g");
}

/** Match Renovate-style regex/glob patterns, preserving negative exclusions. */
export function matchesPatterns(
  value: string,
  patterns: readonly string[],
): boolean {
  const matches = (pattern: string) => {
    const regex = /^\/(.*)\/([i]?)$/.exec(pattern);

    return regex
      ? new RegExp(regex[1], regex[2]).test(value)
      : minimatch(value, pattern, { dot: true, nocase: true });
  };

  const positive = patterns.filter((pattern) => !pattern.startsWith("!"));

  return (
    patterns
      .filter((pattern) => pattern.startsWith("!"))
      .every((pattern) => !matches(pattern.slice(1))) &&
    (!positive.length || positive.some(matches))
  );
}

function matchesVersion(value: string, patterns: readonly string[]): boolean {
  const version =
    semver.valid(value) ??
    (semver.validRange(value) ? semver.minVersion(value)?.version : undefined);

  const test = (pattern: string) =>
    semver.validRange(pattern) && version
      ? semver.satisfies(version, pattern, { includePrerelease: true })
      : matchesPatterns(value, [pattern]);

  const positives = patterns.filter((pattern) => !pattern.startsWith("!"));

  return (
    patterns
      .filter((pattern) => pattern.startsWith("!"))
      .every((pattern) => !test(pattern.slice(1))) &&
    (!positives.length || positives.some(test))
  );
}

/** Match validated selectors without treating missing metadata as a match. */
export function matchesRule(
  match: DependencyPolicy["rules"][number]["match"],
  dependency: Dependency,
  updateType?: string,
): boolean {
  const values = {
    managers: dependency.manager,
    datasources: dependency.datasource,
    packages: dependency.package,
    dependencies: dependency.name,
    files: dependency.file,
    dependencyTypes: dependency.dependencyType,
    sourceUrls: dependency.sourceUrl,
    currentValues: dependency.current,
    currentVersions: dependency.resolved ?? dependency.current,
    updateTypes: updateType,
  };

  return Object.entries(match).every(([key, patterns]) => {
    if (!patterns) return true;
    const value = Object.entries(values).find(([name]) => name === key)?.[1];

    return (
      value !== undefined &&
      value !== null &&
      (key === "currentVersions"
        ? matchesVersion(value, patterns)
        : matchesPatterns(value, patterns))
    );
  });
}

/** Apply selectors in order; missing source metadata never counts as a match. */
export function dependencySettings(
  policy: DependencyPolicy,
  dependency: Dependency,
  updateType?: string,
): DependencySettings {
  let settings: DependencySettings = {
    ...policy.settings,
    ...policy.managers[dependency.manager]?.settings,
    ...Record.filter(
      {
        versioning: dependency.versioning,
        extractVersion: dependency.extractVersion,
      },
      Predicate.isNotUndefined,
    ),
  };

  for (const rule of policy.rules) {
    if (matchesRule(rule.match, dependency, updateType))
      settings = { ...settings, ...rule.set };
  }

  if (policy.ignoreDependencies?.includes(dependency.name))
    settings = { ...settings, enabled: false };

  return settings;
}

const updateTypes = [
  undefined,
  "major",
  "minor",
  "patch",
  "digest",
  "pin",
  "pinDigest",
];

/** Whether ordered selectors require source metadata before policy can be evaluated. */
export function requiresSourceUrl(
  policy: DependencyPolicy,
  dependency: Dependency,
): boolean {
  return (
    dependency.sourceUrl === undefined &&
    policy.rules.some(
      (rule) =>
        rule.match.sourceUrls?.length &&
        updateTypes.some((type) =>
          matchesRule(
            { ...rule.match, sourceUrls: undefined },
            dependency,
            type,
          ),
        ),
    )
  );
}

/** Established coordinated groups, including ordered update-type overrides. */
export function dependencyGroups(
  policy: DependencyPolicy,
  dependency: Dependency,
): readonly string[] {
  if (requiresSourceUrl(policy, dependency)) return [];

  return [
    ...new Set([
      ...updateTypes.map((type) => {
        const settings = dependencySettings(policy, dependency, type);

        return settings.groupSlug ?? settings.groupName ?? dependency.package;
      }),
    ]),
  ];
}

function comparable(
  version: string,
  versioning: string | null | undefined,
): string | null {
  if (versioning === "loose") return semver.coerce(version)?.version ?? null;

  return (
    semver.valid(version) ??
    (/^v?\d+(?:\.\d+)?$/.test(version)
      ? (semver.coerce(version)?.version ?? null)
      : null)
  );
}

function ageMillis(age: string | null | undefined): number | undefined {
  if (!age) return 0;
  const match = /^(\d+(?:\.\d+)?)\s*(second|minute|hour|day|week)s?$/.exec(age);

  if (!match) return undefined;

  const units = {
    second: 1000,
    minute: 60000,
    hour: 3600000,
    day: 86400000,
    week: 604800000,
  };

  return (
    Number(match[1]) *
    (Object.entries(units).find(([unit]) => unit === match[2])?.[1] ?? 0)
  );
}

/** Pure version-selection result; unsupported semantics remain publication blockers. */
export interface Selection {
  /** Final settings, including candidate-dependent rules. */
  readonly settings: DependencySettings;
  /** Selected provider release if an update is eligible. */
  readonly release?: Release;
  /** New value, preserving the supported npm range operator. */
  readonly candidate?: string;
  /** Human-readable no-update or missing metadata reason. */
  readonly reason: string;
  /** Relevant unsupported policy or missing metadata. */
  readonly blockers: readonly string[];
  /** Update kind for group separation. */
  readonly updateType?: string;
}

/** Select an eligible release without rewriting source or assuming missing dates. */
export function selectRelease(
  policy: DependencyPolicy,
  dependency: Dependency,
  metadata: Releases,
  now: number,
): Selection {
  const settings = dependencySettings(policy, dependency);

  const none = (
    reason: string,
    blockers: readonly string[] = [],
  ): Selection => ({ settings, reason, blockers });

  if (settings.enabled === false || dependency.datasource === "local")
    return none("Disabled or local dependency");

  if (!metadata.releases.length)
    return none("Missing release metadata", ["Provider returned no releases"]);

  if (
    dependency.datasource === "git-refs" &&
    metadata.releases.every((release) => !release.digest)
  )
    return none("Missing Git reference digest", [
      "Provider returned no Git digest",
    ]);

  if (
    dependency.datasource === "npm" &&
    settings.respectLatest === true &&
    !metadata.latest
  )
    return none("Missing npm latest tag", [
      "respectLatest requires the npm latest dist-tag",
    ]);

  if (settings.separateMultipleMajor)
    return none("Multiple-major previews require explicit support", [
      "Unsupported separateMultipleMajor policy",
    ]);

  if (requiresSourceUrl(policy, dependency))
    return none("Missing source URL required by ordered policy", [
      "Cannot evaluate relevant matchSourceUrls selectors without source metadata",
    ]);
  const versioning = settings.versioning ?? "semver";

  if (!["semver", "npm", "loose", "git", "node"].includes(versioning))
    return none(`Unsupported versioning: ${versioning}`, [
      `Unsupported versioning: ${versioning}`,
    ]);

  if (
    settings.rangeStrategy &&
    !["auto", "replace", "bump", "pin", "in-range"].includes(
      settings.rangeStrategy,
    )
  )
    return none("Unsupported range strategy", [
      `Unsupported range strategy: ${settings.rangeStrategy}`,
    ]);

  const current =
    comparable(dependency.resolved ?? dependency.current, versioning) ??
    (semver.validRange(dependency.current)
      ? semver.minVersion(dependency.current)?.version
      : undefined);

  if (dependency.current === "latest" && dependency.datasource !== "git-refs")
    return none("Floating latest channel has no pinned value to update");

  if (!current && dependency.datasource !== "git-refs")
    return none("Unsupported or missing current version", [
      `Cannot resolve current version: ${dependency.current}`,
    ]);
  const blockers = new Set<string>();

  const eligible: {
    release: Release;
    settings: DependencySettings;
    candidate: string;
    updateType: string;
    version: string | null;
  }[] = [];

  const settingsByType = new Map<string, DependencySettings>();

  const pinsRange =
    dependency.datasource === "npm" &&
    !semver.valid(dependency.current) &&
    (settings.rangeStrategy === "pin" ||
      dependencySettings(policy, dependency, "pin").rangeStrategy === "pin");

  for (const original of metadata.releases) {
    const extracted = settings.extractVersion
      ? new RegExp(settings.extractVersion).exec(original.version)?.groups
          ?.version
      : original.version;

    if (!extracted) continue;
    const release = { ...original, version: extracted };
    const version = comparable(release.version, versioning);
    const git = dependency.datasource === "git-refs";

    const pin = pinsRange && current && version && semver.eq(version, current);

    if (
      git
        ? !release.digest ||
          dependency.digest?.startsWith(release.digest) ||
          release.digest.startsWith(dependency.digest ?? "not-a-digest")
        : !version ||
          !current ||
          semver.lt(version, current) ||
          (semver.eq(version, current) &&
            !pin &&
            (dependency.digest
              ? dependency.digest === release.digest
              : !settings.pinDigests))
    )
      continue;

    const updateType = pin
      ? "pin"
      : git ||
          (current &&
            version &&
            semver.eq(version, current) &&
            dependency.digest)
        ? "digest"
        : settings.pinDigests &&
            !dependency.digest &&
            current &&
            version &&
            semver.eq(version, current)
          ? "pinDigest"
          : current &&
              version &&
              semver.major(version) !== semver.major(current)
            ? "major"
            : current &&
                version &&
                semver.minor(version) !== semver.minor(current)
              ? "minor"
              : "patch";

    const candidateSettings =
      settingsByType.get(updateType) ??
      dependencySettings(policy, dependency, updateType);

    settingsByType.set(updateType, candidateSettings);

    if (candidateSettings.enabled === false) continue;

    if (
      candidateSettings.separateMultipleMajor ||
      (candidateSettings.rangeStrategy &&
        !["auto", "replace", "bump", "pin", "in-range"].includes(
          candidateSettings.rangeStrategy,
        ))
    ) {
      blockers.add(
        "Unsupported candidate-specific range or multiple-major policy",
      );
      continue;
    }

    if (pin && candidateSettings.rangeStrategy !== "pin") continue;

    if (
      candidateSettings.versioning !== settings.versioning ||
      candidateSettings.extractVersion !== settings.extractVersion
    ) {
      blockers.add("Candidate-dependent versioning requires explicit support");
      continue;
    }

    if (
      !git &&
      candidateSettings.ignoreUnstable !== false &&
      version &&
      semver.prerelease(version) &&
      !(current && semver.prerelease(current))
    )
      continue;

    if (candidateSettings.allowedVersions) {
      const constraint = candidateSettings.allowedVersions;

      if (/^!?\//.test(constraint)) {
        if (!matchesPatterns(release.version, [constraint])) continue;
      } else if (!semver.validRange(constraint)) {
        blockers.add(`Unsupported allowedVersions: ${constraint}`);
        continue;
      } else if (
        !version ||
        !semver.satisfies(version, constraint, { includePrerelease: true })
      )
        continue;
    }

    if (
      candidateSettings.respectLatest !== false &&
      metadata.latest &&
      version
    ) {
      const latest = comparable(metadata.latest, versioning);

      if (
        latest &&
        semver.gt(version, latest) &&
        !(current && semver.gt(current, latest))
      )
        continue;
    }

    const age = ageMillis(candidateSettings.minimumReleaseAge);

    if (age === undefined) {
      blockers.add(
        `Unsupported minimumReleaseAge: ${candidateSettings.minimumReleaseAge}`,
      );
      continue;
    }

    if (age > 0) {
      const date = release.date ? Date.parse(release.date) : NaN;

      if (!Number.isFinite(date)) {
        blockers.add(`Missing release date for ${release.version}`);
        continue;
      }

      if (now - date < age) continue;
    }

    if (candidateSettings.pinDigests && !release.digest) {
      blockers.add(`Missing digest for ${release.version}`);
      continue;
    }

    let candidate = release.version;

    if (!git && dependency.datasource === "npm") {
      const range = /^([~^]?)(v?\d+(?:\.\d+){0,2}(?:-[\w.-]+)?)$/.exec(
        dependency.current,
      );

      if (!range) {
        blockers.add(`Unsupported npm range: ${dependency.current}`);
        continue;
      }

      if (
        candidateSettings.rangeStrategy === "in-range" &&
        !semver.satisfies(release.version, dependency.current, {
          includePrerelease: true,
        })
      )
        continue;

      const satisfied = semver.satisfies(release.version, dependency.current, {
        includePrerelease: true,
      });

      candidate =
        candidateSettings.rangeStrategy === "pin"
          ? release.version
          : satisfied &&
              [undefined, "auto", "replace", "in-range"].includes(
                candidateSettings.rangeStrategy,
              )
            ? dependency.current
            : `${range[1]}${release.version}`;
    } else if (
      dependency.current.startsWith("v") &&
      !candidate.startsWith("v") &&
      !git
    )
      candidate = `v${candidate}`;

    if (git || updateType === "pinDigest") candidate = dependency.current;

    if (
      dependency.datasource === "npm" &&
      candidate === dependency.current &&
      !dependency.resolved &&
      !release.digest
    )
      continue;
    eligible.push({
      release: original,
      candidate,
      settings: candidateSettings,
      updateType,
      version,
    });
  }

  eligible.sort((left, right) =>
    left.version && right.version
      ? semver.rcompare(left.version, right.version)
      : 0,
  );
  const selected = eligible[0];

  if (!selected)
    return none(
      blockers.size
        ? "Missing metadata or unsupported policy"
        : "No eligible update (current version or release constraints)",
      [...blockers],
    );

  return {
    ...selected,
    reason:
      selected.candidate === dependency.current &&
      selected.updateType !== "digest"
        ? "Bun resolution update within the existing range"
        : "Update available",
    blockers: [...blockers],
  };
}
