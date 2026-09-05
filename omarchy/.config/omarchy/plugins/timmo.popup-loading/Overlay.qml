// timmo.popup-loading - singleton loading overlay on the focused monitor.
//
// Driven by `omarchy-shell shell summon/hide` or the `timmo.popup-loading`
// IPC target (`show` / `hide`). Stays open until hidden.
import QtQuick
import Quickshell
import Quickshell.Hyprland
import Quickshell.Io
import Quickshell.Wayland
import qs.Commons
import qs.Ui

Item {
  id: root

  property var shell: null
  property var manifest: null

  property bool opened: false
  property string message: "Loading..."
  property var targetScreen: null

  readonly property int pad: Style.space(16)
  readonly property int gap: Style.space(16)
  readonly property int maxMessageWidth: Style.space(325)
  readonly property int iconInkWidth: Math.ceil(iconMetrics.tightBoundingRect.width)
  readonly property int messageWidth: Math.min(Math.ceil(messageMetrics.advanceWidth), root.maxMessageWidth)
  readonly property int contentWidth: root.iconInkWidth + root.gap + root.messageWidth
  readonly property int contentHeight: Math.max(Style.font.display, Math.ceil(messageLabel.implicitHeight))

  function screenForFocusedMonitor() {
    var screens = Quickshell.screens
    if (!screens || screens.length === 0) return null

    var monitor = Hyprland.focusedMonitor
    var target = monitor ? String(monitor.name || "") : ""
    for (var i = 0; i < screens.length; i++) {
      if (String(screens[i].name || "") === target) return screens[i]
    }
    return screens[0]
  }

  function showMessage(nextMessage) {
    var text = String(nextMessage || "").trim()
    root.message = text || "Loading..."
    root.targetScreen = root.screenForFocusedMonitor()
    root.opened = true
  }

  function open(payloadJson) {
    var payload = ({})
    try { payload = JSON.parse(payloadJson || "{}") } catch (e) { payload = ({}) }
    root.showMessage(payload.message)
  }

  function close() {
    root.opened = false
  }

  TextMetrics {
    id: messageMetrics
    font.family: Style.font.family
    font.bold: true
    font.pixelSize: Style.font.title
    text: root.message
  }

  TextMetrics {
    id: iconMetrics
    font.family: Style.font.family
    font.pixelSize: Style.font.display
    text: "󰦖"
  }

  IpcHandler {
    target: "timmo.popup-loading"
    function show(message: string): string {
      root.showMessage(message)
      return "ok"
    }
    function hide(): string { root.close(); return "ok" }
    function state(): string { return root.opened ? "open" : "closed" }
  }

  PanelWindow {
    id: panel
    visible: root.opened
    screen: root.targetScreen
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    WlrLayershell.namespace: "timmo-popup-loading"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.None
    exclusionMode: ExclusionMode.Ignore
    mask: Region {}

    BorderSurface {
      id: card
      width: card.borderLeft + root.pad + root.contentWidth + root.pad + card.borderRight
      height: card.borderTop + root.pad + root.contentHeight + root.pad + card.borderBottom
      anchors.centerIn: parent
      color: Color.popups.background
      borderSpec: Border.surfaceSpec("popups", "border", Color.popups.border, Math.max(1, Style.space(2)))
      radius: Style.cornerRadius
      opacity: root.opened ? 1 : 0

      Row {
        anchors.fill: parent
        anchors.topMargin: card.borderTop + root.pad
        anchors.rightMargin: card.borderRight + root.pad
        anchors.bottomMargin: card.borderBottom + root.pad
        anchors.leftMargin: card.borderLeft + root.pad
        spacing: root.gap

        Item {
          width: root.iconInkWidth
          height: parent.height
          Text {
            textFormat: Text.PlainText
            x: Math.round(-iconMetrics.tightBoundingRect.x)
            anchors.verticalCenter: parent.verticalCenter
            text: "󰦖"
            font: iconMetrics.font
            color: Color.popups.text
            transformOrigin: Item.Center

            RotationAnimator on rotation {
              running: root.opened
              from: 0
              to: 360
              duration: 800
              loops: Animation.Infinite
            }
          }
        }

        Text {
          id: messageLabel
          textFormat: Text.PlainText
          width: root.messageWidth
          anchors.verticalCenter: parent.verticalCenter
          text: root.message
          font: messageMetrics.font
          color: Color.popups.text
          wrapMode: Text.Wrap
          maximumLineCount: 3
          elide: Text.ElideRight
        }
      }
    }
  }
}
