import { Effect } from "effect";

const log = (msg: string) => console.error(`[dot:ModelDiscovery] ${msg}`);

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
export interface DiscoveredModel {
  /** Full model identifier (e.g. "github-copilot/gpt-4.1-nano") */
  readonly id: string;
  /** Provider name (e.g. "github-copilot") */
  readonly provider: string;
  /** Model name within the provider */
  readonly model: string;
}

/** Module-level cache for the discovered model */
let cachedModel: DiscoveredModel | undefined;

/** Return the cached model, if any */
export function getCachedModel(): DiscoveredModel | undefined {
  return cachedModel;
}

/** Store a discovered model in the cache */
export function setCachedModel(model: DiscoveredModel | undefined): void {
  cachedModel = model;
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

/** Discover available models via `opencode models --verbose` and pick the best fast one */
export const discoverFastModel: Effect.Effect<
  DiscoveredModel | undefined,
  never
> = Effect.tryPromise({
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
    const msg = error instanceof Error ? error.message : String(error);
    log(`Model discovery failed: ${msg}`);
    return undefined;
  },
}).pipe(Effect.catch(() => Effect.succeed(undefined)));
