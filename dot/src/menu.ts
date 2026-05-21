import type { MenuItem, MenuVariant, NotifyConfig, ViewId } from "./types.js";

// --- Helpers ---

function item(
  id: string,
  icon: string,
  title: string,
  description: string,
  action: MenuItem["action"],
  variants?: readonly MenuVariant[],
  keywords?: readonly string[],
): MenuItem {
  return {
    id,
    icon,
    title,
    description,
    action,
    ...(variants && { variants }),
    ...(keywords && { keywords }),
  };
}

function cmd(command: string, wait = true): MenuItem["action"] {
  return { type: "command", cmd: command, wait };
}

function silent(command: string): MenuItem["action"] {
  return { type: "silent", cmd: command };
}

function notify(command: string, config: NotifyConfig): MenuItem["action"] {
  return { type: "notify", cmd: command, notify: config };
}

function view(viewId: ViewId): MenuItem["action"] {
  return { type: "view", viewId };
}

function submenu(menuId: string): MenuItem["action"] {
  return { type: "submenu", menuId };
}

// --- Dot main menu ---

const dotItems: readonly MenuItem[] = [
  item(
    "update",
    "󰚰",
    "Update",
    "Pull repos, stow dotfiles, rebuild",
    cmd("dot update"),
    [
      {
        label: "Full",
        description: "Pull, stow, rebuild TUI, run hooks",
        action: cmd("dot update"),
      },
      {
        label: "Pull",
        description: "Pull all repos (dotfiles, private, omarchy)",
        action: cmd("dot update --pull"),
      },
      {
        label: "Stow",
        description: "Re-stow dotfiles without pulling",
        action: cmd("dot update --stow"),
      },
      {
        label: "TUI",
        description: "Rebuild dot binary only",
        action: cmd("dot update --tui"),
      },
    ],
    ["upd", "pull", "fetch", "sync", "refresh", "rebuild"],
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
  ),
  item(
    "diff",
    "󰊢",
    "Diff",
    "Repo watcher with change status",
    view("diff"),
    undefined,
    ["chg", "changes", "status", "git", "repos", "modified", "dirty"],
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
    ["doc", "health", "check", "diagnose", "deps", "dependencies"],
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
    ["resume", "suspend", "sleep", "wake", "waybar", "restart"],
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
        description: "Update clean skills, review local-edit conflicts in OpenCode",
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
    ["sk", "skills", "plugins", "upstream", "agents"],
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
    ],
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
    ["upg", "upgrade", "packages", "pacman", "aur", "brew", "apt", "pkg"],
  ),
  item(
    "omarchy",
    "󰣇",
    "Omarchy",
    "Desktop environment controls",
    submenu("omarchy"),
    undefined,
    ["om", "hyprland", "waybar", "linux", "wm", "theme"],
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
    ["reboot", "boot", "windows", "bazzite", "uefi", "firmware", "bios", "os"],
  ),
  item("quit", "󰗼", "Quit", "Exit the TUI", { type: "quit" }, undefined, [
    "exit",
    "quit",
    "close",
    ":q",
    ":wq",
    ":qa",
    "bye",
  ]),
];

// --- Omarchy top-level ---
// Items with walker menu entry points are launched via `omarchy-menu <arg>` (silent).
// Items without walker entry points are kept as TUI submenus.

