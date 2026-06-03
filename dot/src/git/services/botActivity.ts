const BOT_TEXT_MARKERS = ["[bot]", "renovate", "dependabot", "github-actions"];

const BOT_BRANCH_PREFIXES = ["renovate/", "dependabot/"];

/** Return true when text clearly names a bot or automation actor. */
export function textLooksLikeBotActivity(
  value: string | null | undefined,
): boolean {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  if (normalized.length === 0) return false;
  return (
    normalized.startsWith("app/") ||
    BOT_TEXT_MARKERS.some((marker) => normalized.includes(marker))
  );
}

/** Return true when a branch name clearly belongs to dependency automation. */
export function branchLooksLikeBotActivity(
  branch: string | null | undefined,
): boolean {
  if (!branch) return false;
  const normalized = branch.trim().toLowerCase();
  return BOT_BRANCH_PREFIXES.some((prefix) => normalized.startsWith(prefix));
}

/** Return true when any supplied value clearly names bot activity. */
export function valuesLookLikeBotActivity(
  values: readonly (string | null | undefined)[],
): boolean {
  return values.some(
    (value) =>
      textLooksLikeBotActivity(value) || branchLooksLikeBotActivity(value),
  );
}
