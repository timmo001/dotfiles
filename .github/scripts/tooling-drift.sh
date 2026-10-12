#!/usr/bin/env bash
# Tooling drift: keep a repository reviewed against the releases of the
# tools it wraps, configures or forks. tooling.yml lists each tool's GitHub
# repository and the release tag last reviewed; this script compares that
# with the latest release and opens one pull request per tool that moved.
#
#   tooling-drift.sh status                print each tool's reviewed and latest release; exit 1 when one is behind
#   tooling-drift.sh update <repo> <tag>   run the tool's update command, then record the tag as reviewed
#   tooling-drift.sh publish [<repo>]      update every tool behind its latest release (or one) and open or refresh its pull request
#
# Source: the tooling-drift skill in timmo001/skills. Copy it from there and
# keep repository specifics in tooling.yml, not in this file.
#
# tooling.yml, at the repository root:
#
#   assignee: octocat              # optional; assigned to every pull request
#   tools:
#     - repo: owner/name           # GitHub repository whose releases are tracked
#       reviewed: v1.2.3           # release tag last reviewed
#       update: scripts/x.sh       # optional; run with the tag to refresh what the repository derives from the tool
#       pins: tooling.yml          # optional; files a pin move touches, space separated (default tooling.yml)
#       review: Check ...          # optional; one line for the pull request on what to review
#
# A tool with an update command whose run changes nothing but the pins gets
# "[Pin-only] Update <repo> to <tag>" with squash auto-merge. Any other
# change, and every tool without an update command, gets "Update <repo> to
# <tag>" and waits for review on its branch. Needs git, jq and an
# authenticated gh. TOOLING_DRIFT_DISPATCH names the workflow files to run on
# the branch after a push (default ci.yml; empty to skip), for pull requests
# opened with GITHUB_TOKEN, which do not trigger pull_request workflows.
set -euo pipefail

cd "$(git rev-parse --show-toplevel)"

tooling_file="tooling.yml"
dispatch=${TOOLING_DRIFT_DISPATCH-ci.yml}

# One line per tool: repo, reviewed, update, pins and review, separated by
# the unit separator so empty fields survive word splitting.
tools() {
  awk '
    function value(line) {
      sub(/^[^:]*:[[:space:]]*/, "", line)
      sub(/[[:space:]]+$/, "", line)
      gsub(/^"|"$/, "", line)
      return line
    }
    function flush() {
      if (repo != "") printf "%s\037%s\037%s\037%s\037%s\n", repo, reviewed, update, pins, review
      repo = ""; reviewed = ""; update = ""; pins = ""; review = ""
    }
    /^tools:/ { intools = 1; next }
    intools && /^[^[:space:]#]/ { flush(); intools = 0 }
    intools && /^[[:space:]]*-[[:space:]]*repo:/ { flush(); repo = value($0); next }
    intools && /^[[:space:]]+reviewed:/ { reviewed = value($0); next }
    intools && /^[[:space:]]+update:/ { update = value($0); next }
    intools && /^[[:space:]]+pins:/ { pins = value($0); next }
    intools && /^[[:space:]]+review:/ { review = value($0); next }
    END { flush() }
  ' "$tooling_file"
}

assignee() {
  sed -n 's/^assignee:[[:space:]]*//p' "$tooling_file" | head -n 1
}

latest_release() {
  gh release view --repo "$1" --json tagName --jq .tagName
}

record_reviewed() {
  local repo=$1 tag=$2
  awk -v repo="$repo" -v tag="$tag" '
    /^[[:space:]]*-[[:space:]]*repo:/ {
      current = $0
      sub(/^[^:]*:[[:space:]]*/, "", current)
      sub(/[[:space:]]+$/, "", current)
      gsub(/^"|"$/, "", current)
    }
    current == repo && /^[[:space:]]+reviewed:/ { sub(/:.*$/, ": " tag) }
    { print }
  ' "$tooling_file" > "$tooling_file.tmp"
  mv "$tooling_file.tmp" "$tooling_file"
}

tool_line() {
  local repo=$1 line
  while IFS= read -r line; do
    [ "${line%%$'\037'*}" = "$repo" ] && printf '%s\n' "$line" && return 0
  done < <(tools)
  echo "$repo is not listed in $tooling_file" >&2
  return 1
}

run_update() {
  local repo=$1 tag=$2 update=$3
  if [ -n "$update" ]; then
    # shellcheck disable=SC2086 # the command is a short shell line from tooling.yml
    $update "$tag"
  fi
  record_reviewed "$repo" "$tag"
}

status() {
  local behind=false repo reviewed update pins review latest
  while IFS=$'\037' read -r repo reviewed update pins review; do
    latest=$(latest_release "$repo")
    if [ "$latest" = "$reviewed" ]; then
      echo "$repo: up to date at $reviewed"
    else
      echo "$repo: $reviewed -> $latest"
      behind=true
    fi
  done < <(tools)
  [ "$behind" = false ]
}

update() {
  local repo=$1 tag=$2 line
  line=$(tool_line "$repo")
  run_update "$repo" "$tag" "$(printf '%s' "$line" | cut -d $'\037' -f3)"
  echo "Reviewed $repo at $tag"
}

body_text() {
  local repo=$1 reviewed=$2 tag=$3 update=$4 review=$5 changed=$6
  echo "Moves the reviewed $repo release from \`$reviewed\` to \`$tag\`."
  if [ -z "$update" ]; then
    echo
    echo "Review the release notes against the parts of this repository that depend on $repo, push any change they need to this branch, then merge. ${review}"
  elif [ -z "$changed" ]; then
    echo
    echo "Nothing the repository derives from it changed at this release, so only the pin moves."
  else
    echo
    echo "It also refreshes what the repository derives from it:"
    echo
    while IFS= read -r file; do
      printf -- '- %s%s%s\n' '`' "$file" '`'
    done <<< "$changed"
    [ -n "$review" ] && { echo; echo "$review"; }
  fi
  echo
  echo "Release notes: https://github.com/$repo/releases/tag/$tag"
  echo "Compare: https://github.com/$repo/compare/$reviewed...$tag"
}

publish_tool() {
  local repo=$1 reviewed=$2 tag=$3 update=$4 pins=$5 review=$6 base=$7
  local branch changed pin_only file derived title body existing number previous_title url assignees
  branch="tooling/$(printf '%s' "$repo" | tr '[:upper:]/' '[:lower:]-')"

  git switch --quiet --force-create "$branch" "origin/$base"
  run_update "$repo" "$tag" "$update"
  git add -A
  changed=$(git diff --cached --name-only)

  if [ -z "$changed" ]; then
    echo "$repo: nothing changed at $tag"
    return 0
  fi

  pin_only=false
  if [ -n "$update" ]; then
    pin_only=true
    for file in $changed; do
      case " ${pins:-$tooling_file} " in
        *" $file "*) ;;
        *) pin_only=false ;;
      esac
    done
  fi

  derived=""
  for file in $changed; do
    case " ${pins:-$tooling_file} " in
      *" $file "*) ;;
      *) derived="${derived:+$derived
}$file" ;;
    esac
  done

  if [ "$pin_only" = true ]; then
    title="[Pin-only] Update $repo to $tag"
  else
    title="Update $repo to $tag"
  fi
  body=$(body_text "$repo" "$reviewed" "$tag" "$update" "$review" "$derived")

  git commit --quiet -m "$title"

  existing=$(gh pr list --head "$branch" --base "$base" --state open --json number,title --jq '.[0] // empty')
  number=$(printf '%s' "$existing" | jq -r '.number // empty')
  previous_title=$(printf '%s' "$existing" | jq -r '.title // empty')

  if [ -n "$number" ] && [ "$previous_title" = "$title" ] &&
    git fetch --quiet origin "$branch" && git diff --quiet "origin/$branch" HEAD --; then
    echo "$repo: pull request #$number already carries $title"
    return 0
  fi

  git push --force --quiet origin "HEAD:refs/heads/$branch"

  assignees=$(assignee)
  if [ -n "$number" ]; then
    gh pr edit "$number" --title "$title" --body "$body" ${assignees:+--add-assignee "$assignees"} > /dev/null
    url=$(gh pr view "$number" --json url --jq .url)
  else
    url=$(gh pr create --base "$base" --head "$branch" --title "$title" --body "$body" ${assignees:+--assignee "$assignees"})
  fi

  if [ "$pin_only" = true ]; then
    gh pr merge --auto --squash "$url" ||
      echo "::warning::Could not enable auto-merge on $url; merge it by hand"
  elif [ -n "$number" ]; then
    gh pr merge --disable-auto "$url" || true
  fi

  local workflow
  for workflow in $dispatch; do
    gh workflow run "$workflow" --ref "$branch"
  done

  echo "$repo: published $title at $url"
}

