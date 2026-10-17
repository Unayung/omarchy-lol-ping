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

    // Asset packs, each slot top then clockwise. "custom" ships in assets/; "official" is the League
    // art and sound a user fetches with tools/fetch-official.sh. tools/pack.sh picks one, live.
    readonly property string officialDir: (Quickshell.env("XDG_DATA_HOME") || Quickshell.env("HOME") + "/.local/share") + "/ping-wheel/official"
    readonly property var packs: ({
        custom: {
            dir: Qt.resolvedUrl("assets").toString(),
            hub: "generic",
            pings: [["danger", "#ff3b55"], ["push", "#35d27a"], ["omw", "#2e8bff"], ["allin", "#f2b320"],
                    ["assist", "#56d43c"], ["needvision", "#56d43c"], ["missing", "#f2c518"], ["enemyvision", "#ff3b55"]]
                .map(([id, color]) => ({ icon: id, art: [id], sound: id, color: color }))
        },
        official: {   // upstream src/shared/pings.ts
            dir: "file://" + officialDir,
            hub: "generic_ping",
            pings: [
                { icon: "pingwheel_retreatrender", art: ["pingwheel_retreatrender"], sound: "SRP_12", color: "#ff3b55" },
                { icon: "push", art: ["pingwheel_pushrender"], sound: "SRP_9", color: "#35d27a" },
                { icon: "omw", art: ["omw"], sound: "OnMyWay", color: "#2e8bff" },
                { icon: "all_in", art: ["pingwheel_allin_render_01", "pingwheel_allin_render_02"], sound: "SRP_4", color: "#f2b320" },
                { icon: "assist_me", art: ["assist_me"], sound: "ComeHere", color: "#56d43c" },
                { icon: "need_vision", art: ["need_vision"], sound: "SRP_7", color: "#56d43c" },
                { icon: "enemy_missing", art: ["enemy_missing"], sound: "MIA", color: "#f2c518" },
                { icon: "pingwheel_enemyvisionrender", art: ["pingwheel_enemyvisionrender"], sound: "AreaIsWarded", color: "#ff3b55" }
            ]
        }
    })

    FileView {
        id: packFile
        path: (Quickshell.env("XDG_STATE_HOME") || Quickshell.env("HOME") + "/.local/state") + "/ping-wheel/pack"
        watchChanges: true
        printErrors: false   // no file yet means the default pack
        onFileChanged: reload()
    }
    readonly property bool wantOfficial: packFile.text().trim() === "official"
    property bool officialReady: false
    onWantOfficialChanged: if (wantOfficial) officialProbe.running = true
    Process {
        id: officialProbe
        command: ["test", "-d", root.officialDir]
        onExited: code => {
            root.officialReady = code === 0
            if (code !== 0 && root.wantOfficial) console.warn("ping-wheel: official pack missing, run tools/fetch-official.sh; using custom")
        }
    }
    Component.onCompleted: officialProbe.running = true
    readonly property var pack: wantOfficial && officialReady ? packs.official : packs.custom
    readonly property var pings: pack.pings

    // ponytail: one pw-play per sound; preloaded SoundEffects if the ~30 ms spawn latency ever shows.
    function play(name, vol) {
        const path = (pack.dir + "/sounds/" + name + ".wav").replace("file://", "")
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

    // The bind swallows the press, and Hyprland keeps pointer focus where it was while the button is
    // held, so the overlay sees no motion during a drag. Poll the cursor instead, only while open.
    // ponytail: ~30 hyprctl calls a second for the length of a drag; a socket client if that ever shows.
    Process {
        id: cursorPoll
        command: ["hyprctl", "cursorpos", "-j"]
        stdout: StdioCollector {
            onStreamFinished: { if (!root.open) return; const p = JSON.parse(text); root.cx = p.x; root.cy = p.y }
        }
    }
    Timer {
        interval: 33
        repeat: true
        running: root.open
        onTriggered: if (!cursorPoll.running) cursorPoll.running = true
    }

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
        play(pings[i].sound, volume)
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
                    pingFx.createObject(win.contentItem, { def: def, dir: root.pack.dir, x: x, y: y, s: root.pingSize, dur: root.pingDur * 1000 })
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
                pack: root.pack
                hot: root.hot
            }
        }
    }
}
