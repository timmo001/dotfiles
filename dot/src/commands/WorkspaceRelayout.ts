import { Cause, Effect, Schema } from "effect";
import {
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "fs";
import { dirname, join } from "path";
import { randomUUID } from "crypto";
import { ENV, envString } from "../lib/env.js";
import { HOME_DIR } from "../lib/paths.js";
import { decodeJson, type JsonValue } from "../lib/schema.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import {
  acquireWorkspaceMutationLock,
  releaseWorkspaceMutationLock,
} from "../lib/workspaceMutationLock.js";

const LEAF = "w" as const;
const DEFAULT_TEMP_WORKSPACE = 99;
const VERIFY_ATTEMPTS = 20;
const VERIFY_INTERVAL = "25 millis";

/** A leaf in a saved Hyprland Dwindle split tree. */
export type LayoutLeaf = typeof LEAF;

/** A branch in a saved Hyprland Dwindle split tree. */
export interface LayoutSplit {
  /** Split direction: left/right or top/bottom. */
  readonly dir: "lr" | "tb";
  /** Percentage of the branch occupied by the first child. */
  readonly ratio: number;
  /** First child. */
  readonly a: LayoutTree;
  /** Second child. */
  readonly b: LayoutTree;
}

/** A ratio-based Hyprland Dwindle split tree. */
export type LayoutTree = LayoutLeaf | LayoutSplit;

/** Window geometry used to capture and assign a layout. */
export interface LayoutWindow {
  /** Hyprland window address. */
  readonly address: string;
  /** Top-left position in compositor coordinates. */
  readonly at: readonly [number, number];
  /** Window size in compositor coordinates. */
  readonly size: readonly [number, number];
}

/** One operation required to reconstruct a split tree. */
export interface LayoutOperation {
  /** Split direction. */
  readonly dir: "lr" | "tb";
  /** First-child percentage. */
  readonly ratio: number;
  /** Existing window index used as the split anchor. */
  readonly anchor: number;
  /** Window index inserted into the new branch. */
  readonly next: number;
}

interface HyprlandClient extends LayoutWindow {
  readonly mapped: boolean;
  readonly hidden: boolean;
  readonly floating: boolean;
  readonly workspace: { readonly id: number };
}

interface LayoutPreset {
  readonly group: string;
  readonly name: string;
  tree: LayoutTree;
}

interface PresetsFile {
  readonly version: 3;
  readonly layouts: Record<string, LayoutPreset[]>;
}

interface ActiveWorkspace {
  readonly id: number;
  readonly name: string;
}

interface LayoutWalkResult {
  readonly operations: readonly LayoutOperation[];
  readonly next: number;
}

const CoordinateSchema = Schema.Tuple([Schema.Finite, Schema.Finite]);
const WorkspaceSchema = Schema.Struct({ id: Schema.Finite });
const ClientSchema = Schema.Struct({
  address: Schema.NonEmptyString,
  mapped: Schema.Boolean,
  hidden: Schema.Boolean,
  floating: Schema.Boolean,
  workspace: WorkspaceSchema,
  at: CoordinateSchema,
  size: CoordinateSchema,
});
const ClientsSchema = Schema.Array(ClientSchema);
const ActiveWorkspaceSchema = Schema.Struct({
  id: Schema.Finite,
  name: Schema.optional(Schema.String),
});
const ActiveWindowSchema = Schema.Struct({
  address: Schema.NonEmptyString,
  workspace: WorkspaceSchema,
});
const LayoutTreeSchema: Schema.Codec<LayoutTree> = Schema.Union([
  Schema.Literal(LEAF),
  Schema.Struct({
    dir: Schema.Union([Schema.Literal("lr"), Schema.Literal("tb")]),
    ratio: Schema.Finite.check(Schema.isGreaterThan(0), Schema.isLessThan(100)),
    a: Schema.suspend((): Schema.Codec<LayoutTree> => LayoutTreeSchema),
    b: Schema.suspend((): Schema.Codec<LayoutTree> => LayoutTreeSchema),
  }),
]);
const PresetsSchema = Schema.Struct({
  version: Schema.Literal(3),
  layouts: Schema.Record(
    Schema.String,
    Schema.Array(
      Schema.Struct({
        group: Schema.NonEmptyString,
        name: Schema.NonEmptyString,
        tree: LayoutTreeSchema,
      }),
    ),
  ),
});

