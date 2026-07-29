export const PINNED_COMMIT = "fa8e4d3c";

export type ScenarioMode = "implementation" | "review";

export interface FindingExpectation {
  readonly path: string;
  readonly changedText: string;
}

export interface BenchmarkScenario {
  readonly id: string;
  readonly title: string;
  readonly mode: ScenarioMode;
  readonly agent: "refactorer" | "reviewer";
  readonly requiredSkills: readonly string[];
  readonly prompt: string;
  readonly sourcePaths: readonly string[];
  readonly requiredChangedPaths: readonly string[];
  readonly allowedChangedPaths: readonly string[];
  readonly forbiddenChangedPaths: readonly string[];
  readonly requiredDiffText: readonly string[];
  readonly forbiddenDiffText: readonly string[];
  readonly expectedFindings: "none" | readonly FindingExpectation[];
  readonly prepare?: (files: Map<string, string>) => void;
}

const generatedArtifacts = "agents/.config/opencode/lib/generated-artifacts.ts";
const generatedArtifactGuard =
  "agents/.config/opencode/plugins/generated-artifact-guard.ts";

export const scenarios = [
  {
    id: "implementation-required-consumer",
    title: "Required consumer outside the named file",
    mode: "implementation",
    agent: "refactorer",
    requiredSkills: [
      "changeset-scope",
      "types-enforce-ts",
      "effect-principles",
    ],
    prompt: `Change only the generated-artefact path contract. In ${generatedArtifacts}, rename the exported generatedArtifactForPath function to findGeneratedArtifact. Update its internal callers and the direct production consumer only where required by that rename. Do not keep a compatibility alias, clean up adjacent code, or alter tests and documentation. Make the edits now.`,
    sourcePaths: [generatedArtifacts, generatedArtifactGuard],
    requiredChangedPaths: [generatedArtifacts, generatedArtifactGuard],
    allowedChangedPaths: [generatedArtifacts, generatedArtifactGuard],
    forbiddenChangedPaths: [],
    requiredDiffText: [
      "export function findGeneratedArtifact(",
      "findGeneratedArtifact(root,",
    ],
    forbiddenDiffText: ["export function generatedArtifactForPath("],
    expectedFindings: "none",
  },
  {
    id: "implementation-reuse-context",
    title: "Reuse an implementation from unchanged context",
    mode: "implementation",
    agent: "refactorer",
    requiredSkills: [
      "changeset-scope",
      "types-enforce-ts",
      "effect-principles",
    ],
    prompt: `In ${generatedArtifactGuard}, protect a tool named move_file. Its destination is output.args.destination and should be checked against the same generated-artefact paths as write and edit. Reuse the existing path classifier from unchanged context; do not duplicate its path list or change unrelated branches. Make the edit now.`,
    sourcePaths: [generatedArtifacts, generatedArtifactGuard],
    requiredChangedPaths: [generatedArtifactGuard],
    allowedChangedPaths: [generatedArtifactGuard],
    forbiddenChangedPaths: [generatedArtifacts],
    requiredDiffText: [
      'input.tool === "move_file"',
      "generatedArtifactForPath(",
      "args.destination",
    ],
    forbiddenDiffText: ["GENERATED_ARTIFACTS.find"],
    expectedFindings: "none",
  },
  {
    id: "review-harmless-diff",
    title: "Harmless diff with tempting adjacent code",
    mode: "review",
    agent: "reviewer",
    requiredSkills: [
      "changeset-scope",
      "code-review",
      "types-enforce-ts",
      "effect-principles",
    ],
    prompt: `Review the current uncommitted diff only. Read surrounding code when useful, but report only concrete problems introduced or worsened by the diff. Do not edit files. If there are no scoped findings, say so plainly.`,
    sourcePaths: [generatedArtifacts, generatedArtifactGuard],
    requiredChangedPaths: [],
    allowedChangedPaths: [],
    forbiddenChangedPaths: [generatedArtifacts, generatedArtifactGuard],
    requiredDiffText: [],
    forbiddenDiffText: [],
    expectedFindings: "none",
    prepare(files) {
      const source = files.get(generatedArtifacts);
      if (!source)
        throw new Error(`Missing fixture source: ${generatedArtifacts}`);
      files.set(
        generatedArtifacts,
        source.replace(
          "const READ_ONLY_SHELL_COMMANDS = new Set([",
          "// Commands in this set may inspect generated output without changing it.\nconst READ_ONLY_SHELL_COMMANDS = new Set([",
        ),
      );
    },
  },
  {
    id: "review-changed-line-conflict",
    title: "Changed line conflicts with unchanged context",
    mode: "review",
    agent: "reviewer",
    requiredSkills: [
      "changeset-scope",
      "code-review",
      "types-enforce-ts",
      "effect-principles",
    ],
    prompt: `Review the current uncommitted diff only. Read surrounding code when useful, but report only concrete problems introduced or worsened by the diff. Anchor each finding to a changed line and do not edit files.`,
    sourcePaths: [generatedArtifacts, generatedArtifactGuard],
    requiredChangedPaths: [],
    allowedChangedPaths: [],
    forbiddenChangedPaths: [generatedArtifacts, generatedArtifactGuard],
    requiredDiffText: [],
    forbiddenDiffText: [],
    expectedFindings: [
      {
        path: generatedArtifactGuard,
        changedText: "generatedArtifactForPath",
      },
    ],
    prepare(files) {
      const source = files.get(generatedArtifactGuard);
      if (!source) {
        throw new Error(`Missing fixture source: ${generatedArtifactGuard}`);
      }
      files.set(
        generatedArtifactGuard,
        source.replace(
          "generatedArtifactFromPatch(\n                root,\n                stringArg(args.patchText),\n                workdir,\n              )",
          "generatedArtifactForPath(\n                root,\n                stringArg(args.patchText),\n                workdir,\n              )",
        ),
      );
    },
  },
] as const satisfies readonly BenchmarkScenario[];
