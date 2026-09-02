###-begin-skill-maintenance-completions-###
#
# Static completion script for Fish
#
# Installation:
#   skill-maintenance --completions fish > ~/.config/fish/completions/skill-maintenance.fish
#

complete -c skill-maintenance -n '__fish_use_subcommand' -f
complete -c skill-maintenance -n '__fish_use_subcommand' -f -a 'validate' -d 'Validate skills and repository metadata'
complete -c skill-maintenance -n '__fish_use_subcommand' -f -a 'import' -d 'Fetch and compare or apply an imported skill'
complete -c skill-maintenance -n '__fish_use_subcommand' -f -a 'updates' -d 'Check and update tracked upstream skills'
complete -c skill-maintenance -n '__fish_use_subcommand' -f -a 'check' -d 'Review adapted imports against their origins'
complete -c skill-maintenance -n '__fish_use_subcommand' -f -a 'updates-agent' -d 'Run scheduled skill update automation'
complete -c skill-maintenance -n '__fish_seen_subcommand_from validate' -f
complete -c skill-maintenance -n '__fish_seen_subcommand_from import' -f
complete -c skill-maintenance -n '__fish_seen_subcommand_from import; and not __fish_contains_opt apply no-apply' -l apply -d 'Apply a clean upstream snapshot'
complete -c skill-maintenance -n '__fish_seen_subcommand_from import; and not __fish_contains_opt apply no-apply' -l no-apply -d 'Disable apply'
complete -c skill-maintenance -n '__fish_seen_subcommand_from import; and not __fish_contains_opt metadata-only no-metadata-only' -l metadata-only -d 'Materialise imports.json metadata only'
complete -c skill-maintenance -n '__fish_seen_subcommand_from import; and not __fish_contains_opt metadata-only no-metadata-only' -l no-metadata-only -d 'Disable metadata-only'
complete -c skill-maintenance -n '__fish_seen_subcommand_from import; and begin; not __fish_contains_opt reviewed-sha; or contains -- (commandline -poc)[-1] --reviewed-sha; end' -l reviewed-sha -r -f
complete -c skill-maintenance -n '__fish_seen_subcommand_from import; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt apply no-apply' -f -a '--apply' -d 'Apply a clean upstream snapshot'
complete -c skill-maintenance -n '__fish_seen_subcommand_from import; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt apply no-apply' -f -a '--no-apply' -d 'Disable apply'
complete -c skill-maintenance -n '__fish_seen_subcommand_from import; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt metadata-only no-metadata-only' -f -a '--metadata-only' -d 'Materialise imports.json metadata only'
complete -c skill-maintenance -n '__fish_seen_subcommand_from import; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt metadata-only no-metadata-only' -f -a '--no-metadata-only' -d 'Disable metadata-only'
complete -c skill-maintenance -n '__fish_seen_subcommand_from import; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt reviewed-sha' -f -a '--reviewed-sha'
complete -c skill-maintenance -n '__fish_seen_subcommand_from updates' -f
complete -c skill-maintenance -n '__fish_seen_subcommand_from updates; and not __fish_contains_opt check no-check' -l check -d 'Exit non-zero when imports need attention'
complete -c skill-maintenance -n '__fish_seen_subcommand_from updates; and not __fish_contains_opt check no-check' -l no-check -d 'Disable check'
complete -c skill-maintenance -n '__fish_seen_subcommand_from updates; and not __fish_contains_opt update no-update' -l update -d 'Apply clean updates and SHA-only refreshes'
complete -c skill-maintenance -n '__fish_seen_subcommand_from updates; and not __fish_contains_opt update no-update' -l no-update -d 'Disable update'
complete -c skill-maintenance -n '__fish_seen_subcommand_from updates; and not __fish_contains_opt json no-json' -l json -d 'Print the versioned machine report'
complete -c skill-maintenance -n '__fish_seen_subcommand_from updates; and not __fish_contains_opt json no-json' -l no-json -d 'Disable json'
complete -c skill-maintenance -n '__fish_seen_subcommand_from updates; and begin; not __fish_contains_opt skill; or contains -- (commandline -poc)[-1] --skill; end' -l skill -r -f
complete -c skill-maintenance -n '__fish_seen_subcommand_from updates; and not __fish_contains_opt commit no-commit' -l commit -d 'Commit applied updates'
complete -c skill-maintenance -n '__fish_seen_subcommand_from updates; and not __fish_contains_opt commit no-commit' -l no-commit -d 'Disable commit'
complete -c skill-maintenance -n '__fish_seen_subcommand_from updates; and not __fish_contains_opt skip-review no-skip-review' -l skip-review -d 'Do not open adapted imports for review'
complete -c skill-maintenance -n '__fish_seen_subcommand_from updates; and not __fish_contains_opt skip-review no-skip-review' -l no-skip-review -d 'Disable skip-review'
complete -c skill-maintenance -n '__fish_seen_subcommand_from updates; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt check no-check' -f -a '--check' -d 'Exit non-zero when imports need attention'
complete -c skill-maintenance -n '__fish_seen_subcommand_from updates; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt check no-check' -f -a '--no-check' -d 'Disable check'
complete -c skill-maintenance -n '__fish_seen_subcommand_from updates; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt update no-update' -f -a '--update' -d 'Apply clean updates and SHA-only refreshes'
complete -c skill-maintenance -n '__fish_seen_subcommand_from updates; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt update no-update' -f -a '--no-update' -d 'Disable update'
complete -c skill-maintenance -n '__fish_seen_subcommand_from updates; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt json no-json' -f -a '--json' -d 'Print the versioned machine report'
complete -c skill-maintenance -n '__fish_seen_subcommand_from updates; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt json no-json' -f -a '--no-json' -d 'Disable json'
complete -c skill-maintenance -n '__fish_seen_subcommand_from updates; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt skill' -f -a '--skill'
complete -c skill-maintenance -n '__fish_seen_subcommand_from updates; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt commit no-commit' -f -a '--commit' -d 'Commit applied updates'
complete -c skill-maintenance -n '__fish_seen_subcommand_from updates; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt commit no-commit' -f -a '--no-commit' -d 'Disable commit'
complete -c skill-maintenance -n '__fish_seen_subcommand_from updates; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt skip-review no-skip-review' -f -a '--skip-review' -d 'Do not open adapted imports for review'
complete -c skill-maintenance -n '__fish_seen_subcommand_from updates; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt skip-review no-skip-review' -f -a '--no-skip-review' -d 'Disable skip-review'
complete -c skill-maintenance -n '__fish_seen_subcommand_from check' -f
complete -c skill-maintenance -n '__fish_seen_subcommand_from check; and begin; not __fish_contains_opt skill; or contains -- (commandline -poc)[-1] --skill; end' -l skill -r -f
complete -c skill-maintenance -n '__fish_seen_subcommand_from check; and not __fish_contains_opt diff-origin no-diff-origin' -l diff-origin -d 'Render complete upstream diffs'
complete -c skill-maintenance -n '__fish_seen_subcommand_from check; and not __fish_contains_opt diff-origin no-diff-origin' -l no-diff-origin -d 'Disable diff-origin'
complete -c skill-maintenance -n '__fish_seen_subcommand_from check; and not __fish_contains_opt open-opencode no-open-opencode' -l open-opencode -d 'Open an interactive OpenCode review'
complete -c skill-maintenance -n '__fish_seen_subcommand_from check; and not __fish_contains_opt open-opencode no-open-opencode' -l no-open-opencode -d 'Disable open-opencode'
complete -c skill-maintenance -n '__fish_seen_subcommand_from check; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt skill' -f -a '--skill'
complete -c skill-maintenance -n '__fish_seen_subcommand_from check; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt diff-origin no-diff-origin' -f -a '--diff-origin' -d 'Render complete upstream diffs'
complete -c skill-maintenance -n '__fish_seen_subcommand_from check; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt diff-origin no-diff-origin' -f -a '--no-diff-origin' -d 'Disable diff-origin'
complete -c skill-maintenance -n '__fish_seen_subcommand_from check; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt open-opencode no-open-opencode' -f -a '--open-opencode' -d 'Open an interactive OpenCode review'
complete -c skill-maintenance -n '__fish_seen_subcommand_from check; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt open-opencode no-open-opencode' -f -a '--no-open-opencode' -d 'Disable open-opencode'
complete -c skill-maintenance -n '__fish_seen_subcommand_from updates-agent; and not __fish_seen_subcommand_from github device' -f
complete -c skill-maintenance -n '__fish_seen_subcommand_from updates-agent; and not __fish_seen_subcommand_from github device' -f -a 'github' -d 'Publish clean import updates from GitHub Actions'
complete -c skill-maintenance -n '__fish_seen_subcommand_from updates-agent; and not __fish_seen_subcommand_from github device' -f -a 'device' -d 'Process one completed update workflow locally'
complete -c skill-maintenance -n '__fish_seen_subcommand_from updates-agent; and __fish_seen_subcommand_from github' -f
complete -c skill-maintenance -n '__fish_seen_subcommand_from updates-agent; and __fish_seen_subcommand_from github; and begin; not __fish_contains_opt skills-dir; or contains -- (commandline -poc)[-1] --skills-dir; end' -l skills-dir -r -F
complete -c skill-maintenance -n '__fish_seen_subcommand_from updates-agent; and __fish_seen_subcommand_from github; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt skills-dir' -f -a '--skills-dir'
complete -c skill-maintenance -n '__fish_seen_subcommand_from updates-agent; and __fish_seen_subcommand_from device' -f
complete -c skill-maintenance -n '__fish_seen_subcommand_from updates-agent; and __fish_seen_subcommand_from device; and begin; not __fish_contains_opt config; or contains -- (commandline -poc)[-1] --config; end' -l config -r -F
complete -c skill-maintenance -n '__fish_seen_subcommand_from updates-agent; and __fish_seen_subcommand_from device; and begin; not __fish_contains_opt run-id; or contains -- (commandline -poc)[-1] --run-id; end' -l run-id -r -f
complete -c skill-maintenance -n '__fish_seen_subcommand_from updates-agent; and __fish_seen_subcommand_from device; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt config' -f -a '--config'
complete -c skill-maintenance -n '__fish_seen_subcommand_from updates-agent; and __fish_seen_subcommand_from device; and not string match -q -- "-*" (commandline -ct); and not __fish_contains_opt run-id' -f -a '--run-id'

###-end-skill-maintenance-completions-###