/** Domain error raised by the workspace relayout command. */
export class WorkspaceRelayoutError extends Schema.TaggedError<WorkspaceRelayoutError>()(
  "WorkspaceRelayoutError",
  { message: Schema.String },
) {}

function fail(message: string): never {
  throw new WorkspaceRelayoutError({ message });
}

/** Decode and validate a recursive layout tree from external JSON. */
export function decodeLayoutTree(value: JsonValue): LayoutTree {
  try {
    return Schema.decodeUnknownSync(LayoutTreeSchema)(value);
  } catch (error) {
    return fail(`Invalid layout tree: ${String(error)}`);
  }
}

/** Count leaves in a layout tree. */
export function layoutLeafCount(tree: LayoutTree): number {
  return tree === LEAF ? 1 : layoutLeafCount(tree.a) + layoutLeafCount(tree.b);
}

/** Decode and validate the workspace relayout presets file. */
export function decodePresets(value: JsonValue): PresetsFile {
  const decoded = (() => {
    try {
      return Schema.decodeUnknownSync(PresetsSchema)(value);
    } catch (error) {
      return fail(`Invalid presets file: ${String(error)}`);
    }
  })();
  for (const [count, entries] of Object.entries(decoded.layouts)) {
    const expectedLeaves = Number(count);
    if (!Number.isInteger(expectedLeaves) || expectedLeaves < 1) {
      return fail(`Invalid layout window count: ${count}`);
    }
    entries.forEach((entry, index) => {
      if (layoutLeafCount(entry.tree) !== expectedLeaves) {
        return fail(
          `layouts.${count}[${index}].tree must have ${expectedLeaves} leaves`,
        );
      }
    });
  }
  return {
    version: 3,
    layouts: Object.fromEntries(
      Object.entries(decoded.layouts).map(([count, entries]) => [
        count,
        entries.map((entry) => ({ ...entry })),
      ]),
    ),
  };
}

function decodeClients(value: JsonValue): readonly HyprlandClient[] {
  try {
    return Schema.decodeUnknownSync(ClientsSchema)(value);
  } catch (error) {
    return fail(`Invalid Hyprland clients response: ${String(error)}`);
  }
}

function decodeActiveWorkspace(value: JsonValue): ActiveWorkspace {
  try {
    const decoded = Schema.decodeUnknownSync(ActiveWorkspaceSchema)(value);
    if (!Number.isInteger(decoded.id)) {
      return fail("Active workspace id must be an integer");
    }
    return { id: decoded.id, name: decoded.name ?? "" };
  } catch (error) {
    return fail(`Could not read active workspace: ${String(error)}`);
  }
}

function bounds(windows: readonly LayoutWindow[]) {
  return {
    left: Math.min(...windows.map((window) => window.at[0])),
    top: Math.min(...windows.map((window) => window.at[1])),
    right: Math.max(...windows.map((window) => window.at[0] + window.size[0])),
    bottom: Math.max(...windows.map((window) => window.at[1] + window.size[1])),
  };
}

function findCut(
  windows: readonly LayoutWindow[],
  axis: 0 | 1,
): {
  readonly a: readonly LayoutWindow[];
  readonly b: readonly LayoutWindow[];
} | null {
  const sorted = [...windows].sort(
    (left, right) => left.at[axis] - right.at[axis],
  );
  for (let index = 1; index < sorted.length; index += 1) {
    const a = sorted.slice(0, index);
    const b = sorted.slice(index);
    const aEnd = Math.max(
      ...a.map((window) => window.at[axis] + window.size[axis]),
    );
    const bStart = Math.min(...b.map((window) => window.at[axis]));
    if (aEnd <= bStart) return { a, b };
  }
  return null;
}

