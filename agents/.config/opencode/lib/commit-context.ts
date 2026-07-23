import { isAbsolute, relative, resolve } from "node:path";

type JsonRecord = Record<string, unknown>;

interface ParsedStatus {
  readonly staged: readonly string[];
  readonly unstaged: readonly string[];
  readonly untracked: readonly string[];
  readonly malformed: readonly string[];
}

interface CommitScope {
  readonly candidates: readonly string[];
  readonly excluded: readonly string[];
  readonly outsideRepository: readonly string[];
  readonly status: "complete" | "partial";
  readonly warnings: readonly string[];
}

export interface CommitContextInput {
  readonly context: unknown;
  readonly sessions: readonly SessionMessages[];
  readonly touchedFiles?: readonly string[];
  readonly diffStat?: string;
  readonly collectionWarnings?: readonly string[];
}

export interface SessionMessages {
  readonly projectID: string;
  readonly directory: string;
  readonly messages: unknown;
}

interface SessionReader {
  readonly session: (sessionID: string) => Promise<unknown>;
  readonly messages: (sessionID: string) => Promise<unknown>;
  readonly children: (sessionID: string) => Promise<unknown>;
}

export const MAX_COMMIT_CONTEXT_SESSIONS = 32;

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export function dataOrValue(value: unknown): unknown {
  if (!isRecord(value)) return value;
  return "data" in value && value.data !== undefined ? value.data : value;
}

const records = (value: unknown): readonly JsonRecord[] =>
  Array.isArray(value) ? value.filter(isRecord) : [];

const patchPathPattern = /^\*\*\* (?:Add|Delete|Update) File: (.+)$/gm;
const patchMovePattern = /^\*\*\* Move to: (.+)$/gm;

const absolutePath = (directory: string, path: string): string =>
  isAbsolute(path) ? resolve(path) : resolve(directory, path);

const toolInputPaths = (
  tool: string,
  input: JsonRecord,
  directory: string,
): readonly string[] => {
  if (tool === "edit" || tool === "write") {
    const filePath = stringField(input, "filePath");
    return filePath ? [absolutePath(directory, filePath)] : [];
  }
  if (tool !== "apply_patch") return [];

  const patchText = stringField(input, "patchText");
  const paths: string[] = [];
  for (const pattern of [patchPathPattern, patchMovePattern]) {
    pattern.lastIndex = 0;
    for (const match of patchText.matchAll(pattern)) {
      const path = match[1]?.trim();
      if (path) paths.push(absolutePath(directory, path));
    }
  }
  return paths;
};

export function sessionTouchedFiles(
  sessions: readonly SessionMessages[],
): readonly string[] {
  const files: string[] = [];
  for (const session of sessions) {
    if (!session.directory) continue;
    for (const message of records(dataOrValue(session.messages))) {
      for (const part of records(message.parts)) {
        if (part.type === "patch") {
          files.push(
            ...strings(part.files).map((path) =>
              absolutePath(session.directory, path),
            ),
          );
          continue;
        }
        if (part.type !== "tool" || !isRecord(part.state)) continue;
        if (part.state.status !== "completed" || !isRecord(part.state.input))
          continue;
        files.push(
          ...toolInputPaths(
            stringField(part, "tool"),
            part.state.input,
            session.directory,
          ),
        );
      }
    }
  }
  return uniqueSorted(files);
}

export async function collectSessionMessages(
  reader: SessionReader,
  sessionID: string,
): Promise<{
  readonly sessions: readonly SessionMessages[];
  readonly warnings: readonly string[];
}> {
  const pending = [sessionID];
  const visited = new Set<string>();
  const sessions: SessionMessages[] = [];
  const warnings: string[] = [];

  while (pending.length) {
    const current = pending.shift();
    if (!current) break;
    if (visited.has(current)) continue;
    if (visited.size >= MAX_COMMIT_CONTEXT_SESSIONS) {
      warnings.push(
        `Session traversal stopped after ${MAX_COMMIT_CONTEXT_SESSIONS} sessions.`,
      );
      break;
    }
    visited.add(current);

    const [sessionResponse, messageResponse, childrenResponse] =
      await Promise.all([
        reader.session(current),
        reader.messages(current),
        reader.children(current),
      ]);
    const session = dataOrValue(sessionResponse);
    sessions.push({
      projectID:
        isRecord(session) && typeof session.projectID === "string"
          ? session.projectID
          : "",
      directory:
        isRecord(session) && typeof session.directory === "string"
          ? session.directory
          : "",
      messages: messageResponse,
    });
    for (const child of records(dataOrValue(childrenResponse))) {
      if (typeof child.id === "string") pending.push(child.id);
    }
  }

  return { sessions, warnings };
}

