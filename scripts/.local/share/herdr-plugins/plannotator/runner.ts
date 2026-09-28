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

type JsonValue = null | boolean | number | string | JsonValue[] | { [key: string]: JsonValue };

function isRecord(value: JsonValue): value is { [key: string]: JsonValue } {
  return value instanceof Object && !Array.isArray(value);
}

function isString(value: JsonValue): value is string {
  return Object.prototype.toString.call(value) === "[object String]";
}

function isSession(value: JsonValue): value is JsonValue & Session {
  return isRecord(value) && isString(value.id) &&
    (value.title === undefined || isString(value.title)) &&
    (value.location === undefined ||
      (isRecord(value.location) &&
        (value.location.directory === undefined || isString(value.location.directory))));
}

function isMessage(value: JsonValue): value is JsonValue & Message {
  return isRecord(value) && (value.type === undefined || isString(value.type)) &&
    (value.content === undefined ||
      (Array.isArray(value.content) && value.content.every((part) =>
        isRecord(part) && (part.type === undefined || isString(part.type)) &&
        (part.text === undefined || isString(part.text)))));
}

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
  const value: JsonValue = JSON.parse(source);

  if (!isRecord(value) || !isRecord(value.result) || !isRecord(value.result.pane) ||
    !isString(value.result.pane.cwd) ||
    (value.result.pane.terminal_title_stripped !== undefined &&
      !isString(value.result.pane.terminal_title_stripped))) {
    throw new Error("Invalid Herdr pane response");
  }

  return { result: { pane: {
    cwd: value.result.pane.cwd,
    terminal_title_stripped: value.result.pane.terminal_title_stripped,
  } } };
}

function parseSessions(source: string): SessionsResponse {
  const value: JsonValue = JSON.parse(source);

  if (!isRecord(value) || !Array.isArray(value.data) ||
    !value.data.every(isSession)) {
    throw new Error("Invalid OpenCode sessions response");
  }

  return { data: value.data };
}

function parseMessages(source: string): MessagesResponse {
  const value: JsonValue = JSON.parse(source);

  if (!isRecord(value) || !Array.isArray(value.data) ||
    !value.data.every(isMessage)) {
    throw new Error("Invalid OpenCode messages response");
  }

  return { data: value.data };
}

function parseDecision(source: string): AnnotationDecision {
  const value: JsonValue = JSON.parse(source);

  if (!isRecord(value) || (value.decision !== undefined && !isString(value.decision))) {
    throw new Error("Invalid Plannotator decision response");
  }

  return { decision: value.decision };
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
