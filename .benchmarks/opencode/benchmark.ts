import {
  chmod,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rename,
  rm,
  writeFile,
} from "node:fs/promises";
import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import {
  PINNED_COMMIT,
  scenarios,
  type BenchmarkScenario,
  type FindingExpectation,
  type ScenarioMode,
} from "./scenarios";

export interface ToolPart {
  readonly type: "tool";
  readonly tool: string;
  readonly state: {
    readonly status: string;
    readonly input?: unknown;
    readonly error?: string;
  };
}

export interface RunEvent {
  readonly type: string;
  readonly timestamp?: number;
  readonly sessionID?: string;
  readonly part?: ToolPart | { readonly type?: string; readonly text?: string };
  readonly error?: unknown;
}

export interface ProcessResult {
  readonly exitCode: number;
  readonly stdout: string;
  readonly stderr: string;
  readonly elapsedMs: number;
  readonly timedOut: boolean;
}

export interface RunEvidence {
  readonly exitCode: number;
  readonly timedOut: boolean;
  readonly events: readonly RunEvent[];
  readonly stderr: string;
  readonly finalText: string;
  readonly agent: string;
  readonly agentSourceHash: string;
  readonly expectedAgentSourceHash: string;
  readonly skillSourceHashes: Readonly<Record<string, string>>;
  readonly expectedSkillSourceHashes: Readonly<Record<string, string>>;
  readonly workspacePath: string;
  readonly baselineChangedPaths: readonly string[];
  readonly changedPaths: readonly string[];
  readonly diff: string;
  readonly beforeTree: string;
  readonly afterTree: string;
  readonly workspaceRemoved: boolean;
  readonly canonicalCommit: string;
  readonly contextAudit: ContextAudit;
}

export interface ContextContributor {
  readonly name: string;
  readonly chars: number;
}

export interface DuplicateGuidance {
  readonly text: string;
  readonly skills: readonly string[];
}

export interface ContextAudit {
  readonly captured: boolean;
  readonly systemChars: number;
  readonly toolChars: number;
  readonly toolDefinitionCalls: number;
  readonly uniqueTools: number;
  readonly repeatedToolDefinitions: readonly ContextContributor[];
  readonly totalStarterChars: number;
  readonly estimatedStarterTokens: number;
  readonly systemSegments: readonly ContextContributor[];
  readonly largestTools: readonly ContextContributor[];
  readonly loadedSkillChars: number;
  readonly estimatedLoadedSkillTokens: number;
  readonly loadedSkills: readonly ContextContributor[];
  readonly unmeasuredLoadedSkills: readonly string[];
  readonly duplicateGuidance: readonly DuplicateGuidance[];
}

export interface DeterministicCheck {
  readonly name: string;
  readonly passed: boolean;
  readonly detail: string;
}

export interface DeterministicResult {
  readonly passed: boolean;
  readonly checks: readonly DeterministicCheck[];
}

export interface RunRecord {
  readonly scenario: string;
  readonly repeat: number;
  readonly mode: ScenarioMode;
  readonly elapsedMs: number;
  readonly evidence: RunEvidence;
  readonly result: DeterministicResult;
}

interface Options {
  readonly model: string;
  readonly evaluatorModel: string;
  readonly repeat: number;
  readonly timeoutMs: number;
  readonly scenario?: string;
  readonly skipEvaluator: boolean;
}

export interface HostRunSummary {
  readonly scenario: string;
  readonly repeat: number;
  readonly agent: string;
  readonly requiredSkills: readonly string[];
  readonly loadedSkills: readonly string[];
  readonly agentSourceHash: string;
  readonly skillSourceHashes: Readonly<Record<string, string>>;
  readonly passed: boolean;
  readonly failedChecks: readonly DeterministicCheck[];
  readonly boundaryAudit: {
    readonly prohibitedToolCalls: readonly string[];
    readonly answerLookupAttempts: number;
    readonly externalPathAttempts: number;
    readonly changedPaths: readonly string[];
    readonly workspaceRemoved: boolean;
  };
  readonly contextAudit: ContextAudit;
}

const repositoryRoot = resolve(import.meta.dir, "../..");
const outputRoot = resolve(repositoryRoot, ".benchmarks/output/opencode");
const prohibitedTools = new Set([
  "task",
  "webfetch",
  "websearch",
  "github_web_search",
  "grep_searchGitHub",
  "cursor_delegate",
  "cursor_cloud_agent",
]);
const allowedReadOnlyShell = /^(?:git (?:diff|status|show)(?:\s|$))/;
const lookupTerms = [
  ".benchmarks",
  "benchmark.ts",
  "scenarios.ts",
  "expectedfindings",
  "deterministicresult",
  ".plannotator",
  "/documents/notes",
  "/.ctx",
  '".git"',
  ".git/",
];

const emptyContextAudit = (): ContextAudit => ({
  captured: false,
  systemChars: 0,
  toolChars: 0,
  toolDefinitionCalls: 0,
  uniqueTools: 0,
  repeatedToolDefinitions: [],
  totalStarterChars: 0,
  estimatedStarterTokens: 0,
  systemSegments: [],
  largestTools: [],
  loadedSkillChars: 0,
  estimatedLoadedSkillTokens: 0,
  loadedSkills: [],
  unmeasuredLoadedSkills: [],
  duplicateGuidance: [],
});

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null
    ? (value as Record<string, unknown>)
    : undefined;
}

