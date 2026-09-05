// timmo.workspace-relayout - dmenu-style overlay for layout presets.
//
// Same tempfile handshake as omarchy-menu-select. Alt+Enter or Alt+click
// appends a "flip" tag so the caller can invert the primary split.
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import QtQuick
import qs.Commons
import qs.Ui

Item {
  id: root

  property string omarchyPath: Quickshell.env("OMARCHY_PATH")
  property var shell: null
  property var manifest: null

  property bool opened: false
  property string prompt: "Select"
  property var options: []
  property string selectionFile: ""
  property string doneFile: ""
  property int menuWidth: 460
  property int menuMaxHeight: 360
  property bool requestActive: false
  property int requestSerial: 0
  property int applySerial: 0
  property string filterText: ""
  property int selectedIndex: 0
  property bool cursorActive: true

  property color background: Color.menu.background
  property color foreground: Color.menu.text
  property color border: Color.menu.border
  property var borderSpec: Border.surfaceSpec("menu", "border", border, Math.max(1, Style.space(2)))
  property color scrim: Color.menu.scrim
  property color selectedBackground: Color.menu.selectedBackground
  property color selectedText: Color.menu.selectedText
  property color selectedBorder: Color.menu.selectedBorder
  property var selectedBorderSpec: Border.surfaceSpec("menu", "selected-border", selectedBorder, 0)
  readonly property real rowReservedBorderLeft: Border.left(selectedBorderSpec)
  readonly property real rowReservedBorderRight: Border.right(selectedBorderSpec)
  readonly property int cornerRadius: Style.cornerRadius
  property string fontFamily: Style.font.menuFamily
  property int contentMargin: Style.spacing.panelPadding
  property int headerHeight: Math.max(Style.space(34), Style.font.title + Style.spacing.controlPaddingY * 2)
  property int contentSpacing: Style.spacing.md
  property int baseRowHeight: Math.max(Style.space(50), Style.font.body + Style.spacing.rowPaddingX * 2)
  property int rowSpacing: Style.spacing.xs
  property int cardWidth: Math.min(Style.space(root.menuWidth), panel.width - Style.gapsOut * 2)
  property int visibleRowsHeight: {
    var count = displayModel.count
    if (count === 0) return root.baseRowHeight
    var total = count * root.baseRowHeight + Math.max(0, count - 1) * root.rowSpacing
    var available = panel.height - Style.gapsOut * 2 - root.contentMargin * 2 - root.headerHeight - root.contentSpacing
    if (root.menuMaxHeight > 0) available = Math.min(available, Style.space(root.menuMaxHeight))
    return Math.min(total, available)
  }
  property int cardHeight: Math.min(
    root.contentMargin * 2 + root.headerHeight + root.contentSpacing + root.visibleRowsHeight,
    panel.height - Style.gapsOut * 2
  )

  function open(payloadJson) {
    var payload = ({})
    try { payload = JSON.parse(payloadJson || "{}") } catch (e) { payload = ({}) }

    requestSerial += 1
    prompt = String(payload.prompt || "Select")
    options = Array.isArray(payload.options) ? payload.options : []
    selectionFile = String(payload.selectionFile || "")
    doneFile = String(payload.doneFile || "")
    requestActive = !!doneFile
    menuWidth = Math.max(1, Number(payload.width || 460))
    menuMaxHeight = Math.max(0, Number(payload.maxHeight || 360))
    filterText = ""
    selectedIndex = 0
    cursorActive = true
    disarmPointer()
    opened = true
    rebuildDisplay()
    Qt.callLater(function() { keyCatcher.forceActiveFocus() })
  }

  function close() {
    cancel()
  }

  function disarmPointer() {
    pointerGate.reset()
  }

  function finishRequest(selection) {
    if (!root.requestActive || !root.doneFile) {
      root.opened = false
      return
    }

    var activeSelectionFile = root.selectionFile
    var activeDoneFile = root.doneFile
    applySerial = requestSerial
    root.requestActive = false
    root.selectionFile = ""
    root.doneFile = ""
    root.opened = false
    root.filterText = ""

    if (selection === null || selection === undefined) {
      resultProc.command = ["bash", "-c", ": > " + Util.shellQuote(activeDoneFile)]
    } else {
      resultProc.command = ["bash", "-c", "printf '%s\\n' " + Util.shellQuote(selection) + " > " + Util.shellQuote(activeSelectionFile) + "; : > " + Util.shellQuote(activeDoneFile)]
    }
    resultProc.running = true
  }

  function cancel() {
    if (root.requestActive) root.finishRequest(null)
    else root.opened = false
    root.filterText = ""
  }

  function rebuildDisplay() {
    displayModel.clear()
    var query = root.filterText.trim().toLowerCase()
    for (var i = 0; i < root.options.length; i++) {
      var label = String(root.options[i] || "")
      if (query && label.toLowerCase().indexOf(query) < 0) continue
      displayModel.append({ label: label })
    }

    if (displayModel.count === 0) selectedIndex = 0
    else if (selectedIndex >= displayModel.count) selectedIndex = displayModel.count - 1
    else if (selectedIndex < 0) selectedIndex = 0

    Qt.callLater(function() {
      if (displayModel.count > 0) resultList.positionViewAtIndex(root.selectedIndex, ListView.Contain)
    })
  }

  function select(delta) {
    if (displayModel.count === 0) return
    disarmPointer()
    if (!cursorActive) {
      cursorActive = true
      selectedIndex = delta < 0 ? displayModel.count - 1 : 0
    } else {
      selectedIndex = (selectedIndex + delta + displayModel.count) % displayModel.count
    }
    resultList.positionViewAtIndex(selectedIndex, ListView.Contain)
  }

  function setFilter(nextFilter) {
    root.filterText = nextFilter
    root.selectedIndex = 0
    root.cursorActive = true
    disarmPointer()
    root.rebuildDisplay()
  }

  function selectFromPointer(index, item, mouse) {
    if (!pointerGate.moved(item, mouse)) return
    root.cursorActive = true
    root.selectedIndex = index
  }

  function activateIndex(index, flipped) {
    if (index < 0 || index >= displayModel.count) return
    var picked = displayModel.get(index)
    var label = String(picked.label || "")
    if (!label) return
    root.finishRequest(flipped ? (label + "\tflip") : label)
  }

  ListModel { id: displayModel }

  Process {
    id: resultProc
    onExited: {
      if (root.applySerial === root.requestSerial)
        root.opened = false
    }
  }

  PointerMoveGate {
    id: pointerGate
    referenceItem: card
  }

  PanelWindow {
    id: panel
    visible: root.opened
    anchors { top: true; bottom: true; left: true; right: true }
    color: "transparent"
    WlrLayershell.namespace: "timmo-workspace-relayout"
    WlrLayershell.layer: WlrLayer.Overlay
    WlrLayershell.keyboardFocus: WlrKeyboardFocus.Exclusive
    exclusionMode: ExclusionMode.Ignore

    Rectangle {
      anchors.fill: parent
      color: root.scrim
    }

    MouseArea {
      anchors.fill: parent
      onClicked: root.cancel()
    }

    BorderSurface {
      id: card
      width: root.cardWidth
      height: Math.min(root.cardHeight, panel.height - Style.gapsOut * 2)
      radius: root.cornerRadius
      anchors.centerIn: parent
      color: root.background
      borderSpec: root.borderSpec
      padding: root.contentMargin

      MouseArea { anchors.fill: parent; onClicked: {} }

      Item {
        id: keyCatcher
        anchors.fill: parent
        focus: true

        Keys.priority: Keys.BeforeItem
        Keys.onPressed: function(event) {
          if (event.key === Qt.Key_Escape) {
            if (root.filterText) root.setFilter("")
            else root.cancel()
            event.accepted = true
          } else if (Util.editsFilter(event, root.filterText)) {
            root.setFilter(Util.editedFilter(event, root.filterText))
            event.accepted = true
          } else if (event.key === Qt.Key_Up) {
            root.select(-1)
            event.accepted = true
          } else if (event.key === Qt.Key_Down) {
            root.select(1)
            event.accepted = true
          } else if (event.key === Qt.Key_PageUp) {
            root.select(-6)
            event.accepted = true
          } else if (event.key === Qt.Key_PageDown) {
            root.select(6)
            event.accepted = true
          } else if (event.key === Qt.Key_Return || event.key === Qt.Key_Enter) {
            if (displayModel.count > 0)
              root.activateIndex(root.cursorActive ? root.selectedIndex : 0, !!(event.modifiers & Qt.AltModifier))
            event.accepted = true
          } else if (event.text && event.text.length === 1 && event.text.charCodeAt(0) >= 32 && event.text.charCodeAt(0) !== 127 && (event.modifiers === Qt.NoModifier || event.modifiers === Qt.ShiftModifier)) {
            root.setFilter(root.filterText + event.text)
            event.accepted = true
          }
        }
      }

      Column {
        anchors.fill: parent
        anchors.topMargin: card.contentTopInset
        anchors.rightMargin: card.contentRightInset
        anchors.bottomMargin: card.contentBottomInset
        anchors.leftMargin: card.contentLeftInset
        spacing: root.contentSpacing

        Rectangle {
          width: parent.width
          height: root.headerHeight
          radius: root.cornerRadius
          color: "transparent"

          Text {
            textFormat: Text.PlainText
            anchors.left: parent.left
            anchors.right: parent.right
            anchors.verticalCenter: parent.verticalCenter
            text: root.filterText || (root.prompt + "…")
            color: root.foreground
            opacity: root.filterText ? 1 : 0.58
            font.family: root.fontFamily
            font.pixelSize: Style.font.heading
            elide: Text.ElideRight
          }
        }

        Item {
          width: parent.width
          height: root.visibleRowsHeight

          ListView {
            id: resultList
            anchors.fill: parent
            model: displayModel
            clip: true
            spacing: root.rowSpacing
            boundsBehavior: Flickable.StopAtBounds

            delegate: BorderSurface {
              id: row
              required property int index
              required property string label

              readonly property bool hasCursor: root.cursorActive && row.index === root.selectedIndex

              width: ListView.view.width
              height: root.baseRowHeight
              radius: root.cornerRadius
              color: row.hasCursor ? root.selectedBackground : "transparent"
              borderSpec: row.hasCursor ? root.selectedBorderSpec : Border.none()

              Text {
                textFormat: Text.PlainText
                anchors.left: parent.left
                anchors.leftMargin: root.rowReservedBorderLeft + Style.space(18)
                anchors.right: parent.right
                anchors.rightMargin: root.rowReservedBorderRight + Style.space(18)
                anchors.verticalCenter: parent.verticalCenter
                text: row.label
                color: row.hasCursor ? root.selectedText : root.foreground
                font.family: root.fontFamily
                font.pixelSize: Style.font.heading
                font.weight: Font.Medium
                elide: Text.ElideRight
              }

              MouseArea {
                id: mouseArea
                anchors.fill: parent
                hoverEnabled: true
                cursorShape: Qt.PointingHandCursor
                onEntered: root.selectFromPointer(row.index, row, {
                  x: mouseArea.mouseX,
                  y: mouseArea.mouseY
                })
                onPositionChanged: function(mouse) {
                  root.selectFromPointer(row.index, row, mouse)
                }
                onClicked: function(mouse) {
                  root.cursorActive = true
                  root.selectedIndex = row.index
                  root.activateIndex(row.index, !!(mouse.modifiers & Qt.AltModifier))
                }
              }
            }
          }
        }
      }
    }
  }
}
