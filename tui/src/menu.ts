import type { MenuItem, ViewId } from "./types.js"

// --- Helpers ---

function item(
  id: string,
  icon: string,
  title: string,
  description: string,
  action: MenuItem["action"],
): MenuItem {
  return { id, icon, title, description, action }
}

function cmd(command: string, wait = true): MenuItem["action"] {
  return { type: "command", cmd: command, wait }
}

function silent(command: string): MenuItem["action"] {
  return { type: "silent", cmd: command }
}

function view(viewId: ViewId): MenuItem["action"] {
  return { type: "view", viewId }
}

function submenu(menuId: string): MenuItem["action"] {
  return { type: "submenu", menuId }
}

// --- Dot main menu ---

const dotItems: readonly MenuItem[] = [
  item("update", "󰚰", "Update", "Pull repos, stow dotfiles, rebuild", cmd("dot update")),
  item("stow", "󰏗", "Stow", "Re-stow public/private dotfiles", silent("dot stow")),
  item("diff", "󰊢", "Diff", "Repo watcher with change status", view("diff")),
  item("doctor", "󰛯", "Doctor", "Check dependencies and health", cmd("dot doctor")),
  item("system-health", "󰗶", "System Health Check", "Run system-health-check diagnostics", cmd("system-health-check")),
  item("skill-updates", "󰏬", "Skill Updates", "Check imported skills for changes", cmd("dot skill-updates")),
  item("memory", "󰟶", "Memory Refresh", "Refresh OpenCode durable memory", silent("dot memory")),
  item("topgrade", "󰁝", "Topgrade", "System-wide package upgrades", cmd("topgrade")),
  item("omarchy", "󰣇", "Omarchy", "Desktop environment controls", submenu("omarchy")),
]

// --- Omarchy submenus ---

const omarchyTopItems: readonly MenuItem[] = [
  item("omarchy.update", "󰚰", "Update", "Update Omarchy and all components", cmd("omarchy update")),
  item("omarchy.theme", "󰏘", "Theme", "Theme management", submenu("omarchy.theme")),
  item("omarchy.font", "󰛖", "Font", "Font management", submenu("omarchy.font")),
  item("omarchy.toggle", "󰔡", "Toggle", "Toggle system features", submenu("omarchy.toggle")),
  item("omarchy.capture", "󰄀", "Capture", "Screenshots and recordings", submenu("omarchy.capture")),
  item("omarchy.system", "󰐥", "System", "Lock, logout, reboot, shutdown", submenu("omarchy.system")),
  item("omarchy.launch", "󱓞", "Launch", "Launch applications", submenu("omarchy.launch")),
  item("omarchy.refresh", "󰑐", "Refresh", "Refresh system components", submenu("omarchy.refresh")),
  item("omarchy.restart", "󰜉", "Restart", "Restart system services", submenu("omarchy.restart")),
  item("omarchy.install", "󰇚", "Install", "Install software and tools", submenu("omarchy.install")),
  item("omarchy.remove", "󰆴", "Remove", "Remove software and features", submenu("omarchy.remove")),
  item("omarchy.packages", "󰏓", "Packages", "Package management", submenu("omarchy.packages")),
  item("omarchy.share", "󰒗", "Share", "Share clipboard, files, folders", submenu("omarchy.share")),
  item("omarchy.reminder", "󰂞", "Reminder", "Set and manage reminders", submenu("omarchy.reminder")),
  item("omarchy.setup", "󰒓", "Setup", "Setup DNS, security", submenu("omarchy.setup")),
  item("omarchy.snapshot", "󰁯", "Snapshot", "Create and restore snapshots", submenu("omarchy.snapshot")),
  item("omarchy.brightness", "󰃠", "Brightness", "Display and keyboard brightness", submenu("omarchy.brightness")),
  item("omarchy.power", "󰂄", "Power Profile", "Power and performance profiles", submenu("omarchy.power")),
  item("omarchy.version", "󰋼", "Version", "Show Omarchy version", silent("omarchy version")),
  item("omarchy.debug", "󰃤", "Debug", "Run Omarchy debug diagnostics", cmd("omarchy debug --no-sudo --print")),
]

