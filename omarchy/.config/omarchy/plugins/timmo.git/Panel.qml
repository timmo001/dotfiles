import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui
import "../../components"

Panel {
  id: root
  moduleName: "timmo.git"

  property var anchorItem: null
  property var hostWidget: null
  property var service: null
  readonly property var barIdentity: hostWidget || root
  readonly property color contentForeground: bar ? bar.foreground : Color.foreground
  readonly property string contentFontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property int actionCount: 4
  readonly property int repoCount: service ? service.repos.length : 0
  readonly property int threadCount: service ? service.threads.length : 0
  readonly property var actionLabels: ["Refresh Git", "Open repository changes", "Open Other repositories", "Open GitHub notifications"]
  readonly property var actionIcons: ["", "", "󰙅", ""]
  readonly property var panelRows: buildPanelRows()
  readonly property var filteredActions: filterRows("action")
  readonly property var filteredRepos: filterRows("repo")
  readonly property var filteredThreads: filterRows("thread")

  function buildPanelRows() {
    var rows = []
    for (var i = 0; i < actionCount; i++) {
      rows.push({
        key: "action:" + i,
        kind: "action",
        section: "action",
        actionIndex: i,
        primaryText: actionLabels[i],
        secondaryText: ""
      })
    }
    var repos = service ? service.repos : []
    for (var j = 0; j < repos.length; j++) {
      var repo = repos[j]
      rows.push({
        key: "repo:" + String(repo.name || j),
        kind: "repo",
        section: "repo",
        value: repo,
        primaryText: repo.name,
        secondaryText: repoDetail(repo)
      })
    }
    var threads = service ? service.threads : []
    for (var k = 0; k < threads.length; k++) {
      var thread = threads[k]
      rows.push({
        key: "thread:" + String(thread.webUrl || k),
        kind: "thread",
        section: "thread",
        value: thread,
        primaryText: thread.repo,
        secondaryText: [thread.title, thread.reason, thread.type].join(" ")
      })
    }
    return rows
  }

  function filterRows(kind) {
    return filterController.filteredModel.filter(function(entry) { return entry.kind === kind })
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

  function cursorItem() {
    var entry = filterController.selectedEntry()
    if (!entry) return null
    var rows = entry.kind === "action" ? filteredActions
      : (entry.kind === "repo" ? filteredRepos : filteredThreads)
    var repeater = entry.kind === "action" ? actionRepeater
      : (entry.kind === "repo" ? repoRepeater : threadRepeater)
    return repeater.itemAt(rows.indexOf(entry))
  }

  function scrollCursorIntoView() {
    var item = cursorItem()
    if (!item) return
    var point = item.mapToItem(contentColumn, 0, 0)
    if (point.y < panelFlick.contentY) panelFlick.contentY = point.y
    else if (point.y + item.height > panelFlick.contentY + panelFlick.height)
      panelFlick.contentY = point.y + item.height - panelFlick.height
  }

  Timer {
    id: revealTimer
    interval: 0
    onTriggered: root.scrollCursorIntoView()
  }

  function activateAction(index) {
    if (!service) return
    if (index === 0) service.refresh()
    else if (index === 1) { close(); service.openDiff(false, "") }
    else if (index === 2) { close(); service.openDiff(true, "") }
    else if (index === 3) { close(); service.openNotifications() }
  }

  function activateThread(thread) {
    if (!service || !thread) return
    close()
    service.openThread(thread)
  }

  function activateEntry(entry) {
    if (entry.kind === "action") activateAction(entry.actionIndex)
    else if (entry.kind === "repo") {
      close()
      if (service) service.openDiff(false, entry.value.name)
    } else if (entry.kind === "thread") activateThread(entry.value)
  }

  function repoDetail(repo) {
    var values = []
    if (Number(repo.modified || 0) > 0) values.push(repo.modified + " changed")
    if (Number(repo.ahead || 0) > 0) values.push(repo.ahead + " ahead")
    if (Number(repo.behind || 0) > 0) values.push(repo.behind + " behind")
    return values.join(" · ") || "Clean"
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    focusTarget: filterController
    contentWidth: panel.fittedContentWidth(Style.space(450))
    contentHeight: panel.fittedContentHeight(contentColumn.implicitHeight, Style.space(670))

    FilterablePanel {
      id: filterController
      anchors.fill: parent
      model: root.panelRows
      onRevealRequested: revealTimer.restart()
      onActivateRequested: function(entry) { root.activateEntry(entry) }
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
            title: "Git"
            meta: root.repoCount + " repositories · " + root.threadCount + " notifications"
            detail: root.service && root.service.refreshing ? "REFRESHING" : "STATUS"
            foreground: root.contentForeground
            fontFamily: root.contentFontFamily
            iconComponent: Component {
              Text {
                text: ""
                color: root.hostWidget ? root.hostWidget.displayColor : root.contentForeground
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.display
              }
            }
          }

          Text {
            text: filterController.filterText || "ACTIONS"
            color: Qt.darker(root.contentForeground, 1.4)
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.caption
            font.bold: true
            font.letterSpacing: 1.2
          }

          Column {
            width: parent.width
            spacing: Style.space(2)
            Repeater {
              id: actionRepeater
              model: root.filteredActions
              CursorSurface {
                required property int index
                required property var modelData
                width: contentColumn.width
                implicitHeight: actionRow.implicitHeight + Style.space(12)
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
                  Text { width: Style.space(22); text: root.actionIcons[modelData.actionIndex]; color: root.contentForeground; font.family: root.contentFontFamily; font.pixelSize: Style.font.icon; horizontalAlignment: Text.AlignHCenter }
                  Text { width: Math.max(0, actionRow.width - Style.space(32)); text: root.actionLabels[modelData.actionIndex]; color: root.contentForeground; font.family: root.contentFontFamily; font.pixelSize: Style.font.body; elide: Text.ElideRight }
                }
                MouseArea { anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onEntered: filterController.cursorIndex = filterController.indexForKey(modelData.key); onClicked: root.activateAction(modelData.actionIndex) }
              }
            }
          }

          Text {
            visible: root.filteredRepos.length > 0
            text: "REPOSITORIES · " + (filterController.filterText ? root.filteredRepos.length + " MATCHING" : root.repoCount)
            color: Qt.darker(root.contentForeground, 1.4)
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.caption
            font.bold: true
            font.letterSpacing: 1.2
          }

          Column {
            width: parent.width
            spacing: Style.space(2)
            Repeater {
              id: repoRepeater
              model: root.filteredRepos
              CursorSurface {
                required property int index
                required property var modelData
                width: contentColumn.width
                implicitHeight: repoColumn.implicitHeight + Style.space(12)
                hasCursor: filterController.cursorIndex === filterController.indexForKey(modelData.key)
                foreground: root.contentForeground
                accent: root.hostWidget ? root.hostWidget.displayColor : root.contentForeground
                Column {
                  id: repoColumn
                  anchors.left: parent.left
                  anchors.right: parent.right
                  anchors.verticalCenter: parent.verticalCenter
                  anchors.leftMargin: Style.space(8)
                  anchors.rightMargin: Style.space(8)
                  spacing: Style.space(2)
                  Text { width: parent.width; text: String(modelData.value.name || ""); color: root.contentForeground; font.family: root.contentFontFamily; font.pixelSize: Style.font.body; elide: Text.ElideRight }
                  Text { width: parent.width; text: root.repoDetail(modelData.value); color: Qt.darker(root.contentForeground, 1.4); font.family: root.contentFontFamily; font.pixelSize: Style.font.caption; elide: Text.ElideRight }
                }
                MouseArea { anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onEntered: filterController.cursorIndex = filterController.indexForKey(modelData.key); onClicked: { root.close(); if (root.service) root.service.openDiff(false, modelData.value.name) } }
              }
            }
          }

          Text {
            visible: !filterController.filterText && root.repoCount === 0
            width: parent.width
            text: root.service && root.service.diffError !== "" ? root.service.diffError : (root.service && !root.service.diffLoaded ? "Loading repositories" : "All tracked repositories are clean")
            color: Qt.darker(root.contentForeground, 1.4)
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.body
            horizontalAlignment: Text.AlignHCenter
          }

          Text {
            visible: root.filteredThreads.length > 0
            text: "GITHUB NOTIFICATIONS · " + (filterController.filterText ? root.filteredThreads.length + " MATCHING" : root.threadCount)
            color: Qt.darker(root.contentForeground, 1.4)
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.caption
            font.bold: true
            font.letterSpacing: 1.2
          }

          Column {
            width: parent.width
            spacing: Style.space(2)
            Repeater {
              id: threadRepeater
              model: root.filteredThreads
              CursorSurface {
                required property int index
                required property var modelData
                width: contentColumn.width
                implicitHeight: threadColumn.implicitHeight + Style.space(12)
                hasCursor: filterController.cursorIndex === filterController.indexForKey(modelData.key)
                foreground: root.contentForeground
                accent: modelData.value.important === true && root.bar ? root.bar.urgent : root.contentForeground
                Column {
                  id: threadColumn
                  anchors.left: parent.left
                  anchors.right: parent.right
                  anchors.verticalCenter: parent.verticalCenter
                  anchors.leftMargin: Style.space(8)
                  anchors.rightMargin: Style.space(8)
                  spacing: Style.space(2)
                  Text { width: parent.width; text: String(modelData.value.repo || ""); color: root.contentForeground; font.family: root.contentFontFamily; font.pixelSize: Style.font.body; font.bold: modelData.value.unread === true; elide: Text.ElideRight }
                  Text { width: parent.width; text: String(modelData.value.title || ""); color: Qt.darker(root.contentForeground, 1.25); font.family: root.contentFontFamily; font.pixelSize: Style.font.caption; elide: Text.ElideRight }
                  Text { width: parent.width; text: String(modelData.value.reason || "") + " · " + String(modelData.value.type || ""); color: Qt.darker(root.contentForeground, 1.5); font.family: root.contentFontFamily; font.pixelSize: Style.font.caption; elide: Text.ElideRight }
                }
                MouseArea { anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onEntered: filterController.cursorIndex = filterController.indexForKey(modelData.key); onClicked: root.activateThread(modelData.value) }
              }
            }
          }

          Text {
            visible: !filterController.filterText && root.threadCount === 0
            width: parent.width
            text: root.service && root.service.notificationsError !== "" ? root.service.notificationsError : (root.service && !root.service.notificationsLoaded ? "Loading notifications" : "GitHub inbox clear")
            color: Qt.darker(root.contentForeground, 1.4)
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.body
            horizontalAlignment: Text.AlignHCenter
          }

          Text {
            visible: filterController.filterText && filterController.count === 0
            width: parent.width
            text: "No matches for “" + filterController.filterText + "”"
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
