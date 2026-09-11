import QtQuick
import Quickshell
import Quickshell.Io

Item {
  id: root

  property var shell: null
  property int revision: 0
  readonly property string contextPath: Quickshell.env("XDG_RUNTIME_DIR") + "/dot-herdr-context.json"

  function publish(value) {
    if (value !== null && (!value || typeof value.attached !== "boolean")) value = null
    // FileView skips identical writes; a revision acknowledges unchanged refreshes.
    contextFile.setText(JSON.stringify(Object.assign({ revision: ++revision }, value || {})) + "\n")
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

  IpcHandler {
    target: "timmo.workspace-context"
    function refresh(): void { root.refresh() }
  }

  Component.onCompleted: {
    publish(null)
    watchProcess.running = true
  }
}
