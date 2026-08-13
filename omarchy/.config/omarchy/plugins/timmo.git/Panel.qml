import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui

Panel {
  id: root
  moduleName: "timmo.git"

  property var anchorItem: null
  property var hostWidget: null
  property var service: null
  property int cursorIndex: 0

  readonly property var barIdentity: hostWidget || root
  readonly property color contentForeground: bar ? bar.foreground : Color.foreground
  readonly property string contentFontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property int actionCount: 4
  readonly property int repoCount: service ? service.repos.length : 0
  readonly property int threadCount: service ? service.threads.length : 0
  readonly property int cursorCount: actionCount + repoCount + threadCount
  readonly property var actionLabels: ["Refresh Git", "Open repository changes", "Open Other repositories", "Open GitHub notifications"]
  readonly property var actionIcons: ["", "", "󰙅", ""]

  onCursorCountChanged: clampCursor()

  function clampCursor() {
    cursorIndex = Math.max(0, Math.min(cursorIndex, Math.max(0, cursorCount - 1)))
  }

  function open() {
    clampCursor()
    if (service) service.refresh()
    controller.show()
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function close() { controller.hide() }
  function toggle() { if (opened) close(); else open() }

  function switchPanel(direction) {
    if (bar && typeof bar.switchPanelFrom === "function")
      return bar.switchPanelFrom(barIdentity, direction)
    return false
  }

  function moveCursor(delta) {
    if (cursorCount <= 0) return
    cursorIndex = Math.max(0, Math.min(cursorIndex + delta, cursorCount - 1))
    Qt.callLater(scrollCursorIntoView)
  }

  function cursorItem() {
    if (cursorIndex < actionCount) return actionRepeater.itemAt(cursorIndex)
    if (cursorIndex < actionCount + repoCount)
      return repoRepeater.itemAt(cursorIndex - actionCount)
    return threadRepeater.itemAt(cursorIndex - actionCount - repoCount)
  }

  function scrollCursorIntoView() {
    var item = cursorItem()
    if (!item) return
    var point = item.mapToItem(contentColumn, 0, 0)
    if (point.y < panelFlick.contentY) panelFlick.contentY = point.y
    else if (point.y + item.height > panelFlick.contentY + panelFlick.height)
      panelFlick.contentY = point.y + item.height - panelFlick.height
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

  function activateCursor() {
    if (cursorIndex < actionCount) { activateAction(cursorIndex); return }
    if (cursorIndex < actionCount + repoCount) {
      close()
      if (service) service.openDiff(false, service.repos[cursorIndex - actionCount].name)
      return
    }
    var index = cursorIndex - actionCount - repoCount
    if (service && index >= 0 && index < service.threads.length)
      activateThread(service.threads[index])
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
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(450))
    contentHeight: panel.fittedContentHeight(contentColumn.implicitHeight, Style.space(620))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onMoveRequested: function(dx, dy) { if (dy !== 0) root.moveCursor(dy) }
      onActivateRequested: root.activateCursor()
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onTextKey: function(text) {
        if ((text === "r" || text === "R") && root.service) root.service.refresh()
      }

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
            text: "ACTIONS"
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
              model: root.actionCount
              CursorSurface {
                required property int index
                width: contentColumn.width
                implicitHeight: actionRow.implicitHeight + Style.space(12)
                hasCursor: root.cursorIndex === index
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
                  Text { width: Style.space(22); text: root.actionIcons[index]; color: root.contentForeground; font.family: root.contentFontFamily; font.pixelSize: Style.font.icon; horizontalAlignment: Text.AlignHCenter }
                  Text { width: Math.max(0, actionRow.width - Style.space(32)); text: root.actionLabels[index]; color: root.contentForeground; font.family: root.contentFontFamily; font.pixelSize: Style.font.body; elide: Text.ElideRight }
                }
                MouseArea { anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onEntered: root.cursorIndex = index; onClicked: root.activateAction(index) }
              }
            }
          }

          Text {
            text: "REPOSITORIES · " + root.repoCount
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
              model: root.service ? root.service.repos : []
              CursorSurface {
                required property int index
                required property var modelData
                width: contentColumn.width
                implicitHeight: repoColumn.implicitHeight + Style.space(12)
                hasCursor: root.cursorIndex === root.actionCount + index
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
                  Text { width: parent.width; text: String(modelData.name || ""); color: root.contentForeground; font.family: root.contentFontFamily; font.pixelSize: Style.font.body; elide: Text.ElideRight }
                  Text { width: parent.width; text: root.repoDetail(modelData); color: Qt.darker(root.contentForeground, 1.4); font.family: root.contentFontFamily; font.pixelSize: Style.font.caption; elide: Text.ElideRight }
                }
                MouseArea { anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onEntered: root.cursorIndex = root.actionCount + index; onClicked: { root.close(); if (root.service) root.service.openDiff(false, modelData.name) } }
              }
            }
          }

          Text {
            visible: root.repoCount === 0
            width: parent.width
            text: root.service && root.service.diffError !== "" ? root.service.diffError : (root.service && !root.service.diffLoaded ? "Loading repositories" : "All tracked repositories are clean")
            color: Qt.darker(root.contentForeground, 1.4)
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.body
            horizontalAlignment: Text.AlignHCenter
          }

          Text {
            text: "GITHUB NOTIFICATIONS · " + root.threadCount
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
              model: root.service ? root.service.threads : []
              CursorSurface {
                required property int index
                required property var modelData
                width: contentColumn.width
                implicitHeight: threadColumn.implicitHeight + Style.space(12)
                hasCursor: root.cursorIndex === root.actionCount + root.repoCount + index
                foreground: root.contentForeground
                accent: modelData.important === true && root.bar ? root.bar.urgent : root.contentForeground
                Column {
                  id: threadColumn
                  anchors.left: parent.left
                  anchors.right: parent.right
                  anchors.verticalCenter: parent.verticalCenter
                  anchors.leftMargin: Style.space(8)
                  anchors.rightMargin: Style.space(8)
                  spacing: Style.space(2)
                  Text { width: parent.width; text: String(modelData.repo || ""); color: root.contentForeground; font.family: root.contentFontFamily; font.pixelSize: Style.font.body; font.bold: modelData.unread === true; elide: Text.ElideRight }
                  Text { width: parent.width; text: String(modelData.title || ""); color: Qt.darker(root.contentForeground, 1.25); font.family: root.contentFontFamily; font.pixelSize: Style.font.caption; elide: Text.ElideRight }
                  Text { width: parent.width; text: String(modelData.reason || "") + " · " + String(modelData.type || ""); color: Qt.darker(root.contentForeground, 1.5); font.family: root.contentFontFamily; font.pixelSize: Style.font.caption; elide: Text.ElideRight }
                }
                MouseArea { anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onEntered: root.cursorIndex = root.actionCount + root.repoCount + index; onClicked: root.activateThread(modelData) }
              }
            }
          }

          Text {
            visible: root.threadCount === 0
            width: parent.width
            text: root.service && root.service.notificationsError !== "" ? root.service.notificationsError : (root.service && !root.service.notificationsLoaded ? "Loading notifications" : "GitHub inbox clear")
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
