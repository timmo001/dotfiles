import { expect, test } from "bun:test";
import { NodeServices } from "../../dot/node_modules/@effect/platform-node/dist/index.js";
import {
  Duration,
  Effect,
  Layer,
} from "../../dot/node_modules/effect/dist/index.js";
import { collectServiceStatus } from "../../dot/src/commands/Services";
import { CommandExecutor } from "../../dot/src/services/CommandExecutor";

// Use systemd's exit and terminal events: a non-zero exit is still a systemd
// failure, but only explicitly mapped normal exits are warning/skipped outcomes.
const snapshot = async (exits: readonly number[], signalled = false) => {
  const now = Date.now();

  const journal = exits
    .flatMap((exit, index) => {
      const base = {
        USER_INVOCATION_ID: `run-${index}`,
        __REALTIME_TIMESTAMP: String(
          (now - (exits.length - index) * 60_000) * 1000,
        ),
      };

      return [
        { ...base, MESSAGE_ID: "7d4958e842da4a758f6c1cdc7b36dcc5" },
        {
          ...base,
          MESSAGE_ID: "98e322203f7a4ed290d09fe03c09fe15",
          EXIT_STATUS: String(exit),
        },
        {
          ...base,
          MESSAGE_ID: exit
            ? "d9b373ed55a64feb8242e02dbe79a49c"
            : "7ad2d189f7e94e70a38c781354912448",
          UNIT_RESULT: signalled ? "signal" : exit ? "exit-code" : "success",
        },
      ];
    })
    .reverse()
    .map((entry) => JSON.stringify(entry))
    .join("\n");

  const executor = Layer.succeed(CommandExecutor, {
    run: (command, args) => {
      if (command === "journalctl") return Effect.succeed(journal);

      if (command === "systemctl" && args.includes("list-timers"))
        return Effect.succeed(
          JSON.stringify([
            { unit: "fixture.timer", next: (now + 60_000) * 1000 },
          ]),
        );

      if (command === "systemctl" && args.includes("show"))
        return Effect.succeed(
          args.includes("fixture.timer")
            ? `Id=fixture.timer\nLoadState=loaded\nActiveState=active\nUnit=fixture.service\nActiveEnterTimestamp=@${(now - 86_400_000) / 1000}`
            : `Id=fixture.service\nLoadState=loaded\nActiveState=${exits.at(-1) ? "failed" : "inactive"}\nType=oneshot`,
        );

      return Effect.die(`Unexpected command: ${command} ${args.join(" ")}`);
    },
    stream: () => {
      throw new Error("Unexpected stream");
    },
    exitCode: () => Effect.die("Unexpected exitCode"),
    inherit: () => Effect.die("Unexpected inherit"),
  });

  const [status] = await Effect.runPromise(
    collectServiceStatus([
      {
        file: "fixture.json",
        descriptor: {
          unit: "fixture.timer",
          failAfter: 2,
          staleAfter: Duration.hours(1),
          exitStatuses: { "2": "warning", "3": "skipped" },
        },
      },
    ]).pipe(Effect.provide(Layer.merge(NodeServices.layer, executor))),
  );

  if (!status) throw new Error("Missing service status");

  return status;
};

test("completed warnings do not become failures or stale, and cooldown skips retain them", async () => {
  const status = await snapshot([1, 1, 2, 2, 3]);
  expect(status.health).toBe("warning");
  expect(status.consecutiveFailures).toBe(0);
  expect(status.summary).toBe("Last run completed with warnings");
  expect(status.runs.map((run) => run.result)).toEqual([
    "skipped",
    "warning",
    "warning",
    "failed",
    "failed",
  ]);
});

test("unmapped failures and signals still fail, including after a cooldown skip", async () => {
  const status = await snapshot([2, 1, 1, 3]);
  expect(status.health).toBe("failed");
  expect(status.consecutiveFailures).toBe(2);
  const signalled = await snapshot([2], true);
  expect(signalled.runs[0]?.result).toBe("failed");
  expect(signalled.consecutiveFailures).toBe(1);
});

test("a completed successful run clears the current warning but preserves its history", async () => {
  const status = await snapshot([2, 0]);
  expect(status.health).toBe("ok");
  expect(status.runs.map((run) => run.result)).toEqual(["success", "warning"]);
});
