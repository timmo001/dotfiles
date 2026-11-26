/**
 * @file The macro pad in the public dotfiles' macropad folder: read its
 * layout, program the pad from it with the vendored wonkey, and draw the
 * layout as an SVG and PNG for its README.
 */

import { join } from "node:path";
import { Console, Effect, FileSystem, Schema } from "effect";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { Config } from "../services/Config.js";

/** The layout couldn't be read, or the pad or a drawing tool failed. */
export class MacropadError extends Schema.TaggedError<MacropadError>()(
  "MacropadError",
  { message: Schema.String },
) {}

/** One programmable action: the wonkey command and value that set it, and what it does. */
const Action = Schema.Struct({
  send: Schema.Tuple([
    Schema.Literals(["key", "media", "mouse"]),
    Schema.NonEmptyString,
  ]),
  label: Schema.NonEmptyString,
});

type Action = typeof Action.Type;

/** A knob's three actions, in the order wonkey names them. */
const turns = ["left", "press", "right"] as const;

const Knob = Schema.Struct({
  name: Schema.NonEmptyString,
  size: Schema.Literals(["small", "medium", "large"]),
  left: Action,
  press: Action,
  right: Action,
});

type Knob = typeof Knob.Type;

/** The pad: its keys in reading order and its knobs in wonkey's order. */
const Layout = Schema.Struct({
  device: Schema.NonEmptyString,
  columns: Schema.Int.check(Schema.isGreaterThan(0)),
  keys: Schema.Array(Action).check(Schema.isMaxLength(12)),
  knobs: Schema.Array(Knob).check(Schema.isMaxLength(4)),
});

type Layout = typeof Layout.Type;

/** The macro pad folder in the public dotfiles. */
const macropadDir = Effect.gen(function* () {
  const config = yield* Config;

  return join(config.publicDotfiles, "macropad");
}).pipe(Effect.withSpan("Macropad.dir"));

/** Read and check layout.yaml. */
const readLayout = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const path = join(yield* macropadDir, "layout.yaml");

  return yield* fs.readFileString(path).pipe(
    Effect.flatMap((text) => Effect.try(() => Bun.YAML.parse(text))),
    Effect.flatMap((parsed) =>
      Schema.decodeUnknownEffect(Layout)(parsed, {
        onExcessProperty: "error",
      }),
    ),
    Effect.mapError(
      (error) => new MacropadError({ message: `${path}: ${error.message}` }),
    ),
  );
}).pipe(Effect.withSpan("Macropad.readLayout"));

/** Run wonkey with the terminal, failing when it does. */
const wonkey = Effect.fn("Macropad.wonkey")(function* (
  args: readonly string[],
) {
  const executor = yield* CommandExecutor;
  const code = yield* executor.inherit("wonkey", args);

  if (code !== 0)
    return yield* new MacropadError({
      message: `wonkey ${args.join(" ")} exited ${code}; build it with mise run macropad:build`,
    });
});

/** Show what the pad holds now. */
export const macropadRead = wonkey([]).pipe(Effect.withSpan("Macropad.read"));

/** Program every key and knob action from layout.yaml, one at a time. */
export const macropadApply = Effect.gen(function* () {
  const layout = yield* readLayout;

  const controls = [
    ...layout.keys.map((key, index) => [`key${index + 1}`, key] as const),
    ...layout.knobs.flatMap((knob, index) =>
      turns.map((turn) => [`knob${index + 1}-${turn}`, knob[turn]] as const),
    ),
  ];

  for (const [control, { send }] of controls) {
    yield* Console.log(`\n${control}: wonkey ${send[0]} ${send[1]}`);
    yield* wonkey([send[0], control, send[1]]);
  }
}).pipe(Effect.withSpan("Macropad.apply"));

const pitch = 100;
const keySize = 88;
const margin = 30;
const canvasPad = 40;
const bodyWidth = 700;
const bodyHeight = 360;
const lobeLeft = 440;
const lobeBottom = 560;
const legendX = bodyWidth + 60;

/**
 * The body: the key block, with the knob column on the right running down
 * into a rounded lobe for the big knob.
 */
const body = [
  "M 24,0 H 676 A 24,24 0 0 1 700,24",
  `V ${lobeBottom - 120} A 120,120 0 0 1 580,${lobeBottom} H 560 A 120,120 0 0 1 ${lobeLeft},${lobeBottom - 120}`,
  `V ${bodyHeight + 30} A 30,30 0 0 0 ${lobeLeft - 30},${bodyHeight}`,
  "H 24 A 24,24 0 0 1 0,336 V 24 A 24,24 0 0 1 24,0 Z",
].join(" ");

/** Knob centres in layout order: small top left, small top right, medium, big. */
const knobPlaces = [
  { x: 510, y: 80 },
  { x: 630, y: 80 },
  { x: 570, y: 215 },
  { x: 570, y: 440 },
];

const knobRadius = { small: 38, medium: 52, large: 86 } as const;

const symbols = { left: "⟲", press: "●", right: "⟳" } as const;

const escapeXml = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

