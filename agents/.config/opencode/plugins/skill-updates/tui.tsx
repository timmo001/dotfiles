/**
 * @file Shows pending update and missing install counts in the prompt footer, from `dot updates watch --json`,
 * or `dot updates status --json` while the dot daemon isn't running.
 */

import { NodeServices } from "@effect/platform-node";
import { Plugin, usePlugin } from "@opencode/plugin/tui";
import { TextAttributes } from "@opentui/core";
import { Effect, Fiber, Schema, Stream } from "effect";
import { ChildProcess, ChildProcessSpawner } from "effect/process";
import { createSignal, For, Show } from "solid-js";
import { runText } from "../lib/process";

// The parts of `dot updates status --json` this plugin reads.
const Status = Schema.fromJsonString(
  Schema.Struct({
    groups: Schema.Array(
      Schema.Struct({
        id: Schema.String,
        title: Schema.String,
        pending: Schema.Array(Schema.String),
        missing: Schema.Array(Schema.String),
      }),
    ),
    bar: Schema.Struct({
      text: Schema.String,
      tooltip: Schema.String,
      class: Schema.String,
    }),
    footer: Schema.Struct({
      text: Schema.String,
    }),
  }),
);

type Current = typeof Status.Type;

const decode = Schema.decodeUnknownEffect(Status);

// Reads the status once: from the daemon, or the cache dot refreshes in the
// background once it is stale.
const read = runText("dot", ["updates", "status", "--json"]).pipe(
  Effect.flatMap(decode),
  Effect.timeout("10 seconds"),
  Effect.orElseSucceed((): Current | null => null),
);

// Follows the daemon's status until the watch exits, which it does at once
// when the daemon isn't running. Returns whether it printed anything.
const watch = (apply: (status: Current) => void) =>
  Effect.gen(function* () {
    const spawner = yield* ChildProcessSpawner.ChildProcessSpawner;
    let seen = false;

    const proc = yield* spawner.spawn(
      ChildProcess.make("dot", ["updates", "watch", "--json"], {
        stdin: "ignore",
        stdout: "pipe",
        stderr: "ignore",
      }),
    );

    yield* proc.stdout.pipe(
      Stream.decodeText(),
      Stream.splitLines,
      Stream.runForEach((line) =>
        decode(line).pipe(
          Effect.map((status) => {
            seen = true;
            apply(status);
          }),
          Effect.ignore,
        ),
      ),
    );

    return seen;
  }).pipe(Effect.scoped, Effect.provide(NodeServices.layer), Effect.orElseSucceed(() => false));

export default Plugin.define({
  id: "skill-updates",
  setup(context) {
    const [status, setStatus] = createSignal<Current | null>(null);
    let announced = new Set<string>();

    const apply = (next: Current | null) => {
      setStatus(next);

      if (!next) return;

      const items = new Set(
        next.groups.flatMap((group) => [
          ...group.pending.map((line) => `${group.id}:${line}`),
          ...group.missing.map((name) => `${group.id}:missing:${name}`),
        ]),
      );

      const fresh = next.groups.flatMap((group) => {
        const pending = group.pending.filter((line) => !announced.has(`${group.id}:${line}`)).length;
        const missing = group.missing.filter((name) => !announced.has(`${group.id}:missing:${name}`)).length;

        if (pending === 0 && missing === 0) return [];

        return [
          `${group.title}: ${[pending > 0 && `${pending} new`, missing > 0 && `${missing} missing`].filter(Boolean).join(", ")}`,
        ];
      });

      if (fresh.length > 0) {
        context.ui.toast.show({
          message: `${fresh.join(". ")}. Run dot up to get them.`,
          variant: next.groups.some((group) => group.missing.length > 0) ? "warning" : "info",
        });
      }

      announced = items;
    };

    // Watch the daemon; when the watch ends, read the status once and try
    // again, soon after a dropped connection and after a minute when the
    // daemon isn't running.
    const follow = Effect.runFork(
      Effect.gen(function* () {
        const watched = yield* watch(apply);

        apply(yield* read);
        yield* Effect.sleep(watched ? "5 seconds" : "60 seconds");
      }).pipe(Effect.forever),
    );

    function View() {
      const theme = context.theme.surface("dialog");

      return (
        <box gap={1} paddingLeft={2} paddingRight={2} paddingBottom={1}>
          <box flexDirection="row" gap={2}>
            <text attributes={TextAttributes.BOLD} fg={theme.text.base} flexGrow={1}>
              Updates
            </text>
            <text fg={theme.text.muted} flexShrink={0} onMouseUp={() => context.ui.dialog.clear()}>
              esc
            </text>
          </box>
          <box>
            <For each={status()?.bar.tooltip.replace(/\n\nClick to run dot up$/, "").split("\n")}>
              {(line) => <text fg={theme.text.base}>{line}</text>}
            </For>
          </box>
          <Show when={status()?.bar.class === "updates" || status()?.bar.class === "updates-missing"}>
            <text fg={theme.text.muted}>Run dot up to get them.</text>
          </Show>
        </box>
      );
    }

    const view = () => {
      context.ui.dialog.show(() => <View />);
      context.ui.dialog.set({ size: "medium", centered: true });
    };

    function Footer() {
      const plugin = usePlugin();

      return (
        <Show when={status()}>
          {(current) => (
            <box flexShrink={0}>
              <text
                fg={
                  current().groups.some((group) => group.missing.length > 0)
                    ? plugin.theme.text.feedback.error.base
                    : current().bar.class === "updates"
                      ? plugin.theme.text.feedback.warning.base
                      : plugin.theme.text.muted
                }
                onMouseUp={view}
              >
                {current().footer.text}
              </text>
            </box>
          )}
        </Show>
      );
    }

    const slot = context.ui.slot({
      append: "prompt.footer.status",
      render: () => <Footer />,
    });

    return () => {
      Effect.runFork(Fiber.interrupt(follow));
      slot();
    };
  },
});