/** Capture a guillotine split tree from tiled window geometry. */
export function captureLayoutTree(
  windows: readonly LayoutWindow[],
): LayoutTree {
  if (windows.length === 0) return fail("Cannot capture an empty workspace");
  if (windows.length === 1) return LEAF;

  const vertical = findCut(windows, 0);
  const horizontal = vertical ? null : findCut(windows, 1);
  const cut = vertical ?? horizontal;
  if (!cut) return fail("Window geometry is not a guillotine split tree");

  const direction = vertical ? "lr" : "tb";
  const axis = vertical ? 0 : 1;
  const allBounds = bounds(windows);
  const aBounds = bounds(cut.a);
  const bBounds = bounds(cut.b);
  const start = axis === 0 ? allBounds.left : allBounds.top;
  const end = axis === 0 ? allBounds.right : allBounds.bottom;
  const aEnd = axis === 0 ? aBounds.right : aBounds.bottom;
  const bStart = axis === 0 ? bBounds.left : bBounds.top;
  const ratio =
    Math.round(((aEnd - start) / (aEnd - start + end - bStart)) * 10_000) / 100;

  return {
    dir: direction,
    ratio,
    a: captureLayoutTree(cut.a),
    b: captureLayoutTree(cut.b),
  };
}

/** Convert a layout tree into ordered reconstruction operations. */
export function layoutOperations(tree: LayoutTree): readonly LayoutOperation[] {
  function walk(
    node: LayoutTree,
    anchor: number,
    next: number,
  ): LayoutWalkResult {
    if (node === LEAF) return { operations: [], next };
    const branchIndex = next;
    const a = walk(node.a, anchor, next + 1);
    const b = walk(node.b, branchIndex, a.next);
    return {
      operations: [
        { dir: node.dir, ratio: node.ratio, anchor, next: branchIndex },
        ...a.operations,
        ...b.operations,
      ],
      next: b.next,
    };
  }
  return walk(tree, 0, 1).operations;
}

function simulatedBoxes(
  tree: LayoutTree,
): ReadonlyMap<number, readonly [number, number, number, number]> {
  const boxes = new Map<number, readonly [number, number, number, number]>([
    [0, [0, 0, 1, 1]],
  ]);
  for (const operation of layoutOperations(tree)) {
    const box = boxes.get(operation.anchor);
    if (!box)
      return fail(`Missing simulated box for window ${operation.anchor}`);
    const ratio = operation.ratio / 100;
    if (operation.dir === "lr") {
      boxes.set(operation.anchor, [box[0], box[1], box[2] * ratio, box[3]]);
      boxes.set(operation.next, [
        box[0] + box[2] * ratio,
        box[1],
        box[2] * (1 - ratio),
        box[3],
      ]);
    } else {
      boxes.set(operation.anchor, [box[0], box[1], box[2], box[3] * ratio]);
      boxes.set(operation.next, [
        box[0],
        box[1] + box[3] * ratio,
        box[2],
        box[3] * (1 - ratio),
      ]);
    }
  }
  return boxes;
}

