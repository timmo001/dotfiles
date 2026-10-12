// timmo.plannotator-inbox service.
//
// Reads the Plannotator Inbox registry (~/.plannotator/inbox/inbox.json, or
// under PLANNOTATOR_DATA_DIR), lists the running Inbox's threads over its
// loopback API (GET /api/inbox/threads?archived=exclude) and follows its event
// stream (GET /api/inbox/events) so the bar count moves as soon as an agent
// writes. The web app itself stays Plannotator's: opening the Inbox or a
// thread runs dot plannotator inbox, which starts a stopped Inbox and opens
// it as an Omarchy web app.
import QtQuick
import Quickshell
import Quickshell.Io

Item {
  id: root

  property var shell: null

  // Settings handed over by the bar widget (the service is a singleton).
  property string webappUrl: ""
  property int intervalMs: 60000
  property bool live: true

  readonly property string dataDir: {
    var custom = Quickshell.env("PLANNOTATOR_DATA_DIR")
    return custom ? String(custom) : Quickshell.env("HOME") + "/.plannotator"
  }
  readonly property string registryPath: dataDir + "/inbox/inbox.json"

  // The registry entry: { port, url, pid, version, ... }, or null before the
  // Inbox has run once on this machine.
  property var registry: null
  readonly property bool installed: registry !== null
  readonly property int port: registry ? registry.port : 0
  readonly property string apiBase: port > 0 ? "http://127.0.0.1:" + port : ""

  property bool running: false
  property bool loaded: false
  property string errorText: ""
  property string version: ""
  property var sections: []
  property var projects: []
  property int decisionsWaiting: 0
  property var update: null
  property real currentTime: Date.now()

  readonly property bool refreshing: listProcess.running
  readonly property var counts: countSections(sections)
  readonly property int stoppedCount: counts.stopped || 0
  readonly property int holdingCount: counts.holding || 0
  readonly property int waitingCount: counts.waiting || 0
  readonly property int newCount: counts["new"] || 0
  readonly property int sentCount: counts.sent || 0
  readonly property int quietCount: counts.quiet || 0
  // Everything the Inbox lists above Sent: it waits on the person.
  readonly property int attentionCount: stoppedCount + holdingCount + waitingCount + newCount
  readonly property var hostLabels: ({
    "claude-code": "Claude Code",
    "opencode": "OpenCode",
    "pi": "Pi",
    "codex": "Codex",
    "cursor": "Cursor",
    "gemini": "Gemini CLI",
    "copilot": "Copilot",
    "amp": "Amp"
  })

  function countSections(list) {
    var out = {}
    for (var i = 0; i < list.length; i++) {
      var section = list[i]
      out[String(section.id)] = Array.isArray(section.threads) ? section.threads.length : 0
    }
    return out
  }

  function sectionThreads(id) {
    for (var i = 0; i < sections.length; i++)
      if (sections[i].id === id) return Array.isArray(sections[i].threads) ? sections[i].threads : []
    return []
  }

  function sectionLabel(id) {
    for (var i = 0; i < sections.length; i++)
      if (sections[i].id === id) return String(sections[i].label || id)
    return String(id)
  }

  function agentName(author) {
    if (!author || author.kind !== "agent") return "You"
    if (author.name) return String(author.name)
    var host = author.host ? String(author.host) : ""
    return hostLabels[host] || (host !== "" ? host : "Agent")
  }

  function applyRegistry(raw) {
    var entry = null
    try {
      var value = JSON.parse(String(raw || "").trim())
      if (value && typeof value.port === "number" && value.port > 0 && value.port < 65536)
        entry = value
    } catch (error) {}
    var changed = !registry || !entry || registry.port !== entry.port || registry.serverSession !== entry.serverSession
    registry = entry
    if (changed && eventsProcess.running) eventsProcess.running = false
    refresh()
  }

  function applyList(raw) {
    try {
      var payload = JSON.parse(String(raw || "").trim())
      sections = Array.isArray(payload.sections) ? payload.sections : []
      projects = Array.isArray(payload.projects) ? payload.projects : []
      decisionsWaiting = typeof payload.decisions_waiting === "number" ? payload.decisions_waiting : 0
      version = String(payload.version || "")
      update = payload.update || null
      running = true
      errorText = ""
    } catch (error) {
      errorText = "Invalid Inbox response"
    }
    loaded = true
    if (live && running && !eventsProcess.running) eventsProcess.running = true
  }

  function markStopped() {
    running = false
    sections = []
    errorText = ""
    loaded = true
  }

  function refresh() {
    if (!registry) {
      markStopped()
      return
    }
    if (!listProcess.running) listProcess.running = true
  }

  function launchCommand(extra) {
    var command = ["dot", "plannotator", "inbox"]
    if (webappUrl !== "") command.push("--url", webappUrl)
    return command.concat(extra)
  }

  function openInbox() {
    Quickshell.execDetached(launchCommand([]))
    // A stopped Inbox is started by the launcher: pick it up without waiting for the poll.
    refreshSoon.restart()
  }

  function openThread(threadId) {
    if (!threadId) return
    Quickshell.execDetached(launchCommand(["--thread", String(threadId)]))
  }

  onLiveChanged: {
    if (!live) eventsProcess.running = false
    else if (running && !eventsProcess.running) eventsProcess.running = true
  }

  FileView {
    id: registryFile
    path: root.registryPath
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: root.applyRegistry(text())
    onLoadFailed: root.applyRegistry("")
  }

  Process {
    id: listProcess
    command: ["curl", "-sf", "--max-time", "5", "-H", "Accept: application/json",
      root.apiBase + "/api/inbox/threads?archived=exclude"]
    stdout: StdioCollector { id: listOutput; waitForEnd: true }
    onExited: function(exitCode) {
      if (exitCode === 0) root.applyList(listOutput.text)
      else root.markStopped()
      root.currentTime = Date.now()
    }
  }

  // The Inbox's server-sent events: any event line (hello, record, status)
  // means the list may have changed. Lines are debounced into one refresh.
  Process {
    id: eventsProcess
    command: ["curl", "-sN", "-H", "Accept: text/event-stream", root.apiBase + "/api/inbox/events"]
    stdout: SplitParser {
      onRead: function(line) {
        if (String(line).indexOf("event:") === 0) refreshSoon.restart()
      }
    }
    onRunningChanged: if (!running) {
      // Dropped: find out whether the Inbox stopped, and reconnect if it did not.
      refreshSoon.restart()
      eventsRestart.restart()
    }
  }

  Timer {
    id: eventsRestart
    interval: 15000
    onTriggered: if (root.live && root.running && !eventsProcess.running) eventsProcess.running = true
  }

  Timer {
    id: refreshSoon
    interval: 400
    onTriggered: root.refresh()
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
