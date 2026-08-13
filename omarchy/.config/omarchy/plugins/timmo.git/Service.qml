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
  property string notificationText: ""
  property string notificationTooltip: ""
  property string notificationClass: "notifications-unknown"
  property var threads: []
  property bool notificationsLoaded: false
  property string notificationsError: ""

  readonly property bool refreshing: diffProcess.running || notificationsProcess.running
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
      threads = Array.isArray(payload.threads) ? payload.threads : []
      notificationsLoaded = true
      notificationsError = ""
    } catch (error) {
      failNotifications("Invalid notification response")
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

  function refresh() {
    if (!diffProcess.running) diffProcess.running = true
    if (!notificationsProcess.running) notificationsProcess.running = true
  }

  function openDiff(other, repoName) {
    var args = ["uwsm", "app", "--", "xdg-terminal-exec", "--app-id=TUI.float", "-e", "dot", "tui", "git-diff"]
    if (other === true) args.push("--tab", "other")
    else if (repoName) args.push("--repo", String(repoName))
    Quickshell.execDetached(args)
  }

  function openNotifications() {
    Quickshell.execDetached(["uwsm", "app", "--", "xdg-terminal-exec", "--app-id=TUI.float", "-e", "dot", "git-notifications", "--bar-filter"])
  }

  function openThread(thread) {
    if (thread && thread.webUrl) Quickshell.execDetached(["xdg-open", String(thread.webUrl)])
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
