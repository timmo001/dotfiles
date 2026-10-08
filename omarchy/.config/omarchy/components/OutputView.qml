import QtQuick
import QtQuick.Controls
import qs.Commons

// Read-only monospace output, such as a log or command result, that scrolls
// on its own once it passes `maxHeight` and keeps its text selectable.
Rectangle {
  id: root

  property string text: ""
  property real maxHeight: Style.space(240)
  property color foreground: Color.foreground
  property string fontFamily: "monospace"

  width: parent ? parent.width : implicitWidth
  implicitHeight: Math.min(maxHeight, output.implicitHeight + Style.space(12))
  color: Qt.rgba(foreground.r, foreground.g, foreground.b, 0.05)
  border.width: 1
  border.color: Qt.rgba(foreground.r, foreground.g, foreground.b, 0.12)
  clip: true

  Flickable {
    id: flick
    anchors.fill: parent
    anchors.margins: Style.space(6)
    contentWidth: width
    contentHeight: output.implicitHeight
    boundsBehavior: Flickable.StopAtBounds
    interactive: contentHeight > height
    ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

    TextEdit {
      id: output
      width: flick.width
      text: root.text
      textFormat: TextEdit.PlainText
      readOnly: true
      selectByMouse: true
      wrapMode: TextEdit.WrapAtWordBoundaryOrAnywhere
      color: root.foreground
      selectionColor: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.3)
      selectedTextColor: root.foreground
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
    }
  }
}
