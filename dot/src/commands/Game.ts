import { basename, join } from "node:path";
import {
  Deferred,
  Duration,
  Effect,
  FileSystem,
  Option,
  Schedule,
  Schema,
} from "effect";
import { ENV, envString } from "../lib/env.js";
import { CONFIG_DIR, DATA_DIR, HOME_DIR } from "../lib/paths.js";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { ProcessRunner } from "../services/ProcessRunner.js";
import { hdr, hdrEnabled } from "./Hdr.js";

/** A game launch could not go ahead. */
export class GameError extends Schema.TaggedError<GameError>()("GameError", {
  message: Schema.String,
}) {}

/**
 * Who is keeping gaming mode on: the PIDs of `dot game run` and `dot game
 * launch` processes, and 0 for a manual `dot game on`.
 */
const GameState = Schema.Struct({
  holders: Schema.Array(Schema.Int),
  stopped: Schema.Array(Schema.String),
  hdr: Schema.Boolean,
});

/** Gaming mode's state: its holders, the units it stopped, and whether it turned HDR on. */
export interface GameState extends Schema.Schema.Type<typeof GameState> {}

const GamingList = Schema.Struct({
  stop: Schema.Array(
    Schema.String.check(Schema.isPattern(/^[\w@.:-]+\.service$/)),
  ),
});

const decodeGameState = Schema.decodeUnknownOption(
  Schema.fromJsonString(GameState),
);

const decodeGamingList = Schema.decodeUnknownEffect(GamingList);

const decodeJsonFile = Schema.decodeUnknownOption(
  Schema.fromJsonString(Schema.JsonObject),
);

const decodeJsonObject = Schema.decodeUnknownOption(Schema.JsonObject);

/** Holder recorded for a manual `dot game on`, which only `dot game off` clears. */
const MANUAL_HOLDER = 0;

/** How long stopped units get to exit before the game starts anyway. */
const STOP_WAIT = Duration.seconds(15);

/** How long a Steam game gets to start after its launch is requested. */
const STEAM_START_WAIT = Duration.minutes(10);

const POLL = Duration.seconds(2);

/** Grace period before a game that ignores SIGTERM is killed. */
const KILL_AFTER = 10_000;

const APPLICATIONS_DIR = join(DATA_DIR, "applications");
const HEROIC_DIR = join(CONFIG_DIR, "heroic");
const DOT_BIN = join(HOME_DIR, ".local", "bin", "dot");
const GAME_RUN_BIN = join(HOME_DIR, ".local", "bin", "game-run");

/** The URL a game desktop file launches with, kept once dot has wrapped it. */
const URL_KEY = "X-Dot-Game-Url";

const GAME_URL =
  /(steam:\/\/rungameid\/\d+|heroic:\/\/launch\?[^\s"']+|lutris:rungameid\/\d+)/;

function stateFile(): string {
  const runtimeDir =
    envString(ENV.XDG_RUNTIME_DIR) ?? `/run/user/${process.getuid?.() ?? 1000}`;

  return join(runtimeDir, "dot-game.json");
}

const emptyState: GameState = { holders: [], stopped: [], hdr: false };

/** Read gaming mode's state; an absent or unreadable file means it's off. */
export const readGameState = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  const text = yield* fs
    .readFileString(stateFile())
    .pipe(Effect.orElseSucceed(() => ""));

  return Option.getOrElse(decodeGameState(text), () => emptyState);
}).pipe(Effect.withSpan("Game.readState"));

const writeState = Effect.fn("Game.writeState")(function* (state: GameState) {
  const fs = yield* FileSystem.FileSystem;
  const file = stateFile();

  if (state.holders.length === 0) {
    yield* fs.remove(file, { force: true });

    return;
  }

  yield* fs.writeFileString(`${file}.tmp`, JSON.stringify(state));
  yield* fs.rename(`${file}.tmp`, file);
});

/** The units in ~/.config/dot/gaming.yml; no file means none. */
const readGamingUnits = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const file = join(CONFIG_DIR, "dot", "gaming.yml");

  if (!(yield* fs.exists(file))) return [];

  const list = yield* fs.readFileString(file).pipe(
    Effect.flatMap((text) => Effect.try(() => Bun.YAML.parse(text))),
    Effect.flatMap(decodeGamingList),
  );

  return list.stop;
}).pipe(Effect.withSpan("Game.readGamingUnits"));

