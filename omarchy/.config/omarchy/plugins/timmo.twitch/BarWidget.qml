import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui

BarWidget {
  id: root
  moduleName: "timmo.twitch"

  readonly property bool primaryOnly: setting("primaryOnly", false)
  readonly property string preferredOutput: setting("primaryOutput", "")
  readonly property string currentOutput: {
    var window = root.QsWindow ? root.QsWindow.window : null
    return window && window.screen ? String(window.screen.name || "") : ""
  }
  readonly property string activeOutput: {
    var screens = Quickshell.screens
    for (var i = 0; i < screens.length; i++)
      if (root.preferredOutput !== "" && screens[i].name === root.preferredOutput)
        return root.preferredOutput
    return screens.length > 0 ? String(screens[0].name || "") : ""
  }
  readonly property bool activeInstance: !primaryOnly
    || (currentOutput !== "" && currentOutput === activeOutput)
  readonly property var twitch: bar?.shell?.serviceFor("timmo.twitch")
  readonly property bool hiddenByState: twitch && twitch.statusState === "active"
  readonly property bool hoverRevealed: hiddenByState
    && setting("revealOnHover", true)
    && !!bar
    && bar.barHovered === true
  readonly property bool shown: !twitch || !hiddenByState || hoverRevealed || opened
  readonly property string displayText: twitch && twitch.statusState === "live"
    ? "󰂚 " + twitch.liveCount : "󰂚"
  readonly property color displayColor: !twitch || twitch.statusState === "inactive"
    ? "#a55555" : (twitch.statusState === "live" ? "#ac77e5" : "#9b9b9b")
  readonly property string tooltipText: !twitch || twitch.statusState === "inactive"
    ? "Twitch Notifications is inactive"
    : (twitch.statusState === "live"
      ? twitch.liveCount + " channel" + (twitch.liveCount === 1 ? "" : "s") + " live"
      : "Twitch Notifications is active")

  readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false
  readonly property bool popoutSwitchClosing: panelLoader.item ? panelLoader.item.popoutSwitchClosing === true : false
  readonly property real openPanelIndicatorWidth: button.labelWidth

  function activeWidget() {
    if (root.activeInstance) return root
    var items = root.bar && typeof root.bar.moduleWidgets === "function"
      ? root.bar.moduleWidgets(root.moduleName) : []
    for (var i = 0; i < items.length; i++)
      if (items[i] && items[i].activeInstance === true) return items[i]
    return null
  }

  function open() {
    var widget = activeWidget()
    if (widget && widget !== root) {
      widget.open()
      return
    }
    if (panelLoader.item) panelLoader.item.open()
  }

  function close() {
    var widget = activeWidget()
    if (widget && widget !== root) {
      widget.close()
      return
    }
    if (panelLoader.item) panelLoader.item.close()
  }

  function togglePanel() {
    var widget = activeWidget()
    if (widget && widget !== root) {
      widget.togglePanel()
      return
    }
    if (panelLoader.item) panelLoader.item.toggle()
  }

  function closeForPopoutSwitch() {
    var widget = activeWidget()
    if (widget && widget !== root) {
      widget.closeForPopoutSwitch()
      return
    }
    if (panelLoader.item) panelLoader.item.closeForPopoutSwitch()
  }

  function injectPanel() {
    var panel = panelLoader.item
    if (!panel) return
    panel.bar = root.bar
    panel.settings = root.settings
    panel.anchorItem = button
    panel.hostWidget = root
    panel.service = root.twitch
  }

  visible: activeInstance && shown
  implicitWidth: activeInstance && shown ? button.implicitWidth : 0
  implicitHeight: button.implicitHeight

  onBarChanged: injectPanel()
  onSettingsChanged: injectPanel()
  onTwitchChanged: injectPanel()

  Loader {
    id: panelLoader
    active: root.activeInstance
    source: Qt.resolvedUrl("Panel.qml")
    visible: false
    onLoaded: {
      root.injectPanel()
      Qt.callLater(root.injectPanel)
    }
  }

  Loader {
    active: root.activeInstance
    sourceComponent: Component {
      IpcHandler {
        target: "timmo.twitch"
        function refresh(): void { if (root.twitch) root.twitch.refresh() }
        function recheck(): void { if (root.twitch) root.twitch.recheck(false) }
        function restart(): void { if (root.twitch) root.twitch.restart() }
        function open(): void { root.open() }
        function close(): void { root.close() }
        function show(): void { root.open() }
        function hide(): void { root.close() }
        function toggle(): void { root.togglePanel() }
      }
    }
  }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    fontSize: 10
    text: root.hoverRevealed ? "󰂜 0" : root.displayText
    dimmed: root.hoverRevealed
    foreground: root.displayColor
    tooltipText: root.tooltipText
    horizontalMargin: 6
    onPressed: function(buttonCode) {
      if (!root.twitch) return
      if (buttonCode === Qt.MiddleButton) root.twitch.recheck(false)
      else if (buttonCode === Qt.RightButton) root.twitch.restart()
      else root.togglePanel()
    }
  }
}