// Theme submenu
const themeItems: readonly MenuItem[] = [
  item("omarchy.theme.set", "󰏘", "Set Theme", "Choose and apply a theme", cmd("omarchy theme set")),
  item("omarchy.theme.bg-next", "󰋩", "Next Background", "Switch to next wallpaper", silent("omarchy theme bg next")),
  item("omarchy.theme.current", "󰋽", "Current Theme", "Show the active theme name", silent("omarchy theme current")),
  item("omarchy.theme.list", "󰽛", "List Themes", "List all available themes", cmd("omarchy theme list")),
  item("omarchy.theme.refresh", "󰑐", "Refresh Theme", "Reapply the current theme", silent("omarchy theme refresh")),
  item("omarchy.theme.bg-install", "󰋩", "Install Backgrounds", "Download additional wallpapers", silent("omarchy theme bg install")),
  item("omarchy.theme.install", "󰇚", "Install Theme", "Install a new theme", cmd("omarchy theme install")),
  item("omarchy.theme.update", "󰚰", "Update Themes", "Update all installed themes", silent("omarchy theme update")),
  item("omarchy.theme.remove", "󰆴", "Remove Theme", "Remove an installed theme", cmd("omarchy theme remove")),
]

// Font submenu
const fontItems: readonly MenuItem[] = [
  item("omarchy.font.set", "󰛖", "Set Font", "Choose and apply a font", cmd("omarchy font set")),
  item("omarchy.font.current", "󰋽", "Current Font", "Show the active font", silent("omarchy font current")),
  item("omarchy.font.list", "󰽛", "List Fonts", "List all available fonts", cmd("omarchy font list")),
]

// Toggle submenu
const toggleItems: readonly MenuItem[] = [
  item("omarchy.toggle.nightlight", "󰙿", "Nightlight", "Toggle blue light filter", silent("omarchy toggle nightlight")),
  item("omarchy.toggle.idle", "󰒲", "Idle Lock", "Toggle idle screen lock", silent("omarchy toggle idle")),
  item("omarchy.toggle.waybar", "󰃎", "Waybar", "Toggle the status bar", silent("omarchy toggle waybar")),
  item("omarchy.toggle.touchpad", "󰟸", "Touchpad", "Toggle touchpad input", silent("omarchy toggle touchpad")),
  item("omarchy.toggle.touchscreen", "󰍶", "Touchscreen", "Toggle touchscreen input", silent("omarchy toggle touchscreen")),
  item("omarchy.toggle.notification", "󰂛", "Notification Silencing", "Toggle notification silencing", silent("omarchy toggle notification silencing")),
  item("omarchy.toggle.suspend", "󰤄", "Suspend", "Toggle suspend on idle", silent("omarchy toggle suspend")),
  item("omarchy.toggle.screensaver", "󰖤", "Screensaver", "Toggle screensaver", silent("omarchy toggle screensaver")),
]

// Capture submenu
const captureItems: readonly MenuItem[] = [
  item("omarchy.capture.screenshot", "󰄀", "Screenshot", "Take a screenshot", silent("omarchy capture screenshot")),
  item("omarchy.capture.recording", "󰕨", "Screen Recording", "Start/stop screen recording", silent("omarchy capture screenrecording")),
  item("omarchy.capture.ocr", "󱄼", "Text Extraction (OCR)", "Extract text from screen", silent("omarchy capture text extraction")),
]

// System submenu
const systemItems: readonly MenuItem[] = [
  item("omarchy.system.lock", "󰌾", "Lock", "Lock the screen", silent("omarchy system lock")),
  item("omarchy.system.logout", "󰍃", "Logout", "Log out of session", silent("omarchy system logout")),
  item("omarchy.system.reboot", "󰜉", "Reboot", "Restart the system", silent("omarchy system reboot")),
  item("omarchy.system.shutdown", "󰤁", "Shutdown", "Power off the system", silent("omarchy system shutdown")),
]

// Launch submenu
const launchItems: readonly MenuItem[] = [
  item("omarchy.launch.browser", "󱣔", "Browser", "Open the default browser", silent("omarchy launch browser")),
  item("omarchy.launch.audio", "󰕾", "Audio Controls", "Open audio mixer", silent("omarchy launch audio")),
  item("omarchy.launch.bluetooth", "󰂯", "Bluetooth", "Open Bluetooth settings", silent("omarchy launch bluetooth")),
  item("omarchy.launch.wifi", "󰖩", "Wi-Fi", "Open Wi-Fi settings", silent("omarchy launch wifi")),
  item("omarchy.launch.about", "󰋽", "About", "Show system information", silent("omarchy launch about")),
  item("omarchy.launch.screensaver", "󰖤", "Screensaver", "Launch screensaver", silent("omarchy launch screensaver")),
  item("omarchy.launch.walker", "󰍉", "Walker", "Open Walker launcher", silent("omarchy launch walker")),
]

