import QtQuick
import QtQuick.Controls
import Quickshell
import qs.Commons
import qs.Ui
import "../../components"

Panel {
  id: root
  moduleName: "timmo.twitch"
  ipcTarget: "timmo.twitch"
  manageIpc: false

  property var anchorItem: null
  property var hostWidget: null
  property var service: null

  readonly property var barIdentity: hostWidget || root
  readonly property color contentForeground: bar ? bar.foreground : Color.foreground
  readonly property string contentFontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property int actionCount: 5
  readonly property var actionLabels: [
    "Recheck notifications",
    "Open all live autolaunch",
    "Open following",
    "Open following live",
    "Restart notifications"
  ]
  readonly property var actionIcons: ["", "󰕃", "", "", "󰜉"]
  readonly property var panelRows: buildPanelRows()
  readonly property var filteredActions: filterRows("action")
  readonly property var filteredChannels: filterRows("channel")

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
    var channels = service ? service.channels : []
    for (var j = 0; j < channels.length; j++) {
      var channel = channels[j]
      rows.push({
        key: "channel:" + String(channel.login || j),
        kind: "channel",
        section: "channel",
        value: channel,
        primaryText: channel.login,
        secondaryText: channel.title
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

  function cursorItem() {
    var entry = filterController.selectedEntry()
    if (!entry) return null
    var rows = entry.kind === "action" ? filteredActions : filteredChannels
    var repeater = entry.kind === "action" ? actionRepeater : channelRepeater
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

  function activateEntry(entry) {
    if (entry.kind === "action") activateAction(entry.actionIndex)
    else if (entry.kind === "channel") activateChannel(entry.value)
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    focusTarget: filterController
    contentWidth: panel.fittedContentWidth(Style.space(430))
    contentHeight: panel.fittedContentHeight(contentColumn.implicitHeight, Style.space(670))

    FilterablePanel {
      id: filterController
      anchors.fill: parent
      model: root.panelRows
      onRevealRequested: Qt.callLater(root.scrollCursorIntoView)
      onActivateRequested: function(entry) { root.activateEntry(entry) }
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onRefreshRequested: root.activateAction(0)

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
                accent: modelData.actionIndex === 4 && root.bar ? root.bar.urgent : root.contentForeground

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
                    text: root.actionIcons[modelData.actionIndex]
                    color: modelData.actionIndex === 4 && root.bar ? root.bar.urgent : root.contentForeground
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.icon
                    horizontalAlignment: Text.AlignHCenter
                  }

                  Text {
                    width: Math.max(0, actionRow.width - Style.space(32))
                    text: root.actionLabels[modelData.actionIndex]
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
                  onEntered: filterController.cursorIndex = filterController.indexForKey(modelData.key)
                  onClicked: root.activateAction(modelData.actionIndex)
                }
              }
            }
          }

          Text {
            visible: root.filteredChannels.length > 0
            text: filterController.filterText
              ? "CHANNELS · " + root.filteredChannels.length + " MATCHING"
              : (root.service && root.service.liveCount > 0 ? "CHANNELS · " + root.service.liveCount + " LIVE" : "CHANNELS")
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
              model: root.filteredChannels

              CursorSurface {
                required property int index
                required property var modelData
                width: contentColumn.width
                implicitHeight: channelColumn.implicitHeight + Style.space(12)
                hasCursor: filterController.cursorIndex === filterController.indexForKey(modelData.key)
                foreground: root.contentForeground
                accent: modelData.value.live === true ? "#ac77e5" : root.contentForeground

                Row {
                  anchors.left: parent.left
                  anchors.right: parent.right
                  anchors.verticalCenter: parent.verticalCenter
                  anchors.leftMargin: Style.space(8)
                  anchors.rightMargin: Style.space(8)
                  spacing: Style.space(10)

                  Text {
                    width: Style.space(22)
                    text: modelData.value.live === true ? "" : "󰖪"
                    color: modelData.value.live === true ? "#ac77e5" : Qt.darker(root.contentForeground, 1.5)
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
                      text: String(modelData.value.login || "")
                      color: root.contentForeground
                      font.family: root.contentFontFamily
                      font.pixelSize: Style.font.body
                      font.bold: modelData.value.live === true
                      elide: Text.ElideRight
                    }

                    Text {
                      width: parent.width
                      visible: text !== ""
                      text: modelData.value.live === true ? String(modelData.value.title || "") : "Offline · open recent broadcasts"
                      color: Qt.darker(root.contentForeground, 1.4)
                      font.family: root.contentFontFamily
                      font.pixelSize: Style.font.caption
                      elide: Text.ElideRight
                    }
                  }

                  Text {
                    width: Style.space(20)
                    visible: modelData.value.autoOpen === true
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
                  onEntered: filterController.cursorIndex = filterController.indexForKey(modelData.key)
                  onClicked: root.activateChannel(modelData.value)
                }
              }
            }
          }

          Text {
            visible: filterController.count === 0
            width: parent.width
            text: filterController.filterText
              ? "No matches for “" + filterController.filterText + "”"
              : (root.service && root.service.errorText !== "" ? root.service.errorText : "No configured channels")
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