const isAlive = (pid: number) =>
  pid === MANUAL_HOLDER
    ? Effect.succeed(true)
    : FileSystem.FileSystem.pipe(
        Effect.flatMap((fs) => fs.exists(`/proc/${pid}`)),
        Effect.orElseSucceed(() => false),
      );

const liveHolders = Effect.fn("Game.liveHolders")(function* (
  holders: readonly number[],
) {
  return yield* Effect.filter(holders, isAlive);
});

const isActive = (unit: string) =>
  CommandExecutor.pipe(
    Effect.flatMap((executor) =>
      executor.exitCode("systemctl", ["--user", "is-active", "--quiet", unit]),
    ),
    Effect.map((code) => code === 0),
  );

const notify = Effect.fn("Game.notify")(function* (
  title: string,
  message: string,
) {
  const executor = yield* CommandExecutor;

  yield* executor.exitCode("omarchy", [
    "notification",
    "send",
    "-g",
    "󰊴",
    "--app-name",
    "Gaming",
    title,
    message,
  ]);
});

const plural = (count: number, word: string) =>
  `${count} ${word}${count === 1 ? "" : "s"}`;

/** Stop the listed units that are running, then wait a bounded time for them to exit. */
const stopUnits = Effect.fn("Game.stopUnits")(function* () {
  const executor = yield* CommandExecutor;
  const units = yield* readGamingUnits;
  const active = yield* Effect.filter(units, isActive);

  if (active.length === 0) return active;

  // --no-block so a worker finishing its shutdown never holds up the game.
  yield* executor.run("systemctl", [
    "--user",
    "stop",
    "--no-block",
    "--",
    ...active,
  ]);

  const stillActive = Effect.filter(active, isActive);

  yield* stillActive.pipe(
    Effect.repeat({
      while: (running) => running.length > 0,
      schedule: Schedule.spaced(Duration.millis(500)),
    }),
    Effect.timeoutOption(STOP_WAIT),
  );

  return active;
});

/** Start gaming mode for `pid`, or join it when it's already on. */
const enter = Effect.fn("Game.enter")(function* (
  pid: number,
  options: { readonly sdr: boolean },
) {
  const state = yield* readGameState;
  const holders = yield* liveHolders(state.holders);

  if (holders.length > 0) {
    yield* writeState({
      ...state,
      holders: holders.includes(pid) ? holders : [...holders, pid],
    });

    return;
  }

  // A previous run whose holders all died left these stopped; keep them on
  // the list so they're still started again at the end.
  const stopped = new Set([...state.stopped, ...(yield* stopUnits())]);

  const turnOnHdr =
    !options.sdr && !(yield* hdrEnabled.pipe(Effect.orElseSucceed(() => true)));

  if (turnOnHdr) yield* hdr("on");

  yield* writeState({
    holders: [pid],
    stopped: [...stopped],
    hdr: turnOnHdr || state.hdr,
  });

  yield* notify(
    "Gaming mode on",
    stopped.size === 0
      ? "Nothing needed pausing."
      : `Paused ${plural(stopped.size, "service")}.`,
  );
});

/** Put back what gaming mode changed and clear its state. */
const restore = Effect.fn("Game.restore")(function* (state: GameState) {
  const executor = yield* CommandExecutor;

  yield* writeState(emptyState);

  if (state.stopped.length > 0)
    yield* executor.run("systemctl", [
      "--user",
      "start",
      "--no-block",
      "--",
      ...state.stopped,
    ]);

  if (state.hdr) yield* hdr("off");

  yield* notify(
    "Gaming mode off",
    state.stopped.length === 0
      ? "Nothing to restart."
      : `Restarted ${plural(state.stopped.length, "service")}.`,
  );
});

/** Release `pid`'s hold, ending gaming mode when nothing else holds it. */
const leave = Effect.fn("Game.leave")(function* (pid: number) {
  const state = yield* readGameState;

  const holders = (yield* liveHolders(state.holders)).filter(
    (holder) => holder !== pid,
  );

  if (holders.length > 0) {
    yield* writeState({ ...state, holders });

    return;
  }

  if (state.holders.length > 0 || state.stopped.length > 0)
    yield* restore(state);
});

/** Turn gaming mode on until `dot game off`. */
export const gameOn = Effect.fn("Game.on")(function* (options: {
  readonly sdr: boolean;
}) {
  yield* enter(MANUAL_HOLDER, options);
});

