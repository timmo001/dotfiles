import { Context, Effect, Layer } from "effect";
import type { CommitSuggestion } from "../types.js";

const log = (msg: string) => console.error(`[dot-tui:CommitSuggest] ${msg}`);

const DEBUG_FILE = "/tmp/dot-tui-debug.json";

/** Append a debug entry to the debug log file */
function debugLog(label: string, data: unknown): void {
  const entry = { time: new Date().toISOString(), label, data };
  try {
    const existing = Bun.file(DEBUG_FILE);
    // Fire-and-forget async write — we don't await in debug logging
    existing
      .text()
      .then((text) => {
        const arr = JSON.parse(text) as unknown[];
        arr.push(entry);
        return Bun.write(DEBUG_FILE, JSON.stringify(arr, null, 2));
      })
      .catch(() => Bun.write(DEBUG_FILE, JSON.stringify([entry], null, 2)));
  } catch {
    Bun.write(DEBUG_FILE, JSON.stringify([entry], null, 2));
  }
}

/** Tokens that indicate a fast/cheap model suitable for commit suggestions */
const FAST_MODEL_TOKENS = new Set([
  "fast",
  "flash",
  "mini",
  "nano",
  "haiku",
  "spark",
  "turbo",
]);

/** Preferred provider for model selection */
const PREFERRED_PROVIDER = "github-copilot";

/** Parsed model entry from `opencode models --verbose` */
interface DiscoveredModel {
  /** Full model identifier (e.g. "github-copilot/gpt-4.1-nano") */
  readonly id: string;
  /** Provider name (e.g. "github-copilot") */
  readonly provider: string;
  /** Model name within the provider */
  readonly model: string;
}

/** Service interface for AI-powered commit message suggestions */
export interface CommitSuggestService {
  /** Generate commit message suggestions based on a diff and style examples */
  readonly suggest: (
    diff: string,
    recentCommits: readonly string[],
  ) => Effect.Effect<readonly CommitSuggestion[], Error>;
  /** Return the currently selected model ID, or undefined if not yet discovered */
  readonly getModelId: () => string | undefined;
}

/** Effect service tag for {@link CommitSuggestService} */
export class CommitSuggest extends Context.Tag("CommitSuggest")<
  CommitSuggest,
  CommitSuggestService
>() {}

/** Discover available models via `opencode models --verbose` and pick the best fast one */
function discoverFastModel(): Effect.Effect<
  DiscoveredModel | undefined,
  Error
> {
  return Effect.tryPromise({
    try: async () => {
      log("Discovering models via opencode models --verbose...");
      const proc = Bun.spawn(["opencode", "models", "--verbose"], {
        stdout: "pipe",
        stderr: "pipe",
      });

      const stdout = await new Response(proc.stdout).text();
      await proc.exited;

      const models = parseModelOutput(stdout);
      log(`Discovered ${models.length} models`);

      if (models.length === 0) return undefined;

      // Score and sort: prefer fast models from the preferred provider
      const scored = models.map((m) => ({
        model: m,
        score: scoreModel(m),
      }));

      scored.sort((a, b) => a.score - b.score); // lower is better

      const best = scored[0];
      log(`Selected model: ${best.model.id} (score: ${best.score})`);
      return best.model;
    },
    catch: (error) => {
      const err = error instanceof Error ? error : new Error(String(error));
      log(`Model discovery failed: ${err.message}`);
      return err;
    },
  });
}

/**
 * Parse `opencode models --verbose` output into model entries.
 *
 * Output format is lines like `provider/model_id` followed by JSON details.
 * We extract just the provider/model identifiers.
 */
function parseModelOutput(output: string): readonly DiscoveredModel[] {
  const models: DiscoveredModel[] = [];
  const lines = output.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    // Match lines that look like "provider/model" (no spaces, has a slash)
    if (
      trimmed &&
      !trimmed.startsWith("{") &&
      !trimmed.startsWith("}") &&
      trimmed.includes("/")
    ) {
      const slashIdx = trimmed.indexOf("/");
      const provider = trimmed.slice(0, slashIdx);
      const model = trimmed.slice(slashIdx + 1);
      // Skip lines that are clearly not model IDs
      if (
        provider &&
        model &&
        !provider.includes(" ") &&
        !model.includes(" ")
      ) {
        models.push({ id: trimmed, provider, model });
      }
    }
  }

  return models;
}

/**
 * Score a model for fast commit suggestion suitability.
 * Lower score = better match. Uses slopops-style token matching.
 */