export function parseRunEvents(output: string): RunEvent[] {
  return output
    .split("\n")
    .filter((line) => line.trim().length > 0)
    .map((line, index) => {
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        throw new Error(`Invalid OpenCode JSON event on line ${index + 1}`);
      }
      const record = asRecord(value);
      if (!record || typeof record.type !== "string") {
        throw new Error(`Invalid OpenCode event shape on line ${index + 1}`);
      }
      return value as RunEvent;
    });
}

export function extractFinalText(events: readonly RunEvent[]): string {
  return events
    .map((event) =>
      event.type === "text" && event.part?.type === "text"
        ? (event.part.text ?? "")
        : "",
    )
    .filter(Boolean)
    .join("\n\n")
    .trim();
}

function toolEvents(events: readonly RunEvent[]): ToolPart[] {
  const tools: ToolPart[] = [];
  for (const event of events) {
    const part = event.part;
    if (event.type === "tool_use" && part?.type === "tool" && "tool" in part) {
      tools.push(part);
    }
  }
  return tools;
}

export function loadedSkills(events: readonly RunEvent[]): string[] {
  return toolEvents(events).flatMap((tool) => {
    if (tool.tool !== "skill") return [];
    const input = asRecord(tool.state.input);
    return typeof input?.name === "string" ? [input.name] : [];
  });
}

function guidanceLines(content: string): string[] {
  return content
    .split("\n")
    .map((line) => line.trim().replace(/^[-*]\s+/, ""))
    .filter((line) => line.length >= 48 && !line.startsWith("#"));
}

function skillBody(content: string): string {
  if (!content.startsWith("---\n")) return content;
  const end = content.indexOf("\n---\n", 4);
  return end === -1 ? content : content.slice(end + 5).trim();
}

function systemSegmentName(content: string, segment: number): string {
  if (content.includes("<available_skills>")) return "skill-catalogue";
  if (content.includes("<stack-context>")) return "stack-context";
  if (content.includes("<branch-context>")) return "branch-context";
  if (content.includes("<repo-note-context>")) return "repo-note-context";
  if (content.includes("# Global agent instructions")) return "global-agents";
  if (content.includes("# DOTFILES AGENTS")) return "repository-agents";
  if (content.includes("You are OpenCode")) return "core-agent-prompt";
  return `system/${segment}`;
}

function duplicateGuidance(
  skills: Readonly<Record<string, string>>,
): DuplicateGuidance[] {
  const occurrences = new Map<string, Set<string>>();
  for (const [skill, content] of Object.entries(skills)) {
    for (const line of new Set(guidanceLines(content))) {
      const normalized = line.toLowerCase().replaceAll(/\s+/g, " ");
      const names = occurrences.get(normalized) ?? new Set<string>();
      names.add(skill);
      occurrences.set(normalized, names);
    }
  }
  return [...occurrences.entries()]
    .filter(([, names]) => names.size > 1)
    .map(([text, names]) => ({ text, skills: [...names].sort() }))
    .sort((left, right) => right.text.length - left.text.length);
}

async function contextAudit(
  captureParent: string,
  loaded: readonly string[],
  skillSources: Readonly<Record<string, string>>,
): Promise<ContextAudit> {
  const entries = await readdir(captureParent, { withFileTypes: true }).catch(
    () => [],
  );
  const captures = entries
    .filter(
      (entry) =>
        entry.isDirectory() && entry.name.startsWith("context-baseline-"),
    )
    .map((entry) => join(captureParent, entry.name))
    .sort();
  const capture = captures.at(-1);
  if (!capture) return emptyContextAudit();

  const systemIndex = JSON.parse(
    await readFile(join(capture, "system-index.json"), "utf8"),
  ) as Array<{ segment: number; chars: number; file: string }>;
  const tools = (await readFile(join(capture, "tools.jsonl"), "utf8"))
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line) as { toolID: string; totalChars: number });
  const toolCallsByID = Map.groupBy(tools, (tool) => tool.toolID);
  const uniqueTools = [...toolCallsByID.entries()].map(([toolID, records]) => ({
    toolID,
    totalChars: Math.max(...records.map((record) => record.totalChars)),
  }));
  const loadedSkillSources = Object.fromEntries(
    loaded.flatMap((name) =>
      skillSources[name] === undefined
        ? []
        : [[name, skillBody(skillSources[name])]],
    ),
  );
  const loadedSkillContributors = Object.entries(loadedSkillSources)
    .map(([name, content]) => ({ name, chars: content.length }))
    .sort((left, right) => right.chars - left.chars);
  const systemSegments = (
    await Promise.all(
      systemIndex.map(async (item) => ({
        name: systemSegmentName(
          await readFile(join(capture, item.file), "utf8"),
          item.segment,
        ),
        chars: item.chars,
      })),
    )
  ).sort((left, right) => right.chars - left.chars);
  const largestTools = uniqueTools
    .map((tool) => ({ name: tool.toolID, chars: tool.totalChars }))
    .sort((left, right) => right.chars - left.chars)
    .slice(0, 10);
  const systemChars = systemIndex.reduce(
    (total, item) => total + item.chars,
    0,
  );
  const toolChars = uniqueTools.reduce(
    (total, tool) => total + tool.totalChars,
    0,
  );

  return {
    captured: true,
    systemChars,
    toolChars,
    toolDefinitionCalls: tools.length,
    uniqueTools: uniqueTools.length,
    repeatedToolDefinitions: [...toolCallsByID.entries()]
      .filter(([, records]) => records.length > 1)
      .map(([name, records]) => ({ name, chars: records.length }))
      .sort((left, right) => right.chars - left.chars),
    totalStarterChars: systemChars + toolChars,
    estimatedStarterTokens: Math.ceil((systemChars + toolChars) / 4),
    systemSegments,
    largestTools,
    loadedSkillChars: loadedSkillContributors.reduce(
      (total, item) => total + item.chars,
      0,
    ),
    estimatedLoadedSkillTokens: Math.ceil(
      loadedSkillContributors.reduce((total, item) => total + item.chars, 0) /
        4,
    ),
    loadedSkills: loadedSkillContributors,
    unmeasuredLoadedSkills: loaded.filter(
      (name) => skillSources[name] === undefined,
    ),
    duplicateGuidance: duplicateGuidance(loadedSkillSources),
  };
}

