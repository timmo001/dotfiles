import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui

BarWidget {
  id: root
  moduleName: "timmo.system-bridge"

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
  readonly property var systemBridge: bar?.shell?.serviceFor("timmo.system-bridge")
  property bool openWhenPanelLoads: false
  readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false
  readonly property bool popoutSwitchClosing: panelLoader.item
    ? panelLoader.item.popoutSwitchClosing === true : false
  readonly property real openPanelIndicatorWidth: button.labelWidth
  readonly property bool warning: systemBridge && (
    systemBridge.cpuUsage !== null && systemBridge.cpuUsage >= 90
    || systemBridge.memoryPercent !== null && systemBridge.memoryPercent >= 90
    || systemBridge.highTemperature || systemBridge.stale
    || systemBridge.pendingReboot === true
    || systemBridge.newerVersionAvailable === true)
  readonly property string displayText: {
    if (!systemBridge || !systemBridge.connected) return " --%   --%"
    var cpu = systemBridge.cpuUsage === null ? "--" : Math.round(systemBridge.cpuUsage)
    var memory = systemBridge.memoryPercent === null ? "--" : Math.round(systemBridge.memoryPercent)
    return " " + cpu + "%   " + memory + "%"
  }
  readonly property color displayColor: {
    if (!systemBridge || !systemBridge.connected) return "#9b9b9b"
    if (systemBridge.criticalTemperature) return bar ? bar.urgent : Color.urgent
    if (warning) return "#e5c07b"
    return bar ? bar.barForeground : Color.foreground
  }
  readonly property string tooltipText: buildTooltip()

  function formatDuration(seconds) {
    if (seconds === null) return ""
    var totalMinutes = Math.floor(seconds / 60)
    var days = Math.floor(totalMinutes / 1440)
    var hours = Math.floor((totalMinutes % 1440) / 60)
    var minutes = totalMinutes % 60
    var values = []
    if (days > 0) values.push(days + "d")
    if (hours > 0) values.push(hours + "h")
    if (minutes > 0 || values.length === 0) values.push(minutes + "m")
    return values.join(" ")
  }

  function buildTooltip() {
    if (!systemBridge) return "System Bridge unavailable"
    var values = [systemBridge.connected ? (systemBridge.hostname || "System Bridge") : "System Bridge offline"]
    if (systemBridge.cpuLoad !== null) values.push("Load: " + systemBridge.cpuLoad.toFixed(2))
    if (systemBridge.cpuTemperature !== null) values.push("CPU: " + Math.round(systemBridge.cpuTemperature) + " °C")
    if (systemBridge.hottestTemperature !== null) values.push("Hottest: " + systemBridge.hottestSensor + " " + Math.round(systemBridge.hottestTemperature) + " °C")
    if (systemBridge.uptime !== null) values.push("Uptime: " + formatDuration(systemBridge.uptime))
    if (systemBridge.installedVersion !== "") values.push("Version: " + systemBridge.installedVersion + (systemBridge.latestVersion !== "" ? " (latest " + systemBridge.latestVersion + ")" : ""))
    if (systemBridge.pendingReboot === true) values.push("Reboot pending")
    if (systemBridge.newerVersionAvailable === true) values.push("Update available")
    if (systemBridge.batteryPercentage !== null) values.push("Battery: " + Math.round(systemBridge.batteryPercentage) + "%" + (systemBridge.batteryCharging === true ? " charging" : ""))
    if (systemBridge.stale) values.push("Data is stale")
    return values.join("\n")
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
    panel.service = root.systemBridge
  }

  visible: activeInstance
  implicitWidth: activeInstance ? button.implicitWidth : 0
  implicitHeight: button.implicitHeight

  onBarChanged: injectPanel()
  onSettingsChanged: injectPanel()
  onSystemBridgeChanged: injectPanel()

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
        target: "timmo.system-bridge"
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
    onPressed: root.togglePanel()
  }
}
