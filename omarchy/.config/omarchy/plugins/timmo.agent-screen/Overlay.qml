// timmo.agent-screen - shows the headless agent screens (dot agent screen)
// live, so the user can watch what agents do there. AGENT holds new browser
// windows and AGENT-1 and up are sessions' desks; each screen with windows on
// it gets a view, labelled with its desk and who holds it.
//
// Modes, set through the `timmo.agent-screen` IPC target (dot agent screen
// view drives it, and Super + Alt + A steps through them):
//   overlay     translucent views stacked in the corner of the focused
//               monitor. Clicks pass through them to whatever is underneath.
//   fullscreen  the same views side by side, filling the focused monitor.
//               Escape or a click goes back to the overlay.
//   hidden      nothing, such as while they're tiled wl-mirror windows.
// The mode goes back to overlay whenever the agent screens all go away, so
// the next session shows again.
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

  property string mode: "overlay"

  // How much of the monitor's width a corner view takes at most, and how
  // much shows through it
  readonly property real overlayWidthShare: 0.3
  readonly property real overlayOpacity: 0.7
  readonly property int margin: Style.space(24)
  readonly property int gap: Style.space(12)

  function isAgentName(name) {
    return name === "AGENT" || /^AGENT-\d+$/.test(name)
  }

  readonly property var agentScreens: {
    var screens = Quickshell.screens
    var found = []
    for (var i = 0; i < screens.length; i++) {
      if (root.isAgentName(String(screens[i].name || ""))) found.push(screens[i])
    }
    return found
  }

  // The agent screens with windows on them, the holding screen first
  readonly property var busyScreens: {
    var busy = {}
    var toplevels = Hyprland.toplevels ? Hyprland.toplevels.values : []
    for (var i = 0; i < toplevels.length; i++) {
      var workspace = toplevels[i].workspace
      var monitor = workspace ? workspace.monitor : null
      if (monitor) busy[String(monitor.name || "")] = true
    }
    return root.agentScreens
      .filter(function(screen) { return busy[String(screen.name || "")] === true })
      .sort(function(a, b) {
        return String(a.name).localeCompare(String(b.name), "en", { numeric: true })
      })
  }

  // The monitor the user is on, never an agent screen
  readonly property var targetScreen: {
    var screens = Quickshell.screens
    var monitor = Hyprland.focusedMonitor
    var name = monitor ? String(monitor.name || "") : ""
    var fallback = null
    for (var i = 0; i < screens.length; i++) {
      var screenName = String(screens[i].name || "")
      if (root.isAgentName(screenName)) continue
      if (screenName === name) return screens[i]
      if (!fallback) fallback = screens[i]
    }
    return fallback
  }

  readonly property real aspect: root.agentScreens.length > 0 && root.agentScreens[0].width > 0
    ? root.agentScreens[0].height / root.agentScreens[0].width
    : 9 / 16

  // Who holds each desk, as dot agent screen claim records it
  FileView {
    id: desksFile
    path: Quickshell.env("XDG_RUNTIME_DIR") + "/dot-agent-desks.json"
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
  }

  readonly property var desks: {
    try { return JSON.parse(desksFile.text() || "{}") } catch (e) { return {} }
  }

  function label(name) {
    if (name === "AGENT") return "New windows"
    var desk = root.desks[name]
    return desk && desk.session ? name + " · " + desk.session : name
  }

  onAgentScreensChanged: {
    if (root.agentScreens.length === 0) root.mode = "overlay"
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
      return JSON.stringify({ on: root.agentScreens.length > 0, mode: root.mode })
    }
  }

  // One view of an agent screen, with its label along the bottom
  component ScreenView: Item {
    id: view

    required property var screen
    required property bool shown

    ScreencopyView {
      anchors.fill: parent
      captureSource: view.shown ? view.screen : null
      live: true
    }

    Rectangle {
      anchors { left: parent.left; right: parent.right; bottom: parent.bottom }
      height: viewLabel.implicitHeight + Style.space(8)
      color: Commons.Color.popups.background
      opacity: 0.85
    }

    Text {
      id: viewLabel
      anchors { left: parent.left; bottom: parent.bottom; margins: Style.space(4) }
      text: root.label(String(view.screen.name || ""))
      color: Commons.Color.popups.text
      font.pixelSize: Style.font.body
      elide: Text.ElideRight
      width: parent.width - Style.space(8)
    }

    Rectangle {
      anchors.fill: parent
      color: "transparent"
      border.width: Math.max(1, Style.space(2))
      border.color: Commons.Color.popups.border
      radius: Style.cornerRadius
    }
  }

  PanelWindow {
    id: corner

    // As wide as the share allows, narrower when the stack would be too tall
    readonly property int count: root.busyScreens.length
    readonly property real maxHeight: (root.targetScreen ? root.targetScreen.height : 720) - root.margin * 2
    readonly property real viewWidth: count > 0
      ? Math.min(
          (root.targetScreen ? root.targetScreen.width : 1280) * root.overlayWidthShare,
          (maxHeight - root.gap * (count - 1)) / count / root.aspect
        )
      : 0

    visible: count > 0 && root.targetScreen !== null && root.mode === "overlay"
    screen: root.targetScreen
    anchors { bottom: true; right: true }
    margins { bottom: root.margin; right: root.margin }
    implicitWidth: Math.max(1, Math.round(corner.viewWidth))
    implicitHeight: Math.max(1, Math.round(corner.viewWidth * root.aspect * count + root.gap * Math.max(0, count - 1)))
    color: "transparent"
    WlrLayershell.namespace: "timmo-agent-screen"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
    exclusionMode: ExclusionMode.Ignore
    // An empty input region, so every click lands on what's underneath
    mask: Region {}

    Column {
      anchors.fill: parent
      spacing: root.gap
      opacity: root.overlayOpacity

      Repeater {
        model: root.busyScreens

        ScreenView {
          required property var modelData
          screen: modelData
          shown: corner.visible
          width: corner.viewWidth
          height: corner.viewWidth * root.aspect
        }
      }
    }
  }

  PanelWindow {
    id: full

    readonly property int count: root.busyScreens.length
    // Side by side in as many columns as keeps each view largest
    readonly property int columns: Math.max(1, Math.ceil(Math.sqrt(count)))
    readonly property int rows: Math.max(1, Math.ceil(count / columns))
    readonly property real viewWidth: Math.min(
      (width - root.gap * (columns + 1)) / columns,
      (height - root.gap * (rows + 1)) / rows / root.aspect
    )

    visible: count > 0 && root.targetScreen !== null && root.mode === "fullscreen"
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

      Grid {
        anchors.centerIn: parent
        columns: full.columns
        spacing: root.gap

        Repeater {
          model: root.busyScreens

          ScreenView {
            required property var modelData
            screen: modelData
            shown: full.visible
            width: full.viewWidth
            height: full.viewWidth * root.aspect
          }
        }
      }

      MouseArea {
        anchors.fill: parent
        onClicked: root.mode = "overlay"
      }
    }
  }
}
