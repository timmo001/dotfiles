import QtQuick
import Quickshell
import qs.Commons
import qs.Ui

BarWidget {
  id: root
  moduleName: "timmo.home-assistant"

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
  readonly property var homeAssistant: bar?.shell?.serviceFor("timmo.home-assistant")
  readonly property var barConfig: homeAssistant ? homeAssistant.barConfig : ({})
  readonly property var rows: homeAssistant ? homeAssistant.rows : []
  readonly property var visibleRows: activeRows(rows)
  readonly property string activeText: activeRowsText(visibleRows)
  readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false
  readonly property bool popoutSwitchClosing: panelLoader.item ? panelLoader.item.popoutSwitchClosing === true : false
  readonly property real openPanelIndicatorWidth: content.implicitWidth

  function rowText(row) {
    var text = String(row.text || "").trim()
    var activeValue = ["active", "warning", "critical"].indexOf(row.severity) !== -1
      ? String(row.activeText || "").trim() : ""
    if (text === "") return row.icon + (activeValue ? " " + activeValue : "")
    if (row.icon && text === row.icon && activeValue) return text + " " + activeValue
    if (row.icon && text.indexOf(row.icon) !== 0) return row.icon + " " + text
    return text
  }

  function activeRows(currentRows) {
    var values = []
    for (var i = 0; i < currentRows.length; i++)
      if (currentRows[i].barActive) values.push(currentRows[i])
    return values
  }

  function activeRowsText(currentRows) {
    var values = []
    for (var i = 0; i < currentRows.length; i++) values.push(rowText(currentRows[i]))
    return values.join("  ")
  }

  function activeTooltip(currentRows) {
    var labels = []
    for (var i = 0; i < currentRows.length; i++)
      if (currentRows[i].barActive)
        labels.push(currentRows[i].tooltip || currentRows[i].label)
    return labels.length > 0 ? labels.join("\n") : barConfig.label + ": no active statuses"
  }

  function configureService() {
    if (homeAssistant)
      homeAssistant.configure(setting("host", Quickshell.env("OMARCHY_HOST") || "laptop"))
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
    panel.service = root.homeAssistant
  }

  visible: activeInstance
  implicitWidth: activeInstance ? button.implicitWidth : 0
  implicitHeight: button.implicitHeight

  onBarChanged: { configureService(); injectPanel() }
  onSettingsChanged: { configureService(); injectPanel() }
  onHomeAssistantChanged: { configureService(); injectPanel() }

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
        target: "timmo.home-assistant"
        function show(): void { root.open() }
      }
    }
  }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    fontSize: root.barConfig.fontSize
    horizontalMargin: root.barConfig.horizontalMargin
    fixedWidth: vertical ? -1 : Math.max(12,
      content.implicitWidth + scaledHorizontalMargin * 2)
    text: root.activeText || root.barConfig.icon
    labelVisible: false
    tooltipText: root.activeTooltip(root.rows)
    onPressed: function(buttonCode) {
      if (buttonCode === Qt.RightButton) {
        if (root.homeAssistant) root.homeAssistant.refresh()
      } else {
        root.togglePanel()
      }
    }

    Row {
      id: content
      anchors.centerIn: parent
      spacing: Style.space(root.barConfig.rowSpacing)

      Repeater {
        model: root.visibleRows.length > 0 ? root.visibleRows : [{
          text: root.barConfig.icon,
          icon: "",
          color: root.homeAssistant ? "" : root.barConfig.colors.unavailable
        }]

        Text {
          required property var modelData
          text: root.rowText(modelData)
          color: modelData.color || (root.bar ? root.bar.barForeground : Color.foreground)
          font.family: button.fontFamily
          font.pixelSize: button.fontSize
          renderType: Text.NativeRendering
        }
      }
    }
  }
}
