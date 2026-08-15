import QtQuick
import Quickshell.Io
import qs.Commons
import qs.Ui

Column {
  id: root

  required property QtObject bar
  required property color foreground
  required property string fontFamily

  property int hourOffset: 0
  property double requestedEpoch: 0
  property double runningEpoch: 0
  property var clockRows: [
    { label: "Pacific", time: "--:--", zone: "---" },
    { label: "Mountain", time: "--:--", zone: "---" },
    { label: "Central", time: "--:--", zone: "---" },
    { label: "Eastern", time: "--:--", zone: "---" },
    { label: "Local", time: "--:--", zone: "---" }
  ]

  spacing: Style.space(10)

  function offsetLabel(value) {
    var hours = Math.round(value)
    if (hours === 0) return "NOW"
    return (hours > 0 ? "+" : "") + hours + (Math.abs(hours) === 1 ? " HOUR" : " HOURS")
  }

  function reset() {
    hourOffset = 0
  }

  function resetToNow() {
    reset()
    refresh(new Date())
  }

  function refresh(now) {
    requestedEpoch = Math.floor(now.getTime() / 1000) + hourOffset * 3600
    if (!timeProcess.running) runRequestedEpoch()
  }

  function runRequestedEpoch() {
    runningEpoch = requestedEpoch
    timeProcess.command = [
      "bash",
      "-c",
      "epoch=$1; for row in 'Pacific America/Los_Angeles' 'Mountain America/Denver' 'Central America/Chicago' 'Eastern America/New_York'; do "
        + "read -r label zone <<<\"$row\"; read -r time abbreviation <<<\"$(TZ=\"$zone\" date -d @\"$epoch\" '+%H:%M %Z')\"; "
        + "printf '%s\\t%s\\t%s\\n' \"$label\" \"$time\" \"$abbreviation\"; done; "
        + "read -r time abbreviation <<<\"$(date -d @\"$epoch\" '+%H:%M %Z')\"; printf 'Local\\t%s\\t%s\\n' \"$time\" \"$abbreviation\"",
      "timmo-clock",
      String(runningEpoch)
    ]
    timeProcess.running = true
  }

  function applyOutput(text) {
    var lines = String(text || "").trim().split("\n")
    if (lines.length !== 5) return

    var next = []
    for (var i = 0; i < lines.length; i++) {
      var fields = lines[i].split("\t")
      if (fields.length !== 3) return
      next.push({ label: fields[0], time: fields[1], zone: fields[2] })
    }
    clockRows = next
  }

  Process {
    id: timeProcess

    stdout: StdioCollector {
      id: timeOutput
      waitForEnd: true
    }

    onExited: function(exitCode) {
      if (exitCode === 0 && root.runningEpoch === root.requestedEpoch)
        root.applyOutput(timeOutput.text)
      if (root.runningEpoch !== root.requestedEpoch) root.runRequestedEpoch()
    }
  }

  Text {
    text: "WORLD CLOCKS"
    color: Qt.darker(root.foreground, 1.5)
    font.family: root.fontFamily
    font.pixelSize: Style.font.caption
    font.letterSpacing: 1
    font.bold: true
  }

  Row {
    width: parent.width

    Repeater {
      model: root.clockRows

      Column {
        required property var modelData

        width: root.width / root.clockRows.length
        spacing: Style.space(2)

        Text {
          width: parent.width
          horizontalAlignment: Text.AlignHCenter
          text: parent.modelData.label.toUpperCase()
          color: Qt.darker(root.foreground, 1.5)
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
          font.letterSpacing: 0.5
        }

        Text {
          width: parent.width
          horizontalAlignment: Text.AlignHCenter
          text: parent.modelData.time
          color: root.foreground
          font.family: root.fontFamily
          font.pixelSize: Style.font.subtitle
          font.bold: true
        }

        Text {
          width: parent.width
          horizontalAlignment: Text.AlignHCenter
          text: parent.modelData.zone
          color: Qt.darker(root.foreground, 1.7)
          font.family: root.fontFamily
          font.pixelSize: Style.font.caption
        }
      }
    }
  }

  Row {
    width: parent.width
    spacing: Style.space(12)

    Text {
      width: Style.space(72)
      anchors.verticalCenter: parent.verticalCenter
      text: "-24H"
      color: Qt.darker(root.foreground, 1.5)
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
    }

    PanelSlider {
      id: offsetSlider

      width: parent.width - Style.space(184)
      anchors.verticalCenter: parent.verticalCenter
      bar: root.bar
      value: root.hourOffset
      minimum: -24
      maximum: 24
      step: 1
      integer: true
      tickCount: 49

      onMoved: function(value) {
        root.hourOffset = Math.round(value)
        root.refresh(new Date())
      }
      onReleased: function(value) {
        root.hourOffset = Math.round(value)
        root.refresh(new Date())
      }
      onRightClicked: root.resetToNow()
    }

    Text {
      width: Style.space(88)
      anchors.verticalCenter: parent.verticalCenter
      horizontalAlignment: Text.AlignRight
      text: root.offsetLabel(offsetSlider.dragging ? offsetSlider.liveValue : root.hourOffset)
      color: root.foreground
      font.family: root.fontFamily
      font.pixelSize: Style.font.caption
      font.bold: true
    }
  }
}