/** Turn gaming mode off now, whatever is holding it, and put everything back. */
export const gameOff = Effect.gen(function* () {
  const state = yield* readGameState;

  if (state.holders.length === 0 && state.stopped.length === 0) {
    yield* Effect.sync(() => process.stdout.write("Gaming mode is off.\n"));

    return;
  }

  yield* restore(state);
}).pipe(Effect.withSpan("Game.off"));

/** Run a game's command in gaming mode, exiting with its exit code. */
export const gameRun = Effect.fn("Game.run")(function* (
  command: string,
  args: readonly string[],
  options: { readonly sdr: boolean },
) {
  const runner = yield* ProcessRunner;

  process.exitCode = yield* Effect.acquireUseRelease(
    enter(process.pid, options),
    () =>
      runner.run(command, args, { killAfter: KILL_AFTER }).pipe(
        Effect.catchTag("ProcessRunError", (error) =>
          Effect.sync(() => {
            console.error(`dot game run: ${error.message}`);

            return 125;
          }),
        ),
      ),
    () => leave(process.pid).pipe(Effect.ignore),
  );
});

/** Every process's argv, skipping ones that exit while being read. */
const processArgs = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  const entries = yield* fs.readDirectory("/proc");
  const pids = entries.filter((entry) => /^\d+$/.test(entry));

  return yield* Effect.forEach(pids, (pid) =>
    fs.readFileString(`/proc/${pid}/cmdline`).pipe(
      Effect.map((text) => text.split("\0")),
      Effect.orElseSucceed((): string[] => []),
    ),
  );
}).pipe(Effect.withSpan("Game.processArgs"));

/** Whether Steam's reaper for `appId` is running, which it is for as long as the game is. */
const steamGameRunning = (appId: string) =>
  processArgs.pipe(
    Effect.map((all) =>
      all.some(
        (argv) =>
          argv.includes("SteamLaunch") && argv.includes(`AppId=${appId}`),
      ),
    ),
  );

/** Resolves when dot is asked to stop, so gaming mode can still be left. */
const untilSignalled = Effect.gen(function* () {
  const signalled = yield* Deferred.make<void>();
  const done = () => Deferred.doneUnsafe(signalled, Effect.void);

  yield* Effect.acquireRelease(
    Effect.sync(() => {
      process.once("SIGINT", done);
      process.once("SIGTERM", done);
      process.once("SIGHUP", done);
    }),
    () =>
      Effect.sync(() => {
        process.off("SIGINT", done);
        process.off("SIGTERM", done);
        process.off("SIGHUP", done);
      }),
  );

  yield* Deferred.await(signalled);
});

const waitForSteamGame = Effect.fn("Game.waitForSteamGame")(function* (
  appId: string,
) {
  const poll = steamGameRunning(appId);

  const started = yield* poll.pipe(
    Effect.repeat({
      until: (running) => running,
      schedule: Schedule.spaced(POLL),
    }),
    Effect.timeoutOption(STEAM_START_WAIT),
  );

  if (Option.isNone(started)) {
    yield* Effect.sync(() =>
      console.error(
        `dot game launch: Steam app ${appId} didn't start within ${Duration.format(STEAM_START_WAIT)}`,
      ),
    );

    return;
  }

  yield* poll.pipe(
    Effect.repeat({
      while: (running) => running,
      schedule: Schedule.spaced(POLL),
    }),
  );
});

/** Launch a game by its store URL in gaming mode, holding it until the game exits. */
export const gameLaunch = Effect.fn("Game.launch")(function* (
  url: string,
  options: { readonly sdr: boolean },
) {
  const executor = yield* CommandExecutor;
  const steam = /^steam:\/\/rungameid\/(\d+)$/.exec(url);

  // Heroic runs every game through game-run (dot game sync), which holds
  // gaming mode itself.
  if (url.startsWith("heroic://")) {
    yield* executor.run("xdg-open", [url]);

    return;
  }

  if (url.startsWith("lutris:")) {
    yield* gameRun("env", ["LUTRIS_SKIP_INIT=1", "lutris", url], options);

    return;
  }

  if (!steam)
    return yield* new GameError({
      message: `Not a game URL dot can launch: ${url}`,
    });

  const appId = steam[1];

  yield* Effect.acquireUseRelease(
    enter(process.pid, options),
    () =>
      executor
        .run("xdg-open", [url])
        .pipe(
          Effect.andThen(
            Effect.raceFirst(
              waitForSteamGame(appId),
              Effect.scoped(untilSignalled),
            ),
          ),
        ),
    () => leave(process.pid).pipe(Effect.ignore),
  );
});