function scoreModel(model: DiscoveredModel): number {
  let score = 50; // base

  // Tokenise the model name on common separators
  const tokens = model.model.toLowerCase().split(/[-/._]+/);

  // Fast model token bonus (-15 per match)
  for (const token of tokens) {
    if (FAST_MODEL_TOKENS.has(token)) {
      score -= 15;
      break; // one match is enough
    }
  }

  // Preferred provider bonus
  if (model.provider === PREFERRED_PROVIDER) {
    score -= 12;
  }

  // Penalise premium/expensive model tokens
  const premiumTokens = new Set(["opus", "pro", "max", "ultra"]);
  for (const token of tokens) {
    if (premiumTokens.has(token)) {
      score += 20;
      break;
    }
  }

  return score;
}

/** JSON schema for structured commit suggestion output */
const SUGGESTION_SCHEMA = {
  type: "object" as const,
  properties: {
    suggestions: {
      type: "array" as const,
      items: {
        type: "object" as const,
        properties: {
          message: {
            type: "string" as const,
            description: "A short commit message",
          },
        },
        required: ["message"],
      },
      minItems: 5,
      maxItems: 5,
      description: "Exactly 5 commit message suggestions",
    },
  },
  required: ["suggestions"],
};

/** State for the OpenCode server lifecycle */
interface ServerState {
  client: import("@opencode-ai/sdk/v2").OpencodeClient;
  close: (() => void) | undefined;
  managedByUs: boolean;
}

let serverState: ServerState | undefined;
let cachedModel: DiscoveredModel | undefined;

/** Ensure the OpenCode server is running, starting it if needed */
async function ensureServer(): Promise<ServerState> {
  if (serverState) return serverState;

  // Try connecting to an existing server first
  const { createOpencodeClient, createOpencode } =
    await import("@opencode-ai/sdk/v2");

  try {
    log("Checking for existing OpenCode server on port 4096...");
    const client = createOpencodeClient({ baseUrl: "http://localhost:4096" });
    // Health check
    const resp = await fetch("http://localhost:4096/health");
    if (resp.ok) {
      log("Connected to existing OpenCode server");
      serverState = { client, close: undefined, managedByUs: false };
      return serverState;
    }
  } catch {
    // Server not running, start one
  }

  log("Starting OpenCode server...");
  const { client, server } = await createOpencode({
    port: 4096,
  });
  log("OpenCode server started on port 4096");
  serverState = {
    client,
    close: () => server.close(),
    managedByUs: true,
  };
  return serverState;
}

/** Stop the OpenCode server if we started it */
export function shutdownServer(): void {
  if (serverState?.managedByUs && serverState.close) {
    log("Shutting down OpenCode server (started by us)");
    serverState.close();
    serverState = undefined;
  }
}

/** Build the prompt for commit message suggestions */
function buildPrompt(diff: string, recentCommits: readonly string[]): string {
  const truncatedDiff =
    diff.length > 4000 ? diff.slice(0, 4000) + "\n... (truncated)" : diff;

  return `You are a commit message generator. Suggest exactly 5 short commit messages for the following staged diff.

STYLE RULES (learned from my previous commits):
- Short imperative fragments, sentence case
- No conventional-commits prefixes (no feat:, fix:, chore:, etc.)
- No trailing punctuation
- Typically 1-5 words
- No scope indicators in parentheses

RECENT COMMITS (for style reference):
${recentCommits.map((c) => `- ${c}`).join("\n")}

STAGED DIFF:
\`\`\`
${truncatedDiff}
\`\`\`

Return exactly 5 suggestions ordered from most to least specific. Each should describe what changed, not how.`;
}

