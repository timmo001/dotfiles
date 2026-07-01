import { Effect } from "effect";
import { existsSync, readFileSync } from "fs";
import { join } from "path";
import { Config } from "../../services/Config.js";
import { displayPath } from "../../lib/paths.js";
import type { CheckResult } from "../types.js";

/** Match a `bindkey "^[[3~" delete-char` line (any inner whitespace). */
const LITERAL_DELETE = /bindkey\s+"\^\[\[3~"\s+delete-char/;
/** Match a terminfo-backed `bindkey "${terminfo[kdch1]}" delete-char` line. */
const TERMINFO_DELETE = /terminfo\[kdch1\][^\n]*delete-char/;

/**
 * Verify the stowed zsh config still binds the Delete key.
 *
 * Removing oh-my-zsh dropped its `lib/key-bindings.zsh`, which bound
 * Delete/Home/End/Insert. Without a `^[[3~` -> `delete-char` binding, pressing
 * Delete self-inserts a literal `~`. This guards against that binding being
 * dropped again from `zsh/.zshrc`.
 */
export const checkZshKeybindings = Effect.gen(function* () {
  const config = yield* Config;
  const zshrc = join(config.publicDotfiles, "zsh", ".zshrc");

  if (!existsSync(zshrc)) {
    return [
      {
        severity: "warn",
        message: `Stowed zsh config not found: ${displayPath(zshrc)}`,
      },
    ] satisfies CheckResult[];
  }

  const content = readFileSync(zshrc, "utf-8");
  if (LITERAL_DELETE.test(content) || TERMINFO_DELETE.test(content)) {
    return [
      { severity: "ok", message: "Delete key binding present in zsh config" },
    ] satisfies CheckResult[];
  }

  return [
    {
      severity: "warn",
      message: "Delete key not bound in zsh config",
      detail: `Delete will insert a literal '~'. Add 'bindkey "^[[3~" delete-char' to ${displayPath(zshrc)}, then run dot stow.`,
    },
  ] satisfies CheckResult[];
});
