/**
 * `dot work-time`: whether it's work time now, as JSON, for tools outside dot
 * that pick a default by it, such as Upkeep's Attention page.
 */
import { Console, Effect } from "effect";
import { isWorkTime } from "../lib/workTime.js";

/** Print `{ "work": boolean }`, with any notes on stderr so stdout stays JSON. */
export const workTime = Effect.gen(function* () {
  const work = yield* isWorkTime((message) => Console.error(message));

  yield* Console.log(JSON.stringify({ work }));
});
