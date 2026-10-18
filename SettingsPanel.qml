// Ping Wheel settings: the Omarchy shell panel (manifest.json "panel"), opened with
//   omarchy-shell shell toggle io.github.unayung.ping-wheel
// Everything it edits lives on the service (PingWheel.qml), which saves it and applies it at once.
import QtQuick
import QtQuick.Controls
import Quickshell
import qs.Ui
import qs.Commons
import qs.Commons as Commons

Item {
    id: root

    // Host injections.
    property var shell: null
    property var manifest: null
    property var service: null
    readonly property var s: service

    property bool closingFromHost: false
    readonly property bool opened: window.visible
    function open(payloadJson) {
        closingFromHost = false
        window.visible = true
        Qt.callLater(() => body.forceActiveFocus())
    }
    function close() {
        closingFromHost = true
        window.visible = false
        closingFromHost = false
    }

    readonly property color fg: Commons.Color.foreground
    readonly property color bg: Commons.Color.background
    readonly property color accent: Commons.Color.accent
    readonly property color urgent: Commons.Color.urgent
    // PanelSlider takes its colours from a bar object.
    readonly property var bar: QtObject {
        readonly property color foreground: root.fg
        readonly property color background: root.bg
        readonly property color urgent: root.urgent
        readonly property string fontFamily: Style.font.family
    }

    // Every string here may come from another machine (names) or a file: never rich text.
    component Label: Text {
        textFormat: Text.PlainText
        color: root.fg
        font.family: Style.font.family
        font.pixelSize: Style.font.body
        wrapMode: Text.Wrap
    }
    component Header: PanelSectionHeader { foreground: root.fg; width: parent.width }
    component SliderRow: Row {
        id: row
        property string label
        property real value
        property real minimum
        property real maximum
        property real step
        property var format: v => String(v)
        signal released(real value)
        width: parent.width
        spacing: Style.space(10)
        Label { width: 110; text: row.label; anchors.verticalCenter: parent.verticalCenter }
        PanelSlider {
            id: slider
            bar: root.bar
            width: row.width - 110 - 70 - 2 * row.spacing
            anchors.verticalCenter: parent.verticalCenter
            value: row.value; minimum: row.minimum; maximum: row.maximum; step: row.step
            onReleased: v => row.released(v)
        }
        Label { width: 70; text: row.format(slider.dragging ? slider.liveValue : row.value); anchors.verticalCenter: parent.verticalCenter }
    }

    FloatingWindow {
        id: window
        title: "Ping Wheel"
        color: root.bg
        implicitWidth: 560
        implicitHeight: 720
        minimumSize: Qt.size(460, 480)
        onVisibleChanged: if (!visible && !root.closingFromHost && root.shell) root.shell.hide(root.manifest.id)

        ScrollView {
            anchors.fill: parent
            anchors.margins: Style.space(20)
            contentWidth: availableWidth

            Column {
                id: body
                width: parent.width
                spacing: Style.space(12)
                focus: true
                Keys.onEscapePressed: window.visible = false

                // ---- Room ------------------------------------------------------------------------
                Header { text: "Room" }
                Label {
                    width: parent.width
                    visible: !root.s.nodeReady
                    color: root.urgent
                    text: "Rooms need Node.js: omarchy pkg add nodejs"
                }
                Label {
                    width: parent.width
                    opacity: 0.7
                    text: "Ping with friends on lolPing for Windows and Mac: they see your pings at the same spot, with your name."
                }

                Row {
                    spacing: Style.space(10)
                    Label { width: 110; text: "Name"; anchors.verticalCenter: parent.verticalCenter }
                    TextField {
                        id: nameField
                        width: 220
                        text: root.s.roomName
                        maximumLength: 16   // upstream MAX_NAME
                        foreground: root.fg; accent: root.accent
                        font.family: Style.font.family; font.pixelSize: Style.font.body
                        onEditingFinished: if (text.trim() && text.trim() !== root.s.roomName)
                            root.s.setRoom(root.s.roomCode, text.trim(), root.s.roomColor)
                    }
                }
                Row {
                    spacing: Style.space(10)
                    Label { width: 110; text: "Tag colour"; anchors.verticalCenter: parent.verticalCenter }
                    Repeater {
                        model: root.s.tagColors
                        Rectangle {
                            required property int index
                            required property string modelData
                            width: 26; height: 26; radius: 13
                            color: modelData
                            border.width: index === root.s.roomColor ? 3 : 0
                            border.color: root.fg
                            MouseArea {
                                anchors.fill: parent
                                cursorShape: Qt.PointingHandCursor
                                onClicked: root.s.setRoom(root.s.roomCode, root.s.roomName, parent.index)
                            }
                        }
                    }
                }

                // Out of a room: join or create.
                Row {
                    visible: !root.s.roomCode
                    spacing: Style.space(10)
                    TextField {
                        id: codeField
                        width: 220
                        placeholderText: "PING-XXXXX-XXXXX"
                        foreground: root.fg; accent: root.accent
                        font.family: Style.font.family; font.pixelSize: Style.font.body
                        onAccepted: joinButton.clicked()
                    }
                    Button {
                        id: joinButton
                        text: "Join"
                        bordered: true
                        onClicked: if (codeField.text.trim()) root.s.setRoom(codeField.text.trim().toUpperCase(), root.s.roomName, root.s.roomColor)
                    }
                    Button {
                        text: "Create room"
                        bordered: true
                        onClicked: root.s.createRoom(root.s.roomName, root.s.roomColor)
                    }
                }

                // In a room: the code, who is here, and the way out.
                Row {
                    visible: !!root.s.roomCode
                    spacing: Style.space(10)
                    Label {
                        text: root.s.roomCode
                        font.pixelSize: Style.font.body * 1.4
                        font.weight: Font.DemiBold
                        anchors.verticalCenter: parent.verticalCenter
                    }
                    Button { text: "Copy"; bordered: true; onClicked: root.s.copy(root.s.roomCode) }
                    Button { text: "Leave"; bordered: true; onClicked: root.s.setRoom("", root.s.roomName, root.s.roomColor) }
                }
                Label {
                    visible: !!root.s.roomCode
                    opacity: 0.7
                    text: "Local network: " + root.s.roomStatus.lan + "    Internet: " + root.s.roomStatus.internet
                }
                Label {
                    visible: !!root.s.roomCode && root.s.members.length === 0
                    opacity: 0.7
                    text: "Nobody else here yet. Send the code to your friends."
                }
                Repeater {
                    model: root.s.members
                    Row {
                        required property var modelData
                        spacing: Style.space(8)
                        Rectangle {
                            width: 12; height: 12; radius: 6
                            color: root.s.tagColors[modelData.color] || root.s.tagColors[0]
                            anchors.verticalCenter: parent.verticalCenter
                        }
                        Label { text: modelData.name }
                        Label { text: modelData.via === "lan" ? "local network" : "internet"; opacity: 0.6 }
                    }
                }
                Label {
                    width: parent.width
                    visible: root.s.roomError !== ""
                    color: root.urgent
                    text: root.s.roomError
                }

                PanelSeparator { width: parent.width }

                // ---- Pings and sound -------------------------------------------------------------
                Header { text: "Pings and sound" }
                SliderRow {
                    label: "Volume"
                    value: root.s.settings.volume; minimum: 0; maximum: 1; step: 0.05
                    format: v => Math.round(v * 100) + "%"
                    onReleased: v => { root.s.settings.volume = v; root.s.play("button", v) }
                }
                SliderRow {
                    label: "Ping size"
                    value: root.s.settings.pingSize; minimum: 60; maximum: 220; step: 10
                    format: v => Math.round(v) + " px"
                    onReleased: v => root.s.settings.pingSize = Math.round(v)
                }
                SliderRow {
                    label: "Duration"
                    value: root.s.settings.pingDur; minimum: 1; maximum: 8; step: 0.2
                    format: v => v.toFixed(1) + " s"
                    onReleased: v => root.s.settings.pingDur = Math.round(v * 10) / 10
                }

                PanelSeparator { width: parent.width }

                // ---- Asset pack ------------------------------------------------------------------
                Header { text: "Asset pack" }
                ButtonGroup {
                    options: ["Ping Wheel", "League of Legends"]
                    value: root.s.pack === root.s.packs.official ? "League of Legends" : "Ping Wheel"
                    onChanged: v => {
                        if (v === "Ping Wheel") root.s.setPack("custom")
                        else if (root.s.officialReady) root.s.setPack("official")
                    }
                }
                Label {
                    width: parent.width
                    visible: !root.s.officialReady
                    opacity: 0.7
                    text: "The League of Legends art and sounds belong to Riot Games and are not part of this plugin. "
                        + "Download fetches them to your computer from darrenprx/lolPing; Riot's fan content policy covers free, non-commercial use."
                }
                Button {
                    visible: !root.s.officialReady
                    text: root.s.fetching ? "Downloading…" : "Download the League pack"
                    iconSpinning: root.s.fetching
                    bordered: true
                    onClicked: if (!root.s.fetching) root.s.fetchOfficial()
                }
            }
        }
    }
}
