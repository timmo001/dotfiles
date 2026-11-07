import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Commons as Commons
import qs.Ui
import "../../components" as PanelComponents

// What needs you in Upkeep, newest first by kind. Dealing with an item stays
// in the dashboard, which a row opens at the item's own page.
Panel {
  id: root
  moduleName: "timmo.upkeep"

  property var anchorItem: null
  property var hostWidget: null
  property var service: null
  readonly property var barIdentity: hostWidget || root
  readonly property color contentForeground: bar ? bar.foreground : Commons.Color.foreground
  readonly property string contentFontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property color urgentColor: bar ? bar.urgent : Commons.Color.urgent
  readonly property color warningColor: "#e5c07b"
  readonly property color mutedColor: Qt.darker(contentForeground, 1.4)
  readonly property real now: service ? service.currentTime : Date.now()
  readonly property var sectionOrder: ["needs", "skill-change"]
  readonly property var panelRows: buildPanelRows()
  readonly property var actionRows: filterController.filteredModel.filter(function(row) { return row.kind === "action" })
  readonly property var itemSections: sectionOrder.filter(function(id) {
    return filterController.filteredModel.some(function(row) { return row.section === id && row.kind === "item" })
  })

  function buildPanelRows() {
    if (!service) return []
    var rows = []
    for (var i = 0; i < sectionOrder.length; i++) {
      var items = sectionOrder[i] === "needs" ? service.needsYou : service.skillChanges
      for (var j = 0; j < items.length; j++) rows.push(itemRow(items[j], sectionOrder[i], j))
    }
    // Last, so the cursor starts on the first item when there is one.
    rows.push(actionRow("dashboard", "Open the dashboard", "󰖟", service.baseUrl))
    return rows
  }

  function actionRow(action, label, icon, detail) {
    return { key: "action:" + action, kind: "action", action: action, primaryText: label, secondaryText: detail, icon: icon }
  }

  function itemRow(item, section, index) {
    return {
      key: "item:" + section + ":" + index + ":" + item.path,
      kind: "item",
      section: section,
      primaryText: String(item.title || ""),
      secondaryText: String(item.path || "inbox"),
      value: item
    }
  }

  function sectionIcon(id) {
    return id === "skill-change" ? "󰑓" : "\uf0ad"
  }

  function sectionTitle(id) {
    return id === "skill-change" ? "Skill changes" : "Needs you"
  }

  function itemIcon(item) {
    var path = String(item.path || "")
    if (path.indexOf("jobs/") === 0) return "󰏤"
    if (path.indexOf("runs/") === 0) return "󰑮"
    if (path === "skills") return "󰑓"
    return "󰚇"
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

  function relative(at) {
    var timestamp = Number(at)
    if (!isFinite(timestamp) || timestamp <= 0) return ""
    var difference = now - timestamp
    if (Math.abs(difference) < 60000) return "just now"
    return difference >= 0 ? span(difference) + " ago" : "in " + span(-difference)
  }

  function metaText(item) {
    var parts = []
    var path = String(item.path || "")
    parts.push(path === "" ? "inbox" : path)
    var when = relative(item.at)
    if (when) parts.push(when)
    return parts.join(" · ")
  }

  function heroMeta() {
    if (!service || !service.loaded) return "Loading Upkeep's status"
    if (service.errorText !== "") return service.errorText
    return service.summary
  }

  function heroDetail() {
    if (!service || !service.loaded || service.errorText !== "") return ""
    return (service.workers.length === 0 ? "No worker live" : "Workers: " + service.workers.join(", ")).toUpperCase()
  }

  function activateEntry(entry) {
    if (!entry || !service) return
    if (entry.kind === "action") {
      if (entry.action === "dashboard") service.openDashboard()
      close()
      return
    }
    if (entry.kind === "item") {
      service.openPath(entry.value.path)
      close()
    }
  }

  function open() {
    filterController.reset()
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
    if (!entry) return
    var item = entry.kind === "action" ? actionRepeater.itemAt(actionRows.indexOf(entry)) : rowItem(entry.key)
    if (!item) return
    var point = item.mapToItem(contentColumn, 0, 0)
    if (point.y < panelFlick.contentY) panelFlick.contentY = point.y
    else if (point.y + item.height > panelFlick.contentY + panelFlick.height)
      panelFlick.contentY = point.y + item.height - panelFlick.height
  }

  function rowItem(key) {
    for (var i = 0; i < sectionRepeater.count; i++) {
      var section = sectionRepeater.itemAt(i)
      var item = section ? section.itemForKey(key) : null
      if (item) return item
    }
    return null
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    focusTarget: filterController
    contentWidth: panel.fittedContentWidth(Style.space(520))
    contentHeight: panel.fittedContentHeight(contentColumn.implicitHeight, panel.screenH * 0.8)

    PanelComponents.FilterablePanel {
      id: filterController
      anchors.fill: parent
      model: root.panelRows
      onActivateRequested: function(entry) { root.activateEntry(entry) }
      onRevealRequested: Qt.callLater(root.scrollCursorIntoView)
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onRefreshRequested: if (root.service) root.service.refresh()

      PanelComponents.PanelFlickable {
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

          PanelComponents.PanelHeader {
            title: "Upkeep"
            meta: root.heroMeta()
            detail: root.heroDetail()
            foreground: root.contentForeground
            fontFamily: root.contentFontFamily
            iconComponent: Component {
              Text {
                text: "\uf0ad"
                color: root.hostWidget ? root.hostWidget.displayColor : root.contentForeground
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.display
              }
            }
          }

          Repeater {
            id: sectionRepeater
            model: root.itemSections

            Column {
              id: itemSection
              required property string modelData
              required property int index
              readonly property var entries: filterController.filteredModel.filter(function(row) {
                return row.section === itemSection.modelData && row.kind === "item"
              })
              width: contentColumn.width
              spacing: Style.space(12)

              function itemForKey(key) {
                for (var i = 0; i < entries.length; i++)
                  if (entries[i].key === key) return rowRepeater.itemAt(i)
                return null
              }

              // Refresh sits on whichever section is shown first.
              PanelComponents.SectionHeading {
                title: root.sectionTitle(itemSection.modelData) + " · " + itemSection.entries.length
                icon: root.sectionIcon(itemSection.modelData)
                foreground: root.contentForeground
                fontFamily: root.contentFontFamily
                refreshable: itemSection.index === 0
                refreshing: root.service ? root.service.refreshing : false
                onRefreshRequested: if (root.service) root.service.refresh()
              }

              Column {
                width: parent.width
                spacing: Style.space(2)

                Repeater {
                  id: rowRepeater
                  model: itemSection.entries

                  CursorSurface {
                    id: rowSurface
                    required property var modelData
                    readonly property var item: modelData.value
                    width: contentColumn.width
                    implicitHeight: rowColumn.implicitHeight + Style.space(12)
                    hasCursor: filterController.cursorIndex === filterController.indexForKey(modelData.key)
                    foreground: root.contentForeground
                    accent: root.warningColor

                    MouseArea {
                      anchors.fill: parent
                      hoverEnabled: true
                      cursorShape: Qt.PointingHandCursor
                      onEntered: filterController.cursorIndex = filterController.indexForKey(rowSurface.modelData.key)
                      onClicked: root.activateEntry(rowSurface.modelData)
                    }

                    Item {
                      id: rowColumn
                      anchors.left: parent.left
                      anchors.right: parent.right
                      anchors.verticalCenter: parent.verticalCenter
                      anchors.leftMargin: Style.space(8)
                      anchors.rightMargin: Style.space(8)
                      implicitHeight: textColumn.implicitHeight

                      Text {
                        id: icon
                        anchors.left: parent.left
                        anchors.verticalCenter: parent.verticalCenter
                        width: Style.space(22)
                        text: root.itemIcon(rowSurface.item)
                        color: root.warningColor
                        font.family: root.contentFontFamily
                        font.pixelSize: Style.font.icon
                        horizontalAlignment: Text.AlignHCenter
                      }

                      Column {
                        id: textColumn
                        anchors.left: icon.right
                        anchors.leftMargin: Style.space(10)
                        anchors.right: parent.right
                        anchors.verticalCenter: parent.verticalCenter
                        spacing: Style.space(2)

                        Text {
                          width: parent.width
                          text: rowSurface.modelData.primaryText
                          textFormat: Text.PlainText
                          color: root.contentForeground
                          font.family: root.contentFontFamily
                          font.pixelSize: Style.font.body
                          wrapMode: Text.WrapAtWordBoundaryOrAnywhere
                        }

                        Text {
                          width: parent.width
                          text: root.metaText(rowSurface.item)
                          textFormat: Text.PlainText
                          color: root.mutedColor
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
          }

          Text {
            visible: root.service !== null && root.service.loaded && root.service.errorText === ""
              && root.service.count === 0 && !filterController.filterText
            width: parent.width
            horizontalAlignment: Text.AlignHCenter
            text: "Nothing needs you"
            textFormat: Text.PlainText
            color: root.mutedColor
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.caption
          }

          Column {
            visible: root.actionRows.length > 0
            width: parent.width
            spacing: Style.space(12)

            // Refresh moves here when no item section is shown.
            PanelComponents.SectionHeading {
              title: "Other actions"
              icon: ""
              foreground: root.contentForeground
              fontFamily: root.contentFontFamily
              refreshable: root.itemSections.length === 0
              refreshing: root.service ? root.service.refreshing : false
              onRefreshRequested: if (root.service) root.service.refresh()
            }

            Column {
              width: parent.width
              spacing: Style.space(2)

              Repeater {
                id: actionRepeater
                model: root.actionRows

                CursorSurface {
                  required property var modelData
                  x: Style.space(8)
                  width: Math.max(0, contentColumn.width - Style.space(16))
                  // At least two lines tall, so a row without a description
                  // matches the rest.
                  implicitHeight: Math.max(actionColumn.implicitHeight,
                    bodyMetrics.height + captionMetrics.height + actionColumn.spacing) + Style.space(12)
                  hasCursor: filterController.cursorIndex === filterController.indexForKey(modelData.key)
                  foreground: root.contentForeground
                  accent: root.contentForeground

                  FontMetrics {
                    id: bodyMetrics
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.body
                  }

                  FontMetrics {
                    id: captionMetrics
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.caption
                  }

                  Row {
                    id: actionRow
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
                    anchors.leftMargin: Style.space(8)
                    anchors.rightMargin: Style.space(8)
                    spacing: Style.space(10)

                    Text {
                      width: Style.space(22)
                      anchors.verticalCenter: parent.verticalCenter
                      text: modelData.icon
                      color: root.contentForeground
                      font.family: root.contentFontFamily
                      font.pixelSize: Style.font.icon
                      horizontalAlignment: Text.AlignHCenter
                    }

                    Column {
                      id: actionColumn
                      width: Math.max(0, actionRow.width - Style.space(32))
                      anchors.verticalCenter: parent.verticalCenter
                      spacing: Style.space(2)

                      Text {
                        width: parent.width
                        text: modelData.primaryText
                        textFormat: Text.PlainText
                        color: root.contentForeground
                        font.family: root.contentFontFamily
                        font.pixelSize: Style.font.body
                        elide: Text.ElideRight
                      }

                      Text {
                        width: parent.width
                        visible: text !== ""
                        text: modelData.secondaryText
                        textFormat: Text.PlainText
                        color: root.mutedColor
                        font.family: root.contentFontFamily
                        font.pixelSize: Style.font.caption
                        elide: Text.ElideRight
                      }
                    }
                  }

                  MouseArea {
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onEntered: filterController.cursorIndex = filterController.indexForKey(modelData.key)
                    onClicked: root.activateEntry(modelData)
                  }
                }
              }
            }
          }

          Text {
            visible: !!filterController.filterText
            width: parent.width
            text: "Filter: " + filterController.filterText
            textFormat: Text.PlainText
            color: root.mutedColor
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.caption
          }
        }
      }
    }
  }
}
