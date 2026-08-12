// timmo.command — generic polling command bar widget.
//
// Runs `exec` on an interval and renders the resulting status-bar JSON
// (text/tooltip/class) via a WidgetButton, mapping the parsed class to a
// colour and hiding on configured classes. The Waybar custom/* equivalent
// for the Omarchy 4 Quickshell bar.
//
// Per-instance settings (inline on the shell.json bar layout entry):
//   run            Shell command to run (its stdout is parsed)
//   interval       Poll interval in milliseconds (default 60000)
//   returnType     "json" (text/tooltip/class) or "text" (default "json")
//   tooltip        Whether to show the JSON tooltip (default true)
//   onClick        Command run on left click
//   onClickRight   Command run on right click
//   onMiddleClick  Command run on middle click
//   classColors    Map of class name -> colour string
//   hideClasses    Array of class names that hide the widget
//   refreshTarget  Optional IPC target id exposing a refresh() method
//   loadingText    Placeholder shown while (re)loading (e.g. "\uf418 ..")
//   loadingClass   Class used to colour loadingText (e.g. "dots-unknown")
//   hiddenText     Text shown dimmed while a class-hidden widget is revealed
//   stockIconSize  Match a stock icon widget's glyph and slot size
//   iconScale      Scale the glyph for stock-sized icon widgets
import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui

BarWidget {
  id: root

  readonly property string exec: setting("run", "")
  readonly property int intervalMs: setting("interval", 60000)
  readonly property string returnType: setting("returnType", "json")
  readonly property bool tooltipEnabled: setting("tooltip", true)
  readonly property string onClickCmd: setting("onClick", "")
  readonly property string onClickRightCmd: setting("onClickRight", "")
  readonly property string onMiddleClickCmd: setting("onMiddleClick", "")
  readonly property var classColors: setting("classColors", ({}))
  readonly property var hideClasses: setting("hideClasses", [])
  readonly property string refreshTarget: setting("refreshTarget", "")
  readonly property string loadingText: setting("loadingText", "")
  readonly property string loadingClass: setting("loadingClass", "")
  readonly property string hiddenText: setting("hiddenText", "")
  readonly property bool revealOnHover: setting("revealOnHover", false)
  readonly property bool stockIconSize: setting("stockIconSize", false)
  readonly property real iconScale: setting("iconScale", 1)
  // Horizontal cell margin, standard 6px across all custom widgets (center,
  // right HA, left). The built-in right-side stock widgets keep their own
  // margins. Per-instance overridable via the `horizontalMargin` setting.
  readonly property real cellMargin: setting("horizontalMargin", 6)

  property string outText: ""
  property string outTooltip: ""
  property string outClass: ""
  property bool loading: false

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

  // Whether this widget has anything to draw: the loading placeholder, a
  // non-empty value that is not hidden by class, or a class-hidden value
  // revealed by hovering the center cluster. Mirrors the WidgetButton `text`
  // binding below. Drives `visible`/`implicitWidth` so a hidden module
  // collapses to zero width and the bar reflows, instead of reserving the
  // button's minimum width as an empty gap.
  readonly property bool shown: (root.loading && root.loadingText !== "")
    || (!root.hiddenByClass && root.outText !== "")
    || root.hoverRevealed

  // Background poll (timer): only show the loading placeholder on a cold
  // start when there is no value yet, so warm polls update smoothly.
  function poll() {
    if (root.exec === "") return
    if (root.outText === "" && root.loadingText !== "") root.loading = true
    if (!proc.running) proc.running = true
  }

  // Explicit refresh (IPC / resume): always show the loading placeholder so
  // the reload is visible, like the legacy grey "loading" state.
  function refresh() {
    if (root.exec === "") return
    if (root.loadingText !== "") root.loading = true
    if (!proc.running) proc.running = true
  }

  function refreshMatchingTarget(target) {
    if (root.refreshTarget === target) root.refresh()
  }

  function broadcastRefresh() {
    var items = root.bar && typeof root.bar.moduleWidgets === "function"
      ? root.bar.moduleWidgets(root.moduleName) : [root]
    for (var i = 0; i < items.length; i++) {
      if (items[i] && typeof items[i].refreshMatchingTarget === "function") {
        items[i].refreshMatchingTarget(root.refreshTarget)
      }
    }
  }

  function applyOutput(raw) {
    var trimmed = (raw || "").trim()
    if (trimmed === "") {
      root.outText = ""
      root.outTooltip = ""
      root.outClass = ""
      return
    }
    if (root.returnType === "json") {
      try {
        var obj = JSON.parse(trimmed)
        root.outText = obj.text !== undefined && obj.text !== null ? String(obj.text) : ""
        root.outTooltip = obj.tooltip !== undefined && obj.tooltip !== null ? String(obj.tooltip) : ""
        if (obj["class"] !== undefined && obj["class"] !== null) root.outClass = String(obj["class"])
        else if (obj.alt !== undefined && obj.alt !== null) root.outClass = String(obj.alt)
        else root.outClass = ""
        return
      } catch (e) {
        // Not JSON — fall through to plain text.
      }
    }
    root.outText = trimmed
    root.outTooltip = ""
    root.outClass = ""
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
    command: ["bash", "-lc", root.exec]
    stdout: StdioCollector {
      id: outCollector
      waitForEnd: true
    }
    onExited: function (exitCode) {
      root.applyOutput(outCollector.text)
      root.loading = false
    }
  }

  Timer {
    interval: Math.max(1000, root.intervalMs)
    running: root.exec !== ""
    repeat: true
    triggeredOnStart: true
    onTriggered: root.poll()
  }

  Loader {
    active: root.refreshTarget !== ""
    sourceComponent: Component {
      IpcHandler {
        target: root.refreshTarget
        function refresh(): void {
          root.broadcastRefresh()
        }
      }
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
    fontSize: root.stockIconSize ? Style.bar.iconFont * root.iconScale : Style.font.caption
    fixedWidth: root.stockIconSize && !root.vertical ? Style.bar.statusSlot : -1
    fixedHeight: root.stockIconSize && root.vertical ? Style.bar.statusSlot : -1
    horizontalMargin: root.cellMargin
    text: root.loading && root.loadingText !== "" ? root.loadingText : (root.hoverRevealed ? root.revealText : (root.hiddenByClass ? "" : root.outText))
    dimmed: root.hoverRevealed
    tooltipText: root.tooltipEnabled ? root.outTooltip : ""
    foreground: root.loading && root.loadingText !== "" ? root.colorForClass(root.loadingClass) : root.colorForClass(root.outClass)
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
