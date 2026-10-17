// Ping Wheel: an Omarchy shell service plugin (manifest.json), also runnable on its own via shell.qml.
// Hold the bound key (ALT + left mouse, see README), drag, let go on a slice.
import QtQuick
import Quickshell
import Quickshell.Io
import Quickshell.Wayland
import Quickshell.Hyprland
import "wheel.js" as G

Item {
    id: root

    // ponytail: constants instead of upstream's settings window; edit here.
    readonly property real volume: 0.7
    readonly property real pingSize: 110
    readonly property real pingDur: 3.2

    // The wheel, top then clockwise. Texture and sound share the id (assets/textures, assets/sounds).
    readonly property var pings: [
        { id: "danger", color: "#ff3b55" },
        { id: "push", color: "#35d27a" },
        { id: "omw", color: "#2e8bff" },
        { id: "allin", color: "#f2b320" },
        { id: "assist", color: "#56d43c" },
        { id: "needvision", color: "#56d43c" },
        { id: "missing", color: "#f2c518" },
        { id: "enemyvision", color: "#ff3b55" }
    ]


    // ponytail: one pw-play per sound; preloaded SoundEffects if the ~30 ms spawn latency ever shows.
    function play(name, vol) {
        const path = Qt.resolvedUrl("assets/sounds/" + name + ".wav").toString().replace("file://", "")
        Quickshell.execDetached(["pw-play", "--volume", String(vol), path])
    }

    property bool held: false   // the bound button is down
    property bool open: false   // the wheel is showing
    property real ox: 0; property real oy: 0   // press point, global layout coords
    property real cx: 0; property real cy: 0   // latest cursor point
    readonly property int hot: open ? G.pickSlice(cx - ox, cy - oy, G.WHEEL.innerR) : -1
    onHotChanged: if (hot >= 0) play("button", volume * 0.5)

    Process {
        id: cursor
        property var then: null
        command: ["hyprctl", "cursorpos", "-j"]
        stdout: StdioCollector {
            onStreamFinished: { const p = JSON.parse(text); cursor.then(p.x, p.y) }
        }
    }
    function withCursor(f) { cursor.then = f; cursor.running = true }

    GlobalShortcut {
        appid: "pingwheel"
        name: "wheel"
        description: "Hold and drag for the ping wheel"
        onPressed: {
            root.held = true
            root.withCursor((x, y) => {
                if (!root.held) return   // released before hyprctl answered: a plain click, no wheel
                root.ox = root.cx = x
                root.oy = root.cy = y
                root.open = true
            })
        }
        onReleased: root.release()
    }

    // Hyprland drops the bind's release when ALT comes up first, so the overlay also commits on
    // ALT up or a left-button up; otherwise the wheel would keep the keyboard grabbed.
    function release() {
        held = false
        if (open) withCursor((x, y) => { cx = x; cy = y; commit() })
    }

    // Upstream default: letting go in the dead zone cancels.
    function commit() {
        if (!open) return
        const i = hot
        open = false
        if (i < 0) return
        play(pings[i].id, volume)
        for (const w of screens.instances) w.spawn(pings[i], ox, oy)
    }

    Component { id: pingFx; Ping {} }

    Variants {
        id: screens
        model: Quickshell.screens

        // ponytail: always mapped, click-through until the wheel opens, so pressing never waits on a new surface.
        PanelWindow {
            id: win
            required property var modelData
            screen: modelData
            anchors { top: true; bottom: true; left: true; right: true }
            exclusionMode: ExclusionMode.Ignore
            color: "transparent"
            WlrLayershell.layer: WlrLayer.Overlay
            WlrLayershell.namespace: "pingwheel"
            WlrLayershell.keyboardFocus: root.open ? WlrKeyboardFocus.Exclusive : WlrKeyboardFocus.None
            mask: root.open ? null : passThrough
            Region { id: passThrough }

            function spawn(def, gx, gy) {
                const x = gx - modelData.x, y = gy - modelData.y
                if (x >= 0 && y >= 0 && x < width && y < height)
                    pingFx.createObject(win.contentItem, { def: def, x: x, y: y, s: root.pingSize, dur: root.pingDur * 1000 })
            }

            MouseArea {
                anchors.fill: parent
                hoverEnabled: true
                acceptedButtons: Qt.AllButtons
                onPositionChanged: m => { root.cx = m.x + win.modelData.x; root.cy = m.y + win.modelData.y }
                onPressed: m => { if (m.button === Qt.RightButton) root.open = false }
                onReleased: m => { if (m.button === Qt.LeftButton) root.release() }
            }
            Item {
                focus: root.open
                Keys.onEscapePressed: root.open = false
                Keys.onReleased: e => { if (e.key === Qt.Key_Alt) root.release() }
            }

            Wheel {
                x: root.ox - win.modelData.x - width / 2
                y: root.oy - win.modelData.y - height / 2
                shown: root.open
                pings: root.pings
                hot: root.hot
            }
        }
    }
}
