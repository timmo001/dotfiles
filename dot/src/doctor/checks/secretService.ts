import { Effect } from "effect";
import { existsSync, readFileSync } from "fs";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import type { CheckResult } from "../types.js";

const DBUS_SECRETS_SERVICE =
  "/usr/share/dbus-1/services/org.freedesktop.secrets.service";

const GNOME_KEYRING_UNITS = [
  "/usr/lib/systemd/user/gnome-keyring-daemon.service",
  "/usr/lib/systemd/user/gnome-keyring-daemon.socket",
  "/etc/systemd/user/gnome-keyring-daemon.service",
  "/etc/systemd/user/gnome-keyring-daemon.socket",
  "/etc/systemd/user/sockets.target.wants/gnome-keyring-daemon.socket",
] as const;

/** Check Secret Service provider is kwallet, not gnome-keyring */
export const checkSecretService = Effect.gen(function* () {
  const executor = yield* CommandExecutor;
  const results: CheckResult[] = [];

  // Check kwallet installed
  const kwalletExit = yield* executor.exitCode("pacman", ["-Q", "kwallet"]);
  if (kwalletExit === 0) {
    results.push({
      severity: "ok",
      message: "kwallet is installed and provides org.freedesktop.secrets",
    });
  } else {
    results.push({
      severity: "warn",
      message:
        "kwallet is missing; this setup expects kwallet to provide org.freedesktop.secrets",
    });
  }

  // Check gnome-keyring is not installed
  const gnomeKeyringExit = yield* executor.exitCode("pacman", [
    "-Q",
    "gnome-keyring",
  ]);
  if (gnomeKeyringExit === 0) {
    results.push({
      severity: "warn",
      message:
        "gnome-keyring is installed; expected kwallet to be the Secret Service provider on this setup",
    });
  }

  // Check for unexpected DBus autostart
  if (existsSync(DBUS_SECRETS_SERVICE)) {
    let exec = "";
    try {
      const content = readFileSync(DBUS_SECRETS_SERVICE, "utf-8");
      const match = content.match(/^Exec=(.+)$/m);
      if (match) exec = match[1];
    } catch {
      /* ignore */
    }
    results.push({
      severity: "warn",
      message: `Unexpected Secret Service DBus autostart exists: ${DBUS_SECRETS_SERVICE}`,
      detail: exec ? `Exec=${exec}` : undefined,
    });
  } else {
    results.push({
      severity: "ok",
      message: "No legacy org.freedesktop.secrets DBus autostart file found",
    });
  }

  // Check gnome-keyring systemd units
  let gnomeKeyringUnitFound = false;
  for (const unitPath of GNOME_KEYRING_UNITS) {
    if (existsSync(unitPath)) {
      gnomeKeyringUnitFound = true;
      results.push({
        severity: "warn",
        message: `gnome-keyring systemd user unit is present: ${unitPath}`,
      });
    }
  }
  if (!gnomeKeyringUnitFound) {
    results.push({
      severity: "ok",
      message: "No gnome-keyring systemd user units found",
    });
  }

  return results;
});