/** One game shortcut in ~/.local/share/applications. */
export interface GameEntry {
  /** The name shown in launchers. */
  readonly name: string;
  /** Icon name or path from the desktop file. */
  readonly icon: string;
  /** Store URL the game launches with. */
  readonly url: string;
  /** Which launcher owns the game. */
  readonly store: "steam" | "heroic" | "lutris";
  /** The desktop file's path. */
  readonly desktopFile: string;
}

const desktopValue = (lines: readonly string[], key: string) =>
  lines
    .find((line) => line.startsWith(`${key}=`))
    ?.slice(key.length + 1)
    .trim();

/** The lines of a desktop file's [Desktop Entry] group, and where it ends. */
function entryGroup(lines: readonly string[]) {
  const start = lines.findIndex((line) => line.trim() === "[Desktop Entry]");

  if (start === -1) return undefined;

  const next = lines.findIndex(
    (line, index) => index > start && /^\[.+\]\s*$/.test(line),
  );

  return { start, end: next === -1 ? lines.length : next };
}

function gameUrl(lines: readonly string[]): string | undefined {
  return (
    desktopValue(lines, URL_KEY) ??
    GAME_URL.exec(desktopValue(lines, "Exec") ?? "")?.[1]
  );
}

const storeOf = (url: string): GameEntry["store"] =>
  url.startsWith("steam:")
    ? "steam"
    : url.startsWith("heroic:")
      ? "heroic"
      : "lutris";

/** The game shortcuts Steam, Heroic and Lutris wrote, with their contents. */
const readGameFiles = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;

  if (!(yield* fs.exists(APPLICATIONS_DIR))) return [];

  const names = (yield* fs.readDirectory(APPLICATIONS_DIR))
    .filter((name) => name.endsWith(".desktop"))
    .sort();

  const files = yield* Effect.forEach(names, (name) => {
    const path = join(APPLICATIONS_DIR, name);

    return Effect.all({
      text: fs.readFileString(path),
      info: fs.stat(path),
    }).pipe(
      Effect.map(({ text, info }) => ({
        path,
        text,
        modified: Option.match(info.mtime, {
          onNone: () => 0,
          onSome: (date) => date.getTime(),
        }),
      })),
      Effect.option,
    );
  });

  return files.flatMap((file) => {
    if (Option.isNone(file)) return [];

    const lines = file.value.text.split("\n");
    const group = entryGroup(lines);

    if (!group) return [];

    const entry = lines.slice(group.start, group.end);
    const url = gameUrl(entry);

    return url ? [{ ...file.value, lines, group, entry, url }] : [];
  });
}).pipe(Effect.withSpan("Game.readGameFiles"));

/** List the game shortcuts and whether gaming mode is on. */
export const gameList = Effect.fn("Game.list")(function* (options: {
  readonly json: boolean;
}) {
  const files = yield* readGameFiles;
  const state = yield* readGameState;
  const holders = yield* liveHolders(state.holders);

  // Launchers leave the old shortcut behind when a game is renamed, so keep
  // only the newest shortcut for each URL.
  const newest = new Map<string, (typeof files)[number]>();

  for (const file of files) {
    const kept = newest.get(file.url);

    if (!kept || file.modified > kept.modified) newest.set(file.url, file);
  }

  const games: GameEntry[] = [...newest.values()].map((file) => ({
    name: desktopValue(file.entry, "Name") ?? basename(file.path, ".desktop"),
    icon: desktopValue(file.entry, "Icon") ?? "",
    url: file.url,
    store: storeOf(file.url),
    desktopFile: file.path,
  }));

  yield* Effect.sync(() => {
    if (options.json) {
      process.stdout.write(
        `${JSON.stringify({ active: holders.length > 0, holders: holders.length, games })}\n`,
      );

      return;
    }

    process.stdout.write(
      `Gaming mode is ${holders.length > 0 ? "on" : "off"}.\n`,
    );

    for (const game of games)
      process.stdout.write(
        `${game.store.padEnd(7)} ${game.name}  ${game.url}\n`,
      );
  });
});

