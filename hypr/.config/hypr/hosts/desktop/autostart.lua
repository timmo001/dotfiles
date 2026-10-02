o.exec_on_start("solaar --window=hide")

-- Workspace layouts
o.exec_on_start("workspace-setup --sleep=5")

-- DeckShift: restart the portal stack after returning from Gaming Mode
o.launch_on_start("/usr/local/bin/deckshift-portal-recovery")