function serialisedInput(tool: ToolPart): string {
  return JSON.stringify(tool.state.input ?? {}).toLowerCase();
}

function isProhibitedTool(tool: ToolPart): boolean {
  if (prohibitedTools.has(tool.tool)) return true;
  if (tool.tool !== "bash") return false;
  const input = asRecord(tool.state.input);
  const command = typeof input?.command === "string" ? input.command : "";
  return command
    .split(/&&|\|\||;/)
    .map((segment) => segment.trim())
    .some((segment) => !allowedReadOnlyShell.test(segment));
}

function inputStrings(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (Array.isArray(value)) return value.flatMap(inputStrings);
  const record = asRecord(value);
  return record ? Object.values(record).flatMap(inputStrings) : [];
}

function toolPaths(tool: ToolPart): string[] {
  const input = asRecord(tool.state.input);
  if (!input) return [];
  return [
    "filePath",
    "path",
    "workdir",
    "cwd",
    "directory",
    "destination",
  ].flatMap((key) => (typeof input[key] === "string" ? [input[key]] : []));
}

function accessesExternalPath(tool: ToolPart, workspacePath: string): boolean {
  return toolPaths(tool).some((value) => {
    if (value.includes("../")) return true;
    return (
      value.startsWith("/") &&
      !resolve(value).startsWith(`${workspacePath}/`) &&
      resolve(value) !== workspacePath
    );
  });
}

function findingCheck(
  finalText: string,
  expectation: FindingExpectation,
): boolean {
  const lower = finalText.toLowerCase();
  const escapedPath = expectation.path.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return (
    new RegExp(`${escapedPath}:\\d+`, "i").test(finalText) &&
    lower.includes(expectation.changedText.toLowerCase()) &&
    !/no (?:scoped |concrete )?findings/i.test(finalText)
  );
}