/** Point a game desktop file at `dot game launch`, returning its new text. */
function wrapDesktopFile(file: {
  readonly lines: readonly string[];
  readonly group: { readonly start: number; readonly end: number };
  readonly url: string;
}): string {
  const exec = `Exec=${DOT_BIN} game launch "${file.url}"`;

  const inGroup = (index: number) =>
    index > file.group.start && index < file.group.end;

  return file.lines
    .flatMap((line, index) => {
      if (!inGroup(index)) return [line];

      if (line.startsWith(`${URL_KEY}=`)) return [];

      return line.startsWith("Exec=")
        ? [exec, `${URL_KEY}=${file.url}`]
        : [line];
    })
    .join("\n");
}

/** The launch scripts a Heroic game runs, which game-run replaces when they switch HDR. */
const HeroicScripts = Schema.Struct({
  beforeLaunchScriptPath: Schema.optionalKey(Schema.String),
  afterLaunchScriptPath: Schema.optionalKey(Schema.String),
});

const decodeHeroicScripts = Schema.decodeUnknownOption(HeroicScripts);

const isHdrScript = (path: string | undefined, name: "hdr-on" | "hdr-off") =>
  path !== undefined && basename(path) === name;

/** Run games in `settings` through game-run instead of the HDR scripts. */
function wrapHeroicSettings(settings: Schema.JsonObject): Schema.JsonObject {
  const scripts = Option.getOrElse(decodeHeroicScripts(settings), () => ({
    beforeLaunchScriptPath: undefined,
    afterLaunchScriptPath: undefined,
  }));

  const cleared = (name: string) =>
    (name === "beforeLaunchScriptPath" &&
      isHdrScript(scripts.beforeLaunchScriptPath, "hdr-on")) ||
    (name === "afterLaunchScriptPath" &&
      isHdrScript(scripts.afterLaunchScriptPath, "hdr-off"));

  const wrapperOptions: Schema.Json = [{ exe: GAME_RUN_BIN, args: "" }];

  return Object.fromEntries([
    ...Object.entries(settings).map(([name, value]): [string, Schema.Json] => [
      name,
      cleared(name) ? "" : value,
    ]),
    ["wrapperOptions", wrapperOptions],
  ]);
}

/** Rewrite one Heroic JSON file's settings under `key`, when they need it. */
const syncHeroicFile = Effect.fn("Game.syncHeroicFile")(function* (
  path: string,
  key: string,
) {
  const fs = yield* FileSystem.FileSystem;
  const text = yield* fs.readFileString(path);
  const config = decodeJsonFile(text);

  if (Option.isNone(config)) return false;

  const settings = decodeJsonObject(config.value[key]);

  if (Option.isNone(settings)) return false;

  const next = { ...config.value, [key]: wrapHeroicSettings(settings.value) };

  // Compared as data, so Heroic's own formatting is left alone when nothing changes.
  if (JSON.stringify(next) === JSON.stringify(config.value)) return false;

  yield* fs.writeFileString(
    `${path}.tmp`,
    `${JSON.stringify(next, null, 2)}\n`,
  );
  yield* fs.rename(`${path}.tmp`, path);

  return true;
});

/** Wrap every game shortcut and Heroic game so they launch in gaming mode. */
export const gameSync = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem;
  let changed = 0;

  for (const file of yield* readGameFiles) {
    const text = wrapDesktopFile(file);

    if (text === file.text) continue;

    yield* fs.writeFileString(`${file.path}.tmp`, text);
    yield* fs.rename(`${file.path}.tmp`, file.path);

    // Keep the launcher's timestamp, which dot game list uses to tell a
    // renamed game's shortcut from the stale one left behind.
    if (file.modified > 0) {
      const modified = new Date(file.modified);

      yield* fs.utimes(file.path, modified, modified);
    }

    changed++;
  }

  const heroicConfig = join(HEROIC_DIR, "config.json");

  if (yield* fs.exists(heroicConfig))
    if (yield* syncHeroicFile(heroicConfig, "defaultSettings")) changed++;

  const gamesDir = join(HEROIC_DIR, "GamesConfig");

  if (yield* fs.exists(gamesDir))
    for (const name of yield* fs.readDirectory(gamesDir)) {
      if (!name.endsWith(".json") || name === "default.json") continue;

      if (yield* syncHeroicFile(join(gamesDir, name), basename(name, ".json")))
        changed++;
    }

  yield* Effect.sync(() =>
    process.stdout.write(
      changed === 0
        ? "Every game already launches in gaming mode.\n"
        : `Wrapped ${plural(changed, "file")}.\n`,
    ),
  );
}).pipe(Effect.withSpan("Game.sync"));