const strings = (value: unknown): readonly string[] =>
  Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];

const stringField = (record: JsonRecord, field: string): string => {
  const value = record[field];
  return typeof value === "string" ? value : "";
};

const uniqueSorted = (values: Iterable<string>): readonly string[] =>
  [...new Set(values)].sort((left, right) => left.localeCompare(right));

const DIFF_STAT_LIMIT = 2_000;

const parseNameStatus = (
  value: unknown,
): {
  readonly paths: readonly string[];
  readonly malformed: readonly string[];
} => {
  if (typeof value !== "string" || !value.trim()) {
    return { paths: [], malformed: [] };
  }

  const paths: string[] = [];
  const malformed: string[] = [];
  for (const line of value.split("\n").filter(Boolean)) {
    const fields = line.split("\t");
    const path = fields.at(-1);
    if (fields.length < 2 || !fields[0] || !path) {
      malformed.push(line);
      continue;
    }
    paths.push(path);
  }
  return { paths: uniqueSorted(paths), malformed };
};

const parseStatus = (
  context: JsonRecord,
): ParsedStatus & { readonly schemaWarnings: readonly string[] } => {
  const schemaWarnings: string[] = [];
  const status = isRecord(context.status) ? context.status : {};
  if (!isRecord(context.status)) {
    schemaWarnings.push("Working-tree status is unavailable.");
  }
  for (const field of ["staged", "unstaged", "untracked"] as const) {
    if (typeof status[field] !== "string") {
      schemaWarnings.push(
        `Working-tree status field '${field}' is unavailable.`,
      );
    }
  }
  const staged = parseNameStatus(status.staged);
  const unstaged = parseNameStatus(status.unstaged);
  const untracked = parseNameStatus(status.untracked);
  return {
    staged: staged.paths,
    unstaged: unstaged.paths,
    untracked: untracked.paths,
    malformed: [
      ...staged.malformed,
      ...unstaged.malformed,
      ...untracked.malformed,
    ],
    schemaWarnings,
  };
};

const patchFiles = (
  sessions: readonly SessionMessages[],
): {
  readonly files: readonly string[];
  readonly warnings: readonly string[];
} => {
  const files: string[] = [];
  const warnings: string[] = [];
  const projectID = sessions[0]?.projectID;
  const parentDirectory = sessions[0]?.directory;
  for (const session of sessions) {
    if (
      !projectID ||
      !parentDirectory ||
      !session.projectID ||
      !session.directory
    ) {
      warnings.push("Session repository identity is unavailable.");
      continue;
    }
    const repositoryPath = relative(
      resolve(parentDirectory),
      resolve(session.directory),
    );
    if (
      session.projectID !== projectID ||
      repositoryPath.startsWith("..") ||
      isAbsolute(repositoryPath)
    ) {
      warnings.push(
        "A descendant session belongs to another repository and was excluded.",
      );
      continue;
    }
    for (const message of records(dataOrValue(session.messages))) {
      for (const part of records(message.parts)) {
        if (part.type === "patch") files.push(...strings(part.files));
      }
    }
  }
  return { files: uniqueSorted(files), warnings: uniqueSorted(warnings) };
};