export function scoreRun(
  scenario: BenchmarkScenario,
  evidence: RunEvidence,
): DeterministicResult {
  const tools = toolEvents(evidence.events);
  const skills = loadedSkills(evidence.events);
  const changed = new Set(evidence.changedPaths);
  const checks: DeterministicCheck[] = [
    {
      name: "process completed",
      passed: evidence.exitCode === 0 && !evidence.timedOut,
      detail: `exit=${evidence.exitCode}, timedOut=${evidence.timedOut}`,
    },
    {
      name: "pinned source preserved",
      passed: evidence.canonicalCommit === PINNED_COMMIT,
      detail: `canonical=${evidence.canonicalCommit}`,
    },
    {
      name: "workspace destroyed",
      passed: evidence.workspaceRemoved,
      detail: `removed=${evidence.workspaceRemoved}`,
    },
    {
      name: "no prohibited tools or fetches",
      passed: tools.every((tool) => !isProhibitedTool(tool)),
      detail:
        tools
          .filter(isProhibitedTool)
          .map((tool) => tool.tool)
          .join(", ") || "none",
    },
    {
      name: "no answer lookup",
      passed: tools.every((tool) =>
        lookupTerms.every((term) => !serialisedInput(tool).includes(term)),
      ),
      detail:
        tools
          .filter((tool) =>
            lookupTerms.some((term) => serialisedInput(tool).includes(term)),
          )
          .map((tool) => `${tool.tool}:${serialisedInput(tool)}`)
          .join("\n") || "none",
    },
    {
      name: "no external paths",
      passed: tools.every(
        (tool) => !accessesExternalPath(tool, evidence.workspacePath),
      ),
      detail:
        tools
          .filter((tool) => accessesExternalPath(tool, evidence.workspacePath))
          .map((tool) => `${tool.tool}:${serialisedInput(tool)}`)
          .join("\n") || "none",
    },
    {
      name: "agent did not fall back",
      passed: !/agent .* not found|falling back/i.test(evidence.stderr),
      detail:
        evidence.stderr
          .match(/agent .* not found|falling back/gi)
          ?.join(", ") ?? "none",
    },
    {
      name: "shipped agent source loaded",
      passed:
        evidence.agent === scenario.agent &&
        evidence.agentSourceHash === evidence.expectedAgentSourceHash,
      detail: `agent=${evidence.agent}, source=${evidence.agentSourceHash}, expected=${evidence.expectedAgentSourceHash}`,
    },
    {
      name: "shipped skill sources loaded",
      passed: scenario.requiredSkills.every(
        (skill) =>
          evidence.skillSourceHashes[skill] ===
          evidence.expectedSkillSourceHashes[skill],
      ),
      detail: scenario.requiredSkills
        .map(
          (skill) =>
            `${skill}=${evidence.skillSourceHashes[skill] ?? "missing"}/${evidence.expectedSkillSourceHashes[skill] ?? "missing"}`,
        )
        .join(", "),
    },
    {
      name: "required skills loaded",
      passed: scenario.requiredSkills.every((skill) => skills.includes(skill)),
      detail: `required=${scenario.requiredSkills.join(", ")}, loaded=${skills.join(", ")}`,
    },
    {
      name: "scope skill loaded first",
      passed:
        skills.length > 0 &&
        skills[0] === "changeset-scope" &&
        (!skills.includes("code-review") ||
          skills.indexOf("changeset-scope") < skills.indexOf("code-review")),
      detail: skills.join(" -> ") || "none",
    },
    {
      name: "engineering baseline loaded after scope",
      passed:
        skills.length > 1 &&
        skills[0] === "changeset-scope" &&
        ["effect", "effect-principles"].includes(skills[1]) &&
        !(skills.includes("effect") && skills.includes("effect-principles")),
      detail: skills.join(" -> ") || "none",
    },
    {
      name: "starter context captured",
      passed: evidence.contextAudit.captured,
      detail: evidence.contextAudit.captured
        ? `starter=${evidence.contextAudit.totalStarterChars} chars, loaded-skills=${evidence.contextAudit.loadedSkillChars} chars`
        : "missing context capture",
    },
  ];

  if (scenario.mode === "implementation") {
    checks.push(
      {
        name: "required paths changed",
        passed: scenario.requiredChangedPaths.every((path) =>
          changed.has(path),
        ),
        detail: scenario.requiredChangedPaths.join(", ") || "none",
      },
      {
        name: "changed paths allowed",
        passed: evidence.changedPaths.every((path) =>
          scenario.allowedChangedPaths.includes(path),
        ),
        detail: evidence.changedPaths.join(", ") || "none",
      },
      {
        name: "forbidden paths unchanged",
        passed: scenario.forbiddenChangedPaths.every(
          (path) => !changed.has(path),
        ),
        detail: scenario.forbiddenChangedPaths.join(", ") || "none",
      },
      {
        name: "required implementation present",
        passed: scenario.requiredDiffText.every((text) =>
          evidence.diff.includes(text),
        ),
        detail: scenario.requiredDiffText.join(", ") || "none",
      },
      {
        name: "forbidden implementation absent",
        passed: scenario.forbiddenDiffText.every(
          (text) => !evidence.diff.includes(`+${text}`),
        ),
        detail: scenario.forbiddenDiffText.join(", ") || "none",
      },
    );
  } else {
    checks.push({
      name: "review remained read-only",
      passed:
        evidence.beforeTree === evidence.afterTree &&
        evidence.changedPaths.join("\0") ===
          evidence.baselineChangedPaths.join("\0"),
      detail: `before=${evidence.beforeTree}, after=${evidence.afterTree}, baseline=${evidence.baselineChangedPaths.join(", ")}, final=${evidence.changedPaths.join(", ")}`,
    });
    if (scenario.expectedFindings === "none") {
      checks.push({
        name: "reported no findings",
        passed:
          /no (?:scoped |concrete )?findings|no findings (?:were )?(?:found|discovered)/i.test(
            evidence.finalText,
          ) && !/^\s*(?:[-*]|\d+\.)\s+.*:\d+/m.test(evidence.finalText),
        detail: evidence.finalText,
      });
    } else {
      checks.push({
        name: "findings anchor to changed code",
        passed: scenario.expectedFindings.every((expectation) =>
          findingCheck(evidence.finalText, expectation),
        ),
        detail: evidence.finalText,
      });
    }
  }

  return { passed: checks.every((check) => check.passed), checks };
}

async function run(
  command: readonly string[],
  options: {
    readonly cwd: string;
    readonly env?: Readonly<Record<string, string | undefined>>;
    readonly timeoutMs?: number;
  },
): Promise<ProcessResult> {
  const started = performance.now();
  const controller = new AbortController();
  let timedOut = false;
  const timeout = options.timeoutMs
    ? setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, options.timeoutMs)
    : undefined;
  const process = Bun.spawn([...command], {
    cwd: options.cwd,
    env: options.env,
    stdout: "pipe",
    stderr: "pipe",
    signal: controller.signal,
  });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(process.stdout).text(),
    new Response(process.stderr).text(),
    process.exited,
  ]).finally(() => {
    if (timeout) clearTimeout(timeout);
  });
  return {
    exitCode,
    stdout,
    stderr,
    elapsedMs: Math.round(performance.now() - started),
    timedOut,
  };
}

async function git(cwd: string, ...args: string[]): Promise<string> {
  const result = await run(["git", ...args], { cwd });
  if (result.exitCode !== 0) {
    throw new Error(`git ${args.join(" ")} failed: ${result.stderr}`);
  }
  return result.stdout.trimEnd();
}

async function collectRuntimeLogs(root: string): Promise<string> {
  const paths = [
    ...new Bun.Glob("**/*.log").scanSync({
      cwd: root,
      dot: true,
      onlyFiles: true,
    }),
  ].sort();
  const logs = await Promise.all(
    paths.map(
      async (path) => `## ${path}\n${await readFile(join(root, path), "utf8")}`,
    ),
  );
  return logs.join("\n\n");
}

