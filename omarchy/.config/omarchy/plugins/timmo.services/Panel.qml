import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui

Panel {
  id: root
  moduleName: "timmo.services"

  property var anchorItem: null
  property var hostWidget: null
  property var service: null
  property string expandedKey: ""
  readonly property var barIdentity: hostWidget || root
  readonly property color contentForeground: bar ? bar.foreground : Color.foreground
  readonly property string contentFontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property color urgentColor: bar ? bar.urgent : Color.urgent
  readonly property color warningColor: "#e5c07b"
  readonly property color successColor: "#98c379"
  readonly property color mutedColor: Qt.darker(contentForeground, 1.4)
  readonly property real now: service ? service.currentTime : Date.now()
  property real runtimeNow: Date.now()
  readonly property var panelRows: buildPanelRows()

  function buildPanelRows() {
    if (!service) return []
    return service.services.map(function(status) {
      return {
        key: "service:" + status.unit,
        primaryText: status.label,
        secondaryText: status.unit + " " + status.health,
        value: status
      }
    })
  }

  function healthColor(health) {
    if (health === "failed" || health === "missing") return urgentColor
    if (health === "warning" || health === "stale" || health === "degraded" || health === "inactive") return warningColor
    if (health === "running") return contentForeground
    return successColor
  }

  function healthIcon(health) {
    if (health === "failed" || health === "missing") return "󰅚"
    if (health === "warning" || health === "stale" || health === "degraded" || health === "inactive") return "󰀪"
    if (health === "running") return "󰦖"
    return "󰗠"
  }

  function kindIcon(kind) {
    if (kind === "Timer") return "󰔛"
    if (kind === "One-shot") return "󰐊"
    return "󰒋"
  }

  function runColor(result) {
    if (result === "failed") return urgentColor
    if (result === "warning") return warningColor
    if (result === "running") return contentForeground
    if (result === "stopped" || result === "skipped") return Qt.darker(contentForeground, 2.2)
    return mutedColor
  }

  function span(milliseconds) {
    var seconds = Math.max(0, Math.round(milliseconds / 1000))
    if (seconds < 60) return seconds + "s"
    var minutes = Math.round(seconds / 60)
    if (minutes < 60) return minutes + "m"
    var hours = Math.round(minutes / 60)
    if (hours < 48) return hours + "h"
    return Math.round(hours / 24) + "d"
  }

  function relative(timestamp) {
    if (!timestamp) return ""
    var difference = now - timestamp
    if (Math.abs(difference) < 60000) return difference >= 0 ? "just now" : "in under a minute"
    return difference >= 0 ? span(difference) + " ago" : "in " + span(-difference)
  }

  function runtime(run) {
    if (!run || !run.started) return ""
    if (run.finished) return span(run.finished - run.started)
    return run.result === "running" ? span(runtimeNow - run.started) : ""
  }

  function metaText(status) {
    var parts = [status.summary]
    if (status.runs.length > 0 && status.runs[0].result === "running" && status.health !== "running"
        && status.kind === "timer")
      parts.push("running now")
    var latestRun = status.runs[0]
    var elapsed = status.tags[0] === "Service" ? "" : runtime(latestRun)
    if (status.lastRun) parts.push("ran " + relative(status.lastRun) + (elapsed ? " for " + elapsed : ""))
    if (status.restartLimit && status.restarts > 0)
      parts.push(status.restarts + " restart" + (status.restarts === 1 ? "" : "s"))
    return parts.join(" · ")
  }

  function nextText(status) {
    if (status.nextRun) {
      var date = new Date(status.nextRun)
      var sameDay = date.toDateString() === new Date(now).toDateString()
      return "Next " + Qt.formatDateTime(date, sameDay ? "HH:mm" : "ddd HH:mm") + " · " + relative(status.nextRun)
    }
    if (status.nextNote) return "Next " + status.nextNote
    return status.tags[0] === "Service" ? "Runs continuously" : ""
  }

  function runText(status, run) {
    var parts = [run.started ? Qt.formatDateTime(new Date(run.started), "ddd HH:mm") : "—", run.result]
    var elapsed = status.tags[0] === "Service" ? "" : runtime(run)
    if (elapsed) parts.push(elapsed)
    if (run.detail) parts.push(run.detail)
    return parts.join(" · ")
  }

  function heroMeta() {
    if (!service || !service.loaded) return "Loading services"
    if (service.errorText !== "") return service.errorText
    if (service.attentionCount > 0)
      return service.attentionCount + " need" + (service.attentionCount === 1 ? "s" : "") + " attention"
    return "All " + service.services.length + " services healthy"
  }

  function activateEntry(entry) {
    if (!entry) return
    expandedKey = expandedKey === entry.key ? "" : entry.key
    Qt.callLater(scrollCursorIntoView)
  }

  function open() {
    expandedKey = ""
    filterController.reset()
    runtimeNow = Date.now()
    if (service) service.refresh()
    controller.show()
    Qt.callLater(function() {
      panelFlick.contentY = 0
      filterController.forceActiveFocus()
    })
  }
  function close() { controller.hide() }
  function toggle() { if (opened) close(); else open() }
  function switchPanel(direction) {
    if (bar && typeof bar.switchPanelFrom === "function")
      return bar.switchPanelFrom(barIdentity, direction)
    return false
  }

  function scrollCursorIntoView() {
    var entry = filterController.selectedEntry()
    var item = entry ? rowRepeater.itemAt(filterController.filteredModel.indexOf(entry)) : null
    if (!item) return
    var point = item.mapToItem(contentColumn, 0, 0)
    if (point.y < panelFlick.contentY) panelFlick.contentY = point.y
    else if (point.y + item.height > panelFlick.contentY + panelFlick.height)
      panelFlick.contentY = point.y + item.height - panelFlick.height
  }

  Timer {
    interval: 1000
    running: root.opened && root.service && root.service.services.some(function(status) {
      return status.tags[0] !== "Service" && status.runs.length > 0 && status.runs[0].result === "running"
    })
    repeat: true
    onTriggered: root.runtimeNow = Date.now()
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    focusTarget: filterController
    contentWidth: panel.fittedContentWidth(Style.space(520))
    contentHeight: panel.fittedContentHeight(contentColumn.implicitHeight, Style.space(670))

    FilterablePanel {
      id: filterController
      anchors.fill: parent
      model: root.panelRows
      onActivateRequested: function(entry) { root.activateEntry(entry) }
      onRevealRequested: Qt.callLater(root.scrollCursorIntoView)
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onRefreshRequested: if (root.service) root.service.refresh()

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
            title: "Services"
            meta: root.heroMeta()
            detail: root.service && root.service.loaded ? String(root.service.worst).toUpperCase() : ""
            foreground: root.contentForeground
            fontFamily: root.contentFontFamily
            iconComponent: Component {
              Text {
                text: "󰒓"
                color: root.hostWidget ? root.hostWidget.displayColor : root.contentForeground
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.display
              }
            }
          }

          SectionHeading {
            title: filterController.filterText || "Registered"
            foreground: root.contentForeground
            fontFamily: root.contentFontFamily
            refreshable: true
            refreshing: root.service ? root.service.refreshing : false
            onRefreshRequested: if (root.service) root.service.refresh()
          }

          Column {
            width: parent.width
            spacing: Style.space(2)

            Repeater {
              id: rowRepeater
              model: filterController.filteredModel

              CursorSurface {
                id: rowSurface
                required property var modelData
                readonly property var status: modelData.value
                readonly property bool expanded: root.expandedKey === modelData.key
                width: contentColumn.width
                implicitHeight: rowColumn.implicitHeight + Style.space(12)
                hasCursor: filterController.cursorIndex === filterController.indexForKey(modelData.key)
                foreground: root.contentForeground
                accent: root.healthColor(status.health)

                MouseArea {
                  anchors.fill: parent
                  hoverEnabled: true
                  cursorShape: Qt.PointingHandCursor
                  onEntered: filterController.cursorIndex = filterController.indexForKey(rowSurface.modelData.key)
                  onClicked: root.activateEntry(rowSurface.modelData)
                }

                Column {
                  id: rowColumn
                  anchors.left: parent.left
                  anchors.right: parent.right
                  anchors.verticalCenter: parent.verticalCenter
                  anchors.leftMargin: Style.space(8)
                  anchors.rightMargin: Style.space(8)
                  spacing: Style.space(6)

                  Item {
                    width: parent.width
                    implicitHeight: Math.max(textColumn.implicitHeight, actions.implicitHeight)

                    Text {
                      id: icon
                      anchors.left: parent.left
                      anchors.verticalCenter: parent.verticalCenter
                      width: Style.space(22)
                      text: root.healthIcon(rowSurface.status.health)
                      color: root.healthColor(rowSurface.status.health)
                      font.family: root.contentFontFamily
                      font.pixelSize: Style.font.icon
                      horizontalAlignment: Text.AlignHCenter
                    }

                    Column {
                      id: textColumn
                      anchors.left: icon.right
                      anchors.leftMargin: Style.space(10)
                      anchors.right: actions.left
                      anchors.rightMargin: Style.space(8)
                      anchors.verticalCenter: parent.verticalCenter
                      spacing: Style.space(2)

                      Row {
                        width: parent.width
                        spacing: Style.space(8)

                        Text {
                          id: kindIcon
                          anchors.verticalCenter: parent.verticalCenter
                          text: root.kindIcon(rowSurface.status.tags[0])
                          color: root.mutedColor
                          font.family: root.contentFontFamily
                          font.pixelSize: Style.font.body
                        }

                        Text {
                          id: labelText
                          anchors.verticalCenter: parent.verticalCenter
                          width: Math.min(implicitWidth,
                            parent.width - kindIcon.implicitWidth - tagRow.implicitWidth - parent.spacing * 2)
                          text: rowSurface.status.label
                          color: root.contentForeground
                          font.family: root.contentFontFamily
                          font.pixelSize: Style.font.body
                          font.bold: true
                          elide: Text.ElideRight
                        }

                        Row {
                          id: tagRow
                          anchors.verticalCenter: parent.verticalCenter
                          spacing: Style.space(4)

                          Repeater {
                            model: rowSurface.status.tags.slice(1)

                            Rectangle {
                              required property var modelData
                              implicitWidth: tagText.implicitWidth + Style.space(10)
                              implicitHeight: tagText.implicitHeight + Style.space(2)
                              radius: height / 2
                              color: Qt.rgba(root.contentForeground.r, root.contentForeground.g,
                                root.contentForeground.b, 0.07)
                              border.width: 1
                              border.color: Qt.rgba(root.contentForeground.r, root.contentForeground.g,
                                root.contentForeground.b, 0.14)

                              Text {
                                id: tagText
                                anchors.centerIn: parent
                                text: modelData
                                color: root.mutedColor
                                font.family: root.contentFontFamily
                                font.pixelSize: Style.font.caption
                              }
                            }
                          }
                        }
                      }

                      Text {
                        width: parent.width
                        text: root.metaText(rowSurface.status)
                        color: rowSurface.status.health === "ok" || rowSurface.status.health === "running"
                          ? root.mutedColor : root.healthColor(rowSurface.status.health)
                        font.family: root.contentFontFamily
                        font.pixelSize: Style.font.caption
                        elide: Text.ElideRight
                      }

                      Text {
                        width: parent.width
                        visible: text !== ""
                        text: root.nextText(rowSurface.status)
                        color: rowSurface.status.nextNote === "not scheduled" ? root.warningColor : root.contentForeground
                        font.family: root.contentFontFamily
                        font.pixelSize: Style.font.caption
                        elide: Text.ElideRight
                      }

                      Row {
                        spacing: Style.space(3)
                        visible: rowSurface.status.runs.length > 0

                        Repeater {
                          model: rowSurface.status.runs.slice().reverse()

                          Rectangle {
                            required property var modelData
                            width: Style.space(6)
                            height: Style.space(6)
                            radius: width / 2
                            color: root.runColor(modelData.result)
                          }
                        }
                      }
                    }

                    Row {
                      id: actions
                      anchors.right: parent.right
                      anchors.verticalCenter: parent.verticalCenter
                      spacing: Style.space(4)

                      PanelActionButton {
                        enabled: root.service && !root.service.actionBusy
                        iconText: rowSurface.status.kind === "service" ? "󰜉" : "󰐊"
                        tooltipText: rowSurface.status.kind === "service" ? "Restart now" : "Run now"
                        foreground: root.contentForeground
                        fontFamily: root.contentFontFamily
                        onClicked: root.service.start(rowSurface.status.unit)
                      }

                      PanelActionButton {
                        iconText: "󰈙"
                        tooltipText: rowSurface.status.latestLog ? "Open latest run log" : "Open journal"
                        foreground: root.contentForeground
                        fontFamily: root.contentFontFamily
                        onClicked: {
                          root.service.logs(rowSurface.status.unit)
                          root.close()
                        }
                      }
                    }
                  }

                  Column {
                    visible: rowSurface.expanded
                    width: parent.width
                    leftPadding: Style.space(32)
                    spacing: Style.space(2)

                    Text {
                      visible: rowSurface.status.runs.length === 0
                      text: "No runs in the journal"
                      color: root.mutedColor
                      font.family: root.contentFontFamily
                      font.pixelSize: Style.font.caption
                    }

                    Repeater {
                      model: rowSurface.expanded ? rowSurface.status.runs : []

                      Text {
                        required property var modelData
                        width: parent.width - Style.space(32)
                        text: root.runText(rowSurface.status, modelData)
                        color: root.runColor(modelData.result)
                        font.family: root.contentFontFamily
                        font.pixelSize: Style.font.caption
                        elide: Text.ElideRight
                      }
                    }
                  }
                }
              }
            }
          }

          Text {
            visible: root.service && root.service.errors.length > 0
            width: parent.width
            text: root.service ? root.service.errors.map(function(error) { return "Invalid descriptor: " + error.file }).join("\n") : ""
            color: root.warningColor
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.caption
            wrapMode: Text.Wrap
          }

          Text {
            visible: filterController.count === 0
            width: parent.width
            text: filterController.filterText
              ? "No matches for “" + filterController.filterText + "”"
              : (root.service && root.service.loaded ? "No services registered" : "Loading services")
            color: root.mutedColor
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.body
            horizontalAlignment: Text.AlignHCenter
          }
        }
      }
    }
  }
}
