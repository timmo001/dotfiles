import { expect, test } from "bun:test";
import { renderStackContextJson } from "./renderJson.js";
import { STACK_LIMITS, type StackContextData } from "./model.js";

/** Build a stack-context snapshot from the empty defaults. */
function data(over: Partial<StackContextData> = {}): StackContextData {
  return {
    root: "/repo",
    name: "repo",
    scannedFiles: 10,
    truncated: false,
    languages: [],
    ecosystems: [],
    tooling: [],
    frameworks: [],
    warnings: [],
    ...over,
  };
}

test("serialises the core fields and sections", () => {
  const json = JSON.parse(
    renderStackContextJson(
      data({
        languages: [
          {
            name: "TypeScript",
            files: 5,
            locations: ["src"],
            confidence: "heuristic",
          },
        ],
        ecosystems: [
          {
            name: "npm",
            manifests: ["package.json"],
            confidence: "authoritative",
          },
        ],
        tooling: [
          {
            name: "Bun",
            kinds: ["package manager"],
            evidence: ["lockfile: bun.lock"],
            confidence: "authoritative",
          },
        ],
        frameworks: [
          {
            name: "Effect",
            via: "npm dep: effect",
            confidence: "authoritative",
          },
        ],
        warnings: ["heads up"],
      }),
    ),
  );
  expect(json.name).toBe("repo");
  expect(json.root).toBe("/repo");
  expect(json.scannedFiles).toBe(10);
  expect(json.truncated).toBe(false);
  expect(json.languages[0].name).toBe("TypeScript");
  expect(json.ecosystems[0].name).toBe("npm");
  expect(json.tooling[0].name).toBe("Bun");
  expect(json.frameworks[0].via).toBe("npm dep: effect");
  expect(json.warnings).toEqual(["heads up"]);
});

test("caps list lengths to bound the payload", () => {
  const languages = Array.from(
    { length: STACK_LIMITS.languages + 10 },
    (_, i) => ({
      name: `L${i}`,
      files: 1,
      locations: [] as string[],
      confidence: "heuristic" as const,
    }),
  );
  const ecosystems = [
    {
      name: "npm",
      manifests: Array.from(
        { length: STACK_LIMITS.manifestsPerEcosystem + 5 },
        (_, i) => `p${i}/package.json`,
      ),
      confidence: "authoritative" as const,
    },
  ];
  const tooling = [
    {
      name: "Bun",
      kinds: ["package manager" as const],
      evidence: Array.from(
        { length: STACK_LIMITS.evidencePerTool + 5 },
        (_, i) => `lockfile: p${i}/bun.lock`,
      ),
      confidence: "authoritative" as const,
    },
  ];
  const json = JSON.parse(
    renderStackContextJson(data({ languages, ecosystems, tooling })),
  );
  expect(json.languages).toHaveLength(STACK_LIMITS.languages);
  expect(json.ecosystems[0].manifests).toHaveLength(
    STACK_LIMITS.manifestsPerEcosystem,
  );
  expect(json.tooling[0].evidence).toHaveLength(STACK_LIMITS.evidencePerTool);
});