/** Assign current windows to target leaves while preserving their approximate positions. */
export function assignLayoutWindows(
  tree: LayoutTree,
  windows: readonly LayoutWindow[],
): readonly string[] {
  if (layoutLeafCount(tree) !== windows.length) {
    return fail("Layout leaf count does not match the current window count");
  }
  const boxes = simulatedBoxes(tree);
  const targetOrder = [...boxes.entries()]
    .map(([index, box]) => ({
      index,
      x: box[0] + box[2] / 2,
      y: box[1] + box[3] / 2,
    }))
    .sort((left, right) => left.y - right.y || left.x - right.x);
  const windowBounds = bounds(windows);
  const width = windowBounds.right - windowBounds.left || 1;
  const height = windowBounds.bottom - windowBounds.top || 1;
  const windowOrder = windows
    .map((window) => ({
      address: window.address,
      x: (window.at[0] + window.size[0] / 2 - windowBounds.left) / width,
      y: (window.at[1] + window.size[1] / 2 - windowBounds.top) / height,
    }))
    .sort((left, right) => left.y - right.y || left.x - right.x);
  const byIndex = new Map<number, string>();
  targetOrder.forEach((target, index) =>
    byIndex.set(target.index, windowOrder[index].address),
  );
  return Array.from({ length: windows.length }, (_, index) => {
    const address = byIndex.get(index);
    return address ?? fail(`Could not assign window ${index}`);
  });
}

function allColumns(tree: LayoutTree): boolean {
  return (
    tree === LEAF ||
    (tree.dir === "lr" && allColumns(tree.a) && allColumns(tree.b))
  );
}

function allRows(tree: LayoutTree): boolean {
  return (
    tree === LEAF || (tree.dir === "tb" && allRows(tree.a) && allRows(tree.b))
  );
}

function leafPercentages(tree: LayoutTree): readonly number[] {
  if (tree === LEAF) return [100];
  return [
    ...leafPercentages(tree.a).map((value) => (value * tree.ratio) / 100),
    ...leafPercentages(tree.b).map(
      (value) => (value * (100 - tree.ratio)) / 100,
    ),
  ];
}

function ratioSignature(tree: LayoutTree): string {
  if (tree === LEAF) return "";
  if (allColumns(tree) || allRows(tree)) {
    return leafPercentages(tree).map(Math.round).join("/");
  }
  return [
    `${Math.round(tree.ratio)}/${Math.round(100 - tree.ratio)}`,
    ...[tree.a, tree.b].map(ratioSignature).filter(Boolean),
  ].join(", ");
}

/** Return the generated human-readable description for a layout tree. */
export function describeLayoutTree(tree: LayoutTree): string {
  const count = layoutLeafCount(tree);
  if (tree === LEAF) return "1 window";
  if (allColumns(tree)) return `${count} columns`;
  if (allRows(tree)) return `${count} rows`;
  if (tree.dir === "tb" && allColumns(tree.a) && allColumns(tree.b)) {
    return `${layoutLeafCount(tree.a)} top / ${layoutLeafCount(tree.b)} bottom`;
  }
  if (tree.dir === "lr" && allRows(tree.a) && allRows(tree.b)) {
    return `${layoutLeafCount(tree.a)} left / ${layoutLeafCount(tree.b)} right`;
  }
  return `${count} windows`;
}

function presetLabel(preset: LayoutPreset): string {
  return `${preset.name} [${ratioSignature(preset.tree)}]`;
}

function uniqueLabels(presets: readonly LayoutPreset[]): readonly string[] {
  const seen = new Map<string, number>();
  return presets.map((preset) => {
    const label = presetLabel(preset);
    const occurrence = (seen.get(label) ?? 0) + 1;
    seen.set(label, occurrence);
    return occurrence === 1 ? label : `${label} (${occurrence})`;
  });
}

function quoteLua(value: string): string {
  return JSON.stringify(value);
}

function focusCommand(address: string): string {
  return `dispatch hl.dsp.focus({ window = ${quoteLua(`address:${address}`)} })`;
}

function moveCommand(workspace: number, address: string): string {
  return `dispatch hl.dsp.window.move({ workspace = ${quoteLua(String(workspace))}, window = ${quoteLua(`address:${address}`)} })`;
}