async function treeHash(workspace: string): Promise<string> {
  const hash = createHash("sha256");
  const paths = [
    ...new Bun.Glob("**/*").scanSync({
      cwd: workspace,
      dot: true,
      onlyFiles: true,
    }),
  ]
    .filter((path) => path !== ".git" && !path.startsWith(".git/"))
    .sort();
  for (const path of paths) {
    hash.update(path);
    hash.update("\0");
    hash.update(
      new Uint8Array(await Bun.file(join(workspace, path)).arrayBuffer()),
    );
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function pinnedFile(path: string): Promise<string> {
  return git(repositoryRoot, "show", `${PINNED_COMMIT}:${path}`);
}

async function currentAsset(path: string): Promise<string> {
  return readFile(resolve(repositoryRoot, path), "utf8");
}

async function writeFixtureFiles(
  workspace: string,
  files: ReadonlyMap<string, string>,
) {
  for (const [path, content] of files) {
    const target = resolve(workspace, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, `${content}\n`);
  }
}

async function materialiseFixture(
  root: string,
  scenario: BenchmarkScenario,
): Promise<{ workspace: string; beforeTree: string }> {
  const workspace = join(root, "workspace");
  await mkdir(workspace, { recursive: true });
  const files = new Map<string, string>();
  await Promise.all(
    scenario.sourcePaths.map(async (path) =>
      files.set(path, await pinnedFile(path)),
    ),
  );
  await writeFixtureFiles(workspace, files);
  await writeFile(
    join(workspace, "AGENTS.md"),
    "# Fixture instructions\n\nWork only on the requested change. Surrounding code is context, not extra scope. Do not use network tools, inspect paths outside this repository, or search for benchmark answers.\n",
  );
  await git(workspace, "init", "--quiet");
  await git(workspace, "config", "user.name", "OpenCode Benchmark");
  await git(workspace, "config", "user.email", "benchmark@localhost");
  await git(workspace, "add", ".");
  await git(workspace, "commit", "--quiet", "-m", "Fixture baseline");

  if (scenario.prepare) {
    scenario.prepare(files);
    await writeFixtureFiles(workspace, files);
  }
  return { workspace, beforeTree: await treeHash(workspace) };
}

async function isolatedConfig(
  root: string,
  agent: BenchmarkScenario["agent"],
  skills: readonly string[],
): Promise<{
  config: string;
  agentSourceHash: string;
  expectedAgentSourceHash: string;
  skillSourceHashes: Readonly<Record<string, string>>;
  expectedSkillSourceHashes: Readonly<Record<string, string>>;
  skillSources: Readonly<Record<string, string>>;
}> {
  const config = join(root, "config");
  await mkdir(join(config, "agents"), { recursive: true });
  const agentSource = await currentAsset(
    `agents/.config/opencode/agents/${agent}.md`,
  );
  await writeFile(join(config, "agents", `${agent}.md`), agentSource);
  const skillSourceHashes: Record<string, string> = {};
  const expectedSkillSourceHashes: Record<string, string> = {};
  const skillSources: Record<string, string> = {};
  for (const skill of skills) {
    await mkdir(join(config, "skills", skill), { recursive: true });
    const skillSource = await currentAsset(
      `agents/.agents/skills/${skill}/SKILL.md`,
    );
    await writeFile(join(config, "skills", skill, "SKILL.md"), skillSource);
    skillSources[skill] = skillSource;
    expectedSkillSourceHashes[skill] = createHash("sha256")
      .update(skillSource)
      .digest("hex");
    skillSourceHashes[skill] = createHash("sha256")
      .update(await readFile(join(config, "skills", skill, "SKILL.md"), "utf8"))
      .digest("hex");
  }
  const copiedAgentSource = await readFile(
    join(config, "agents", `${agent}.md`),
    "utf8",
  );
  return {
    config,
    agentSourceHash: createHash("sha256")
      .update(copiedAgentSource)
      .digest("hex"),
    expectedAgentSourceHash: createHash("sha256")
      .update(agentSource)
      .digest("hex"),
    skillSourceHashes,
    expectedSkillSourceHashes,
    skillSources,
  };
}

async function authContent(): Promise<string> {
  if (process.env.OPENCODE_AUTH_CONTENT)
    return process.env.OPENCODE_AUTH_CONTENT;
  const dataHome = process.env.XDG_DATA_HOME ?? join(homedir(), ".local/share");
  try {
    return await readFile(join(dataHome, "opencode/auth.json"), "utf8");
  } catch {
    return "{}";
  }
}

async function openCodeEnvironment(
  root: string,
  config: string,
  agent: BenchmarkScenario["agent"],
) {
  const home = join(root, "home");
  const xdg = {
    config: join(root, "xdg-config"),
    data: join(root, "xdg-data"),
    state: join(root, "xdg-state"),
    cache: join(root, "xdg-cache"),
  };
  await Promise.all(
    [home, ...Object.values(xdg)].map((path) =>
      mkdir(path, { recursive: true }),
    ),
  );
  return {
    PATH: process.env.PATH,
    HOME: home,
    XDG_CONFIG_HOME: xdg.config,
    XDG_DATA_HOME: xdg.data,
    XDG_STATE_HOME: xdg.state,
    XDG_CACHE_HOME: xdg.cache,
    OPENCODE_TEST_HOME: home,
    OPENCODE_CONFIG_DIR: config,
    OPENCODE_CONFIG_CONTENT: JSON.stringify({
      $schema: "https://opencode.ai/config.json",
      share: "disabled",
      autoupdate: false,
      formatter: false,
      lsp: false,
      snapshot: false,
      mcp: {},
      plugin: [
        `file://${resolve(repositoryRoot, "agents/.config/opencode/plugins/context-capture.ts")}`,
      ],
      default_agent: agent,
      permission: {
        "*": "deny",
        read: "allow",
        glob: "allow",
        grep: "allow",
        list: "allow",
        skill: "allow",
        external_directory: "deny",
        edit: agent === "refactorer" ? "allow" : "deny",
        write: agent === "refactorer" ? "allow" : "deny",
        apply_patch: agent === "refactorer" ? "allow" : "deny",
      },
    }),
    OPENCODE_AUTH_CONTENT: await authContent(),
    OPENCODE_DISABLE_PROJECT_CONFIG: "1",
    OPENCODE_DISABLE_EXTERNAL_SKILLS: "1",
    OPENCODE_DISABLE_LSP_DOWNLOAD: "1",
    OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_DISABLE_AUTOCOMPACT: "1",
    OPENCODE_DISABLE_SHARE: "1",
    DOT_CONTEXT_CAPTURE: "1",
    DOT_CONTEXT_CAPTURE_DIR: join(root, "context-capture"),
  } satisfies Record<string, string | undefined>;
}

async function captureChangedPaths(workspace: string): Promise<string[]> {
  const output = await git(workspace, "status", "--porcelain=v1");
  return output
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3).split(" -> ").at(-1) ?? "")
    .sort();
}

