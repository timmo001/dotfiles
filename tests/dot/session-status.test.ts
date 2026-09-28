import { expect, test } from "bun:test";
import { Effect } from "../../dot/node_modules/effect/dist/index.js";
import { readSessionStatus } from "../../dot/src/commands/SessionStatus.js";
import { CommandExecutor } from "../../dot/src/services/CommandExecutor.js";

const model = { providerID: "fixture", id: "reasoner", variant: "medium" };

const tokens = { input: 10_000, output: 2_000, reasoning: 1_000, cache: { read: 140_000, write: 5_000 } };

async function inspect(options: { compactionTime?: number; variant?: string; measurementVariant?: string | null } = {}) {
  return Effect.runPromise(readSessionStatus("ses_fixture", 70).pipe(
    Effect.provideService(CommandExecutor, CommandExecutor.of({
      run: (_command, args) => {
        const url = new URL(args[2], "http://fixture");

        if (url.pathname === "/api/session/ses_fixture") return Effect.succeed(JSON.stringify({ data: {
          id: "ses_fixture", model: { ...model, variant: options.variant ?? "medium" },
          location: { directory: "/fixture" }, time: { created: 1, updated: 300 },
          tokens: { ...tokens, input: 20_000_000 }, cost: 10,
        } }));

        if (url.pathname === "/api/model") {
          expect(url.searchParams.get("location[directory]")).toBe("/fixture");

          return Effect.succeed(JSON.stringify({ location: { directory: "/fixture" }, data: [{
            ...model, name: "Reasoner", limit: { context: 1_000_000, input: 200_000, output: 32_000 }, variants: [{ id: "medium" }, { id: "high" }],
          }] }));
        }

        if (url.searchParams.get("type") === "compaction") return Effect.succeed(JSON.stringify({
          data: options.compactionTime ? [{ id: "msg_compaction", type: "compaction", status: "completed", time: { created: options.compactionTime } }] : [], cursor: {},
        }));

        expect(url.pathname).toBe("/api/session/ses_fixture/message");
        expect(url.searchParams.get("type")).toBe("assistant");

        if (!url.searchParams.has("cursor")) return Effect.succeed(JSON.stringify({
          data: [{ id: "msg_running", type: "assistant", time: { created: 300 } }], cursor: { next: "opaque-next" },
        }));

        expect(url.searchParams.get("cursor")).toBe("opaque-next");
        expect(url.searchParams.has("order")).toBe(false);

        return Effect.succeed(JSON.stringify({ data: [{ id: "msg_usage", type: "assistant", model: { ...model, variant: options.measurementVariant === null ? undefined : options.measurementVariant ?? model.variant }, tokens, time: { created: 200, completed: 210 } }], cursor: {} }));
      },
      exitCode: () => Effect.die("Unexpected command"),
      inherit: () => Effect.die("Unexpected command"),
      stream: () => { throw new Error("Unexpected command"); },
    })),
  ));
}

test("context includes cached input, excludes cumulative usage and respects the tighter input limit", async () => {
  const report = await inspect();

  expect(report.context).toMatchObject({ usedTokens: 158_000, percent: 15.8, inputTokens: 155_000, inputPercent: 77.5, limitingBudget: "input", pressure: "review" });
  expect(report.cumulative.tokens.input).toBe(20_000_000);
});

test("usage before a completed compaction is not presented as the current context", async () => {
  const report = await inspect({ compactionTime: 250 });

  expect(report.context).toMatchObject({ usedTokens: null, percent: null, inputPercent: null, pressure: "unknown" });
  expect(report.context.measurement?.usedTokens).toBe(158_000);
});

test("a changed model variant does not inherit the previous request's context percentage", async () => {
  const report = await inspect({ variant: "high" });

  expect(report.model?.variant).toBe("high");
  expect(report.context).toMatchObject({ usedTokens: null, percent: null, pressure: "unknown" });
  expect(report.context.measurement?.model?.variant).toBe("medium");
});

test("OpenCode's default variant marker matches an omitted variant", async () => {
  const report = await inspect({ variant: "default", measurementVariant: null });

  expect(report.context.usedTokens).toBe(158_000);
});
