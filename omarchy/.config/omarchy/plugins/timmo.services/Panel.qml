import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui
import "../../components" as PanelComponents

Panel {
  id: root
  moduleName: "timmo.services"

  property var anchorItem: null
  property var hostWidget: null
  property var service: null
  property string expandedKey: ""
  property string view: "services"
  property var agentStatus: null
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
  readonly property var agentRows: view === "agent" ? filterController.filteredModel.filter(function(entry) { return entry.navigation !== true }) : []
  // Sections the user collapsed. Filtering opens every section.
  property var collapsedSections: ({})
  readonly property bool sectionsCollapsible: !filterController.filterText
  // Rows in collapsed sections stay rendered for their counts but leave keyboard navigation.
  readonly property var navigationRows: filterController.filteredModel.filter(function(row) {
    return row.kind === "toggle" || !row.section || sectionExpanded(row.section)
  })
  readonly property var serviceSections: ["failing", "healthy"].filter(function(id) {
    return filterController.filteredModel.some(function(row) { return row.section === id && row.kind !== "toggle" })
  })

  function buildPanelRows() {
    if (!service) return []
    if (view === "agent") {
      return [{ key: "action:back", action: "back", navigation: true, primaryText: "Back to services", secondaryText: "" }].concat(service.installedAgents.map(function(agent) {
        return actionRow("agent:" + agent.command, agent.label, "󱚣")
      }))
    }
    var failing = service.services.filter(function(status) { return severity(status.health) === 2 })
      .concat(service.services.filter(function(status) { return severity(status.health) === 1 }))
    var healthy = service.services.filter(function(status) { return severity(status.health) === 0 })
    var rows = []
    if (failing.length) rows = rows.concat([toggleRow("failing")], failing.map(function(status) { return serviceRow(status, "failing") }))
    if (healthy.length) rows = rows.concat([toggleRow("healthy")], healthy.map(function(status) { return serviceRow(status, "healthy") }))
    return rows
  }

  function serviceRow(status, section) {
    return {
      key: "service:" + status.unit,
      kind: "service",
      section: section,
      primaryText: status.label,
      secondaryText: status.unit + " " + status.health,
      value: status
    }
  }

  function toggleRow(id) {
    return { key: "toggle:" + id, kind: "toggle", section: id }
  }

  function sectionExpanded(id) {
    return !!filterController.filterText || collapsedSections[id] !== true
  }

  function toggleSection(id) {
    var next = Object.assign({}, collapsedSections)
    next[id] = sectionExpanded(id)
    collapsedSections = next
  }

  // reset() lands on the first heading toggle, so move on to the first service.
  function selectFirstRow() {
    var index = filterController.navigationEntries.findIndex(function(entry) { return entry.navigation !== true && entry.kind !== "toggle" })
    if (index >= 0) filterController.selectIndex(index)
  }

  function actionRow(action, label, icon) {
    return { key: "action:" + action, action: action, primaryText: label, secondaryText: "", icon: icon }
  }

  function showView(nextView) {
    view = nextView
    filterController.reset()
    Qt.callLater(selectFirstRow)
    panelFlick.contentY = 0
  }

  function showAgentPicker(status) {
    agentStatus = status
    if (service) service.agentLaunchError = ""
    showView("agent")
  }

  function activateAction(action, modifiers) {
    if (action === "back") showView("services")
    else if (action.indexOf("agent:") === 0 && service) service.openAgent(agentStatus, action.slice(6), modifiers)
  }

  function severity(health) {
    if (health === "failed" || health === "missing") return 2
    if (health === "warning" || health === "stale" || health === "degraded" || health === "inactive") return 1
    return 0
  }

  function sectionTitle(id) {
    return id === "failing" ? "Failing" : "Healthy"
  }

  function healthColor(health) {
    if (severity(health) === 2) return urgentColor
    if (severity(health) === 1) return warningColor
    if (health === "running") return contentForeground
    return successColor
  }

  function healthIcon(health) {
    if (severity(health) === 2) return "󰅚"
    if (severity(health) === 1) return "󰀪"
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
    if (run.summary) parts.push(run.summary)
    else if (run.detail) parts.push(run.detail)
    return parts.join(" · ")
  }

  function latestSummary(status) {
    var run = status.runs.find(function(entry) { return entry.summary })
    return run || null
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
    if (entry.action) { activateAction(entry.action, 0); return }
    if (entry.kind === "toggle") { toggleSection(entry.section); return }
    expandedKey = expandedKey === entry.key ? "" : entry.key
    Qt.callLater(scrollCursorIntoView)
  }

  function open() {
    expandedKey = ""
    view = "services"
    agentStatus = null
    filterController.reset()
    runtimeNow = Date.now()
    if (service) service.refresh()
    controller.show()
    Qt.callLater(function() {
      root.selectFirstRow()
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
    var item = !entry ? null : (entry.navigation === true ? panelHeader
      : (view === "agent" ? agentRepeater.itemAt(agentRows.indexOf(entry)) : serviceItem(entry.key)))
    if (!item) return
    var point = item.mapToItem(contentColumn, 0, 0)
    if (point.y < panelFlick.contentY) panelFlick.contentY = point.y
    else if (point.y + item.height > panelFlick.contentY + panelFlick.height)
      panelFlick.contentY = point.y + item.height - panelFlick.height
  }

  function serviceItem(key) {
    for (var i = 0; i < sectionRepeater.count; i++) {
      var section = sectionRepeater.itemAt(i)
      var item = section ? section.itemForKey(key) : null
      if (item) return item
    }
    return null
  }

  Connections {
    target: root.service
    function onAgentOpened() { if (root.view === "agent") root.close() }
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

    PanelComponents.FilterablePanel {
      id: filterController
      anchors.fill: parent
      model: root.panelRows
      navigationModel: root.navigationRows
      backOnEmptyFilter: root.view === "agent"
      onActivateRequested: function(entry) { root.activateEntry(entry) }
      onBackRequested: root.showView("services")
      onRevealRequested: Qt.callLater(root.scrollCursorIntoView)
      onCloseRequested: if (root.view === "agent") root.showView("services"); else root.close()
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
            backText: root.view === "agent" ? "Back to services" : ""
            backHasCursor: filterController.cursorIndex === filterController.indexForKey("action:back")
            onBackHovered: filterController.cursorIndex = filterController.indexForKey("action:back")
            onBackActivated: root.showView("services")
            title: root.view === "agent" ? "Open in agent" : "Services"
            meta: root.view === "agent" && root.agentStatus
              ? root.agentStatus.label + " · " + root.agentStatus.repository.name : root.heroMeta()
            detail: root.view === "services" && root.service && root.service.loaded ? String(root.service.worst).toUpperCase() : ""
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

          PanelComponents.SectionHeading {
            visible: root.view === "agent"
            title: "Actions"
            foreground: root.contentForeground
            fontFamily: root.contentFontFamily
          }

          Column {
            visible: root.view === "agent"
            width: parent.width
            spacing: Style.space(2)

            Repeater {
              id: agentRepeater
              model: root.agentRows

              CursorSurface {
                required property var modelData
                x: Style.space(8)
                width: Math.max(0, contentColumn.width - Style.space(16))
                implicitHeight: agentRow.implicitHeight + Style.space(12)
                hasCursor: filterController.cursorIndex === filterController.indexForKey(modelData.key)
                foreground: root.contentForeground
                accent: root.contentForeground

                Row {
                  id: agentRow
                  anchors.left: parent.left
                  anchors.right: parent.right
                  anchors.verticalCenter: parent.verticalCenter
                  anchors.leftMargin: Style.space(8)
                  anchors.rightMargin: Style.space(8)
                  spacing: Style.space(10)
                  Text { width: Style.space(22); text: modelData.icon; color: root.contentForeground; font.family: root.contentFontFamily; font.pixelSize: Style.font.icon; horizontalAlignment: Text.AlignHCenter }
                  Text { width: Math.max(0, agentRow.width - Style.space(32)); text: modelData.primaryText; color: root.contentForeground; font.family: root.contentFontFamily; font.pixelSize: Style.font.body; elide: Text.ElideRight }
                }

                MouseArea {
                  anchors.fill: parent
                  hoverEnabled: true
                  cursorShape: Qt.PointingHandCursor
                  onEntered: filterController.cursorIndex = filterController.indexForKey(modelData.key)
                  onClicked: function(mouse) { root.activateAction(modelData.action, mouse.modifiers) }
                }
              }
            }
          }

          Text {
            visible: root.view === "agent" && root.service !== null && root.service.agentLaunchError !== ""
            width: parent.width
            text: root.service ? root.service.agentLaunchError : ""
            textFormat: Text.PlainText
            wrapMode: Text.Wrap
            color: root.contentForeground
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.caption
          }

          Repeater {
            id: sectionRepeater
            model: root.view === "services" ? root.serviceSections : []

            Column {
              id: serviceSection
              required property string modelData
              required property int index
              readonly property var entries: filterController.filteredModel.filter(function(row) {
                return row.section === serviceSection.modelData && row.kind !== "toggle"
              })
              readonly property bool bodyShown: root.sectionExpanded(modelData)
              width: contentColumn.width
              spacing: Style.space(12)

              function itemForKey(key) {
                if (key === "toggle:" + modelData) return sectionHeading
                for (var i = 0; i < entries.length; i++)
                  if (entries[i].key === key) return rowRepeater.itemAt(i)
                return null
              }

              // Refresh sits on whichever section is shown first.
              PanelComponents.SectionHeading {
                id: sectionHeading
                title: root.sectionTitle(serviceSection.modelData) + " · " + serviceSection.entries.length
                foreground: root.contentForeground
                fontFamily: root.contentFontFamily
                refreshable: serviceSection.index === 0
                refreshing: root.service ? root.service.refreshing : false
                collapsible: root.sectionsCollapsible
                expanded: serviceSection.bodyShown
                toggleHasCursor: filterController.cursorIndex === filterController.indexForKey("toggle:" + serviceSection.modelData)
                onToggleHovered: filterController.cursorIndex = filterController.indexForKey("toggle:" + serviceSection.modelData)
                onToggleRequested: root.toggleSection(serviceSection.modelData)
                onRefreshRequested: if (root.service) root.service.refresh()
              }

              Column {
                visible: serviceSection.bodyShown
                width: parent.width
                spacing: Style.space(2)

                Repeater {
                  id: rowRepeater
                  model: serviceSection.entries

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
                            wrapMode: Text.WrapAtWordBoundaryOrAnywhere
                          }

                          Text {
                            readonly property var run: root.latestSummary(rowSurface.status)
                            width: parent.width
                            visible: run !== null
                            text: run ? run.summary : ""
                            color: run && run.result !== "success" ? root.runColor(run.result) : root.mutedColor
                            font.family: root.contentFontFamily
                            font.pixelSize: Style.font.caption
                            wrapMode: Text.WrapAtWordBoundaryOrAnywhere
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
                            enabled: root.service && !root.service.actionBusy
                              && (rowSurface.status.activeState === "active" || rowSurface.status.activeState === "activating"
                                || rowSurface.status.activeState === "reloading")
                            iconText: "󰓛"
                            tooltipText: "Stop"
                            foreground: root.contentForeground
                            fontFamily: root.contentFontFamily
                            onClicked: root.service.stop(rowSurface.status.unit)
                          }

                          PanelActionButton {
                            enabled: root.service && root.service.installedAgents.length > 0
                            iconText: "󱚣"
                            tooltipText: "Investigate in agent · " + rowSurface.status.repository.name
                            foreground: root.contentForeground
                            fontFamily: root.contentFontFamily
                            onClicked: root.showAgentPicker(rowSurface.status)
                          }

                          PanelActionButton {
                            enabled: root.service && rowSurface.status.runs.length > 0
                            iconText: root.service && root.service.copiedUnit === rowSurface.status.unit ? "" : ""
                            tooltipText: root.service && root.service.copiedUnit === rowSurface.status.unit
                              ? "Copied" : "Copy the last 3 run logs"
                            foreground: root.contentForeground
                            fontFamily: root.contentFontFamily
                            onClicked: root.service.copyRunLogs(rowSurface.status.unit)
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
                            wrapMode: Text.WrapAtWordBoundaryOrAnywhere
                          }
                        }
                      }
                    }
                  }
                }
              }
            }
          }

          Text {
            visible: root.view === "services" && root.service && root.service.errors.length > 0
            width: parent.width
            text: root.service ? root.service.errors.map(function(error) { return "Invalid descriptor: " + error.file }).join("\n") : ""
            color: root.warningColor
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.caption
            wrapMode: Text.Wrap
          }

          Text {
            visible: root.view === "services" && filterController.count === 0
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
