import { Effect } from "effect";
import { CommandExecutor } from "../services/CommandExecutor.js";
import { OutputLog } from "../services/OutputLog.js";
import { runElevated } from "./elevatedCommand.js";

/**
 * Locales the stowed shell config exports and therefore requires.
 *
 * `zsh/.zshrc` exports `LANG`/`LC_ALL`/`LANGUAGE=en_GB.UTF-8`, so every shell
 * the dotfiles spawn warns unless this locale is generated on the machine.
 */
export const REQUIRED_LOCALES = ["en_GB.UTF-8"] as const;

/** Normalise a locale name for comparison against `locale -a` output. */
function normaliseLocale(locale: string): string {
  return locale.toLowerCase().replace("utf-8", "utf8");
}

/** The set of generated locales reported by `locale -a`, normalised. */
const generatedLocales: Effect.Effect<
  Set<string>,
  never,
  CommandExecutor
> = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const output = yield* executor
    .run("locale", ["-a"])
    .pipe(Effect.catch(() => Effect.succeed("")));

  const generated = new Set<string>();
  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (trimmed) generated.add(normaliseLocale(trimmed));
  }
  return generated;
});

/** Required locales that are not currently generated on this machine. */
export const missingLocales: Effect.Effect<string[], never, CommandExecutor> =
  Effect.gen(function* () {
    const generated = yield* generatedLocales;
    return REQUIRED_LOCALES.filter(
      (locale) => !generated.has(normaliseLocale(locale)),
    );
  });

/** Build a sed expression that uncomments a locale's line in /etc/locale.gen. */
export function uncommentLocaleExpr(locale: string): string {
  const escaped = locale.replace(/\\/g, "\\\\").replace(/[.]/g, "\\.");
  return `sed -i '/^#[[:space:]]*${escaped}[[:space:]]/s/^#[[:space:]]*//' /etc/locale.gen`;
}

/**
 * Ensure every {@link REQUIRED_LOCALES} entry is generated.
 *
 * Uncomments the missing locales in `/etc/locale.gen` and runs `locale-gen`,
 * escalating through pkexec/sudo. A no-op when all required locales already
 * exist, so it is safe to run on every init.
 */
export const ensureLocalesGenerated: Effect.Effect<
  void,
  never,
  CommandExecutor | OutputLog
> = Effect.gen(function* () {
  const log = yield* OutputLog;
  yield* log.section("Locale");

  const missing = yield* missingLocales;
  if (missing.length === 0) {
    yield* log.info("Required locales already generated");
    return;
  }

  yield* log.info(`Generating missing locale(s): ${missing.join(", ")}`);
  const script = `${missing.map(uncommentLocaleExpr).join(" && ")} && locale-gen`;
  const exit = yield* runElevated("bash", ["-c", script]);
  if (exit === 0) {
    yield* log.info("Locale generation complete");
  } else {
    yield* log.warn(
      `locale-gen failed (exit ${exit}); generate manually with: sudo locale-gen`,
    );
  }
});