/** Live layer providing commit suggestion generation via OpenCode SDK v2 */
export const CommitSuggestLive = Layer.succeed(CommitSuggest, {
  getModelId: () => cachedModel?.id,
  suggest: (diff, recentCommits) =>
    Effect.tryPromise({
      try: async () => {
        if (!diff.trim()) {
          throw new Error("No staged changes to generate suggestions for");
        }

        // Discover fast model (cached after first call)
        if (!cachedModel) {
          const model = await Effect.runPromise(
            discoverFastModel().pipe(
              Effect.catchAll(() => Effect.succeed(undefined)),
            ),
          );
          cachedModel = model ?? undefined;
        }

        const server = await ensureServer();
        const { client } = server;

        // Create a session
        const sessionResult = await client.session.create();
        if (sessionResult.error) {
          throw new Error(
            `Failed to create session: ${JSON.stringify(sessionResult.error)}`,
          );
        }
        const sessionId = sessionResult.data.id;
        log(`Created session: ${sessionId}`);

        const promptText = buildPrompt(diff, recentCommits);

        // Build prompt params with model selection and structured output
        const promptParams: Parameters<typeof client.session.prompt>[0] = {
          sessionID: sessionId,
          parts: [{ type: "text" as const, text: promptText }],
          format: {
            type: "json_schema",
            schema: SUGGESTION_SCHEMA,
          },
          // Disable all tools — pure generation
          tools: {},
        };

        if (cachedModel) {
          promptParams.model = {
            modelID: cachedModel.model,
            providerID: cachedModel.provider,
          };
          log(`Using model: ${cachedModel.id}`);
        }

        // Send prompt via V1 API (streams/blocks until agent finishes)
        const promptResult = await client.session.prompt(promptParams);
        if (promptResult.error) {
          debugLog("prompt-error", promptResult.error);
          throw new Error(
            `Prompt failed: ${JSON.stringify(promptResult.error)}`,
          );
        }

        const { info, parts } = promptResult.data;
        debugLog("prompt-response", {
          infoKeys: Object.keys(info),
          structured: info.structured,
          finish: info.finish,
          error: info.error,
          partsCount: parts.length,
          partTypes: parts.map((p) => p.type),
          partsSample: parts.slice(0, 3),
        });

        // 1. Check info.structured — json_schema format puts output here
        if (info.structured) {
          log("Found structured output in info.structured");
          const structured = info.structured as {
            suggestions?: readonly CommitSuggestion[];
          };
          if (structured.suggestions && structured.suggestions.length > 0) {
            log(`Got ${structured.suggestions.length} structured suggestions`);
            return structured.suggestions;
          }
        }

        // 2. Check parts for text content
        let responseText = extractTextFromParts(parts);

        // 3. Fall back to polling session.messages() (reduced to 10 attempts)
        if (!responseText) {
          log("No text in prompt response parts, polling messages...");
          responseText = await pollForAssistantText(client, sessionId, 10);
        }

        if (!responseText) {
          throw new Error("No text response from assistant after polling");
        }

        log(
          `Raw response text (first 500 chars): ${responseText.slice(0, 500)}`,
        );

        // Strip markdown code fences if the model wrapped the JSON
        let jsonText = responseText.trim();
        if (jsonText.startsWith("```")) {
          jsonText = jsonText
            .replace(/^```(?:json)?\s*\n?/, "")
            .replace(/\n?\s*```$/, "");
        }

        const parsed = JSON.parse(jsonText) as {
          suggestions: readonly CommitSuggestion[];
        };

        log(`Got ${parsed.suggestions.length} suggestions`);
        return parsed.suggestions;
      },
      catch: (error) => {
        const err = error instanceof Error ? error : new Error(String(error));
        log(`Suggestion error: ${err.message}`);
        return err;
      },
    }),
});

/** Extract text content from V1 Part[] response */
function extractTextFromParts(
  parts: ReadonlyArray<Record<string, unknown>>,
): string | undefined {
  const types = parts.map((p) => p.type).join(", ");
  log(`Parts (${parts.length}): [${types}]`);
  const textPart = parts.find((p) => p.type === "text") as
    | { text: string }
    | undefined;
  return textPart?.text || undefined;
}

/** Poll session messages until an assistant message with text appears */
async function pollForAssistantText(
  client: import("@opencode-ai/sdk/v2").OpencodeClient,
  sessionId: string,
  maxAttempts = 10,
  intervalMs = 1000,
): Promise<string | undefined> {
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, intervalMs));

    const result = await client.session.messages({ sessionID: sessionId });
    if (result.error) {
      log(`Messages poll ${i + 1} error: ${JSON.stringify(result.error)}`);
      continue;
    }

    debugLog(`poll-messages-${i + 1}`, {
      count: result.data.length,
      messages: result.data.map((msg) => ({
        role: (msg.info as { role: string }).role,
        partsCount: msg.parts.length,
        partTypes: msg.parts.map((p) => p.type),
        structured: (msg.info as { structured?: unknown }).structured,
      })),
    });

    // Look for assistant messages with structured output or text parts
    for (const msg of result.data) {
      const info = msg.info as { role: string; structured?: unknown };
      if (info.role !== "assistant") continue;

      // Check structured output first
      if (info.structured) {
        const structured = info.structured as {
          suggestions?: readonly CommitSuggestion[];
        };
        if (structured.suggestions && structured.suggestions.length > 0) {
          log(`Found structured suggestions in poll attempt ${i + 1}`);
          // Return as JSON text so the caller can parse it uniformly
          return JSON.stringify(structured);
        }
      }

      const text = extractTextFromParts(
        msg.parts as Array<Record<string, unknown>>,
      );
      if (text) {
        log(`Found text in poll attempt ${i + 1}`);
        return text;
      }
    }

    log(`Poll attempt ${i + 1}/${maxAttempts}: no text yet`);
  }
  return undefined;
}
