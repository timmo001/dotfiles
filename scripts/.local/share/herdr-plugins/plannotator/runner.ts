type Session = {
  id: string;
  title?: string;
  location?: { directory?: string };
};

type Message = {
  type?: string;
  content?: Array<{ type?: string; text?: string }>;
};

type CommandOptions = {
  cwd?: string;
  stdin?: string;
};

type PaneResponse = {
  result: {
    pane: {
      cwd: string;
      terminal_title_stripped?: string;
    };
  };
};

type SessionsResponse = { data: Session[] };
type MessagesResponse = { data: Message[] };
type AnnotationDecision = { decision?: string };

const herdr = process.env.HERDR_BIN_PATH || "herdr";

export function opencodeBinary(home = process.env.HOME): string {
  if (!home) throw new Error("HOME is required to locate the OpenCode wrapper");
  return `${home}/.local/bin/opencode2`;
}

const opencode = opencodeBinary();

async function run(
  command: string,
  args: string[],
  options: CommandOptions = {},
): Promise<string> {
  const child = Bun.spawn([command, ...args], {
    cwd: options.cwd,
    stdin: options.stdin === undefined ? "ignore" : "pipe",
    stdout: "pipe",
    stderr: "pipe",
  });

  if (options.stdin !== undefined) {
    child.stdin.write(options.stdin);
    child.stdin.end();
  }

  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
    child.exited,
  ]);
  if (exitCode !== 0) {
    throw new Error(stderr.trim() || `${command} exited ${exitCode}`);
  }
  if (stderr) process.stderr.write(stderr);
  return stdout.trim();
}

function parsePaneResponse(source: string): PaneResponse {
  // SAFETY: Herdr owns this local CLI response and validates it against its pane schema.
  return JSON.parse(source) as PaneResponse;
}

function parseSessions(source: string): SessionsResponse {
  // SAFETY: OpenCode owns this local API response and validates it against its API schema.
  return JSON.parse(source) as SessionsResponse;
}

function parseMessages(source: string): MessagesResponse {
  // SAFETY: OpenCode owns this local API response and validates it against its API schema.
  return JSON.parse(source) as MessagesResponse;
}

function parseDecision(source: string): AnnotationDecision {
  // SAFETY: Plannotator emits this response from its documented --json decision path.
  return JSON.parse(source) as AnnotationDecision;
}

function paneTitle(value: string | undefined): string {
  return (value || "").replace(/^OC\s*\|\s*/, "").replace(/…$/, "").trim();
}

export function resolveSession(
  sessions: Session[],
  directory: string,
  terminalTitle?: string,
): Session {
  const directoryMatches = sessions.filter(
    (session) => session.location?.directory === directory,
  );
  if (directoryMatches.length === 1) return directoryMatches[0];

  const title = paneTitle(terminalTitle);
  const titleMatches = title
    ? directoryMatches.filter((session) => session.title?.startsWith(title))
    : [];
  if (titleMatches.length === 1) return titleMatches[0];

  throw new Error(
    directoryMatches.length === 0
      ? `No active OpenCode session found for ${directory}`
      : `Multiple active OpenCode sessions found for ${directory}`,
  );
}

export function lastAssistantText(messages: Message[]): string {
  for (const message of messages) {
    if (message.type !== "assistant") continue;
    const text = (message.content || [])
      .filter((part) => part.type === "text" && part.text)
      .map((part) => part.text)
      .join("\n")
      .trim();
    if (text) return text;
  }
  throw new Error("No assistant response found in the active OpenCode session");
}

async function sessions(): Promise<Session[]> {
  return parseSessions(await run(opencode, ["api", "get", "/api/session"])).data;
}

async function deliver(paneId: string, message: string): Promise<void> {
  if (!message) return;
  await run(herdr, ["agent", "prompt", paneId, message]);
}

async function main(): Promise<void> {
  const mode = process.argv[2];
  const paneId = process.env.HERDR_PANE_ID;
  if (!paneId) throw new Error("Plannotator requires a focused Herdr pane");
  if (mode !== "review" && mode !== "last") {
    throw new Error("Usage: runner.ts review|last");
  }

  const pane = parsePaneResponse(await run(herdr, ["pane", "get", paneId])).result
    .pane;
  const { cwd } = pane;
  if (!cwd) {
    throw new Error("The focused pane has no working directory");
  }

  if (mode === "review") {
    const feedback = await run("plannotator", ["review"], { cwd });
    if (feedback !== "Review session closed without feedback.") {
      await deliver(paneId, feedback);
    }
    return;
  }

  const session = resolveSession(
    await sessions(),
    cwd,
    pane.terminal_title_stripped,
  );
  const messages = parseMessages(
    await run(opencode, [
      "api",
      "get",
      `/api/session/${session.id}/message`,
    ]),
  ).data;
  const response = await run(
    "plannotator",
    ["annotate-last", "--stdin", "--gate", "--json"],
    { cwd, stdin: lastAssistantText(messages) },
  );
  const decision = parseDecision(response);
  if (decision.decision !== "dismissed") await deliver(paneId, response);
}

if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exit(1);
  });
}
