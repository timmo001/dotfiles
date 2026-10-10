import { NodeTerminal } from "@effect/platform-node";
import {
  HerdrSdk,
  herdrSdkLayerFromOptions,
  type Agent,
  type Pane,
  type Tab,
  type Workspace,
} from "@timmo001/effect-herdr";
import {
  Cause,
  Duration,
  Effect,
  Layer,
  Option,
  Schema,
  Terminal,
} from "effect";
import { Prompt } from "effect/cli";
import { ENV, envString } from "../lib/env.js";
import { formatCause } from "../lib/schema.js";
import { DEFAULT_SOCKET_PATH } from "./HerdrRepoOpen.js";

/** Split placement for a moved pane; auto follows the target pane's shape. */
export type HerdrPaneMoveSplit = "auto" | "right" | "down";

/** Parsed pane-move options; anything left out is prompted for on a terminal. */
export interface HerdrPaneMoveOptions {
  /** Pane ID or agent name to move; defaults to the focused pane. */
  readonly pane?: string;
  /** Destination tab ID, number in the source workspace, label, or new. */
  readonly to?: string;
  /** Workspace ID or label for --to new; defaults to the pane's workspace. */
  readonly workspace?: string;
  /** Pane ID or agent name in the destination tab to split beside. */
  readonly target?: string;
  /** Split direction, or auto to choose from the target pane's shape. */
  readonly split?: HerdrPaneMoveSplit;
  /** Leave focus where it is instead of following the moved pane. */
  readonly noFocus: boolean;
  /** Print the move result as JSON. */
  readonly json: boolean;
}

/** Domain error raised when a pane cannot be resolved or moved. */
export class HerdrPaneMoveError extends Schema.TaggedError<HerdrPaneMoveError>()(
  "HerdrPaneMoveError",
  {
    message: Schema.String,
    exitCode: Schema.Union([Schema.Literal(1), Schema.Literal(2)]),
  },
) {}

class PromptCancelled extends Schema.TaggedError<PromptCancelled>()(
  "PromptCancelled",
  {},
) {}

const NEW_TAB = "new";

// Terminal cells are roughly twice as tall as they are wide.
const CELL_ASPECT = 2;

interface Snapshot {
  readonly workspaces: readonly Workspace[];
  readonly tabs: readonly Tab[];
  readonly panes: readonly Pane[];
  readonly agents: readonly Agent[];
}

type Destination =
  | { readonly type: "tab"; readonly tab: Tab }
  | { readonly type: "new_tab"; readonly workspace: Workspace };

const usageError = (message: string) =>
  new HerdrPaneMoveError({ message, exitCode: 2 });

const canPrompt = (options: HerdrPaneMoveOptions) =>
  !options.json &&
  process.stdin.isTTY === true &&
  process.stdout.isTTY === true;

// Esc cancels as well as Ctrl+C and Ctrl+D, so the Herdr popup can be dismissed.
const cancellableTerminal = Layer.effect(
  Terminal.Terminal,
  NodeTerminal.make(
    ({ key }) =>
      key.name === "escape" ||
      (key.ctrl && (key.name === "c" || key.name === "d")),
  ),
);

const ask = <A>(prompt: Prompt.Prompt<A>) =>
  Prompt.run(prompt).pipe(
    Effect.provide(cancellableTerminal),
    Effect.catchTag("QuitError", () => Effect.fail(new PromptCancelled())),
  );

function agentFor(snapshot: Snapshot, pane: Pane) {
  return snapshot.agents.find((agent) => agent.paneId === pane.id);
}

/** Short human name for a pane: agent name and kind, or its label or title. */
function describePane(snapshot: Snapshot, pane: Pane): string {
  const agent = agentFor(snapshot, pane);

  const kind =
    Option.getOrUndefined(agent?.displayAgent ?? Option.none()) ??
    Option.getOrUndefined(pane.displayAgent) ??
    Option.getOrUndefined(pane.agent);

  if (kind) {
    const name = Option.getOrUndefined(agent?.name ?? Option.none());
    const status = agent?.status ?? pane.agentStatus;

    return `${name ? `${name} (${kind})` : kind} ${status}`;
  }

  return (
    Option.getOrUndefined(pane.label) ??
    Option.getOrUndefined(pane.terminalTitleStripped) ??
    Option.getOrUndefined(pane.title) ??
    "shell"
  );
}

