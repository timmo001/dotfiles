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
  readonly property color successColor: "#98c379"
  readonly property color warningColor: "#e5c07b"
  readonly property color hunkColor: "#56b6c2"
  readonly property color urgentColor: bar ? bar.urgent : Color.urgent
  readonly property color dimColor: Qt.darker(contentForeground, 1.4)
  property string view: "overview"
  property var selectedRepo: null
  property string selectedRepoView: "changed"
  property string selectedPullRequestRepo: ""
  property string selectedPullRequestView: "overview"
  property string pullRequestCursorKey: ""
  readonly property bool pullRequestView: view === "pulls" || view === "pull-repo"
  readonly property var selectedPullRequests: service ? service.pullRequestRepositories.find(function(repo) { return repo.repo.toLowerCase() === selectedPullRequestRepo.toLowerCase() || repo.name.toLowerCase() === selectedPullRequestRepo.toLowerCase() }) || null : null
  readonly property var filteredPullRequestRows: filterController.filteredModel.filter(function(row) { return row.section === "pulls" || row.section === "pulls-empty" })
  property string selectedIssueRepo: ""
  property string selectedIssueView: "overview"
  property var selectedIssue: null
  property string issueCursorKey: ""
  readonly property bool issueView: view === "issues" || view === "issue-repo"
  readonly property var selectedIssues: service ? service.issueRepositories.find(function(repo) { return repo.repo.toLowerCase() === selectedIssueRepo.toLowerCase() || repo.name.toLowerCase() === selectedIssueRepo.toLowerCase() }) || null : null
  readonly property var filteredIssueRows: filterController.filteredModel.filter(function(row) { return row.section === "issues" || row.section === "issues-empty" })
  property string selectedAgentView: "repo"
  property string selectedReleaseKey: ""
  property string selectedReleaseView: "overview"
  property string selectedFindingId: ""
  property string selectedFindingGroupKey: ""
  property string selectedImpactView: "release"
  property string selectedImpactScope: "overall"
  readonly property var impactFindings: selectedImpactScope === "all" && releaseSnapshot ? releaseSnapshot.findings : (selectedImpactScope === "group" && selectedFindingGroup ? selectedFindingGroup.findings : [])
  readonly property bool releaseReviewable: !!releaseSnapshot && !!selectedRelease && !selectedRelease.stale && releaseSnapshot.complete
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
  readonly property bool notificationReviewEnabled: service !== null && !service.notificationLaunching && allThreadCount > 0
  readonly property int otherThreadCount: Math.max(0, allThreadCount - threadCount)
  readonly property int hiddenDependencyCount: service ? Math.min(otherThreadCount, service.notificationHiddenBotCount) : 0
  readonly property string hiddenThreadText: [
    hiddenDependencyCount ? hiddenDependencyCount + (hiddenDependencyCount === 1 ? " dependency" : " dependencies") : "",
    otherThreadCount - hiddenDependencyCount ? (otherThreadCount - hiddenDependencyCount) + (otherThreadCount - hiddenDependencyCount === 1 ? " other" : " others") : ""
  ].filter(Boolean).join(" · ")
  readonly property string notificationCountText: threadCount + (threadCount === 1 ? " notification" : " notifications") + " (" + (hiddenThreadText || "0 others") + ")"
  readonly property var panelRows: withSectionToggles(buildPanelRows())
  // Rows in collapsed sections stay rendered for their counts but leave keyboard navigation.
  readonly property var navigationRows: filterController.filteredModel.filter(function(row) {
    var id = sectionId(row)
    return row.kind === "toggle" || !id || sectionExpanded(id)
  })
  readonly property var filteredActions: filterRows("action")
  readonly property var filteredRepos: filterRows("repo")
  readonly property var filteredThreads: filterRows("thread")
  readonly property var filteredFooterActions: filterRows("footer-action")
  readonly property var workspaceContext: service ? service.herdrContext : null
  readonly property var contextRows: filterRows("context-action")
  property string contextCursorKey: ""
  property var selectedCommit: null
  // Files changed and diff previews: the open commit, or a repository's uncommitted and unpushed changes.
  readonly property var changeSections: {
    if (!opened) return []
    if (view === "commit" && selectedCommit)
      return [{ path: String(selectedCommit.repo.path || ""), target: selectedCommit.commit.sha, title: "Files changed", diffTitle: "Diff preview" }]
    if (releaseView && selectedRelease && selectedRelease.path && releaseSnapshot) {
      var range = (releaseSnapshot.releaseCommit || "root") + ".." + releaseSnapshot.head
      var release = { path: String(selectedRelease.path), target: range, files: [], title: "Files changed", diffTitle: "Diff preview" }
      if (view === "release") return [release]
      var scoped = view === "finding" ? (selectedFinding ? [selectedFinding] : []) : (view === "finding-group" && selectedFindingGroup ? selectedFindingGroup.findings : [])
      var files = findingFiles(scoped)
      return files.length ? [Object.assign(release, { files: files })] : []
    }
    return view === "repo" ? localChangeSections(selectedRepo) : []
  }
  // The detected workspace repository's local changes, shown under its overview heading.
  readonly property var contextChangeSections: {
    if (!opened || view !== "overview" || !service || !workspaceContext || !workspaceContext.repository) return []
    var path = workspaceContext.repository.path
    return localChangeSections(service.changedRepos.concat(service.otherRepos).find(function(repo) { return repo.path === path }) || null)
  }
  // Local changes move, so reload them whenever the sections or repository state are recomputed.
  onChangeSectionsChanged: loadChangeSections(changeSections)
  onContextChangeSectionsChanged: loadChangeSections(contextChangeSections)

  function localChangeSections(repo) {
    if (!repo || repo.statusKnown === false) return []
    var sections = []
    if (Number(repo.modified || 0) > 0)
      sections.push({ path: String(repo.path || ""), target: "uncommitted", title: "Uncommitted changes", diffTitle: "Uncommitted diff" })
    if (Number(repo.ahead || 0) > 0)
      sections.push({ path: String(repo.path || ""), target: "unpushed", title: "Unpushed changes", diffTitle: "Unpushed diff" })
    if (Number(repo.behind || 0) > 0)
      sections.push({ path: String(repo.path || ""), target: "incoming", title: "Incoming changes", diffTitle: "Incoming diff" })
    return sections
  }

  function loadChangeSections(sections) {
    if (service) sections.forEach(function(section) { service.loadChanges(section.path, section.target, service.localChangeTargets.indexOf(section.target) >= 0, section.files) })
  }

  // Superproject paths behind release findings; submodule content is shown as its pin change.
  function findingFiles(findings) {
    var files = []
    findings.forEach(function(finding) {
      var paths = finding.submodule ? [finding.submodule] : [finding.path, finding.previousPath]
      paths.forEach(function(path) { if (path && files.indexOf(String(path)) < 0) files.push(String(path)) })
    })
    return files.sort()
  }

  // Long file lists and diff previews collapse to these heights until expanded.
  readonly property real filesCollapsedHeight: Style.space(160)
  readonly property real diffCollapsedHeight: Style.space(240)
  property var expandedSections: ({})

  function toggleExpanded(key) {
    var next = Object.assign({}, expandedSections)
    if (next[key]) delete next[key]
    else next[key] = true
    expandedSections = next
  }
  // Action groups start collapsed in every view.
  property var expandedGroups: ({})
  // Sections the user toggled, keyed by view and section.
  property var sectionOverrides: ({})
  readonly property bool sectionsCollapsible: !filterController.filterText

  // Filtering opens every section. The overview starts with only the workspace open, if there is one.
  function sectionExpanded(id) {
    if (filterController.filterText) return true
    var key = view + ":" + id
    if (key in sectionOverrides) return sectionOverrides[key]
    return !(view === "overview" && id !== "context")
  }

  function toggleSection(id) {
    var next = Object.assign({}, sectionOverrides)
    next[view + ":" + id] = !sectionExpanded(id)
    sectionOverrides = next
  }

  function sectionId(row) {
    if (row.kind === "toggle" || row.kind === "navigation") return ""
    if (row.kind === "action") return view === "overview" ? "repositories" : "actions"
    return ({ "release-summary": "summary", context: "context", repo: "repositories", thread: "notifications", footer: "notifications",
      release: "releases", pulls: "pulls", "pulls-empty": "pulls-empty", issues: "issues", "issues-empty": "issues-empty", log: "log" })[row.section] || ""
  }

  function toggleRow(id) {
    return { key: "toggle:" + id, kind: "toggle", sectionId: id }
  }

  // Adds a keyboard stop for each heading, placed where the heading sits in the panel.
  function withSectionToggles(rows) {
    var changes = view === "overview" ? [] : changeSections
    var files = changes.map(function(section) { return toggleRow("files:" + section.target) })
    var diffs = changes.filter(function(section) {
      var detail = service ? service.changeDetail(section.path, section.target, section.files) : null
      return !!detail && !!detail.preview
    }).map(function(section) { return toggleRow("diff:" + section.target) })
    var seen = {}
    var result = []
    rows.forEach(function(row) {
      var id = sectionId(row)
      if (!releaseView && id === "log" && diffs.length) { result = result.concat(diffs); diffs = [] }
      if (id && !seen[id]) { seen[id] = true; result.push(toggleRow(id)) }
      result.push(row)
      if (row.kind !== "navigation") return
      if (releaseView && view !== "releases" && !seen.summary) { seen.summary = true; result.push(toggleRow("summary")) }
      if (!releaseView) { result = result.concat(files); files = [] }
    })
    return result.concat(files, diffs)
  }
  property string selectedCommitAgentTask: "guide"
  readonly property int overviewCommitLimit: 20
  readonly property int repoCommitLimit: 40
  readonly property int logWindowHours: 12
  property string logAllView: "overview"
  property string commitReturnView: "repo"
  readonly property bool logRepoMode: view === "repo" || (view === "commits" && logAllView === "repo")
  readonly property var selectedLogRepo: service && selectedRepo ? service.logRepository(String(selectedRepo.path || "")) : null
  readonly property var filteredLogRows: filterController.filteredModel.filter(function(row) { return row.section === "log" && row.kind !== "header-action" })

  function buildPanelRows() {
    var rows = []
    if (view === "commit") {
      rows.push(navigationRow("Back to " + (selectedRepo ? selectedRepo.name : "repository")))
      if (!selectedCommit) return rows
      var diff = actionRow("commit-diff", "Open in diff viewer", "")
      diff.secondaryText = "git show in a terminal"
      var direct = actionRow("commit-plannotator", "Review in Plannotator directly", "")
      direct.secondaryText = "Browser review of the commit patch, without an agent"
      var plannotator = actionRow("commit-review-patch", "Review in Plannotator…", "󰈈")
      plannotator.secondaryText = "Quick review of the commit patch, feedback goes to an agent"
      direct.icon = plannotator.icon
      var plannotatorFull = actionRow("commit-review-worktree", "Review in Plannotator with full context…", plannotator.icon)
      plannotatorFull.secondaryText = "Review a temporary checkout, feedback goes to an agent"
      var guide = actionRow("commit-guide", "Generate Plannotator guide…", "󱚣")
      guide.secondaryText = "Ask an agent to write a Guided Review of this commit"
      rows.push(actionRow("commit-web", "Open on GitHub", ""), diff, direct, plannotator, plannotatorFull, guide)
      return groupActions(rows, ["commit-open", "commit-review"])
    }
    if (pullRequestView) {
      rows.push(navigationRow(view === "pulls" || selectedPullRequestView === "overview" ? "Back to Git overview" : "Back to all tracked repositories"))
      if (view === "pull-repo" && selectedPullRequests) rows.push(actionRow("pulls-web", "Open pull requests on GitHub", ""))
      return rows.concat(pullRequestRows())
    }
    if (issueView) {
      rows.push(navigationRow(view === "issues" || selectedIssueView === "overview" ? "Back to Git overview" : "Back to all tracked repositories"))
      if (view === "issue-repo" && selectedIssues) rows.push(actionRow("issues-web", "Open issues on GitHub", ""))
      return rows.concat(issueRows())
    }
    if (view === "agent") {
      rows.push(navigationRow(releaseAgentView ? "Back to release preparation" : (selectedAgentView === "overview" ? "Back to Git overview" : (selectedAgentView === "commit" ? "Back to commit" : (selectedAgentView === "issue-repo" ? "Back to issues" : "Back to repository")))))
      var agents = service ? service.installedAgents : []
      for (var i = 0; i < agents.length; i++) {
        var agent = agents[i]
        rows.push(actionRow("agent:" + agent.command, agent.label, "󱚣"))
      }
      return rows
    }
    if (releaseView) {
      rows.push(navigationRow(view === "releases" || (view === "release" && selectedReleaseView === "overview") ? "Back to Git overview" : (view === "release" ? "Back to all tracked repositories" : (view === "finding" && selectedFindingGroup ? "Back to " + selectedFindingGroup.title.toLowerCase() : (view === "release-choice" && selectedImpactView === "release-prepare" ? "Back to release preparation" : (view === "release-choice" && selectedImpactView === "finding-group" && selectedFindingGroup ? "Back to " + selectedFindingGroup.title.toLowerCase() : "Back to release review"))))))
      if (view !== "releases") rows.push(headerActionRow("release-refresh", "Refresh release comparison", "release-summary"))
      if (view === "releases") {
        rows.push(headerActionRow("release-refresh", "Refresh unreleased changes", "release"))
        var releases = service ? service.releases : []
        for (var r = 0; r < releases.length; r++)
          rows.push(releaseRow("release", releases[r].repo, releases[r], releases[r].name, releaseDetail(releases[r])))
      } else if (selectedRelease) {
        if (view === "release") {
          rows.push(actionRow("release-repo", "Open repository…", ""))
          rows.push(actionRow("release-prepare", "Prepare release…", "󰑓"))
          if (releaseSnapshot) {
            rows.push(actionRow("release-evidence", "Open full comparison", ""))
            if (selectedRelease.path) {
              var releaseDiff = actionRow("release-diff", "Open in diff viewer", "\uf440")
              releaseDiff.secondaryText = "git diff in a terminal"
              rows.push(releaseDiff)
            }
            rows.push(actionRow("release-commits", "All commits · " + releaseSnapshot.commits.length, ""))
            for (var g = 0; g < findingGroups.length; g++) {
              var group = findingGroups[g]
              if (group.findings.length) rows.push(releaseRow("finding-group", group.id, group, group.title + " · " + group.findings.length + "  ›", group.summary))
            }
            if (releaseReviewable && releaseSnapshot.findings.length)
              rows.push(actionRow("release-choice-all", "Choose impact for all " + releaseSnapshot.findings.length + " findings", "󰓹"))
          }
        } else if (view === "release-prepare") {
          rows.push(actionRow("release-choice", "Choose overall impact", "󰓹"))
          if (service && !service.releaseLaunching && selectedRelease.publishAvailable && releaseSnapshot && releaseSnapshot.complete && !selectedRelease.stale && selectedRelease.nextVersion)
            rows.push(actionRow("release-publish", "Start release…", "󰑓"))
          if (service && !service.releasePreparationIssue(selectedRelease))
            rows.push(actionRow("release-agent", "Open in agent", "󱚣"))
        } else if (view === "finding-group" && selectedFindingGroup) {
          var findings = selectedFindingGroup.findings
          if (releaseReviewable && findings.length)
            rows.push(actionRow("release-choice-group", "Choose impact for all " + findings.length + " in this group", "󰓹"))
          for (var f = 0; f < findings.length; f++) {
            var finding = findings[f]
            rows.push(releaseRow("finding", finding.id, finding, "[" + (finding.impact === "none" ? "quiet" : finding.impact) + "] " + finding.detail, finding.reason + (finding.reviewed ? " · local review" : "")))
          }
        } else if (view === "release-choice" || view === "finding") {
          if (view === "finding" && selectedFinding && findingUrl(selectedFinding)) rows.push(actionRow("release-evidence", "Open full evidence", ""))
          if (releaseSnapshot && (view === "release-choice" || selectedFinding) && !selectedRelease.stale && releaseSnapshot.complete) {
            var bulk = view === "release-choice" && selectedImpactScope !== "overall"
            var impacts = ["none", "patch", "minor", "major", "auto"]
            if (!bulk || impactFindings.length)
              for (var p = 0; p < impacts.length; p++)
                rows.push(actionRow("impact:" + impacts[p], bulk
                  ? (impacts[p] === "auto" ? "Auto · reset local choices for all " + impactFindings.length : "Set all " + impactFindings.length + " to " + impacts[p])
                  : (impacts[p] === "auto" ? "Auto · reset local choice" : "Choose " + impacts[p]), "󰓹"))
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
          row.key = "context:" + workspaceContext.session.socketPath + ":" + (workspaceContext.pane ? workspaceContext.pane.id : "") + ":" + current.path + ":" + row.key
          row.kind = "context-action"
          row.section = "context"
          row.value = value
           if (!row.secondaryText) row.secondaryText = current.name + " " + current.path
          rows.push(row)
        })
      }
    } else if (view === "repo") {
      rows.push(navigationRow("Back to repositories"))
      rows = rows.concat(repoActions(selectedRepo))
      return rows.concat(logRows())
    } else if (view === "commits") {
      rows.push(navigationRow(logAllView === "repo" ? "Back to repository" : "Back to Git overview"))
      return rows.concat(logRows())
    } else {
      rows.push(navigationRow("Back to Git overview"))
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
      rows.push(actionRow("other", "Other tracked repositories", "󰙅"))
    }
    var threads = service && (view === "overview" || view === "notifications") ? service.threads : []
    if (view === "overview" || view === "notifications") {
      if (notificationReviewEnabled) rows.push(headerActionRow("notifications-dismiss", "Review dependency notifications", "thread"))
      rows.push(headerActionRow("notifications-refresh", "Refresh notifications", "thread"))
    }
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
    if (view === "overview" || view === "notifications") {
      rows.push(footerActionRow(
        "notifications",
        "GitHub notifications",
        notificationCountText,
        ""
      ))
    }
    if (view === "overview") {
      rows.push(headerActionRow("release-refresh", "Refresh unreleased changes", "release"))
      var releases = service ? service.releases : []
      for (var r = 0; r < releases.length; r++)
        if (releases[r].needsAttention)
          rows.push(releaseRow("release", releases[r].repo, releases[r], releases[r].name, releaseDetail(releases[r])))
      var allReleases = actionRow("releases", "All tracked repositories", "󰙅")
      allReleases.kind = "release-action"
      allReleases.section = "release"
      rows.push(allReleases)
      rows = rows.concat(pullRequestRows(), issueRows(), logRows())
    }
    return rows
  }

  function commitKey(repo, commit) {
    return "log:" + repo.path + ":" + commit.sha
  }

  function relativeTime(value) {
    var seconds = Math.max(0, Math.floor((Date.now() - Date.parse(value)) / 1000))
    if (!isFinite(seconds)) return "unknown"
    if (seconds < 60) return "just now"
    if (seconds < 3600) return Math.floor(seconds / 60) + "m ago"
    if (seconds < 86400) return Math.floor(seconds / 3600) + "h ago"
    return Math.floor(seconds / 86400) + "d ago"
  }

  function logEntries() {
    if (logRepoMode)
      return selectedLogRepo ? selectedLogRepo.commits.map(function(commit) { return { repo: selectedLogRepo, commit: commit } }) : []
    return service ? service.recentCommits : []
  }

  function logLimit() {
    if (view === "commits") return Infinity
    return logRepoMode ? repoCommitLimit : overviewCommitLimit
  }

  function logWindowEntries() {
    var since = Date.now() - logWindowHours * 3600000
    return logEntries().filter(function(entry) { return Date.parse(entry.commit.date) >= since })
  }

  function logHeadingCount() {
    var shown = filteredLogRows.filter(function(row) { return row.kind === "log" }).length
    var recent = logWindowEntries()
    var incoming = recent.filter(function(entry) { return entry.commit.incoming }).length
    return (shown === recent.length ? "" : shown + (recent.length > shown ? " of " : " · ")) + recent.length + " in the last " + logWindowHours + " hours"
      + (incoming ? " · " + incoming + " not pulled" : "")
  }

  function showAllCommits() {
    var next = logEntries()[logLimit()]
    logAllView = view
    showView("commits", next ? commitKey(next.repo, next.commit) : "")
  }

  function logRows() {
    var rows = [headerActionRow("log-refresh", "Refresh commit log", "log")]
    var recent = logWindowEntries()
    var entries = view === "commits" ? recent : logEntries()
    var limit = logLimit()
    entries.slice(0, limit).forEach(function(entry) {
      var commit = entry.commit
      rows.push({ key: commitKey(entry.repo, commit), kind: "log", section: "log", value: entry, icon: commit.incoming ? "󰇚" : "",
        primaryText: commit.subject,
        secondaryText: (logRepoMode ? "" : entry.repo.name + " · ") + commit.sha.slice(0, 7) + " · " + commit.author + " · " + relativeTime(commit.date) + (commit.incoming ? " · not pulled" : "") })
    })
    if (logRepoMode && selectedLogRepo) {
      var all = actionRow("log-web", "All commits on GitHub", "")
      all.kind = "log-action"
      all.section = "log"
      rows.push(all)
    }
    if (recent.length > limit) {
      var remaining = recent.length - limit
      var more = actionRow("log-more", "Show more", "󰇘")
      more.kind = "log-action"
      more.section = "log"
      more.secondaryText = remaining + " more " + (remaining === 1 ? "commit" : "commits")
      rows.push(more)
    }
    return rows
  }

  function logStatus() {
    if (!service || !service.logLoaded) return "Loading commits"
    if (service.logError) return service.logError
    if (!logRepoMode) return service.recentCommits.length ? "" : "No commits found"
    if (!selectedLogRepo) return "Repository is not in the commit log"
    if (selectedLogRepo.error) return "Stale: " + selectedLogRepo.error
    return selectedLogRepo.commits.length ? "" : "No commits found"
  }

  function activateLog(entry) {
    if (!logRepoMode) {
      var path = entry.repo.path
      selectedRepoView = view
      selectedRepo = service.changedRepos.concat(service.otherRepos).find(function(repo) { return String(repo.path || "") === path })
        || { name: entry.repo.name, path: path, statusKnown: false }
    }
    selectedCommit = entry
    commitReturnView = logRepoMode ? view : "repo"
    showView("commit")
  }

  function escapeHtml(text) {
    return String(text).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
  }

  function colourSpan(colour, text) {
    return "<span style=\"color:" + String(colour) + "\">" + escapeHtml(text) + "</span>"
  }

  function preformatted(lines) {
    return "<div style=\"white-space:pre-wrap\">" + lines.join("<br>") + "</div>"
  }

  // Summary line for a Files changed list, mirroring dot update's summary. label prefixes it when the section has no heading.
  function changeFilesText(detail, error, label) {
    var prefix = label ? "<b>" + escapeHtml(label) + "</b> · " : ""
    if (!detail) return prefix + escapeHtml(error || "Loading changed files…")
    var files = detail.files
    if (!files.length) return prefix + escapeHtml("No file changes")
    var lines = [prefix + files.length + " file" + (files.length === 1 ? "" : "s") + " changed · " + colourSpan(successColor, "+" + detail.added) + " " + colourSpan(urgentColor, "-" + detail.deleted)]
    if (error) lines.push(colourSpan(urgentColor, error))
    return lines.join("<br>")
  }

  function fileStatusColour(file) {
    var status = String(file.status).charAt(0)
    return status === "A" || status === "?" ? successColor : (status === "D" ? urgentColor : (status === "M" ? warningColor : hunkColor))
  }

  function fileCountsText(file) {
    if (String(file.status).charAt(0) === "?") return colourSpan(dimColor, "untracked")
    if (file.added === null || file.deleted === null) return colourSpan(dimColor, "binary")
    return [file.added > 0 ? colourSpan(successColor, "+" + file.added) : "", file.deleted > 0 ? colourSpan(urgentColor, "-" + file.deleted) : ""].filter(Boolean).join(" ")
  }

  function changeDiffText(detail) {
    if (!detail || !detail.preview) return ""
    var lines = String(detail.preview).split("\n").map(function(line) {
      if (line.indexOf("diff --git ") === 0) return "<b>" + escapeHtml(line) + "</b>"
      if (/^(index |--- |\+\+\+ |new file|deleted file|old mode|new mode|similarity|rename |Binary files)/.test(line)) return colourSpan(dimColor, line)
      if (line.indexOf("@@") === 0) return colourSpan(hunkColor, line)
      if (line.charAt(0) === "+") return colourSpan(successColor, line)
      if (line.charAt(0) === "-") return colourSpan(urgentColor, line)
      return escapeHtml(line)
    })
    if (detail.truncated) lines.push(colourSpan(dimColor, "…preview truncated; open in diff viewer for the rest"))
    return preformatted(lines)
  }

  function pullRequestRows() {
    var rows = [headerActionRow("pulls-refresh", "Refresh pull requests", "pulls")]
    if (view === "pull-repo") {
      if (selectedPullRequests) selectedPullRequests.pulls.forEach(function(pr) {
        rows.push({ key: "pull:" + selectedPullRequests.repo + ":" + pr.number, kind: "pull", section: "pulls", value: pr,
          primaryText: "#" + pr.number + " " + pr.title,
          secondaryText: pullRequestDetail(pr), ready: pullRequestReady(pr) })
      })
      return rows
    }
    var repositories = service ? service.pullRequestRepositories.slice().sort(function(a, b) { return a.name.localeCompare(b.name) }) : []
    var withPulls = repositories.filter(function(repo) { return repo.pulls.length > 0 || (view === "pulls" && (repo.error || repo.checkedAt === null)) })
    var withoutPulls = view === "pulls" ? repositories.filter(function(repo) { return repo.pulls.length === 0 && !repo.error && repo.checkedAt !== null }) : []
    withPulls.concat(withoutPulls).forEach(function(repo) {
      var empty = withoutPulls.indexOf(repo) >= 0
      rows.push({ key: "pull-repo:" + repo.repo, kind: "pull-repo", section: empty ? "pulls-empty" : "pulls", value: repo,
        primaryText: repo.name + (empty ? "" : "  ›"),
        secondaryText: pullRepositorySummary(repo), ready: repo.pulls.some(pullRequestReady) })
    })
    if (view === "overview") {
      var all = actionRow("pulls", "All tracked repositories", "󰙅")
      all.kind = "pull-action"
      all.section = "pulls"
      rows.push(all)
    }
    return rows
  }

  function pullRequestReady(pr) {
    return !pr.draft && pr.checks === "pass"
  }

  function pullRequestDetail(pr) {
    var status = pr.draft ? "Draft" : pullRequestReady(pr) ? "Ready" : ({ fail: "Failed", pending: "Pending", cancelled: "Cancelled", none: "No passing checks", unknown: "CI unavailable" })[pr.checks] || "CI unavailable"
    var failing = pr.failingChecks || []
    var brief = failing.length ? " · Failed: " + failing.slice(0, 2).join(", ") + (failing.length > 2 ? " +" + (failing.length - 2) : "") : ""
    return pr.author + " · " + status + brief
  }

  function pullRepositorySummary(repo) {
    if (repo.checkedAt === null) return repo.error || "Not checked yet"
    var readyCount = repo.pulls.filter(pullRequestReady).length
    var draftCount = repo.pulls.filter(function(pr) { return pr.draft }).length
    return repo.pulls.length + " open · " + readyCount + " ready" + (draftCount ? " · " + draftCount + " draft" + (draftCount === 1 ? "" : "s") : "") + (repo.error ? " · stale: " + repo.error : "")
  }

  function pullRequestStatus() {
    if (!service || !service.pullRequestsLoaded) return "Loading pull requests"
    var messages = [service.pullRequestsError].filter(function(value) { return value !== "" })
    var repositories = view === "pull-repo" ? (selectedPullRequests ? [selectedPullRequests] : []) : service.pullRequestRepositories
    repositories.forEach(function(repo) {
      if (repo.error) messages.push(repo.name + ": " + repo.error)
    })
    if (messages.length) return messages.join("\n")
    if (view === "pull-repo") return selectedPullRequests
      ? (selectedPullRequests.pulls.length ? "" : "No open pull requests")
      : "Repository unavailable or tracking disabled"
    if (!repositories.length) return "No repositories enabled for pull request tracking"
    return repositories.some(function(repo) { return repo.pulls.length > 0 }) ? "" : "No open pull requests"
  }

  // reset() lands on the first row after Back, which is now a heading toggle.
  function selectFirstRow() {
    var index = filterController.navigationEntries.findIndex(function(entry) { return entry.navigation !== true && entry.kind !== "toggle" })
    if (index >= 0) filterController.selectIndex(index)
  }

  function selectFirstPullRequest() {
    if (view !== "pull-repo") return
    var index = filterController.navigationEntries.findIndex(function(entry) { return entry.kind === "pull" })
    if (index < 0) index = filterController.indexForKey("action:pulls-web")
    filterController.selectIndex(index)
  }

  function issueKey(repo, issue) {
    return "issue:" + repo.repo + ":" + issue.number
  }

  function issueRows() {
    var rows = [headerActionRow("issues-refresh", "Refresh issues", "issues")]
    if (view === "issue-repo") {
      if (selectedIssues) selectedIssues.issues.forEach(function(issue) {
        rows.push({ key: issueKey(selectedIssues, issue), kind: "issue", section: "issues", value: issue,
          primaryText: "#" + issue.number + " " + issue.title, secondaryText: issueDetail(issue) })
      })
      return rows
    }
    var repositories = service ? service.issueRepositories.slice().sort(function(a, b) { return a.name.localeCompare(b.name) }) : []
    var withIssues = repositories.filter(function(repo) { return repo.issues.length > 0 || (view === "issues" && (repo.error || repo.checkedAt === null)) })
    var withoutIssues = view === "issues" ? repositories.filter(function(repo) { return repo.issues.length === 0 && !repo.error && repo.checkedAt !== null }) : []
    withIssues.concat(withoutIssues).forEach(function(repo) {
      var empty = withoutIssues.indexOf(repo) >= 0
      rows.push({ key: "issue-repo:" + repo.repo, kind: "issue-repo", section: empty ? "issues-empty" : "issues", value: repo,
        primaryText: repo.name + (empty ? "" : "  ›"),
        secondaryText: issueRepositorySummary(repo) })
    })
    if (view === "overview") {
      var all = actionRow("issues", "All tracked repositories", "󰙅")
      all.kind = "issue-action"
      all.section = "issues"
      rows.push(all)
    }
    return rows
  }

  function issueDetail(issue) {
    var details = [issue.author].concat(issue.labels.slice(0, 3))
    if (issue.comments) details.push(issue.comments + (issue.comments === 1 ? " comment" : " comments"))
    return details.join(" · ")
  }

  function issueRepositorySummary(repo) {
    if (repo.checkedAt === null) return repo.error || "Not checked yet"
    return repo.issues.length + " open" + (repo.error ? " · stale: " + repo.error : "")
  }

  function issueStatus() {
    if (!service || !service.issuesLoaded) return "Loading issues"
    var messages = [service.issuesError].filter(function(value) { return value !== "" })
    var repositories = view === "issue-repo" ? (selectedIssues ? [selectedIssues] : []) : service.issueRepositories
    repositories.forEach(function(repo) {
      if (repo.error) messages.push(repo.name + ": " + repo.error)
    })
    if (messages.length) return messages.join("\n")
    if (view === "issue-repo") return selectedIssues
      ? (selectedIssues.issues.length ? "" : "No open issues")
      : "Repository unavailable or tracking disabled"
    if (!repositories.length) return "No repositories enabled for issue tracking"
    return repositories.some(function(repo) { return repo.issues.length > 0 }) ? "" : "No open issues"
  }

  function selectFirstIssue() {
    if (view !== "issue-repo") return
    var index = filterController.navigationEntries.findIndex(function(entry) { return entry.kind === "issue" })
    if (index < 0) index = filterController.indexForKey("action:issues-web")
    filterController.selectIndex(index)
  }

  function showIssueAgentPicker(issue) {
    if (!selectedIssues || !issue) return
    selectedIssue = issue
    showAgentPicker(selectedIssues)
  }

  function repoActions(repo) {
    var rows = []
    if (service && service.canPullRepo(repo)) rows.push(actionRow("pull", "Pull", "󰜷"))
    rows.push(
      actionRow("lazygit", "Open in lazygit", ""),
      actionRow("plannotator-review", "Review changes in Plannotator", "󰈈"),
      actionRow("plannotator-last", "Review the last commit in Plannotator", "󰈈"),
      actionRow("plannotator-annotate", "Annotate files in Plannotator", "󰏫"),
      actionRow("plannotator-tui", "Annotate Markdown in Plannotator TUI", "󰏫"),
      actionRow("editor", "Open in editor", ""),
      actionRow("agent", "Open in agent", "󱚣"),
      actionRow("terminal", "Open terminal", ""),
      actionRow("web", "Open on GitHub", ""),
      actionRow("actions", "Open GitHub Actions", "󰜎")
    )
    rows = groupActions(rows, ["open", "review"])
    var notificationEntry = service ? service.notificationRepository(repo) : null
    if (notificationEntry) {
      var review = actionRow("repo-notifications", "Review notifications…", "")
      var slugs = (notificationEntry.slugs || []).map(function(slug) { return String(slug).toLowerCase() })
      var threads = service.threads.filter(function(thread) { return thread.unread !== false && slugs.indexOf(String(thread.repo || "").toLowerCase()) >= 0 })
      if (threads.length) rows = rows.concat(trackedGroup("repo-notifications", "Notifications", review.icon, service.notificationSummary(repo), threads.map(function(thread) {
        var row = actionRow("repo-thread:" + thread.id, thread.title, review.icon)
        row.secondaryText = [thread.reason, thread.type].filter(Boolean).join(" · ")
        return row
      }).concat([review])))
      else if (notificationEntry.count) {
        review.primaryText = "Notifications"
        review.secondaryText = service.notificationSummary(repo)
        review.showSecondary = true
        rows.push(review)
      }
    }
    var pulls = trackedRepository(service ? service.pullRequestRepositories : [], repo)
    if (pulls) rows = rows.concat(trackedGroup("repo-pulls", "Pull requests…", "", pullRepositorySummary(pulls), pulls.pulls.map(function(pr) {
      var row = actionRow("repo-pull:" + pr.number, "#" + pr.number + " " + pr.title, "")
      row.secondaryText = pullRequestDetail(pr)
      return row
    }).concat([actionRow("repo-pulls-web", "Open pull requests on GitHub", "")])))
    var issues = trackedRepository(service ? service.issueRepositories : [], repo)
    if (issues) rows = rows.concat(trackedGroup("repo-issues", "Issues…", "", issueRepositorySummary(issues), issues.issues.map(function(issue) {
      var row = actionRow("repo-issue:" + issue.number, "#" + issue.number + " " + issue.title, "")
      row.secondaryText = issueDetail(issue)
      return row
    }).concat([actionRow("repo-issues-web", "Open issues on GitHub", "")])))
    return rows
  }

  function trackedRepository(repositories, repo) {
    if (!repo || !repo.path) return null
    return repositories.find(function(entry) { return entry.path === repo.path }) || null
  }

  // A collapsible group like groupActions, without the quick button, for a repository's tracked pull requests or issues.
  function trackedGroup(id, label, icon, summary, members) {
    var expanded = !!filterController.filterText || !!expandedGroups[id]
    var header = actionRow("group:" + id, label + (expanded ? "  ▾" : "  ›"), icon)
    header.secondaryText = summary
    header.showSecondary = true
    return [header].concat(expanded ? members.map(function(row) {
      row.child = true
      row.showSecondary = !!row.secondaryText
      return row
    }) : [])
  }

  function openTrackedAction(action, modifiers) {
    var pulls = action.indexOf("repo-pull") === 0
    var tracked = trackedRepository(pulls ? service.pullRequestRepositories : service.issueRepositories, selectedRepo)
    if (!tracked) return
    close()
    if (action === "repo-pulls-web") return service.openPulls(tracked, modifiers)
    if (action === "repo-issues-web") return service.openIssues(tracked, modifiers)
    var number = Number(action.slice(action.indexOf(":") + 1))
    var items = pulls ? tracked.pulls : tracked.issues
    var item = items.find(function(entry) { return Number(entry.number) === number })
    if (pulls) service.openPullRequest(tracked, item, modifiers)
    else service.openIssue(tracked, item, modifiers)
  }

  // Each group lists its actions with the short name its quick button shows.
  readonly property var actionGroups: ({
    "commit-open": { label: "Open in…", icon: "\uf08e", actions: { "commit-web": "GitHub", "commit-diff": "Diff viewer" } },
    "commit-review": { label: "Review in Plannotator…", actions: { "commit-plannotator": "Directly", "commit-review-patch": "With an agent", "commit-review-worktree": "Full context", "commit-guide": "Guide" } },
    "open": { label: "Open in…", icon: "\uf08e", actions: { "lazygit": "Lazygit", "editor": "Editor", "agent": "Agent", "terminal": "Terminal", "web": "GitHub", "actions": "GitHub Actions" } },
    "review": { label: "Review in Plannotator…", actions: { "plannotator-review": "Changes", "plannotator-last": "Last commit", "plannotator-annotate": "Annotate files", "plannotator-tui": "Annotate Markdown (TUI)" } }
  })

  // Collapses related actions under a toggle row, placed where the first member was.
  // The toggle row carries a quick button for the group's last used action (or its first),
  // which takes the cursor before the toggle itself.
  // Groups open while filtering so their members stay searchable.
  function groupActions(rows, ids) {
    var groups = ids.map(function(id) { return { id: id, definition: actionGroups[id], members: null } })
    var result = []
    rows.forEach(function(row) {
      var group = groups.find(function(group) { return row.action in group.definition.actions })
      if (!group) result.push(row)
      else if (group.members) group.members.push(row)
      else { group.members = [row]; result.push(group) }
    })
    return result.reduce(function(all, item) {
      if (!item.members) return all.concat([item])
      var expanded = !!filterController.filterText || !!expandedGroups[item.id]
      var lastAction = service ? service.lastGroupActions[item.id] : ""
      var last = item.members.find(function(row) { return row.action === lastAction }) || item.members[0]
      var header = actionRow("group:" + item.id, item.definition.label + (expanded ? "  ▾" : "  ›"), item.definition.icon || item.members[0].icon)
      var quick = []
      if (!filterController.filterText) {
        quick.push(Object.assign({}, last, { key: "quick:" + item.id, hidden: true, chip: item.definition.actions[last.action] }))
        header.quick = quick[0]
        header.label = item.definition.label
        header.chevron = expanded ? "▾" : "›"
      }
      // Members show the short name under the group; the full label stays searchable.
      return all.concat(quick, [header], expanded ? item.members.map(function(row) {
        row.child = true
        row.tertiaryText = row.primaryText
        row.primaryText = item.definition.actions[row.action]
        return row
      }) : [])
    }, [])
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

  function navigationRow(label) {
    return {
      key: "action:back",
      kind: "navigation",
      section: "navigation",
      navigation: true,
      action: "back",
      primaryText: label,
      secondaryText: ""
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
    return (entry.snapshot ? (entry.snapshot.releaseTag || "unreleased") + " → " + entry.branch + " · " + entry.snapshot.suggestion : entry.branch + " · not checked")
      + (entry.stale ? " · stale" : "") + (entry.needsAttention ? " · release candidate" : "")
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
    if (view === "releases") return service && !service.releasesLoaded ? "Loading release comparisons" : "All repositories configured for release tracking"
    if (!selectedRelease) return service && !service.releasesLoaded ? "Loading selected repository" : "Repository unavailable; return to unreleased changes or refresh"
    var lines = [releaseDetail(selectedRelease)]
    if (selectedRelease.error) lines.push(selectedRelease.error)
    if (view === "finding") {
      if (!selectedFinding) lines.push("This evidence changed; return to the release review and select again")
      else {
        lines.push(selectedFinding.detail, selectedFinding.reason, "Impact: " + selectedFinding.impact + " · automatic: " + selectedFinding.automaticImpact)
        lines.push(selectedFinding.changeType + " · " + selectedFinding.path)
        if (selectedFinding.previousPath) lines.push("From path: " + selectedFinding.previousPath)
        if (selectedFinding.role) lines.push("Dependency role: " + selectedFinding.role)
        // The diff below shows file, metadata and submodule changes; a dependency's values pinpoint its entry in a larger manifest or lockfile diff.
        if (selectedFinding.kind === "dependency" || !changeSections.length)
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
    } else if (view === "release-choice" && selectedImpactScope !== "overall") {
      lines.push(impactFindings.length
        ? "Sets the same local impact on " + impactFindings.length + " findings" + (selectedImpactScope === "group" && selectedFindingGroup ? " in " + selectedFindingGroup.title.toLowerCase() : "") + ". Auto resets them to their automatic impact."
        : "No findings remain in this group; their impact or evidence may have changed")
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
    selectedPullRequestRepo = ""
    selectedPullRequestView = "overview"
    selectedIssueRepo = ""
    selectedIssueView = "overview"
    selectedIssue = null
    expandedGroups = ({})
    sectionOverrides = ({})
    var target = null
    try {
      var payload = JSON.parse(String(payloadJson || "{}"))
      if (payload.view === "notifications") initialView = payload.view
      if ((payload.view === "repo" || payload.view === "commit") && String(payload.path || "").charAt(0) === "/") target = payload
      if (payload.view === "pulls") {
        selectedPullRequestRepo = String(payload.repo || "")
        initialView = selectedPullRequestRepo ? "pull-repo" : "pulls"
      }
      if (payload.view === "issues") {
        selectedIssueRepo = String(payload.repo || "")
        initialView = selectedIssueRepo ? "issue-repo" : "issues"
      }
      if (payload.view === "releases") {
        selectedReleaseKey = String(payload.repo || "")
        initialView = selectedReleaseKey ? "release" : "releases"
      }
    } catch (error) {
    }
    view = initialView
    selectedRepo = null
    if (target && service) openTarget(target)
    if (service) service.refreshHerdrContext()
    if (service) { service.notificationLaunchError = ""; service.refreshNotifications() }
    if ((releaseView || view === "overview") && service) service.refreshReleases("read")
    if ((pullRequestView || view === "overview" || view === "repo") && service) service.refreshPullRequests("read")
    if ((issueView || view === "overview" || view === "repo") && service) service.refreshIssues("read")
    if (service) service.refreshLog("read")
    filterController.reset()
    if (target && view === "repo") expandedGroups = { review: true }
    controller.show()
    Qt.callLater(function() {
      selectFirstRow()
      if (view === "overview") {
        var index = filterController.navigationEntries.findIndex(function(entry) { return entry.kind === "repo" || entry.kind === "context-action" })
        if (index < 0)
          index = filterController.indexForKey("action:repositories-refresh")
        filterController.selectIndex(index)
      }
      if (target && view === "repo") filterController.selectIndex(filterController.indexForKey("action:plannotator-review"))
      panelFlick.contentY = 0
      selectFirstPullRequest()
      selectFirstIssue()
      filterController.forceActiveFocus()
    })
  }

  function openTarget(target) {
    var path = String(target.path)
    selectedRepoView = "overview"
    selectedRepo = service.changedRepos.concat(service.otherRepos).find(function(repo) { return String(repo.path || "") === path })
      || { name: path.split("/").pop(), path: path, statusKnown: false }
    view = "repo"
    var sha = String(target.sha || "")
    if (target.view !== "commit" || !/^[0-9a-f]{7,64}$/.test(sha)) return
    var logRepo = service.logRepository(path)
    var commit = logRepo ? logRepo.commits.find(function(entry) { return entry.sha === sha }) : null
    selectedCommit = { repo: logRepo || selectedRepo, commit: commit || {
      sha: sha, subject: String(target.subject || ""), author: String(target.author || ""), date: String(target.date || ""), incoming: false } }
    commitReturnView = "repo"
    view = "commit"
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
    if (entry.kind === "navigation") return panelHeader
    if (entry.kind === "toggle") return sectionHeading(entry.sectionId)
    if (entry.section === "pulls" || entry.section === "pulls-empty") return pullRequestsSection.itemForKey(entry.key)
    if (entry.section === "issues" || entry.section === "issues-empty") return issuesSection.itemForKey(entry.key)
    if (entry.kind === "release-action") return allReleasesAction
    if (entry.kind === "context-action") return contextRepeater.itemAt(contextRows.indexOf(entry) + (entry.hidden ? 1 : 0))
    if (entry.section === "log") return entry.kind === "header-action" ? logHeading : logRepeater.itemAt(filteredLogRows.indexOf(entry))
    if (entry.kind === "header-action") {
      if (entry.action === "context-refresh") return contextHeading
      if (entry.action === "pull-changed") return repositoriesHeading
      if (entry.action === "repositories-refresh") return repositoriesHeading
      if (entry.action === "notifications-refresh" || entry.action === "notifications-dismiss") return notificationsHeading
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
    return repeater.itemAt(rows.indexOf(entry) + (entry.hidden ? 1 : 0))
  }

  function sectionHeading(id) {
    if (id.indexOf("files:") === 0 || id.indexOf("diff:") === 0) {
      var target = id.slice(id.indexOf(":") + 1)
      var repeaters = id.indexOf("files:") === 0 ? [filesRepeater, releaseFilesRepeater] : [diffRepeater, releaseDiffRepeater]
      for (var r = 0; r < repeaters.length; r++)
        for (var i = 0; i < repeaters[r].count; i++) {
          var item = repeaters[r].itemAt(i)
          if (item && item.modelData.target === target) return item.heading
        }
      return null
    }
    if (id.indexOf("pulls") === 0) return pullRequestsSection.itemForKey("toggle:" + id)
    if (id.indexOf("issues") === 0) return issuesSection.itemForKey("toggle:" + id)
    return ({ summary: comparisonHeading, context: contextHeading, actions: actionsHeading, repositories: repositoriesHeading,
      notifications: notificationsHeading, releases: releasesHeading, log: logHeading })[id] || null
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

  function showView(nextView, focusKey) {
    revealTimer.stop()
    expandedGroups = ({})
    view = nextView
    filterController.reset()
    panelFlick.contentY = 0
    Qt.callLater(function() {
      revealTimer.stop()
      filterController.reset()
      panelFlick.contentY = 0
      selectFirstRow()
      selectFirstPullRequest()
      selectFirstIssue()
      var index = focusKey ? filterController.indexForKey(focusKey) : -1
      if (index >= 0) {
        filterController.selectIndex(index)
        revealTimer.requestedKey = focusKey
        revealTimer.restart()
      }
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
    for (var group in actionGroups)
      if (action in actionGroups[group].actions) service.rememberGroupAction(group, action)
    if (action.indexOf("group:") === 0) {
      var groups = Object.assign({}, expandedGroups)
      groups[action.slice(6)] = !groups[action.slice(6)]
      expandedGroups = groups
    }
    else if (action === "release-refresh") { service.releaseActionError = ""; service.refreshReleases("refresh") }
    else if (action === "pulls-refresh") service.refreshPullRequests("refresh")
    else if (action === "pulls") showView("pulls")
    else if (action === "pulls-web") { close(); service.openPulls(selectedPullRequests, modifiers) }
    else if (action === "back" && pullRequestView) showView(view === "pulls" ? "overview" : selectedPullRequestView)
    else if (action === "issues-refresh") service.refreshIssues("refresh")
    else if (action === "issues") showView("issues")
    else if (action === "issues-web") { close(); service.openIssues(selectedIssues, modifiers) }
    else if (action === "back" && issueView) showView(view === "issues" ? "overview" : selectedIssueView)
    else if (action === "context-refresh") service.refreshHerdrContext(true)
    else if (action === "repositories-refresh") service.refreshRepositories()
    else if (action === "notifications-refresh") service.refreshNotifications()
    else if (action === "notifications-dismiss" && notificationReviewEnabled) service.openNotificationReview(null, "dependencies")
    else if (action === "repo-notifications") service.openNotificationReview(selectedRepo, "all")
    else if (/^repo-(pulls?|issues?)(-web|:)/.test(action)) openTrackedAction(action, modifiers)
    else if (action.indexOf("repo-thread:") === 0) {
      var thread = service.threads.find(function(entry) { return String(entry.id) === action.slice(12) })
      if (thread) { close(); service.openThread(thread, modifiers) }
    }
    else if (action === "releases") showView("releases")
    else if (action === "release-repo" && selectedRelease) showRepoActions(selectedRelease)
    else if (action === "release-agent") showAgentPicker(selectedRelease)
    else if (action === "release-publish") service.openRelease(selectedRelease, modifiers)
    else if (action.indexOf("release-choice") === 0) {
      selectedImpactView = view
      selectedImpactScope = action === "release-choice-all" ? "all" : (action === "release-choice-group" ? "group" : "overall")
      showView("release-choice")
    }
    else if (["release-prepare", "release-commits"].indexOf(action) >= 0) showView(action)
    else if (action === "release-evidence") service.openEvidence(view === "finding" ? findingUrl(selectedFinding) : (releaseSnapshot ? "https://github.com/" + releaseSnapshot.repo + (releaseSnapshot.releaseCommit ? "/compare/" + releaseSnapshot.releaseCommit + "...HEAD" : "/commits/" + releaseSnapshot.branch) : ""), selectedRelease, modifiers)
    else if (action === "release-diff" && selectedRelease) { close(); service.openReleaseDiff(selectedRelease, modifiers) }
    else if (action.indexOf("impact:") === 0) {
      var targets = view === "finding" ? [selectedFindingId]
        : (selectedImpactScope === "overall" ? ["overall"] : impactFindings.map(function(finding) { return finding.id }))
      if (targets.length) service.releaseAction(selectedRelease, targets, action.slice(7))
    }
    else if (action === "back" && view === "agent") showView(selectedAgentView)
    else if (action === "log-refresh") service.refreshLog("refresh")
    else if (action === "log-web") { close(); service.openCommitsWeb(selectedLogRepo, modifiers) }
    else if (action === "log-more") showAllCommits()
    else if (action === "back" && view === "commits") showView(logAllView, "action:log-more")
    else if (action === "back" && view === "commit") showView(commitReturnView, selectedCommit ? commitKey(selectedCommit.repo, selectedCommit.commit) : "")
    else if (["commit-guide", "commit-review-patch", "commit-review-worktree"].indexOf(action) >= 0 && selectedCommit) { selectedCommitAgentTask = action.slice(7); showAgentPicker(selectedRepo) }
    else if (action.indexOf("commit-") === 0 && selectedCommit) { close(); service.openCommit(selectedCommit.repo, selectedCommit.commit, action.slice(7), modifiers) }
    else if (action === "back" && releaseView) showView(view === "releases" ? "overview" : (view === "release" ? selectedReleaseView : (view === "finding" && selectedFindingGroup ? "finding-group" : (view === "release-choice" ? selectedImpactView : "release"))))
    else if (action === "refresh") service.refresh()
    else if (action === "pull-changed") service.pullRepositories(service.changedRepos)
    else if (action === "changed" || action === "other") showView(action)
    else if (action === "agent") showAgentPicker(selectedRepo)
    else if (action === "back") showView(view === "repo" ? selectedRepoView : "overview")
    else if (action === "notifications") { close(); service.openNotifications(modifiers) }
    else if (action.indexOf("agent:") === 0 && selectedRepo) {
      if (releaseAgentView) service.prepareRelease(selectedRelease, findingGroups.map(function(group) { return { title: group.title, count: group.findings.length, summary: group.summary } }), action.slice(6), modifiers)
      else if (selectedAgentView === "commit" && selectedCommit) service.openCommitAgent(selectedCommit.repo, selectedCommit.commit, selectedCommitAgentTask, action.slice(6), modifiers)
      else if (selectedAgentView === "issue-repo" && selectedIssue) service.openIssueAgent(selectedIssues, selectedIssue, action.slice(6), modifiers)
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
    if (entry.kind === "toggle") toggleSection(entry.sectionId)
    else if (entry.kind === "action" || entry.kind === "navigation" || entry.kind === "footer-action" || entry.kind === "header-action" || entry.kind === "release-action" || entry.kind === "pull-action" || entry.kind === "issue-action" || entry.kind === "log-action") activateAction(entry.action, modifiers)
    else if (entry.kind === "log") activateLog(entry.value)
    else if (entry.kind === "pull-repo") {
      if (entry.value.pulls.length === 0 && entry.value.checkedAt !== null && !entry.value.error) { close(); service.openPulls(entry.value, modifiers) }
      else { selectedPullRequestRepo = entry.value.repo; selectedPullRequestView = view; showView("pull-repo") }
    }
    else if (entry.kind === "pull") { close(); service.openPullRequest(selectedPullRequests, entry.value, modifiers) }
    else if (entry.kind === "issue-repo") {
      if (entry.value.issues.length === 0 && entry.value.checkedAt !== null && !entry.value.error) { close(); service.openIssues(entry.value, modifiers) }
      else { selectedIssueRepo = entry.value.repo; selectedIssueView = view; showView("issue-repo") }
    }
    else if (entry.kind === "issue") { close(); service.openIssue(selectedIssues, entry.value, modifiers) }
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

  function repoSummary(rows) {
    var changed = 0, pull = 0, push = 0
    rows.forEach(function(row) {
      if (Number(row.value.modified || 0) > 0) changed++
      if (Number(row.value.behind || 0) > 0) pull++
      if (Number(row.value.ahead || 0) > 0) push++
    })
    var values = []
    if (changed > 0) values.push(changed + " changed")
    if (pull > 0) values.push(pull + " to pull")
    if (push > 0) values.push(push + " to push")
    return values.join(" · ") || String(rows.length)
  }

  function threadSummary(rows) {
    var counts = {}
    rows.forEach(function(row) { counts[row.value.kind] = (counts[row.value.kind] || 0) + 1 })
    var labels = [["needs-you", "needs you", "need you"], ["alert", "alert", "alerts"], ["people", "people", "people"], ["quiet", "quiet", "quiet"]]
    var values = labels.filter(function(label) { return counts[label[0]] }).map(function(label) {
      return counts[label[0]] + " " + (counts[label[0]] === 1 ? label[1] : label[2])
    })
    if (!values.length) values.push(String(rows.length))
    if (!filterController.filterText && hiddenThreadText) values.push(hiddenThreadText)
    return values.join(" · ")
  }

  function unreleasedSummary(rows) {
    var counts = { major: 0, minor: 0, patch: 0 }
    var stale = 0
    rows.forEach(function(row) {
      var impact = row.value.snapshot ? row.value.snapshot.suggestion : ""
      if (impact in counts) counts[impact]++
      if (row.value.stale) stale++
    })
    var values = ["major", "minor", "patch"].filter(function(impact) { return counts[impact] }).map(function(impact) { return counts[impact] + " " + impact })
    if (stale) values.push(stale + " stale")
    return values.join(" · ") || rows.length + " of " + (service ? service.releases.length : 0)
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
    function onNotificationReviewOpened() { root.close() }
    function onPanelUpdated() {
      var key = root.cursorKey
      root.syncSelectedRepo()
      Qt.callLater(function() {
        var index = filterController.indexForKey(key)
        if (index >= 0) filterController.selectIndex(index)
      })
    }
    function onPullRequestsUpdating() { root.pullRequestCursorKey = root.cursorKey }
    function onPullRequestsUpdated() {
      Qt.callLater(function() {
        var index = filterController.indexForKey(root.pullRequestCursorKey)
        if (index >= 0) filterController.selectIndex(index)
        else root.selectFirstPullRequest()
      })
    }
    function onIssuesUpdating() { root.issueCursorKey = root.cursorKey }
    function onIssuesUpdated() {
      Qt.callLater(function() {
        var index = filterController.indexForKey(root.issueCursorKey)
        if (index >= 0) filterController.selectIndex(index)
        else root.selectFirstIssue()
      })
    }
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
      navigationModel: root.navigationRows
      backOnEmptyFilter: true
      onRevealRequested: { revealTimer.requestedKey = root.cursorKey; revealTimer.restart() }
      onActivateRequested: function(entry, modifiers) { root.activateEntry(entry, modifiers) }
      onBackRequested: if (root.view === "overview") root.close(); else root.activateAction("back")
      onCloseRequested: root.close()
      onTabRequested: function(direction) { root.switchPanel(direction) }
      onRefreshRequested: if (root.releaseView) root.activateAction("release-refresh"); else if (root.pullRequestView) root.activateAction("pulls-refresh"); else if (root.issueView) root.activateAction("issues-refresh"); else root.service.refresh()

      PanelFlickable {
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

          PanelHeader {
            id: panelHeader
            readonly property var backEntry: root.panelRows.find(function(row) { return row.navigation === true }) || null
            backText: backEntry ? backEntry.primaryText : ""
            backHasCursor: root.cursorKey === "action:back"
            onBackHovered: filterController.cursorIndex = filterController.indexForKey("action:back")
            onBackActivated: root.activateAction("back")
            title: root.view === "commit" ? (root.selectedCommit ? root.selectedCommit.commit.subject : "Commit") : root.pullRequestView ? (root.view === "pulls" ? "All tracked repositories" : (root.selectedPullRequests ? root.selectedPullRequests.name : "Pull requests")) : root.issueView ? (root.view === "issues" ? "All tracked repositories" : (root.selectedIssues ? root.selectedIssues.name : "Issues")) : root.releaseView ? (root.view === "releases" ? "All tracked repositories" : (root.selectedRelease ? root.selectedRelease.name : "Release review")) : (root.view === "agent" ? "Open in agent" : (root.view === "repo" && root.selectedRepo ? String(root.selectedRepo.name) : (root.view === "commits" ? (root.logRepoMode && root.selectedRepo ? String(root.selectedRepo.name) : "Recent commits") : (root.view === "overview" ? "Git" : (root.view === "changed" ? "Changed" : (root.view === "notifications" ? "Notifications" : "Other"))))))
            meta: root.view === "commit" ? (root.selectedCommit ? root.selectedCommit.repo.name + " · " + root.selectedCommit.commit.sha.slice(0, 7) : "") : root.pullRequestView ? (root.view === "pull-repo" ? "Open pull requests · recently updated first" : "Pull request tracking") : root.issueView ? (root.view === "issue-repo" ? "Open issues · recently updated first" : "Issue tracking") : root.releaseView ? (root.view === "finding-group" && root.selectedFindingGroup ? root.selectedFindingGroup.title : (root.view === "finding" ? "Finding evidence" : (root.view === "release-commits" ? "All commits" : "Local release review"))) : (root.view === "agent" && root.selectedRepo ? String(root.selectedRepo.name) : (root.view === "repo" && root.selectedRepo ? root.repoDetail(root.selectedRepo) : (root.view === "commits" ? "Last " + root.logWindowHours + " hours" + (root.logRepoMode ? "" : " · all repositories") : (root.view === "overview" ? root.changedRepoCount + " changed · " + root.notificationCountText : (root.view === "changed" ? root.changedRepoCount + " repositories" : (root.view === "notifications" ? root.notificationCountText : root.otherRepoCount + " repositories"))))))
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
            visible: root.view === "commit" && root.selectedCommit !== null
            width: parent.width
            text: root.selectedCommit ? [root.selectedCommit.commit.subject, root.selectedCommit.commit.sha, root.selectedCommit.commit.author + " · " + root.relativeTime(root.selectedCommit.commit.date) + (root.selectedCommit.commit.incoming ? " · not pulled yet" : "")].join("\n") : ""
            textFormat: Text.PlainText
            wrapMode: Text.WrapAnywhere
            color: root.contentForeground
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.caption
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
            collapsible: root.sectionsCollapsible
            expanded: root.sectionExpanded("summary")
            toggleHasCursor: root.cursorKey === "toggle:summary"
            onToggleHovered: filterController.cursorIndex = filterController.indexForKey("toggle:summary")
            onToggleRequested: root.toggleSection("summary")
            onRefreshHovered: filterController.cursorIndex = filterController.indexForKey("action:release-refresh")
            onRefreshRequested: root.activateAction("release-refresh")
          }

          Text {
            visible: root.releaseView && (root.view === "releases" || root.sectionExpanded("summary"))
            width: parent.width
            text: root.releaseSummary() + (root.service && root.service.releasesError ? "\n" + root.service.releasesError : "") + (root.service && root.service.releaseActionError ? "\n" + root.service.releaseActionError : "")
            textFormat: Text.PlainText
            wrapMode: Text.WrapAnywhere
            color: root.contentForeground
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.caption
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
            collapsible: root.sectionsCollapsible
            expanded: root.sectionExpanded("context")
            toggleHasCursor: root.cursorKey === "toggle:context"
            onToggleHovered: filterController.cursorIndex = filterController.indexForKey("toggle:context")
            onToggleRequested: root.toggleSection("context")
            onRefreshHovered: filterController.cursorIndex = filterController.indexForKey("action:context-refresh")
            onRefreshRequested: root.activateAction("context-refresh")
          }

          // Release views show changes after their actions and findings; the other sections belong to different views.
          Repeater {
            id: filesRepeater
            model: root.releaseView ? [] : root.changeSections
            delegate: filesSectionDelegate
          }

          Component {
            id: filesSectionDelegate
            Column {
              id: filesSection
              required property var modelData
              readonly property alias heading: filesHeading
              readonly property string sectionId: "files:" + modelData.target
              readonly property bool bodyShown: root.view === "overview" || root.sectionExpanded(sectionId)
              readonly property string expandKey: "files:" + modelData.path + "@" + modelData.target + "#" + (modelData.files || []).join("\n")
              readonly property bool expanded: !!root.expandedSections[expandKey]
              readonly property var detail: root.service ? root.service.changeDetail(modelData.path, modelData.target, modelData.files) : null
              readonly property string error: root.service ? root.service.changeDetailError(modelData.path, modelData.target, modelData.files) : ""
              readonly property bool overflowing: filesContent.implicitHeight > root.filesCollapsedHeight
              // On the overview these are the workspace's changes, shown under its heading.
              visible: root.view !== "overview" || root.sectionExpanded("context")
              width: contentColumn.width
              spacing: contentColumn.spacing
              SectionHeading {
                id: filesHeading
                visible: root.view !== "overview"
                title: modelData.title
                foreground: root.contentForeground
                fontFamily: root.contentFontFamily
                collapsible: root.sectionsCollapsible
                expanded: filesSection.bodyShown
                toggleHasCursor: root.cursorKey === "toggle:" + filesSection.sectionId
                onToggleHovered: filterController.cursorIndex = filterController.indexForKey("toggle:" + filesSection.sectionId)
                onToggleRequested: root.toggleSection(filesSection.sectionId)
              }
              Item {
                visible: filesSection.bodyShown
                x: Style.space(16)
                width: parent.width - Style.space(32)
                height: filesSection.overflowing && !filesSection.expanded ? root.filesCollapsedHeight : filesContent.implicitHeight
                clip: true
                Column {
                  id: filesContent
                  width: parent.width
                  Text {
                    width: parent.width
                    text: root.changeFilesText(filesSection.detail, filesSection.error, root.view === "overview" ? filesSection.modelData.title : "")
                    textFormat: Text.RichText
                    wrapMode: Text.Wrap
                    color: root.contentForeground
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.caption
                  }
                  Repeater {
                    model: filesSection.detail ? filesSection.detail.files.slice(0, 50) : []
                    Row {
                      id: fileRow
                      required property var modelData
                      width: filesContent.width
                      spacing: Style.space(8)
                      Text {
                        id: fileStatus
                        text: String(fileRow.modelData.status).charAt(0)
                        color: root.fileStatusColour(fileRow.modelData)
                        font.family: root.contentFontFamily
                        font.pixelSize: Style.font.caption
                      }
                      Text {
                        width: Math.max(0, fileRow.width - fileStatus.implicitWidth - fileCounts.implicitWidth - fileRow.spacing * 2)
                        text: fileRow.modelData.path
                        textFormat: Text.PlainText
                        elide: Text.ElideMiddle
                        color: root.contentForeground
                        font.family: root.contentFontFamily
                        font.pixelSize: Style.font.caption
                      }
                      Text {
                        id: fileCounts
                        text: root.fileCountsText(fileRow.modelData)
                        textFormat: Text.RichText
                        color: root.contentForeground
                        font.family: root.contentFontFamily
                        font.pixelSize: Style.font.caption
                      }
                    }
                  }
                  Text {
                    visible: !!filesSection.detail && filesSection.detail.files.length > 50
                    text: filesSection.detail ? "…and " + (filesSection.detail.files.length - 50) + " more" : ""
                    color: root.dimColor
                    font.family: root.contentFontFamily
                    font.pixelSize: Style.font.caption
                  }
                }
              }
              Text {
                visible: filesSection.bodyShown && filesSection.overflowing
                x: Style.space(16)
                text: filesSection.expanded ? "Show less" : "Show more"
                color: root.dimColor
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.caption
                font.underline: filesToggle.containsMouse
                MouseArea {
                  id: filesToggle
                  anchors.fill: parent
                  hoverEnabled: true
                  cursorShape: Qt.PointingHandCursor
                  onClicked: root.toggleExpanded(filesSection.expandKey)
                }
              }
            }
          }

          Column {
            visible: root.contextRows.length > 0 && root.sectionExpanded("context")
            width: parent.width
            spacing: Style.space(2)
            Repeater {
              id: contextRepeater
              model: root.contextRows
              CursorSurface {
                required property var modelData
                visible: !modelData.hidden
                x: Style.space(8)
                width: Math.max(0, contentColumn.width - Style.space(16))
                implicitHeight: contextActionRow.implicitHeight + Style.space(12)
                hasCursor: root.cursorKey === modelData.key
                foreground: root.contentForeground
                accent: root.contentForeground
                MouseArea {
                  anchors.fill: parent
                  hoverEnabled: true
                  cursorShape: Qt.PointingHandCursor
                  onEntered: filterController.cursorIndex = filterController.indexForKey(modelData.key)
                  onClicked: function(mouse) { root.activateEntry(modelData, mouse.modifiers) }
                }
                Row {
                  id: contextActionRow
                  anchors.left: parent.left
                  anchors.right: parent.right
                  anchors.verticalCenter: parent.verticalCenter
                  anchors.margins: Style.space(8)
                  anchors.leftMargin: Style.space(modelData.child ? 28 : 8)
                  spacing: Style.space(10)
                  Text { width: Style.space(22); anchors.verticalCenter: parent.verticalCenter; text: modelData.icon; color: root.contentForeground; font.family: root.contentFontFamily; font.pixelSize: Style.font.icon; horizontalAlignment: Text.AlignHCenter }
                  Column {
                    visible: !modelData.quick
                    width: Math.max(0, contextActionRow.width - Style.space(32))
                    spacing: Style.space(2)
                    Text { width: parent.width; text: modelData.primaryText; color: root.contentForeground; font.family: root.contentFontFamily; font.pixelSize: Style.font.body; elide: Text.ElideRight }
                    Text { visible: !!modelData.showSecondary; width: parent.width; text: modelData.secondaryText; textFormat: Text.PlainText; color: Qt.darker(root.contentForeground, 1.25); font.family: root.contentFontFamily; font.pixelSize: Style.font.caption; elide: Text.ElideRight }
                  }
                  Text { visible: !!modelData.quick; anchors.verticalCenter: parent.verticalCenter; text: modelData.label || ""; color: root.contentForeground; font.family: root.contentFontFamily; font.pixelSize: Style.font.body }
                  PanelActionButton {
                    id: contextQuickButton
                    readonly property var entry: modelData.quick || null
                    visible: entry !== null
                    anchors.verticalCenter: parent.verticalCenter
                    width: contextQuickMetrics.width + Style.space(20)
                    iconText: entry ? entry.icon + "  " + entry.chip : ""
                    tooltipText: entry ? entry.primaryText : ""
                    bordered: true
                    fontSize: Style.font.body
                    foreground: root.contentForeground
                    fontFamily: root.contentFontFamily
                    hasCursor: entry !== null && root.cursorKey === entry.key
                    onHovered: function(hovered) { if (hovered) filterController.cursorIndex = filterController.indexForKey(entry.key) }
                    onClicked: root.activateEntry(entry, Qt.NoModifier)
                    TextMetrics { id: contextQuickMetrics; font.family: root.contentFontFamily; font.pixelSize: Style.font.body; text: contextQuickButton.iconText }
                  }
                }
                Text { visible: !!modelData.quick; anchors.right: parent.right; anchors.rightMargin: Style.space(16); anchors.verticalCenter: parent.verticalCenter; text: modelData.chevron || ""; color: root.contentForeground; font.family: root.contentFontFamily; font.pixelSize: Style.font.body }
              }
            }
          }

          // The workspace repository's local changes follow its actions.
          Repeater {
            model: root.contextChangeSections
            delegate: filesSectionDelegate
          }

          SectionHeading {
            id: actionsHeading
            visible: root.view !== "overview" && root.filteredActions.length > 0
            title: "Actions"
            foreground: root.contentForeground
            fontFamily: root.contentFontFamily
            collapsible: root.sectionsCollapsible
            expanded: root.sectionExpanded("actions")
            toggleHasCursor: root.cursorKey === "toggle:actions"
            onToggleHovered: filterController.cursorIndex = filterController.indexForKey("toggle:actions")
            onToggleRequested: root.toggleSection("actions")
          }

          Column {
            visible: root.view !== "overview" && root.sectionExpanded("actions")
            width: parent.width
            spacing: Style.space(2)
            Repeater {
              id: actionRepeater
              model: root.filteredActions
              CursorSurface {
                required property int index
                required property var modelData
                visible: !modelData.hidden
                x: Style.space(8)
                width: Math.max(0, contentColumn.width - Style.space(16))
                implicitHeight: actionRow.implicitHeight + Style.space(12)
                hasCursor: filterController.cursorIndex === filterController.indexForKey(modelData.key)
                foreground: root.contentForeground
                accent: root.contentForeground
                MouseArea { anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onEntered: filterController.cursorIndex = filterController.indexForKey(modelData.key); onClicked: function(mouse) { root.activateAction(modelData.action, mouse.modifiers) } }
                Row {
                  id: actionRow
                  anchors.left: parent.left
                  anchors.right: parent.right
                  anchors.verticalCenter: parent.verticalCenter
                  anchors.leftMargin: Style.space(modelData.child ? 28 : 8)
                  anchors.rightMargin: Style.space(8)
                  spacing: Style.space(10)
                  Text { width: Style.space(22); anchors.verticalCenter: parent.verticalCenter; text: modelData.icon; color: root.contentForeground; font.family: root.contentFontFamily; font.pixelSize: Style.font.icon; horizontalAlignment: Text.AlignHCenter }
                  Column {
                    visible: !modelData.quick
                    width: Math.max(0, actionRow.width - Style.space(32))
                    spacing: Style.space(2)
                    Text { width: parent.width; text: modelData.primaryText; color: root.contentForeground; font.family: root.contentFontFamily; font.pixelSize: Style.font.body; elide: Text.ElideRight }
                    Text { visible: !!modelData.secondaryText; width: parent.width; text: modelData.secondaryText; textFormat: Text.PlainText; color: Qt.darker(root.contentForeground, 1.25); font.family: root.contentFontFamily; font.pixelSize: Style.font.caption; elide: Text.ElideRight }
                  }
                  Text { visible: !!modelData.quick; anchors.verticalCenter: parent.verticalCenter; text: modelData.label || ""; color: root.contentForeground; font.family: root.contentFontFamily; font.pixelSize: Style.font.body }
                  PanelActionButton {
                    id: actionQuickButton
                    readonly property var entry: modelData.quick || null
                    visible: entry !== null
                    anchors.verticalCenter: parent.verticalCenter
                    width: actionQuickMetrics.width + Style.space(20)
                    iconText: entry ? entry.icon + "  " + entry.chip : ""
                    tooltipText: entry ? entry.primaryText : ""
                    bordered: true
                    fontSize: Style.font.body
                    foreground: root.contentForeground
                    fontFamily: root.contentFontFamily
                    hasCursor: entry !== null && root.cursorKey === entry.key
                    onHovered: function(hovered) { if (hovered) filterController.cursorIndex = filterController.indexForKey(entry.key) }
                    onClicked: root.activateEntry(entry, Qt.NoModifier)
                    TextMetrics { id: actionQuickMetrics; font.family: root.contentFontFamily; font.pixelSize: Style.font.body; text: actionQuickButton.iconText }
                  }
                }
                Text { visible: !!modelData.quick; anchors.right: parent.right; anchors.rightMargin: Style.space(16); anchors.verticalCenter: parent.verticalCenter; text: modelData.chevron || ""; color: root.contentForeground; font.family: root.contentFontFamily; font.pixelSize: Style.font.body }
              }
            }
          }

          Repeater {
            id: diffRepeater
            model: root.releaseView ? [] : root.changeSections
            delegate: diffSectionDelegate
          }

          Component {
            id: diffSectionDelegate
            Column {
              id: diffSection
              required property var modelData
              readonly property alias heading: diffHeading
              readonly property string sectionId: "diff:" + modelData.target
              readonly property bool bodyShown: root.sectionExpanded(sectionId)
              readonly property var detail: root.service ? root.service.changeDetail(modelData.path, modelData.target, modelData.files) : null
              readonly property string expandKey: "diff:" + modelData.path + "@" + modelData.target + "#" + (modelData.files || []).join("\n")
              readonly property bool expanded: !!root.expandedSections[expandKey]
              readonly property bool overflowing: diffText.implicitHeight > root.diffCollapsedHeight
              visible: !!detail && !!detail.preview
              width: contentColumn.width
              spacing: contentColumn.spacing
              SectionHeading {
                id: diffHeading
                title: modelData.diffTitle
                foreground: root.contentForeground
                fontFamily: root.contentFontFamily
                collapsible: root.sectionsCollapsible
                expanded: diffSection.bodyShown
                toggleHasCursor: root.cursorKey === "toggle:" + diffSection.sectionId
                onToggleHovered: filterController.cursorIndex = filterController.indexForKey("toggle:" + diffSection.sectionId)
                onToggleRequested: root.toggleSection(diffSection.sectionId)
              }
              Item {
                visible: diffSection.bodyShown
                x: Style.space(16)
                width: parent.width - Style.space(32)
                height: diffSection.overflowing && !diffSection.expanded ? root.diffCollapsedHeight : diffText.implicitHeight
                clip: true
                Text {
                  id: diffText
                  width: parent.width
                  text: root.changeDiffText(diffSection.detail)
                  textFormat: Text.RichText
                  wrapMode: Text.WrapAnywhere
                  color: root.contentForeground
                  font.family: root.contentFontFamily
                  font.pixelSize: Style.font.caption
                }
              }
              Text {
                visible: diffSection.bodyShown && diffSection.overflowing
                x: Style.space(16)
                text: diffSection.expanded ? "Show less" : "Show more"
                color: root.dimColor
                font.family: root.contentFontFamily
                font.pixelSize: Style.font.caption
                font.underline: diffToggle.containsMouse
                MouseArea {
                  id: diffToggle
                  anchors.fill: parent
                  hoverEnabled: true
                  cursorShape: Qt.PointingHandCursor
                  onClicked: root.toggleExpanded(diffSection.expandKey)
                }
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

          Text {
            visible: root.service !== null && root.service.notificationLaunchError !== ""
            width: parent.width
            text: root.service ? root.service.notificationLaunchError : ""
            textFormat: Text.PlainText
            wrapMode: Text.Wrap
            color: root.contentForeground
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.caption
          }

          SectionHeading {
            id: repositoriesHeading
            visible: ["overview", "changed", "other"].indexOf(root.view) >= 0 && (!filterController.filterText || root.filteredRepos.length > 0 || filterController.indexForKey("action:repositories-refresh") >= 0 || filterController.indexForKey("action:pull-changed") >= 0)
            title: "Repositories · " + root.repoSummary(root.filteredRepos)
            foreground: root.contentForeground
            fontFamily: root.contentFontFamily
            refreshable: true
            refreshing: root.service ? root.service.repositoriesBusy : false
            hasCursor: root.cursorKey === "action:repositories-refresh"
            collapsible: root.sectionsCollapsible
            expanded: root.sectionExpanded("repositories")
            toggleHasCursor: root.cursorKey === "toggle:repositories"
            onToggleHovered: filterController.cursorIndex = filterController.indexForKey("toggle:repositories")
            onToggleRequested: root.toggleSection("repositories")
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
            visible: root.sectionExpanded("repositories")
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
            visible: !filterController.filterText && (root.view === "overview" || root.view === "changed" || root.view === "other") && root.sectionExpanded("repositories") && root.filteredRepos.length === 0 && root.service && (root.service.panelError !== "" || !root.service.panelLoaded)
            width: parent.width
            text: root.service && root.service.panelError !== "" ? root.service.panelError : "Loading repositories"
            color: Qt.darker(root.contentForeground, 1.4)
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.body
            horizontalAlignment: Text.AlignHCenter
          }

          Column {
            visible: (root.view === "overview" || root.view === "notifications") && root.sectionExpanded("repositories")
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
            visible: (root.view === "overview" || root.view === "notifications") && (!filterController.filterText || root.filteredThreads.length > 0 || root.filteredFooterActions.length > 0 || filterController.indexForKey("action:notifications-refresh") >= 0 || filterController.indexForKey("action:notifications-dismiss") >= 0)
            title: "Notifications · " + root.threadSummary(root.filteredThreads)
            foreground: root.contentForeground
            fontFamily: root.contentFontFamily
            refreshable: true
            refreshing: root.service ? root.service.notificationsBusy : false
            hasCursor: root.cursorKey === "action:notifications-refresh"
            collapsible: root.sectionsCollapsible
            expanded: root.sectionExpanded("notifications")
            toggleHasCursor: root.cursorKey === "toggle:notifications"
            onToggleHovered: filterController.cursorIndex = filterController.indexForKey("toggle:notifications")
            onToggleRequested: root.toggleSection("notifications")
            onRefreshHovered: filterController.cursorIndex = filterController.indexForKey("action:notifications-refresh")
            onRefreshRequested: root.activateAction("notifications-refresh")
            trailingControl: Component {
              PanelActionButton {
                enabled: root.notificationReviewEnabled
                iconText: "󰄬"
                tooltipText: "Review dependency notifications in Dotfiles"
                foreground: root.contentForeground
                fontFamily: root.contentFontFamily
                hasCursor: root.cursorKey === "action:notifications-dismiss"
                onHovered: function(hovered) { if (hovered) filterController.cursorIndex = filterController.indexForKey("action:notifications-dismiss") }
                onClicked: root.activateAction("notifications-dismiss")
              }
            }
          }

          Column {
            visible: root.sectionExpanded("notifications")
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
                  Text { width: parent.width; text: (modelData.value.bot === true ? "dependency · " : "") + String(modelData.value.reason || "") + " · " + String(modelData.value.type || ""); color: Qt.darker(root.contentForeground, 1.5); font.family: root.contentFontFamily; font.pixelSize: Style.font.caption; elide: Text.ElideRight }
                }
                MouseArea { anchors.fill: parent; hoverEnabled: true; cursorShape: Qt.PointingHandCursor; onEntered: filterController.cursorIndex = filterController.indexForKey(modelData.key); onClicked: function(mouse) { root.activateThread(modelData.value, mouse.modifiers) } }
              }
            }
          }

          Text {
            visible: (root.view === "overview" || root.view === "notifications") && !filterController.filterText && root.sectionExpanded("notifications") && root.threadCount === 0 && root.service && (root.service.notificationsError !== "" || !root.service.notificationsLoaded)
            width: parent.width
            text: root.service && root.service.notificationsError !== "" ? root.service.notificationsError : "Loading notifications"
            color: Qt.darker(root.contentForeground, 1.4)
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.body
            horizontalAlignment: Text.AlignHCenter
          }

          Column {
            visible: (root.view === "overview" || root.view === "notifications") && root.sectionExpanded("notifications") && root.filteredFooterActions.length > 0
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
            title: root.view === "overview" ? "Unreleased changes · " + root.unreleasedSummary(root.filteredReleaseRows)
              : root.view === "releases" ? "Tracked repositories · " + root.filteredReleaseRows.length + " of " + (root.service ? root.service.releases.length : 0)
              : (root.view === "release-commits" ? "Commits" : (root.view === "release" ? "Finding groups" : "Findings")) + " · " + root.filteredReleaseRows.length
            foreground: root.contentForeground
            fontFamily: root.contentFontFamily
            refreshable: root.view === "overview" || root.view === "releases"
            refreshing: root.service ? root.service.releaseRefreshing : false
            hasCursor: root.cursorKey === "action:release-refresh"
            collapsible: root.sectionsCollapsible
            expanded: root.sectionExpanded("releases")
            toggleHasCursor: root.cursorKey === "toggle:releases"
            onToggleHovered: filterController.cursorIndex = filterController.indexForKey("toggle:releases")
            onToggleRequested: root.toggleSection("releases")
            onRefreshHovered: filterController.cursorIndex = filterController.indexForKey("action:release-refresh")
            onRefreshRequested: root.activateAction("release-refresh")
          }

          Text {
            visible: (root.view === "overview" || root.view === "releases") && !filterController.filterText && root.sectionExpanded("releases") && (!root.service || !root.service.releasesLoaded || root.service.releases.length === 0 || root.service.releasesError !== "")
            width: parent.width
            text: root.service && root.service.releasesError ? root.service.releasesError : (root.service && root.service.releasesLoaded ? "No repositories configured for release tracking" : "Loading release comparisons")
            textFormat: Text.PlainText
            wrapMode: Text.WrapAnywhere
            color: Qt.darker(root.contentForeground, 1.4)
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.body
          }

          Column {
            visible: root.sectionExpanded("releases")
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

          Repeater {
            id: releaseFilesRepeater
            model: root.releaseView ? root.changeSections : []
            delegate: filesSectionDelegate
          }

          Repeater {
            id: releaseDiffRepeater
            model: root.releaseView ? root.changeSections : []
            delegate: diffSectionDelegate
          }

          CursorSurface {
            id: allReleasesAction
            readonly property var entry: root.filterRows("release-action")[0] || null
            visible: entry !== null && root.sectionExpanded("releases")
            x: Style.space(8)
            width: Math.max(0, contentColumn.width - Style.space(16))
            implicitHeight: allReleasesRow.implicitHeight + Style.space(12)
            hasCursor: entry !== null && root.cursorKey === entry.key
            foreground: root.contentForeground
            accent: root.contentForeground
            Row {
              id: allReleasesRow
              anchors.left: parent.left
              anchors.right: parent.right
              anchors.verticalCenter: parent.verticalCenter
              anchors.margins: Style.space(8)
              spacing: Style.space(10)
              Text { width: Style.space(22); text: allReleasesAction.entry ? allReleasesAction.entry.icon : ""; color: root.contentForeground; font.family: root.contentFontFamily; font.pixelSize: Style.font.icon; horizontalAlignment: Text.AlignHCenter }
              Text { width: Math.max(0, allReleasesRow.width - Style.space(32)); text: allReleasesAction.entry ? allReleasesAction.entry.primaryText : ""; color: root.contentForeground; font.family: root.contentFontFamily; font.pixelSize: Style.font.body; elide: Text.ElideRight }
            }
            MouseArea {
              anchors.fill: parent
              hoverEnabled: true
              cursorShape: Qt.PointingHandCursor
              onEntered: filterController.cursorIndex = filterController.indexForKey(allReleasesAction.entry.key)
              onClicked: function(mouse) { root.activateEntry(allReleasesAction.entry, mouse.modifiers) }
            }
          }

          PullRequests {
            id: pullRequestsSection
            visible: root.view === "overview" || root.pullRequestView
            width: parent.width
            rows: root.filteredPullRequestRows
            view: root.view
            cursorKey: root.cursorKey
            foreground: root.contentForeground
            fontFamily: root.contentFontFamily
            refreshing: root.service ? root.service.pullRequestsBusy : false
            status: root.pullRequestStatus()
            onHovered: function(key) { filterController.cursorIndex = filterController.indexForKey(key) }
            onActivated: function(entry, modifiers) { root.activateEntry(entry, modifiers) }
            onRefreshRequested: root.activateAction("pulls-refresh")
            sectionsCollapsible: root.sectionsCollapsible
            expanded: ({ pulls: root.sectionExpanded("pulls"), "pulls-empty": root.sectionExpanded("pulls-empty") })
            onToggleRequested: function(id) { root.toggleSection(id) }
            onIgnoreRequested: function(entry) { if (root.service) root.service.ignorePullRequest(root.selectedPullRequests, entry.value) }
          }

          Issues {
            id: issuesSection
            visible: root.view === "overview" || root.issueView
            width: parent.width
            rows: root.filteredIssueRows
            view: root.view
            cursorKey: root.cursorKey
            foreground: root.contentForeground
            fontFamily: root.contentFontFamily
            refreshing: root.service ? root.service.issuesBusy : false
            status: root.issueStatus()
            onHovered: function(key) { filterController.cursorIndex = filterController.indexForKey(key) }
            onActivated: function(entry, modifiers) { root.activateEntry(entry, modifiers) }
            onRefreshRequested: root.activateAction("issues-refresh")
            sectionsCollapsible: root.sectionsCollapsible
            expanded: ({ issues: root.sectionExpanded("issues"), "issues-empty": root.sectionExpanded("issues-empty") })
            onToggleRequested: function(id) { root.toggleSection(id) }
            onAgentRequested: function(entry) { root.showIssueAgentPicker(entry.value) }
            onCopyRequested: function(entry) { if (root.service) root.service.copyIssueLink(entry.value) }
          }

          SectionHeading {
            id: logHeading
            visible: ["overview", "repo", "commits"].indexOf(root.view) >= 0 && (!filterController.filterText || root.filteredLogRows.length > 0 || filterController.indexForKey("action:log-refresh") >= 0)
            title: (root.logRepoMode ? "Commits" : "Recent commits") + " · " + root.logHeadingCount()
            foreground: root.contentForeground
            fontFamily: root.contentFontFamily
            refreshable: true
            refreshing: root.service ? root.service.logBusy : false
            hasCursor: root.cursorKey === "action:log-refresh"
            collapsible: root.sectionsCollapsible
            expanded: root.sectionExpanded("log")
            toggleHasCursor: root.cursorKey === "toggle:log"
            onToggleHovered: filterController.cursorIndex = filterController.indexForKey("toggle:log")
            onToggleRequested: root.toggleSection("log")
            onRefreshHovered: filterController.cursorIndex = filterController.indexForKey("action:log-refresh")
            onRefreshRequested: root.activateAction("log-refresh")
          }

          Text {
            readonly property string status: root.logStatus()
            visible: logHeading.visible && !filterController.filterText && root.sectionExpanded("log") && status !== ""
            width: parent.width
            text: status
            textFormat: Text.PlainText
            wrapMode: Text.WrapAnywhere
            color: Qt.darker(root.contentForeground, 1.4)
            font.family: root.contentFontFamily
            font.pixelSize: Style.font.caption
          }

          Column {
            visible: ["overview", "repo", "commits"].indexOf(root.view) >= 0 && root.sectionExpanded("log")
            width: parent.width
            spacing: Style.space(2)
            Repeater {
              id: logRepeater
              model: root.filteredLogRows
              CursorSurface {
                required property var modelData
                x: Style.space(8)
                width: Math.max(0, contentColumn.width - Style.space(16))
                implicitHeight: logRow.implicitHeight + Style.space(12)
                hasCursor: root.cursorKey === modelData.key
                foreground: root.contentForeground
                accent: root.contentForeground
                Row {
                  id: logRow
                  anchors.left: parent.left
                  anchors.right: parent.right
                  anchors.verticalCenter: parent.verticalCenter
                  anchors.margins: Style.space(8)
                  spacing: Style.space(10)
                  Text { width: Style.space(22); text: modelData.icon; color: root.contentForeground; font.family: root.contentFontFamily; font.pixelSize: Style.font.icon; horizontalAlignment: Text.AlignHCenter }
                  Column {
                    width: Math.max(0, logRow.width - Style.space(32))
                    spacing: Style.space(2)
                    Text { width: parent.width; text: modelData.primaryText; textFormat: Text.PlainText; color: root.contentForeground; font.family: root.contentFontFamily; font.pixelSize: Style.font.body; elide: Text.ElideRight }
                    Text { visible: text !== ""; width: parent.width; text: modelData.secondaryText; textFormat: Text.PlainText; color: Qt.darker(root.contentForeground, 1.4); font.family: root.contentFontFamily; font.pixelSize: Style.font.caption; elide: Text.ElideRight }
                  }
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
