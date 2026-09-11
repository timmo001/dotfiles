import { HerdrSdk, herdrSdkLayerFromOptions } from "@herdr/sdk";
import { Effect, Option, Schema } from "effect";
import { basename, join } from "node:path";
import { localHerdrAttachment } from "../lib/herdrAttachment.js";
import { CONFIG_DIR } from "../lib/paths.js";
import { formatCause } from "../lib/schema.js";
import { CommandExecutor } from "../services/CommandExecutor.js";

/** JSON contract shared by attached-workspace consumers. */
export const HerdrContext = Schema.Struct({
  attached: Schema.Boolean,
  session: Schema.Struct({
    name: Schema.NullOr(Schema.String),
    socketPath: Schema.String,
  }),
  workspace: Schema.NullOr(
    Schema.Struct({ id: Schema.String, label: Schema.String }),
  ),
  tab: Schema.NullOr(
    Schema.Struct({ id: Schema.String, label: Schema.String }),
  ),
  pane: Schema.NullOr(
    Schema.Struct({
      id: Schema.String,
      agent: Schema.NullOr(Schema.String),
      status: Schema.String,
    }),
  ),
  cwd: Schema.NullOr(Schema.String),
  repository: Schema.NullOr(
    Schema.Struct({
      name: Schema.String,
      path: Schema.String,
      branch: Schema.NullOr(Schema.String),
    }),
  ),
});

/** Decoded attached-session context, with null fields when no client is attached. */
export type HerdrContext = typeof HerdrContext.Type;

/** Collect context only while a local terminal client is attached. */
export const readHerdrContext = Effect.fn("readHerdrContext")(function* () {
  const sdk = yield* HerdrSdk;
  const executor = yield* CommandExecutor;

  const empty: HerdrContext = {
    attached: false,
    session: {
      name:
        Option.getOrNull(sdk.config.session) ??
        (sdk.config.socketPath === join(CONFIG_DIR, "herdr", "herdr.sock")
          ? "default"
          : null),
      socketPath: sdk.config.socketPath,
    },
    workspace: null,
    tab: null,
    pane: null,
    cwd: null,
    repository: null,
  };

  if (!(yield* localHerdrAttachment(sdk.config.socketPath))) return empty;
  const snapshot = yield* sdk.session.snapshot();

  const pane = snapshot.panes.find(
    (value) => value.id === Option.getOrNull(snapshot.focusedPaneId),
  );

  const workspace = snapshot.workspaces.find(
    (value) => value.id === pane?.workspaceId,
  );

  const tab = snapshot.tabs.find((value) => value.id === pane?.tabId);

  const cwd = pane
    ? Option.getOrNull(Option.orElse(pane.foregroundCwd, () => pane.cwd))
    : null;

  let repository: HerdrContext["repository"] = null;

  if (cwd) {
    const path = yield* executor
      .run("git", ["rev-parse", "--show-toplevel"], {
        cwd,
        env: { LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0" },
      })
      .pipe(
        Effect.catchTag("CommandError", (error) =>
          /not a git repository/.test(error.stderr)
            ? Effect.succeed(null)
            : Effect.fail(error),
        ),
      );

    if (path) {
      const branch = yield* executor
        .run("git", ["symbolic-ref", "--quiet", "--short", "HEAD"], {
          cwd,
          env: { LC_ALL: "C", GIT_OPTIONAL_LOCKS: "0" },
        })
        .pipe(
          Effect.catchTag("CommandError", (error) =>
            error.exitCode === 1 ? Effect.succeed(null) : Effect.fail(error),
          ),
        );

      repository = {
        name: basename(path.trim()),
        path: path.trim(),
        branch: branch?.trim() || null,
      };
    }
  }

  if (!(yield* localHerdrAttachment(sdk.config.socketPath))) return empty;

  return {
    ...empty,
    attached: true,
    workspace: workspace ? { id: workspace.id, label: workspace.label } : null,
    tab: tab ? { id: tab.id, label: tab.label } : null,
    pane: pane
      ? {
          id: pane.id,
          agent: Option.getOrNull(pane.agent),
          status: pane.agentStatus,
        }
      : null,
    cwd,
    repository,
  };
});

/** Render context for people, or one JSON object for panel consumers. */
export function formatHerdrContext(
  context: HerdrContext,
  json: boolean,
): string {
  if (json) return JSON.stringify(context);

  if (!context.attached) return "No attached Herdr terminal";

  return [
    `Herdr: attached (${context.session.name ?? context.session.socketPath})`,
    `Workspace: ${context.workspace ? `${context.workspace.label} (${context.workspace.id})` : "unavailable"}`,
    `Tab: ${context.tab ? `${context.tab.label} (${context.tab.id})` : "unavailable"}`,
    `Pane: ${context.pane ? `${context.pane.id} · ${context.pane.agent ?? "shell"} · ${context.pane.status}` : "unavailable"}`,
    `Directory: ${context.cwd ?? "unavailable"}`,
    ...(context.repository
      ? [
          `Repository: ${context.repository.path}`,
          `Branch: ${context.repository.branch ?? "detached HEAD"}`,
        ]
      : []),
  ].join("\n");
}

/** Run the readable or JSON context command using explicit or standard SDK session selection. */
export const herdrContext = Effect.fn("herdrContext")(
  function* (options: { readonly json: boolean; readonly session?: string }) {
    const sdkOptions =
      options.session === "default"
        ? {
            socketPath: join(
              process.env.HERDR_CONFIG_DIR || CONFIG_DIR + "/herdr",
              "herdr.sock",
            ),
          }
        : options.session
          ? { session: options.session }
          : {};

    const context = yield* readHerdrContext().pipe(
      Effect.provide(herdrSdkLayerFromOptions(sdkOptions)),
      Effect.timeout("2 seconds"),
    );

    console.log(formatHerdrContext(context, options.json));
  },
  Effect.catch((error) =>
    Effect.sync(() => {
      console.error(`dot herdr context: ${formatCause(error)}`);
      process.exitCode = 1;
    }),
  ),
);
