import QtQuick
import qs.Commons
import qs.Ui
import "../../components"

Column {
  id: root

  required property var rows
  required property string view
  required property string cursorKey
  required property color foreground
  required property string fontFamily
  property bool refreshing: false
  property string status: ""
  property bool sectionsCollapsible: false
  property var expanded: ({ pulls: true, "pulls-empty": true })
  signal hovered(string key)
  signal activated(var entry, int modifiers)
  signal refreshRequested()
  signal ignoreRequested(var entry)
  signal toggleRequested(string id)

  spacing: Style.space(8)

  function itemForKey(key) {
    for (var i = 0; i < groups.count; i++) {
      var group = groups.itemAt(i)
      var item = group ? group.itemForKey(key) : null
      if (item) return item
    }
    return null
  }

  Repeater {
    id: groups
    model: ["pulls", "pulls-empty"]
    Column {
      id: group
      required property string modelData
      readonly property var entries: root.rows.filter(function(row) { return row.section === group.modelData && row.kind !== "header-action" })
      readonly property bool bodyShown: root.expanded[modelData] !== false
      visible: modelData === "pulls" || root.view === "pulls"
      width: root.width
      spacing: Style.space(8)

      function itemForKey(key) {
        if (key === "toggle:" + modelData) return heading
        if (key === "action:pulls-refresh" && modelData === "pulls") return heading
        for (var i = 0; i < entries.length; i++)
          if (entries[i].key === key) return items.itemAt(i)
        return null
      }

      SectionHeading {
        id: heading
        title: group.modelData === "pulls-empty" ? "Without pull requests · " + group.entries.length
          : (root.view === "pulls" ? "With pull requests" : "Pull requests") + " · " + group.entries.filter(function(row) { return row.kind !== "pull-action" }).length
        foreground: root.foreground
        fontFamily: root.fontFamily
        refreshable: group.modelData === "pulls"
        refreshing: root.refreshing
        hasCursor: root.cursorKey === "action:pulls-refresh" && group.modelData === "pulls"
        collapsible: root.sectionsCollapsible
        expanded: group.bodyShown
        toggleHasCursor: root.cursorKey === "toggle:" + group.modelData
        onToggleHovered: root.hovered("toggle:" + group.modelData)
        onToggleRequested: root.toggleRequested(group.modelData)
        onRefreshHovered: root.hovered("action:pulls-refresh")
        onRefreshRequested: root.refreshRequested()
      }

      Text {
        visible: group.modelData === "pulls" && group.bodyShown && root.status !== ""
        width: parent.width
        text: root.status
        textFormat: Text.PlainText
        wrapMode: Text.WrapAnywhere
        color: Qt.darker(root.foreground, 1.4)
        font.family: root.fontFamily
        font.pixelSize: Style.font.caption
      }

      Column {
        visible: group.bodyShown
        width: parent.width
        spacing: Style.space(2)
        Repeater {
          id: items
          model: group.entries
          CursorSurface {
            required property var modelData
            x: Style.space(8)
            width: Math.max(0, group.width - Style.space(16))
            implicitHeight: row.implicitHeight + Style.space(12)
            hasCursor: root.cursorKey === modelData.key
            foreground: root.foreground
            accent: root.foreground
            Row {
              id: row
              anchors.left: parent.left
              anchors.right: ignoreButton.visible ? ignoreButton.left : parent.right
              anchors.verticalCenter: parent.verticalCenter
              anchors.margins: Style.space(8)
              spacing: Style.space(10)
              Text {
                width: Style.space(22)
                text: modelData.kind === "pull-action" ? "󰙅" : ""
                color: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.icon
                horizontalAlignment: Text.AlignHCenter
              }
              Column {
                width: Math.max(0, row.width - Style.space(32))
                spacing: Style.space(2)
                Text { width: parent.width; text: modelData.primaryText; textFormat: Text.PlainText; color: root.foreground; font.family: root.fontFamily; font.pixelSize: Style.font.body; font.bold: modelData.ready === true; elide: Text.ElideRight }
                Text { visible: text !== ""; width: parent.width; text: modelData.secondaryText; textFormat: Text.PlainText; color: Qt.darker(root.foreground, 1.4); font.family: root.fontFamily; font.pixelSize: Style.font.caption; elide: Text.ElideRight }
              }
            }
            MouseArea {
              anchors.left: parent.left
              anchors.right: ignoreButton.visible ? ignoreButton.left : parent.right
              anchors.top: parent.top
              anchors.bottom: parent.bottom
              hoverEnabled: true
              cursorShape: Qt.PointingHandCursor
              onEntered: root.hovered(modelData.key)
              onClicked: function(mouse) { root.activated(modelData, mouse.modifiers) }
            }
            PanelActionButton {
              id: ignoreButton
              anchors.right: parent.right
              anchors.rightMargin: Style.space(8)
              anchors.verticalCenter: parent.verticalCenter
              visible: modelData.kind === "pull"
              enabled: !root.refreshing
              iconText: "󰈉"
              tooltipText: "Ignore pull request"
              foreground: root.foreground
              fontFamily: root.fontFamily
              onHovered: function(hovered) { if (hovered) root.hovered(modelData.key) }
              onClicked: root.ignoreRequested(modelData)
            }
          }
        }
      }
    }
  }
}