/** Build the checked Hyprland batch used to reconstruct a layout. */
export function buildLayoutBatch(
  tree: LayoutTree,
  addresses: readonly string[],
  workspace: number,
  temporaryWorkspace: number,
  restoreAddress?: string,
): string {
  if (addresses.length < 2 || addresses.length !== layoutLeafCount(tree)) {
    return fail("Cannot build a layout batch for the supplied windows");
  }
  const commands = addresses.map((address) =>
    moveCommand(temporaryWorkspace, address),
  );
  commands.push(moveCommand(workspace, addresses[0]));
  for (const operation of layoutOperations(tree)) {
    const anchor = addresses[operation.anchor];
    const next = addresses[operation.next];
    const direction = operation.dir === "lr" ? "r" : "d";
    commands.push(
      focusCommand(anchor),
      `dispatch hl.dsp.layout(${quoteLua(`preselect ${direction}`)})`,
      moveCommand(workspace, next),
      focusCommand(anchor),
      `dispatch hl.dsp.layout(${quoteLua(`splitratio ${((2 * operation.ratio) / 100).toFixed(4)} exact`)})`,
    );
  }
  if (restoreAddress) commands.push(focusCommand(restoreAddress));
  return commands.join(" ; ");
}

function presetsPath(): string {
  return join(
    envString(ENV.XDG_DATA_HOME) ?? join(HOME_DIR, ".local", "share"),
    "workspace-relayout",
    "presets.json",
  );
}