const normaliseTouchedPaths = (
  repositoryRoot: string,
  files: readonly string[],
): {
  readonly inside: readonly string[];
  readonly outside: readonly string[];
} => {
  const root = resolve(repositoryRoot);
  const inside: string[] = [];
  const outside: string[] = [];

  for (const file of files) {
    const absolute = isAbsolute(file) ? resolve(file) : resolve(root, file);
    const repositoryPath = relative(root, absolute);
    if (
      !repositoryPath ||
      repositoryPath.startsWith("..") ||
      isAbsolute(repositoryPath)
    ) {
      outside.push(file);
      continue;
    }
    inside.push(repositoryPath);
  }

  return {
    inside: uniqueSorted(inside),
    outside: uniqueSorted(outside),
  };
};

const deriveScope = (
  context: JsonRecord,
  status: ParsedStatus & { readonly schemaWarnings: readonly string[] },
  sessions: readonly SessionMessages[],
  touchedFiles: readonly string[] | undefined,
  collectionWarnings: readonly string[],
): CommitScope => {
  const metadata = isRecord(context.branchMetadata)
    ? context.branchMetadata
    : {};
  const repositoryRoot = stringField(metadata, "repositoryRoot");
  const warnings = [
    ...collectionWarnings,
    ...strings(context.warnings),
    ...status.schemaWarnings,
  ];
  const truncations = records(context.truncations);
  if (!Array.isArray(context.warnings)) {
    warnings.push("Context warnings are unavailable.");
  }
  if (!Array.isArray(context.truncations)) {
    warnings.push("Context truncation metadata is unavailable.");
  }
  if (context.inRepo !== true) {
    warnings.push("The Context CLI did not confirm a git worktree.");
  }
  if (!repositoryRoot) warnings.push("Repository root is unavailable.");
  if (status.malformed.length) {
    warnings.push(
      `Could not parse ${status.malformed.length} working-tree status row(s).`,
    );
  }
  if (
    [...status.staged, ...status.unstaged, ...status.untracked].some((path) =>
      /\\[tnr]/.test(path),
    )
  ) {
    warnings.push(
      "One or more paths contain escaped control characters and require explicit verification.",
    );
  }
  if (truncations.length) {
    warnings.push("The context producer truncated one or more sections.");
  }

  const patches = touchedFiles
    ? { files: touchedFiles, warnings: [] }
    : patchFiles(sessions);
  warnings.push(...patches.warnings);
  const touched = repositoryRoot
    ? normaliseTouchedPaths(repositoryRoot, patches.files)
    : { inside: [], outside: patches.files };
  if (touched.outside.length) {
    warnings.push(
      "Session changes outside this repository require a separate scope refresh.",
    );
  }

  const current = uniqueSorted([
    ...status.staged,
    ...status.unstaged,
    ...status.untracked,
  ]);
  const touchedSet = new Set(touched.inside);
  const candidates = status.staged.length
    ? status.staged
    : current.filter((path) => touchedSet.has(path));
  const candidateSet = new Set(candidates);
  const excluded = current.filter((path) => !candidateSet.has(path));

  if (!status.staged.length && current.length && !candidates.length) {
    warnings.push(
      "No current dirty paths could be attributed to this session.",
    );
  }

  return {
    candidates,
    excluded,
    outsideRepository: touched.outside,
    status: warnings.length ? "partial" : "complete",
    warnings: uniqueSorted(warnings),
  };
};

const escapeXml = (value: string): string =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");

const list = (values: readonly string[]): string =>
  values.length
    ? values.map((value) => `- ${escapeXml(value)}`).join("\n")
    : "(none)";

const block = (name: string, description: string, body: string): string =>
  `<${name}>\nDescription: ${description}\n${body}\n</${name}>`;

const limited = (value: string, max = 20_000): string =>
  value.length <= max
    ? value
    : `${value.slice(0, max)}\n[TRUNCATED ${value.length - max} CHARS]`;

const recentSubjects = (value: string): string =>
  value
    .split("\n")
    .filter(Boolean)
    .slice(0, 5)
    .join("\n") || "(none)";

