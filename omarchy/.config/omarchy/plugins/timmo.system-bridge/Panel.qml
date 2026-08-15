import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui

Panel {
  id: root
  moduleName: "timmo.system-bridge"

  property var anchorItem: null
  property var hostWidget: null
  property var service: null
  readonly property var barIdentity: hostWidget || root
  readonly property color contentForeground: bar ? bar.foreground : Color.foreground
  readonly property string contentFontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property var rows: buildRows()

  function formatPercent(value) { return value === null ? "" : Math.round(value) + "%" }
  function formatTemperature(value) { return value === null ? "" : Math.round(value) + " °C" }
  function formatBytes(value) {
    if (value === null) return ""
    return (value / 1073741824).toFixed(1) + " GiB"
  }
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
  function buildRows() {
    if (!service) return []
    var values = []
    if (service.cpuUsage !== null)
      values.push({ icon: "", label: "CPU", value: formatPercent(service.cpuUsage) })
    if (service.cpuLoad !== null)
      values.push({ icon: "󰓅", label: "Load", value: service.cpuLoad.toFixed(2) })
    if (service.cpuTemperature !== null)
      values.push({ icon: "", label: "CPU temperature", value: formatTemperature(service.cpuTemperature) })
    if (service.memoryPercent !== null || service.memoryUsed !== null || service.memoryTotal !== null) {
      var memory = []
      if (service.memoryPercent !== null) memory.push(formatPercent(service.memoryPercent))
      if (service.memoryUsed !== null && service.memoryTotal !== null)
        memory.push(formatBytes(service.memoryUsed) + " / " + formatBytes(service.memoryTotal))
      values.push({ icon: "", label: "Memory", value: memory.join(" · ") })
    }
    if (service.hottestTemperature !== null)
      values.push({ icon: "󰔏", label: "Hottest sensor", value: (service.hottestSensor ? service.hottestSensor + " · " : "") + formatTemperature(service.hottestTemperature) })
    if (service.uptime !== null)
      values.push({ icon: "󰅐", label: "Uptime", value: formatDuration(service.uptime) })
    if (service.installedVersion !== "" || service.latestVersion !== "") {
      var version = service.installedVersion || "Unknown"
      if (service.latestVersion !== "") version += " · latest " + service.latestVersion
      if (service.newerVersionAvailable === true) version += " · update available"
      values.push({ icon: "󰏗", label: "System Bridge", value: version })
    }
    if (service.pendingReboot !== null)
      values.push({ icon: "󰜉", label: "Pending reboot", value: service.pendingReboot ? "Required" : "No" })
    if (service.batteryPercentage !== null) {
      var battery = formatPercent(service.batteryPercentage)
      if (service.batteryCharging === true) battery += " · charging"
      if (service.batteryTimeRemaining !== null) battery += " · " + formatDuration(service.batteryTimeRemaining) + " remaining"
      values.push({ icon: "", label: "Battery", value: battery })
    }
    return values
  }

  function open() {
    controller.show()
    Qt.callLater(function() {
      panelFlick.contentY = 0
      keyCatcher.forceActiveFocus()
    })
  }
  function close() { controller.hide() }
  function toggle() { if (opened) close(); else open() }
  function switchPanel(direction) {
    if (bar && typeof bar.switchPanelFrom === "function")
      return bar.switchPanelFrom(barIdentity, direction)
    return false
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(430))
    contentHeight: panel.fittedContentHeight(contentColumn.implicitHeight, Style.space(670))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }

      Flickable {
        id: panelFlick
        anchors.fill: parent
        contentWidth: width
        contentHeight: contentColumn.implicitHeight
        clip: true
        boundsBehavior: Flickable.StopAtBounds
        flickableDirection: Flickable.VerticalFlick
        interactive: contentHeight > height
        ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

        Column {
          id: contentColumn
          width: panelFlick.width
          spacing: Style.space(12)

          PanelHero {
            width: parent.width
            title: root.service && root.service.hostname !== "" ? root.service.hostname : "System Bridge"
            meta: root.service && root.service.connected
              ? (root.service.stale ? "Data is stale" : "Local system health")
              : "Waiting for System Bridge"
            detail: root.service && root.service.connected ? "ONLINE" : "OFFLINE"
            foreground: root.contentForeground
            fontFamily: root.contentFontFamily
            iconOpacity: root.service && root.service.connected ? 1 : 0.5
            iconComponent: Component {
              Text {
                text: "󰒋"
                color: root.hostWidget ? root.hostWidget.displayColor : root.contentForeground
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.display
              }
            }
          }

          Text {
            visible: root.rows.length > 0
            text: "SYSTEM"
            color: Qt.darker(root.contentForeground, 1.4)
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.caption
            font.bold: true
            font.letterSpacing: 1.2
          }

          Column {
            width: parent.width
            spacing: Style.space(10)
            Repeater {
              model: root.rows
              Row {
                required property var modelData
                width: contentColumn.width
                spacing: Style.space(10)
                Text { width: Style.space(22); text: modelData.icon; color: root.contentForeground; font.family: root.contentFontFamily; font.pixelSize: Style.font.icon; horizontalAlignment: Text.AlignHCenter }
                Text { width: Style.space(112); text: modelData.label; color: root.contentForeground; font.family: root.contentFontFamily; font.pixelSize: Style.font.body; font.bold: true; elide: Text.ElideRight }
                Text { width: Math.max(0, parent.width - Style.space(154)); text: modelData.value; color: Qt.darker(root.contentForeground, 1.3); font.family: root.contentFontFamily; font.pixelSize: Style.font.body; horizontalAlignment: Text.AlignRight; wrapMode: Text.Wrap }
              }
            }
          }

          Text {
            visible: root.rows.length === 0
            width: parent.width
            text: root.service && root.service.connected ? "No system data available" : "System Bridge is offline"
            color: Qt.darker(root.contentForeground, 1.4)
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.body
            horizontalAlignment: Text.AlignHCenter
          }
        }
      }
    }
  }
}
