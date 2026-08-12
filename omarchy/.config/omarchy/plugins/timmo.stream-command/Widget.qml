// timmo.stream-command — streaming command bar widget.
//
// Runs a long-running `exec` that emits newline-delimited status-bar JSON
// (text/tooltip/class) and renders the most recent line. Auto-restarts the
// process after it exits. Used for Home Assistant watchers (ha-watch-singleton
// / ha-module-bar doorbell) that the Omarchy 4 bar cannot drive as one-shot
// polling command modules.
//
// Per-instance settings (inline on the shell.json bar layout entry):
//   run              Long-running command emitting JSON lines on stdout
//   tooltip          Whether to show the JSON tooltip (default true)
//   onClick          Command run on left click
//   onClickRight     Command run on right click
//   onMiddleClick    Command run on middle click
//   classColors      Map of class name -> colour string
//   hideClasses      Array of class names that hide the widget
//   restartInterval  Delay before restarting after exit, ms (default 5000)
//   hiddenText       Text shown dimmed while a class-hidden widget is revealed
import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui

BarWidget {
  id: root

  readonly property string exec: setting("run", "")
  readonly property bool tooltipEnabled: setting("tooltip", true)
  readonly property string onClickCmd: setting("onClick", "")
  readonly property string onClickRightCmd: setting("onClickRight", "")
  readonly property string onMiddleClickCmd: setting("onMiddleClick", "")
  readonly property var classColors: setting("classColors", ({}))
  readonly property var hideClasses: setting("hideClasses", [])
  readonly property int restartDelayMs: setting("restartInterval", 5000)
  readonly property string hiddenText: setting("hiddenText", "")
  readonly property bool revealOnHover: setting("revealOnHover", false)
  // Horizontal cell margin, standard 6px across all custom widgets (center,
  // right HA, left). The built-in right-side stock widgets keep their own
  // margins. Per-instance overridable via the `horizontalMargin` setting.
  readonly property real cellMargin: setting("horizontalMargin", 6)

  property string outText: ""
  property string outTooltip: ""
  property string outClass: ""

  readonly property bool hiddenByClass: {
    var classes = root.outClass.split(/\s+/)
    for (var i = 0; i < root.hideClasses.length; i++) {
      if (classes.indexOf(root.hideClasses[i]) !== -1) return true
    }
    return false
  }

  readonly property string revealText: root.outText !== "" ? root.outText : root.hiddenText

  // Reveal class-hidden modules dimmed while the bar is hovered, mirroring the
  // stock idle indicators. hiddenText covers producers that emit empty text.
  readonly property bool hoverRevealed: root.revealOnHover
    && root.hiddenByClass
    && root.revealText !== ""
    && !!root.bar
    && root.bar.barHovered === true

  // Whether this widget has anything to draw: a non-empty value that is not
  // hidden by class, or a class-hidden value revealed by hovering the center
  // cluster. Mirrors the WidgetButton `text` binding below. Drives
  // `visible`/`implicitWidth` so a hidden module collapses to zero width and
  // the bar reflows, instead of reserving the button's minimum width as an
  // empty gap.
  readonly property bool shown: (!root.hiddenByClass && root.outText !== "")
    || root.hoverRevealed

  function applyOutput(raw) {
    var trimmed = (raw || "").trim()
    if (trimmed === "") return
    try {
      var obj = JSON.parse(trimmed)
      root.outText = obj.text !== undefined && obj.text !== null ? String(obj.text) : ""
      root.outTooltip = obj.tooltip !== undefined && obj.tooltip !== null ? String(obj.tooltip) : ""
      if (obj["class"] !== undefined && obj["class"] !== null) root.outClass = String(obj["class"])
      else if (obj.alt !== undefined && obj.alt !== null) root.outClass = String(obj.alt)
      else root.outClass = ""
    } catch (e) {
      root.outText = trimmed
      root.outTooltip = ""
      root.outClass = ""
    }
  }

  function colorForClass(cls) {
    if (cls && root.classColors && root.classColors[cls]) return root.classColors[cls]
    return root.bar ? root.bar.barForeground : Color.foreground
  }

  visible: root.shown
  implicitWidth: root.shown ? button.implicitWidth : 0
  implicitHeight: button.implicitHeight

  Process {
    id: proc
    running: root.exec !== ""
    command: ["bash", "-lc", root.exec]
    stdout: SplitParser {
      onRead: function (line) {
        root.applyOutput(line)
      }
    }
    onExited: function (exitCode) {
      if (root.exec !== "") restartTimer.start()
    }
  }

  Timer {
    id: restartTimer
    interval: Math.max(1000, root.restartDelayMs)
    repeat: false
    onTriggered: {
      if (root.exec !== "" && !proc.running) proc.running = true
    }
  }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    // Match the stock right-side indicators (audio/network/tray), which render
    // at caption size. The clock/weather sit at body, but their Weather-Icons
    // and digit glyphs are visually lighter than the Material Design / Font
    // Awesome icons these modules use, so caption keeps the icons in step.
    fontSize: Style.font.caption
    horizontalMargin: root.cellMargin
    text: root.hoverRevealed ? root.revealText : (root.hiddenByClass ? "" : root.outText)
    dimmed: root.hoverRevealed
    tooltipText: root.tooltipEnabled ? root.outTooltip : ""
    foreground: root.colorForClass(root.outClass)
    onPressed: function (b) {
      if (!root.bar) return
      if (b === Qt.RightButton) {
        if (root.onClickRightCmd !== "") root.bar.run(root.onClickRightCmd)
      } else if (b === Qt.MiddleButton) {
        if (root.onMiddleClickCmd !== "") root.bar.run(root.onMiddleClickCmd)
      } else {
        if (root.onClickCmd !== "") root.bar.run(root.onClickCmd)
      }
    }
  }
}
