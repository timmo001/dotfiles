import { Api } from "@timmo001/effect-gh";
import { Effect } from "effect";
import { GitHub } from "../../git/services/GitHub.js";
import type { CheckResult } from "../types.js";

/** Check GitHub notifications API access. */
export const checkGitNotifications = Effect.gen(function* () {
  const github = yield* GitHub;
  const results: CheckResult[] = [];

  const hasGh = yield* github.isAvailable;

  if (!hasGh) {
    results.push({
      severity: "warn",
      message: "Skipping GitHub notifications API check (gh CLI not found)",
    });
  } else {
    const notificationsAccess = yield* github
      .read(
        "notifications",
        Api.empty({
          endpoint: "notifications",
          method: "GET",
          query: { per_page: 1 },
        }),
      )
      .pipe(
        Effect.map(() => true),
        Effect.orElseSucceed(() => false),
      );

    if (notificationsAccess) {
      results.push({
        severity: "ok",
        message: "GitHub notifications API is accessible",
      });
    } else {
      results.push({
        severity: "warn",
        message: "GitHub notifications API is not accessible",
        detail:
          "Authenticate gh with a classic token that has notifications or repo scope",
      });
    }
  }

  return results;
});
