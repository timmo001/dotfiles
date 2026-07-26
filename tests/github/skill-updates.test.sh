#!/usr/bin/env bash

set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
temp_dir="$(mktemp -d)"
trap 'rm -rf "$temp_dir"' EXIT

grep -Fq 'scripts/.local/bin/dot' "$repo_root/.github/scripts/skill-updates.sh"
grep -Fq 'DOTFILES_PUBLIC_DIR: ${{ github.workspace }}' "$repo_root/.github/workflows/skill-updates.yml"

cat >"$temp_dir/report.json" <<'EOF'
{
  "version": 1,
  "skills": [
    {
      "name": "adapted",
      "directory": "adapted-directory",
      "state": "manual-review",
      "origin": "https://github.com/example/skills/tree/main/adapted",
      "storedSha": "aaa",
      "upstreamSha": "bbb",
      "files": [{ "path": "SKILL.md", "status": "modified" }],
      "localEdits": ["Keep local wording"]
    },
    {
      "name": "broken",
      "directory": "broken",
      "state": "invalid-origin",
      "origin": "https://github.com/example/skills/blob/main/SKILL.md",
      "storedSha": null,
      "upstreamSha": null,
      "files": [],
      "localEdits": [],
      "reason": "origin must be a tree URL"
    }
  ]
}
EOF

cat >"$temp_dir/prs.json" <<'EOF'
[
  {
    "number": 42,
    "title": "Update skill: clean",
    "url": "https://github.com/example/repo/pull/42"
  }
]
EOF

output="$(
  SKILL_UPDATES_REPORT="$temp_dir/report.json" \
    SKILL_UPDATES_PRS="$temp_dir/prs.json" \
    "$repo_root/.github/scripts/skill-updates.sh" render-dashboard
)"

grep -Fq '<!-- skill-updates-dashboard -->' <<<"$output"
grep -Fq "**adapted**: \`aaa\` -> \`bbb\`" <<<"$output"
grep -Fq 'Local edits: Keep local wording' <<<"$output"
grep -Fq '[#42 Update skill: clean](https://github.com/example/repo/pull/42)' <<<"$output"
grep -Fq "**broken** (\`invalid-origin\`): origin must be a tree URL" <<<"$output"
