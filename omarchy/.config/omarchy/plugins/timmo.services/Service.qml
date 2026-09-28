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
  property var installedAgents: []
  property string agentLaunchError: ""
  property string copiedUnit: ""

  readonly property bool refreshing: statusProcess.running
  readonly property bool actionBusy: actionProcess.running
  readonly property bool agentLaunching: agentLaunchProcess.running

  signal agentOpened()
  readonly property int failedCount: (counts.failed || 0) + (counts.missing || 0)
  readonly property int warningCount: (counts.warning || 0) + (counts.stale || 0) + (counts.degraded || 0) + (counts.inactive || 0)
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

  function copyRunLogs(unit) {
    if (copyProcess.running) return
    copyProcess.unit = unit
    copyProcess.command = ["bash", "-c", "set -o pipefail; dot services run-logs \"$1\" | wl-copy", "bash", unit]
    copyProcess.running = true
  }

  Process {
    id: copyProcess
    property string unit: ""
    onExited: function(exitCode) {
      if (exitCode === 0) {
        root.copiedUnit = copyProcess.unit
        copiedReset.restart()
      } else root.errorText = "Could not copy logs for " + copyProcess.unit
    }
  }

  Timer {
    id: copiedReset
    interval: 2000
    onTriggered: root.copiedUnit = ""
  }

  function applyAgents(raw) {
    try { installedAgents = JSON.parse(String(raw || "[]")) }
    catch (error) { installedAgents = [] }
  }

  function openAgent(status, command, modifiers) {
    if (!status || !command || agentLaunching) return
    if (!installedAgents.some(function(value) { return value.command === command })) return
    agentLaunchError = ""
    agentLaunchProcess.command = ["dot", "services", "investigate", String(status.unit),
      "--agent", String(command), "--modifiers", String(modifiers || 0)]
    agentLaunchProcess.running = true
  }

  Process {
    id: agentLaunchProcess
    stderr: StdioCollector { id: agentLaunchStderr; waitForEnd: true }
    onExited: function(exitCode) {
      if (exitCode === 0) root.agentOpened()
      else root.agentLaunchError = String(agentLaunchStderr.text || "Could not open the agent").trim().slice(0, 500)
    }
  }

  Process {
    id: agentDiscoveryProcess
    command: ["dot", "herdr", "agents"]
    running: true
    stdout: StdioCollector { id: agentDiscoveryOutput; waitForEnd: true }
    onExited: function(exitCode) {
      if (exitCode === 0) root.applyAgents(agentDiscoveryOutput.text)
      else root.installedAgents = []
    }
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
