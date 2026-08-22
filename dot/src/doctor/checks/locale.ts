import { Effect } from "effect";
import { missingLocales } from "../../lib/localeSetup.js";
import type { CheckResult } from "../types.js";

/** Check the locales the stowed shell config requires are generated. */
export const checkLocale = Effect.gen(function* () {
  const results: CheckResult[] = [];
  const missing = yield* missingLocales;

  if (missing.length === 0) {
    results.push({
      severity: "ok",
      message: "Required locales are generated",
    });
    return results;
  }

  for (const locale of missing) {
    results.push({
      severity: "warn",
      message: `Required locale not generated: ${locale}`,
      detail: `Uncomment '${locale} UTF-8' in /etc/locale.gen, then run: sudo locale-gen (or rerun dot init)`,
    });
  }
  return results;
});