function workspaceLabel(snapshot: Snapshot, tab: Tab): string {
  return (
    snapshot.workspaces.find((workspace) => workspace.id === tab.workspaceId)
      ?.label ?? tab.workspaceId
  );
}

function describeTab(snapshot: Snapshot, tab: Tab): string {
  return `${workspaceLabel(snapshot, tab)} › ${tab.number} ${tab.label}`;
}

function panesIn(snapshot: Snapshot, tab: { readonly id: string }) {
  return snapshot.panes.filter((pane) => pane.tabId === tab.id);
}

/** Resolve a pane ID or live agent name against the snapshot. */
function findPane(snapshot: Snapshot, value: string): Pane | undefined {
  return (
    snapshot.panes.find((pane) => pane.id === value) ??
    snapshot.panes.find(
      (pane) =>
        Option.getOrUndefined(
          agentFor(snapshot, pane)?.name ?? Option.none(),
        ) === value,
    )
  );
}

/** Resolve --workspace as an ID, then an exact or unique partial label. */
function findWorkspace(snapshot: Snapshot, value: string) {
  const needle = value.toLowerCase();

  const byId = snapshot.workspaces.find((workspace) => workspace.id === value);

  const exact = snapshot.workspaces.filter(
    (workspace) => workspace.label.toLowerCase() === needle,
  );

  const matches = byId
    ? [byId]
    : exact.length > 0
      ? exact
      : snapshot.workspaces.filter((workspace) =>
          workspace.label.toLowerCase().includes(needle),
        );

  if (matches.length === 1 && matches[0]) return Effect.succeed(matches[0]);

  return Effect.fail(
    usageError(
      matches.length > 1
        ? `More than one workspace matches ${value}; use its ID`
        : `No workspace matches ${value}`,
    ),
  );
}

/** Resolve --to as a tab ID, a tab number in the source workspace, or a unique label. */
function findTab(snapshot: Snapshot, source: Pane, value: string) {
  const byId = snapshot.tabs.find((tab) => tab.id === value);

  if (byId) return Effect.succeed(byId);

  if (/^\d+$/.test(value)) {
    const byNumber = snapshot.tabs.find(
      (tab) =>
        tab.workspaceId === source.workspaceId && tab.number === Number(value),
    );

    return byNumber
      ? Effect.succeed(byNumber)
      : Effect.fail(usageError(`No tab ${value} in this workspace`));
  }

  // Exact labels win; otherwise accept a unique partial match.
  const needle = value.toLowerCase();

  const exact = snapshot.tabs.filter(
    (tab) => tab.label.toLowerCase() === needle,
  );

  const byLabel =
    exact.length > 0
      ? exact
      : snapshot.tabs.filter((tab) => tab.label.toLowerCase().includes(needle));

  if (byLabel.length === 1 && byLabel[0]) return Effect.succeed(byLabel[0]);

  return Effect.fail(
    usageError(
      byLabel.length > 1
        ? `More than one tab is labelled ${value}; use its tab ID`
        : `No tab matches ${value}`,
    ),
  );
}

const readSnapshot = Effect.gen(function* () {
  const herdr = yield* HerdrSdk;

  const { workspaces, panes, agents } = yield* Effect.all(
    {
      workspaces: herdr.workspaces.list(),
      panes: herdr.panes.list(),
      agents: herdr.agents.list(),
    },
    { concurrency: 3 },
  );

  const tabs = yield* Effect.forEach(
    workspaces,
    (workspace) => herdr.tabs.list({ workspaceId: workspace.id }),
    { concurrency: 4 },
  );

  return { workspaces, tabs: tabs.flat(), panes, agents } satisfies Snapshot;
}).pipe(Effect.withSpan("herdrPaneMove.snapshot"));

