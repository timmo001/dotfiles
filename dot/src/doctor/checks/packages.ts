import { Effect } from "effect";
import { Config } from "../../services/Config.js";
import {
  type AppRequirements,
  appRequirementInstructions,
  hasMissingAppRequirements,
  missingAppRequirements,
  publicAppRequirements,
} from "../../lib/appOptions.js";
import { privateAppRequirements } from "../../lib/packageSetup.js";
import type { CheckResult } from "../types.js";

/**
 * Report whether the app's options provide each package and tool, ending with
 * what to add to them.
 */
const appRequirementResults = Effect.fn("Packages.appRequirementResults")(
  function* (requirements: AppRequirements) {
    if (requirements.packages.length === 0 && requirements.tools.length === 0)
      return [
        { severity: "ok", message: "No packages or tools configured" },
      ] satisfies CheckResult[];

    const missing = yield* missingAppRequirements(requirements).pipe(
      Effect.catchTag("AppOptionsError", () => Effect.succeed(null)),
    );

    if (missing === null)
      return [
        { severity: "warn", message: "Could not read the app's options" },
      ] satisfies CheckResult[];

    if (!hasMissingAppRequirements(missing))
      return [
        {
          severity: "ok",
          message: `The app provides ${requirements.packages.length} packages and ${requirements.tools.length} tools`,
        },
      ] satisfies CheckResult[];

    return appRequirementInstructions(missing).map((message): CheckResult => ({
      severity: "warn",
      message,
    }));
  },
);

/** Check the app's options provide the public packages and tools. */
export const checkPublicPackages = Effect.gen(function* () {
  const config = yield* Config;

  return yield* appRequirementResults(publicAppRequirements(config));
}).pipe(Effect.withSpan("Packages.checkPublic"));

/** Check the app's options provide the private packages. */
export const checkPrivatePackages = Effect.gen(function* () {
  const config = yield* Config;

  if (!config.canUsePrivate) {
    return [
      {
        severity: "warn",
        message: `Skipping private package checks (${config.privateReason})`,
      },
    ] satisfies CheckResult[];
  }

  return yield* appRequirementResults(privateAppRequirements(config));
}).pipe(Effect.withSpan("Packages.checkPrivate"));
