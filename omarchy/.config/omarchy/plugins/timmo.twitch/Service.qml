import QtQuick
import Quickshell
import Quickshell.Io

Item {
  id: root

  property var shell: null
  property bool active: false
  property string statusState: "inactive"
  property int liveCount: 0
  property var channels: []
  property string errorText: ""
  property var actionCommand: []

  readonly property bool refreshing: statusProcess.running
  readonly property var liveChannels: channels.filter(function(channel) { return channel.live === true })
  readonly property var offlineChannels: channels.filter(function(channel) { return channel.live !== true })

  function clearStatus(message) {
    active = false
    statusState = "inactive"
    liveCount = 0
    channels = []
    errorText = message
  }

  function applyStatus(raw) {
    try {
      var payload = JSON.parse(String(raw || "").trim())
      active = payload.active === true
      statusState = ["live", "active", "inactive"].indexOf(payload.state) >= 0
        ? payload.state : (active ? "active" : "inactive")
      liveCount = Math.max(0, Number(payload.liveCount || 0))
      channels = Array.isArray(payload.channels) ? payload.channels : []
      errorText = ""
    } catch (error) {
      clearStatus("Invalid status response")
    }
  }

  function refresh() {
    if (!statusProcess.running) statusProcess.running = true
  }

  function runAction(command) {
    if (actionProcess.running) return
    actionCommand = command
    actionProcess.running = true
  }

  function recheck(openStreams) {
    runAction(openStreams
      ? ["twitch-notifications", "--recheck", "--open"]
      : ["twitch-notifications-recheck"])
  }

  function restart() {
    runAction(["twitch-notifications-restart"])
  }

  function openUrl(url) {
    var launcher = Quickshell.env("OMARCHY_HOST") === "desktop"
      ? "xdg-open" : "omarchy-launch-webapp"
    Quickshell.execDetached([launcher, url])
  }

  function openFollowing() {
    openUrl("https://twitch.tv/directory/following")
  }

  function openFollowingLive() {
    openUrl("https://twitch.tv/directory/following/live")
  }

  function openChannel(channel) {
    if (!channel || !channel.login) return
    var url = "https://twitch.tv/" + encodeURIComponent(String(channel.login))
    if (channel.live !== true) url += "/videos?filter=archives&sort=time"
    openUrl(url)
  }

  Process {
    id: statusProcess
    command: ["twitch-notifications", "--status-json"]
    stdout: StdioCollector {
      id: statusOutput
      waitForEnd: true
    }
    onExited: function(exitCode) {
      if (exitCode === 0) root.applyStatus(statusOutput.text)
      else root.clearStatus("Twitch Notifications is unavailable")
    }
  }

  Process {
    id: actionProcess
    command: root.actionCommand
    stdout: StdioCollector { waitForEnd: true }
    stderr: StdioCollector { waitForEnd: true }
    onExited: refreshDelay.restart()
  }

  Timer {
    interval: 5000
    running: true
    repeat: true
    triggeredOnStart: true
    onTriggered: root.refresh()
  }

  Timer {
    id: refreshDelay
    interval: 1500
    repeat: false
    onTriggered: root.refresh()
  }
}
