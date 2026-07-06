import type {
  MenuItem,
  MenuVariant,
  NotesViewFilter,
  NotifyConfig,
  ViewId,
} from "./types.js";

// --- Helpers ---

function item(
  id: string,
  icon: string,
  title: string,
  description: string,
  action: MenuItem["action"],
  variants?: readonly MenuVariant[],
  keywords?: readonly string[],
  group?: string,
): MenuItem {
  return {
    id,
    icon,
    title,
    description,
    action,
    ...(variants && { variants }),
    ...(keywords && { keywords }),
    ...(group && { group }),
  };
}

function cmd(command: string, wait = true): MenuItem["action"] {
  return { type: "command", cmd: command, wait };
}

function exitCmd(command: string): MenuItem["action"] {
  return { type: "exit-command", cmd: command };
}

function silent(command: string): MenuItem["action"] {
  return { type: "silent", cmd: command };
}

function notify(command: string, config: NotifyConfig): MenuItem["action"] {
  return { type: "notify", cmd: command, notify: config };
}

function view(
  viewId: ViewId,
  notesFilter?: NotesViewFilter,
): MenuItem["action"] {
  return { type: "view", viewId, ...(notesFilter && { notesFilter }) };
}

// --- Dot main menu ---

const dotItems: readonly MenuItem[] = [
  item(
    "dashboard",
    "󰕮",
    "Dashboard",
    "Full-screen dashboard of tracked sources",
    view("dashboard"),
    undefined,
    ["dash", "overview", "status", "summary", "cards"],
    "Dotfiles",
  ),
  item(
    "update",
    "󰚰",
    "Update",
    "Pull repos, stow dotfiles, install deps, rebuild",
    exitCmd("dot update"),
    [
      {
        label: "Full",
        description: "Install, rebuild, restart, pull, stow",
        action: exitCmd("dot update"),
      },
      {
        label: "Pull",
        description: "Pull all repos (dotfiles, private, omarchy)",
        action: exitCmd("dot update --pull"),
      },
      {
        label: "Stow",
        description: "Re-stow dotfiles without pulling",
        action: exitCmd("dot update --stow"),
      },
      {
        label: "TUI",
        description: "Install deps and rebuild dot binary only",
        action: exitCmd("dot update --tui"),
      },
    ],
    ["upd", "pull", "fetch", "sync", "refresh", "rebuild", "dotfiles"],
    "Dotfiles",
  ),
  item(
    "git-diff",
    "󰊢",
    "Git Diff",
    "Repo watcher with change status",
    view("git-diff"),
    undefined,
    [
      "chg",
      "changes",
      "status",
      "git",
      "repos",
      "modified",
      "dirty",
      "dotfiles",
    ],
    "Git",
  ),
  item(
    "git-log",
    "󰜘",
    "Git Log",
    "Recent commits across tracked repos",
    view("git-log"),
    undefined,
    ["log", "commits", "history", "git", "repos", "recent", "changes"],
    "Git",
  ),
  item(
    "git-workflows",
    "󰜎",
    "Git Workflows",
    "Watched GitHub workflow runs",
    view("git-workflows"),
    undefined,
    ["github", "actions", "runs", "ci", "watch", "watched", "workflow"],
    "Git",
  ),
  item(
    "git-notifications",
    "",
    "Git Notifications",
    "GitHub notification inbox",
    view("git-notifications"),
    undefined,
    [
      "github",
      "notifications",
      "inbox",
      "mentions",
      "reviews",
      "issues",
      "pulls",
    ],
    "Git",
  ),
  item(
    "notes",
    "󰎞",
    "Repo Notes",
    "Browse repository notes",
    view("notes"),
    undefined,
    ["notes", "note", "repo-notes", "vault", "obsidian", "markdown"],
    "Notes",
  ),
  item(
    "handoffs",
    "󰈚",
    "Handoffs",
    "Browse handoff notes for this repository",
    view("notes", { tag: "handoff", title: "Handoffs" }),
    undefined,
    ["handoff", "handoffs", "notes", "agent", "continuation"],
    "Notes",
  ),
  item(
    "stow",
    "󰏗",
    "Stow",
    "Re-stow public/private dotfiles",
    cmd("dot stow"),
    [
      {
        label: "Full",
        description: "Stow public + private dotfiles",
        action: cmd("dot stow"),
      },
      {
        label: "Public only",
        description: "Stow public dotfiles only",
        action: cmd("dot stow --public"),
      },
      {
        label: "Private only",
        description: "Stow private dotfiles only",
        action: cmd("dot stow --private"),
      },
    ],
    ["sym", "symlink", "link", "deploy", "dotfiles"],
    "Dotfiles",
  ),
  item(
    "agents-sync",
    "󰯂",
    "Agents Sync",
    "Mirror AGENTS.md to Cursor, Claude, Codex",
    notify("dot agents-sync", {
      id: "agents-sync",
      progress: "Syncing agent rules...",
      success: "Agent rules synced",
    }),
    undefined,
    [
      "agents",
      "sync",
      "cursor",
      "claude",
      "codex",
      "rules",
      "mirror",
      "tooling",
    ],
    "AI Tooling",
  ),
  item(
    "mcp-sync",
    "󰛳",
    "MCP Sync",
    "Regenerate MCP configs for all harnesses from the spec",
    notify("dot mcp-sync", {
      id: "mcp-sync",
      progress: "Syncing MCP configs...",
      success: "MCP configs synced",
    }),
    undefined,
    [
      "mcp",
      "sync",
      "servers",
      "opencode",
      "cursor",
      "vscode",
      "copilot",
      "harness",
      "tooling",
    ],
    "AI Tooling",
  ),
  item(
    "skill-checks",
    "󰝒",
    "Skill Checks",
    "Validate skill references across AGENTS and agent files",
    cmd("dot skill-check"),
    [
      {
        label: "Standard",
        description: "Run validation checks",
        action: cmd("dot skill-check"),
      },
      {
        label: "With AI analysis",
        description: "Run checks + OpenCode analysis",
        action: cmd("dot skill-check --open-opencode"),
      },
      {
        label: "Diff origin",
        description: "Diff imported skills against upstream origins",
        action: cmd("dot skill-check --diff-origin"),
      },
      {
        label: "AI with diff",
        description: "Run checks + OpenCode analysis with origin diffs",
        action: cmd("dot skill-check --open-opencode --diff-origin"),
      },
    ],
    ["validate", "lint", "skills", "references", "tooling"],
    "AI Tooling",
  ),
  item(
    "skill-updates",
    "󰏬",
    "Skill Updates",
    "Check imported skills for changes",
    cmd("dot skill-updates"),
    [
      {
        label: "Full",
        description:
          "Update clean skills, review local-edit conflicts in OpenCode",
        action: cmd("dot skill-updates"),
      },
      {
        label: "Update",
        description: "Auto-apply clean skill updates (no local edits)",
        action: cmd("dot skill-updates --update"),
      },
      {
        label: "Check only",
        description: "Show what changed (no apply)",
        action: cmd("dot skill-updates --check"),
      },
      {
        label: "Skip review",
        description: "Update clean skills, skip local-edit review",
        action: cmd("dot skill-updates --skip-review"),
      },
    ],
    ["sk", "skills", "plugins", "upstream", "agents", "tooling"],
    "AI Tooling",
  ),
  item(
    "doctor",
    "󰛯",
    "Doctor",
    "Check dependencies and health",
    cmd("dot doctor"),
    [
      {
        label: "Standard",
        description: "Run all health checks",
        action: cmd("dot doctor"),
      },
      {
        label: "With AI analysis",
        description: "Full check + OpenCode report",
        action: cmd("dot doctor --open-opencode"),
      },
    ],
    [
      "doc",
      "health",
      "check",
      "diagnose",
      "deps",
      "dependencies",
      "diagnostics",
    ],
    "Diagnostics",
  ),
  item(
    "system-health",
    "󰗶",
    "System Health Check",
    "Run system-health-check diagnostics",
    cmd("system-health-check"),
    [
      {
        label: "Full",
        description: "All sections, 5 samples (~60s)",
        action: cmd("system-health-check"),
      },
      {
        label: "Quick",
        description: "Fast overview (~5s)",
        action: cmd("system-health-check --samples 2 --interval 5"),
      },
      {
        label: "Logs only",
        description: "Journal errors (instant)",
        action: cmd("system-health-check --only logs"),
      },
      {
        label: "Disk only",
        description: "Filesystem usage (instant)",
        action: cmd("system-health-check --only disk"),
      },
      {
        label: "Thermals",
        description: "Temperature readings",
        action: cmd("system-health-check --only thermal"),
      },
      {
        label: "With AI analysis",
        description: "Full check + OpenCode report",
        action: cmd("system-health-check --open-opencode"),
      },
    ],
    [
      "diag",
      "diagnostics",
      "temperature",
      "disk",
      "logs",
      "hardware",
      "cpu",
      "mem",
    ],
    "Diagnostics",
  ),
  item(
    "harness-debug",
    "󱚟",
    "Harness Debug",
    "Debug and diagnose AI coding tools",
    cmd("opencode debug info"),
    [
      {
        label: "OpenCode Info",
        description: "Runtime and environment info",
        action: cmd("opencode debug info"),
      },
      {
        label: "OpenCode Paths",
        description: "Resolved config and data paths",
        action: cmd("opencode debug paths"),
      },
      {
        label: "OpenCode Config",
        description: "Merged resolved config",
        action: cmd("opencode debug config"),
      },
      {
        label: "OpenCode Skills",
        description: "Resolved skills",
        action: cmd("opencode debug skill"),
      },
      {
        label: "Codex Doctor",
        description: "Diagnose Codex install and health",
        action: cmd("codex doctor"),
      },
      {
        label: "Codex Models",
        description: "Show available Codex models",
        action: cmd("codex debug models"),
      },
      {
        label: "Claude Doctor",
        description:
          "Check Claude Code health (interactive, not in AI analysis)",
        action: cmd("claude doctor"),
      },
      {
        label: "With AI analysis",
        description:
          "Run all diagnostics then open OpenCode (excludes interactive Claude)",
        action: cmd(
          'log="${XDG_STATE_HOME:-$HOME/.local/state}/dot/logs/harness-debug.log"; ' +
            "{ opencode debug paths 2>&1; printf '\\n---\\n'; opencode debug config 2>&1; printf '\\n---\\n'; opencode debug skill 2>&1; printf '\\n---\\n'; opencode debug info 2>&1; printf '\\n---\\n'; codex doctor 2>&1; printf '\\n---\\n'; codex debug models 2>&1; } | " +
            "sed -E 's/(ctx7sk-|sk-|ghp_|gho_|glpat-|Bearer )[A-Za-z0-9_-]+/\\1<REDACTED>/g' | tee \"$log\"; " +
            'opencode --prompt "Review the harness debug report at $log. Read it with the Read tool first. Give a concise diagnosis of issues, probable causes, and a prioritized action plan."',
          false,
        ),
      },
    ],
    [
      "harness",
      "opencode",
      "codex",
      "claude",
      "cursor",
      "ai",
      "agent",
      "debug",
      "tooling",
    ],
    "Diagnostics",
  ),
  item(
    "restart-services",
    "󰜉",
    "Restart Services",
    "Restart services that don't recover well after suspend",
    notify("on-resume", {
      id: "restart-services",
      progress: "Restarting services...",
      success: "Services restarted",
    }),
    undefined,
    ["resume", "suspend", "sleep", "wake", "waybar", "restart", "system"],
    "System",
  ),
  item(
    "workspace",
    "󱂬",
    "Workspace",
    "Manage workspace layouts, capture, restore, and setup",
    silent("workspace-menu"),
    undefined,
    [
      "layout",
      "tile",
      "capture",
      "restore",
      "arrange",
      "windows",
      "setup",
      "session",
      "system",
    ],
    "System",
  ),
  item(
    "topgrade",
    "󰁝",
    "Topgrade",
    "System-wide package upgrades",
    cmd("topgrade"),
    [
      {
        label: "Full",
        description: "All steps with prompts",
        action: cmd("topgrade"),
      },
      {
        label: "Dry run",
        description: "Preview what would run",
        action: cmd("topgrade --dry-run"),
      },
      {
        label: "System only",
        description: "Pacman system packages",
        action: cmd("topgrade --only system"),
      },
      {
        label: "Firmware",
        description: "Check firmware updates",
        action: cmd("topgrade --only firmware"),
      },
      {
        label: "Containers",
        description: "Update containers",
        action: cmd("topgrade --only containers"),
      },
      {
        label: "Rust",
        description: "rustup updates",
        action: cmd("topgrade --only rustup"),
      },
      {
        label: "Bun",
        description: "Bun packages",
        action: cmd("topgrade --only bun_packages"),
      },
      {
        label: "VS Code",
        description: "VS Code extensions",
        action: cmd("topgrade --only vscode"),
      },
      {
        label: "mise",
        description: "mise tool versions",
        action: cmd("topgrade --only mise"),
      },
      {
        label: "Cleanup",
        description: "Run with post-cleanup",
        action: cmd("topgrade --cleanup"),
      },
    ],
    [
      "upg",
      "upgrade",
      "packages",
      "pacman",
      "aur",
      "brew",
      "apt",
      "pkg",
      "system",
    ],
    "System",
  ),
  item(
    "omarchy",
    "󰣇",
    "Omarchy",
    "Open Omarchy menu (Super+Alt+Space)",
    silent("omarchy-menu"),
    undefined,
    [
      "om",
      "super",
      "alt",
      "space",
      "hyprland",
      "linux",
      "wm",
      "theme",
      "system",
    ],
    "System",
  ),
  item(
    "reboot-to",
    "󰜉",
    "Reboot To",
    "Reboot into another OS or firmware via EFI boot-next",
    cmd("reboot-to"),
    [
      {
        label: "Windows",
        description: "Reboot into Windows Boot Manager",
        action: cmd("reboot-to windows"),
      },
      {
        label: "Bazzite",
        description: "Reboot into Bazzite",
        action: cmd("reboot-to bazzite"),
      },
      {
        label: "Limine",
        description: "Reboot into Limine bootloader",
        action: cmd("reboot-to limine"),
      },
      {
        label: "UEFI Firmware",
        description: "Reboot into UEFI/BIOS setup",
        action: cmd("reboot-to uefi"),
      },
    ],
    [
      "reboot",
      "boot",
      "windows",
      "bazzite",
      "uefi",
      "firmware",
      "bios",
      "os",
      "system",
    ],
    "System",
  ),
  item(
    "quit",
    "󰗼",
    "Quit",
    "Exit the TUI",
    { type: "quit" },
    undefined,
    ["exit", "quit", "close", ":q", ":wq", ":qa", "bye"],
    "---",
  ),
];

// --- Registry ---

/** All submenu ID → items mappings */
export const submenus: ReadonlyMap<string, readonly MenuItem[]> = new Map();

/** Top-level dot menu items (main menu) */
export const mainMenuItems: readonly MenuItem[] = dotItems;

/** Flat lookup: every menu item by ID */
export const menuItemsById: ReadonlyMap<string, MenuItem> = (() => {
  const map = new Map<string, MenuItem>();
  for (const menuItem of dotItems) {
    map.set(menuItem.id, menuItem);
  }
  for (const items of submenus.values()) {
    for (const menuItem of items) {
      map.set(menuItem.id, menuItem);
    }
  }
  return map;
})();

/** Submenu title lookup by menu ID */
export const submenuTitles: ReadonlyMap<string, string> = new Map();
