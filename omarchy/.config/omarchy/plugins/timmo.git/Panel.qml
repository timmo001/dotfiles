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
  property string selectedAgentView: "repo"
  property string selectedReleaseKey: ""
  property string selectedReleaseView: "overview"
  property string selectedFindingId: ""
  property string selectedFindingGroupKey: ""
  property string selectedImpactView: "release"
  property string releaseCursorKey: ""
  readonly property var selectedRelease: service ? service.releases.find(function(entry) {
    return entry.repo.toLowerCase() === selectedReleaseKey.toLowerCase() || entry.name.toLowerCase() === selectedReleaseKey.toLowerCase()
  }) || null : null
  readonly property var releaseSnapshot: selectedRelease ? selectedRelease.snapshot : null
  readonly property var selectedFinding: releaseSnapshot ? releaseSnapshot.findings.find(function(finding) { return finding.id === selectedFindingId }) || null : null
  readonly property var findingGroups: groupFindings()
  readonly property var selectedFindingGroup: findingGroups.find(function(group) { return group.id === selectedFindingGroupKey }) || null
  readonly property bool releaseAgentView: view === "agent" && selectedAgentView === "release-prepare"
  readonly property bool releaseView: releaseAgentView || ["releases", "release", "release-prepare", "release-choice", "finding-group", "finding", "release-commits"].indexOf(view) >= 0
  readonly property var filteredReleaseRows: filterController.filteredModel.filter(function(entry) { return ["release", "finding-group", "finding", "commit"].indexOf(entry.kind) >= 0 })
  readonly property var releaseGeometry: ({ x: panel.cardOrigin.x, y: panel.cardOrigin.y, width: panel.contentWidth, height: panel.contentHeight, screen: panel.screen ? panel.screen.name : "" })
  readonly property string cursorKey: filterController.selectedEntry() ? filterController.selectedEntry().key : ""
  readonly property bool selectedRepoCanPull: service !== null && !!service.canPullRepo(selectedRepo)
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
  readonly property var workspaceContext: service ? service.herdrContext : null
  readonly property var contextRows: filterRows("context-action")
  property string contextCursorKey: ""

  function buildPanelRows() {
    var rows = []
    if (view === "agent") {
      var agents = service ? service.installedAgents : []
      for (var i = 0; i < agents.length; i++) {
        var agent = agents[i]
        rows.push(actionRow("agent:" + agent.command, agent.label, "󱚣"))
      }
      rows.push(actionRow("back", releaseAgentView ? "Back to release preparation" : (selectedAgentView === "overview" ? "Back to Git overview" : "Back to repository"), ""))
      return rows
    }
    if (releaseView) {
      if (view !== "releases") rows.push(headerActionRow("release-refresh", "Refresh release comparison", "release-summary"))
      rows.push(actionRow("back", view === "releases" || (view === "release" && selectedReleaseView === "overview") ? "Back to Git overview" : (view === "release" ? "Back to unreleased changes" : (view === "finding" && selectedFindingGroup ? "Back to " + selectedFindingGroup.title.toLowerCase() : (view === "release-choice" && selectedImpactView === "release-prepare" ? "Back to release preparation" : "Back to release review"))), ""))
      if (view === "releases") {
        rows.push(headerActionRow("release-refresh", "Refresh unreleased changes", "release"))
        var releases = service ? service.releases : []
        for (var r = 0; r < releases.length; r++)
          if (releases[r].needsAttention)
            rows.push(releaseRow("release", releases[r].repo, releases[r], releases[r].name, releaseDetail(releases[r])))
      } else if (selectedRelease) {
        if (view === "release") {
          rows.push(actionRow("release-repo", "Open repository…", ""))
          rows.push(actionRow("release-prepare", "Prepare release…", "󰑓"))
          if (releaseSnapshot) {
            rows.push(actionRow("release-evidence", "Open full comparison", ""))
            rows.push(actionRow("release-commits", "All commits · " + releaseSnapshot.commits.length, ""))
            for (var g = 0; g < findingGroups.length; g++) {
              var group = findingGroups[g]
              if (group.findings.length) rows.push(releaseRow("finding-group", group.id, group, group.title + " · " + group.findings.length + "  ›", group.summary))
            }
          }
        } else if (view === "release-prepare") {
          rows.push(actionRow("release-choice", "Choose overall impact", "󰓹"))
          if (service && !service.releaseLaunching && selectedRelease.publishAvailable && releaseSnapshot && releaseSnapshot.complete && !selectedRelease.stale && selectedRelease.nextVersion)
            rows.push(actionRow("release-publish", "Start release…", "󰑓"))
          if (service && !service.releasePreparationIssue(selectedRelease))
            rows.push(actionRow("release-agent", "Open in agent", "󱚣"))
        } else if (view === "finding-group" && selectedFindingGroup) {
          var findings = selectedFindingGroup.findings
          for (var f = 0; f < findings.length; f++) {
            var finding = findings[f]
            rows.push(releaseRow("finding", finding.id, finding, "[" + (finding.impact === "none" ? "quiet" : finding.impact) + "] " + finding.detail, finding.reason + (finding.reviewed ? " · local review" : "")))
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
        }
      }
      return rows
    }
    if (view === "overview") {
      if (workspaceContext && workspaceContext.repository) {
        rows.push(headerActionRow("context-refresh", "Refresh workspace", "context"))
        var current = workspaceContext.repository
        var known = service.changedRepos.concat(service.otherRepos).find(function(repo) { return repo.path === current.path })
        var value = known || { name: current.name, path: current.path, statusKnown: false }
        repoActions(value).forEach(function(row) {
          row.key = "context:" + workspaceContext.session.socketPath + ":" + (workspaceContext.pane ? workspaceContext.pane.id : "") + ":" + current.path + ":" + row.action
          row.kind = "context-action"
          row.section = "context"
          row.value = value
          row.secondaryText = current.name + " " + current.path
          rows.push(row)
        })
      }
    } else if (view === "repo") {
      rows = rows.concat(repoActions(selectedRepo))
      rows.push(actionRow("back", "Back to repositories", ""))
      return rows
    } else {
      rows.push(actionRow("back", "Back to Git overview", ""))
    }
    var repos = []
    if (view === "overview" || view === "changed")
      rows.push(headerActionRow("pull-changed", "Pull incoming repository changes", "repo"))
    if (["overview", "changed", "other"].indexOf(view) >= 0)
      rows.push(headerActionRow("repositories-refresh", "Refresh repositories", "repo"))
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
    }
    var threads = service && (view === "overview" || view === "notifications") ? service.threads : []
    if (view === "overview" || view === "notifications")
      rows.push(headerActionRow("notifications-refresh", "Refresh notifications", "thread"))
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
    if (view === "overview") {
      rows.push(headerActionRow("release-refresh", "Refresh unreleased changes", "release"))
      var releases = service ? service.releases : []
      for (var r = 0; r < releases.length; r++)
        if (releases[r].needsAttention)
          rows.push(releaseRow("release", releases[r].repo, releases[r], releases[r].name, releaseDetail(releases[r])))
    }
    return rows
  }

  function repoActions(repo) {
    var rows = []
    if (service && service.canPullRepo(repo)) rows.push(actionRow("pull", "Pull", "󰜷"))
    return rows.concat([
      actionRow("lazygit", "Open in lazygit", ""),
      actionRow("editor", "Open in editor", ""),
      actionRow("agent", "Open in agent", "󱚣"),
      actionRow("terminal", "Open terminal", ""),
      actionRow("web", "Open on GitHub", "")
    ])
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

  function headerActionRow(action, label, section) {
    var row = actionRow(action, label, "󰑐")
    row.kind = "header-action"
    row.section = section
    return row
  }

  function releaseDetail(entry) {
    return (entry.snapshot ? entry.snapshot.releaseTag + " → " + entry.branch + " · " + entry.snapshot.suggestion : entry.branch + " · not checked")
      + (entry.stale ? " · stale" : "") + (entry.needsAttention ? " · release candidate" : "")
      + (entry.pending ? " · notification pending" : "")
  }

  function findingUrl(finding) {
    if (!finding || !releaseSnapshot) return ""
    return finding.evidenceUrl || (finding.submodule ? "" : releaseSnapshot.url)
  }

  function groupFindings() {
    if (!releaseSnapshot) return []
    var groups = [
      { id: "files", title: "File changes", findings: [] },
      { id: "dependencies", title: "Dependency changes", findings: [] },
      { id: "quiet", title: "Quiet changes", findings: [] }
    ]
    releaseSnapshot.findings.forEach(function(finding) {
      var index = finding.impact === "none" ? 2 : (finding.kind === "dependency" ? 1 : 0)
      groups[index].findings.push(finding)
    })
    return groups.map(function(group) {
      var impacts = ["major", "minor", "patch", "none"].map(function(impact) {
        var count = group.findings.filter(function(finding) { return finding.impact === impact }).length
        return count ? count + " " + (impact === "none" ? "quiet" : impact) : ""
      }).filter(function(value) { return value !== "" })
      var breakdown = []
      group.findings.forEach(function(finding) {
        var label = group.id === "quiet"
          ? (finding.kind === "dependency" ? (finding.role || "unclassified") + " dependency changes"
            : (finding.kind === "file" ? "file changes" : (finding.kind === "submodule" ? "submodule pin changes" : "checksum changes")))
          : (finding.reviewed ? "Local " + finding.impact + " choice" : finding.reason)
        var item = breakdown.find(function(item) { return item.label === label })
        if (item) item.count++
        else breakdown.push({ label: label, count: 1 })
      })
      group.summary = impacts.join(" · ") + (breakdown.length ? "\n" + breakdown.map(function(item) { return item.count + " · " + item.label }).join("\n") : "")
      return group
    })
  }

  function releaseSummary() {
    if (view === "releases") return service && !service.releasesLoaded ? "Loading release comparisons" : "Watched repositories with a suggested release"
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
    } else if (view === "release-prepare" || releaseAgentView) {
      if (releaseSnapshot && service) {
        lines.push("Proposed version: " + (selectedRelease.nextVersion || "To be resolved in the release session"))
        lines.push("Target branch: " + releaseSnapshot.branch, "Compared commit: " + releaseSnapshot.head)
        lines.push("Impact: " + releaseSnapshot.suggestion + (releaseSnapshot.reviewed ? " · local overall choice" : " · automatic"))
        lines.push(selectedRelease.publishAvailable ? "Start release opens a terminal in this repository's Herdr workspace. The terminal explains the steps, asks for confirmation and shows live progress. Failures offer agent recovery; success shows a summary and links." : "Open a release preparation session with the reviewed findings. The agent follows this repository's release workflow and runs its checks. Publish when ready from that session.")
      }
      var issue = service ? service.releasePreparationIssue(selectedRelease) : "Release service unavailable"
      if (issue) lines.push(issue)
    } else if (view === "finding-group") {
      lines.push(selectedFindingGroup && selectedFindingGroup.findings.length ? selectedFindingGroup.summary : "No findings remain in this group; their impact or evidence may have changed")
    } else if (releaseSnapshot) {
      lines.push("Suggested impact: " + releaseSnapshot.suggestion + (releaseSnapshot.reviewed ? " · local overall choice" : " · automatic"))
      var relevant = releaseSnapshot.findings.filter(function(finding) { return finding.impact !== "none" }).length
      lines.push(relevant + " release-relevant changes · " + (releaseSnapshot.findings.length - relevant) + " quiet")
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
    selectedReleaseView = "overview"
    selectedFindingId = ""
    selectedFindingGroupKey = ""
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
    if (service) service.refreshHerdrContext()
    if ((releaseView || view === "overview") && service) service.refreshReleases("read")
    filterController.reset()
    controller.show()
    Qt.callLater(function() {
      if (view === "overview") {
        var index = filterController.filteredModel.findIndex(function(entry) { return entry.kind === "repo" || entry.kind === "context-action" })
        if (index < 0)
          index = filterController.indexForKey("action:repositories-refresh")
        filterController.selectIndex(index)
      }
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
    if (entry.kind === "context-action") return contextRepeater.itemAt(contextRows.indexOf(entry))
    if (entry.kind === "header-action") {
      if (entry.action === "context-refresh") return contextHeading
      if (entry.action === "pull-changed") return repositoriesHeading
      if (entry.action === "repositories-refresh") return repositoriesHeading
      if (entry.action === "notifications-refresh") return notificationsHeading
      return releaseView && view !== "releases" ? comparisonHeading : releasesHeading
    }
    if (["release", "finding-group", "finding", "commit"].indexOf(entry.kind) >= 0)
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
    property string requestedKey: ""
    interval: 0
    onTriggered: if (requestedKey === root.cursorKey) root.scrollCursorIntoView()
  }

  function showView(nextView) {
    revealTimer.stop()
    view = nextView
    filterController.reset()
    panelFlick.contentY = 0
    Qt.callLater(function() {
      revealTimer.stop()
      filterController.reset()
      panelFlick.contentY = 0
    })
  }

  function showRepoActions(repo) {
    selectedRepoView = view
    selectedRepo = repo
    showView("repo")
  }

  function showAgentPicker(repo) {
    selectedAgentView = view
    selectedRepo = repo
    service.agentLaunchError = ""
    service.releaseActionError = ""
    showView("agent")
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
    else if (action === "context-refresh") service.refreshHerdrContext(true)
    else if (action === "repositories-refresh") service.refreshRepositories()
    else if (action === "notifications-refresh") service.refreshNotifications()
    else if (action === "releases") showView("releases")
    else if (action === "release-repo" && selectedRelease) showRepoActions(selectedRelease)
    else if (action === "release-agent") showAgentPicker(selectedRelease)
    else if (action === "release-publish") service.openRelease(selectedRelease, modifiers)
    else if (action === "release-choice") { selectedImpactView = view; showView(action) }
    else if (["release-prepare", "release-commits"].indexOf(action) >= 0) showView(action)
    else if (action === "release-evidence") service.openEvidence(view === "finding" ? findingUrl(selectedFinding) : (releaseSnapshot ? "https://github.com/" + releaseSnapshot.repo + "/compare/" + releaseSnapshot.releaseCommit + "...HEAD" : ""), selectedRelease, modifiers)
    else if (action.indexOf("impact:") === 0) service.releaseAction(selectedRelease, view === "finding" ? selectedFindingId : "overall", action.slice(7))
    else if (action === "back" && view === "agent") showView(selectedAgentView)
    else if (action === "back" && releaseView) showView(view === "releases" ? "overview" : (view === "release" ? selectedReleaseView : (view === "finding" && selectedFindingGroup ? "finding-group" : (view === "release-choice" ? selectedImpactView : "release"))))
    else if (action === "refresh") service.refresh()
    else if (action === "pull-changed") service.pullRepositories(service.changedRepos)
    else if (action === "changed" || action === "other") showView(action)
    else if (action === "agent") showAgentPicker(selectedRepo)
    else if (action === "back") showView(view === "repo" ? selectedRepoView : "overview")
    else if (action === "notifications") { close(); service.openNotifications(modifiers) }
    else if (action.indexOf("agent:") === 0 && selectedRepo) {
      if (releaseAgentView) service.prepareRelease(selectedRelease, findingGroups.map(function(group) { return { title: group.title, count: group.findings.length, summary: group.summary } }), action.slice(6), modifiers)
      else service.openAgent(selectedRepo, action.slice(6), "", modifiers)
    }
    else if (selectedRepo) {
      if (action === "pull") {
        service.openRepo(selectedRepo, action)
        return
      }
      close()
      service.openRepo(selectedRepo, action, modifiers)
    }
  }

  function activateThread(thread, modifiers) {
    if (!service || !thread) return
    close()
    service.openThread(thread, modifiers)
  }

  function activateEntry(entry, modifiers) {
    if (entry.kind === "action" || entry.kind === "footer-action" || entry.kind === "header-action") activateAction(entry.action, modifiers)
    else if (entry.kind === "context-action") { selectedRepo = entry.value; activateAction(entry.action, modifiers) }
    else if (entry.kind === "repo") showRepoActions(entry.value)
    else if (entry.kind === "thread") activateThread(entry.value, modifiers)
    else if (entry.kind === "release") { selectedReleaseView = view; selectedReleaseKey = entry.value.repo; showView("release") }
    else if (entry.kind === "finding-group") { selectedFindingGroupKey = entry.value.id; showView("finding-group") }
    else if (entry.kind === "finding") { selectedFindingId = entry.value.id; showView("finding") }
    else if (entry.kind === "commit") service.openEvidence(entry.value.url || (entry.value.submodule ? "" : "https://github.com/" + selectedRelease.repo + "/commit/" + entry.value.id), selectedRelease, modifiers)
  }

  function repoDetail(repo) {
    if (repo.statusKnown === false) return "Status not tracked"
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
    function onAgentOpened() { if (root.view === "agent") root.close() }
    function onReleaseOpened() { root.close() }
    function onPanelUpdated() { root.syncSelectedRepo() }
    function onContextUpdating() { root.contextCursorKey = root.cursorKey }
    function onContextUpdated() {
      Qt.callLater(function() {
        var index = filterController.indexForKey(root.contextCursorKey)
        if (index >= 0) filterController.selectIndex(index)
      })
    }
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
      onRevealRequested: { revealTimer.requestedKey = root.cursorKey; revealTimer.restart() }
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
            meta: root.releaseView ? (root.view === "finding-group" && root.selectedFindingGroup ? root.selectedFindingGroup.title : (root.view === "finding" ? "Finding evidence" : (root.view === "release-commits" ? "All commits" : "Local release review"))) : (root.view === "agent" && root.selectedRepo ? String(root.selectedRepo.name) : (root.view === "repo" && root.selectedRepo ? root.repoDetail(root.selectedRepo) : (root.view === "overview" ? root.changedRepoCount + " changed · " + root.notificationCountText : (root.view === "changed" ? root.changedRepoCount + " repositories" : (root.view === "notifications" ? root.notificationCountText : root.otherRepoCount + " repositories")))))
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

          SectionHeading {
            id: contextHeading
            visible: root.contextRows.length > 0 || filterController.indexForKey("action:context-refresh") >= 0
            title: root.workspaceContext?.workspace?.label.trim() || "Current workspace"
            foreground: root.contentForeground
            fontFamily: root.contentFontFamily
            refreshable: true
            refreshing: root.service ? root.service.contextRefreshing : false
            hasCursor: root.cursorKey === "action:context-refresh"
            onRefreshHovered: filterController.cursorIndex = filterController.indexForKey("action:context-refresh")
            onRefreshRequested: root.activateAction("context-refresh")
          }

          Column {
            visible: root.contextRows.length > 0
            width: parent.width
            spacing: Style.space(2)
            Repeater {
              id: contextRepeater
              model: root.contextRows
              CursorSurface {
                required property var modelData
                x: Style.space(8)
                width: Math.max(0, contentColumn.width - Style.space(16))
                implicitHeight: contextActionRow.implicitHeight + Style.space(12)
                hasCursor: root.cursorKey === modelData.key
                foreground: root.contentForeground
                accent: root.contentForeground
                Row {
                  id: contextActionRow
                  anchors.left: parent.left
                  anchors.right: parent.right
                  anchors.verticalCenter: parent.verticalCenter
                  anchors.margins: Style.space(8)
                  spacing: Style.space(10)
                  Text { width: Style.space(22); text: modelData.icon; color: root.contentForeground; font.family: root.contentFontFamily; font.pixelSize: Style.font.icon; horizontalAlignment: Text.AlignHCenter }
                  Text { width: Math.max(0, contextActionRow.width - Style.space(32)); text: modelData.primaryText; color: root.contentForeground; font.family: root.contentFontFamily; font.pixelSize: Style.font.body; elide: Text.ElideRight }
                }
                MouseArea {
                  anchors.fill: parent
                  hoverEnabled: true
                  cursorShape: Qt.PointingHandCursor
                  onEntered: filterController.cursorIndex = filterController.indexForKey(modelData.key)
                  onClicked: function(mouse) { root.activateEntry(modelData, mouse.modifiers) }
                }
              }
            }
          }

          SectionHeading {
            id: comparisonHeading
            visible: root.releaseView && root.view !== "releases"
            title: root.view === "release-prepare" || root.releaseAgentView ? "Prepare release" : (root.view === "finding-group" ? "Group summary" : "Release comparison")
            foreground: root.contentForeground
            fontFamily: root.contentFontFamily
            refreshable: !root.releaseAgentView
            refreshing: root.service ? root.service.releaseRefreshing : false
            hasCursor: root.cursorKey === "action:release-refresh"
            onRefreshHovered: filterController.cursorIndex = filterController.indexForKey("action:release-refresh")
            onRefreshRequested: root.activateAction("release-refresh")
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

          SectionHeading {
            visible: root.view !== "overview" && root.filteredActions.length > 0
            title: "Actions"
            foreground: root.contentForeground
            fontFamily: root.contentFontFamily
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
                MouseArea { anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onEntered: filterController.cursorIndex = filterController.indexForKey(modelData.key); onClicked: function(mouse) { root.activateAction(modelData.action, mouse.modifiers) } }
              }
            }
          }

          Text {
            visible: root.view === "agent" && root.service && root.service.agentLaunchError !== ""
            width: parent.width
            text: root.service ? root.service.agentLaunchError : ""
            textFormat: Text.PlainText
            wrapMode: Text.Wrap
            color: root.contentForeground
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.caption
          }

          SectionHeading {
            id: repositoriesHeading
            visible: ["overview", "changed", "other"].indexOf(root.view) >= 0 && (!filterController.filterText || root.filteredRepos.length > 0 || filterController.indexForKey("action:repositories-refresh") >= 0 || filterController.indexForKey("action:pull-changed") >= 0)
            title: (root.view === "overview" && !filterController.filterText ? "Changed repositories" : "Repositories") + " · " + root.filteredRepos.length
            foreground: root.contentForeground
            fontFamily: root.contentFontFamily
            refreshable: true
            refreshing: root.service ? root.service.repositoriesBusy : false
            hasCursor: root.cursorKey === "action:repositories-refresh"
            onRefreshHovered: filterController.cursorIndex = filterController.indexForKey("action:repositories-refresh")
            onRefreshRequested: root.activateAction("repositories-refresh")
            trailingControl: Component {
              PanelActionButton {
                visible: root.view === "overview" || root.view === "changed"
                enabled: root.service !== null && !root.service.pulling && root.service.pullableRepos.length > 0
                iconText: ""
                tooltipText: root.service && root.service.pulling ? "Pulling repositories" : "Pull incoming repository changes"
                foreground: root.contentForeground
                fontFamily: root.contentFontFamily
                hasCursor: root.cursorKey === "action:pull-changed"
                onHovered: function(hovered) { if (hovered) filterController.cursorIndex = filterController.indexForKey("action:pull-changed") }
                onClicked: root.activateAction("pull-changed")
              }
            }
          }

          Text {
            visible: ["overview", "changed", "other", "repo"].indexOf(root.view) >= 0 && root.service !== null && root.service.pullError !== ""
            width: parent.width
            text: root.service ? root.service.pullError : ""
            textFormat: Text.PlainText
            wrapMode: Text.WrapAnywhere
            color: root.contentForeground
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.caption
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
            visible: !filterController.filterText && (root.view === "overview" || root.view === "changed" || root.view === "other") && root.filteredRepos.length === 0 && root.service && (root.service.panelError !== "" || !root.service.panelLoaded)
            width: parent.width
            text: root.service && root.service.panelError !== "" ? root.service.panelError : "Loading repositories"
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
                  MouseArea { anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onEntered: filterController.cursorIndex = filterController.indexForKey(modelData.key); onClicked: function(mouse) { root.activateAction(modelData.action, mouse.modifiers) } }
                }
              }
            }
          }

          SectionHeading {
            id: notificationsHeading
            visible: (root.view === "overview" || root.view === "notifications") && (!filterController.filterText || root.filteredThreads.length > 0 || root.filteredFooterActions.length > 0 || filterController.indexForKey("action:notifications-refresh") >= 0)
            title: "Notifications · " + root.filteredThreads.length
            foreground: root.contentForeground
            fontFamily: root.contentFontFamily
            refreshable: true
            refreshing: root.service ? root.service.notificationsBusy : false
            hasCursor: root.cursorKey === "action:notifications-refresh"
            onRefreshHovered: filterController.cursorIndex = filterController.indexForKey("action:notifications-refresh")
            onRefreshRequested: root.activateAction("notifications-refresh")
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
                MouseArea { anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onEntered: filterController.cursorIndex = filterController.indexForKey(modelData.key); onClicked: function(mouse) { root.activateThread(modelData.value, mouse.modifiers) } }
              }
            }
          }

          Text {
            visible: (root.view === "overview" || root.view === "notifications") && !filterController.filterText && root.threadCount === 0 && root.service && (root.service.notificationsError !== "" || !root.service.notificationsLoaded)
            width: parent.width
            text: root.service && root.service.notificationsError !== "" ? root.service.notificationsError : "Loading notifications"
            color: Qt.darker(root.contentForeground, 1.4)
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.body
            horizontalAlignment: Text.AlignHCenter
          }

          Column {
            visible: (root.view === "overview" || root.view === "notifications") && root.filteredFooterActions.length > 0
            width: parent.width
            spacing: Style.space(8)

            Repeater {
              id: footerActionRepeater
              model: root.filteredFooterActions
              Column {
                required property int index
                required property var modelData
                width: contentColumn.width
                spacing: Style.space(8)

                CursorSurface {
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
                  MouseArea { anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onEntered: filterController.cursorIndex = filterController.indexForKey(modelData.key); onClicked: function(mouse) { root.activateAction(modelData.action, mouse.modifiers) } }
                }
              }
            }
          }

          SectionHeading {
            id: releasesHeading
            visible: (root.view === "overview" || root.view === "releases") && (!filterController.filterText || root.filteredReleaseRows.length > 0 || filterController.indexForKey("action:release-refresh") >= 0)
              || (root.releaseView && root.filteredReleaseRows.length > 0)
            title: root.view === "overview" || root.view === "releases" ? "Unreleased changes · " + root.filteredReleaseRows.length + " of " + (root.service ? root.service.releases.length : 0)
              : (root.view === "release-commits" ? "Commits" : (root.view === "release" ? "Finding groups" : "Findings")) + " · " + root.filteredReleaseRows.length
            foreground: root.contentForeground
            fontFamily: root.contentFontFamily
            refreshable: root.view === "overview" || root.view === "releases"
            refreshing: root.service ? root.service.releaseRefreshing : false
            hasCursor: root.cursorKey === "action:release-refresh"
            onRefreshHovered: filterController.cursorIndex = filterController.indexForKey("action:release-refresh")
            onRefreshRequested: root.activateAction("release-refresh")
          }

          Text {
            visible: (root.view === "overview" || root.view === "releases") && !filterController.filterText && (!root.service || !root.service.releasesLoaded || root.service.releases.length === 0 || root.service.releasesError !== "")
            width: parent.width
            text: root.service && root.service.releasesError ? root.service.releasesError : (root.service && root.service.releasesLoaded ? "No repositories configured for release tracking" : "Loading release comparisons")
            textFormat: Text.PlainText
            wrapMode: Text.WrapAnywhere
            color: Qt.darker(root.contentForeground, 1.4)
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.body
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
                MouseArea { anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onEntered: filterController.cursorIndex = filterController.indexForKey(modelData.key); onClicked: function(mouse) { root.activateEntry(modelData, mouse.modifiers) } }
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