/** What an action sends, as a key name (F13, Ctrl+F13) or wonkey's value. */
const sendName = ({ send: [command, value] }: Action) =>
  command === "key"
    ? value.replace(/\bf(\d+)/gi, "F$1").replace(/ctrl\+/i, "Ctrl+")
    : value;

const keySvg = (key: Action, index: number, columns: number) => {
  const x = margin + (index % columns) * pitch;
  const y = margin + Math.floor(index / columns) * pitch;
  const words = key.label.split(" ");

  const lines =
    words.length > 1
      ? [words.slice(0, -1).join(" "), words.at(-1) ?? ""]
      : words;

  const first = y + 44 - (lines.length - 1) * 9;

  return [
    `<rect class="key" x="${x}" y="${y}" width="${keySize}" height="${keySize}" rx="10"/>`,
    ...lines.map(
      (line, n) =>
        `<text class="label" x="${x + keySize / 2}" y="${first + n * 18}">${escapeXml(line)}</text>`,
    ),
    `<text class="send" x="${x + keySize / 2}" y="${y + keySize - 10}">${escapeXml(sendName(key))}</text>`,
  ];
};

const knobSvg = (knob: Knob, index: number) => {
  const place = knobPlaces[index] ?? { x: 570, y: 80 + index * 120 };
  const radius = knobRadius[knob.size];

  return [
    `<circle class="knob" cx="${place.x}" cy="${place.y}" r="${radius}"/>`,
    `<circle class="cap" cx="${place.x}" cy="${place.y}" r="${radius * 0.72}"/>`,
    `<text class="number" x="${place.x}" y="${place.y + 9}">${index + 1}</text>`,
  ];
};

const legendSvg = (knob: Knob, index: number) => {
  const y = 40 + index * 130;

  return [
    `<circle class="badge" cx="${legendX + 16}" cy="${y + 16}" r="16"/>`,
    `<text class="badge-number" x="${legendX + 16}" y="${y + 22}">${index + 1}</text>`,
    `<text class="heading" x="${legendX + 44}" y="${y + 23}">${escapeXml(knob.name)}</text>`,
    ...turns.map(
      (turn, n) =>
        `<text class="step" x="${legendX + 44}" y="${y + 52 + n * 24}">${symbols[turn]}` +
        `<tspan dx="8">${escapeXml(knob[turn].label)}</tspan>` +
        `<tspan class="send-inline" dx="8">${escapeXml(sendName(knob[turn]))}</tspan></text>`,
    ),
  ];
};

/** The layout as an SVG of the pad, keys labelled, with a legend for the knobs. */
const layoutSvg = (layout: Layout) => {
  const width = legendX + 260 + canvasPad * 2;
  const height = lobeBottom + canvasPad * 2;

  const elements = [
    ...layout.keys.flatMap((key, index) => keySvg(key, index, layout.columns)),
    ...layout.knobs.flatMap(knobSvg),
    ...layout.knobs.flatMap(legendSvg),
  ];

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="${width}" height="${height}">
  <title>Macro pad layout</title>
  <style>
    text { font-family: "Inter", "Helvetica Neue", Arial, sans-serif; }
    .background { fill: #16161e; }
    .body { fill: #2a2b36; stroke: #4fd6be; stroke-width: 3; }
    .key { fill: #101014; stroke: #3b3d4a; stroke-width: 2; }
    .label { fill: #e6e7ef; font-size: 15px; font-weight: 600; text-anchor: middle; }
    .send { fill: #7f849c; font-size: 12px; text-anchor: middle; }
    .knob { fill: #0c0c10; stroke: #5a5d6e; stroke-width: 3; }
    .cap { fill: #3a3c48; }
    .number { fill: #e6e7ef; font-size: 26px; font-weight: 700; text-anchor: middle; }
    .badge { fill: #4fd6be; }
    .badge-number { fill: #16161e; font-size: 17px; font-weight: 700; text-anchor: middle; }
    .heading { fill: #e6e7ef; font-size: 20px; font-weight: 700; }
    .step { fill: #c0c3d4; font-size: 16px; }
    .send-inline { fill: #7f849c; font-size: 12px; }
  </style>
  <rect class="background" width="${width}" height="${height}" rx="24"/>
  <g transform="translate(${canvasPad},${canvasPad})">
    <path class="body" d="${body}"/>
    ${elements.join("\n    ")}
  </g>
</svg>
`;
};

/** Draw layout.svg from layout.yaml, and layout.png from it with rsvg-convert. */
export const macropadRender = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const executor = yield* CommandExecutor;
  const dir = yield* macropadDir;
  const svg = join(dir, "layout.svg");
  const png = join(dir, "layout.png");

  yield* fs.writeFileString(svg, layoutSvg(yield* readLayout));
  yield* executor
    .run("rsvg-convert", ["--zoom", "2", "--output", png, svg])
    .pipe(
      Effect.mapError(
        (error) =>
          new MacropadError({
            message: `rsvg-convert failed: ${error.stderr}`,
          }),
      ),
    );
  yield* Console.log(`[INFO] Drew ${svg} and ${png}`);
}).pipe(Effect.withSpan("Macropad.render"));