async function writeJson(path: string, value: unknown) {
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`);
}

async function writeArtifactManifest(path: string) {
  const files = [
    ...new Bun.Glob("**/*").scanSync({ cwd: path, dot: true, onlyFiles: true }),
  ]
    .filter((file) => file !== "artifact-manifest.json")
    .sort();
  const manifest = Object.fromEntries(
    await Promise.all(
      files.map(async (file) => [
        file,
        createHash("sha256")
          .update(
            new Uint8Array(await Bun.file(join(path, file)).arrayBuffer()),
          )
          .digest("hex"),
      ]),
    ),
  );
  await writeJson(join(path, "artifact-manifest.json"), manifest);
}

async function executeScenario(
  scenario: BenchmarkScenario,
  repeat: number,
  options: Options,
  artifacts: string,
): Promise<RunRecord> {
  const root = await mkdtemp(
    join(tmpdir(), `opencode-benchmark-${scenario.id}-`),
  );
  let workspace = join(root, "workspace");
  let beforeTree = "unavailable";
  let processResult: ProcessResult = {
    exitCode: 1,
    stdout: "",
    stderr: "run did not start",
    elapsedMs: 0,
    timedOut: false,
  };
  let events: RunEvent[] = [];
  let baselineChangedPaths: string[] = [];
  let changedPaths: string[] = [];
  let diff = "";
  let evaluatedPrompt = scenario.prompt;
  let afterTree = "unavailable";
  let runtimeLogs = "";
  let agentSourceHash = "unavailable";
  let expectedAgentSourceHash = "unavailable";
  let skillSourceHashes: Readonly<Record<string, string>> = {};
  let expectedSkillSourceHashes: Readonly<Record<string, string>> = {};
  let audit = emptyContextAudit();

  try {
    ({ workspace, beforeTree } = await materialiseFixture(root, scenario));
    baselineChangedPaths = await captureChangedPaths(workspace);
    if (scenario.mode === "review") {
      diff = await git(workspace, "diff", "--no-ext-diff", "--binary");
      evaluatedPrompt = `${scenario.prompt}\n\nThe complete diff to review is:\n\n\`\`\`diff\n${diff}\n\`\`\``;
    }
    const isolated = await isolatedConfig(
      root,
      scenario.agent,
      scenario.requiredSkills,
    );
    agentSourceHash = isolated.agentSourceHash;
    expectedAgentSourceHash = isolated.expectedAgentSourceHash;
    skillSourceHashes = isolated.skillSourceHashes;
    expectedSkillSourceHashes = isolated.expectedSkillSourceHashes;
    processResult = await run(
      [
        "opencode",
        "run",
        "--dir",
        workspace,
        "--agent",
        scenario.agent,
        "--model",
        options.model,
        "--format",
        "json",
        evaluatedPrompt,
      ],
      {
        cwd: workspace,
        env: await openCodeEnvironment(root, isolated.config, scenario.agent),
        timeoutMs: options.timeoutMs,
      },
    );
    try {
      events = parseRunEvents(processResult.stdout);
    } catch (error) {
      processResult = {
        ...processResult,
        exitCode: processResult.exitCode || 1,
        stderr: `${processResult.stderr}\n${String(error)}`.trim(),
      };
    }
    audit = await contextAudit(
      join(root, "context-capture"),
      loadedSkills(events),
      isolated.skillSources,
    );
    changedPaths = await captureChangedPaths(workspace);
    diff = await git(workspace, "diff", "--no-ext-diff", "--binary");
    afterTree = await treeHash(workspace);
  } finally {
    runtimeLogs = await collectRuntimeLogs(root);
    await rm(root, { recursive: true, force: true });
  }

  const evidence: RunEvidence = {
    exitCode: processResult.exitCode,
    timedOut: processResult.timedOut,
    events,
    stderr: processResult.stderr,
    finalText: extractFinalText(events),
    agent: scenario.agent,
    agentSourceHash,
    expectedAgentSourceHash,
    skillSourceHashes,
    expectedSkillSourceHashes,
    workspacePath: workspace,
    baselineChangedPaths,
    changedPaths,
    diff,
    beforeTree,
    afterTree,
    workspaceRemoved: !(await Bun.file(workspace).exists()),
    canonicalCommit: await git(
      repositoryRoot,
      "rev-parse",
      "--short=8",
      PINNED_COMMIT,
    ),
    contextAudit: audit,
  };
  const result = scoreRun(scenario, evidence);
  const runDirectory = join(artifacts, "runs", `${scenario.id}-${repeat}`);
  await mkdir(runDirectory, { recursive: true });
  await Promise.all([
    writeJson(join(runDirectory, "scenario.json"), {
      id: scenario.id,
      title: scenario.title,
      mode: scenario.mode,
      agent: scenario.agent,
      requiredSkills: scenario.requiredSkills,
      pinnedCommit: PINNED_COMMIT,
      sourcePaths: scenario.sourcePaths,
      prompt: evaluatedPrompt,
    }),
    writeFile(join(runDirectory, "events.ndjson"), processResult.stdout),
    writeFile(join(runDirectory, "stderr.log"), processResult.stderr),
    writeFile(join(runDirectory, "runtime.log"), runtimeLogs),
    writeFile(join(runDirectory, "diff.patch"), diff),
    writeJson(join(runDirectory, "evidence.json"), evidence),
    writeJson(join(runDirectory, "deterministic-result.json"), result),
  ]);
  return {
    scenario: scenario.id,
    repeat,
    mode: scenario.mode,
    elapsedMs: processResult.elapsedMs,
    evidence,
    result,
  };
}

