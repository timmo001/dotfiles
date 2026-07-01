import { Context, Effect, Layer, Schema } from "effect";
import { join } from "path";
import type { CommitSuggestion } from "../../types.js";
import {
  getCachedModel,
  setCachedModel,
  discoverFastModel,
} from "../../services/ModelDiscovery.js";
import { ensureServer } from "../../services/OpenCodeServer.js";
import { STATE_DIR } from "../../lib/paths.js";
import { ENV, envString } from "../../lib/env.js";

const log = (msg: string) => console.error(`[dot:CommitSuggest] ${msg}`);

const DEBUG = !!envString(ENV.DOT_DEBUG);
const DEBUG_FILE = join(STATE_DIR, "dot", "commit-suggest-debug.json");

/** Domain error for AI commit suggestion failures */
export class CommitSuggestError extends Schema.TaggedErrorClass<CommitSuggestError>()(
  "CommitSuggestError",
  {
    message: Schema.String,
  },
) {}

/** Append a debug entry to the debug log file (only when DOT_DEBUG is set). */
function debugLog(label: string, data: unknown): void {
  if (!DEBUG) return;
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

/** Service interface for AI-powered commit message suggestions */
export interface CommitSuggestService {
  /** Generate commit message suggestions based on a diff and style examples */
  readonly suggest: (
    diff: string,
    recentCommits: readonly string[],
  ) => Effect.Effect<readonly CommitSuggestion[], CommitSuggestError>;
  /** Return the currently selected model ID, or undefined if not yet discovered */
  readonly getModelId: () => string | undefined;
}

/** Effect service for {@link CommitSuggestService} */
export class CommitSuggest extends Context.Service<
  CommitSuggest,
  CommitSuggestService
>()("CommitSuggest") {
  static readonly layer = Layer.succeed(CommitSuggest, {
    getModelId: () => getCachedModel()?.id,
    suggest: (diff, recentCommits) =>
      Effect.gen(function* () {
        if (!diff.trim()) {
          return yield* Effect.fail(
            new CommitSuggestError({
              message: "No staged changes to generate suggestions for",
            }),
          );
        }

        // Discover fast model (cached after first call)
        if (!getCachedModel()) {
          const model = yield* discoverFastModel;
          setCachedModel(model ?? undefined);
        }

        // Connect to OpenCode server and generate suggestions
        return yield* Effect.tryPromise({
          try: async () => {
            const { client } = await ensureServer();
            const cachedModel = getCachedModel();

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
                log(
                  `Got ${structured.suggestions.length} structured suggestions`,
                );
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
            const msg = error instanceof Error ? error.message : String(error);
            log(`Suggestion error: ${msg}`);
            return new CommitSuggestError({ message: msg });
          },
        });
      }),
  });
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

/** Extract text content from V1 Part[] response */
function extractTextFromParts(
  parts: ReadonlyArray<Record<string, unknown>>,
): string | undefined {
  const types = parts.map((p) => p.type).join(", ");
  log(`Parts (${parts.length}): [${types}]`);
  const textPart = parts.find((p) => p.type === "text") as
    { text: string } | undefined;
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
