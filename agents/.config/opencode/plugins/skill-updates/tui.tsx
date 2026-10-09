/**
 * @file Shows whether the dot-managed skills checkout is behind timmo001/skills main, from `dot updates status --json`.
 */

import { Plugin, usePlugin } from "@opencode/plugin/tui";
import { TextAttributes } from "@opentui/core";
import { Effect, Schema } from "effect";
import { createSignal, For, Show } from "solid-js";
import { runText } from "../lib/process";

// The parts of `dot updates status --json` this plugin reads.
const Status = Schema.fromJsonString(
  Schema.Struct({
    checkedAt: Schema.NullOr(Schema.Number),
    skills: Schema.NullOr(
      Schema.Struct({
        behind: Schema.Number,
        changed: Schema.Array(Schema.String),
      }),
    ),
  }),
);

type Skills = NonNullable<(typeof Status.Type)["skills"]>;

// `undefined` while no check has finished yet, `null` when the check could not run.
type Current = Skills | null | undefined;

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? "" : "s"}`;

// Reads the cache, which dot refreshes in the background once it is stale.
const read = () =>
  Effect.runPromise(
    runText("dot", ["updates", "status", "--json"]).pipe(
      Effect.flatMap(Schema.decodeUnknownEffect(Status)),
      Effect.map((status): Current => (status.checkedAt === null ? undefined : status.skills)),
      Effect.timeout("10 seconds"),
      Effect.orElseSucceed((): Current => null),
    ),
  );

export default Plugin.define({
  id: "skill-updates",
  setup(context) {
    const [skills, setSkills] = createSignal<Current>(undefined);
    let announced = "";

    const behind = () => skills()?.behind ?? 0;

    const poll = async () => {
      const next = await read();

      setSkills(next);

      const print = next && next.behind > 0 ? `${next.behind}:${next.changed.join(",")}` : "";

      if (print && print !== announced) {
        context.ui.toast.show({
          message: `Skills are ${plural(next?.behind ?? 0, "commit")} behind. Run dot update to get them.`,
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
              {`Skills are ${plural(behind(), "commit")} behind`}
            </text>
            <text fg={theme.text.muted} flexShrink={0} onMouseUp={() => context.ui.dialog.clear()}>
              esc
            </text>
          </box>
          <Show
            when={skills()?.changed.length}
            fallback={<text fg={theme.text.muted}>No authored skills changed, only imports or tooling</text>}
          >
            <box>
              <For each={skills()?.changed}>{(name) => <text fg={theme.text.base}>{`• ${name}`}</text>}</For>
            </box>
          </Show>
          <text fg={theme.text.muted}>Run dot update to get them.</text>
        </box>
      );
    }

    const view = () => {
      context.ui.dialog.show(() => <View />);
      context.ui.dialog.set({ size: "medium", centered: true });
    };

    function Footer() {
      const plugin = usePlugin();

      const label = () => {
        const current = skills();

        if (current === undefined) return { text: "Skills …", fg: plugin.theme.text.muted };

        if (current === null) return { text: "Skills ⚠", fg: plugin.theme.text.feedback.warning.base };

        if (current.behind > 0) return { text: `Skills \u2193${current.behind}`, fg: plugin.theme.text.feedback.warning.base };

        return { text: "Skills ✓", fg: plugin.theme.text.feedback.success.base };
      };

      return (
        <box flexShrink={0}>
          <text fg={label().fg} onMouseUp={() => behind() > 0 && view()}>
            {label().text}
          </text>
        </box>
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