const omarchyTopItems: readonly MenuItem[] = [
  item(
    "omarchy.update",
    "󰚰",
    "Update",
    "Update Omarchy and all components",
    cmd("omarchy update -y"),
    [
      {
        label: "Full",
        description: "Full update pipeline",
        action: cmd("omarchy update -y"),
      },
      {
        label: "Git only",
        description: "Pull latest Omarchy changes",
        action: cmd("omarchy update git"),
      },
      {
        label: "System pkgs",
        description: "Update pacman packages",
        action: cmd("omarchy update system pkgs"),
      },
      {
        label: "AUR pkgs",
        description: "Update AUR packages",
        action: cmd("omarchy update aur pkgs"),
      },
      {
        label: "Firmware",
        description: "Firmware via fwupd",
        action: cmd("omarchy update firmware"),
      },
      {
        label: "Keyring",
        description: "Refresh keyrings",
        action: cmd("omarchy update keyring"),
      },
    ],
  ),

  // Walker menu launches
  item(
    "omarchy.theme",
    "󰏘",
    "Theme",
    "Choose and apply a theme",
    silent("omarchy-menu theme"),
  ),
  item(
    "omarchy.font",
    "󰛖",
    "Font",
    "Choose and apply a font",
    silent("omarchy-menu style"),
  ),
  item(
    "omarchy.toggle",
    "󰔡",
    "Toggle",
    "Toggle system features",
    silent("omarchy-menu toggle"),
  ),
  item(
    "omarchy.system",
    "󰐥",
    "System",
    "Lock, logout, reboot, shutdown",
    silent("omarchy-menu system"),
  ),
  item(
    "omarchy.launch",
    "󱓞",
    "Launch",
    "Launch applications",
    silent("omarchy-menu apps"),
  ),
  item(
    "omarchy.install",
    "󰇚",
    "Install",
    "Install software and tools",
    silent("omarchy-menu install"),
  ),
  item(
    "omarchy.remove",
    "󰆴",
    "Remove",
    "Remove software and features",
    silent("omarchy-menu remove"),
  ),
  item(
    "omarchy.share",
    "󰒗",
    "Share",
    "Share clipboard, files, folders",
    silent("omarchy-menu share"),
  ),
  item(
    "omarchy.reminder",
    "󰂞",
    "Reminder",
    "Set and manage reminders",
    silent("omarchy-menu reminder"),
  ),
  item(
    "omarchy.setup",
    "󰒓",
    "Setup",
    "Setup DNS, security",
    silent("omarchy-menu setup"),
  ),
  item(
    "omarchy.power",
    "󰂄",
    "Power Profile",
    "Power and performance profiles",
    silent("omarchy-menu power"),
  ),

  // TUI submenus (no walker entry point)
  item(
    "omarchy.refresh",
    "󰑐",
    "Refresh",
    "Refresh system components",
    submenu("omarchy.refresh"),
  ),
  item(
    "omarchy.restart",
    "󰜉",
    "Restart",
    "Restart system services",
    submenu("omarchy.restart"),
  ),
  item(
    "omarchy.packages",
    "󰏓",
    "Packages",
    "Package management",
    submenu("omarchy.packages"),
  ),
  item(
    "omarchy.snapshot",
    "󰁯",
    "Snapshot",
    "Create and restore snapshots",
    submenu("omarchy.snapshot"),
  ),
  item(
    "omarchy.brightness",
    "󰃠",
    "Brightness",
    "Display and keyboard brightness",
    submenu("omarchy.brightness"),
  ),

  // Direct commands
  item(
    "omarchy.version",
    "󰋼",
    "Version",
    "Show Omarchy version",
    cmd("omarchy version"),
  ),
  item(
    "omarchy.debug",
    "󰃤",
    "Debug",
    "Run Omarchy debug diagnostics",
    cmd("omarchy debug --no-sudo --print"),
  ),
];

// --- TUI submenus (kept because no walker entry point) ---

