import QtQuick
import QtQuick.Controls
import Quickshell
import Quickshell.Wayland
import qs.Commons
import qs.Commons as Commons
import qs.Ui
import "../../components" as PanelComponents

// Games from the Steam, Heroic and Lutris shortcuts, each launched through
// `dot game launch` so it runs in gaming mode. Type to filter.
Item {
  id: root

  property var shell: null
  property var service: null
  property bool opened: false
  readonly property color foreground: Commons.Color.foreground
  readonly property string fontFamily: Style.font.family
  readonly property color mutedColor: Qt.darker(foreground, 1.4)
  readonly property var storeOrder: ["steam", "heroic", "lutris"]
  readonly property var rows: buildRows()
  readonly property var stores: storeOrder.filter(function(store) {
    return filterController.filteredModel.some(function(row) { return row.kind === "game" && row.section === store })
  })
  readonly property var actionRows: filterController.filteredModel.filter(function(row) { return row.kind === "action" })

  function buildRows() {
    if (!service) return []
    var rows = []
    for (var s = 0; s < storeOrder.length; s++) {
      var games = service.games.filter(function(game) { return game.store === storeOrder[s] })
      games.sort(function(a, b) { return String(a.name).localeCompare(String(b.name)) })
      for (var i = 0; i < games.length; i++)
        rows.push({
          key: "game:" + games[i].url,
          kind: "game",
          section: games[i].store,
          primaryText: String(games[i].name || ""),
          secondaryText: storeTitle(games[i].store),
          value: games[i]
        })
    }
    // Last, so the cursor starts on the first game.
    if (service.active)
      rows.push({ key: "action:off", kind: "action", action: "off", primaryText: "Turn off gaming mode", secondaryText: "Restart paused services and turn HDR back off", icon: "󰏤" })
    return rows
  }

  function storeTitle(store) {
    return store === "steam" ? "Steam" : store === "heroic" ? "Heroic" : "Lutris"
  }

  function storeIcon(store) {
    return store === "steam" ? "󰓓" : store === "heroic" ? "󰊴" : "󰮂"
  }

  function iconSource(icon) {
    var name = String(icon || "")
    if (name === "") return ""
    if (name.charAt(0) === "/") return "file://" + name
    return Quickshell.iconPath(name, true)
  }

  function heroMeta() {
    if (!service || !service.loaded) return "Loading games"
    if (service.errorText !== "") return service.errorText
    if (service.active) return "Gaming mode is on"
    return service.games.length + " game" + (service.games.length === 1 ? "" : "s")
  }

  function activateEntry(entry) {
    if (!entry || !service) return
    if (entry.kind === "action" && entry.action === "off") service.turnOff()
    else if (entry.kind === "game") service.launch(entry.value.url)
    requestClose()
  }

  function rowItem(key) {
    for (var i = 0; i < storeRepeater.count; i++) {
      var section = storeRepeater.itemAt(i)
      var item = section ? section.itemForKey(key) : null
      if (item) return item
    }
    for (var j = 0; j < actionRepeater.count; j++)
      if (actionRepeater.itemAt(j) && actionRepeater.itemAt(j).rowKey === key) return actionRepeater.itemAt(j)
    return null
  }

  function scrollCursorIntoView() {
    var entry = filterController.selectedEntry()
    var item = entry ? rowItem(entry.key) : null
    if (!item) return
    var point = item.mapToItem(contentColumn, 0, 0)
    if (point.y < scrollArea.contentY) scrollArea.contentY = point.y
    else if (point.y + item.height > scrollArea.contentY + scrollArea.height)
      scrollArea.contentY = point.y + item.height - scrollArea.height
  }

  function open(payloadJson) {
    opened = true
    filterController.reset()
    if (service) service.refresh()
    Qt.callLater(function() {
      scrollArea.contentY = 0
      filterController.forceActiveFocus()
    })
  }
  function close() {
    opened = false
  }
  function requestClose() {
    if (shell && typeof shell.hide === "function") shell.hide("timmo.games")
    else close()
  }

  component GameRow: CursorSurface {
    id: gameRow
    required property var modelData
    readonly property string rowKey: modelData.key
    width: contentColumn.width
    implicitHeight: Style.space(40)
    hasCursor: filterController.cursorIndex === filterController.indexForKey(rowKey)
    foreground: root.foreground
    accent: root.foreground

    MouseArea {
      anchors.fill: parent
      hoverEnabled: true
      cursorShape: Qt.PointingHandCursor
      onEntered: filterController.cursorIndex = filterController.indexForKey(gameRow.rowKey)
      onClicked: root.activateEntry(gameRow.modelData)
    }

    Item {
      anchors.fill: parent
      anchors.leftMargin: Style.space(8)
      anchors.rightMargin: Style.space(8)

      Image {
        id: gameIcon
        anchors.left: parent.left
        anchors.verticalCenter: parent.verticalCenter
        width: Style.space(24)
        height: Style.space(24)
        sourceSize.width: width
        sourceSize.height: height
        fillMode: Image.PreserveAspectFit
        source: gameRow.modelData.value ? root.iconSource(gameRow.modelData.value.icon) : ""
        visible: status === Image.Ready
      }

      Text {
        anchors.left: parent.left
        anchors.verticalCenter: parent.verticalCenter
        width: Style.space(24)
        visible: !gameIcon.visible
        text: root.storeIcon(gameRow.modelData.section)
        color: root.mutedColor
        font.family: root.fontFamily
        font.pixelSize: Style.font.icon
        horizontalAlignment: Text.AlignHCenter
      }

      Text {
        anchors.left: parent.left
        anchors.leftMargin: Style.space(34)
        anchors.right: parent.right
        anchors.verticalCenter: parent.verticalCenter
        text: gameRow.modelData.primaryText
        textFormat: Text.PlainText
        color: root.foreground
        font.family: root.fontFamily
        font.pixelSize: Style.font.body
        elide: Text.ElideRight
      }
    }
  }

  PanelWindow {
    visible: root.opened
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    exclusionMode: ExclusionMode.Ignore
    WlrLayershell.namespace: "timmo-games"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive

    Rectangle {
      anchors.fill: parent
      color: Commons.Color.menu.scrim
      MouseArea {
        anchors.fill: parent
        onClicked: root.requestClose()
      }
    }

    Rectangle {
      anchors.centerIn: parent
      width: Math.min(Style.space(460), parent.width - Style.space(32))
      height: Math.min(contentColumn.implicitHeight + Style.space(32), Style.space(670), parent.height - Style.space(32))
      color: Commons.Color.background
      radius: Style.cornerRadius

      MouseArea { anchors.fill: parent; onClicked: {} }

      PanelComponents.FilterablePanel {
        id: filterController
        anchors.fill: parent
        model: root.rows
        onActivateRequested: function(entry) { root.activateEntry(entry) }
        onCloseRequested: root.requestClose()
        onRefreshRequested: if (root.service) root.service.refresh()
        onRevealRequested: Qt.callLater(root.scrollCursorIntoView)

        PanelComponents.PanelFlickable {
          id: scrollArea
          anchors.fill: parent
          anchors.margins: Style.space(16)
          contentWidth: width
          contentHeight: contentColumn.implicitHeight
          clip: true
          boundsBehavior: Flickable.StopAtBounds
          flickableDirection: Flickable.VerticalFlick
          interactive: contentHeight > height
          ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

          Column {
            id: contentColumn
            width: scrollArea.width
            spacing: Style.space(12)

            PanelComponents.PanelHeader {
              title: filterController.filterText || "Games"
              meta: root.heroMeta()
              foreground: root.foreground
              fontFamily: root.fontFamily
              iconComponent: Component {
                Text {
                  text: "󰊴"
                  color: root.foreground
                  opacity: root.service && root.service.active ? 1 : 0.6
                  font.family: root.fontFamily
                  font.pixelSize: Style.font.display
                }
              }
            }

            Repeater {
              id: storeRepeater
              model: root.stores

              Column {
                id: storeSection
                required property string modelData
                required property int index
                readonly property var entries: filterController.filteredModel.filter(function(row) {
                  return row.kind === "game" && row.section === storeSection.modelData
                })
                width: contentColumn.width
                spacing: Style.space(4)

                function itemForKey(key) {
                  for (var i = 0; i < entries.length; i++)
                    if (entries[i].key === key) return gameRepeater.itemAt(i)
                  return null
                }

                PanelComponents.SectionHeading {
                  title: root.storeTitle(storeSection.modelData) + " · " + storeSection.entries.length
                  icon: root.storeIcon(storeSection.modelData)
                  foreground: root.foreground
                  fontFamily: root.fontFamily
                  refreshable: storeSection.index === 0
                  refreshing: root.service ? root.service.refreshing : false
                  onRefreshRequested: if (root.service) root.service.refresh()
                }

                Column {
                  width: parent.width
                  spacing: Style.space(2)

                  Repeater {
                    id: gameRepeater
                    model: storeSection.entries
                    GameRow {}
                  }
                }
              }
            }

            Text {
              visible: root.service !== null && root.service.loaded && root.stores.length === 0
              width: parent.width
              horizontalAlignment: Text.AlignHCenter
              text: filterController.filterText ? "No games match" : "No game shortcuts found"
              textFormat: Text.PlainText
              color: root.mutedColor
              font.family: root.fontFamily
              font.pixelSize: Style.font.caption
            }

            Column {
              visible: root.actionRows.length > 0
              width: parent.width
              spacing: Style.space(2)

              Repeater {
                id: actionRepeater
                model: root.actionRows

                CursorSurface {
                  id: actionRow
                  required property var modelData
                  readonly property string rowKey: modelData.key
                  width: contentColumn.width
                  implicitHeight: actionColumn.implicitHeight + Style.space(12)
                  hasCursor: filterController.cursorIndex === filterController.indexForKey(rowKey)
                  foreground: root.foreground
                  accent: root.foreground

                  MouseArea {
                    anchors.fill: parent
                    hoverEnabled: true
                    cursorShape: Qt.PointingHandCursor
                    onEntered: filterController.cursorIndex = filterController.indexForKey(actionRow.rowKey)
                    onClicked: root.activateEntry(actionRow.modelData)
                  }

                  Column {
                    id: actionColumn
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
                    anchors.leftMargin: Style.space(42)
                    anchors.rightMargin: Style.space(8)
                    spacing: Style.space(2)

                    Text {
                      width: parent.width
                      text: actionRow.modelData.primaryText
                      textFormat: Text.PlainText
                      color: root.foreground
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.body
                    }

                    Text {
                      width: parent.width
                      text: actionRow.modelData.secondaryText
                      textFormat: Text.PlainText
                      color: root.mutedColor
                      font.family: root.fontFamily
                      font.pixelSize: Style.font.caption
                      elide: Text.ElideRight
                    }
                  }

                  Text {
                    anchors.left: parent.left
                    anchors.leftMargin: Style.space(8)
                    anchors.verticalCenter: parent.verticalCenter
                    width: Style.space(24)
                    text: actionRow.modelData.icon
                    color: root.foreground
                    font.family: root.fontFamily
                    font.pixelSize: Style.font.icon
                    horizontalAlignment: Text.AlignHCenter
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