export function hostRunSummary(
  run: RunRecord,
  scenario: BenchmarkScenario,
): HostRunSummary {
  const tools = toolEvents(run.evidence.events);
  return {
    scenario: run.scenario,
    repeat: run.repeat,
    agent: run.evidence.agent,
    requiredSkills: scenario.requiredSkills,
    loadedSkills: loadedSkills(run.evidence.events),
    agentSourceHash: run.evidence.agentSourceHash,
    skillSourceHashes: run.evidence.skillSourceHashes,
    passed: run.result.passed,
    failedChecks: run.result.checks.filter((check) => !check.passed),
    boundaryAudit: {
      prohibitedToolCalls: tools
        .filter(isProhibitedTool)
        .map((tool) => tool.tool),
      answerLookupAttempts: tools.filter((tool) =>
        lookupTerms.some((term) => serialisedInput(tool).includes(term)),
      ).length,
      externalPathAttempts: tools.filter((tool) =>
        accessesExternalPath(tool, run.evidence.workspacePath),
      ).length,
      changedPaths: run.evidence.changedPaths,
      workspaceRemoved: run.evidence.workspaceRemoved,
    },
    contextAudit: run.evidence.contextAudit,
  };
}

export function aggregateReport(runs: readonly RunRecord[]) {
  const byScenario = Object.fromEntries(
    scenarios.map((scenario) => {
      const matching = runs.filter((run) => run.scenario === scenario.id);
      return [
        scenario.id,
        {
          passed: matching.filter((run) => run.result.passed).length,
          total: matching.length,
        },
      ];
    }),
  );
  return {
    pinnedCommit: PINNED_COMMIT,
    passed: runs.every((run) => run.result.passed),
    passedRuns: runs.filter((run) => run.result.passed).length,
    totalRuns: runs.length,
    byScenario,
    contextAudit: {
      capturedRuns: runs.filter((run) => run.evidence.contextAudit.captured)
        .length,
      maxStarterChars: Math.max(
        0,
        ...runs.map((run) => run.evidence.contextAudit.totalStarterChars),
      ),
      maxEstimatedStarterTokens: Math.max(
        0,
        ...runs.map((run) => run.evidence.contextAudit.estimatedStarterTokens),
      ),
      maxLoadedSkillChars: Math.max(
        0,
        ...runs.map((run) => run.evidence.contextAudit.loadedSkillChars),
      ),
      maxEstimatedLoadedSkillTokens: Math.max(
        0,
        ...runs.map(
          (run) => run.evidence.contextAudit.estimatedLoadedSkillTokens,
        ),
      ),
      duplicateGuidance: [
        ...new Map(
          runs
            .flatMap((run) => run.evidence.contextAudit.duplicateGuidance)
            .map((duplicate) => [
              `${duplicate.text}\0${duplicate.skills.join("\0")}`,
              duplicate,
            ]),
        ).values(),
      ],
    },
    runs: runs.map((run) => {
      const scenario = scenarios.find((item) => item.id === run.scenario);
      if (!scenario)
        throw new Error(`Unknown scenario result: ${run.scenario}`);
      return hostRunSummary(run, scenario);
    }),
  };
}