const chooseSource = Effect.fn("herdrPaneMove.source")(function* (
  snapshot: Snapshot,
  options: HerdrPaneMoveOptions,
) {
  const herdr = yield* HerdrSdk;

  if (options.pane) {
    const pane = findPane(snapshot, options.pane);

    if (!pane)
      return yield* usageError(`No pane or agent named ${options.pane}`);

    return pane;
  }

  const focused = yield* herdr.panes.current();
  const siblings = panesIn(snapshot, { id: focused.tabId });

  if (siblings.length < 2 || !canPrompt(options)) return focused;

  return yield* ask(
    Prompt.Select({
      message: "Pane to move",
      choices: [
        focused,
        ...siblings.filter((pane) => pane.id !== focused.id),
      ].map((pane) => ({
        title: describePane(snapshot, pane),
        description: pane.id === focused.id ? "focused" : pane.id,
        value: pane,
      })),
    }),
  );
});

const chooseDestination = Effect.fn("herdrPaneMove.destination")(function* (
  snapshot: Snapshot,
  source: Pane,
  options: HerdrPaneMoveOptions,
) {
  const alone = panesIn(snapshot, { id: source.tabId }).length < 2;

  if (options.workspace && options.to?.toLowerCase() !== NEW_TAB)
    return yield* usageError("--workspace only applies with --to new");

  if (options.to?.toLowerCase() === NEW_TAB) {
    const workspace = options.workspace
      ? yield* findWorkspace(snapshot, options.workspace)
      : snapshot.workspaces.find(
          (workspace) => workspace.id === source.workspaceId,
        );

    if (!workspace)
      return yield* usageError("Herdr did not report the pane's workspace");

    if (alone && workspace.id === source.workspaceId)
      return yield* usageError("The pane is already alone in its tab");

    return { type: "new_tab", workspace } satisfies Destination;
  }

  if (options.to) {
    const tab = yield* findTab(snapshot, source, options.to);

    if (tab.id === source.tabId)
      return yield* usageError("The pane is already in that tab");

    return { type: "tab", tab } satisfies Destination;
  }

  if (!canPrompt(options))
    return yield* usageError("Pass --to when not running in a terminal");

  // The source workspace first, then the rest in sidebar order. Each
  // workspace lists its tabs, then a new tab there.
  const workspaces = snapshot.workspaces.toSorted(
    (a, b) =>
      Number(b.id === source.workspaceId) - Number(a.id === source.workspaceId),
  );

  const choices = workspaces.flatMap(
    (workspace): Prompt.SelectChoice<Destination>[] => {
      const current = workspace.id === source.workspaceId;

      const tabs = snapshot.tabs
        .filter(
          (tab) => tab.workspaceId === workspace.id && tab.id !== source.tabId,
        )
        .map((tab): Prompt.SelectChoice<Destination> => ({
          title: describeTab(snapshot, tab),
          description: panesIn(snapshot, tab)
            .map((pane) => describePane(snapshot, pane))
            .join(", "),
          value: { type: "tab", tab },
        }));

      const newTab: Prompt.SelectChoice<Destination> = {
        title: `${workspace.label} › New tab`,
        description: current
          ? "Break the pane out into its own tab"
          : "Open the pane in a new tab in this workspace",
        value: { type: "new_tab", workspace },
      };

      return current && alone ? tabs : [...tabs, newTab];
    },
  );

  if (choices.length === 0)
    return yield* usageError("There is nowhere else to move the pane");

  return yield* ask(
    Prompt.AutoComplete<Destination>({
      message: `Move ${describePane(snapshot, source)} into`,
      choices,
    }),
  );
});

const chooseTarget = Effect.fn("herdrPaneMove.target")(function* (
  snapshot: Snapshot,
  tab: Tab,
  options: HerdrPaneMoveOptions,
) {
  const herdr = yield* HerdrSdk;
  const panes = panesIn(snapshot, tab);
  const first = panes[0];

  if (!first) return yield* usageError(`Tab ${tab.id} has no panes`);

  const layout = yield* herdr.panes.layout(first.id);

  if (options.target) {
    const pane = findPane(snapshot, options.target);

    if (!pane || pane.tabId !== tab.id)
      return yield* usageError(
        `No pane or agent named ${options.target} in ${describeTab(snapshot, tab)}`,
      );

    return { pane, layout };
  }

  const focused =
    panes.find((pane) => pane.id === layout.focusedPaneId) ?? first;

  if (panes.length < 2 || !canPrompt(options)) return { pane: focused, layout };

  const pane = yield* ask(
    Prompt.Select({
      message: "Split beside",
      choices: [focused, ...panes.filter((pane) => pane.id !== focused.id)].map(
        (pane) => ({
          title: describePane(snapshot, pane),
          description: pane.id === focused.id ? "focused in that tab" : pane.id,
          value: pane,
        }),
      ),
    }),
  );

  return { pane, layout };
});

