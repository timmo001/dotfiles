import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui
import "../../components"

Panel {
  id: root
  moduleName: "timmo.home-assistant"

  Config { id: config }

  property var anchorItem: null
  property var hostWidget: null
  property var service: null
  readonly property var barIdentity: hostWidget || root
  readonly property var panelConfig: config.panel
  readonly property color contentForeground: bar ? bar.foreground : Color.foreground
  readonly property string contentFontFamily: bar ? bar.fontFamily : Style.font.family
  readonly property var rows: service ? service.rows : []
  readonly property var panelRows: buildPanelRows()

  function buildPanelRows() {
    var entries = []
    var statusEntries = []
    var environmentEntries = []
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i]
      if (row.barOnly) continue
      var entry = {
        key: "row:" + String(row.id || i),
        section: row.group,
        value: row,
        primaryText: row.label,
        secondaryText: [row.group, row.subgroup, rowValue(row)].join(" ")
      }
      if (row.group === "Status") statusEntries.push(entry)
      else if (row.group === "Environment") environmentEntries.push(entry)
      else entries.push(entry)
    }
    return entries.concat(environmentEntries, statusEntries)
  }

  function buildNavigationEntries(entries) {
    var targets = []
    for (var i = 0; i < entries.length; i++) {
      var entry = entries[i]
      var row = entry.value
      var inlineActions = row.inlineActions || []
      var presets = row.presets || []
      if (row.action) targets.push({ key: entry.key, rowKey: entry.key, row: row, kind: "row" })
      for (var actionIndex = 0; actionIndex < inlineActions.length; actionIndex++)
        targets.push({
          key: entry.key + ":inline:" + inlineActions[actionIndex].id,
          rowKey: entry.key,
          row: row,
          target: inlineActions[actionIndex],
          kind: "command"
        })
      if (row.control === "number") {
        targets.push({ key: entry.key + ":decrement", rowKey: entry.key,
          row: row, command: row.decrementCommand, kind: "command" })
        targets.push({ key: entry.key + ":increment", rowKey: entry.key,
          row: row, command: row.incrementCommand, kind: "command" })
      } else if (row.control === "toggle") {
        targets.push({ key: entry.key + ":toggle", rowKey: entry.key,
          row: row, command: row.toggleCommand, kind: "command" })
      }
      for (var presetIndex = 0; presetIndex < presets.length; presetIndex++) {
        var preset = presets[presetIndex]
        if (preset === undefined || preset === null) continue
        var presetValue = preset.value === undefined ? preset : preset.value
        targets.push({ key: entry.key + ":preset:" + presetValue, rowKey: entry.key,
          row: row, target: preset, kind: "preset" })
      }
    }
    return targets
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

  function close() { controller.hide() }
  function toggle() { if (opened) close(); else open() }

  function switchPanel(direction) {
    if (bar && typeof bar.switchPanelFrom === "function")
      return bar.switchPanelFrom(barIdentity, direction)
    return false
  }

  function cursorItem() {
    var selected = filterController.selectedEntry()
    if (!selected) return null
    for (var i = 0; i < filterController.filteredModel.length; i++)
      if (filterController.filteredModel[i].key === selected.rowKey)
        return rowRepeater.itemAt(i)
    return null
  }

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

  function activateEntry(entry) {
    if (!entry || !service) return
    if (entry.kind === "row") activateRow(entry.row)
    else if (entry.kind === "preset") service.activatePreset(entry.row, entry.target)
    else service.runControl(entry.command || entry.target.command)
  }

  function targetSelected(key) {
    return filterController.cursorActive
      && filterController.indexForKey(key) === filterController.cursorIndex
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

  function gridColumns(row) {
    if (row.control) return 1
    if (row.gridAction) return row.actionColumns || 5
    if (["Status", "Environment"].indexOf(row.group) !== -1) return 2
    return 1
  }

  component ControlButton: BorderSurface {
    required property var modelData
    required property var row
    property string targetKey: ""
    readonly property bool actionable: modelData.command !== undefined
      || modelData.value !== undefined
    readonly property bool hovered: buttonMouse.containsMouse
      || (targetKey !== "" && root.targetSelected(targetKey))
    width: Math.max(Style.space(28), buttonLabel.implicitWidth + Style.space(12))
    height: Style.space(24)
    radius: Style.cornerRadius
    color: hovered && actionable
      ? Style.hoverFillFor(root.rowColor(row), root.rowColor(row))
      : "transparent"
    borderSpec: Border.none()

    Text {
      id: buttonLabel
      anchors.centerIn: parent
      text: parent.modelData.label
      color: root.contentForeground
      font.family: root.contentFontFamily
      font.pixelSize: Style.font.body
    }

    MouseArea {
      id: buttonMouse
      anchors.fill: parent
      hoverEnabled: true
      enabled: parent.actionable
      cursorShape: enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
      onEntered: {
        var targetIndex = filterController.indexForKey(parent.targetKey)
        filterController.selectIndex(targetIndex)
      }
      onClicked: {
        if (parent.modelData.value !== undefined)
          root.service.activatePreset(parent.row, parent.modelData)
        else
          root.service.runControl(parent.modelData.command)
      }
    }
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    focusTarget: filterController
    contentWidth: panel.fittedContentWidth(Style.space(root.panelConfig.width))
    contentHeight: panel.fittedContentHeight(contentColumn.implicitHeight, Style.space(root.panelConfig.maxHeight))

    FilterablePanel {
      id: filterController
      anchors.fill: parent
      model: root.panelRows
      navigationModel: root.buildNavigationEntries(filteredModel)
      cursorStartsActive: false
      onRevealRequested: Qt.callLater(root.scrollCursorIntoView)
      onActivateRequested: function(entry) { root.activateEntry(entry) }
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onRefreshRequested: if (root.service) root.service.refresh()

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

        Flow {
          id: contentColumn
          width: panelFlick.width
          spacing: Style.space(root.panelConfig.contentSpacing)

          PanelHero {
            width: parent.width
            title: filterController.filterText || root.panelConfig.title
            foreground: root.contentForeground
            fontFamily: root.contentFontFamily
            iconComponent: Component {
              Text {
                text: config.bar.icon
                color: config.colors.blue
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.display
              }
            }
          }

          Repeater {
            id: rowRepeater
            model: filterController.filteredModel

            Column {
              id: rowItem
              required property int index
              required property var modelData
              readonly property int columns: root.gridColumns(modelData.value)
              readonly property int groupOffset: {
                var offset = 0
                for (var previous = index - 1; previous >= 0; previous--) {
                  if (filterController.filteredModel[previous].value.group !== modelData.value.group) break
                  offset++
                }
                return offset
              }
              readonly property bool startsGroup: groupOffset === 0
              readonly property bool startsSubgroup: modelData.value.subgroup !== ""
                && (startsGroup
                  || filterController.filteredModel[index - 1].value.subgroup !== modelData.value.subgroup)
              readonly property bool startsGroupRow: startsGroup
                || (columns === 2 && groupOffset === 1
                  && root.gridColumns(filterController.filteredModel[index - 1].value) === 2)
              readonly property bool endsGroup: index === filterController.filteredModel.length - 1
                || filterController.filteredModel[index + 1].value.group !== modelData.value.group
              readonly property bool endsOddGrid: columns === 2 && endsGroup && groupOffset % 2 === 0

              width: endsOddGrid ? contentColumn.width
                : (contentColumn.width - contentColumn.spacing * (columns - 1)) / columns
                  - (modelData.value.compactAction ? Style.space(1) : 0)
              spacing: Style.space(root.panelConfig.contentSpacing)

              Text {
                visible: parent.startsGroupRow
                width: parent.width
                topPadding: parent.index === 0 ? 0 : Style.space(root.panelConfig.groupTopPadding)
                bottomPadding: Style.space(root.panelConfig.groupBottomPadding)
                text: parent.startsGroup ? parent.modelData.value.group.toUpperCase() : " "
                color: Qt.darker(root.contentForeground, root.panelConfig.groupColorFactor)
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.caption
                font.bold: true
                font.letterSpacing: root.panelConfig.groupLetterSpacing
              }

              Text {
                visible: parent.startsSubgroup
                width: parent.width
                topPadding: Style.space(root.panelConfig.groupTopPadding)
                bottomPadding: Style.space(root.panelConfig.groupBottomPadding)
                text: parent.modelData.value.subgroup
                color: Qt.darker(root.contentForeground, root.panelConfig.valueColorFactor)
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.caption
                font.bold: true
              }

              CursorSurface {
                width: parent.endsOddGrid
                  ? (contentColumn.width - contentColumn.spacing) / 2
                  : parent.width
                implicitHeight: (parent.modelData.value.control !== ""
                  ? controlContent.implicitHeight
                  : parent.modelData.value.gridAction ? gridContent.implicitHeight : rowContent.implicitHeight)
                  + Style.space(root.panelConfig.rowPadding)
                hasCursor: root.targetSelected(parent.modelData.key)
                  && parent.modelData.value.inlineActions.length === 0
                  && parent.modelData.value.control === ""
                  && !controlLinkMouse.containsMouse
                foreground: root.contentForeground
                accent: root.rowColor(parent.modelData.value)

                BorderSurface {
                  anchors.left: parent.left
                  anchors.top: parent.top
                  anchors.bottom: parent.bottom
                  width: Math.max(0, parent.width - inlineButtons.width
                    - Style.space(root.panelConfig.rowHorizontalPadding)
                    - Style.space(root.panelConfig.rowSpacing))
                  visible: inlineLinkMouse.enabled
                  radius: Style.cornerRadius
                  readonly property bool highlighted: inlineLinkMouse.containsMouse
                    || root.targetSelected(rowItem.modelData.key)
                  color: highlighted
                    ? Style.hoverFillFor(root.rowColor(modelData.value), root.rowColor(modelData.value))
                    : "transparent"
                  borderSpec: highlighted
                    ? Border.controlSpec("hover-cursor", root.contentForeground,
                      root.rowColor(modelData.value))
                    : Border.none()
                }

                Row {
                  id: rowContent
                  visible: !modelData.value.gridAction && modelData.value.control === ""
                  anchors.left: parent.left
                  anchors.right: parent.right
                  anchors.verticalCenter: parent.verticalCenter
                  anchors.leftMargin: Style.space(root.panelConfig.rowHorizontalPadding)
                  anchors.rightMargin: Style.space(root.panelConfig.rowHorizontalPadding)
                  spacing: Style.space(root.panelConfig.rowSpacing)

                  Text {
                    visible: text !== ""
                    width: visible ? Style.space(root.panelConfig.iconWidth) : 0
                    text: modelData.value.icon || ""
                    color: root.rowColor(modelData.value)
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.icon
                    horizontalAlignment: Text.AlignHCenter
                  }

                  Column {
                    width: Math.max(0, parent.width
                      - (modelData.value.icon ? Style.space(root.panelConfig.textReservedWidth) : 0)
                      - (inlineButtons.visible ? inlineButtons.width + parent.spacing : 0))
                    spacing: Style.space(root.panelConfig.rowTextSpacing)

                    Text {
                      width: parent.width
                      text: modelData.value.label
                      color: root.contentForeground
                      font.family: root.contentFontFamily
                      font.pixelSize: Style.font.body
                      elide: Text.ElideRight
                    }

                    Text {
                      width: parent.width
                      text: root.rowValue(modelData.value)
                      color: Qt.darker(root.contentForeground, root.panelConfig.valueColorFactor)
                      font.family: root.contentFontFamily
                      font.pixelSize: Style.font.caption
                      elide: Text.ElideRight
                    }
                  }

                  BorderSurface {
                    id: inlineButtons
                    visible: modelData.value.inlineActions.length > 0
                    implicitWidth: inlineButtonRow.implicitWidth + Style.space(4)
                    implicitHeight: inlineButtonRow.implicitHeight + Style.space(4)
                    radius: Style.cornerRadius
                    color: Qt.rgba(root.contentForeground.r, root.contentForeground.g,
                      root.contentForeground.b, 0.04)
                    borderSpec: Border.flat(Qt.rgba(root.contentForeground.r, root.contentForeground.g,
                      root.contentForeground.b, 0.10), 1)
                    anchors.verticalCenter: parent.verticalCenter

                    Row {
                      id: inlineButtonRow
                      anchors.centerIn: parent
                      spacing: Style.space(2)

                      Repeater {
                        model: modelData.value.inlineActions

                        ControlButton {
                          row: rowItem.modelData.value
                          targetKey: rowItem.modelData.key + ":inline:" + modelData.id
                        }
                      }
                    }
                  }
                }

                Column {
                  id: gridContent
                  visible: modelData.value.gridAction === true
                  width: parent.width
                  anchors.centerIn: parent
                  spacing: Style.space(root.panelConfig.rowTextSpacing)

                  Rectangle {
                    visible: modelData.value.curtainPosition >= 0
                    x: (parent.width - width) / 2
                    width: Style.space(28)
                    height: Style.space(14)
                    color: "transparent"
                    border.width: 1
                    border.color: root.rowColor(modelData.value)

                    Rectangle {
                      anchors.top: parent.top
                      anchors.right: parent.right
                      anchors.bottom: parent.bottom
                      anchors.margins: 2
                      width: Math.max(0, parent.width - 4)
                        * (100 - Number(modelData.value.curtainPosition || 0)) / 100
                      color: root.rowColor(modelData.value)
                    }
                  }

                  Text {
                    width: parent.width
                    text: modelData.value.label
                    color: root.contentForeground
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.caption
                    horizontalAlignment: Text.AlignHCenter
                  }
                }

                Column {
                  id: controlContent
                  readonly property var row: modelData.value
                  visible: modelData.value.control !== ""
                  anchors.left: parent.left
                  anchors.right: parent.right
                  anchors.verticalCenter: parent.verticalCenter
                  anchors.leftMargin: Style.space(root.panelConfig.rowHorizontalPadding)
                  anchors.rightMargin: Style.space(root.panelConfig.rowHorizontalPadding)
                  spacing: Style.space(root.panelConfig.rowTextSpacing)

                  Row {
                    width: parent.width
                    spacing: Style.space(root.panelConfig.rowSpacing)

                    Rectangle {
                      width: Math.max(0, parent.width - controlButtons.width - parent.spacing)
                      height: controlButtons.height
                      anchors.verticalCenter: parent.verticalCenter
                      radius: Style.cornerRadius
                      color: controlLinkMouse.containsMouse
                          || root.targetSelected(rowItem.modelData.key)
                        ? Style.hoverFillFor(root.rowColor(controlContent.row),
                          root.rowColor(controlContent.row))
                        : "transparent"

                      Text {
                        anchors.left: parent.left
                        anchors.right: parent.right
                        anchors.verticalCenter: parent.verticalCenter
                        text: controlContent.row.label
                        color: root.contentForeground
                        font.family: root.contentFontFamily
                        font.pixelSize: Style.font.body
                        elide: Text.ElideRight
                      }

                      MouseArea {
                        id: controlLinkMouse
                        anchors.fill: parent
                        hoverEnabled: true
                        enabled: controlContent.row.action !== undefined
                          && controlContent.row.action !== ""
                        cursorShape: enabled ? Qt.PointingHandCursor : Qt.ArrowCursor
                        onEntered: filterController.selectIndex(
                          filterController.indexForKey(rowItem.modelData.key))
                        onClicked: root.activateRow(controlContent.row)
                      }
                    }

                    BorderSurface {
                      id: controlButtons
                      implicitWidth: buttonRow.implicitWidth + Style.space(4)
                      implicitHeight: buttonRow.implicitHeight + Style.space(4)
                      radius: Style.cornerRadius
                      color: Qt.rgba(root.contentForeground.r, root.contentForeground.g,
                        root.contentForeground.b, 0.04)
                      borderSpec: Border.flat(Qt.rgba(root.contentForeground.r, root.contentForeground.g,
                        root.contentForeground.b, 0.10), 1)

                      Row {
                        id: buttonRow
                        anchors.centerIn: parent
                        spacing: Style.space(2)

                        Repeater {
                          model: controlContent.row.control === "number"
                            ? [
                                { label: "-", command: controlContent.row.decrementCommand,
                                  targetKey: rowItem.modelData.key + ":decrement" },
                                { label: root.rowValue(controlContent.row) },
                                { label: "+", command: controlContent.row.incrementCommand,
                                  targetKey: rowItem.modelData.key + ":increment" }
                              ]
                            : [{
                                label: controlContent.row.severity === "active" ? "On" : "Off",
                                command: controlContent.row.toggleCommand,
                                targetKey: rowItem.modelData.key + ":toggle"
                              }]

                          ControlButton {
                            row: controlContent.row
                            targetKey: modelData.targetKey || ""
                          }
                        }
                      }
                    }
                  }

                  BorderSurface {
                    visible: controlContent.row.control === "number"
                      && controlContent.row.presets.length > 0
                    anchors.right: parent.right
                    implicitWidth: presetRow.implicitWidth + Style.space(4)
                    implicitHeight: presetRow.implicitHeight + Style.space(4)
                    radius: Style.cornerRadius
                    color: Qt.rgba(root.contentForeground.r, root.contentForeground.g,
                      root.contentForeground.b, 0.04)
                    borderSpec: Border.flat(Qt.rgba(root.contentForeground.r, root.contentForeground.g,
                      root.contentForeground.b, 0.10), 1)

                    Row {
                      id: presetRow
                      anchors.centerIn: parent
                      spacing: Style.space(2)

                      Repeater {
                        model: controlContent.row.presets

                        ControlButton {
                          row: controlContent.row
                          targetKey: rowItem.modelData.key + ":preset:"
                            + (modelData.value === undefined ? modelData : modelData.value)
                        }
                      }
                    }
                  }
                }

                MouseArea {
                  anchors.fill: parent
                  hoverEnabled: true
                  enabled: modelData.value.control === ""
                    && modelData.value.inlineActions.length === 0
                  cursorShape: modelData.value.action ? Qt.PointingHandCursor : Qt.ArrowCursor
                  onEntered: filterController.selectIndex(
                    filterController.indexForKey(rowItem.modelData.key))
                  onClicked: root.activateRow(modelData.value)
                }

                MouseArea {
                  id: inlineLinkMouse
                  anchors.left: parent.left
                  anchors.top: parent.top
                  anchors.bottom: parent.bottom
                  width: Math.max(0, parent.width - inlineButtons.width
                    - Style.space(root.panelConfig.rowHorizontalPadding)
                    - Style.space(root.panelConfig.rowSpacing))
                  hoverEnabled: true
                  enabled: modelData.value.control === ""
                    && modelData.value.inlineActions.length > 0
                  cursorShape: modelData.value.action ? Qt.PointingHandCursor : Qt.ArrowCursor
                  onEntered: filterController.selectIndex(
                    filterController.indexForKey(rowItem.modelData.key))
                  onClicked: root.activateRow(modelData.value)
                }
              }
            }
          }

          Text {
            visible: filterController.filterText && filterController.count === 0
            width: parent.width
            text: "No matches for “" + filterController.filterText + "”"
            color: Qt.darker(root.contentForeground, root.panelConfig.valueColorFactor)
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.body
            horizontalAlignment: Text.AlignHCenter
          }
        }
      }
    }
  }
}
