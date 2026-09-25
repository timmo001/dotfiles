import QtQuick
import Quickshell
import Quickshell.Io

Item {
  id: root

  property var shell: null
  property var services: []
  property var errors: []
  property var counts: ({})
  property string worst: "ok"
  property string errorText: ""
  property bool loaded: false
  property real currentTime: Date.now()
  property string pendingUnit: ""

  readonly property bool refreshing: statusProcess.running
  readonly property bool actionBusy: actionProcess.running
  readonly property int failedCount: (counts.failed || 0) + (counts.missing || 0)
  readonly property int warningCount: (counts.stale || 0) + (counts.degraded || 0) + (counts.inactive || 0)
  readonly property int attentionCount: failedCount + warningCount + errors.length

  function apply(raw) {
    try {
      var payload = JSON.parse(String(raw || "").trim())
      services = Array.isArray(payload.services) ? payload.services : []
      errors = Array.isArray(payload.errors) ? payload.errors : []
      counts = payload.counts || {}
      worst = String(payload.worst || "ok")
      errorText = ""
      loaded = true
    } catch (error) {
      errorText = "Invalid service status"
    }
  }

  function refresh() {
    if (!statusProcess.running) statusProcess.running = true
  }

  function start(unit) {
    if (actionProcess.running) return
    pendingUnit = unit
    actionProcess.command = ["dot", "services", "start", unit]
    actionProcess.running = true
  }

  function logs(unit) {
    Quickshell.execDetached(["dot", "services", "logs", unit])
  }

  Process {
    id: statusProcess
    command: ["dot", "services", "status", "--json"]
    stdout: StdioCollector {
      waitForEnd: true
      onStreamFinished: root.apply(text)
    }
    onExited: function(exitCode) {
      if (exitCode !== 0) root.errorText = "Could not read service status"
      root.currentTime = Date.now()
    }
  }

  Process {
    id: actionProcess
    stdout: StdioCollector { waitForEnd: true }
    onExited: function(exitCode) {
      if (exitCode !== 0) root.errorText = "Could not start " + root.pendingUnit
      root.pendingUnit = ""
      refreshSoon.restart()
    }
  }

  Timer {
    id: refreshSoon
    interval: 1500
    onTriggered: root.refresh()
  }

  Timer {
    interval: 60000
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
