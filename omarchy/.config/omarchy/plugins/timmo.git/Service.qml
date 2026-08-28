import QtQuick
import Quickshell
import Quickshell.Io

Item {
  id: root

  property var shell: null
  property string diffText: ""
  property string diffTooltip: ""
  property string diffClass: "dots-unknown"
  property var repos: []
  property bool diffLoaded: false
  property string diffError: ""
  property var changedRepos: []
  property var otherRepos: []
  property bool panelLoaded: false
  property string panelError: ""
  property var installedAgents: []
  property string notificationText: ""
  property string notificationTooltip: ""
  property string notificationClass: "notifications-unknown"
  property var threads: []
  property bool notificationsLoaded: false
  property string notificationsError: ""

  readonly property bool refreshing: diffProcess.running || panelProcess.running || notificationsProcess.running
  readonly property bool clear: diffLoaded && notificationsLoaded
    && diffError === "" && notificationsError === ""
    && diffClass === "dots-ok" && notificationClass === "hidden"

  function applyDiff(raw) {
    try {
      var payload = JSON.parse(String(raw || "").trim())
      diffText = String(payload.text || "")
      diffTooltip = String(payload.tooltip || "")
      diffClass = String(payload["class"] || "dots-unknown")
      repos = Array.isArray(payload.repos) ? payload.repos : []
      diffLoaded = true
      diffError = ""
    } catch (error) {
      failDiff("Invalid repository response")
    }
  }

  function applyNotifications(raw) {
    try {
      var payload = JSON.parse(String(raw || "").trim())
      notificationText = String(payload.text || "")
      notificationTooltip = String(payload.tooltip || "")
      notificationClass = String(payload["class"] || "notifications-unknown")
      var payloadThreads = Array.isArray(payload.threads) ? payload.threads : []
      threads = notificationClass === "notifications-unknown" ? [] : payloadThreads
      notificationsLoaded = true
      notificationsError = notificationClass === "notifications-unknown"
        ? (notificationTooltip || "GitHub notifications unavailable")
        : ""
    } catch (error) {
      failNotifications("Invalid notification response")
    }
  }

  function applyPanel(raw) {
    try {
      var payload = JSON.parse(String(raw || "").trim())
      changedRepos = Array.isArray(payload.changed) ? payload.changed : []
      otherRepos = Array.isArray(payload.other) ? payload.other : []
      panelLoaded = true
      panelError = ""
    } catch (error) {
      failPanel("Invalid repository panel response")
    }
  }

  function failDiff(message) {
    diffText = ""
    diffTooltip = ""
    repos = []
    diffLoaded = true
    diffError = message
    diffClass = "dots-unknown"
  }

  function failNotifications(message) {
    notificationText = ""
    notificationTooltip = ""
    threads = []
    notificationsLoaded = true
    notificationsError = message
    notificationClass = "notifications-unknown"
  }

  function failPanel(message) {
    changedRepos = []
    otherRepos = []
    panelLoaded = true
    panelError = message
  }

  function refresh() {
    if (!diffProcess.running) diffProcess.running = true
    if (!notificationsProcess.running) notificationsProcess.running = true
  }

  function refreshPanel() {
    if (!panelProcess.running) panelProcess.running = true
  }

  function applyAgents(raw) {
    var commands = String(raw || "").trim().split(/\s+/).filter(function(value) { return value !== "" })
    var labels = {
      "opencode2": "OpenCode 2",
      "opencode": "OpenCode 1",
      "claude": "Claude Code",
      "codex": "Codex",
      "pi": "Pi",
      "cursor": "Cursor Agent",
      "devin": "Devin",
      "omp": "OMP",
      "mastracode": "Mastra Code",
      "copilot": "GitHub Copilot",
      "kimi": "Kimi",
      "kiro": "Kiro",
      "droid": "Droid",
      "grok": "Grok",
      "hermes": "Hermes",
      "kilo": "Kilo",
      "qodercli": "Qoder CLI",
      "qwen": "Qwen",
      "antigravity-cli": "Antigravity CLI"
    }
    installedAgents = commands.map(function(command) {
      return {
        command: command,
        executable: command === "opencode2"
          ? Quickshell.env("HOME") + "/.local/bin/opencode2"
          : (command === "cursor" ? "cursor-agent" : command),
        label: labels[command] || command
      }
    })
  }

  function openRepo(repo, action) {
    if (!repo || !repo.path) return
    var path = String(repo.path)
    if (action === "lazygit-floating")
      Quickshell.execDetached(["uwsm", "app", "--", "xdg-terminal-exec", "--app-id=TUI.float", "--dir=" + path, "lazygit"])
    else if (action === "lazygit")
      Quickshell.execDetached([
        "bash", "-lc",
        "if herdr status server >/dev/null 2>&1; then exec herdr-repo-open \"$1\" \"$2\" Lazygit lazygit; else exec uwsm app -- xdg-terminal-exec --app-id=org.omarchy.terminal --dir=\"$2\" lazygit; fi",
        "bash", String(repo.name || ""), path
      ])
    else if (action === "editor")
      Quickshell.execDetached([
        "bash", "-lc",
        "if herdr status server >/dev/null 2>&1; then exec herdr-repo-open \"$1\" \"$2\" Editor \"nvim .\"; else exec uwsm app -- xdg-terminal-exec --app-id=org.omarchy.terminal --dir=\"$2\" nvim .; fi",
        "bash", String(repo.name || ""), path
      ])
    else if (action === "terminal")
      Quickshell.execDetached([
        "bash", "-lc",
        "if herdr status server >/dev/null 2>&1; then exec herdr-repo-open \"$1\" \"$2\"; else exec uwsm app -- xdg-terminal-exec --app-id=org.omarchy.terminal --dir=\"$2\"; fi",
        "bash", String(repo.name || ""), path
      ])
    else if (action === "web")
      Quickshell.execDetached(["bash", "-lc", "cd \"$1\" && exec gh repo view --web", "bash", path])
  }

  function openAgent(repo, command) {
    if (!repo || !repo.path || !command) return
    var agent = installedAgents.find(function(value) { return value.command === command })
    if (!agent) return
    var path = String(repo.path)
    Quickshell.execDetached([
      "bash", "-lc",
      "if herdr status server >/dev/null 2>&1; then exec herdr-repo-open \"$1\" \"$2\" \"$3\" \"$4\"; else exec uwsm app -- xdg-terminal-exec --app-id=org.omarchy.terminal --dir=\"$2\" \"$4\"; fi",
      "bash", String(repo.name || ""), path, String(agent.label), String(agent.executable)
    ])
  }

  function openNotifications() {
    Quickshell.execDetached(["xdg-open", "https://github.com/notifications"])
  }

  function openThread(thread) {
    if (thread && thread.webUrl) Quickshell.execDetached(["xdg-open", String(thread.webUrl)])
  }

  Process {
    id: agentDiscoveryProcess
    command: [
      "bash", "-lc",
      "status=$(herdr integration status 2>/dev/null) || exit 1; installed() { printf '%s\\n' \"$status\" | grep -Eq \"^$1: (current|outdated)\"; }; if installed opencode && [ -x \"$HOME/.local/bin/opencode2\" ]; then printf 'opencode2\\n'; fi; for name in opencode pi cursor claude codex copilot omp devin droid kimi kilo hermes qodercli qwen mastracode antigravity-cli grok; do installed \"$name\" && printf '%s\\n' \"$name\"; done; exit 0"
    ]
    running: true
    stdout: StdioCollector { id: agentDiscoveryOutput; waitForEnd: true }
    onExited: function(exitCode) {
      if (exitCode === 0) root.applyAgents(agentDiscoveryOutput.text)
      else root.installedAgents = []
    }
  }

  Process {
    id: diffProcess
    command: ["dot", "git-diff", "--bar-json"]
    stdout: StdioCollector { id: diffOutput; waitForEnd: true }
    onExited: function(exitCode) {
      if (exitCode === 0) root.applyDiff(diffOutput.text)
      else root.failDiff("Repository status unavailable")
    }
  }

  Process {
    id: panelProcess
    command: ["dot", "git-diff", "--panel-json"]
    stdout: StdioCollector { id: panelOutput; waitForEnd: true }
    onExited: function(exitCode) {
      if (exitCode === 0) root.applyPanel(panelOutput.text)
      else root.failPanel("Repository panel unavailable")
    }
  }

  Process {
    id: notificationsProcess
    command: ["dot", "git-notifications", "--bar-json"]
    stdout: StdioCollector { id: notificationsOutput; waitForEnd: true }
    onExited: function(exitCode) {
      if (exitCode === 0) root.applyNotifications(notificationsOutput.text)
      else root.failNotifications("GitHub notifications unavailable")
    }
  }

  Timer {
    interval: 60000
    running: true
    repeat: true
    triggeredOnStart: true
    onTriggered: root.refresh()
  }
}
