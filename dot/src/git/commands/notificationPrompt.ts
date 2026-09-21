import { Data, Effect, Predicate, Terminal } from "effect";
import { Prompt } from "effect/unstable/cli";
import { cliStyler } from "../../lib/ansi.js";
import { writeText } from "./rows.js";
import type {
  NotificationDismissalRun,
  NotificationDismissProgress,
} from "./notificationDismissalRun.js";

interface SelectionState {
  readonly index: number;
  readonly progress: NotificationDismissProgress;
}

const Action = Data.taggedEnum<Prompt.Action<SelectionState, string>>();

function fitLine(value: string, columns: number) {
  const characters = Array.from(value.replace(/\p{Cc}/gu, " "));

  while (characters.length && Bun.stringWidth(characters.join("")) > columns)
    characters.pop();

  return characters.join("");
}

/** Select an action while worker events redraw progress above the choices. Empty choices wait for completion. */
export const chooseNotificationAction = Effect.fn("notifications.chooseAction")(
  function* (
    message: string,
    choices: readonly { readonly title: string; readonly value: string }[],
    run: NotificationDismissalRun,
  ) {
    const progress = yield* run.snapshot;

    if (!choices.length && progress.queued === progress.outcomes.length)
      return "finished";
    const style = cliStyler();
    let renderedRows = 0;

    return yield* Prompt.run(
      Prompt.Custom<SelectionState, string, void>(
        { index: 0, progress },
        run.updates,
        {
          render: Effect.fn("notifications.renderChoices")(
            function* (state, action) {
              if (Predicate.isTagged(action, "Beep")) return "\x07";
              const terminal = yield* Terminal.Terminal;
              const columns = Math.max(1, (yield* terminal.columns) - 1);

              if (Predicate.isTagged(action, "Submit")) {
                const selected = choices.find(
                  (choice) => choice.value === action.value,
                );

                return `${style.dim(fitLine(`${message}: ${selected?.title ?? "Finished"}`, columns))}\n`;
              }

              const done = state.progress.outcomes.filter(
                (outcome) => outcome.status === "done",
              ).length;

              const failed = state.progress.outcomes.filter(
                (outcome) => outcome.status === "failed",
              ).length;

              const skipped = state.progress.outcomes.length - done - failed;

              const pending =
                state.progress.queued -
                state.progress.outcomes.length -
                state.progress.active.length;

              const lines = [
                style.heading(
                  fitLine(
                    `Background: ${pending} queued · ${state.progress.active.length} running · ${done} done · ${skipped} unchanged · ${failed} failed`,
                    columns,
                  ),
                ),
                style.dim(
                  fitLine(
                    state.progress.active.length
                      ? `Running: ${state.progress.active.map((entry) => `${entry.thread.repo}: ${entry.thread.title}`).join(" | ")}`
                      : "Running: none",
                    columns,
                  ),
                ),
                style.label(fitLine(message, columns)),
              ];

              const pageSize = Math.max(
                1,
                Math.min(8, (yield* terminal.rows) - 5),
              );

              const start = Math.floor(state.index / pageSize) * pageSize;

              for (
                let index = start;
                index < Math.min(choices.length, start + pageSize);
                index++
              ) {
                const text = fitLine(
                  `${index === state.index ? "❯" : " "} ${choices[index]?.title ?? ""}`,
                  columns,
                );

                lines.push(index === state.index ? style.success(text) : text);
              }

              lines.push(
                style.dim(
                  fitLine(
                    choices.length
                      ? `↑/↓ choose · Enter select · Ctrl+C stop review${choices.length > pageSize ? ` · ${state.index + 1}/${choices.length}` : ""}`
                      : "Finishing actions already queued…",
                    columns,
                  ),
                ),
              );
              renderedRows = lines.length;

              return "\x1b[?25l" + lines.join("\n");
            },
          ),
          clear: () =>
            Effect.succeed(
              "\r\x1b[2K" +
                "\x1b[1A\r\x1b[2K".repeat(Math.max(0, renderedRows - 1)),
            ),
          process: Effect.fn("notifications.processChoice")(
            function* (
              event,
              state,
            ): Effect.fn.Return<Prompt.Action<SelectionState, string>> {
              if (Predicate.isTagged(event, "Event")) {
                const progress = yield* run.snapshot;

                return !choices.length &&
                  progress.queued === progress.outcomes.length
                  ? Action.Submit({ value: "finished" })
                  : Action.NextFrame({ state: { ...state, progress } });
              }

              if (!choices.length) return Action.Beep();
              const key = event.input.key.name;

              if (key === "enter" || key === "return") {
                const selected = choices[state.index];

                return selected
                  ? Action.Submit({ value: selected.value })
                  : Action.Beep();
              }

              const direction =
                key === "up" || key === "k"
                  ? -1
                  : key === "down" || key === "j" || key === "tab"
                    ? 1
                    : 0;

              if (!direction) return Action.Beep();

              return Action.NextFrame({
                state: {
                  ...state,
                  index:
                    (state.index + direction + choices.length) % choices.length,
                },
              });
            },
          ),
        },
      ),
    ).pipe(
      Effect.catchTag("QuitError", () =>
        writeText("\n").pipe(Effect.as("stop")),
      ),
    );
  },
);
