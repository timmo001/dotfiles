// timmo.upkeep service.
//
// Reads `upkeep status --json`, the same status the CLI, the OpenCode footer
// and the dashboard show, and opens what needs you at its dashboard page.
// Links go to the dashboard's direct address, never Home Assistant's ingress,
// so each one lands on its page.
import QtQuick
import Quickshell
import Quickshell.Io

Item {
  id: root

  property var shell: null

  // Settings handed over by the bar widget (the service is a singleton).
  property string dashboardUrl: ""
  property int intervalMs: 60000

  readonly property string baseUrl: {
    var url = dashboardUrl !== "" ? dashboardUrl : String(Quickshell.env("UPKEEP_SERVER") || "")
    return url.replace(/\/+$/, "")
  }

  property bool loaded: false
  property string errorText: ""
  property string health: ""
  property string summary: ""
  property var needs: []
  property var workers: []
  property string barText: ""
  property real currentTime: Date.now()

  readonly property bool refreshing: statusProcess.running
  readonly property int count: needs.length
  readonly property var needsYou: needs.filter(function(item) { return item.kind !== "skill-change" })
  readonly property var skillChanges: needs.filter(function(item) { return item.kind === "skill-change" })

  function apply(raw) {
    try {
      const status = JSON.parse(String(raw || "").trim())
      health = String(status.health || "")
      summary = String(status.summary || "")
      needs = Array.isArray(status.needs) ? status.needs : []
      workers = Array.isArray(status.workers) ? status.workers : []
      barText = status.bar ? String(status.bar.text || "") : ""
      errorText = ""
    } catch (error) {
      errorText = "upkeep status gave something it couldn't read"
    }
    loaded = true
  }

  function fail(raw) {
    var text = String(raw || "").trim().split("\n")[0]
    errorText = text !== "" ? text : "upkeep status failed"
    loaded = true
  }

  function refresh() {
    if (!statusProcess.running) statusProcess.running = true
  }

  function urlFor(path) {
    if (baseUrl === "") return ""
    var page = String(path || "").replace(/^\/+/, "")
    return page === "" ? baseUrl + "/" : baseUrl + "/" + page
  }

  function openPath(path) {
    var url = urlFor(path)
    if (url !== "") Quickshell.execDetached(["xdg-open", url])
  }

  function openDashboard() {
    openPath("")
  }

  Process {
    id: statusProcess
    command: ["upkeep", "status", "--json"]
    stdout: StdioCollector { id: statusOutput; waitForEnd: true }
    stderr: StdioCollector { id: statusErrors; waitForEnd: true }
    onExited: function(exitCode) {
      if (exitCode === 0) root.apply(statusOutput.text)
      else root.fail(statusErrors.text)
      root.currentTime = Date.now()
    }
  }

  Timer {
    interval: Math.max(5000, root.intervalMs)
    running: true
    repeat: true
    triggeredOnStart: true
    onTriggered: root.refresh()
  }

  Timer {
    interval: 30000
    running: true
    repeat: true
    onTriggered: root.currentTime = Date.now()
  }
}
