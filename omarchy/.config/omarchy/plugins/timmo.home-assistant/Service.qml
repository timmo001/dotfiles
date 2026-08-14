import QtQuick
import Quickshell
import Quickshell.Io

Item {
  id: root

  Config { id: config }

  property var shell: null
  property string host: ""
  property var modules: []
  property var moduleStates: []
  property int revision: 0

  readonly property var rows: buildRows(revision)
  readonly property var barConfig: config.bar
  readonly property int attentionCount: countAttention(revision)
  readonly property string aggregateState: calculateAggregateState(revision)
  readonly property bool quiet: aggregateState === "quiet"

  function configure(targetHost) {
    var resolved = String(targetHost || Quickshell.env("OMARCHY_HOST") || "laptop")
    if (resolved === host && modules.length > 0) return
    host = resolved
    modules = config.definitions(resolved)
    var initial = []
    for (var i = 0; i < modules.length; i++)
      initial.push({ text: "", tooltip: "", className: "", available: false })
    moduleStates = initial
    revision++
  }

  function applyOutput(index, raw) {
    var trimmed = String(raw || "").trim()
    if (!trimmed) {
      markUnavailable(index)
      return
    }
    try {
      var payload = JSON.parse(trimmed)
      var text = payload.text === undefined || payload.text === null ? "" : String(payload.text)
      var tooltip = payload.tooltip === undefined || payload.tooltip === null ? "" : String(payload.tooltip)
      var className = payload["class"] === undefined || payload["class"] === null
        ? String(payload.alt || "") : String(payload["class"])
      var module = modules[index]
      var available = text !== "" || tooltip !== "" || className !== "hidden"
        || (module && module.emptyHiddenAvailable === true)
      var stateClasses = className.split(/\s+/).filter(function(value) { return value !== "" })
      if (module && hasConfiguredClass(module.unavailableClasses, stateClasses)) available = false
      setState(index, { text: text, tooltip: tooltip, className: className, available: available })
    } catch (error) {
      markUnavailable(index)
    }
  }

  function setState(index, state) {
    if (index < 0 || index >= moduleStates.length) return
    var next = moduleStates.slice()
    next[index] = state
    moduleStates = next
    revision++
  }

  function markUnavailable(index) {
    setState(index, { text: "", tooltip: "", className: "", available: false })
  }

  function hasConfiguredClass(classes, stateClasses) {
    var configured = classes || []
    for (var i = 0; i < configured.length; i++)
      if (stateClasses.indexOf(configured[i]) !== -1) return true
    return false
  }

  function matchesCondition(condition, stateClasses) {
    if (!condition) return false
    if (condition.classes && hasConfiguredClass(condition.classes, stateClasses)) return true
    if (condition.excludesClasses) {
      for (var i = 0; i < condition.excludesClasses.length; i++)
        if (stateClasses.indexOf(condition.excludesClasses[i]) !== -1) return false
      return true
    }
    return false
  }

  function severity(module, state) {
    if (!state || !state.available) return "unavailable"
    var stateClasses = state.className.split(/\s+/).filter(function(value) { return value !== "" })
    var severityClasses = module.severityClasses || {}
    if (hasConfiguredClass(severityClasses.critical, stateClasses)) return "critical"
    if (hasConfiguredClass(severityClasses.warning, stateClasses)) return "warning"
    if (hasConfiguredClass(severityClasses.active, stateClasses)) return "active"
    return matchesCondition(module.showWhen, stateClasses) ? "active" : "quiet"
  }

  function color(module, rowSeverity) {
    var colors = module.colors || {}
    if (rowSeverity === "unavailable") return config.bar.colors.unavailable
    return colors[rowSeverity] || ""
  }

  function barActive(module, state, rowSeverity) {
    if (!state.available) return false
    if (module.showWhen)
      return ["active", "warning", "critical"].indexOf(rowSeverity) !== -1
    var stateClasses = state.className.split(/\s+/).filter(function(value) { return value !== "" })
    return String(state.text || "").trim() !== ""
      && stateClasses.indexOf("hidden") === -1
      && stateClasses.indexOf("inactive") === -1
  }

  function buildRows(dependency) {
    var result = []
    for (var i = 0; i < modules.length; i++) {
      var module = modules[i]
      if (module.background === true) continue
      var state = moduleStates[i] || { text: "", tooltip: "", className: "", available: false }
      if (module.hideUnavailable === true && !state.available) continue
      var rowSeverity = severity(module, state)
      result.push({
        id: module.id,
        group: module.group,
        subgroup: module.subgroup || "",
        label: module.label,
        icon: module.icon,
        action: module.action,
        opensLink: String(module.action || "").indexOf("launch-floating-webapp ") === 0,
        text: state.text,
        tooltip: state.tooltip,
        className: state.className,
        available: state.available,
        inactiveText: module.inactiveText || "Quiet",
        activeText: module.activeText || "Active",
        barIconOnly: module.barIconOnly === true,
        barOnly: module.barOnly === true,
        panelOnly: module.panelOnly === true,
        control: module.control || "",
        decrementCommand: module.decrementCommand || "",
        incrementCommand: module.incrementCommand || "",
        setValueCommand: module.setValueCommand || "",
        toggleCommand: module.toggleCommand || "",
        presets: module.presets || [],
        severity: rowSeverity,
        barActive: module.panelOnly !== true && barActive(module, state, rowSeverity),
        color: color(module, rowSeverity)
      })
      if (!state.available) continue
      var actions = module.actions || []
      for (var actionIndex = 0; actionIndex < actions.length; actionIndex++) {
        var action = actions[actionIndex]
        result.push({
          id: module.id + ":" + action.id,
          group: module.group,
          subgroup: module.subgroup || "",
          label: action.label,
          icon: action.icon,
          curtainPosition: action.position === undefined ? -1 : Number(action.position),
          action: action.command,
          opensLink: false,
          text: "Run",
          tooltip: action.label,
          className: "",
          available: true,
          inactiveText: "Run",
          activeText: "Run",
          barIconOnly: false,
          barOnly: false,
          panelOnly: true,
          control: "",
          gridAction: module.actionLayout === "grid",
          actionColumns: Number(module.actionColumns || 5),
          severity: "quiet",
          barActive: false,
          color: color(module, "quiet")
        })
      }
    }
    return result
  }

  function countAttention(dependency) {
    var count = 0
    var currentRows = buildRows(dependency)
    for (var i = 0; i < currentRows.length; i++)
      if (!currentRows[i].panelOnly
        && ["active", "warning", "critical"].indexOf(currentRows[i].severity) !== -1) count++
    return count
  }

  function calculateAggregateState(dependency) {
    var currentRows = buildRows(dependency)
    var available = 0
    var hasActive = false
    var hasWarning = false
    var hasCritical = false
    for (var i = 0; i < currentRows.length; i++) {
      if (currentRows[i].panelOnly) continue
      if (currentRows[i].available) available++
      if (currentRows[i].severity === "critical") hasCritical = true
      else if (currentRows[i].severity === "warning") hasWarning = true
      else if (currentRows[i].severity === "active") hasActive = true
    }
    if (available === 0) return "unavailable"
    if (hasCritical) return "critical"
    if (hasWarning) return "warning"
    if (hasActive) return "active"
    return "quiet"
  }

  function refresh() {
    for (var i = 0; i < processInstantiator.count; i++) {
      var runner = processInstantiator.objectAt(i)
      if (runner && typeof runner.poll === "function") runner.poll()
    }
  }

  function activate(rowId) {
    for (var i = 0; i < modules.length; i++) {
      var module = modules[i]
      if (module.id === rowId && module.action) {
        Quickshell.execDetached(["bash", "-lc", module.action])
        return
      }
      var actions = module.actions || []
      for (var actionIndex = 0; actionIndex < actions.length; actionIndex++) {
        var action = actions[actionIndex]
        if (module.id + ":" + action.id !== rowId) continue
        Quickshell.execDetached(["bash", "-lc", action.command])
        return
      }
    }
  }

  function runControl(command) {
    if (!command) return
    Quickshell.execDetached(["bash", "-lc", command])
    refreshTimer.restart()
  }

  function activatePreset(row, preset) {
    if (!row || !preset) return
    runControl(row.setValueCommand + preset.value)
  }

  Instantiator {
    id: processInstantiator
    model: root.modules

    delegate: QtObject {
      id: runner
      required property int index
      required property var modelData

      function poll() {
        if (modelData.stream === true || process.running) return
        process.running = true
      }

      property Process process: Process {
        running: runner.modelData.stream === true
        command: ["bash", "-lc", runner.modelData.command]
        stdout: runner.modelData.stream === true ? streamOutput : pollOutput
        onExited: {
          if (runner.modelData.stream === true) {
            root.markUnavailable(runner.index)
            restartTimer.restart()
          } else {
            root.applyOutput(runner.index, pollOutput.text)
          }
        }
      }

      property StdioCollector pollOutput: StdioCollector {
        waitForEnd: true
      }

      property SplitParser streamOutput: SplitParser {
        onRead: function(line) { root.applyOutput(runner.index, line) }
      }

      property Timer pollTimer: Timer {
        interval: Math.max(1000, Number(runner.modelData.interval || 60000))
        running: runner.modelData.stream !== true
        repeat: true
        triggeredOnStart: true
        onTriggered: runner.poll()
      }

      property Timer restartTimer: Timer {
        interval: 5000
        onTriggered: if (runner.modelData.stream === true && !runner.process.running)
          runner.process.running = true
      }
    }
  }

  Timer {
    id: refreshTimer
    interval: 500
    onTriggered: root.refresh()
  }

  Component.onCompleted: configure(Quickshell.env("OMARCHY_HOST"))
}
