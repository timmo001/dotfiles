import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui
import "../../components" as PanelComponents

// The Inbox at a glance: the threads that wait on you, by the Inbox's own
// sections. Reading and answering stays in the web app, which a row opens.
Panel {
  id: root
  moduleName: "timmo.plannotator-inbox"

  property var anchorItem: null
  property var hostWidget: null
  property var service: null
  readonly property var barIdentity: hostWidget || root
  readonly property color contentForeground: bar ? bar.foreground : Color.foreground
  readonly property string contentFontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property color urgentColor: bar ? bar.urgent : Color.urgent
  readonly property color warningColor: "#e5c07b"
  readonly property color successColor: "#98c379"
  readonly property color mutedColor: Qt.darker(contentForeground, 1.4)
  readonly property real now: service ? service.currentTime : Date.now()
  readonly property var sectionOrder: ["stopped", "holding", "waiting", "new", "sent"]
  readonly property var panelRows: buildPanelRows()
  readonly property var actionRows: filterController.filteredModel.filter(function(row) { return row.kind === "action" })
  readonly property var threadSections: sectionOrder.filter(function(id) {
    return filterController.filteredModel.some(function(row) { return row.section === id && row.kind === "thread" })
  })

  function buildPanelRows() {
    if (!service) return []
    var rows = []
    if (!service.installed)
      rows.push(actionRow("open", "Set up the Inbox", "󰐊", "Starts it and opens it as a web app"))
    else if (!service.running)
      rows.push(actionRow("open", "Start the Inbox", "󰐊", "Starts it and opens it as a web app"))
    else
      rows.push(actionRow("open", "Open the Inbox", "󰖟", ""))
    for (var i = 0; i < sectionOrder.length; i++) {
      var threads = service.sectionThreads(sectionOrder[i])
      for (var j = 0; j < threads.length; j++) rows.push(threadRow(threads[j], sectionOrder[i]))
    }
    return rows
  }

  function actionRow(action, label, icon, detail) {
    return { key: "action:" + action, kind: "action", action: action, primaryText: label, secondaryText: detail, icon: icon }
  }

  function threadRow(thread, section) {
    var project = thread.project ? String(thread.project.name || "") : ""
    return {
      key: "thread:" + thread.thread_id,
      kind: "thread",
      section: section,
      primaryText: thread.subject ? String(thread.subject) : "(No subject)",
      secondaryText: project + " " + (service ? service.agentName(thread.author) : ""),
      tertiaryText: thread.thread_name ? String(thread.thread_name) : "",
      value: thread
    }
  }

  function sectionIcon(id) {
    if (id === "stopped") return "󰅚"
    if (id === "holding") return "󰀪"
    if (id === "waiting") return "󱜻"
    if (id === "new") return "󰇮"
    return "󰏑"
  }

  function sectionColor(id) {
    if (id === "stopped") return urgentColor
    if (id === "holding" || id === "waiting") return warningColor
    if (id === "new") return contentForeground
    return mutedColor
  }

  function sectionTitle(id) {
    return service ? service.sectionLabel(id) : id
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

  function relative(iso) {
    var timestamp = iso ? Date.parse(String(iso)) : NaN
    if (isNaN(timestamp)) return ""
    var difference = now - timestamp
    if (Math.abs(difference) < 60000) return "just now"
    return difference >= 0 ? span(difference) + " ago" : "in " + span(-difference)
  }

  function metaText(thread) {
    var parts = []
    if (thread.project && thread.project.name) parts.push(String(thread.project.name))
    if (service) parts.push(service.agentName(thread.author))
    var when = relative(thread.last_at)
    if (when) parts.push(when)
    return parts.join(" · ")
  }

  function detailText(thread, section) {
    var parts = []
    var questions = thread.questions || {}
    var open = questions.open || 0
    if (open > 0) parts.push(open + " question" + (open === 1 ? "" : "s") + (questions.picked ? " · " + questions.picked + " picked" : ""))
    if (questions.stopped) parts.push("the agent is stopped on this")
    if (Array.isArray(questions.holds_up) && questions.holds_up.length > 0)
      parts.push("holds up " + questions.holds_up.join(", "))
    if (thread.answered_not_sent) parts.push("answered, not sent")
    if (section === "sent" && thread.sent) parts.push("sent " + relative(thread.sent.at) + ", not read yet")
    if (section === "new" && thread.unseen > 0) parts.push(thread.unseen + " new message" + (thread.unseen === 1 ? "" : "s"))
    if (thread.guide) parts.push("guided review")
    return parts.join(" · ")
  }

  function heroMeta() {
    if (!service || !service.loaded) return "Loading the Inbox"
    if (!service.installed) return "Not run yet on this machine"
    if (!service.running) return "The Inbox is stopped"
    if (service.errorText !== "") return service.errorText
    var parts = []
    if (service.attentionCount > 0)
      parts.push(service.attentionCount + " thread" + (service.attentionCount === 1 ? "" : "s") + " waiting on you")
    else parts.push("Nothing waits on you")
    if (service.sentCount > 0) parts.push(service.sentCount + " sent")
    if (service.decisionsWaiting > 0)
      parts.push(service.decisionsWaiting + " decision" + (service.decisionsWaiting === 1 ? "" : "s") + " to settle")
    return parts.join(" · ")
  }

  function heroDetail() {
    if (!service || !service.running) return ""
    var parts = []
    if (service.version) parts.push("v" + service.version)
    if (service.update && service.update.available) parts.push("update " + service.update.version)
    return parts.join(" · ").toUpperCase()
  }

  function activateEntry(entry) {
    if (!entry || !service) return
    if (entry.kind === "action") {
      if (entry.action === "open") service.openInbox()
      close()
      return
    }
    if (entry.kind === "thread") {
      service.openThread(entry.value.thread_id)
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
    var item = entry.kind === "action" ? actionRepeater.itemAt(actionRows.indexOf(entry)) : threadItem(entry.key)
    if (!item) return
    var point = item.mapToItem(contentColumn, 0, 0)
    if (point.y < panelFlick.contentY) panelFlick.contentY = point.y
    else if (point.y + item.height > panelFlick.contentY + panelFlick.height)
      panelFlick.contentY = point.y + item.height - panelFlick.height
  }

  function threadItem(key) {
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
    contentHeight: panel.fittedContentHeight(contentColumn.implicitHeight, Style.space(670))

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
            id: panelHeader
            title: "Plannotator Inbox"
            meta: root.heroMeta()
            detail: root.heroDetail()
            foreground: root.contentForeground
            fontFamily: root.contentFontFamily
            iconComponent: Component {
              Text {
                text: "󰚇"
                color: root.hostWidget ? root.hostWidget.displayColor : root.contentForeground
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.display
              }
            }
            trailingControl: Component {
              PanelActionButton {
                enabled: root.service !== null && !root.service.refreshing
                iconText: "󰑐"
                tooltipText: "Refresh"
                foreground: root.contentForeground
                fontFamily: root.contentFontFamily
                onClicked: if (root.service) root.service.refresh()
              }
            }
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
                implicitHeight: actionColumn.implicitHeight + Style.space(12)
                hasCursor: filterController.cursorIndex === filterController.indexForKey(modelData.key)
                foreground: root.contentForeground
                accent: root.contentForeground

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

          Repeater {
            id: sectionRepeater
            model: root.threadSections

            Column {
              id: threadSection
              required property string modelData
              required property int index
              readonly property var entries: filterController.filteredModel.filter(function(row) {
                return row.section === threadSection.modelData && row.kind === "thread"
              })
              width: contentColumn.width
              spacing: Style.space(12)

              function itemForKey(key) {
                for (var i = 0; i < entries.length; i++)
                  if (entries[i].key === key) return rowRepeater.itemAt(i)
                return null
              }

              PanelComponents.SectionHeading {
                title: root.sectionTitle(threadSection.modelData) + " · " + threadSection.entries.length
                icon: root.sectionIcon(threadSection.modelData)
                foreground: root.contentForeground
                fontFamily: root.contentFontFamily
              }

              Column {
                width: parent.width
                spacing: Style.space(2)

                Repeater {
                  id: rowRepeater
                  model: threadSection.entries

                  CursorSurface {
                    id: rowSurface
                    required property var modelData
                    readonly property var thread: modelData.value
                    width: contentColumn.width
                    implicitHeight: rowColumn.implicitHeight + Style.space(12)
                    hasCursor: filterController.cursorIndex === filterController.indexForKey(modelData.key)
                    foreground: root.contentForeground
                    accent: root.sectionColor(modelData.section)

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
                        text: root.sectionIcon(rowSurface.modelData.section)
                        color: root.sectionColor(rowSurface.modelData.section)
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
                          font.bold: rowSurface.thread.unread === true
                          elide: Text.ElideRight
                        }

                        Text {
                          width: parent.width
                          text: root.metaText(rowSurface.thread)
                          textFormat: Text.PlainText
                          color: root.mutedColor
                          font.family: root.contentFontFamily
                          font.pixelSize: Style.font.caption
                          elide: Text.ElideRight
                        }

                        Text {
                          width: parent.width
                          visible: text !== ""
                          text: root.detailText(rowSurface.thread, rowSurface.modelData.section)
                          textFormat: Text.PlainText
                          color: rowSurface.modelData.section === "sent" ? root.mutedColor
                            : root.sectionColor(rowSurface.modelData.section)
                          font.family: root.contentFontFamily
                          font.pixelSize: Style.font.caption
                          wrapMode: Text.WrapAtWordBoundaryOrAnywhere
                        }
                      }
                    }
                  }
                }
              }
            }
          }

          Text {
            visible: root.service !== null && root.service.running && root.service.attentionCount === 0
              && root.service.sentCount === 0 && !filterController.filterText
            width: parent.width
            horizontalAlignment: Text.AlignHCenter
            text: root.service && root.service.quietCount > 0
              ? root.service.quietCount + " quiet thread" + (root.service.quietCount === 1 ? "" : "s") + " in the Inbox"
              : "No threads yet"
            textFormat: Text.PlainText
            color: root.mutedColor
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.caption
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
