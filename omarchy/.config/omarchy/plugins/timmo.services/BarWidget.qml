import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui

BarWidget {
  id: root
  moduleName: "timmo.services"

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
  readonly property var monitor: bar?.shell?.serviceFor("timmo.services")
  property bool openWhenPanelLoads: false
  readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false
  readonly property bool popoutSwitchClosing: panelLoader.item
    ? panelLoader.item.popoutSwitchClosing === true : false
  readonly property real openPanelIndicatorWidth: button.labelWidth
  readonly property color warningColor: "#e5c07b"
  readonly property color displayColor: {
    if (!monitor || !monitor.loaded || monitor.errorText !== "") return "#9b9b9b"
    if (monitor.failedCount > 0) return bar ? bar.urgent : Color.urgent
    if (monitor.attentionCount > 0) return warningColor
    return "#9b9b9b"
  }
  readonly property string displayText: {
    if (!monitor || !monitor.loaded) return "󰒓 .."
    if (monitor.errorText !== "") return "󰒓 ?"
    return monitor.attentionCount > 0 ? "󰒓 " + monitor.attentionCount : "󰒓"
  }
  readonly property string tooltipText: {
    if (!monitor || !monitor.loaded) return "Loading services"
    if (monitor.errorText !== "") return monitor.errorText
    var lines = []
    for (var i = 0; i < monitor.services.length; i++) {
      var status = monitor.services[i]
      if (status.health !== "ok" && status.health !== "running")
        lines.push(status.label + ": " + status.summary)
    }
    if (monitor.errors.length > 0)
      lines.push(monitor.errors.length + " invalid descriptor" + (monitor.errors.length === 1 ? "" : "s"))
    return lines.length > 0 ? lines.join("\n")
      : "All " + monitor.services.length + " services healthy"
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
  function injectPanel() {
    var panel = panelLoader.item
    if (!panel) return
    panel.bar = root.bar
    panel.settings = root.settings
    panel.anchorItem = button
    panel.hostWidget = root
    panel.service = root.monitor
  }

  visible: activeInstance
  implicitWidth: activeInstance ? button.implicitWidth : 0
  implicitHeight: button.implicitHeight

  onBarChanged: injectPanel()
  onSettingsChanged: injectPanel()
  onMonitorChanged: injectPanel()

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
        target: "timmo.services"
        function refresh(): void { if (root.monitor) root.monitor.refresh() }
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
      else root.togglePanel()
    }
  }
}
