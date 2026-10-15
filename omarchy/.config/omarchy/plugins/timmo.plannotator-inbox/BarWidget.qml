import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui

BarWidget {
  id: root
  moduleName: "timmo.plannotator-inbox"

  readonly property bool primaryOnly: setting("primaryOnly", false)
  readonly property string preferredOutput: setting("primaryOutput", "")
  readonly property bool showWhenEmpty: setting("showWhenEmpty", true)
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
  readonly property var monitor: bar?.shell?.serviceFor("timmo.plannotator-inbox")
  property bool openWhenPanelLoads: false
  readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false
  readonly property bool popoutSwitchClosing: panelLoader.item
    ? panelLoader.item.popoutSwitchClosing === true : false
  readonly property real openPanelIndicatorWidth: button.labelWidth
  readonly property color warningColor: "#e5c07b"
  readonly property color mutedColor: "#9b9b9b"
  readonly property bool ready: !!monitor && monitor.loaded
  readonly property bool shown: !ready || !monitor.installed || !monitor.running
    || showWhenEmpty || monitor.attentionCount > 0 || opened
  readonly property color displayColor: {
    if (!ready || !monitor.installed || !monitor.running || monitor.errorText !== "") return mutedColor
    if (monitor.stoppedCount > 0) return bar ? bar.urgent : Color.urgent
    if (monitor.attentionCount > 0) return warningColor
    return mutedColor
  }
  readonly property string displayText: {
    if (!ready) return "󰚇 .."
    if (!monitor.installed || !monitor.running || monitor.errorText !== "") return "󰚇"
    return monitor.attentionCount > 0 ? "󰚇 " + monitor.attentionCount : "󰚇"
  }
  readonly property string tooltipText: {
    if (!ready) return "Loading the Plannotator Inbox"
    if (!monitor.installed) return "Plannotator Inbox has not run yet\nRight click to start it"
    if (!monitor.running) return "Plannotator Inbox is stopped\nRight click to start it"
    if (monitor.errorText !== "") return monitor.errorText
    var lines = []
    if (monitor.stoppedCount > 0) lines.push(monitor.stoppedCount + " stopped on you")
    if (monitor.holdingCount > 0) lines.push(monitor.holdingCount + " holding up work")
    if (monitor.waitingCount > 0) lines.push(monitor.waitingCount + " waiting on you")
    if (monitor.newCount > 0) lines.push(monitor.newCount + " new since you looked")
    if (monitor.sentCount > 0) lines.push(monitor.sentCount + " sent, unread by the agent")
    return lines.length > 0 ? lines.join("\n") : "Nothing waits on you"
  }

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
    if (widget && widget !== root) { widget.open(); return }
    if (panelLoader.item) {
      openWhenPanelLoads = false
      panelLoader.item.open()
      return
    }
    openWhenPanelLoads = true
    panelLoader.active = true
  }
  function close() {
    var widget = activeWidget()
    if (widget && widget !== root) { widget.close(); return }
    openWhenPanelLoads = false
    if (panelLoader.item) panelLoader.item.close()
  }
  function togglePanel() {
    var widget = activeWidget()
    if (widget && widget !== root) { widget.togglePanel(); return }
    if (panelLoader.item && panelLoader.item.opened) panelLoader.item.close()
    else open()
  }
  function closeForPopoutSwitch() {
    var widget = activeWidget()
    if (widget && widget !== root) { widget.closeForPopoutSwitch(); return }
    if (panelLoader.item) panelLoader.item.closeForPopoutSwitch()
  }
  function openInbox() {
    if (root.monitor) root.monitor.openInbox()
  }
  function injectPanel() {
    var panel = panelLoader.item
    if (!panel) return
    panel.bar = root.bar
    panel.settings = root.settings
    panel.anchorItem = button
    panel.hostWidget = root
    panel.service = root.monitor
  }
  // The service is shared, so the active instance's settings drive it.
  function injectSettings() {
    if (!root.monitor || !root.activeInstance) return
    // Read settings directly: onSettingsChanged runs before bindings on settings update.
    root.monitor.inboxUrl = root.setting("url", "")
    root.monitor.intervalMs = root.setting("interval", 60000)
    root.monitor.live = root.setting("live", true)
  }

  visible: activeInstance && shown
  implicitWidth: activeInstance && shown ? button.implicitWidth : 0
  implicitHeight: button.implicitHeight

  onBarChanged: injectPanel()
  onSettingsChanged: { injectPanel(); injectSettings() }
  onMonitorChanged: { injectPanel(); injectSettings() }
  onActiveInstanceChanged: injectSettings()

  Loader {
    id: panelLoader
    active: false
    source: Qt.resolvedUrl("Panel.qml")
    visible: false
    onLoaded: {
      root.injectPanel()
      Qt.callLater(root.injectPanel)
      if (root.openWhenPanelLoads) {
        root.openWhenPanelLoads = false
        item.open()
      }
    }
  }

  Loader {
    active: root.activeInstance
    sourceComponent: Component {
      IpcHandler {
        target: "timmo.plannotator-inbox"
        function refresh(): void { if (root.monitor) root.monitor.refresh() }
        function inbox(): void { root.openInbox() }
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
    text: root.displayText
    foreground: root.displayColor
    tooltipText: root.tooltipText
    horizontalMargin: 6
    onPressed: function(buttonCode) {
      if (buttonCode === Qt.MiddleButton && root.monitor) root.monitor.refresh()
      else if (buttonCode === Qt.RightButton) root.openInbox()
      else root.togglePanel()
    }
  }
}
