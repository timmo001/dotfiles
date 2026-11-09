// timmo.games service.
//
// Reads the game shortcuts and gaming mode's state from `dot game list --json`,
// and launches games through `dot game launch`, detached so closing the panel
// never ends a game.
import QtQuick
import Quickshell
import Quickshell.Io

Item {
  id: root

  property var shell: null

  property bool loaded: false
  property string errorText: ""
  property bool active: false
  property int holders: 0
  property var games: []

  readonly property bool refreshing: listProcess.running

  function apply(raw) {
    try {
      const list = JSON.parse(String(raw || "").trim())
      active = list.active === true
      holders = Number(list.holders) || 0
      games = Array.isArray(list.games) ? list.games : []
      errorText = ""
    } catch (error) {
      errorText = "dot game list gave something it couldn't read"
    }
    loaded = true
  }

  function fail(raw) {
    const text = String(raw || "").trim().split("\n").pop()
    errorText = text !== "" ? text : "dot game list failed"
    loaded = true
  }

  function refresh() {
    if (!listProcess.running) listProcess.running = true
  }

  function launch(url) {
    if (url) Quickshell.execDetached(["dot", "game", "launch", String(url)])
  }

  function turnOff() {
    Quickshell.execDetached(["dot", "game", "off"])
    active = false
    holders = 0
  }

  Process {
    id: listProcess
    command: ["dot", "game", "list", "--json"]
    stdout: StdioCollector { id: listOutput; waitForEnd: true }
    stderr: StdioCollector { id: listErrors; waitForEnd: true }
    onExited: function(exitCode) {
      if (exitCode === 0) root.apply(listOutput.text)
      else root.fail(listErrors.text)
    }
  }

  Component.onCompleted: refresh()
}
