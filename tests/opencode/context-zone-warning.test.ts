import { describe, expect, mock, test } from "bun:test";

import ContextZoneWarningPlugin from "../../agents/.config/opencode/plugins/context-zone-warning";
import { isString } from "../../dot/src/lib/schema";

const assistantEvent = ({
  sessionID = "session-a",
  providerID = "github-copilot",
  modelID = "gpt-5.6-sol",
  input = 0,
  output = 0,
  reasoning = 0,
  cacheRead = 0,
  cacheWrite = 0,
  summary = false,
} = {}) => ({
  type: "message.updated" as const,
  properties: {
    info: {
      id: "message-a",
      sessionID,
      role: "assistant" as const,
      time: { created: 1 },
      parentID: "message-parent",
      modelID,
      providerID,
      mode: "build",
      path: { cwd: "/tmp", root: "/tmp" },
      cost: 0,
      summary,
      tokens: {
        input,
        output,
        reasoning,
        cache: { read: cacheRead, write: cacheWrite },
      },
    },
  },
});

const setup = async ({ providerFailure = false } = {}) => {
  const showToast = mock(async () => ({}));
  const shellCalls: string[] = [];
  const shell = Object.assign(
    (parts: TemplateStringsArray, ...values: unknown[]) => {
      const command = parts.reduce((renderedCommand, part, index) => {
        const value = values[index - 1];
        const rendered = isString(value)
          ? value
          : value == null
            ? ""
            : (JSON.stringify(value) ?? "");
        return renderedCommand + rendered + part;
      });
      shellCalls.push(command);
      return {
        text: async () =>
          command === "hyprctl activewindow -j" ? '{"address":"0xabc"}' : "",
      };
    },
    {
      raw: () => ({ text: async () => "" }),
    },
  );
  const list = mock(async () => {
    if (providerFailure) throw new Error("provider unavailable");
    return {
      data: {
        all: [
          {
            id: "github-copilot",
            models: {
              "gpt-5.6-sol": {
                id: "gpt-5.6-sol",
                limit: { context: 1_050_000 },
              },
            },
          },
        ],
      },
    };
  });
  // SAFETY: The test double implements the plugin context members used by this plugin.
  const hooks = await ContextZoneWarningPlugin({
    $: shell,
    client: { provider: { list }, tui: { showToast } },
  } as never);
  const send = async (
    event: Parameters<NonNullable<typeof hooks.event>>[0]["event"],
  ) => hooks.event?.({ event });

  return { list, send, shellCalls, showToast };
};

describe("context zone warning", () => {
  test("uses prompt occupancy and includes resolved usage", async () => {
    const { list, send, shellCalls, showToast } = await setup();

    await send(
      assistantEvent({
        input: 206_000,
        output: 20_000,
        reasoning: 30_000,
        cacheRead: 50_000,
        cacheWrite: 20_000,
      }),
    );

    expect(list).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith({
      body: {
        title: "Context reliability warning",
        message:
          "gpt-5.6-sol is using 256,000 tokens (24%). Compact soon to keep responses reliable.",
        variant: "warning",
        duration: 8000,
      },
    });
    const notification = shellCalls.find((command) =>
      command.startsWith("omarchy notification send -g ⚠"),
    );
    expect(notification).toBeDefined();
    expect(notification?.indexOf("Context reliability warning")).toBeLessThan(
      notification?.indexOf("--exec") ?? -1,
    );
  });

  test("does not count output, reasoning, or cache writes as prompt occupancy", async () => {
    const { send, showToast } = await setup();

    await send(
      assistantEvent({
        input: 100_000,
        output: 100_000,
        reasoning: 100_000,
        cacheWrite: 100_000,
      }),
    );

    expect(showToast).not.toHaveBeenCalled();
  });

  test("emits each crossed band once and caches provider metadata", async () => {
    const { list, send, showToast } = await setup();

    await send(assistantEvent({ input: 256_000 }));
    await send(assistantEvent({ input: 300_000 }));
    await send(assistantEvent({ input: 512_000 }));
    await send(assistantEvent({ input: 600_000 }));

    expect(list).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledTimes(2);
    expect(showToast.mock.calls[1]?.[0]).toEqual({
      body: {
        title: "Context reliability critical",
        message:
          "gpt-5.6-sol is using 512,000 tokens (49%). Compact now or start a new session.",
        variant: "error",
        duration: 8000,
      },
    });
  });

  test("emits only critical when the first update crosses both bands", async () => {
    const { send, showToast } = await setup();

    await send(assistantEvent({ input: 512_000 }));

    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast.mock.calls[0]?.[0].body.variant).toBe("error");
  });

  test("resets one session after compaction without affecting another", async () => {
    const { send, showToast } = await setup();

    await send(assistantEvent({ sessionID: "session-a", input: 256_000 }));
    await send(assistantEvent({ sessionID: "session-b", input: 256_000 }));
    await send({
      type: "session.compacted",
      properties: { sessionID: "session-a" },
    });
    await send(assistantEvent({ sessionID: "session-a", input: 256_000 }));
    await send(assistantEvent({ sessionID: "session-b", input: 256_000 }));

    expect(showToast).toHaveBeenCalledTimes(3);
  });

  test("uses the documented compaction threshold for Copilot Opus models", async () => {
    const { send, showToast } = await setup();

    await send(assistantEvent({ modelID: "claude-opus-5", input: 150_000 }));

    expect(showToast.mock.calls[0]?.[0].body.variant).toBe("error");
  });

  test("warns before the Copilot Opus compaction threshold", async () => {
    const { send, showToast } = await setup();

    await send(assistantEvent({ modelID: "claude-opus-4.8", input: 100_000 }));

    expect(showToast.mock.calls[0]?.[0].body.variant).toBe("warning");
  });

  test("warns without percentage when provider lookup fails", async () => {
    const { send, showToast } = await setup({ providerFailure: true });

    await send(assistantEvent({ input: 256_000 }));

    expect(showToast.mock.calls[0]?.[0].body.message).toBe(
      "gpt-5.6-sol is using 256,000 tokens. Compact soon to keep responses reliable.",
    );
  });

  test("uses provider-neutral thresholds for other models", async () => {
    const { send, showToast } = await setup();

    await send(assistantEvent({ modelID: "claude-sonnet-5", input: 64_000 }));
    await send(assistantEvent({ modelID: "claude-sonnet-5", input: 128_000 }));

    expect(showToast).toHaveBeenCalledTimes(2);
    expect(showToast.mock.calls[0]?.[0].body.variant).toBe("warning");
    expect(showToast.mock.calls[1]?.[0].body.variant).toBe("error");
  });

  test("ignores user, summary, and zero-usage messages", async () => {
    const { send, showToast } = await setup();

    await send(assistantEvent());
    await send(assistantEvent({ input: 600_000, summary: true }));
    const user = assistantEvent({ input: 600_000 });
    await send({
      ...user,
      properties: {
        info: {
          id: "user-a",
          sessionID: "session-a",
          role: "user",
          time: { created: 1 },
          agent: "build",
          model: { providerID: "github-copilot", modelID: "gpt-5.6-sol" },
        },
      },
    });

    expect(showToast).not.toHaveBeenCalled();
  });
});
