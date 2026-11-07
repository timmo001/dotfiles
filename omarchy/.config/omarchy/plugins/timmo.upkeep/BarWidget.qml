import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Commons as Commons
import qs.Ui

BarWidget {
  id: root
  moduleName: "timmo.upkeep"

  readonly property bool primaryOnly: setting("primaryOnly", false)
  readonly property string preferredOutput: setting("primaryOutput", "")
  readonly property bool showWhenEmpty: setting("showWhenEmpty", false)
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
  readonly property var monitor: bar?.shell?.serviceFor("timmo.upkeep")
  property bool openWhenPanelLoads: false
  readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false
  readonly property bool popoutSwitchClosing: panelLoader.item
    ? panelLoader.item.popoutSwitchClosing === true : false
  readonly property real openPanelIndicatorWidth: button.labelWidth
  readonly property color warningColor: "#e5c07b"
  readonly property color mutedColor: "#9b9b9b"
  // Font Awesome's wrench, as upkeep status --bar-json shows it.
  readonly property string icon: "\uf0ad"
  readonly property bool ready: !!monitor && monitor.loaded
  readonly property bool hideWhenQuiet: setting("hideWhenQuiet", false)
  readonly property bool hideWhenDetached: setting("hideWhenDetached", false)
  property bool quiet: false
  property bool attached: false
  readonly property bool shown: (!ready || monitor.errorText !== "" || showWhenEmpty
    || monitor.count > 0 || monitor.health === "degraded" || opened)
    && !(hideWhenQuiet && quiet && !opened)
    && !(hideWhenDetached && !attached && !opened)
  readonly property color displayColor: {
    if (!ready || monitor.errorText !== "") return mutedColor
    if (monitor.health === "degraded") return bar ? bar.urgent : Commons.Color.urgent
    if (monitor.health === "warning") return warningColor
    return mutedColor
  }
  readonly property string displayText: {
    if (!ready) return icon + " .."
    if (monitor.errorText !== "") return icon
    return monitor.barText !== "" ? monitor.barText : icon
  }
  readonly property string tooltipText: {
    if (!ready) return "Loading Upkeep's status"
    if (monitor.errorText !== "") return monitor.errorText
    var lines = [monitor.summary]
    lines.push(monitor.workers.length === 0 ? "No worker live" : "Workers: " + monitor.workers.join(", "))
    return lines.join("\n")
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
  function openDashboard() {
    if (root.monitor) root.monitor.openDashboard()
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
    root.monitor.dashboardUrl = root.setting("url", "")
    root.monitor.intervalMs = root.setting("interval", 60000)
  }

  visible: activeInstance && shown
  implicitWidth: activeInstance && shown ? button.implicitWidth : 0
  implicitHeight: button.implicitHeight

  onBarChanged: injectPanel()
  onSettingsChanged: { injectPanel(); injectSettings() }
  onMonitorChanged: { injectPanel(); injectSettings() }
  onActiveInstanceChanged: injectSettings()

  FileView {
    path: root.hideWhenQuiet || root.hideWhenDetached ? Quickshell.env("XDG_RUNTIME_DIR") + "/dot-herdr-context.json" : ""
    watchChanges: true
    printErrors: false
    onFileChanged: reload()
    onLoaded: {
      try {
        var context = JSON.parse(text())
        root.quiet = context.quiet === true
        root.attached = context.attached === true
      } catch (error) {
        root.quiet = false
        root.attached = false
      }
    }
    onLoadFailed: {
      root.quiet = false
      root.attached = false
    }
  }

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
        target: "timmo.upkeep"
        function refresh(): void { if (root.monitor) root.monitor.refresh() }
        function dashboard(): void { root.openDashboard() }
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
      else if (buttonCode === Qt.RightButton) root.openDashboard()
      else root.togglePanel()
    }
  }
}
