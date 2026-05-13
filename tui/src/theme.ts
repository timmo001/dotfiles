import { Effect } from "effect";
import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Semantic colour tokens for the TUI, derived from the active Omarchy theme */
export interface Theme {
  /** App background */
  readonly bg: string;
  /** Elevated surface (pane/card background) */
  readonly bgElevated: string;
  /** Focused input background */
  readonly bgInput: string;
  /** Accent colour for selections, highlights, cursors, and emphasis text */
  readonly accent: string;
  /** Contrasting text colour for content rendered on the accent background */
  readonly accentFg: string;
  /** Secondary surface (separators, secondary selection background) */
  readonly surface: string;
  /** Primary foreground text */
  readonly fg: string;
  /** Muted secondary text */
  readonly fgMuted: string;
  /** Dim text for subtle UI elements */
  readonly fgSubtle: string;
  /** Dimmest text for ghost-level elements */
  readonly fgGhost: string;
  /** Success state */
  readonly green: string;
  /** Error state */
  readonly red: string;
  /** Warning / in-progress state */
  readonly yellow: string;
  /** Whether panels should skip painting backgrounds to let terminal transparency through */
  readonly transparent: boolean;
}

/** Hardcoded GitHub Dark fallback when no Omarchy theme is available */
const FALLBACK: Theme = {
  bg: "#0d1117",
  bgElevated: "#161b22",
  bgInput: "#1c2129",
  accent: "#58a6ff",
  accentFg: "#ffffff",
  surface: "#30363d",
  fg: "#c9d1d9",
  fgMuted: "#8b949e",
  fgSubtle: "#484f58",
  fgGhost: "#6e7681",
  green: "#3fb950",
  red: "#f85149",
  yellow: "#d29922",
  transparent: false,
};

const COLORS_TOML_PATH = join(
  process.env.HOME ?? "~",
  ".config/omarchy/current/theme/colors.toml",
);

// --- Colour math helpers ---

type RGB = [r: number, g: number, b: number];

function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  return [
    parseInt(h.slice(0, 2), 16),
    parseInt(h.slice(2, 4), 16),
    parseInt(h.slice(4, 6), 16),
  ];
}

function rgbToHex([r, g, b]: RGB): string {
  const clamp = (n: number) => Math.max(0, Math.min(255, Math.round(n)));
  return `#${clamp(r).toString(16).padStart(2, "0")}${clamp(g).toString(16).padStart(2, "0")}${clamp(b).toString(16).padStart(2, "0")}`;
}

/** Linearly interpolate between two colours. t=0 returns `a`, t=1 returns `b`. */
function mix(a: string, b: string, t: number): string {
  const [ar, ag, ab] = hexToRgb(a);
  const [br, bg, bb] = hexToRgb(b);
  return rgbToHex([ar + (br - ar) * t, ag + (bg - ag) * t, ab + (bb - ab) * t]);
}

/** Relative luminance per WCAG 2.x (0 = black, 1 = white) */
function luminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map((c) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  }) as [number, number, number];
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

/** Pick whichever of `fg` or `bg` gives better contrast against `accent` */
function pickAccentFg(
  accent: string,
  fgColor: string,
  bgColor: string,
): string {
  const al = luminance(accent);
  const fl = luminance(fgColor);
  const bl = luminance(bgColor);

  const fgRatio = (Math.max(al, fl) + 0.05) / (Math.min(al, fl) + 0.05);
  const bgRatio = (Math.max(al, bl) + 0.05) / (Math.min(al, bl) + 0.05);

  return fgRatio >= bgRatio ? fgColor : bgColor;
}

// --- TOML parsing ---

/** Parse a flat `key = "value"` TOML file into a string map */
function parseColorsToml(content: string): Record<string, string> {
  const result: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || trimmed.startsWith("["))
      continue;
    const match = trimmed.match(/^(\w+)\s*=\s*"([^"]+)"/);
    if (match) result[match[1]] = match[2];
  }
  return result;
}

/** Derive a full {@link Theme} from raw `colors.toml` key-value pairs */
function deriveTheme(c: Record<string, string>): Theme {
  const bg = c.background ?? FALLBACK.bg;
  const fgColor = c.foreground ?? FALLBACK.fg;
  const accent = c.accent ?? FALLBACK.accent;

  return {
    bg,
    bgElevated: mix(bg, fgColor, 0.05),
    bgInput: mix(bg, fgColor, 0.08),
    accent,
    accentFg: pickAccentFg(accent, fgColor, bg),
    surface: mix(bg, fgColor, 0.19),
    fg: fgColor,
    fgMuted: mix(bg, fgColor, 0.67),
    fgSubtle: mix(bg, fgColor, 0.3),
    fgGhost: mix(bg, fgColor, 0.4),
    green: c.color2 ?? FALLBACK.green,
    red: c.color1 ?? FALLBACK.red,
    yellow: c.color3 ?? FALLBACK.yellow,
    transparent: true,
  };
}

// --- Theme loading ---

/**
 * Load the active Omarchy theme from `colors.toml` and derive semantic TUI tokens.
 *
 * Reads `~/.config/omarchy/current/theme/colors.toml` which is guaranteed to
 * exist after any `omarchy-theme-set` call (auto-generated from `alacritty.toml`
 * when the theme source lacks one).
 *
 * Falls back to the {@link FALLBACK} GitHub Dark palette when the file is
 * missing or unreadable (e.g. non-Omarchy systems).
 */
export const loadTheme: Effect.Effect<Theme> = Effect.gen(function* () {
  const raw = yield* Effect.try(() => readFileSync(COLORS_TOML_PATH, "utf-8"));
  return deriveTheme(parseColorsToml(raw));
}).pipe(Effect.orElseSucceed(() => FALLBACK));