// Refresh submenu
const refreshItems: readonly MenuItem[] = [
  item(
    "omarchy.refresh.hyprland",
    "󰢓",
    "Hyprland",
    "Refresh Hyprland config",
    notify("omarchy refresh hyprland", {
      id: "refresh.hyprland",
      progress: "Refreshing Hyprland...",
      success: "Hyprland refreshed",
    }),
  ),
  item(
    "omarchy.refresh.waybar",
    "󰃎",
    "Waybar",
    "Refresh Waybar config",
    notify("omarchy refresh waybar", {
      id: "refresh.waybar",
      progress: "Refreshing Waybar...",
      success: "Waybar refreshed",
    }),
  ),
  item(
    "omarchy.refresh.walker",
    "󰍉",
    "Walker",
    "Refresh Walker config",
    notify("omarchy refresh walker", {
      id: "refresh.walker",
      progress: "Refreshing Walker...",
      success: "Walker refreshed",
    }),
  ),
  item(
    "omarchy.refresh.hypridle",
    "󰤄",
    "Hypridle",
    "Refresh Hypridle config",
    notify("omarchy refresh hypridle", {
      id: "refresh.hypridle",
      progress: "Refreshing Hypridle...",
      success: "Hypridle refreshed",
    }),
  ),
  item(
    "omarchy.refresh.hyprlock",
    "󰌾",
    "Hyprlock",
    "Refresh Hyprlock config",
    notify("omarchy refresh hyprlock", {
      id: "refresh.hyprlock",
      progress: "Refreshing Hyprlock...",
      success: "Hyprlock refreshed",
    }),
  ),
  item(
    "omarchy.refresh.hyprsunset",
    "󰙿",
    "Hyprsunset",
    "Refresh Hyprsunset config",
    notify("omarchy refresh hyprsunset", {
      id: "refresh.hyprsunset",
      progress: "Refreshing Hyprsunset...",
      success: "Hyprsunset refreshed",
    }),
  ),
  item(
    "omarchy.refresh.swayosd",
    "󰖀",
    "SwayOSD",
    "Refresh SwayOSD config",
    notify("omarchy refresh swayosd", {
      id: "refresh.swayosd",
      progress: "Refreshing SwayOSD...",
      success: "SwayOSD refreshed",
    }),
  ),
  item(
    "omarchy.refresh.tmux",
    "󰈹",
    "Tmux",
    "Refresh Tmux config",
    notify("omarchy refresh tmux", {
      id: "refresh.tmux",
      progress: "Refreshing Tmux...",
      success: "Tmux refreshed",
    }),
  ),
  item(
    "omarchy.refresh.fastfetch",
    "󰋽",
    "Fastfetch",
    "Refresh Fastfetch config",
    notify("omarchy refresh fastfetch", {
      id: "refresh.fastfetch",
      progress: "Refreshing Fastfetch...",
      success: "Fastfetch refreshed",
    }),
  ),
  item(
    "omarchy.refresh.chromium",
    "󱣔",
    "Chromium",
    "Refresh Chromium config",
    notify("omarchy refresh chromium", {
      id: "refresh.chromium",
      progress: "Refreshing Chromium...",
      success: "Chromium refreshed",
    }),
  ),
  item(
    "omarchy.refresh.applications",
    "󰘔",
    "Applications",
    "Refresh desktop application entries",
    cmd("omarchy refresh applications"),
  ),
  item(
    "omarchy.refresh.pacman",
    "󰏓",
    "Pacman",
    "Refresh Pacman databases",
    cmd("omarchy refresh pacman"),
  ),
  item(
    "omarchy.refresh.plymouth",
    "󰓎",
    "Plymouth",
    "Refresh Plymouth boot screen",
    cmd("omarchy refresh plymouth"),
  ),
  item(
    "omarchy.refresh.sddm",
    "󰩈",
    "SDDM",
    "Refresh SDDM display manager",
    cmd("omarchy refresh sddm"),
  ),
];

// Restart submenu
const restartItems: readonly MenuItem[] = [
  item(
    "omarchy.restart.waybar",
    "󰃎",
    "Waybar",
    "Restart Waybar",
    notify("omarchy restart waybar", {
      id: "restart.waybar",
      progress: "Restarting Waybar...",
      success: "Waybar restarted",
    }),
  ),
  item(
    "omarchy.restart.walker",
    "󰍉",
    "Walker",
    "Restart Walker",
    notify("omarchy restart walker", {
      id: "restart.walker",
      progress: "Restarting Walker...",
      success: "Walker restarted",
    }),
  ),
  item(
    "omarchy.restart.pipewire",
    "󰝟",
    "Pipewire",
    "Restart Pipewire audio",
    notify("omarchy restart pipewire", {
      id: "restart.pipewire",
      progress: "Restarting Pipewire...",
      success: "Pipewire restarted",
    }),
  ),
  item(
    "omarchy.restart.bluetooth",
    "󰂯",
    "Bluetooth",
    "Restart Bluetooth",
    notify("omarchy restart bluetooth", {
      id: "restart.bluetooth",
      progress: "Restarting Bluetooth...",
      success: "Bluetooth restarted",
    }),
  ),
  item(
    "omarchy.restart.wifi",
    "󰖩",
    "Wi-Fi",
    "Restart Wi-Fi",
    notify("omarchy restart wifi", {
      id: "restart.wifi",
      progress: "Restarting Wi-Fi...",
      success: "Wi-Fi restarted",
    }),
  ),
  item(
    "omarchy.restart.terminal",
    "󰈹",
    "Terminal",
    "Restart terminal emulator",
    notify("omarchy restart terminal", {
      id: "restart.terminal",
      progress: "Restarting terminal...",
      success: "Terminal restarted",
    }),
  ),
  item(
    "omarchy.restart.tmux",
    "󰈹",
    "Tmux",
    "Restart Tmux server",
    notify("omarchy restart tmux", {
      id: "restart.tmux",
      progress: "Restarting Tmux...",
      success: "Tmux restarted",
    }),
  ),
  item(
    "omarchy.restart.hyprland",
    "󰢓",
    "Hyprland",
    "Restart Hyprland",
    notify("omarchy restart hyprctl", {
      id: "restart.hyprland",
      progress: "Restarting Hyprland...",
      success: "Hyprland restarted",
    }),
  ),
  item(
    "omarchy.restart.hypridle",
    "󰤄",
    "Hypridle",
    "Restart Hypridle",
    notify("omarchy restart hypridle", {
      id: "restart.hypridle",
      progress: "Restarting Hypridle...",
      success: "Hypridle restarted",
    }),
  ),
  item(
    "omarchy.restart.hyprsunset",
    "󰙿",
    "Hyprsunset",
    "Restart Hyprsunset",
    notify("omarchy restart hyprsunset", {
      id: "restart.hyprsunset",
      progress: "Restarting Hyprsunset...",
      success: "Hyprsunset restarted",
    }),
  ),
  item(
    "omarchy.restart.mako",
    "󰂞",
    "Mako",
    "Restart Mako notifications",
    notify("omarchy restart mako", {
      id: "restart.mako",
      progress: "Restarting Mako...",
      success: "Mako restarted",
    }),
  ),
  item(
    "omarchy.restart.swayosd",
    "󰖀",
    "SwayOSD",
    "Restart SwayOSD",
    notify("omarchy restart swayosd", {
      id: "restart.swayosd",
      progress: "Restarting SwayOSD...",
      success: "SwayOSD restarted",
    }),
  ),
  item(
    "omarchy.restart.trackpad",
    "󰓷",
    "Trackpad",
    "Restart trackpad gestures",
    notify("omarchy restart trackpad", {
      id: "restart.trackpad",
      progress: "Restarting trackpad...",
      success: "Trackpad restarted",
    }),
  ),
];

