import QtQuick
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui

BarWidget {
  id: root
  moduleName: "timmo.git"

  readonly property bool primaryOnly: setting("primaryOnly", false)
  readonly property string preferredOutput: setting("primaryOutput", "")
  readonly property string currentOutput: {
    var window = root.QsWindow ? root.QsWindow.window : null
    return window && window.screen ? String(window.screen.name || "") : ""
  }
  readonly property string activeOutput: {
    var screens = Quickshell.screens
    for (var i = 0; i < screens.length; i++)
      if (root.preferredOutput !== "" && screens[i].name === root.preferredOutput)
        return root.preferredOutput
    return screens.length > 0 ? String(screens[0].name || "") : ""
  }
  readonly property bool activeInstance: !primaryOnly
    || (currentOutput !== "" && currentOutput === activeOutput)
  readonly property var git: bar?.shell?.serviceFor("timmo.git")
  readonly property bool opened: panelLoader.item ? panelLoader.item.opened === true : false
  readonly property bool popoutSwitchClosing: panelLoader.item ? panelLoader.item.popoutSwitchClosing === true : false
  readonly property real openPanelIndicatorWidth: content.implicitWidth
  // Counts cover only the attached Herdr workspace's repository; other repositories
  // surface only when they need a pull, need you or have CI or security problems.
  readonly property string activePath: git && git.herdrContext && git.herdrContext.repository
    ? git.herdrContext.repository.path : ""
  readonly property var displaySegments: {
    var idle = [{ text: "\uF418", color: "#5c6370" }]
    if (!git || activePath === "") return idle
    var segments = []
    function add(text, count, color) { if (count > 0) segments.push({ text: text + count, color: color }) }

    var active = git.activeStatus && git.activeStatus.path === root.activePath ? git.activeStatus
      : git.repos.find(function(repo) { return repo.path === root.activePath })
    var modified = active ? active.modified : 0
    segments.push(modified > 0 ? { text: "\uF418 " + modified, color: "#56b6c2" } : idle[0])
    if (active) {
      add("\u2191", active.ahead, "#c678dd")
      add("\u2193", active.behind, "#61afef")
    }
    var pullRepo = git.pullRequestRepositories.find(function(entry) { return entry.path === root.activePath })
    add("\uF407 ", pullRepo ? pullRepo.pulls.length : 0, "#abb2bf")

    var notificationRepo = git.notificationRepositories.find(function(entry) { return entry.path === root.activePath })
    var kinds = notificationRepo && notificationRepo.kinds ? notificationRepo.kinds : {}
    add("\uF0F3 ", kinds["needs-you"] || 0, "#98c379")
    add("\uF071 ", kinds.alert || 0, "#d19a66")
    add("\uF27A ", kinds.people || 0, "#abb2bf")
    add("\uDB81\uDEA9 ", kinds.quiet || 0, "#7f848e")

    var activeSlugs = (notificationRepo && notificationRepo.slugs ? notificationRepo.slugs : [])
      .map(function(slug) { return String(slug).toLowerCase() })
    var elsewhere = git.threads.filter(function(thread) {
      return thread.unread && activeSlugs.indexOf(String(thread.repo).toLowerCase()) < 0
    })
    add("\u2193 ", git.repos.filter(function(repo) { return repo.path !== root.activePath && repo.behind > 0 }).length, "#61afef")
    add("\uF0F3 ", elsewhere.filter(function(thread) { return thread.kind === "needs-you" }).length, "#98c379")
    add("\uF071 ", elsewhere.filter(function(thread) { return thread.kind === "alert" }).length, "#d19a66")
    return segments
  }
  readonly property string tooltipText: git
    ? [git.diffTooltip || git.diffError, git.notificationTooltip || git.notificationsError, git.pullRequestTooltip].filter(function(value) { return value !== "" }).join("\n")
    : "Git status unavailable"

  function activeWidget() {
    if (root.activeInstance) return root
    var items = root.bar && typeof root.bar.moduleWidgets === "function"
      ? root.bar.moduleWidgets(root.moduleName) : []
    for (var i = 0; i < items.length; i++)
      if (items[i] && items[i].activeInstance === true) return items[i]
    return null
  }

  function open(payloadJson) {
    var widget = activeWidget()
    if (widget && widget !== root) { widget.open(payloadJson); return }
    if (panelLoader.item) panelLoader.item.open(payloadJson)
  }

  function openOther() {
    var widget = activeWidget()
    if (widget && widget !== root) { widget.openOther(); return }
    if (panelLoader.item) panelLoader.item.open("other")
  }

  function close() {
    var widget = activeWidget()
    if (widget && widget !== root) { widget.close(); return }
    if (panelLoader.item) panelLoader.item.close()
  }

  function togglePanel() {
    var widget = activeWidget()
    if (widget && widget !== root) { widget.togglePanel(); return }
    if (panelLoader.item) panelLoader.item.toggle()
  }

  function closeForPopoutSwitch() {
    var widget = activeWidget()
    if (widget && widget !== root) { widget.closeForPopoutSwitch(); return }
    if (panelLoader.item) panelLoader.item.closeForPopoutSwitch()
  }

  function injectPanel() {
    var panel = panelLoader.item
    if (!panel) return
    panel.bar = root.bar
    panel.settings = root.settings
    panel.anchorItem = button
    panel.hostWidget = root
    panel.service = root.git
  }

  visible: activeInstance
  implicitWidth: activeInstance ? button.implicitWidth : 0
  implicitHeight: button.implicitHeight

  onBarChanged: injectPanel()
  onSettingsChanged: injectPanel()
  onGitChanged: injectPanel()

  Loader {
    id: panelLoader
    active: root.activeInstance
    source: Qt.resolvedUrl("Panel.qml")
    visible: false
    onLoaded: { root.injectPanel(); Qt.callLater(root.injectPanel) }
  }

  Loader {
    active: root.activeInstance && root.currentOutput !== "" && root.currentOutput === root.activeOutput
    sourceComponent: Component {
      IpcHandler {
        target: "timmo.git"
        function refresh(): void { if (root.git) root.git.refresh() }
        function open(): void { root.open() }
        function release(repo: string): void { root.open(JSON.stringify({ view: "releases", repo: repo })) }
        function pulls(repo: string): void { root.open(JSON.stringify({ view: "pulls", repo: repo })) }
        function pullsStatus(): string {
          var panel = panelLoader.item
          return JSON.stringify({
            opened: root.opened, view: panel ? panel.view : "", repo: panel ? panel.selectedPullRequestRepo : "",
            rows: panel ? panel.panelRows.filter(function(row) { return row.section === "pulls" || row.section === "pulls-empty" }).map(function(row) { return { key: row.key, kind: row.kind, title: row.primaryText } }) : [],
            cursor: panel ? panel.cursorKey : "", loaded: root.git ? root.git.pullRequestsLoaded : false,
            busy: root.git ? root.git.pullRequestsBusy : false, error: root.git ? root.git.pullRequestsError : "Service unavailable",
            count: root.git ? root.git.pullRequestCount : 0, readyCount: root.git ? root.git.readyPullRequestCount : 0
          })
        }
        function releaseStatus(): string {
          var panel = panelLoader.item
          return JSON.stringify({
            opened: root.opened, view: panel ? panel.view : "", repo: panel && panel.selectedRelease ? panel.selectedRelease.repo : "",
            finding: panel ? panel.selectedFindingId : "", rows: panel ? panel.panelRows.length : 0,
            cursor: panel ? panel.cursorKey : "", geometry: panel ? panel.releaseGeometry : null,
            loaded: root.git ? root.git.releasesLoaded : false, busy: root.git ? root.git.releaseBusy : false,
            error: root.git ? root.git.releasesError : "Service unavailable",
            pending: root.git ? root.git.releasePendingCount : 0, stale: root.git ? root.git.releaseStale : false,
            summary: panel && panel.releaseView ? panel.releaseSummary() : ""
          })
        }
        function other(): void { root.openOther() }
        function close(): void { root.close() }
        function show(): void { root.open() }
        function hide(): void { root.close() }
        function toggle(): void { root.togglePanel() }
      }
    }
  }

  WidgetButton {
    id: button
    anchors.fill: parent
    bar: root.bar
    fontSize: 10
    labelVisible: false
    hasVisualContent: true
    fixedWidth: vertical ? -1 : Math.max(12, content.implicitWidth + scaledHorizontalMargin * 2)
    tooltipText: root.tooltipText
    horizontalMargin: 6
    onPressed: function(buttonCode) {
      if (buttonCode === Qt.RightButton) { if (root.git) root.git.refresh() }
      else root.togglePanel()
    }

    Row {
      id: content
      anchors.centerIn: parent
      Repeater {
        model: root.displaySegments
        Text {
          required property var modelData
          required property int index
          text: (index > 0 ? "  " : "") + modelData.text
          color: modelData.color
          font.family: button.fontFamily
          font.pixelSize: button.fontSize
          renderType: Text.NativeRendering
        }
      }
    }
  }
}