publish() {
  local only=${1:-} base start start_sha entries entry repo reviewed update pins review latest

  if [ -n "$(git status --porcelain)" ]; then
    echo "The working tree has changes; commit or stash them first" >&2
    return 1
  fi

  if [ "${GITHUB_ACTIONS:-}" = true ]; then
    git config user.name 'github-actions[bot]'
    git config user.email '41898282+github-actions[bot]@users.noreply.github.com'
  fi

  base=$(gh repo view --json defaultBranchRef --jq .defaultBranchRef.name)
  git fetch --quiet origin "$base"
  start=$(git rev-parse --abbrev-ref HEAD)
  start_sha=$(git rev-parse HEAD)
  # Return to the starting checkout even when a tool's update fails.
  # shellcheck disable=SC2064 # expand now: the values are fixed for this run
  trap "restore_checkout '$start' '$start_sha'" EXIT

  mapfile -t entries < <(tools)
  for entry in "${entries[@]}"; do
    IFS=$'\037' read -r repo reviewed update pins review <<< "$entry"
    [ -n "$only" ] && [ "$only" != "$repo" ] && continue
    latest=$(latest_release "$repo")
    if [ "$latest" = "$reviewed" ]; then
      echo "$repo: up to date at $reviewed"
      continue
    fi
    publish_tool "$repo" "$reviewed" "$latest" "$update" "$pins" "$review" "$base"
  done
}

restore_checkout() {
  local start=$1 start_sha=$2
  git reset --quiet --hard
  if [ "$start" = HEAD ]; then
    git switch --quiet --detach "$start_sha"
  else
    git switch --quiet "$start"
  fi
}

case ${1:-} in
  status) status ;;
  update) update "${2:?usage: tooling-drift.sh update <repo> <tag>}" "${3:?usage: tooling-drift.sh update <repo> <tag>}" ;;
  publish) publish "${2:-}" ;;
  *)
    echo "usage: tooling-drift.sh status | update <repo> <tag> | publish [<repo>]" >&2
    exit 2
    ;;
esac