// Packages submenu
const packageItems: readonly MenuItem[] = [
  item(
    "omarchy.packages.install",
    "󰏓",
    "Install Packages",
    "Install system packages",
    cmd("omarchy pkg install"),
  ),
  item(
    "omarchy.packages.aur",
    "󰏓",
    "Install AUR Packages",
    "Install AUR packages",
    cmd("omarchy pkg aur install"),
  ),
  item(
    "omarchy.packages.remove",
    "󰆴",
    "Remove Packages",
    "Remove system packages",
    cmd("omarchy pkg remove"),
  ),
];

// Snapshot submenu
const snapshotItems: readonly MenuItem[] = [
  item(
    "omarchy.snapshot.create",
    "󰄀",
    "Create Snapshot",
    "Create a system snapshot",
    cmd("omarchy snapshot create"),
  ),
  item(
    "omarchy.snapshot.restore",
    "󰁯",
    "Restore Snapshot",
    "Restore from a snapshot",
    cmd("omarchy snapshot restore"),
  ),
];

// Brightness submenu
const brightnessItems: readonly MenuItem[] = [
  item(
    "omarchy.brightness.display-up",
    "󰃟",
    "Display +10%",
    "Increase display brightness",
    silent("omarchy brightness display +10%"),
  ),
  item(
    "omarchy.brightness.display-down",
    "󰃞",
    "Display -10%",
    "Decrease display brightness",
    silent("omarchy brightness display 10%-"),
  ),
  item(
    "omarchy.brightness.keyboard-up",
    "󰖘",
    "Keyboard Up",
    "Increase keyboard brightness",
    silent("omarchy brightness keyboard up"),
  ),
  item(
    "omarchy.brightness.keyboard-down",
    "󰁅",
    "Keyboard Down",
    "Decrease keyboard brightness",
    silent("omarchy brightness keyboard down"),
  ),
  item(
    "omarchy.brightness.keyboard-cycle",
    "󰓡",
    "Keyboard Cycle",
    "Cycle keyboard brightness levels",
    silent("omarchy brightness keyboard cycle"),
  ),
  item(
    "omarchy.brightness.keyboard-off",
    "󰻳",
    "Keyboard Off",
    "Turn off keyboard backlight",
    silent("omarchy brightness keyboard off"),
  ),
];

// --- Registry ---

/** All submenu ID → items mappings */
export const submenus: ReadonlyMap<string, readonly MenuItem[]> = new Map([
  ["omarchy", omarchyTopItems],
  ["omarchy.refresh", refreshItems],
  ["omarchy.restart", restartItems],
  ["omarchy.packages", packageItems],
  ["omarchy.snapshot", snapshotItems],
  ["omarchy.brightness", brightnessItems],
]);

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
export const submenuTitles: ReadonlyMap<string, string> = new Map([
  ["omarchy", "Omarchy"],
  ["omarchy.refresh", "Refresh"],
  ["omarchy.restart", "Restart"],
  ["omarchy.packages", "Packages"],
  ["omarchy.snapshot", "Snapshot"],
  ["omarchy.brightness", "Brightness"],
]);
