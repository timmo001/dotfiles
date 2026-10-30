import { Duration, Effect, Option, Schema } from "effect";
import { CommandExecutor } from "../services/CommandExecutor.js";

/** The app's own OpenCode, on PATH. The desktop's wrapper isn't stowed here. */
const OPENCODE = "opencode2";

const Event = Schema.Struct({
  type: Schema.String,
  part: Schema.optionalKey(
    Schema.Struct({ text: Schema.optionalKey(Schema.String) }),
  ),
});

/** Replace em and en dashes in model text with commas. */
export const withoutDashes = (text: string) =>
  text.replace(/\s*[—–]\s*/g, ", ");

/**
 * Run one OpenCode prompt with `model` and return the last text it wrote,
 * trimmed, or `undefined` when it fails, times out or writes nothing.
 */
export const opencodeText = Effect.fn("opencodeText")(function* (options: {
  readonly model: string;
  readonly prompt: string;
  /** Session title shown in OpenCode. */
  readonly title: string;
  readonly cwd: string;
  readonly timeout: Duration.Duration;
}) {
  const executor = yield* CommandExecutor;

  return yield* executor
    .run(
      OPENCODE,
      [
        "run",
        "--format",
        "json",
        "--title",
        options.title,
        "-m",
        options.model,
        options.prompt,
      ],
      { cwd: options.cwd },
    )
    .pipe(
      Effect.timeout(options.timeout),
      Effect.map((output) =>
        output
          .split("\n")
          .flatMap((line) => {
            const event = Schema.decodeOption(Schema.fromJsonString(Event))(
              line,
            );

            return Option.isSome(event) &&
              event.value.type === "text" &&
              event.value.part?.text
              ? [event.value.part.text]
              : [];
          })
          .at(-1)
          ?.trim(),
      ),
      Effect.orElseSucceed(() => undefined),
    );
});