// Refresh submenu
const refreshItems: readonly MenuItem[] = [
  item("omarchy.refresh.hyprland", "󰢓", "Hyprland", "Refresh Hyprland config", silent("omarchy refresh hyprland")),
  item("omarchy.refresh.waybar", "󰃎", "Waybar", "Refresh Waybar config", silent("omarchy refresh waybar")),
  item("omarchy.refresh.walker", "󰍉", "Walker", "Refresh Walker config", silent("omarchy refresh walker")),
  item("omarchy.refresh.hypridle", "󰤄", "Hypridle", "Refresh Hypridle config", silent("omarchy refresh hypridle")),
  item("omarchy.refresh.hyprlock", "󰌾", "Hyprlock", "Refresh Hyprlock config", silent("omarchy refresh hyprlock")),
  item("omarchy.refresh.hyprsunset", "󰙿", "Hyprsunset", "Refresh Hyprsunset config", silent("omarchy refresh hyprsunset")),
  item("omarchy.refresh.swayosd", "󰖀", "SwayOSD", "Refresh SwayOSD config", silent("omarchy refresh swayosd")),
  item("omarchy.refresh.tmux", "󰈹", "Tmux", "Refresh Tmux config", silent("omarchy refresh tmux")),
  item("omarchy.refresh.terminal", "󰈹", "Terminal", "Refresh terminal config", silent("omarchy refresh terminal")),
  item("omarchy.refresh.fastfetch", "󰋽", "Fastfetch", "Refresh Fastfetch config", silent("omarchy refresh fastfetch")),
  item("omarchy.refresh.chromium", "󱣔", "Chromium", "Refresh Chromium config", silent("omarchy refresh chromium")),
  item("omarchy.refresh.applications", "󰘔", "Applications", "Refresh desktop application entries", cmd("omarchy refresh applications")),
  item("omarchy.refresh.pacman", "󰏓", "Pacman", "Refresh Pacman databases", cmd("omarchy refresh pacman")),
  item("omarchy.refresh.plymouth", "󰓎", "Plymouth", "Refresh Plymouth boot screen", cmd("omarchy refresh plymouth")),
  item("omarchy.refresh.sddm", "󰩈", "SDDM", "Refresh SDDM display manager", cmd("omarchy refresh sddm")),
]

// Restart submenu
const restartItems: readonly MenuItem[] = [
  item("omarchy.restart.waybar", "󰃎", "Waybar", "Restart Waybar", silent("omarchy restart waybar")),
  item("omarchy.restart.walker", "󰍉", "Walker", "Restart Walker", silent("omarchy restart walker")),
  item("omarchy.restart.pipewire", "󰝟", "Pipewire", "Restart Pipewire audio", silent("omarchy restart pipewire")),
  item("omarchy.restart.bluetooth", "󰂯", "Bluetooth", "Restart Bluetooth", silent("omarchy restart bluetooth")),
  item("omarchy.restart.wifi", "󰖩", "Wi-Fi", "Restart Wi-Fi", silent("omarchy restart wifi")),
  item("omarchy.restart.terminal", "󰈹", "Terminal", "Restart terminal emulator", silent("omarchy restart terminal")),
  item("omarchy.restart.tmux", "󰈹", "Tmux", "Restart Tmux server", silent("omarchy restart tmux")),
  item("omarchy.restart.hyprland", "󰢓", "Hyprland", "Restart Hyprland", silent("omarchy restart hyprctl")),
  item("omarchy.restart.hypridle", "󰤄", "Hypridle", "Restart Hypridle", silent("omarchy restart hypridle")),
  item("omarchy.restart.hyprsunset", "󰙿", "Hyprsunset", "Restart Hyprsunset", silent("omarchy restart hyprsunset")),
  item("omarchy.restart.mako", "󰂞", "Mako", "Restart Mako notifications", silent("omarchy restart mako")),
  item("omarchy.restart.swayosd", "󰖀", "SwayOSD", "Restart SwayOSD", silent("omarchy restart swayosd")),
  item("omarchy.restart.trackpad", "󰓷", "Trackpad", "Restart trackpad gestures", silent("omarchy restart trackpad")),
]

