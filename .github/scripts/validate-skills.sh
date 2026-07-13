#!/usr/bin/env bash
# Validate public SKILL.md files against the Agent Skills spec via skills-ref.
set -euo pipefail

repo_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/../.." && pwd)"
python_bin="${PYTHON:-python3}"

skill_roots=(
  "$repo_root/agents/.agents/skills"
  "$repo_root/.opencode/skills"
)

allow_fields=(
  disable-model-invocation
)

install_skills_ref() {
  if command -v skills-ref >/dev/null 2>&1; then
    return 0
  fi

  "$python_bin" -m pip install --disable-pip-version-check --user skills-ref
  export PATH="${HOME}/.local/bin:${PATH}"
  command -v skills-ref >/dev/null
}

install_skills_ref

validate_args=(validate)
for field in "${allow_fields[@]}"; do
  validate_args+=(--allow-field "$field")
done

failures=0
checked=0

for root in "${skill_roots[@]}"; do
  if [[ ! -d "$root" ]]; then
    continue
  fi

  for skill_dir in "$root"/*; do
    [[ -d "$skill_dir" ]] || continue
    skill_name="$(basename -- "$skill_dir")"

    if [[ ! -f "$skill_dir/SKILL.md" ]]; then
      printf 'Skill directory missing SKILL.md: %s\n' "${skill_dir#"$repo_root"/}" >&2
      failures=$((failures + 1))
      continue
    fi

    checked=$((checked + 1))
    if ! skills-ref "${validate_args[@]}" "$skill_dir"; then
      printf 'skills-ref validation failed: %s\n' "${skill_dir#"$repo_root"/}" >&2
      failures=$((failures + 1))
    fi
  done
done

if (( checked == 0 )); then
  printf 'No skills found to validate.\n' >&2
  exit 1
fi

if (( failures > 0 )); then
  printf '%s skill(s) failed validation.\n' "$failures" >&2
  exit 1
fi

printf 'Validated %s skill(s) with skills-ref.\n' "$checked"