async function advisoryEvaluation(
  artifacts: string,
  model: string,
  timeoutMs: number,
): Promise<ProcessResult> {
  const root = await mkdtemp(join(tmpdir(), "opencode-benchmark-evaluator-"));
  try {
    const isolated = await isolatedConfig(root, "reviewer", [
      "changeset-scope",
      "effect-principles",
      "code-review",
      "types-enforce-ts",
    ]);
    const prompt = `Read aggregate.json and the files under runs/. Evaluate scope containment, correctness, unnecessary changes, review precision, instruction conflicts, prohibited tool or fetch attempts, answer lookup attempts, and slop. Also report context bloat from contextAudit: starter and loaded-skill size, largest system/tool/skill contributors, duplicated guidance, and any loaded skill that was unnecessary for the scenario. This is advisory only. Cite run IDs and evidence files. Do not modify anything.`;
    return await run(
      [
        "opencode",
        "run",
        "--dir",
        artifacts,
        "--agent",
        "reviewer",
        "--model",
        model,
        "--format",
        "json",
        prompt,
      ],
      {
        cwd: artifacts,
        env: await openCodeEnvironment(root, isolated.config, "reviewer"),
        timeoutMs,
      },
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

function parseOptions(args: readonly string[]): Options {
  const value = (flag: string) => {
    const index = args.indexOf(flag);
    return index === -1 ? undefined : args[index + 1];
  };
  const model = value("--model");
  if (!model)
    throw new Error(
      "Usage: benchmark.ts --model <provider/model> [--evaluator-model <provider/model>] [--repeat <count>]",
    );
  const repeat = Number(value("--repeat") ?? "1");
  if (!Number.isInteger(repeat) || repeat < 1) {
    throw new Error("--repeat must be a positive integer");
  }
  return {
    model,
    evaluatorModel: value("--evaluator-model") ?? model,
    repeat,
    timeoutMs: 10 * 60 * 1000,
    scenario: value("--scenario"),
    skipEvaluator: args.includes("--skip-evaluator"),
  };
}

async function makeReadOnly(path: string) {
  const glob = new Bun.Glob("**/*");
  const entries = [...glob.scanSync({ cwd: path, dot: true, onlyFiles: true })];
  const directories = new Set<string>([path]);
  for (const entry of entries) {
    await chmod(join(path, entry), 0o444);
    let parent = dirname(join(path, entry));
    while (parent.startsWith(`${path}/`)) {
      directories.add(parent);
      parent = dirname(parent);
    }
  }
  for (const directory of [...directories].sort(
    (left, right) => right.length - left.length,
  )) {
    await chmod(directory, 0o555);
  }
}

async function main() {
  console.log(
    [
      "bun",
      "run",
      ".benchmarks/opencode/benchmark.ts",
      ...process.argv.slice(2),
    ].join(" "),
  );
  const options = parseOptions(process.argv.slice(2));
  await mkdir(outputRoot, { recursive: true });
  const staging = await mkdtemp(join(outputRoot, ".staging-"));
  const selectedScenarios = options.scenario
    ? scenarios.filter((scenario) => scenario.id === options.scenario)
    : scenarios;
  if (selectedScenarios.length === 0) {
    throw new Error(`Unknown scenario: ${options.scenario}`);
  }
  const runInputs = selectedScenarios.flatMap((scenario) =>
    Array.from(
      { length: options.repeat },
      (_, index) => [scenario, index + 1] as const,
    ),
  );
  const timestamp = new Date()
    .toISOString()
    .replaceAll(":", "-")
    .replaceAll(".", "-");
  try {
    const runs = await Promise.all(
      runInputs.map(([scenario, repeat]) =>
        executeScenario(scenario, repeat, options, staging),
      ),
    );
    const aggregate = aggregateReport(runs);
    await writeJson(join(staging, "aggregate.json"), aggregate);
    let advisoryReport = "Skipped by --skip-evaluator.";
    let advisoryExitCode: number | null = null;
    if (!options.skipEvaluator) {
      const evaluator = await advisoryEvaluation(
        staging,
        options.evaluatorModel,
        options.timeoutMs,
      );
      let evaluatorEvents: RunEvent[] = [];
      try {
        evaluatorEvents = parseRunEvents(evaluator.stdout);
      } catch {}
      advisoryReport = extractFinalText(evaluatorEvents);
      advisoryExitCode = evaluator.exitCode;
      await Promise.all([
        writeFile(join(staging, "evaluator-events.ndjson"), evaluator.stdout),
        writeFile(join(staging, "evaluator-stderr.log"), evaluator.stderr),
        writeFile(join(staging, "evaluator-report.md"), `${advisoryReport}\n`),
      ]);
    }
    await writeJson(join(staging, "host-report.json"), {
      schemaVersion: 1,
      verdict: aggregate.passed ? "pass" : "fail",
      deterministic: aggregate,
      advisory: {
        gating: false,
        exitCode: advisoryExitCode,
        report: advisoryReport,
      },
    });
    await writeArtifactManifest(staging);
    const destination = join(outputRoot, timestamp);
    await rename(staging, destination);
    await makeReadOnly(destination);
    console.log(
      `OpenCode benchmark: ${aggregate.passedRuns}/${aggregate.totalRuns} deterministic runs passed`,
    );
    console.log(
      `Context audit: max starter ~${aggregate.contextAudit.maxEstimatedStarterTokens} tokens, max loaded skills ~${aggregate.contextAudit.maxEstimatedLoadedSkillTokens} tokens, ${aggregate.contextAudit.duplicateGuidance.length} duplicate guidance lines`,
    );
    console.log(`Artifacts: ${relative(repositoryRoot, destination)}`);
    console.log(
      `Host report: ${relative(repositoryRoot, join(destination, "host-report.json"))}`,
    );
    process.exitCode = aggregate.passed ? 0 : 1;
  } catch (error) {
    const destination = join(outputRoot, `${timestamp}-failed`);
    await rename(staging, destination);
    await writeArtifactManifest(destination);
    await makeReadOnly(destination);
    console.error(`Failed artifacts: ${relative(repositoryRoot, destination)}`);
    throw error;
  }
}

if (import.meta.main) {
  await main();
}
