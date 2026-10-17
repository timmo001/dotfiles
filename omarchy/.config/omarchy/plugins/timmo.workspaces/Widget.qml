// timmo.workspaces — dynamic Hyprland workspace indicators.
//
// A fork of the stock omarchy.workspaces widget with three differences:
//   * No persistent workspaces. The stock widget always seeds 1-5; this one
//     shows only workspaces that currently exist (the occupied ones plus the
//     focused one), matching the old Waybar behaviour.
//   * Every workspace renders as its number, optionally followed by its
//     Hyprland name. The stock widget swaps the focused workspace for a
//     glyph icon; here the focused workspace keeps its number.
//   * The focused workspace sits at full opacity and the rest are dimmed,
//     so the active workspace reads as "number + full opacity".
//
// Per-instance settings (inline on the shell.json bar layout entry):
//   activeOpacity     Opacity of the focused workspace (default 1.0)
//   inactiveOpacity   Opacity of the other existing workspaces (default 0.5)
//   labels            "number", "focused" (name on the focused workspace
//                     only) or "all" (default "number")
//   revealOnHover     Show every name while the bar is hovered (default false)
//   nameColor         Colour of the name after the number (default theme accent)
//
// A workspace with no name of its own, and every workspace on a vertical bar,
// shows only its number.
import QtQuick
import QtQuick.Layouts
import Quickshell.Hyprland
import qs.Commons
import qs.Commons as Commons
import qs.Ui

BarWidget {
  id: root
  moduleName: "timmo.workspaces"

  readonly property real activeOpacity: setting("activeOpacity", 1.0)
  readonly property real inactiveOpacity: setting("inactiveOpacity", 0.5)
  readonly property string labels: root.revealOnHover && !!root.bar && root.bar.barHovered === true
    ? "all"
    : setting("labels", "number")
  readonly property bool revealOnHover: setting("revealOnHover", false)
  readonly property color nameColor: setting("nameColor", Commons.Color.accent)

  function label(id, focused) {
    var number = id === 10 ? "0" : String(id)
    if (root.vertical || root.labels === "number" || (root.labels === "focused" && !focused))
      return number

    var workspace = root.workspaceById(id)
    var name = workspace ? String(workspace.name || "") : ""
    return name === "" || name === String(id) ? number : number + " " + name
  }

  function workspaceById(id) {
    var values = Hyprland.workspaces.values
    for (var i = 0; i < values.length; i++) {
      if (values[i].id === id) return values[i]
    }

    return null
  }

  // Only workspaces that currently exist: every workspace Hyprland reports
  // (occupied ones, and the focused one which always exists) within the 1-10
  // range. No persistent seeding, so empty workspaces collapse away.
  function workspaceIds() {
    var ids = []
    var values = Hyprland.workspaces.values

    for (var i = 0; i < values.length; i++) {
      var id = values[i].id
      if (id > 0 && id <= 10 && ids.indexOf(id) === -1) ids.push(id)
    }

    // Defensive: the focused workspace always exists in Hyprland, but make
    // sure it is present even if the model has not caught up yet.
    var focused = Hyprland.focusedWorkspace
    if (focused !== null && focused.id > 0 && focused.id <= 10 && ids.indexOf(focused.id) === -1)
      ids.push(focused.id)

    ids.sort(function(left, right) { return left - right })
    return ids
  }

  function focusWorkspace(id) {
    if (!root.bar) return
    root.bar.run("hyprctl dispatch " + Util.shellQuote("hl.dsp.focus({ workspace = \"" + id + "\" })"))
  }

  // Gap before the first workspace, to separate it from the menu icon on its
  // left. Tunable via the `leadingGap` setting (in Style space units).
  readonly property real leadingGap: root.vertical ? 0 : Style.spaceReal(setting("leadingGap", 6))
  readonly property real trailingGap: root.vertical ? 0 : Style.spaceReal(1.5)

  implicitWidth: grid.implicitWidth + leadingGap + trailingGap
  implicitHeight: grid.implicitHeight

  GridLayout {
    id: grid
    anchors.fill: parent
    anchors.leftMargin: root.leadingGap
    anchors.rightMargin: root.trailingGap
    columns: root.vertical ? 1 : Math.max(1, root.workspaceIds().length)
    columnSpacing: root.vertical ? 0 : Style.space(1)
    rowSpacing: root.vertical ? Style.space(2) : 0

    Repeater {
      model: root.workspaceIds()

      WidgetButton {
        required property int modelData

        readonly property bool focused: Hyprland.focusedWorkspace !== null && Hyprland.focusedWorkspace.id === modelData

        id: button

        readonly property int nameStart: text.indexOf(" ")
        readonly property bool named: nameStart !== -1

        bar: root.bar
        fontSize: 11
        text: root.label(modelData, focused)
        // A named button keeps its plain label for sizing and draws the number
        // and the accent-coloured name itself.
        labelVisible: !named
        opacity: focused ? root.activeOpacity : root.inactiveOpacity
        horizontalMargin: 6
        verticalPadding: 6
        // Numbers keep a fixed slot so they don't jitter; named ones fit their text.
        fixedWidth: root.vertical ? root.barSize : (named ? -1 : Style.space(20))
        fixedHeight: root.barSize
        onPressed: function() { root.focusWorkspace(modelData) }

        Row {
          visible: button.named
          anchors.centerIn: parent

          Repeater {
            model: button.named
              ? [
                  { text: button.text.slice(0, button.nameStart), color: button.foreground },
                  { text: button.text.slice(button.nameStart), color: root.nameColor }
                ]
              : []

            Text {
              required property var modelData

              textFormat: Text.PlainText
              text: modelData.text
              color: modelData.color
              font.family: button.fontFamily
              font.pixelSize: button.fontSize
              renderType: Text.NativeRendering
            }
          }
        }
      }
    }
  }
}
