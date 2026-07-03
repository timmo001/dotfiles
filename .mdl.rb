# Green-first mdl config (matches the timmo001/workflows lint-markdownlint fleet
# convention). Enable all rules, then exclude the noisy ones; tighten later.
all
exclude_rule 'MD013' # line length
exclude_rule 'MD024' # duplicate headings (e.g. repeated "Handoffs")
exclude_rule 'MD041' # first line in file should be a top-level heading
