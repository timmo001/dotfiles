import { HerdrSdk, type Agent, type PaneId } from "@timmo001/effect-herdr";
import { Effect, Option, Schema } from "effect";
import { join } from "path";
import { HOME_DIR } from "../lib/paths.js";
import { CommandExecutor } from "../services/CommandExecutor.js";

const OPENCODE = join(HOME_DIR, ".local", "bin", "opencode2");

const ModelRef = Schema.Struct({
  id: Schema.String,
  providerID: Schema.String,
  variant: Schema.optionalKey(Schema.String),
});

const SessionResponse = Schema.Struct({
  data: Schema.Struct({
    id: Schema.String.check(Schema.isPattern(/^ses[a-zA-Z0-9_-]+$/)),
    location: Schema.Struct({ directory: Schema.String }),
    model: Schema.optionalKey(ModelRef),
  }),
});

const ModelCatalogue = Schema.Struct({
  location: Schema.Struct({ directory: Schema.String }),
  data: Schema.Array(
    Schema.Struct({
      id: Schema.String,
      providerID: Schema.String,
      variants: Schema.Array(Schema.Struct({ id: Schema.String })),
    }),
  ),
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
  requestedVariant?: string,
) {
  const executor = yield* CommandExecutor;
  const [modelQuery = "", suffix, extra] = query.trim().split("#");
  const name = modelQuery.trim().toLowerCase().replace(/\s+/g, "-");
  const variant = requestedVariant?.trim() ?? suffix?.trim();

  if (!name) return invalid("A model name is required");

  if (extra !== undefined || variant === "")
    return invalid("Use a model name with one non-empty #variant or --variant");

  if (suffix !== undefined && requestedVariant !== undefined)
    return invalid("Use either #variant or --variant, not both");

  const available = (yield* executor.run(OPENCODE, ["models"], {
    cwd: directory,
  }))
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => /^[^\s/#]+\/[^\s#]+$/.test(line));

  const exact = available.filter((model) => model.toLowerCase() === name);

  const matches = exact.length
    ? exact
    : available.filter((model) =>
        model
          .slice(model.indexOf("/") + 1)
          .toLowerCase()
          .includes(name),
      );

  if (matches.length !== 1)
    return invalid(
      matches.length
        ? `Model ${query} is ambiguous: ${matches.join(", ")}`
        : `No available OpenCode model matches ${query}`,
    );

  const selected = matches[0];

  if (!selected) return invalid(`No available OpenCode model matches ${query}`);

  const providerID = selected.slice(0, selected.indexOf("/"));
  const id = selected.slice(selected.indexOf("/") + 1);

  if (!providerID || !id) return invalid(`Invalid OpenCode model ${selected}`);

  if (variant !== undefined) {
    const output = yield* executor.run(
      OPENCODE,
      [
        "api",
        "get",
        `/api/model?location%5Bdirectory%5D=${encodeURIComponent(directory)}`,
      ],
      { cwd: directory },
    );

    const catalogue = yield* Schema.decodeEffect(
      Schema.fromJsonString(ModelCatalogue),
    )(output);

    if (catalogue.location.directory !== directory)
      return invalid(
        "OpenCode returned a model catalogue for another directory",
      );

    const model = catalogue.data.find(
      (entry) => entry.id === id && entry.providerID === providerID,
    );

    if (!model)
      return invalid(`Model ${selected} is missing from the project catalogue`);

    if (!model.variants.some((entry) => entry.id === variant))
      return invalid(
        `Variant ${variant} is not available for ${selected}. Available variants: ${model.variants.map((entry) => entry.id).join(", ") || "none"}`,
      );
  }

  return {
    providerID,
    id,
    variant,
    name: variant === undefined ? selected : `${selected}#${variant}`,
  };
});

/** Create an OpenCode session with its model set before the TUI starts. */
export const createHerdrModelSession = Effect.fn("herdr.model.create")(
  function* (query: string, directory: string, requestedVariant?: string) {
    const executor = yield* CommandExecutor;

    const { id, providerID, variant, name } = yield* resolveHerdrModel(
      query,
      directory,
      requestedVariant,
    );

    const output = yield* executor.run(
      OPENCODE,
      [
        "api",
        "post",
        "/api/session",
        "--data",
        JSON.stringify({
          location: { directory },
          model: { id, providerID, variant },
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
      session.data.model.providerID !== providerID ||
      (variant !== undefined && session.data.model.variant !== variant)
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
  requestedVariant?: string,
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
    requestedVariant,
  );

  yield* executor.run(
    OPENCODE,
    [
      "api",
      "post",
      `/api/session/${reference.value}/model`,
      "--data",
      JSON.stringify({
        model: {
          id: model.id,
          providerID: model.providerID,
          variant: model.variant,
        },
      }),
    ],
    { cwd: session.data.location.directory },
  );

  const updated = yield* executor.run(
    OPENCODE,
    ["api", "get", `/api/session/${reference.value}`],
    { cwd: session.data.location.directory },
  );

  const confirmed = yield* Schema.decodeEffect(
    Schema.fromJsonString(SessionResponse),
  )(updated);

  if (
    confirmed.data.model?.id !== model.id ||
    confirmed.data.model.providerID !== model.providerID ||
    (confirmed.data.model.variant ?? "default") !== (model.variant ?? "default")
  )
    return invalid("OpenCode did not select the requested model and variant");

  return { sessionId: reference.value, model: model.name };
});
