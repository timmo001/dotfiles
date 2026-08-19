#!/bin/bash

set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)
manager="$repo_root/scripts/.local/bin/manage-omarchy-plugin"
prettier="$repo_root/dot/node_modules/.bin/prettier"
test_root=$(mktemp -d)
dotfiles="$test_root/dotfiles"
upstream="$test_root/upstream"
home="$test_root/home"
mock_bin="$test_root/bin"
dot_log="$test_root/dot.log"
gum_args="$test_root/gum.args"
gum_choices="$test_root/gum.choices"

trap 'rm -rf "$test_root"' EXIT
mkdir -p "$dotfiles/omarchy/.config/omarchy/plugins" "$home/.config/omarchy/plugins" "$mock_bin"
export XDG_CONFIG_HOME="$home/.config"

cat >"$mock_bin/dot" <<'EOF'
#!/bin/bash
if [[ $1 == stow ]]; then
  mkdir -p "$HOME/.config/omarchy/plugins"
  for source in "$DOTFILES_REPO"/omarchy/.config/omarchy/plugins/*; do
    [[ -e $source ]] || continue
    ln -sfn "$source" "$HOME/.config/omarchy/plugins/$(basename "$source")"
  done
elif [[ $1 == git-commit ]]; then
  printf '%s\n' "$*" >>"$DOT_LOG"
fi
EOF
cat >"$mock_bin/gum" <<'EOF'
#!/bin/bash
printf '%s\n' "$*" >"$GUM_ARGS"
cat >"$GUM_CHOICES"
printf '%s\n' "${GUM_CHOICE:-No}"
EOF
cat >"$mock_bin/omarchy-shell" <<'EOF'
#!/bin/bash
exit 0
EOF
cat >"$mock_bin/omarchy-plugin-validate" <<'EOF'
#!/bin/bash
[[ ${VALIDATE_FAIL:-0} != 1 ]]
EOF
chmod +x "$mock_bin/dot" "$mock_bin/gum" "$mock_bin/omarchy-shell" "$mock_bin/omarchy-plugin-validate"

git init -q -b main "$upstream"
git -C "$upstream" config user.name Test
git -C "$upstream" config user.email test@example.com
cat >"$upstream/manifest.json" <<'EOF'
{
  "id": "example.plugin",
  "kinds": ["bar-widget"],
  "barWidget": { "defaultSection": "right" }
}
EOF
printf 'first\n' >"$upstream/Widget.qml"
git -C "$upstream" add .
git -C "$upstream" commit -qm first
first_sha=$(git -C "$upstream" rev-parse HEAD)

git clone -q "$upstream" "$home/.config/omarchy/plugins/example.plugin"

git init -q -b main "$dotfiles"
git -C "$dotfiles" config user.name Test
git -C "$dotfiles" config user.email test@example.com
cat >"$dotfiles/omarchy-plugins.json" <<'EOF'
{ "plugins": [] }
EOF
touch "$dotfiles/.gitmodules"
git -C "$dotfiles" add .
git -C "$dotfiles" commit -qm initial

env HOME="$home" DOTFILES_REPO="$dotfiles" GIT_ALLOW_PROTOCOL=file PATH="$mock_bin:$PATH" \
  DOT_LOG="$dot_log" GUM_ARGS="$gum_args" GUM_CHOICES="$gum_choices" \
  OMARCHY_PLUGIN_INTERACTIVE=1 GUM_CHOICE=No \
  OMARCHY_PLUGIN_PRETTIER="$prettier" \
  "$manager" add example.plugin "$upstream" \
  "$home/.config/omarchy/plugins/example.plugin" \
  --section right --after omarchy.tray

source_path="$dotfiles/omarchy/.config/omarchy/plugins/example.plugin"
[[ $(git -C "$source_path" rev-parse HEAD) == "$first_sha" ]]
jq -e '.plugins == [{
  id: "example.plugin",
  managed: true,
  placement: {section: "right", after: "omarchy.tray"}
}]' "$dotfiles/omarchy-plugins.json" >/dev/null
[[ -L $home/.config/omarchy/plugins/example.plugin ]]
[[ -n $(git -C "$dotfiles" status --short) ]]
[[ -z $(git -C "$dotfiles" diff --cached --name-only) ]]
"$prettier" --check --parser json "$dotfiles/omarchy-plugins.json" >/dev/null
[[ $(<"$gum_args") == 'choose --header=Save managed plugin changes? --selected No' ]]
mapfile -t choices <"$gum_choices"
[[ ${choices[*]} == 'No Commit Commit and push' ]]
[[ ! -e $dot_log ]]

rm "$home/.config/omarchy/plugins/example.plugin"
mkdir "$home/.config/omarchy/plugins/example.plugin"
cp "$source_path/manifest.json" "$home/.config/omarchy/plugins/example.plugin/"
env HOME="$home" DOTFILES_REPO="$dotfiles" GIT_ALLOW_PROTOCOL=file PATH="$mock_bin:$PATH" \
  DOT_LOG="$dot_log" GUM_ARGS="$gum_args" GUM_CHOICES="$gum_choices" \
  OMARCHY_PLUGIN_PRETTIER="$prettier" \
  "$manager" remove example.plugin 1
! jq -e 'any(.plugins[]?; .id == "example.plugin")' "$dotfiles/omarchy-plugins.json" >/dev/null
[[ ! -e $source_path ]]
[[ ! -e $home/.config/omarchy/plugins/example.plugin ]]
[[ -z $(git -C "$dotfiles" diff --cached --name-only) ]]

git clone -q "$upstream" "$home/.config/omarchy/plugins/example.plugin"
HOME="$home" git config --global "url.$upstream.insteadOf" \
  https://github.com/example/plugin.git
env HOME="$home" DOTFILES_REPO="$dotfiles" GIT_ALLOW_PROTOCOL=file:https PATH="$mock_bin:$PATH" \
  DOT_LOG="$dot_log" GUM_ARGS="$gum_args" GUM_CHOICES="$gum_choices" \
  OMARCHY_PLUGIN_PRETTIER="$prettier" \
  "$manager" add example.plugin git@github.com:example/plugin.git \
  "$home/.config/omarchy/plugins/example.plugin" \
  --section right --after omarchy.tray
[[ $(git -C "$dotfiles" config -f .gitmodules --get \
  submodule.omarchy/.config/omarchy/plugins/example.plugin.url) == https://github.com/example/plugin.git ]]

git -C "$dotfiles" add .gitmodules omarchy-plugins.json \
  omarchy/.config/omarchy/plugins/example.plugin
git -C "$dotfiles" commit -qm managed

printf 'second\n' >"$upstream/Widget.qml"
git -C "$upstream" add Widget.qml
git -C "$upstream" commit -qm second
second_sha=$(git -C "$upstream" rev-parse HEAD)

env HOME="$home" DOTFILES_REPO="$dotfiles" GIT_ALLOW_PROTOCOL=file PATH="$mock_bin:$PATH" \
  DOT_LOG="$dot_log" GUM_ARGS="$gum_args" GUM_CHOICES="$gum_choices" \
  OMARCHY_PLUGIN_PRETTIER="$prettier" \
  "$manager" update example.plugin 1
[[ $(git -C "$source_path" rev-parse HEAD) == "$second_sha" ]]
[[ -z $(git -C "$dotfiles" diff --cached --name-only) ]]

printf 'third\n' >"$upstream/Widget.qml"
git -C "$upstream" add Widget.qml
git -C "$upstream" commit -qm third
if env HOME="$home" DOTFILES_REPO="$dotfiles" GIT_ALLOW_PROTOCOL=file PATH="$mock_bin:$PATH" \
  DOT_LOG="$dot_log" GUM_ARGS="$gum_args" GUM_CHOICES="$gum_choices" \
  OMARCHY_PLUGIN_PRETTIER="$prettier" \
  VALIDATE_FAIL=1 "$manager" update example.plugin 1; then
  printf 'invalid managed update succeeded\n' >&2
  exit 1
fi
[[ $(git -C "$source_path" rev-parse HEAD) == "$second_sha" ]]

git -C "$dotfiles" add omarchy/.config/omarchy/plugins/example.plugin
git -C "$dotfiles" commit -qm updated
env HOME="$home" DOTFILES_REPO="$dotfiles" GIT_ALLOW_PROTOCOL=file PATH="$mock_bin:$PATH" \
  DOT_LOG="$dot_log" GUM_ARGS="$gum_args" GUM_CHOICES="$gum_choices" \
  OMARCHY_PLUGIN_INTERACTIVE=1 GUM_CHOICE='Commit and push' \
  OMARCHY_PLUGIN_PRETTIER="$prettier" \
  "$manager" remove example.plugin 1
! jq -e 'any(.plugins[]?; .id == "example.plugin")' "$dotfiles/omarchy-plugins.json" >/dev/null
[[ ! -e $home/.config/omarchy/plugins/example.plugin ]]
[[ -z $(git -C "$dotfiles" diff --cached --name-only) ]]
grep -Fqx 'git-commit -m Remove example.plugin Omarchy plugin --path .gitmodules --path omarchy-plugins.json --path omarchy/.config/omarchy/plugins/example.plugin --push' "$dot_log"

set +e
env HOME="$home" DOTFILES_REPO="$dotfiles" PATH="$mock_bin:$PATH" \
  DOT_LOG="$dot_log" GUM_ARGS="$gum_args" GUM_CHOICES="$gum_choices" \
  OMARCHY_PLUGIN_PRETTIER="$prettier" \
  "$manager" remove unmanaged.plugin 1
status=$?
set -e
[[ $status == 20 ]]

printf 'Managed Omarchy plugin tests passed\n'
