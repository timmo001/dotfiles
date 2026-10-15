// The Plannotator Inbox in its own Qt WebEngine window, run by
// `dot plannotator inbox` through the qml runtime. Arguments after `--` are
// the Inbox base URL, a command file and a notification file. dot writes
// {"thread", "at"} to the command file to open a thread in this window, since
// nothing outside a browser can navigate one of its windows. The window writes
// the Inbox's notifications to the notification file, since the qml runtime
// can't show them, and the timmo.plannotator-inbox bar service shows them.
import QtQuick
import QtQuick.Controls
import QtQuick.Layouts
import QtQuick.Window
import QtWebEngine

Window {
  id: root

  readonly property var args: Qt.application.arguments
  readonly property string baseUrl: args[args.length - 3]
  readonly property string commandFile: args[args.length - 2]
  readonly property string notificationFile: args[args.length - 1]
  property string lastCommand: ""

  width: 1100
  height: 800
  visible: true
  title: "Plannotator Inbox"

  function applyCommand() {
    var request = new XMLHttpRequest()
    request.open("GET", "file://" + root.commandFile, false)
    request.send()

    var text = request.responseText
    if (!text || text === root.lastCommand) return
    root.lastCommand = text

    try {
      var thread = JSON.parse(text).thread
      if (typeof thread === "string" && /^[A-Za-z0-9_-]+$/.test(thread))
        view.url = root.baseUrl + "#thread=" + thread
    } catch (error) {
      console.warn("Ignoring unreadable command: " + error)
    }
  }

  // Origins compared without a trailing slash, which a URL's origin lacks.
  function sameOrigin(url) {
    return String(url).replace(/\/+$/, "") === root.baseUrl.replace(/\/+$/, "")
  }

  // Hands one of the Inbox's notifications to the bar service through the
  // notification file. Plannotator decides what notifies and when.
  function forwardNotification(notification) {
    if (!sameOrigin(notification.origin)) return
    notification.show()

    var request = new XMLHttpRequest()
    request.open("PUT", "file://" + root.notificationFile)
    request.send(JSON.stringify({
      title: String(notification.title),
      message: String(notification.message),
      at: Date.now()
    }))
  }

  // A prototype, because a profile only keeps cookies and local storage (the
  // Inbox's settings and layout) on disk when its storage is set before it is
  // created.
  WebEngineProfilePrototype {
    id: inboxProfile

    storageName: "plannotator-inbox"
    persistentCookiesPolicy: WebEngineProfile.ForcePersistentCookies
  }

  // Set here rather than bound: a `profile: inboxProfile.instance()` binding is
  // read before the prototype is ready, which leaves the view on the default
  // off-the-record profile. The URL and the command poll wait for the profile.
  Component.onCompleted: {
    var profile = inboxProfile.instance()
    profile.presentNotification.connect(root.forwardNotification)
    view.profile = profile
    view.url = root.baseUrl
    commandPoll.start()
  }

  WebEngineView {
    id: view

    anchors.fill: parent

    // The Inbox's "Turn on" for desktop notices, granted only to its own
    // origin. Other requests are left unanswered, as before.
    onPermissionRequested: (permission) => {
      if (permission.permissionType === WebEnginePermission.PermissionType.Notifications
          && root.sameOrigin(permission.origin))
        permission.grant()
    }

    // Links that want a new window, such as review pages, open in the browser.
    // Only web links: agents write the messages, and xdg-open would run any
    // other scheme's handler outside the web sandbox.
    onNewWindowRequested: (request) => {
      var url = String(request.requestedUrl)
      if (/^https?:\/\//i.test(url)) Qt.openUrlExternally(url)
      else console.warn("Not opening a non-web link: " + url)
    }

    // Passkeys on a security key, such as a YubiKey. Qt WebEngine leaves the
    // prompts to the app; passkeys in password managers or on phones aren't
    // available to it.
    onWebAuthUxRequested: (request) => {
      root.authRequest = request
      pinField.text = ""
      authDialog.open()
    }
  }

  property var authRequest: null
  readonly property int authState: root.authRequest
    ? root.authRequest.state
    : WebEngineWebAuthUxRequest.WebAuthUxState.NotStarted

  Connections {
    target: root.authRequest

    function onStateChanged(state) {
      if (state === WebEngineWebAuthUxRequest.WebAuthUxState.Completed
          || state === WebEngineWebAuthUxRequest.WebAuthUxState.Cancelled) {
        authDialog.close()
        root.authRequest = null
      } else if (state === WebEngineWebAuthUxRequest.WebAuthUxState.CollectPin) {
        pinField.text = ""
        pinField.forceActiveFocus()
      }
    }
  }

  function authMessage() {
    var request = root.authRequest
    if (!request) return ""

    switch (root.authState) {
    case WebEngineWebAuthUxRequest.WebAuthUxState.SelectAccount:
      return "Choose the account to sign in with."
    case WebEngineWebAuthUxRequest.WebAuthUxState.CollectPin:
      var pin = request.pinRequest
      var wrong = pin.error === WebEngineWebAuthUxRequest.PinEntryError.WrongPin
        ? "Wrong PIN. " : ""
      return wrong + "Enter your security key's PIN (" + pin.remainingAttempts + " attempts left)."
    case WebEngineWebAuthUxRequest.WebAuthUxState.FinishTokenCollection:
      return "Touch your security key."
    case WebEngineWebAuthUxRequest.WebAuthUxState.RequestFailed:
      return failureMessage(request.requestFailureReason)
    default:
      return "Insert your security key."
    }
  }

  function failureMessage(reason) {
    switch (reason) {
    case WebEngineWebAuthUxRequest.RequestFailureReason.Timeout:
      return "The security key timed out."
    case WebEngineWebAuthUxRequest.RequestFailureReason.KeyNotRegistered:
      return "This security key isn't registered for this site."
    case WebEngineWebAuthUxRequest.RequestFailureReason.KeyAlreadyRegistered:
      return "This security key is already registered."
    case WebEngineWebAuthUxRequest.RequestFailureReason.SoftPinBlock:
      return "Too many wrong PINs. Remove and reinsert the key, then try again."
    case WebEngineWebAuthUxRequest.RequestFailureReason.HardPinBlock:
      return "The key's PIN is locked and has to be reset."
    default:
      return "The security key couldn't be used."
    }
  }

  function submitAuth() {
    var request = root.authRequest
    if (!request) return

    if (root.authState === WebEngineWebAuthUxRequest.WebAuthUxState.SelectAccount)
      request.setSelectedAccount(accountBox.currentText)
    else if (root.authState === WebEngineWebAuthUxRequest.WebAuthUxState.CollectPin)
      request.setPin(pinField.text)
    else if (root.authState === WebEngineWebAuthUxRequest.WebAuthUxState.RequestFailed)
      request.retry()
  }

  Dialog {
    id: authDialog

    anchors.centerIn: parent
    width: Math.min(420, root.width - 40)
    modal: true
    closePolicy: Popup.NoAutoClose
    title: "Passkey" + (root.authRequest ? " for " + root.authRequest.relyingPartyId : "")

    ColumnLayout {
      anchors.fill: parent
      spacing: 12

      Label {
        Layout.fillWidth: true
        wrapMode: Text.WordWrap
        text: root.authMessage()
      }

      ComboBox {
        id: accountBox

        Layout.fillWidth: true
        visible: root.authState === WebEngineWebAuthUxRequest.WebAuthUxState.SelectAccount
        model: root.authRequest ? root.authRequest.userNames : []
      }

      TextField {
        id: pinField

        Layout.fillWidth: true
        visible: root.authState === WebEngineWebAuthUxRequest.WebAuthUxState.CollectPin
        echoMode: TextInput.Password
        placeholderText: "PIN"
        onAccepted: root.submitAuth()
      }
    }

    footer: DialogButtonBox {
      Button {
        text: root.authState === WebEngineWebAuthUxRequest.WebAuthUxState.RequestFailed
          ? "Try again" : "Continue"
        visible: root.authState === WebEngineWebAuthUxRequest.WebAuthUxState.SelectAccount
          || root.authState === WebEngineWebAuthUxRequest.WebAuthUxState.CollectPin
          || root.authState === WebEngineWebAuthUxRequest.WebAuthUxState.RequestFailed
        DialogButtonBox.buttonRole: DialogButtonBox.AcceptRole
      }

      Button {
        text: "Cancel"
        DialogButtonBox.buttonRole: DialogButtonBox.RejectRole
      }

      onAccepted: root.submitAuth()
      onRejected: {
        if (root.authRequest) root.authRequest.cancel()
        authDialog.close()
      }
    }
  }

  Timer {
    id: commandPoll

    interval: 250
    repeat: true
    triggeredOnStart: true
    onTriggered: root.applyCommand()
  }
}
