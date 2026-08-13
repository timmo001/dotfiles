import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui

Panel {
  id: root
  moduleName: "timmo.home-assistant"

  Config { id: config }

  property var anchorItem: null
  property var hostWidget: null
  property var service: null
  property int cursorIndex: 0

  readonly property var barIdentity: hostWidget || root
  readonly property var panelConfig: config.panel
  readonly property color contentForeground: bar ? bar.foreground : Color.foreground
  readonly property string contentFontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property var rows: service ? service.rows : []
  readonly property int cursorCount: rows.length

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

  function cursorItem() { return rowRepeater.itemAt(cursorIndex) }

  function scrollCursorIntoView() {
    var item = cursorItem()
    if (!item) return
    var point = item.mapToItem(contentColumn, 0, 0)
    if (point.y < panelFlick.contentY) panelFlick.contentY = point.y
    else if (point.y + item.height > panelFlick.contentY + panelFlick.height)
      panelFlick.contentY = point.y + item.height - panelFlick.height
  }

  function activateRow(row) {
    if (!service || !row || !row.action) return
    if (row.opensLink) close()
    service.activate(row.id)
  }

  function activateCursor() {
    if (cursorIndex >= 0 && cursorIndex < rows.length)
      activateRow(rows[cursorIndex])
  }

  function rowValue(row) {
    if (!row.available) return "Unavailable"
    var tooltipLine = String(row.tooltip || "").split("\n")[0]
    var separator = tooltipLine.lastIndexOf(": ")
    if (separator >= 0) return tooltipLine.slice(separator + 2)
    var value = String(row.text || "").trim()
    if (row.icon && value.indexOf(row.icon) === 0)
      value = value.slice(String(row.icon).length).trim()
    if (value !== "") return value
    var classes = String(row.className || "").split(/\s+/)
    if (classes.indexOf("hidden") !== -1 || classes.indexOf("inactive") !== -1)
      return row.inactiveText
    if (row.severity === "active") return row.activeText
    return row.className !== "" ? row.className : "Available"
  }

  function rowColor(row) {
    return row.color || contentForeground
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    focusTarget: keyCatcher
    contentWidth: panel.fittedContentWidth(Style.space(root.panelConfig.width))
    contentHeight: panel.fittedContentHeight(contentColumn.implicitHeight, Style.space(root.panelConfig.maxHeight))

    PanelKeyCatcher {
      id: keyCatcher
      anchors.fill: parent
      onMoveRequested: function(dx, dy) { if (dy !== 0) root.moveCursor(dy) }
      onActivateRequested: root.activateCursor()
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onTextKey: function(text) {
        if (text === "r" || text === "R") {
          if (root.service) root.service.refresh()
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
          spacing: Style.space(root.panelConfig.contentSpacing)

          Text {
            width: parent.width
            text: root.panelConfig.title
            color: root.contentForeground
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.title
            font.bold: true
            bottomPadding: Style.space(root.panelConfig.titleBottomPadding)
          }

          Repeater {
            id: rowRepeater
            model: root.rows

            Column {
              required property int index
              required property var modelData
              width: contentColumn.width
              spacing: Style.space(root.panelConfig.contentSpacing)

              readonly property bool startsGroup: index === 0
                || root.rows[index - 1].group !== modelData.group

              Text {
                visible: parent.startsGroup
                width: parent.width
                topPadding: parent.index === 0 ? 0 : Style.space(root.panelConfig.groupTopPadding)
                bottomPadding: Style.space(root.panelConfig.groupBottomPadding)
                text: parent.modelData.group.toUpperCase()
                color: Qt.darker(root.contentForeground, root.panelConfig.groupColorFactor)
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.caption
                font.bold: true
                font.letterSpacing: root.panelConfig.groupLetterSpacing
              }

              CursorSurface {
                width: parent.width
                implicitHeight: rowContent.implicitHeight + Style.space(root.panelConfig.rowPadding)
                hasCursor: root.cursorIndex === parent.index
                foreground: root.contentForeground
                accent: root.rowColor(parent.modelData)

                Row {
                  id: rowContent
                  anchors.left: parent.left
                  anchors.right: parent.right
                  anchors.verticalCenter: parent.verticalCenter
                  anchors.leftMargin: Style.space(root.panelConfig.rowHorizontalPadding)
                  anchors.rightMargin: Style.space(root.panelConfig.rowHorizontalPadding)
                  spacing: Style.space(root.panelConfig.rowSpacing)

                  Text {
                    width: Style.space(root.panelConfig.iconWidth)
                    text: modelData.icon
                    color: root.rowColor(modelData)
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.icon
                    horizontalAlignment: Text.AlignHCenter
                  }

                  Column {
                    width: Math.max(0, parent.width - Style.space(root.panelConfig.textReservedWidth))
                    spacing: Style.space(root.panelConfig.rowTextSpacing)

                    Text {
                      width: parent.width
                      text: modelData.label
                      color: root.contentForeground
                      font.family: root.contentFontFamily
                      font.pixelSize: Style.font.body
                      elide: Text.ElideRight
                    }

                    Text {
                      width: parent.width
                      text: root.rowValue(modelData)
                      color: Qt.darker(root.contentForeground, root.panelConfig.valueColorFactor)
                      font.family: root.contentFontFamily
                      font.pixelSize: Style.font.caption
                      elide: Text.ElideRight
                    }
                  }
                }

                MouseArea {
                  anchors.fill: parent
                  hoverEnabled: true
                  cursorShape: modelData.action ? Qt.PointingHandCursor : Qt.ArrowCursor
                  onEntered: root.cursorIndex = index
                  onClicked: root.activateRow(modelData)
                }
              }
            }
          }
        }
      }
    }
  }
}
