// timmo.agent-screen - shows the headless AGENT output (dot agent screen) live
// while it's on, so the user can watch what agents do there.
//
// Modes, set through the `timmo.agent-screen` IPC target (dot agent screen
// view drives it, and Super + Alt + A steps through them):
//   overlay     a translucent view in the corner of the focused monitor.
//               Clicks pass through it to whatever is underneath.
//   fullscreen  the same view filling the focused monitor. Escape or a click
//               goes back to the overlay.
//   hidden      nothing, such as while the view is a tiled wl-mirror window.
// The mode goes back to overlay whenever the agent screen goes away, so the
// next recording shows again.
import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import Quickshell.Wayland
import qs.Commons
import qs.Commons as Commons

Item {
  id: root

  property var shell: null
  property var manifest: null

  readonly property string outputName: "AGENT"
  property string mode: "overlay"

  // How much of the monitor's width the corner view takes, and how much shows
  // through it
  readonly property real overlayWidthShare: 0.3
  readonly property real overlayOpacity: 0.6
  readonly property int margin: Style.space(24)

  readonly property var agentScreen: {
    var screens = Quickshell.screens
    for (var i = 0; i < screens.length; i++) {
      if (String(screens[i].name || "") === root.outputName) return screens[i]
    }
    return null
  }

  // The monitor the user is on, never the agent screen itself
  readonly property var targetScreen: {
    var screens = Quickshell.screens
    var monitor = Hyprland.focusedMonitor
    var name = monitor ? String(monitor.name || "") : ""
    var fallback = null
    for (var i = 0; i < screens.length; i++) {
      var screenName = String(screens[i].name || "")
      if (screenName === root.outputName) continue
      if (screenName === name) return screens[i]
      if (!fallback) fallback = screens[i]
    }
    return fallback
  }

  readonly property real aspect: root.agentScreen && root.agentScreen.width > 0
    ? root.agentScreen.height / root.agentScreen.width
    : 9 / 16

  onAgentScreenChanged: {
    if (!root.agentScreen) root.mode = "overlay"
  }

  function setMode(next) {
    var value = String(next || "")
    if (value !== "overlay" && value !== "fullscreen" && value !== "hidden") return "unknown mode: " + value
    root.mode = value
    return "ok"
  }

  IpcHandler {
    target: "timmo.agent-screen"
    function show(mode: string): string { return root.setMode(mode) }
    function state(): string {
      return JSON.stringify({ on: root.agentScreen !== null, mode: root.mode })
    }
  }

  PanelWindow {
    id: corner
    visible: root.agentScreen !== null && root.targetScreen !== null && root.mode === "overlay"
    screen: root.targetScreen
    anchors { bottom: true; right: true }
    margins { bottom: root.margin; right: root.margin }
    implicitWidth: Math.round((root.targetScreen ? root.targetScreen.width : 1280) * root.overlayWidthShare)
    implicitHeight: Math.round(corner.implicitWidth * root.aspect)
    color: "transparent"
    WlrLayershell.namespace: "timmo-agent-screen"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
    exclusionMode: ExclusionMode.Ignore
    // An empty input region, so every click lands on what's underneath
    mask: Region {}

    Item {
      anchors.fill: parent
      opacity: root.overlayOpacity

      ScreencopyView {
        anchors.fill: parent
        captureSource: corner.visible ? root.agentScreen : null
        live: true
      }

      Rectangle {
        anchors.fill: parent
        color: "transparent"
        border.width: Math.max(1, Style.space(2))
        border.color: Commons.Color.popups.border
        radius: Style.cornerRadius
      }
    }
  }

  PanelWindow {
    id: full
    visible: root.agentScreen !== null && root.targetScreen !== null && root.mode === "fullscreen"
    screen: root.targetScreen
    anchors { top: true; bottom: true; left: true; right: true }
    color: "black"
    WlrLayershell.namespace: "timmo-agent-screen-full"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive
    exclusionMode: ExclusionMode.Ignore

    Item {
      anchors.fill: parent
      focus: true
      Keys.onEscapePressed: root.mode = "overlay"

      ScreencopyView {
        // As large as fits, keeping the agent screen's shape
        readonly property real fitWidth: Math.min(parent.width, parent.height / root.aspect)
        width: fitWidth
        height: fitWidth * root.aspect
        anchors.centerIn: parent
        captureSource: full.visible ? root.agentScreen : null
        live: true
      }

      MouseArea {
        anchors.fill: parent
        onClicked: root.mode = "overlay"
      }
    }
  }
}