// Install submenu
const installItems: readonly MenuItem[] = [
  item("omarchy.install.browser", "󱣔", "Browser", "Install web browser", cmd("omarchy install browser")),
  item("omarchy.install.dev-env", "󰄡", "Dev Environment", "Install development tools", cmd("omarchy install dev-env")),
  item("omarchy.install.terminal", "󰈹", "Terminal", "Install terminal emulator", cmd("omarchy install terminal")),
  item("omarchy.install.docker-dbs", "󰡨", "Docker Databases", "Install Docker database containers", cmd("omarchy install docker dbs")),
  item("omarchy.install.gaming", "󰺵", "Gaming", "Install gaming tools and Steam", cmd("omarchy install gaming steam")),
  item("omarchy.install.vscode", "󰨞", "VS Code", "Install Visual Studio Code", cmd("omarchy install vscode")),
  item("omarchy.install.zed", "󰄡", "Zed", "Install Zed editor", cmd("omarchy install zed")),
  item("omarchy.install.helix", "󰄡", "Helix", "Install Helix editor", cmd("omarchy install helix")),
  item("omarchy.install.tailscale", "󰨦", "Tailscale", "Install Tailscale VPN", cmd("omarchy install tailscale")),
  item("omarchy.install.nordvpn", "󰨦", "NordVPN", "Install NordVPN", cmd("omarchy install nordvpn")),
  item("omarchy.install.dropbox", "󰇡", "Dropbox", "Install Dropbox client", cmd("omarchy install dropbox")),
]

// Remove submenu
const removeItems: readonly MenuItem[] = [
  item("omarchy.remove.browser", "󱣔", "Browser", "Remove web browser", cmd("omarchy remove browser")),
  item("omarchy.remove.dev-env", "󰄡", "Dev Environment", "Remove development tools", cmd("omarchy remove dev env")),
  item("omarchy.remove.gaming", "󰺵", "Gaming", "Remove gaming tools and Steam", cmd("omarchy remove gaming steam")),
  item("omarchy.remove.preinstalls", "󰏓", "Preinstalls", "Remove preinstalled packages", cmd("omarchy remove preinstalls")),
  item("omarchy.remove.fido2", "󰒃", "Security (FIDO2)", "Remove FIDO2 security setup", cmd("omarchy remove security fido2")),
  item("omarchy.remove.fingerprint", "󰃅", "Security (Fingerprint)", "Remove fingerprint security", cmd("omarchy remove security fingerprint")),
]

// Packages submenu
const packageItems: readonly MenuItem[] = [
  item("omarchy.packages.install", "󰏓", "Install Packages", "Install system packages", cmd("omarchy pkg install")),
  item("omarchy.packages.aur", "󰏓", "Install AUR Packages", "Install AUR packages", cmd("omarchy pkg aur install")),
  item("omarchy.packages.remove", "󰆴", "Remove Packages", "Remove system packages", cmd("omarchy pkg remove")),
]

// Share submenu
const shareItems: readonly MenuItem[] = [
  item("omarchy.share.clipboard", "󰅇", "Clipboard", "Share clipboard contents", silent("omarchy share clipboard")),
  item("omarchy.share.file", "󰈔", "File", "Share a file", silent("omarchy share file")),
  item("omarchy.share.folder", "󰉋", "Folder", "Share a folder", silent("omarchy share folder")),
]

// Reminder submenu
const reminderItems: readonly MenuItem[] = [
  item("omarchy.reminder.set", "󰂞", "Set Reminder", "Set a new reminder (minutes + message)", cmd("omarchy reminder")),
  item("omarchy.reminder.show", "󰽛", "Show Reminders", "List active reminders", cmd("omarchy reminder show")),
  item("omarchy.reminder.clear", "󰆴", "Clear Reminders", "Clear all reminders", silent("omarchy reminder clear")),
]

// Setup submenu
const setupItems: readonly MenuItem[] = [
  item("omarchy.setup.dns", "󱣔", "DNS", "Configure DNS settings", cmd("omarchy setup dns")),
  item("omarchy.setup.fingerprint", "󰃅", "Fingerprint", "Setup fingerprint auth", cmd("omarchy setup security fingerprint")),
  item("omarchy.setup.fido2", "󰒃", "FIDO2", "Setup FIDO2 security key", cmd("omarchy setup security fido2")),
]

