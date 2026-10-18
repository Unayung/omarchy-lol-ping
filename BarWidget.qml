// Ping Wheel in the bar: left click opens the settings, right click pauses. In a room it shows how
// many friends are there. State lives on the service; every bar's copy reads the same one.
import QtQuick
import Quickshell
import qs.Commons
import qs.Ui

BarWidget {
    id: root
    moduleName: "io.github.unayung.ping-wheel"

    readonly property var svc: bar && bar.shell ? bar.shell.serviceFor(moduleName) : null
    readonly property bool inRoom: !!svc && svc.roomCode !== ""
    readonly property int friends: svc ? svc.members.length : 0

    implicitWidth: button.implicitWidth
    implicitHeight: button.implicitHeight

    WidgetButton {
        id: button
        anchors.fill: parent
        bar: root.bar
        text: root.inRoom ? "󰓾 " + root.friends : "󰓾"
        dimmed: !!root.svc && root.svc.paused
        fontSize: Style.font.bodySmall
        horizontalMargin: 3.5
        // Only our own words and the room code: friends' names never reach a tooltip.
        tooltipText: !root.svc ? "" : "Ping Wheel" + (root.svc.paused ? " (paused)" : "") + " · "
            + (root.inRoom ? root.svc.roomCode + " · " + root.friends + (root.friends === 1 ? " friend" : " friends") : "Not in a room")
        onPressed: b => {
            if (!root.svc) return
            if (b === Qt.RightButton) root.svc.paused = !root.svc.paused
            else root.bar.shell.toggle(root.moduleName)
        }
    }
}
