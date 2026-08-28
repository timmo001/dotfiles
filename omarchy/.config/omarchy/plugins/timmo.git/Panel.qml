import QtQuick
import QtQuick.Controls
import qs.Commons
import qs.Ui
import "../../components"

Panel {
  id: root
  moduleName: "timmo.git"

  property var anchorItem: null
  property var hostWidget: null
  property var service: null
  readonly property var barIdentity: hostWidget || root
  readonly property color contentForeground: bar ? bar.foreground : Color.foreground
  readonly property string contentFontFamily: bar ? bar.fontFamily : Style.font.family
  property string view: "overview"
  property var selectedRepo: null
  property string selectedRepoView: "changed"
  readonly property int repoCount: service ? service.repos.length : 0
  readonly property int changedRepoCount: service ? service.changedRepos.length : 0
  readonly property int otherRepoCount: service ? service.otherRepos.length : 0
  readonly property int threadCount: service ? service.threads.length : 0
  readonly property var panelRows: buildPanelRows()
  readonly property var filteredActions: filterRows("action")
  readonly property var filteredRepos: filterRows("repo")
  readonly property var filteredThreads: filterRows("thread")

  function buildPanelRows() {
    var rows = []
    if (view === "overview") {
    } else if (view === "repo") {
      rows.push(actionRow("lazygit", "Open in lazygit", ""))
      rows.push(actionRow("editor", "Open in editor", ""))
      rows.push(actionRow("agent", "Open in agent", "󱚣"))
      rows.push(actionRow("terminal", "Open terminal", ""))
      rows.push(actionRow("web", "Open on GitHub", ""))
      rows.push(actionRow("back", "Back to repositories", ""))
      return rows
    } else if (view === "agent") {
      var agents = service ? service.installedAgents : []
      for (var i = 0; i < agents.length; i++) {
        var agent = agents[i]
        rows.push(actionRow("agent:" + agent.command, agent.label, "󱚣"))
      }
      rows.push(actionRow("back", "Back to repository", ""))
      return rows
    } else {
      rows.push(actionRow("back", "Back to Git overview", ""))
    }
    var repos = service ? ((view === "overview" || view === "changed") ? service.changedRepos : (view === "other" ? service.otherRepos : [])) : []
    for (var j = 0; j < repos.length; j++) {
      var repo = repos[j]
      rows.push({
        key: "repo:" + String(repo.name || j),
        kind: "repo",
        section: "repo",
        value: repo,
        primaryText: repo.name,
        secondaryText: repoDetail(repo)
      })
    }
    if (view === "overview") {
      rows.push(actionRow("other", "Other repositories", "󰙅"))
      rows.push(actionRow("notifications", "Notifications", ""))
    }
    var threads = service && view === "overview" ? service.threads : []
    for (var k = 0; k < threads.length; k++) {
      var thread = threads[k]
      rows.push({
        key: "thread:" + String(thread.webUrl || k),
        kind: "thread",
        section: "thread",
        value: thread,
        primaryText: thread.repo,
        secondaryText: [thread.title, thread.reason, thread.type].join(" ")
      })
    }
    return rows
  }

  function actionRow(action, label, icon) {
    return {
      key: "action:" + action,
      kind: "action",
      section: "action",
      action: action,
      primaryText: label,
      secondaryText: "",
      icon: icon
    }
  }

  function filterRows(kind) {
    return filterController.filteredModel.filter(function(entry) { return entry.kind === kind })
  }

  function open(initialView) {
    view = initialView || "overview"
    selectedRepo = null
    filterController.reset()
    if (service) {
      service.refresh()
      service.refreshPanel()
    }
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
    var entry = filterController.selectedEntry()
    if (!entry) return null
    var rows = entry.kind === "action" ? filteredActions
      : (entry.kind === "repo" ? filteredRepos : filteredThreads)
    var repeater = entry.kind === "action" ? (view === "overview" ? overviewActionRepeater : actionRepeater)
      : (entry.kind === "repo" ? repoRepeater : threadRepeater)
    return repeater.itemAt(rows.indexOf(entry))
  }

  function scrollCursorIntoView() {
    var item = cursorItem()
    if (!item) return
    var point = item.mapToItem(contentColumn, 0, 0)
    if (point.y < panelFlick.contentY) panelFlick.contentY = point.y
    else if (point.y + item.height > panelFlick.contentY + panelFlick.height)
      panelFlick.contentY = point.y + item.height - panelFlick.height
  }

  Timer {
    id: revealTimer
    interval: 0
    onTriggered: root.scrollCursorIntoView()
  }

  function showView(nextView) {
    view = nextView
    filterController.reset()
    panelFlick.contentY = 0
  }

  function showRepoActions(repo) {
    selectedRepoView = view
    selectedRepo = repo
    showView("repo")
  }

  function activateAction(action) {
    if (!service) return
    if (action === "refresh") { service.refresh(); service.refreshPanel() }
    else if (action === "changed" || action === "other") showView(action)
    else if (action === "agent") showView("agent")
    else if (action === "back") showView(view === "agent" ? "repo" : (view === "repo" ? selectedRepoView : "overview"))
    else if (action === "notifications") { close(); service.openNotifications() }
    else if (action.indexOf("agent:") === 0 && selectedRepo) { close(); service.openAgent(selectedRepo, action.slice(6)) }
    else if (selectedRepo) { close(); service.openRepo(selectedRepo, action) }
  }

  function activateThread(thread) {
    if (!service || !thread) return
    close()
    service.openThread(thread)
  }

  function activateEntry(entry) {
    if (entry.kind === "action") activateAction(entry.action)
    else if (entry.kind === "repo") showRepoActions(entry.value)
    else if (entry.kind === "thread") activateThread(entry.value)
  }

  function repoDetail(repo) {
    var values = []
    if (Number(repo.modified || 0) > 0) values.push(repo.modified + " changed")
    if (Number(repo.ahead || 0) > 0) values.push(repo.ahead + " ahead")
    if (Number(repo.behind || 0) > 0) values.push(repo.behind + " behind")
    return values.join(" · ") || "Clean"
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    focusTarget: filterController
    contentWidth: panel.fittedContentWidth(Style.space(450))
    contentHeight: panel.fittedContentHeight(contentColumn.implicitHeight, Style.space(670))

    FilterablePanel {
      id: filterController
      anchors.fill: parent
      model: root.panelRows
      backOnEmptyFilter: true
      onRevealRequested: revealTimer.restart()
      onActivateRequested: function(entry) { root.activateEntry(entry) }
      onBackRequested: if (root.view === "overview") root.close(); else root.activateAction("back")
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }

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
          spacing: Style.space(12)

          PanelHero {
            width: parent.width
            title: root.view === "agent" ? "Open in agent" : (root.view === "repo" && root.selectedRepo ? String(root.selectedRepo.name) : (root.view === "overview" ? "Git" : (root.view === "changed" ? "Changed" : "Other")))
            meta: root.view === "agent" && root.selectedRepo ? String(root.selectedRepo.name) : (root.view === "repo" && root.selectedRepo ? root.repoDetail(root.selectedRepo) : (root.view === "overview" ? root.changedRepoCount + " changed · " + root.threadCount + " notifications" : (root.view === "changed" ? root.changedRepoCount + " repositories" : root.otherRepoCount + " repositories")))
            detail: root.service && root.service.refreshing ? "REFRESHING" : "STATUS"
            foreground: root.contentForeground
            fontFamily: root.contentFontFamily
            iconComponent: Component {
              Text {
                text: ""
                color: root.hostWidget ? root.hostWidget.displayColor : root.contentForeground
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.display
              }
            }
          }

          Text {
            visible: root.view !== "overview"
            text: filterController.filterText || "ACTIONS"
            color: Qt.darker(root.contentForeground, 1.4)
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.caption
            font.bold: true
            font.letterSpacing: 1.2
          }

          Column {
            visible: root.view !== "overview"
            width: parent.width
            spacing: Style.space(2)
            Repeater {
              id: actionRepeater
              model: root.filteredActions
              CursorSurface {
                required property int index
                required property var modelData
                width: contentColumn.width
                implicitHeight: actionRow.implicitHeight + Style.space(12)
                hasCursor: filterController.cursorIndex === filterController.indexForKey(modelData.key)
                foreground: root.contentForeground
                accent: root.contentForeground
                Row {
                  id: actionRow
                  anchors.left: parent.left
                  anchors.right: parent.right
                  anchors.verticalCenter: parent.verticalCenter
                  anchors.leftMargin: Style.space(8)
                  anchors.rightMargin: Style.space(8)
                  spacing: Style.space(10)
                  Text { width: Style.space(22); text: modelData.icon; color: root.contentForeground; font.family: root.contentFontFamily; font.pixelSize: Style.font.icon; horizontalAlignment: Text.AlignHCenter }
                  Text { width: Math.max(0, actionRow.width - Style.space(32)); text: modelData.primaryText; color: root.contentForeground; font.family: root.contentFontFamily; font.pixelSize: Style.font.body; elide: Text.ElideRight }
                }
                MouseArea { anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onEntered: filterController.cursorIndex = filterController.indexForKey(modelData.key); onClicked: root.activateAction(modelData.action) }
              }
            }
          }

          Text {
            visible: root.filteredRepos.length > 0
            text: (root.view === "overview" ? "CHANGED REPOSITORIES" : "REPOSITORIES") + " · " + (filterController.filterText ? root.filteredRepos.length + " MATCHING" : (root.view === "other" ? root.otherRepoCount : root.changedRepoCount))
            color: Qt.darker(root.contentForeground, 1.4)
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.caption
            font.bold: true
            font.letterSpacing: 1.2
          }

          Column {
            width: parent.width
            spacing: Style.space(2)
            Repeater {
              id: repoRepeater
              model: root.filteredRepos
              CursorSurface {
                required property int index
                required property var modelData
                width: contentColumn.width
                implicitHeight: repoColumn.implicitHeight + Style.space(12)
                hasCursor: filterController.cursorIndex === filterController.indexForKey(modelData.key)
                foreground: root.contentForeground
                accent: root.hostWidget ? root.hostWidget.displayColor : root.contentForeground
                Column {
                  id: repoColumn
                  anchors.left: parent.left
                  anchors.right: parent.right
                  anchors.verticalCenter: parent.verticalCenter
                  anchors.leftMargin: Style.space(8)
                  anchors.rightMargin: Style.space(8)
                  spacing: Style.space(2)
                  Text { width: parent.width; text: (modelData.value.locked === true ? "󰌾 " : "") + String(modelData.value.name || ""); color: root.contentForeground; font.family: root.contentFontFamily; font.pixelSize: Style.font.body; elide: Text.ElideRight }
                  Text { width: parent.width; text: root.repoDetail(modelData.value); color: Qt.darker(root.contentForeground, 1.4); font.family: root.contentFontFamily; font.pixelSize: Style.font.caption; elide: Text.ElideRight }
                }
                 MouseArea { anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onEntered: filterController.cursorIndex = filterController.indexForKey(modelData.key); onClicked: root.showRepoActions(modelData.value) }
              }
            }
          }

          Text {
            visible: !filterController.filterText && (root.view === "overview" || root.view === "changed" || root.view === "other") && root.filteredRepos.length === 0
            width: parent.width
            text: root.service && root.service.panelError !== "" ? root.service.panelError : (root.service && !root.service.panelLoaded ? "Loading repositories" : (root.view === "other" ? "No Other repositories" : "All tracked repositories are clean"))
            color: Qt.darker(root.contentForeground, 1.4)
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.body
            horizontalAlignment: Text.AlignHCenter
          }

          Column {
            visible: root.view === "overview"
            width: parent.width
            spacing: Style.space(2)
            Repeater {
              id: overviewActionRepeater
              model: root.filteredActions
              Column {
                required property int index
                required property var modelData
                width: contentColumn.width
                spacing: Style.space(8)

                Rectangle {
                  width: parent.width
                  height: 1
                  color: Qt.rgba(root.contentForeground.r, root.contentForeground.g, root.contentForeground.b, 0.18)
                }

                CursorSurface {
                  width: parent.width
                  implicitHeight: overviewActionRow.implicitHeight + Style.space(12)
                  hasCursor: filterController.cursorIndex === filterController.indexForKey(modelData.key)
                  foreground: root.contentForeground
                  accent: root.contentForeground
                  Row {
                    id: overviewActionRow
                    anchors.left: parent.left
                    anchors.right: parent.right
                    anchors.verticalCenter: parent.verticalCenter
                    anchors.leftMargin: Style.space(8)
                    anchors.rightMargin: Style.space(8)
                    spacing: Style.space(10)
                    Text { width: Style.space(22); text: modelData.icon; color: root.contentForeground; font.family: root.contentFontFamily; font.pixelSize: Style.font.icon; horizontalAlignment: Text.AlignHCenter }
                    Text { width: Math.max(0, overviewActionRow.width - Style.space(32)); text: modelData.primaryText; color: root.contentForeground; font.family: root.contentFontFamily; font.pixelSize: Style.font.body; elide: Text.ElideRight }
                  }
                  MouseArea { anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onEntered: filterController.cursorIndex = filterController.indexForKey(modelData.key); onClicked: root.activateAction(modelData.action) }
                }
              }
            }
          }

          Rectangle {
            visible: root.view === "overview"
            width: parent.width
            height: 1
            color: Qt.rgba(root.contentForeground.r, root.contentForeground.g, root.contentForeground.b, 0.18)
          }

          Column {
            width: parent.width
            spacing: Style.space(2)
            Repeater {
              id: threadRepeater
              model: root.filteredThreads
              CursorSurface {
                required property int index
                required property var modelData
                width: contentColumn.width
                implicitHeight: threadColumn.implicitHeight + Style.space(12)
                hasCursor: filterController.cursorIndex === filterController.indexForKey(modelData.key)
                foreground: root.contentForeground
                accent: modelData.value.important === true && root.bar ? root.bar.urgent : root.contentForeground
                Column {
                  id: threadColumn
                  anchors.left: parent.left
                  anchors.right: parent.right
                  anchors.verticalCenter: parent.verticalCenter
                  anchors.leftMargin: Style.space(8)
                  anchors.rightMargin: Style.space(8)
                  spacing: Style.space(2)
                  Text { width: parent.width; text: String(modelData.value.repo || ""); color: root.contentForeground; font.family: root.contentFontFamily; font.pixelSize: Style.font.body; font.bold: modelData.value.unread === true; elide: Text.ElideRight }
                  Text { width: parent.width; text: String(modelData.value.title || ""); color: Qt.darker(root.contentForeground, 1.25); font.family: root.contentFontFamily; font.pixelSize: Style.font.caption; elide: Text.ElideRight }
                  Text { width: parent.width; text: String(modelData.value.reason || "") + " · " + String(modelData.value.type || ""); color: Qt.darker(root.contentForeground, 1.5); font.family: root.contentFontFamily; font.pixelSize: Style.font.caption; elide: Text.ElideRight }
                }
                MouseArea { anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onEntered: filterController.cursorIndex = filterController.indexForKey(modelData.key); onClicked: root.activateThread(modelData.value) }
              }
            }
          }

          Text {
            visible: root.view === "overview" && !filterController.filterText && root.threadCount === 0
            width: parent.width
            text: root.service && root.service.notificationsError !== "" ? root.service.notificationsError : (root.service && !root.service.notificationsLoaded ? "Loading notifications" : "GitHub inbox clear")
            color: Qt.darker(root.contentForeground, 1.4)
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.body
            horizontalAlignment: Text.AlignHCenter
          }

          Text {
            visible: filterController.filterText && filterController.count === 0
            width: parent.width
            text: "No matches for “" + filterController.filterText + "”"
            color: Qt.darker(root.contentForeground, 1.4)
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.body
            horizontalAlignment: Text.AlignHCenter
          }
        }
      }
    }
  }
}
