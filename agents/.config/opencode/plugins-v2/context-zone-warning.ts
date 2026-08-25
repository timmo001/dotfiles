/**
 * @file Warns when long-context models enter less reliable context ranges.
 */

import { $ } from "bun";
import { Plugin } from "@opencode-ai/plugin/effect";
import { Effect, Result, Stream } from "effect";

type Band = "warning" | "critical";

interface Policy {
  readonly warning: number;
  readonly critical: number;
}

const DEFAULT_POLICY: Policy = { warning: 64_000, critical: 128_000 };

const POLICIES: Readonly<Record<string, Policy>> = {
  "github-copilot/gpt-5.6-sol": { warning: 256_000, critical: 512_000 },
  "github-copilot/claude-opus-4.8": { warning: 100_000, critical: 150_000 },
  "github-copilot/claude-opus-4.8-fast": {
    warning: 100_000,
    critical: 150_000,
  },
  "github-copilot/claude-opus-5": { warning: 100_000, critical: 150_000 },
  "github-copilot/claude-opus-5-fast": {
    warning: 100_000,
    critical: 150_000,
  },
  "gpt-5.6-sol": { warning: 256_000, critical: 512_000 },
  "claude-opus-4.8": { warning: 100_000, critical: 150_000 },
  "claude-opus-4.8-fast": { warning: 100_000, critical: 150_000 },
  "claude-opus-5": { warning: 100_000, critical: 150_000 },
  "claude-opus-5-fast": { warning: 100_000, critical: 150_000 },
};

const BAND_RANK: Readonly<Record<Band, number>> = {
  warning: 1,
  critical: 2,
};

const formatTokens = (tokens: number) =>
  new Intl.NumberFormat("en-GB", { maximumFractionDigits: 0 }).format(tokens);

const createDesktopNotifier = async () => {
  let canNotify: boolean | undefined;
  let originWindowAddress = "";
  const originHerdrTabID = process.env.HERDR_TAB_ID ?? "";

  try {
    const activeWindow = JSON.parse(
      await $`hyprctl activewindow -j`.text(),
    ) as { readonly address?: unknown };
    if (
      typeof activeWindow.address === "string" &&
      /^0x[0-9a-f]+$/i.test(activeWindow.address)
    ) {
      originWindowAddress = activeWindow.address;
    }
  } catch {}

  return async (glyph: string, title: string, body: string) => {
    if (canNotify === undefined) {
      try {
        await $`sh -lc "command -v omarchy >/dev/null 2>&1"`;
        canNotify = true;
      } catch {
        canNotify = false;
      }
    }
    if (!canNotify) return;

    try {
      const focusCommand = originWindowAddress
        ? `hyprctl dispatch 'hl.dsp.focus({ window = "address:${originWindowAddress}" })'${
            /^[a-z0-9_:-]+$/i.test(originHerdrTabID)
              ? ` && herdr tab focus ${originHerdrTabID}`
              : ""
          }`
        : "";
      void $`omarchy notification send -g ${glyph} --app-name OpenCode ${title} ${body} ${focusCommand ? "--exec" : []} ${focusCommand ? focusCommand : []}`.catch(
        () => {},
      );
    } catch {}
  };
};

export default Plugin.define({
  id: "context-zone-warning",
  effect: (context) =>
    Effect.gen(function* () {
      const warnedBand = new Map<string, Band>();
      let contextLimits: Map<string, number> | undefined;
      const sendDesktopNotification = yield* Effect.promise(() =>
        createDesktopNotifier(),
      );

      yield* context.event
        .subscribe()
        .pipe(
          Stream.runForEach((event) =>
            Effect.gen(function* () {
              if (
                event.type === "session.compaction.ended" ||
                event.type === "session.deleted"
              ) {
                warnedBand.delete(event.data.sessionID);
                return;
              }
              if (event.type !== "session.usage.updated") return;

              const sessionResult = yield* context.session
                .get({ sessionID: event.data.sessionID })
                .pipe(Effect.result);
              if (Result.isFailure(sessionResult) || !sessionResult.success.model)
                return;

              const { id: modelID, providerID } = sessionResult.success.model;
              const policy =
                POLICIES[`${providerID}/${modelID}`] ??
                POLICIES[modelID] ??
                DEFAULT_POLICY;
              const tokens =
                event.data.tokens.input + event.data.tokens.cache.read;
              if (tokens <= 0) return;

              const band: Band | undefined =
                tokens >= policy.critical
                  ? "critical"
                  : tokens >= policy.warning
                    ? "warning"
                    : undefined;
              if (!band) return;

              const previousBand = warnedBand.get(event.data.sessionID);
              if (
                previousBand &&
                BAND_RANK[previousBand] >= BAND_RANK[band]
              )
                return;
              warnedBand.set(event.data.sessionID, band);

              if (!contextLimits) {
                const modelsResult = yield* context.catalog.model
                  .list()
                  .pipe(Effect.result);
                contextLimits = Result.isSuccess(modelsResult)
                  ? new Map(
                      modelsResult.success.data.map((model) => [
                        `${model.providerID}/${model.id}`,
                        model.limit.context,
                      ]),
                    )
                  : new Map();
              }

              const limit = contextLimits.get(`${providerID}/${modelID}`);
              const usage = limit
                ? ` (${Math.round((tokens / limit) * 100)}%)`
                : "";
              const title =
                band === "critical"
                  ? "Context reliability critical"
                  : "Context reliability warning";
              const alertMessage =
                band === "critical"
                  ? `${modelID} is using ${formatTokens(tokens)} tokens${usage}. Compact now or start a new session.`
                  : `${modelID} is using ${formatTokens(tokens)} tokens${usage}. Compact soon to keep responses reliable.`;

              yield* Effect.promise(() =>
                sendDesktopNotification("⚠", title, alertMessage),
              );
            }),
          ),
          Effect.orDie,
          Effect.forkScoped,
        );
    }),
});
