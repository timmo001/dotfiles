import { Effect } from "effect";
import { readTextOrNull } from "../../lib/fsProbe.js";
import { CommandExecutor } from "../../services/CommandExecutor.js";
import type { CheckResult } from "../types.js";

const UNPRIVILEGED_PORT_START = "/proc/sys/net/ipv4/ip_unprivileged_port_start";

const UNPRIVILEGED_PORT_SYSCTL = "/etc/sysctl.d/50-unprivileged-ports.conf";

/** Verify the pitchfork proxy works, including its unprivileged bind on port 443. */
export const checkPitchforkProxy = Effect.gen(function* () {
  const executor = yield* CommandExecutor;

  if ((yield* executor.exitCode("which", ["pitchfork"])) !== 0) {
    return [
      { severity: "ok", message: "pitchfork is not installed, skipping" },
    ] satisfies CheckResult[];
  }

  if ((yield* executor.exitCode("pitchfork", ["proxy", "doctor"])) === 0) {
    return [
      { severity: "ok", message: "pitchfork proxy is healthy" },
    ] satisfies CheckResult[];
  }

  const portStart = Number(
    (yield* readTextOrNull(UNPRIVILEGED_PORT_START))?.trim(),
  );

  if (portStart > 443) {
    return [
      {
        severity: "warn",
        message: "pitchfork proxy cannot bind port 443 as your user",
        detail: `Run: pkexec sh -c "echo net.ipv4.ip_unprivileged_port_start=443 > ${UNPRIVILEGED_PORT_SYSCTL} && sysctl --system", then \`pitchfork supervisor start --force\``,
      },
    ] satisfies CheckResult[];
  }

  return [
    {
      severity: "warn",
      message: "pitchfork proxy doctor reports problems",
      detail:
        "Run `pitchfork proxy doctor`, then `pitchfork supervisor start --force`",
    },
  ] satisfies CheckResult[];
});
