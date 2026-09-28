import { HerdrSdk, type Agent, type PaneId } from "@timmo001/effect-herdr";
import { Effect, Option, Schema } from "effect";
import { join } from "path";
import { HOME_DIR } from "../lib/paths.js";
import { CommandExecutor } from "../services/CommandExecutor.js";

const OPENCODE = join(HOME_DIR, ".local", "bin", "opencode2");

const SessionResponse = Schema.Struct({
  data: Schema.Struct({
    id: Schema.String.check(Schema.isPattern(/^ses[a-zA-Z0-9_-]+$/)),
    location: Schema.Struct({ directory: Schema.String }),
    model: Schema.optionalKey(
      Schema.Struct({ id: Schema.String, providerID: Schema.String }),
    ),
  }),
});

/** Failures resolving an OpenCode model or its Herdr-owned session. */
export class HerdrModelError extends Schema.TaggedError<HerdrModelError>()(
  "HerdrModelError",
  { message: Schema.String, exitCode: Schema.Literal(2) },
) {}

function invalid(message: string): never {
  throw new HerdrModelError({ message, exitCode: 2 });
}

/** Resolve a unique installed model without guessing between providers. */
export const resolveHerdrModel = Effect.fn("herdr.model.resolve")(function* (
  query: string,
  directory: string,
) {
  const executor = yield* CommandExecutor;
  const name = query.trim().toLowerCase().replace(/\s+/g, "-");

  if (!name) return invalid("A model name is required");

  const available = (yield* executor.run(OPENCODE, ["models"], {
    cwd: directory,
  }))
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[^\s/]+\/[^\s/]+$/.test(line));

  const exact = available.filter((model) => model.toLowerCase() === name);

  const matches = exact.length
    ? exact
    : available.filter((model) =>
        model.toLowerCase().split("/")[1]?.includes(name),
      );

  if (matches.length !== 1)
    return invalid(
      matches.length
        ? `Model ${query} is ambiguous: ${matches.join(", ")}`
        : `No available OpenCode model matches ${query}`,
    );

  const selected = matches[0];

  if (!selected) return invalid(`No available OpenCode model matches ${query}`);

  const [providerID, id] = selected.split("/");

  if (!providerID || !id) return invalid(`Invalid OpenCode model ${selected}`);

  return { providerID, id, name: selected };
});

/** Create an OpenCode session with its model set before the TUI starts. */
export const createHerdrModelSession = Effect.fn("herdr.model.create")(
  function* (query: string, directory: string) {
    const executor = yield* CommandExecutor;
    const { id, providerID, name } = yield* resolveHerdrModel(query, directory);

    const output = yield* executor.run(
      OPENCODE,
      [
        "api",
        "post",
        "/api/session",
        "--data",
        JSON.stringify({
          location: { directory },
          model: { id, providerID },
        }),
      ],
      { cwd: directory },
    );

    const session = yield* Schema.decodeUnknownEffect(SessionResponse)(
      JSON.parse(output),
    );

    if (session.data.location.directory !== directory)
      return invalid("OpenCode created the session in another directory");

    if (
      session.data.model?.id !== id ||
      session.data.model.providerID !== providerID
    )
      return invalid("OpenCode did not select the requested model");

    return { sessionId: session.data.id, model: name };
  },
);

/** Verify that a Herdr agent is the configured OpenCode 2 runtime. */
export const verifyHerdrOpenCode = Effect.fn("herdr.model.verify")(function* (
  agent: Agent,
  paneId: PaneId,
  directory: string,
) {
  const executor = yield* CommandExecutor;

  if (Option.getOrUndefined(agent.agent) !== "opencode")
    return invalid("The selected agent is not OpenCode");

  const expected = (yield* executor.run("mise", ["which", "opencode2"], {
    cwd: directory,
  })).trim();

  if (!expected.startsWith("/") || expected.includes("\n"))
    return invalid("OpenCode 2 verification did not return an executable path");

  const herdr = yield* HerdrSdk;

  const processes =
    (yield* herdr.panes.processInfo(paneId)).foregroundProcesses ?? [];

  if (
    !processes.some((process) =>
      Option.exists(process.argv, (argv) => argv.includes(expected)),
    )
  )
    return invalid("The selected agent did not start through OpenCode 2");
});

/** Switch the model of an existing, verified OpenCode 2 session. */
export const switchHerdrModel = Effect.fn("herdr.model.switch")(function* (
  agent: Agent,
  paneId: PaneId,
  directory: string,
  query: string,
) {
  const executor = yield* CommandExecutor;
  yield* verifyHerdrOpenCode(agent, paneId, directory);
  const reference = Option.getOrUndefined(agent.agentSession);

  if (
    reference?.source !== "herdr:opencode" ||
    reference.kind !== "id" ||
    !reference.value.startsWith("ses")
  )
    return invalid(
      "Herdr has not reported an OpenCode session ID for this agent",
    );

  const response = yield* executor.run(
    OPENCODE,
    ["api", "get", `/api/session/${reference.value}`],
    { cwd: directory },
  );

  const session = yield* Schema.decodeUnknownEffect(SessionResponse)(
    JSON.parse(response),
  );

  const model = yield* resolveHerdrModel(
    query,
    session.data.location.directory,
  );

  yield* executor.run(
    OPENCODE,
    [
      "api",
      "post",
      `/api/session/${reference.value}/model`,
      "--data",
      JSON.stringify({ model: { id: model.id, providerID: model.providerID } }),
    ],
    { cwd: session.data.location.directory },
  );

  return { sessionId: reference.value, model: model.name };
});
