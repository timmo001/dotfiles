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
  property string selectedReleaseKey: ""
  property string selectedFindingId: ""
  property string releaseCursorKey: ""
  readonly property var selectedRelease: service ? service.releases.find(function(entry) {
    return entry.repo.toLowerCase() === selectedReleaseKey.toLowerCase() || entry.name.toLowerCase() === selectedReleaseKey.toLowerCase()
  }) || null : null
  readonly property var releaseSnapshot: selectedRelease ? selectedRelease.snapshot : null
  readonly property var selectedFinding: releaseSnapshot ? releaseSnapshot.findings.find(function(finding) { return finding.id === selectedFindingId }) || null : null
  readonly property bool releaseView: ["releases", "release", "release-choice", "finding", "release-commits", "release-files"].indexOf(view) >= 0
  readonly property var filteredReleaseRows: filterController.filteredModel.filter(function(entry) { return ["release", "finding", "commit", "file"].indexOf(entry.kind) >= 0 })
  readonly property var releaseGeometry: ({ x: panel.cardOrigin.x, y: panel.cardOrigin.y, width: panel.contentWidth, height: panel.contentHeight, screen: panel.screen ? panel.screen.name : "" })
  readonly property string cursorKey: filterController.selectedEntry() ? filterController.selectedEntry().key : ""
  readonly property bool selectedRepoCanPull: selectedRepo !== null
    && Number(selectedRepo.behind || 0) > 0
    && Number(selectedRepo.modified || 0) === 0
    && Number(selectedRepo.ahead || 0) === 0
  readonly property int repoCount: service ? service.repos.length : 0
  readonly property int changedRepoCount: service ? service.changedRepos.length : 0
  readonly property int otherRepoCount: service ? service.otherRepos.length : 0
  readonly property int threadCount: service ? service.threads.length : 0
  readonly property int allThreadCount: service ? service.notificationAllCount : 0
  readonly property int otherThreadCount: Math.max(0, allThreadCount - threadCount)
  readonly property string notificationCountText: threadCount + (threadCount === 1 ? " notification" : " notifications") + " (" + otherThreadCount + (otherThreadCount === 1 ? " other)" : " others)")
  readonly property var panelRows: buildPanelRows()
  readonly property var filteredActions: filterRows("action")
  readonly property var filteredRepos: filterRows("repo")
  readonly property var filteredThreads: filterRows("thread")
  readonly property var filteredFooterActions: filterRows("footer-action")

  function buildPanelRows() {
    var rows = []
    if (releaseView) {
      rows.push(actionRow("back", view === "releases" ? "Back to Git overview" : (view === "release" ? "Back to unreleased changes" : "Back to release review"), ""))
      rows.push(actionRow("release-refresh", "Refresh release comparisons", "󰑐"))
      if (view === "releases") {
        var releases = service ? service.releases : []
        for (var r = 0; r < releases.length; r++)
          rows.push(releaseRow("release", releases[r].repo, releases[r], releases[r].name, releaseDetail(releases[r])))
      } else if (selectedRelease) {
        if (view === "release") {
          rows.push(actionRow("release-repo", "Open repository…", ""))
          rows.push(actionRow("release-policy", "Edit policy", ""))
          if (releaseSnapshot) {
            rows.push(actionRow("release-choice", "Overall impact: " + releaseSnapshot.suggestion + (releaseSnapshot.reviewed ? " (reviewed)" : " (auto)"), "󰓹"))
            rows.push(actionRow("release-evidence", "Open full comparison", ""))
            rows.push(actionRow("release-commits", "All commits · " + releaseSnapshot.commits.length, ""))
            rows.push(actionRow("release-files", "Changed files · " + releaseFiles().length, ""))
            var findings = releaseSnapshot.findings.slice().sort(function(a, b) { return Number(a.impact === "none") - Number(b.impact === "none") })
            for (var f = 0; f < findings.length; f++) {
              var finding = findings[f]
              rows.push(releaseRow("finding", finding.id, finding, "[" + (finding.impact === "none" ? "quiet" : finding.impact) + "] " + finding.detail, finding.reason + (finding.reviewed ? " · local review" : "")))
            }
          }
        } else if (view === "release-choice" || view === "finding") {
          if (view === "finding" && selectedFinding && findingUrl(selectedFinding)) rows.push(actionRow("release-evidence", "Open full evidence", ""))
          if (releaseSnapshot && (view === "release-choice" || selectedFinding) && !selectedRelease.stale && releaseSnapshot.complete) {
            var impacts = ["none", "patch", "minor", "major", "auto"]
            for (var p = 0; p < impacts.length; p++) rows.push(actionRow("impact:" + impacts[p], impacts[p] === "auto" ? "Auto · reset local choice" : "Choose " + impacts[p], "󰓹"))
          }
        } else if (releaseSnapshot && view === "release-commits") {
          for (var c = 0; c < releaseSnapshot.commits.length; c++) {
            var commit = releaseSnapshot.commits[c]
            rows.push(releaseRow("commit", (commit.submodule || "") + commit.id, commit, commit.subject, commit.id.slice(0, 12) + " · " + commit.date + (commit.submodule ? " · " + commit.submodule : "")))
          }
        } else if (releaseSnapshot && view === "release-files") {
          var files = releaseFiles()
          for (var d = 0; d < files.length; d++) rows.push(releaseRow("file", files[d].id, files[d], files[d].path, files[d].changeType + (files[d].previousPath ? " · from " + files[d].previousPath : "")))
        }
      }
      return rows
    }
    if (view === "overview") {
    } else if (view === "repo") {
      if (selectedRepoCanPull) rows.push(actionRow("pull", "Pull", "󰜷"))
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
    var repos = []
    if (service) {
      if (view === "overview")
        repos = filterController.filterText ? service.changedRepos.concat(service.otherRepos) : service.changedRepos
      else if (view === "changed") repos = service.changedRepos
      else if (view === "other") repos = service.otherRepos
    }
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
      rows.push(actionRow("releases", "Unreleased changes" + (service && service.releasePendingCount ? " · " + service.releasePendingCount + " release candidates" : ""), "󰓹"))
    }
    var threads = service && (view === "overview" || view === "notifications") ? service.threads : []
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
    if (view === "overview" || view === "notifications")
      rows.push(footerActionRow(
        "notifications",
        "GitHub notifications",
        notificationCountText,
        ""
      ))
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

  function releaseRow(kind, key, value, title, detail) {
    return { key: kind + ":" + key, kind: kind, section: "release", value: value, primaryText: title, secondaryText: detail }
  }

  function releaseDetail(entry) {
    return (entry.snapshot ? entry.snapshot.releaseTag + " → " + entry.branch + " · " + entry.snapshot.suggestion : entry.branch + " · not checked")
      + (entry.stale ? " · stale" : "") + (entry.needsAttention ? " · release candidate" : "")
      + (entry.pending ? " · notification pending" : "")
  }

  function releaseFiles() {
    if (!releaseSnapshot) return []
    var files = releaseSnapshot.files || releaseSnapshot.findings
    var seen = {}
    return files.filter(function(file) {
      var key = (file.submodule || "") + ":" + file.path
      if (seen[key]) return false
      seen[key] = true
      return true
    })
  }

  function findingUrl(finding) {
    if (!finding || !releaseSnapshot) return ""
    return finding.evidenceUrl || (finding.submodule ? "" : releaseSnapshot.url)
  }

  function releaseSummary() {
    if (view === "releases") return service && !service.releasesLoaded ? "Loading release comparisons" : "All watched repositories, including quiet changes"
    if (!selectedRelease) return service && !service.releasesLoaded ? "Loading selected repository" : "Repository unavailable; return to unreleased changes or refresh"
    var lines = [releaseDetail(selectedRelease)]
    if (selectedRelease.error) lines.push(selectedRelease.error)
    if (selectedRelease.deliveryError) lines.push(selectedRelease.deliveryError)
    if (view === "finding") {
      if (!selectedFinding) lines.push("This evidence changed; return to the release review and select again")
      else {
        lines.push(selectedFinding.detail, selectedFinding.reason, "Impact: " + selectedFinding.impact + " · automatic: " + selectedFinding.automaticImpact)
        lines.push(selectedFinding.changeType + " · " + selectedFinding.path)
        if (selectedFinding.previousPath) lines.push("From path: " + selectedFinding.previousPath)
        if (selectedFinding.role) lines.push("Dependency role: " + selectedFinding.role)
        lines.push("Before: " + String(selectedFinding.before || "absent"), "After: " + String(selectedFinding.after || "absent"))
        if (!findingUrl(selectedFinding)) lines.push("Upstream link unavailable in this cached snapshot; refresh to collect it")
      }
    } else if (releaseSnapshot) {
      lines.push("Suggested impact: " + releaseSnapshot.suggestion + (releaseSnapshot.reviewed ? " · local overall choice" : " · automatic"))
      var reasons = []
      releaseSnapshot.findings.forEach(function(finding) { if (finding.impact !== "none" && reasons.indexOf(finding.reason) < 0) reasons.push(finding.reason) })
      lines.push(reasons.length ? reasons.join("\n") : "No release-relevant changes")
      lines.push("Checked: " + releaseSnapshot.checkedAt)
    }
    return lines.join("\n")
  }

  function footerActionRow(action, label, secondaryText, icon) {
    var row = actionRow(action, label, icon)
    row.kind = "footer-action"
    row.section = "footer"
    row.secondaryText = secondaryText
    return row
  }

  function filterRows(kind) {
    return filterController.filteredModel.filter(function(entry) { return entry.kind === kind })
  }

  function open(payloadJson) {
    var initialView = "overview"
    selectedReleaseKey = ""
    selectedFindingId = ""
    try {
      var payload = JSON.parse(String(payloadJson || "{}"))
      if (payload.view === "notifications") initialView = payload.view
      if (payload.view === "releases") {
        selectedReleaseKey = String(payload.repo || "")
        initialView = selectedReleaseKey ? "release" : "releases"
      }
    } catch (error) {
    }
    view = initialView
    selectedRepo = null
    if (releaseView && service) service.refreshReleases("read")
    filterController.reset()
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
    if (["release", "finding", "commit", "file"].indexOf(entry.kind) >= 0)
      return releaseRepeater.itemAt(filteredReleaseRows.indexOf(entry))
    var rows = entry.kind === "action" ? filteredActions
      : (entry.kind === "repo" ? filteredRepos
        : (entry.kind === "thread" ? filteredThreads : filteredFooterActions))
    var repeater = entry.kind === "action" ? (view === "overview" ? overviewActionRepeater : actionRepeater)
      : (entry.kind === "repo" ? repoRepeater
        : (entry.kind === "thread" ? threadRepeater : footerActionRepeater))
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

  function syncSelectedRepo() {
    if (!selectedRepo || !service) return
    var path = String(selectedRepo.path || "")
    var repo = service.changedRepos.concat(service.otherRepos).find(function(value) {
      return String(value.path || "") === path
    })
    if (repo) selectedRepo = repo
  }

  function activateAction(action, modifiers) {
    if (!service) return
    if (action === "release-refresh") { service.releaseActionError = ""; service.refreshReleases("refresh") }
    else if (action === "releases") showView("releases")
    else if (action === "release-repo" && selectedRelease) showRepoActions(selectedRelease)
    else if (action === "release-policy") { close(); service.editReleasePolicy(selectedRelease) }
    else if (["release-choice", "release-commits", "release-files"].indexOf(action) >= 0) showView(action)
    else if (action === "release-evidence") service.openEvidence(view === "finding" ? findingUrl(selectedFinding) : (releaseSnapshot ? releaseSnapshot.url : ""))
    else if (action.indexOf("impact:") === 0) service.releaseAction(selectedRelease, view === "finding" ? selectedFindingId : "overall", action.slice(7))
    else if (action === "back" && releaseView) showView(view === "releases" ? "overview" : (view === "release" ? "releases" : "release"))
    else if (action === "refresh") service.refresh()
    else if (action === "changed" || action === "other") showView(action)
    else if (action === "agent") showView("agent")
    else if (action === "back") showView(view === "agent" ? "repo" : (view === "repo" ? selectedRepoView : "overview"))
    else if (action === "notifications") { close(); service.openNotifications() }
    else if (action.indexOf("agent:") === 0 && selectedRepo) { close(); service.openAgent(selectedRepo, action.slice(6)) }
    else if (selectedRepo) {
      if (action === "pull") {
        service.openRepo(selectedRepo, action)
        return
      }
      close()
      if (action === "lazygit") {
        if (modifiers & Qt.ShiftModifier) service.openRepo(selectedRepo, "lazygit-floating")
        else if (modifiers & Qt.ControlModifier) service.openRepo(selectedRepo, "lazygit-tab")
        else service.openRepo(selectedRepo, "lazygit-pane")
      } else service.openRepo(selectedRepo, action)
    }
  }

  function activateThread(thread) {
    if (!service || !thread) return
    close()
    service.openThread(thread)
  }

  function activateEntry(entry, modifiers) {
    if (entry.kind === "action" || entry.kind === "footer-action") activateAction(entry.action, modifiers)
    else if (entry.kind === "repo") showRepoActions(entry.value)
    else if (entry.kind === "thread") activateThread(entry.value)
    else if (entry.kind === "release") { selectedReleaseKey = entry.value.repo; showView("release") }
    else if (entry.kind === "finding") { selectedFindingId = entry.value.id; showView("finding") }
    else if (entry.kind === "file") service.openEvidence(findingUrl(entry.value))
    else if (entry.kind === "commit") service.openEvidence(entry.value.url || (entry.value.submodule ? "" : "https://github.com/" + selectedRelease.repo + "/commit/" + entry.value.id))
  }

  function repoDetail(repo) {
    var values = []
    if (Number(repo.modified || 0) > 0) values.push(repo.modified + " changed")
    if (Number(repo.ahead || 0) > 0) values.push(repo.ahead + " ahead")
    if (Number(repo.behind || 0) > 0) values.push(repo.behind + " behind")
    return values.join(" · ") || "Clean"
  }

  Shortcut {
    sequence: "Ctrl+P"
    context: Qt.ApplicationShortcut
    enabled: root.opened && root.view === "repo" && root.selectedRepoCanPull
    onActivated: root.activateAction("pull", Qt.NoModifier)
  }

  Connections {
    target: root.service
    function onPanelUpdated() { root.syncSelectedRepo() }
    function onReleasesUpdating() {
      var entry = filterController.selectedEntry()
      root.releaseCursorKey = entry ? entry.key : ""
    }
    function onReleasesUpdated() {
      Qt.callLater(function() {
        var index = filterController.indexForKey(root.releaseCursorKey)
        if (index >= 0) filterController.cursorIndex = index
      })
    }
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
      onActivateRequested: function(entry, modifiers) { root.activateEntry(entry, modifiers) }
      onBackRequested: if (root.view === "overview") root.close(); else root.activateAction("back")
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onRefreshRequested: if (root.releaseView) root.activateAction("release-refresh"); else root.service.refresh()

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
            title: root.releaseView ? (root.view === "releases" ? "Unreleased changes" : (root.selectedRelease ? root.selectedRelease.name : "Release review")) : (root.view === "agent" ? "Open in agent" : (root.view === "repo" && root.selectedRepo ? String(root.selectedRepo.name) : (root.view === "overview" ? "Git" : (root.view === "changed" ? "Changed" : (root.view === "notifications" ? "Notifications" : "Other")))))
            meta: root.releaseView ? (root.view === "finding" ? "Finding evidence" : (root.view === "release-commits" ? "All commits" : (root.view === "release-files" ? "Changed files" : "Local release review"))) : (root.view === "agent" && root.selectedRepo ? String(root.selectedRepo.name) : (root.view === "repo" && root.selectedRepo ? root.repoDetail(root.selectedRepo) : (root.view === "overview" ? root.changedRepoCount + " changed · " + root.notificationCountText : (root.view === "changed" ? root.changedRepoCount + " repositories" : (root.view === "notifications" ? root.notificationCountText : root.otherRepoCount + " repositories")))))
            detail: root.service && root.service.pulling ? "PULLING" : (root.service && root.service.refreshing ? "REFRESHING" : "STATUS")
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
            visible: root.releaseView
            width: parent.width
            text: root.releaseSummary() + (root.service && root.service.releasesError ? "\n" + root.service.releasesError : "") + (root.service && root.service.releaseActionError ? "\n" + root.service.releaseActionError : "")
            textFormat: Text.PlainText
            wrapMode: Text.WrapAnywhere
            color: root.contentForeground
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.caption
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
                x: Style.space(8)
                width: Math.max(0, contentColumn.width - Style.space(16))
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

          Column {
            width: parent.width
            spacing: Style.space(2)
            Repeater {
              id: releaseRepeater
              model: root.filteredReleaseRows
              CursorSurface {
                required property var modelData
                x: Style.space(8)
                width: Math.max(0, contentColumn.width - Style.space(16))
                implicitHeight: releaseColumn.implicitHeight + Style.space(12)
                hasCursor: filterController.cursorIndex === filterController.indexForKey(modelData.key)
                foreground: root.contentForeground
                accent: root.contentForeground
                Column {
                  id: releaseColumn
                  anchors.left: parent.left
                  anchors.right: parent.right
                  anchors.verticalCenter: parent.verticalCenter
                  anchors.margins: Style.space(8)
                  spacing: Style.space(2)
                  Text { width: parent.width; text: modelData.primaryText; textFormat: Text.PlainText; wrapMode: Text.WrapAnywhere; color: root.contentForeground; font.family: root.contentFontFamily; font.pixelSize: Style.font.body }
                  Text { width: parent.width; text: modelData.secondaryText; textFormat: Text.PlainText; wrapMode: Text.WrapAnywhere; color: Qt.darker(root.contentForeground, 1.4); font.family: root.contentFontFamily; font.pixelSize: Style.font.caption }
                }
                MouseArea { anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onEntered: filterController.cursorIndex = filterController.indexForKey(modelData.key); onClicked: root.activateEntry(modelData, Qt.NoModifier) }
              }
            }
          }

          Text {
            visible: root.filteredRepos.length > 0
            text: (root.view === "overview" && !filterController.filterText ? "CHANGED REPOSITORIES" : "REPOSITORIES") + " · " + (filterController.filterText ? root.filteredRepos.length + " MATCHING" : (root.view === "other" ? root.otherRepoCount : root.changedRepoCount))
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
                x: Style.space(8)
                width: Math.max(0, contentColumn.width - Style.space(16))
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
            visible: root.view === "overview" || root.view === "notifications"
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
                  anchors.left: parent.left
                  anchors.right: parent.right
                  anchors.leftMargin: Style.space(8)
                  anchors.rightMargin: Style.space(8)
                  height: 1
                  color: Qt.rgba(root.contentForeground.r, root.contentForeground.g, root.contentForeground.b, 0.18)
                }

                CursorSurface {
                  x: Style.space(8)
                  width: Math.max(0, contentColumn.width - Style.space(16))
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
                x: Style.space(8)
                width: Math.max(0, contentColumn.width - Style.space(16))
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
            visible: (root.view === "overview" || root.view === "notifications") && !filterController.filterText && root.threadCount === 0
            width: parent.width
            text: root.service && root.service.notificationsError !== "" ? root.service.notificationsError : (root.service && !root.service.notificationsLoaded ? "Loading notifications" : "GitHub inbox clear")
            color: Qt.darker(root.contentForeground, 1.4)
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.body
            horizontalAlignment: Text.AlignHCenter
          }

          Column {
            visible: (root.view === "overview" || root.view === "notifications") && root.filteredFooterActions.length > 0
            width: parent.width
            spacing: Style.space(8)

            Rectangle {
              anchors.left: parent.left
              anchors.right: parent.right
              anchors.leftMargin: Style.space(8)
              anchors.rightMargin: Style.space(8)
              height: 1
              color: Qt.rgba(root.contentForeground.r, root.contentForeground.g, root.contentForeground.b, 0.18)
            }

            Repeater {
              id: footerActionRepeater
              model: root.filteredFooterActions
              CursorSurface {
                required property int index
                required property var modelData
                x: Style.space(8)
                width: Math.max(0, contentColumn.width - Style.space(16))
                implicitHeight: footerActionRow.implicitHeight + Style.space(12)
                hasCursor: filterController.cursorIndex === filterController.indexForKey(modelData.key)
                foreground: root.contentForeground
                accent: root.contentForeground
                Row {
                  id: footerActionRow
                  anchors.left: parent.left
                  anchors.right: parent.right
                  anchors.verticalCenter: parent.verticalCenter
                  anchors.leftMargin: Style.space(8)
                  anchors.rightMargin: Style.space(8)
                  spacing: Style.space(10)
                  Text { width: Style.space(22); text: modelData.icon; color: root.contentForeground; font.family: root.contentFontFamily; font.pixelSize: Style.font.icon; horizontalAlignment: Text.AlignHCenter }
                  Column {
                    width: Math.max(0, footerActionRow.width - Style.space(32))
                    spacing: Style.space(2)
                    Text { width: parent.width; text: modelData.primaryText; color: root.contentForeground; font.family: root.contentFontFamily; font.pixelSize: Style.font.body; elide: Text.ElideRight }
                    Text { width: parent.width; text: modelData.secondaryText; color: Qt.darker(root.contentForeground, 1.4); font.family: root.contentFontFamily; font.pixelSize: Style.font.caption; elide: Text.ElideRight }
                  }
                }
                MouseArea { anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onEntered: filterController.cursorIndex = filterController.indexForKey(modelData.key); onClicked: root.activateAction(modelData.action) }
              }
            }
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
