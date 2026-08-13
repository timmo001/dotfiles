import QtQuick
import Quickshell
import qs.Commons
import qs.Ui

BarWidget {
  id: root
  moduleName: "timmo.home-assistant"

  Config { id: config }

  readonly property var homeAssistant: bar?.shell?.serviceFor("timmo.home-assistant")
  readonly property var barConfig: config.bar
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

  function open() { if (panelLoader.item) panelLoader.item.open() }
  function close() { if (panelLoader.item) panelLoader.item.close() }
  function togglePanel() { if (panelLoader.item) panelLoader.item.toggle() }
  function closeForPopoutSwitch() {
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

  implicitWidth: button.implicitWidth
  implicitHeight: button.implicitHeight

  onBarChanged: { configureService(); injectPanel() }
  onSettingsChanged: { configureService(); injectPanel() }
  onHomeAssistantChanged: { configureService(); injectPanel() }

  Loader {
    id: panelLoader
    active: true
    source: Qt.resolvedUrl("Panel.qml")
    visible: false
    onLoaded: {
      root.injectPanel()
      Qt.callLater(root.injectPanel)
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
