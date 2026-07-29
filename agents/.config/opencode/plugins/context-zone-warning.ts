/**
 * @file Warns when long-context models enter less reliable context ranges.
 */

import type { Plugin } from "@opencode-ai/plugin";

import { createDesktopNotifier } from "../lib/desktop-notification";
import { showToast } from "../lib/toast";

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

export const ContextZoneWarningPlugin = (async ({ $, client }) => {
  const warnedBand = new Map<string, Band>();
  let contextLimits: Promise<Map<string, number>> | undefined;
  const sendDesktopNotification = await createDesktopNotifier($);

  const getContextLimit = async (providerID: string, modelID: string) => {
    contextLimits ??= client.provider
      .list()
      .then((response) => {
        const limits = new Map<string, number>();
        for (const provider of response.data?.all ?? []) {
          for (const model of Object.values(provider.models)) {
            limits.set(`${provider.id}/${model.id}`, model.limit.context);
          }
        }
        return limits;
      })
      .catch(() => new Map<string, number>());

    return (await contextLimits).get(`${providerID}/${modelID}`);
  };

  return {
    event: async ({ event }) => {
      if (
        event.type === "session.compacted" ||
        event.type === "session.deleted"
      ) {
        warnedBand.delete(event.properties.sessionID);
        return;
      }
      if (event.type !== "message.updated") return;

      const message = event.properties.info;
      if (message.role !== "assistant" || message.summary) return;

      const policy =
        POLICIES[`${message.providerID}/${message.modelID}`] ??
        POLICIES[message.modelID] ??
        DEFAULT_POLICY;

      const tokens = message.tokens.input + message.tokens.cache.read;
      if (tokens <= 0) return;

      const band: Band | undefined =
        tokens >= policy.critical
          ? "critical"
          : tokens >= policy.warning
            ? "warning"
            : undefined;
      if (!band) return;

      const previousBand = warnedBand.get(message.sessionID);
      if (previousBand && BAND_RANK[previousBand] >= BAND_RANK[band]) return;
      warnedBand.set(message.sessionID, band);

      const limit = await getContextLimit(message.providerID, message.modelID);
      const usage = limit ? ` (${Math.round((tokens / limit) * 100)}%)` : "";
      const model = message.modelID;

      const title =
        band === "critical"
          ? "Context reliability critical"
          : "Context reliability warning";
      const alertMessage =
        band === "critical"
          ? `${model} is using ${formatTokens(tokens)} tokens${usage}. Compact now or start a new session.`
          : `${model} is using ${formatTokens(tokens)} tokens${usage}. Compact soon to keep responses reliable.`;

      await Promise.all([
        showToast(client, {
          title,
          message: alertMessage,
          variant: band === "critical" ? "error" : "warning",
          duration: 8000,
        }),
        sendDesktopNotification("⚠", title, alertMessage),
      ]);
    },
  };
}) satisfies Plugin;

export default ContextZoneWarningPlugin;
