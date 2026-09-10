import QtQuick
import qs.Commons
import qs.Ui

Rectangle {
  id: root

  required property string title
  property color foreground: Color.foreground
  property string fontFamily: Style.font.family
  property bool refreshable: false
  property bool refreshing: false
  property bool hasCursor: false

  signal refreshRequested()
  signal refreshHovered()

  width: parent.width
  implicitHeight: Math.max(titleText.implicitHeight, refreshButton.implicitHeight) + Style.space(12)
  radius: 0
  color: Qt.rgba(foreground.r, foreground.g, foreground.b, 0.06)
  border.width: 1
  border.color: Qt.rgba(foreground.r, foreground.g, foreground.b, 0.16)

  Text {
    id: titleText
    anchors.left: parent.left
    anchors.leftMargin: Style.space(12)
    anchors.right: refreshButton.visible ? refreshButton.left : parent.right
    anchors.rightMargin: Style.space(12)
    anchors.verticalCenter: parent.verticalCenter
    text: root.title.toUpperCase()
    textFormat: Text.PlainText
    elide: Text.ElideRight
    color: Qt.darker(root.foreground, 1.15)
    font.family: root.fontFamily
    font.pixelSize: Style.font.caption
    font.bold: true
    font.letterSpacing: 1.2
  }

  PanelActionButton {
    id: refreshButton
    anchors.right: parent.right
    anchors.rightMargin: Style.space(8)
    anchors.verticalCenter: parent.verticalCenter
    visible: root.refreshable
    enabled: !root.refreshing
    iconText: "󰑐"
    tooltipText: root.refreshing ? "Refreshing " + root.title.toLowerCase() : "Refresh " + root.title.toLowerCase()
    foreground: Qt.darker(root.foreground, 1.15)
    fontFamily: root.fontFamily
    hasCursor: root.hasCursor
    onHovered: function(hovered) { if (hovered) root.refreshHovered() }
    onClicked: root.refreshRequested()
  }
}
