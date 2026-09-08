import { isDeepStrictEqual } from "node:util";
import { decodeJson, isJsonObject } from "./schema.js";

/** Enable one existing repository with a single-line edit, preserving all other bytes. */
export function agentOxlintOptInText(
  source: string,
  repositoryIndex: number,
): string {
  const original = decodeJson(Bun.YAML.parse(source));
  if (!isJsonObject(original) || !Array.isArray(original.repositories)) {
    throw new Error("Invalid repository config");
  }
  const repository = original.repositories[repositoryIndex];
  if (repository === undefined || !isJsonObject(repository)) {
    throw new Error("Repository entry is missing");
  }
  if (repository.agent_oxlint === true) return source;

  const expected = {
    ...original,
    repositories: original.repositories.map((entry, index) =>
      index === repositoryIndex ? { ...repository, agent_oxlint: true } : entry,
    ),
  };
  const candidates: string[] = [];
  for (const match of source.matchAll(/^([ \t]*)([^\r\n]*)(\r?\n|$)/gm)) {
    const [line, indent, content, newline] = match;
    let replacement: string;
    if (repository.agent_oxlint === false) {
      if (!/^agent_oxlint:\s*false(?:\s+#.*|\s*)$/.test(content)) continue;
      replacement = line.replace(/(:\s*)false/, "$1true");
    } else {
      if (!/^path:/.test(content) || !newline) continue;
      replacement = `${line}${indent}agent_oxlint: true${newline}`;
    }
    const candidate =
      source.slice(0, match.index) +
      replacement +
      source.slice(match.index + line.length);
    // Parsing is only for validation. Never serialise YAML back over the file.
    try {
      if (isDeepStrictEqual(decodeJson(Bun.YAML.parse(candidate)), expected)) {
        candidates.push(candidate);
      }
    } catch {
      // A matching line may be inside a scalar or another YAML structure.
      continue;
    }
  }
  if (candidates.length !== 1) {
    throw new Error(
      "Cannot identify a unique single-line opt-in edit in block-style YAML",
    );
  }
  return candidates[0];
}
