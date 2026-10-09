/**
 * @file Shows the dotfiles, skills and package update counts in the prompt footer, from `dot updates status --json`.
 */

import { Plugin, usePlugin } from "@opencode/plugin/tui";
import { TextAttributes } from "@opentui/core";
import { Effect, Schema } from "effect";
import { createSignal, For, Show } from "solid-js";
import { runText } from "../lib/process";

// The parts of `dot updates status --json` this plugin reads.
const Status = Schema.fromJsonString(
  Schema.Struct({
    skills: Schema.NullOr(
      Schema.Struct({
        behind: Schema.Number,
        changed: Schema.Array(Schema.String),
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

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

// Reads the cache, which dot refreshes in the background once it is stale.
const read = () =>
  Effect.runPromise(
    runText("dot", ["updates", "status", "--json"]).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Status)),
      Effect.timeout("10 seconds"),
      Effect.orElseSucceed((): Current | null => null),
    ),
  );

export default Plugin.define({
  id: "skill-updates",
  setup(context) {
    const [status, setStatus] = createSignal<Current | null>(null);
    let announced = "";

    const poll = async () => {
      const next = await read();

      setStatus(next);

      const skills = next?.skills;
      const print = skills && skills.behind > 0 ? `${skills.behind}:${skills.changed.join(",")}` : "";

      if (print && print !== announced) {
        context.ui.toast.show({
          message: `Skills are ${plural(skills?.behind ?? 0, "commit")} behind. Run dot update to get them.`,
          variant: "info",
        });
      }

      announced = print;
    };

    void poll();

    const timer = setInterval(() => void poll(), 60_000);

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
            <For each={status()?.bar.tooltip.split("\n")}>{(line) => <text fg={theme.text.base}>{line}</text>}</For>
          </box>
          <Show when={status()?.bar.class === "updates"}>
            <text fg={theme.text.muted}>Run dot update to get them.</text>
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
                fg={current().bar.class === "updates" ? plugin.theme.text.feedback.warning.base : plugin.theme.text.muted}
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
      clearInterval(timer);
      slot();
    };
  },
});