// Snapshot submenu
const snapshotItems: readonly MenuItem[] = [
  item("omarchy.snapshot.create", "󰄀", "Create Snapshot", "Create a system snapshot", cmd("omarchy snapshot create")),
  item("omarchy.snapshot.restore", "󰁯", "Restore Snapshot", "Restore from a snapshot", cmd("omarchy snapshot restore")),
]

// Brightness submenu
const brightnessItems: readonly MenuItem[] = [
  item("omarchy.brightness.display-up", "󰃟", "Display +10%", "Increase display brightness", silent("omarchy brightness display +10%")),
  item("omarchy.brightness.display-down", "󰃞", "Display -10%", "Decrease display brightness", silent("omarchy brightness display 10%-")),
  item("omarchy.brightness.display-off", "󰃜", "Display Off", "Turn off display backlight", silent("omarchy brightness display off")),
  item("omarchy.brightness.display-on", "󰃟", "Display On", "Turn on display backlight", silent("omarchy brightness display on")),
  item("omarchy.brightness.keyboard-up", "󰖘", "Keyboard Up", "Increase keyboard brightness", silent("omarchy brightness keyboard up")),
  item("omarchy.brightness.keyboard-down", "󰁅", "Keyboard Down", "Decrease keyboard brightness", silent("omarchy brightness keyboard down")),
  item("omarchy.brightness.keyboard-cycle", "󰓡", "Keyboard Cycle", "Cycle keyboard brightness levels", silent("omarchy brightness keyboard cycle")),
  item("omarchy.brightness.keyboard-off", "󰻳", "Keyboard Off", "Turn off keyboard backlight", silent("omarchy brightness keyboard off")),
]

// Power profile submenu
const powerItems: readonly MenuItem[] = [
  item("omarchy.power.autodetect", "󰁨", "Autodetect", "Automatically choose power profile", silent("omarchy powerprofiles set autodetect")),
  item("omarchy.power.ac", "󰐥", "AC (Performance)", "Performance mode for AC power", silent("omarchy powerprofiles set ac")),
  item("omarchy.power.battery", "󰁺", "Battery (Power Saver)", "Power saver for battery", silent("omarchy powerprofiles set battery")),
]

// --- Registry ---

/** All submenu ID → items mappings */
export const submenus: ReadonlyMap<string, readonly MenuItem[]> = new Map([
  ["omarchy", omarchyTopItems],
  ["omarchy.theme", themeItems],
  ["omarchy.font", fontItems],
  ["omarchy.toggle", toggleItems],
  ["omarchy.capture", captureItems],
  ["omarchy.system", systemItems],
  ["omarchy.launch", launchItems],
  ["omarchy.refresh", refreshItems],
  ["omarchy.restart", restartItems],
  ["omarchy.install", installItems],
  ["omarchy.remove", removeItems],
  ["omarchy.packages", packageItems],
  ["omarchy.share", shareItems],
  ["omarchy.reminder", reminderItems],
  ["omarchy.setup", setupItems],
  ["omarchy.snapshot", snapshotItems],
  ["omarchy.brightness", brightnessItems],
  ["omarchy.power", powerItems],
])

/** Top-level dot menu items (main menu) */
export const mainMenuItems: readonly MenuItem[] = dotItems

/** Flat lookup: every menu item by ID */
export const menuItemsById: ReadonlyMap<string, MenuItem> = (() => {
  const map = new Map<string, MenuItem>()
  for (const menuItem of dotItems) {
    map.set(menuItem.id, menuItem)
  }
  for (const items of submenus.values()) {
    for (const menuItem of items) {
      map.set(menuItem.id, menuItem)
    }
  }
  return map
})()

/** Submenu title lookup by menu ID */
export const submenuTitles: ReadonlyMap<string, string> = new Map([
  ["omarchy", "Omarchy"],
  ["omarchy.theme", "Theme"],
  ["omarchy.font", "Font"],
  ["omarchy.toggle", "Toggle"],
  ["omarchy.capture", "Capture"],
  ["omarchy.system", "System"],
  ["omarchy.launch", "Launch"],
  ["omarchy.refresh", "Refresh"],
  ["omarchy.restart", "Restart"],
  ["omarchy.install", "Install"],
  ["omarchy.remove", "Remove"],
  ["omarchy.packages", "Packages"],
  ["omarchy.share", "Share"],
  ["omarchy.reminder", "Reminder"],
  ["omarchy.setup", "Setup"],
  ["omarchy.snapshot", "Snapshot"],
  ["omarchy.brightness", "Brightness"],
  ["omarchy.power", "Power Profile"],
])