function loadPresets(path: string): PresetsFile {
  try {
    return decodePresets(JSON.parse(readFileSync(path, "utf8")));
  } catch (error) {
    if (error instanceof WorkspaceRelayoutError) throw error;
    return fail(
      `Could not read presets: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

/** Atomically replace preset contents while preserving a stowed symlink. */
export function savePresetsAtomically(
  path: string,
  presets: PresetsFile,
): void {
  const target = realpathSync(path);
  const temporary = join(dirname(target), `.${randomUUID()}.tmp`);
  try {
    writeFileSync(temporary, `${JSON.stringify(presets, null, 2)}\n`, {
      mode: 0o644,
    });
    renameSync(temporary, target);
  } finally {
    rmSync(temporary, { force: true });
  }
}

function tempWorkspace(): number {
  const raw = process.env.WORKSPACE_RELAYOUT_TEMP_WS;
  if (raw === undefined) return DEFAULT_TEMP_WORKSPACE;
  if (!/^\d+$/.test(raw) || Number(raw) <= 0) {
    return fail("WORKSPACE_RELAYOUT_TEMP_WS must be a positive workspace id");
  }
  return Number(raw);
}

function parseJson(source: string, label: string): JsonValue {
  try {
    return decodeJson(JSON.parse(source));
  } catch (error) {
    return fail(
      `${label} returned invalid JSON: ${error instanceof Error ? error.message : String(error)}`,
    );
  }
}

function workspaceClients(
  clients: readonly HyprlandClient[],
  workspace: number,
): readonly HyprlandClient[] {
  return clients.filter(
    (client) =>
      client.mapped &&
      !client.hidden &&
      !client.floating &&
      client.workspace.id === workspace,
  );
}

function commandAvailable(command: string): boolean {
  return Bun.which(command) !== null;
}

/** Run workspace relayout apply or capture mode. */
export const workspaceRelayout = Effect.fn("workspaceRelayout")(
  function* (options: { readonly edit: boolean }) {
    const executor = yield* CommandExecutor;
    const notify = (title: string, message: string) =>
      executor
        .exitCode("omarchy", [
          "notification",
          "send",
          "-g",
          "󱂬",
          title,
          message,
        ])
        .pipe(Effect.asVoid);
    let title = "Workspace relayout";

    const run = Effect.gen(function* () {
      for (const dependency of [
        "hyprctl",
        "omarchy-menu-select",
        "omarchy",
      ] as const) {
        if (!commandAvailable(dependency))
          return fail(`${dependency} is not available`);
      }
      if (options.edit && !commandAvailable("omarchy-menu-input")) {
        return fail("omarchy-menu-input is not available");
      }

      const active = decodeActiveWorkspace(
        parseJson(
          yield* executor.run("hyprctl", ["-j", "activeworkspace"]),
          "hyprctl activeworkspace",
        ),
      );
      title = active.name ? `Workspace relayout (${active.name})` : title;
      const temporaryWorkspace = tempWorkspace();
      if (temporaryWorkspace === active.id) {
        return fail(
          "WORKSPACE_RELAYOUT_TEMP_WS must differ from the active workspace id",
        );
      }

      const allClients = decodeClients(
        parseJson(
          yield* executor.run("hyprctl", ["-j", "clients"]),
          "hyprctl clients",
        ),
      );
      if (
        allClients.some(
          (client) =>
            client.mapped && client.workspace.id === temporaryWorkspace,
        )
      ) {
        return fail(
          `Temporary workspace ${temporaryWorkspace} is already occupied`,
        );
      }
      const clients = workspaceClients(allClients, active.id);
      if (clients.length < 2) {
        yield* notify(
          title,
          `Need at least 2 tiled windows on this workspace, found ${clients.length}`,
        );
        return;
      }

      const path = presetsPath();
      const presets = loadPresets(path);
      const count = String(clients.length);
      const available = presets.layouts[count] ?? [];
      const select = (prompt: string, choices: readonly string[]) =>
        executor
          .run("omarchy-menu-select", [
            prompt,
            ...choices,
            "--",
            "--width",
            "460",
            "--maxheight",
            "360",
          ])
          .pipe(
            Effect.map((choice) => choice.trim()),
            Effect.orElseSucceed(() => ""),
          );
      const input = (prompt: string, fallback: string) =>
        executor.run("omarchy-menu-input", [prompt, "--width", "460"]).pipe(
          Effect.map((value) => value.trim() || fallback),
          Effect.orElseSucceed(() => fallback),
        );

      if (options.edit) {
        const addFamily = "Add new family";
        const groups = [...new Set(available.map((preset) => preset.group))];
        const selectedGroup = yield* select(
          `Edit ${count} window layout family`,
          [...groups, addFamily],
        );
        if (!selectedGroup) return;
        const tree = captureLayoutTree(clients);
        if (selectedGroup === addFamily) {
          const group = yield* input(
            "Layout name (New layout family)",
            "New layout family",
          );
          const name = yield* input(
            `Layout name (${describeLayoutTree(tree)})`,
            describeLayoutTree(tree),
          );
          presets.layouts[count] = [...available, { group, name, tree }];
          savePresetsAtomically(path, presets);
          yield* notify(title, `Added ${name}`);
          return;
        }

        const inGroup = available.filter(
          (preset) => preset.group === selectedGroup,
        );
        const labels = uniqueLabels(inGroup);
        const addLayout = "➕  Add new layout";
        const selectedLabel = yield* select(`Edit ${count} window layouts`, [
          ...labels,
          addLayout,
        ]);
        if (!selectedLabel) return;
        if (selectedLabel === addLayout) {
          const name = yield* input(
            `Layout name (${describeLayoutTree(tree)})`,
            describeLayoutTree(tree),
          );
          presets.layouts[count] = [
            ...available,
            { group: selectedGroup, name, tree },
          ];
          savePresetsAtomically(path, presets);
          yield* notify(title, `Added ${name}`);
          return;
        }
        const selectedIndex = labels.indexOf(selectedLabel);
        if (selectedIndex < 0)
          return fail("The selected layout is no longer available");
        const selected = inGroup[selectedIndex];
        selected.tree = tree;
        savePresetsAtomically(path, presets);
        yield* notify(title, `Updated ${selected.name}`);
        return;
      }

      if (available.length === 0) {
        yield* notify(
          title,
          `No presets for ${count} windows yet - use edit mode to add one`,
        );
        return;
      }
      const groups = [...new Set(available.map((preset) => preset.group))];
      const selectedGroup = yield* select(
        `${count} window layout family`,
        groups,
      );
      if (!selectedGroup) return;
      const inGroup = available.filter(
        (preset) => preset.group === selectedGroup,
      );
      const labels = uniqueLabels(inGroup);
      const selectedLabel = yield* select(`${selectedGroup} layout`, labels);
      if (!selectedLabel) return;
      const selectedIndex = labels.indexOf(selectedLabel);
      if (selectedIndex < 0)
        return fail("The selected layout is no longer available");
      const selected = inGroup[selectedIndex];

      const activeWindow = parseJson(
        yield* executor.run("hyprctl", ["-j", "activewindow"]),
        "hyprctl activewindow",
      );
      const decodedActiveWindow =
        Schema.decodeUnknownOption(ActiveWindowSchema)(activeWindow);
      const restoreAddress =
        decodedActiveWindow._tag === "Some" &&
        decodedActiveWindow.value.workspace.id === active.id
          ? decodedActiveWindow.value.address
          : undefined;
      const originalTree = captureLayoutTree(clients);
      const selectedAddresses = assignLayoutWindows(selected.tree, clients);
      const originalAddresses = assignLayoutWindows(originalTree, clients);
      const applyBatch = buildLayoutBatch(
        selected.tree,
        selectedAddresses,
        active.id,
        temporaryWorkspace,
        restoreAddress,
      );
      const rollbackBatch = buildLayoutBatch(
        originalTree,
        originalAddresses,
        active.id,
        temporaryWorkspace,
        restoreAddress,
      );

      const applied = yield* executor
        .run("hyprctl", ["--batch", applyBatch])
        .pipe(
          Effect.as(true),
          Effect.orElseSucceed(() => false),
        );
      if (!applied) {
        const rolledBack = yield* executor
          .run("hyprctl", ["--batch", rollbackBatch])
          .pipe(
            Effect.as(true),
            Effect.orElseSucceed(() => false),
          );
        if (!rolledBack) {
          const restoreOnly = selectedAddresses
            .map((address) => moveCommand(active.id, address))
            .join(" ; ");
          yield* executor
            .run("hyprctl", ["--batch", restoreOnly])
            .pipe(Effect.ignore);
        }
        return fail(
          rolledBack
            ? "Could not apply layout; restored the previous layout"
            : "Could not apply layout; rollback also failed",
        );
      }

      let verified = false;
      for (let attempt = 0; attempt < VERIFY_ATTEMPTS; attempt += 1) {
        const current = decodeClients(
          parseJson(
            yield* executor.run("hyprctl", ["-j", "clients"]),
            "hyprctl clients",
          ),
        );
        verified = selectedAddresses.every((address) =>
          current.some(
            (client) =>
              client.address === address && client.workspace.id === active.id,
          ),
        );
        if (verified) break;
        yield* Effect.sleep(VERIFY_INTERVAL);
      }
      if (!verified) {
        yield* executor
          .run("hyprctl", ["--batch", rollbackBatch])
          .pipe(Effect.ignore);
        return fail(
          "Layout verification timed out; restored the previous layout",
        );
      }
      yield* notify(title, `Applied ${describeLayoutTree(selected.tree)}`);
    });

    const lock = yield* Effect.try({
      try: () =>
        acquireWorkspaceMutationLock(
          (message) => new WorkspaceRelayoutError({ message }),
        ),
      catch: (error) =>
        error instanceof WorkspaceRelayoutError
          ? error
          : new WorkspaceRelayoutError({ message: String(error) }),
    });
    yield* run.pipe(
      Effect.catchCause((cause) =>
        notify(title, String(Cause.squash(cause))).pipe(
          Effect.flatMap(() => Effect.failCause(cause)),
        ),
      ),
      Effect.ensuring(Effect.sync(() => releaseWorkspaceMutationLock(lock))),
    );
  },
);