export function renderCommitContext({
  context: contextResponse,
  sessions,
  touchedFiles,
  diffStat,
  collectionWarnings = [],
}: CommitContextInput): string {
  const contextValue = dataOrValue(contextResponse);
  const context = isRecord(contextValue) ? contextValue : {};
  const status = parseStatus(context);
  const diffWasTruncated = (diffStat?.length ?? 0) > DIFF_STAT_LIMIT;
  const scope = deriveScope(context, status, sessions, touchedFiles, [
    ...collectionWarnings,
    ...(diffWasTruncated
      ? ["Diff stat exceeded the prompt limit and was truncated."]
      : []),
    ...(isRecord(contextValue) ? [] : ["Git context payload is unavailable."]),
  ]);
  const metadata = isRecord(context.branchMetadata)
    ? context.branchMetadata
    : {};
  const workScope = isRecord(context.workScope) ? context.workScope : {};
  const candidatesSource = status.staged.length
    ? "the existing staged set"
    : "current dirty paths touched by this OpenCode session tree";

  return [
    "<commit-context>",
    block(
      "context-metadata",
      "How this commit scope was assembled.",
      [
        "Produced from `context git --json --no-pr`, a compact Git diff stat, and persisted OpenCode patch parts.",
        `Repository root: ${escapeXml(stringField(metadata, "repositoryRoot") || "(unavailable)")}`,
        `Current branch: ${escapeXml(stringField(metadata, "currentBranch") || "(unavailable)")}`,
      ].join("\n"),
    ),
    block(
      "scope-status",
      "Whether this block is sufficient for committing without another discovery round.",
      [
        `Status: ${scope.status}`,
        `Candidate source: ${candidatesSource}`,
        scope.status === "complete"
          ? "Use the candidate paths as the reviewed commit boundary."
          : "Refresh or stop if the warnings affect the requested commit; never broaden scope to all dirty files.",
      ].join("\n"),
    ),
    block(
      "candidate-paths",
      "Paths eligible for this invocation. Use repeated `--path` arguments and split them only into coherent commits.",
      list(scope.candidates),
    ),
    block(
      "excluded-paths",
      "Other current dirty paths. Do not stage or commit these without explicit clarification.",
      list(scope.excluded),
    ),
    block(
      "diff-stat",
      "Compact change summary for grouping and subject selection.",
      escapeXml(limited(diffStat || "(unavailable)", DIFF_STAT_LIMIT)),
    ),
    block(
      "recent-commits",
      "Recent subjects for repository-local style context.",
      escapeXml(
        limited(
          recentSubjects(
            stringField(workScope, "branchCommits") ||
              stringField(context, "commits"),
          ),
        ),
      ),
    ),
    ...(scope.outsideRepository.length
      ? [
          block(
            "outside-repository-paths",
            "Session-touched paths outside this repository. Scope and commit them separately.",
            list(scope.outsideRepository),
          ),
        ]
      : []),
    ...(scope.warnings.length
      ? [
          block(
            "warnings",
            "Incomplete or ambiguous evidence that may require a Context MCP refresh or user clarification.",
            list(scope.warnings),
          ),
        ]
      : []),
    "</commit-context>",
  ].join("\n\n");
}

export function renderCommitContexts(
  contexts: readonly CommitContextInput[],
  warnings: readonly string[] = [],
): string {
  if (contexts.length === 1) return renderCommitContext(contexts[0]);

  if (!contexts.length) {
    return [
      "<commit-context>",
      block(
        "scope-status",
        "Whether this block is sufficient for committing without another discovery round.",
        "Status: partial\nNo repository scope could be resolved. Stop rather than inferring scope from dirty files.",
      ),
      block(
        "warnings",
        "Collection failures that prevented deterministic repository scope.",
        list(warnings.length ? warnings : ["Repository scope is unavailable."]),
      ),
      "</commit-context>",
    ].join("\n\n");
  }

  const scopes = contexts.map((context) => {
    const rendered = renderCommitContext(context);
    const inner = rendered
      .slice("<commit-context>".length, -"</commit-context>".length)
      .trim();
    return `<repository-scope>\n${inner}\n</repository-scope>`;
  });
  return [
    "<commit-context>",
    block(
      "repository-count",
      "Number of independently scoped repositories touched by this session.",
      String(contexts.length),
    ),
    ...scopes,
    "</commit-context>",
  ].join("\n\n");
}
