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
  property var expanded: ({ issues: true, "issues-empty": true })
  signal hovered(string key)
  signal activated(var entry, int modifiers)
  signal refreshRequested()
  signal agentRequested(var entry)
  signal copyRequested(var entry)
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
    model: ["issues", "issues-empty"]
    Column {
      id: group
      required property string modelData
      readonly property var entries: root.rows.filter(function(row) { return row.section === group.modelData && row.kind !== "header-action" })
      readonly property bool bodyShown: root.expanded[modelData] !== false
      visible: modelData === "issues" || root.view === "issues"
      width: root.width
      spacing: Style.space(8)

      function itemForKey(key) {
        if (key === "toggle:" + modelData) return heading
        if (key === "action:issues-refresh" && modelData === "issues") return heading
        for (var i = 0; i < entries.length; i++)
          if (entries[i].key === key) return items.itemAt(i)
        return null
      }

      SectionHeading {
        id: heading
        title: group.modelData === "issues-empty" ? "Without issues · " + group.entries.length
          : (root.view === "issues" ? "With issues" : "Issues") + " · " + group.entries.filter(function(row) { return row.kind !== "issue-action" }).length
        foreground: root.foreground
        fontFamily: root.fontFamily
        refreshable: group.modelData === "issues"
        refreshing: root.refreshing
        hasCursor: root.cursorKey === "action:issues-refresh" && group.modelData === "issues"
        collapsible: root.sectionsCollapsible
        expanded: group.bodyShown
        toggleHasCursor: root.cursorKey === "toggle:" + group.modelData
        onToggleHovered: root.hovered("toggle:" + group.modelData)
        onToggleRequested: root.toggleRequested(group.modelData)
        onRefreshHovered: root.hovered("action:issues-refresh")
        onRefreshRequested: root.refreshRequested()
      }

      Text {
        visible: group.modelData === "issues" && group.bodyShown && root.status !== ""
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
            id: item
            required property var modelData
            readonly property bool issue: modelData.kind === "issue"
            x: Style.space(8)
            width: Math.max(0, group.width - Style.space(16))
            implicitHeight: row.implicitHeight + Style.space(12)
            hasCursor: root.cursorKey === modelData.key
            foreground: root.foreground
            accent: root.foreground
            Row {
              id: row
              anchors.left: parent.left
              anchors.right: item.issue ? buttons.left : parent.right
              anchors.verticalCenter: parent.verticalCenter
              anchors.margins: Style.space(8)
              spacing: Style.space(10)
              Text {
                width: Style.space(22)
                text: modelData.kind === "issue-action" ? "󰙅" : ""
                color: root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.icon
                horizontalAlignment: Text.AlignHCenter
              }
              Column {
                width: Math.max(0, row.width - Style.space(32))
                spacing: Style.space(2)
                Text { width: parent.width; text: modelData.primaryText; textFormat: Text.PlainText; color: root.foreground; font.family: root.fontFamily; font.pixelSize: Style.font.body; elide: Text.ElideRight }
                Text { visible: text !== ""; width: parent.width; text: modelData.secondaryText; textFormat: Text.PlainText; color: Qt.darker(root.foreground, 1.4); font.family: root.fontFamily; font.pixelSize: Style.font.caption; elide: Text.ElideRight }
              }
            }
            MouseArea {
              anchors.left: parent.left
              anchors.right: item.issue ? buttons.left : parent.right
              anchors.top: parent.top
              anchors.bottom: parent.bottom
              hoverEnabled: true
              cursorShape: Qt.PointingHandCursor
              onEntered: root.hovered(modelData.key)
              onClicked: function(mouse) { root.activated(modelData, mouse.modifiers) }
            }
            Row {
              id: buttons
              visible: item.issue
              anchors.right: parent.right
              anchors.rightMargin: Style.space(8)
              anchors.verticalCenter: parent.verticalCenter
              spacing: Style.space(4)
              PanelActionButton {
                iconText: "󱚣"
                tooltipText: "Open in agent"
                foreground: root.foreground
                fontFamily: root.fontFamily
                onHovered: function(hovered) { if (hovered) root.hovered(modelData.key) }
                onClicked: root.agentRequested(modelData)
              }
              PanelActionButton {
                iconText: "󰆏"
                tooltipText: "Copy link"
                foreground: root.foreground
                fontFamily: root.fontFamily
                onHovered: function(hovered) { if (hovered) root.hovered(modelData.key) }
                onClicked: root.copyRequested(modelData)
              }
            }
          }
        }
      }
    }
  }
}
