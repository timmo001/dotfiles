import QtQuick
import QtQuick.Controls
import Quickshell
import Quickshell.Io
import qs.Commons
import qs.Ui
import "../../components"

Panel {
  id: root
  moduleName: "timmo.notes-capture"

  property var anchorItem: null
  property var hostWidget: null
  readonly property var barIdentity: hostWidget || root
  readonly property color foreground: bar ? bar.foreground : Color.foreground
  readonly property string fontFamily: bar ? bar.fontFamily : Style.font.family
  property var repositories: []
  property string repositorySearch: ""
  property string selectedRepository: ""
  property bool available: false
  property bool submitting: false
  property string statusText: ""
  property var activeSubmission: null
  property var pendingSubmissions: []
  property int resetGeneration: 0
  readonly property string cacheRoot: Quickshell.env("XDG_CACHE_HOME")
    || (Quickshell.env("HOME") + "/.cache")
  readonly property string draftPath: cacheRoot + "/dot/notes-capture-draft.txt"
  readonly property string failedDraftPath: cacheRoot + "/dot/notes-capture-failed-draft.txt"
  readonly property var filteredRepositories: {
    var query = repositorySearch.trim().toLowerCase()
    if (query === "") return repositories
    return repositories.filter(function(option) {
      return (String(option.label) + " " + String(option.repository))
        .toLowerCase().indexOf(query) !== -1
    })
  }
  readonly property bool canSubmit: available
    && noteInput.text.trim().length > 0 && noteInput.text.trim().length <= 12000

  function open() {
    controller.show()
    refreshStatus()
    Qt.callLater(function() {
      panelFlick.contentY = 0
      noteInput.forceActiveFocus()
    })
  }
  function close() { controller.hide() }
  function toggle() { if (opened) close(); else open() }
  function switchPanel(direction) {
    if (bar && typeof bar.switchPanelFrom === "function")
      return bar.switchPanelFrom(barIdentity, direction)
    return false
  }
  function refreshStatus() {
    if (!statusProcess.running) statusProcess.running = true
  }
  function focusRepository(index) {
    var item = index < 0 ? automaticButton : repositoryRepeater.itemAt(index)
    if (item) item.forceActiveFocus()
  }
  function resetForm() {
    resetGeneration++
    draftSaveTimer.stop()
    noteInput.text = ""
    draftFile.setText("")
    failedDraftFile.setText("")
    pendingSubmissions = []
    repositorySearch = ""
    selectedRepository = ""
    statusText = ""
    panelFlick.contentY = 0
    noteInput.forceActiveFocus()
  }
  function updateQueueStatus() {
    if (submitting) {
      statusText = pendingSubmissions.length > 0
        ? "Capturing 1 note · " + pendingSubmissions.length + " queued"
        : "Capturing 1 note in background"
    } else if (pendingSubmissions.length > 0) {
      statusText = pendingSubmissions.length + " queued"
    }
  }
  function submit() {
    if (!canSubmit) return
    draftSaveTimer.stop()
    var submission = {
      text: noteInput.text,
      repository: selectedRepository,
      generation: resetGeneration
    }
    noteInput.text = ""
    draftFile.setText("")
    pendingSubmissions = pendingSubmissions.concat([submission])
    startNextSubmission()
    updateQueueStatus()
    noteInput.forceActiveFocus()
  }
  function startNextSubmission() {
    if (submitting || pendingSubmissions.length === 0) return
    activeSubmission = pendingSubmissions[0]
    pendingSubmissions = pendingSubmissions.slice(1)
    var command = ["notes-capture-local", "--stdin", "--json"]
    if (activeSubmission.repository !== "")
      command.push("--repository", activeSubmission.repository)
    submitting = true
    updateQueueStatus()
    submitProcess.stdinEnabled = true
    submitProcess.command = command
    submitProcess.running = true
  }
  function parseRepositories(raw) {
    try {
      var value = JSON.parse(String(raw || ""))
      repositories = Array.isArray(value) ? value : []
    } catch (error) {
      repositories = []
    }
  }
  function applySubmission(exitCode, raw) {
    submitting = false
    var showResult = activeSubmission && activeSubmission.generation === resetGeneration
    if (exitCode !== 0) {
      if (showResult) {
        failedDraftFile.setText(activeSubmission.text)
        statusText = "Capture failed · draft saved"
        failureNotification.running = true
      }
      refreshStatus()
    } else {
      try {
        var result = JSON.parse(String(raw || "").trim())
        if (result.status !== "success") throw new Error("Invalid result")
        if (showResult) statusText = String(result.summary || "Note captured")
      } catch (error) {
        if (showResult) {
          failedDraftFile.setText(activeSubmission.text)
          statusText = "Capture failed · draft saved"
          failureNotification.running = true
        }
      }
    }
    activeSubmission = null
    startNextSubmission()
  }

  FileView {
    path: root.cacheRoot + "/dot/notes-capture-repositories.json"
    watchChanges: true
    printErrors: false
    onLoaded: root.parseRepositories(text())
    onFileChanged: reload()
  }

  FileView {
    id: draftFile
    path: root.draftPath
    printErrors: false
    onLoaded: {
      if (noteInput.text === "") noteInput.text = text()
    }
  }

  FileView {
    id: failedDraftFile
    path: root.failedDraftPath
    printErrors: false
  }

  Timer {
    id: draftSaveTimer
    interval: 250
    onTriggered: draftFile.setText(noteInput.text)
  }

  Process {
    id: statusProcess
    command: ["notes-capture-local", "--status", "--json"]
    stdout: StdioCollector { id: statusOutput; waitForEnd: true }
    onExited: function(exitCode) {
      root.available = exitCode === 0
      if (!root.available)
        root.statusText = "Local processor unavailable. Start notes-capture-opencode.service to send."
      else if (root.statusText.indexOf("unavailable") !== -1)
        root.statusText = ""
    }
  }

  Process {
    id: submitProcess
    property bool startedSuccessfully: false
    stdinEnabled: true
    stdout: StdioCollector { id: submitOutput; waitForEnd: true }
    onStarted: {
      startedSuccessfully = true
      write(root.activeSubmission.text)
      stdinEnabled = false
    }
    onExited: function(exitCode) {
      startedSuccessfully = false
      root.applySubmission(exitCode, submitOutput.text)
    }
    onRunningChanged: {
      if (root.submitting && !running && !startedSuccessfully) {
        root.submitting = false
        if (root.activeSubmission && root.activeSubmission.generation === root.resetGeneration) {
          failedDraftFile.setText(root.activeSubmission.text)
          root.statusText = "Capture failed · draft saved"
          failureNotification.running = true
        }
        root.refreshStatus()
        root.activeSubmission = null
        root.startNextSubmission()
      }
    }
  }

  Process {
    id: failureNotification
    command: [
      "omarchy", "notification", "send",
      "-g", "󰠮", "-u", "critical", "--app-name", "Notes Capture",
      "Note capture failed", "Draft saved to ~/.cache/dot/notes-capture-failed-draft.txt"
    ]
  }

  Timer {
    interval: 15000
    running: root.opened
    repeat: true
    triggeredOnStart: true
    onTriggered: root.refreshStatus()
  }

  KeyboardPanel {
    id: panel
    anchorItem: root.anchorItem
    owner: root.barIdentity
    bar: root.bar
    open: root.opened
    focusTarget: noteInput
    contentWidth: panel.fittedContentWidth(Style.space(520))
    contentHeight: panel.fittedContentHeight(contentColumn.implicitHeight, Style.space(640))

    Flickable {
      id: panelFlick
      anchors.fill: parent
      contentWidth: width
      contentHeight: contentColumn.implicitHeight
      clip: true
      boundsBehavior: Flickable.StopAtBounds
      ScrollBar.vertical: ScrollBar { policy: ScrollBar.AsNeeded }

      Column {
        id: contentColumn
        width: parent.width
        spacing: Style.space(10)

        PanelHero {
          width: parent.width
          title: "Capture note"
          foreground: root.foreground
          fontFamily: root.fontFamily
          iconComponent: Component {
            Text {
              text: "󰠮"
              color: root.foreground
              font.family: root.fontFamily
              font.pixelSize: Style.font.display
            }
          }
          trailingControl: Component {
            Button {
              text: "Clear"
              foreground: root.foreground
              fontFamily: root.fontFamily
              focusable: true
              onClicked: root.resetForm()
            }
          }
        }

        ScrollView {
          width: parent.width
          height: Style.space(180)
          clip: true

          TextArea {
            id: noteInput
            placeholderText: "What should be investigated or remembered?"
            placeholderTextColor: Qt.darker(root.foreground, 1.5)
            color: root.foreground
            font.family: root.fontFamily
            font.pixelSize: Style.font.body
            wrapMode: TextEdit.Wrap
            selectByMouse: true
            onTextChanged: draftSaveTimer.restart()
            background: Rectangle {
              color: Qt.rgba(root.foreground.r, root.foreground.g, root.foreground.b, 0.04)
              border.color: noteInput.activeFocus ? Color.accent : Qt.darker(root.foreground, 1.6)
              border.width: 1
              radius: Style.cornerRadius
            }
            Keys.onPressed: function(event) {
              if ((event.modifiers & Qt.ControlModifier)
                  && (event.key === Qt.Key_Return || event.key === Qt.Key_Enter)) {
                root.submit()
                event.accepted = true
              } else if (event.key === Qt.Key_Escape) {
                root.close()
                event.accepted = true
              } else if (event.key === Qt.Key_Tab || event.key === Qt.Key_Backtab) {
                sendButton.forceActiveFocus()
                event.accepted = true
              }
            }
          }
        }

        Column {
          width: parent.width
          spacing: Style.space(8)

          Button {
            id: sendButton
            width: parent.width
            text: "Send"
            enabled: root.canSubmit
            foreground: root.foreground
            fontFamily: root.fontFamily
            bordered: true
            focusable: true
            onClicked: root.submit()
            Keys.onDownPressed: repositoryFilter.forceActiveFocus()
          }

          Text {
            visible: root.statusText !== ""
            width: parent.width
            text: root.statusText
            color: root.available ? root.foreground : Color.urgent
            font.family: root.fontFamily
            font.pixelSize: Style.font.caption
            wrapMode: Text.Wrap
          }
        }

        PanelSeparator { foreground: root.foreground }

        TextField {
          id: repositoryFilter
          width: parent.width
          placeholderText: "Search target repositories"
          placeholderTextColor: Qt.darker(root.foreground, 1.5)
          color: root.foreground
          font.family: root.fontFamily
          text: root.repositorySearch
          onTextChanged: root.repositorySearch = text
          Keys.onPressed: function(event) {
            if (event.key === Qt.Key_Tab || event.key === Qt.Key_Backtab
                || event.key === Qt.Key_Down) {
              root.focusRepository(-1)
              event.accepted = true
            } else if (event.key === Qt.Key_Up) {
              sendButton.forceActiveFocus()
              event.accepted = true
            }
          }
          background: Rectangle {
            color: "transparent"
            border.color: repositoryFilter.activeFocus ? Color.accent : Qt.darker(root.foreground, 1.6)
            border.width: 1
            radius: Style.cornerRadius
          }
        }

        Button {
          id: automaticButton
          width: parent.width
          text: root.selectedRepository === "" ? "Automatic" : "Automatic (clear selection)"
          foreground: root.foreground
          fontFamily: root.fontFamily
          focusable: true
          onClicked: root.selectedRepository = ""
          Keys.onUpPressed: repositoryFilter.forceActiveFocus()
          Keys.onDownPressed: root.focusRepository(0)
        }

        Repeater {
          id: repositoryRepeater
          model: root.filteredRepositories

          Button {
            required property int index
            required property var modelData
            width: contentColumn.width
            text: (root.selectedRepository === modelData.repository ? "✓ " : "")
              + modelData.label + "  ·  " + modelData.repository
            foreground: root.foreground
            fontFamily: root.fontFamily
            focusable: true
            onClicked: root.selectedRepository = String(modelData.repository)
            Keys.onUpPressed: root.focusRepository(index - 1)
            Keys.onDownPressed: root.focusRepository(index + 1)
          }
        }

      }
    }
  }
}
