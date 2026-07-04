/**
 * @file JSON renderer for `dot stack-context --json`.
 *
 * Serialises a {@link StackContextData} snapshot into the structured payload the
 * OpenCode stack-context plugin consumes. List lengths are capped here (via
 * {@link STACK_LIMITS}) so prompt-size bounding lives in one place and the
 * plugin stays a thin renderer.
 */
import { STACK_LIMITS } from "./model.js";
import type { StackContextData } from "./model.js";

/**
 * Render the stack-context snapshot as the JSON payload consumed by the plugin.
 * The languages, ecosystems, tooling, and frameworks lists (plus per-entry
 * manifests/evidence) are capped so a pathological repository cannot inflate the
 * prompt.
 */
export function renderStackContextJson(data: StackContextData): string {
  const payload = {
    root: data.root,
    name: data.name,
    scannedFiles: data.scannedFiles,
    truncated: data.truncated,
    languages: data.languages.slice(0, STACK_LIMITS.languages),
    ecosystems: data.ecosystems
      .slice(0, STACK_LIMITS.ecosystems)
      .map((ecosystem) => ({
        ...ecosystem,
        manifests: ecosystem.manifests.slice(
          0,
          STACK_LIMITS.manifestsPerEcosystem,
        ),
      })),
    tooling: data.tooling.slice(0, STACK_LIMITS.tooling).map((tool) => ({
      ...tool,
      evidence: tool.evidence.slice(0, STACK_LIMITS.evidencePerTool),
    })),
    frameworks: data.frameworks.slice(0, STACK_LIMITS.frameworks),
    warnings: data.warnings,
  };
  return JSON.stringify(payload);
}
