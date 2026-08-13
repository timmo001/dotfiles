import QtQuick
import QtQuick.Controls
import Quickshell
import qs.Commons
import qs.Ui

Panel {
  id: root
  moduleName: "timmo.twitch"
  ipcTarget: "timmo.twitch"
  manageIpc: false

  property var anchorItem: null
  property var hostWidget: null
  property var service: null
  property int cursorIndex: 0

  readonly property var barIdentity: hostWidget || root
  readonly property color contentForeground: bar ? bar.foreground : Color.foreground
  readonly property string contentFontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property int actionCount: 5
  readonly property int cursorCount: actionCount + (service ? service.channels.length : 0)
  readonly property var actionLabels: [
    "Recheck notifications",
    "Open all live autolaunch",
    "Open following",
    "Open following live",
    "Restart notifications"
  ]
  readonly property var actionIcons: ["", "󰕃", "", "", "󰜉"]

  onCursorCountChanged: {
    if (cursorIndex >= cursorCount) cursorIndex = Math.max(0, cursorCount - 1)
  }

  function open() {
    cursorIndex = 0
    if (service) service.refresh()
    controller.show()
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function close() {
    controller.hide()
  }

  function toggle() {
    if (opened) close()
    else open()
  }

  function switchPanel(direction) {
    if (bar && typeof bar.switchPanelFrom === "function")
      return bar.switchPanelFrom(barIdentity, direction)
    return false
  }

  function moveCursor(delta) {
    if (cursorCount <= 0) return
    cursorIndex = (cursorIndex + delta + cursorCount) % cursorCount
    Qt.callLater(scrollCursorIntoView)
  }

  function cursorItem() {
    if (cursorIndex < actionCount) return actionRepeater.itemAt(cursorIndex)
    return channelRepeater.itemAt(cursorIndex - actionCount)
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
    if (index === 0) service.recheck(false)
    else if (index === 1) {
      service.recheck(true)
      close()
    } else if (index === 2) {
      service.openFollowing()
      close()
    } else if (index === 3) {
      service.openFollowingLive()
      close()
    }
    else if (index === 4) service.restart()
  }

  function activateChannel(channel) {
    if (!service) return
    service.openChannel(channel)
    close()
  }

  function activateCursor() {
    if (cursorIndex < actionCount) {
      activateAction(cursorIndex)
      return
    }
    var channelIndex = cursorIndex - actionCount
    if (service && channelIndex >= 0 && channelIndex < service.channels.length)
      activateChannel(service.channels[channelIndex])
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    centerOnBar: true
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(430))
    contentHeight: panel.fittedContentHeight(contentColumn.implicitHeight, Style.space(620))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onMoveRequested: function(dx, dy) {
        if (dy !== 0) root.moveCursor(dy)
      }
      onActivateRequested: root.activateCursor()
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onTextKey: function(text) {
        if (text === "r" || text === "R") {
          root.cursorIndex = 0
          root.activateAction(0)
        }
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
            title: "Twitch"
            meta: !root.service || root.service.statusState === "inactive"
              ? "Notifications unavailable"
              : (root.service.statusState === "live"
                ? root.service.liveCount + " live now"
                : "No channels live")
            detail: root.service && root.service.active ? "ACTIVE" : "OFFLINE"
            foreground: root.contentForeground
            fontFamily: root.contentFontFamily
            iconOpacity: root.service && root.service.active ? 1 : 0.5
            iconComponent: Component {
              Text {
                text: ""
                color: root.service && root.service.statusState === "live" ? "#ac77e5" : root.contentForeground
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
                accent: index === 4 && root.bar ? root.bar.urgent : root.contentForeground

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
                    text: root.actionIcons[index]
                    color: index === 4 && root.bar ? root.bar.urgent : root.contentForeground
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.icon
                    horizontalAlignment: Text.AlignHCenter
                  }

                  Text {
                    width: Math.max(0, actionRow.width - Style.space(32))
                    text: root.actionLabels[index]
                    color: root.contentForeground
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.body
                    elide: Text.ElideRight
                  }
                }

                MouseArea {
                  anchors.fill: parent
                  hoverEnabled: true
                  cursorShape: Qt.PointingHandCursor
                  onEntered: root.cursorIndex = index
                  onClicked: root.activateAction(index)
                }
              }
            }
          }

          Text {
            text: root.service && root.service.liveCount > 0 ? "CHANNELS · " + root.service.liveCount + " LIVE" : "CHANNELS"
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
              id: channelRepeater
              model: root.service ? root.service.channels : []

              CursorSurface {
                required property int index
                required property var modelData
                width: contentColumn.width
                implicitHeight: channelColumn.implicitHeight + Style.space(12)
                hasCursor: root.cursorIndex === root.actionCount + index
                foreground: root.contentForeground
                accent: modelData.live === true ? "#ac77e5" : root.contentForeground

                Row {
                  anchors.left: parent.left
                  anchors.right: parent.right
                  anchors.verticalCenter: parent.verticalCenter
                  anchors.leftMargin: Style.space(8)
                  anchors.rightMargin: Style.space(8)
                  spacing: Style.space(10)

                  Text {
                    width: Style.space(22)
                    text: modelData.live === true ? "" : "󰖪"
                    color: modelData.live === true ? "#ac77e5" : Qt.darker(root.contentForeground, 1.5)
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.icon
                    horizontalAlignment: Text.AlignHCenter
                  }

                  Column {
                    id: channelColumn
                    width: Math.max(0, parent.width - Style.space(62))
                    spacing: Style.space(2)

                    Text {
                      width: parent.width
                      text: String(modelData.login || "")
                      color: root.contentForeground
                      font.family: root.contentFontFamily
                      font.pixelSize: Style.font.body
                      font.bold: modelData.live === true
                      elide: Text.ElideRight
                    }

                    Text {
                      width: parent.width
                      visible: text !== ""
                      text: modelData.live === true ? String(modelData.title || "") : "Offline · open recent broadcasts"
                      color: Qt.darker(root.contentForeground, 1.4)
                      font.family: root.contentFontFamily
                      font.pixelSize: Style.font.caption
                      elide: Text.ElideRight
                    }
                  }

                  Text {
                    width: Style.space(20)
                    visible: modelData.autoOpen === true
                    text: "󰋺"
                    color: Qt.darker(root.contentForeground, 1.3)
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.caption
                    horizontalAlignment: Text.AlignHCenter
                  }
                }

                MouseArea {
                  anchors.fill: parent
                  hoverEnabled: true
                  cursorShape: Qt.PointingHandCursor
                  onEntered: root.cursorIndex = root.actionCount + index
                  onClicked: root.activateChannel(modelData)
                }
              }
            }
          }

          Text {
            visible: root.service && root.service.channels.length === 0
            width: parent.width
            text: root.service && root.service.errorText !== ""
              ? root.service.errorText : "No configured channels"
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
