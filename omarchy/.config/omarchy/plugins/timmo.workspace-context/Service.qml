import QtQuick
import Quickshell
import Quickshell.Io

Item {
  id: root

  property var shell: null
  property int revision: 0
  property var context: null
  property bool quiet: false
  readonly property string contextPath: Quickshell.env("XDG_RUNTIME_DIR") + "/dot-herdr-context.json"
  // Matches the hours the dot service timers skip overnight.
  readonly property string quietStart: "01:00"
  readonly property string quietEnd: "07:00"

  function minutes(time) {
    return Number(time.slice(0, 2)) * 60 + Number(time.slice(3))
  }

  // Quiet while inside the overnight hours with no Herdr terminal attached.
  function quietNow() {
    if (context && context.attached === true) return false
    var now = new Date()
    var current = now.getHours() * 60 + now.getMinutes()
    var start = minutes(quietStart)
    var end = minutes(quietEnd)
    return start <= end ? current >= start && current < end : current >= start || current < end
  }

  function publish(value) {
    if (value !== null && (!value || typeof value.attached !== "boolean")) value = null
    context = value
    quiet = quietNow()
    // FileView skips identical writes; a revision acknowledges unchanged refreshes.
    contextFile.setText(JSON.stringify(Object.assign({ revision: ++revision }, value || {}, { quiet: quiet })) + "\n")
  }

  function refresh() {
    if (watchProcess.startedSuccessfully) watchProcess.write("refresh\n")
    else {
      restartTimer.stop()
      watchProcess.running = true
    }
  }

  FileView {
    id: contextFile
    path: root.contextPath
    atomicWrites: true
  }

  Process {
    id: watchProcess
    property bool startedSuccessfully: false
    command: ["dot", "herdr", "context", "--watch", "--json"]
    stdinEnabled: true
    onStarted: startedSuccessfully = true
    stdout: SplitParser {
      onRead: function(line) {
        try { root.publish(JSON.parse(line)) }
        catch (error) { root.publish(null) }
      }
    }
    onRunningChanged: if (!running) {
      startedSuccessfully = false
      root.publish(null)
      restartTimer.restart()
    }
  }

  Timer {
    id: restartTimer
    interval: 5000
    onTriggered: watchProcess.running = true
  }

  Timer {
    interval: 30000
    running: true
    repeat: true
    onTriggered: if (root.quietNow() !== root.quiet) root.publish(root.context)
  }

  IpcHandler {
    target: "timmo.workspace-context"
    function refresh(): void { root.refresh() }
  }

  Component.onCompleted: {
    publish(null)
    watchProcess.running = true
  }
}