/** Pick right for wide panes and down for tall ones, accounting for cell shape. */
function autoSplit(rect: {
  readonly width: number;
  readonly height: number;
}): "right" | "down" {
  return rect.width >= rect.height * CELL_ASPECT ? "right" : "down";
}

const chooseSplit = Effect.fn("herdrPaneMove.split")(function* (
  suggested: "right" | "down",
  options: HerdrPaneMoveOptions,
) {
  if (options.split && options.split !== "auto") return options.split;

  if (options.split === "auto" || !canPrompt(options)) return suggested;

  const other = suggested === "right" ? "down" : "right";

  const title = (split: "right" | "down") =>
    split === "right" ? "Right" : "Down";

  return yield* ask(
    Prompt.Select<"right" | "down">({
      message: "Split",
      choices: [
        {
          title: title(suggested),
          description: "fits the pane's shape",
          value: suggested,
        },
        { title: title(other), value: other },
      ],
    }),
  );
});

/** Move a pane, prompting on a terminal for anything the flags leave open. */
export const herdrPaneMove = Effect.fn("herdrPaneMove")(
  function* (options: HerdrPaneMoveOptions) {
    const herdr = yield* HerdrSdk;
    const snapshot = yield* readSnapshot;
    const source = yield* chooseSource(snapshot, options);
    const destination = yield* chooseDestination(snapshot, source, options);
    const focus = !options.noFocus;
    const sourceName = describePane(snapshot, source);

    if (destination.type === "new_tab") {
      const result = yield* herdr.panes.move(source.id, {
        destination: {
          type: "new_tab",
          workspaceId: destination.workspace.id,
        },
        focus,
      });

      process.stdout.write(
        options.json
          ? `${JSON.stringify({ pane: result.pane.id, previousPane: result.previousPaneId, tab: result.pane.tabId })}\n`
          : `Moved ${sourceName} into a new tab in ${destination.workspace.label}\n`,
      );

      return;
    }

    const { pane: target, layout } = yield* chooseTarget(
      snapshot,
      destination.tab,
      options,
    );

    const rect =
      layout.panes.find((entry) => entry.paneId === target.id)?.rect ??
      layout.area;

    const split = yield* chooseSplit(autoSplit(rect), options);

    const result = yield* herdr.panes.move(source.id, {
      destination: {
        type: "tab",
        tabId: destination.tab.id,
        targetPaneId: target.id,
        split,
      },
      focus,
    });

    process.stdout.write(
      options.json
        ? `${JSON.stringify({ pane: result.pane.id, previousPane: result.previousPaneId, tab: result.pane.tabId, target: target.id, split })}\n`
        : `Moved ${sourceName} into ${describeTab(snapshot, destination.tab)}, split ${split} of ${describePane(snapshot, target)}\n`,
    );
  },
  Effect.provide(
    herdrSdkLayerFromOptions({
      socketPath: envString(ENV.HERDR_SOCKET_PATH) ?? DEFAULT_SOCKET_PATH,
      requestTimeout: Duration.seconds(5),
    }),
  ),
  Effect.catchTag("PromptCancelled", () => Effect.void),
  Effect.catchCause((cause) => {
    const error = Cause.squash(cause);

    return Effect.sync(() => {
      process.stderr.write(
        `${error instanceof HerdrPaneMoveError ? error.message : formatCause(error)}\n`,
      );
      process.exitCode =
        error instanceof HerdrPaneMoveError ? error.exitCode : 1;
    });
  }),
  Effect.asVoid,
);
