export type JsonRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const stringField = (record: JsonRecord, field: string): string => {
  const value = record[field];
  return typeof value === "string" ? value : "";
};

const numberField = (record: JsonRecord, field: string): number => {
  const value = record[field];
  return typeof value === "number" ? value : 0;
};

const stringArray = (value: unknown): string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

const recordArray = (value: unknown): JsonRecord[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

export const parseStackContextJSON = (text: string): JsonRecord | null => {
  try {
    const parsed: unknown = JSON.parse(text);
    return isRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
};

const escapeXml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");

export const isEmptyStackContext = (data: JsonRecord): boolean =>
  recordArray(data.languages).length === 0 &&
  recordArray(data.ecosystems).length === 0 &&
  recordArray(data.tooling).length === 0 &&
  recordArray(data.frameworks).length === 0;

const formatTag = (
  name: string,
  description: string,
  lines: readonly string[],
): string => {
  const body = [
    `Description: ${description}`,
    ...lines.filter(Boolean).map((line) => escapeXml(line)),
  ]
    .join("\n")
    .trim();
  return [`<${name}>`, body || "(none)", `</${name}>`].join("\n");
};

const renderLanguages = (languages: JsonRecord[]): string[] => {
  if (!languages.length) return ["(none detected)"];
  return languages.map((language) => {
    const files = numberField(language, "files");
    const noun = files === 1 ? "file" : "files";
    const locations = stringArray(language.locations);
    const where = locations.length ? ` · ${locations.join(", ")}` : "";
    return `${stringField(language, "name")} — ${files} ${noun}${where}`;
  });
};

const renderEcosystems = (ecosystems: JsonRecord[]): string[] => {
  if (!ecosystems.length) return ["(none detected)"];
  return ecosystems.map((ecosystem) => {
    const manifests = stringArray(ecosystem.manifests);
    return `${stringField(ecosystem, "name")}: ${manifests.join(", ") || "(none)"}`;
  });
};

const renderTooling = (tools: JsonRecord[]): string[] => {
  if (!tools.length) return ["(none detected)"];
  return tools.map((tool) => {
    const kinds = stringArray(tool.kinds);
    const evidence = stringArray(tool.evidence);
    const suffix = [kinds.join(", "), evidence.join(", ")]
      .filter(Boolean)
      .join("; ");
    return `${stringField(tool, "name")}${suffix ? ` (${suffix})` : ""}`;
  });
};

const renderFrameworks = (frameworks: JsonRecord[]): string[] => {
  if (!frameworks.length) return ["(none detected)"];
  return frameworks.map(
    (framework) =>
      `${stringField(framework, "name")} (${stringField(framework, "via")})`,
  );
};

const renderTruncations = (truncations: JsonRecord[]): string[] => {
  if (!truncations.length) return [];
  return truncations.map((truncation) => {
    const details = [
      `limit=${numberField(truncation, "limit")}`,
      typeof truncation.observed === "number"
        ? `observed=${truncation.observed}`
        : "",
      typeof truncation.omitted === "number"
        ? `omitted=${truncation.omitted}`
        : "",
      stringField(truncation, "subject")
        ? `subject=${stringField(truncation, "subject")}`
        : "",
    ].filter(Boolean);
    return `${stringField(truncation, "reason") || "unknown"}: ${details.join(" ")}`;
  });
};

export const renderStackContext = (data: JsonRecord): string => {
  const scanned = numberField(data, "scannedFiles");
  const truncations = recordArray(data.truncations);
  if (data.truncated === true && truncations.length === 0) {
    truncations.push({ reason: "maxFiles", limit: 0 });
  }
  const warnings = stringArray(data.warnings);

  const lines = [
    "<stack-context>",
    formatTag(
      "context-metadata",
      "How this codebase stack snapshot was generated.",
      [
        "Produced by `context stack --json`. Git-aware and deterministic (no LLM); prefer it over re-scanning the tree.",
        `Generated at: ${new Date().toISOString()}`,
        `Root: ${stringField(data, "name") || "(unknown)"} (${stringField(data, "root") || "(unknown)"})`,
        `Files scanned: ${scanned}`,
      ],
    ),
    formatTag(
      "languages",
      "Detected languages with file counts and their general locations.",
      renderLanguages(recordArray(data.languages)),
    ),
    formatTag(
      "ecosystems",
      "Package ecosystems detected from manifest files.",
      renderEcosystems(recordArray(data.ecosystems)),
    ),
    formatTag(
      "tooling",
      "Package managers, linters, formatters, task runners, build tools, and test runners detected from lockfiles, configs, and declared dependencies.",
      renderTooling(recordArray(data.tooling)),
    ),
    formatTag(
      "frameworks",
      "Frameworks and libraries detected from declared dependencies.",
      renderFrameworks(recordArray(data.frameworks)),
    ),
  ];

  if (truncations.length) {
    lines.push(
      formatTag(
        "truncations",
        "Applied scan, collection, and output limits. Treat affected sections as partial.",
        renderTruncations(truncations),
      ),
    );
  }

  if (warnings.length) {
    lines.push(
      formatTag(
        "warnings",
        "Non-fatal collection issues that may affect interpretation.",
        warnings,
      ),
    );
  }

  lines.push("</stack-context>");
  return lines.join("\n\n");
};
