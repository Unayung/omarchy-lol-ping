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

    // Settings, written by the panel (SettingsPanel.qml) and read back live.
    readonly property string stateDir: (Quickshell.env("XDG_STATE_HOME") || Quickshell.env("HOME") + "/.local/state") + "/ping-wheel"
    FileView {
        path: root.stateDir + "/settings.json"
        watchChanges: true
        printErrors: false   // no file yet means the defaults
        onFileChanged: reload()
        onAdapterUpdated: writeAdapter()
        JsonAdapter {
            id: settings
            property real volume: 0.7
            property real pingSize: 110
            property real pingDur: 3.2
        }
    }
    property alias settings: settings
    readonly property real volume: settings.volume
    readonly property real pingSize: settings.pingSize
    readonly property real pingDur: settings.pingDur

    // Asset packs, each slot top then clockwise. "custom" ships in assets/; "official" is the League
    // art and sound a user fetches with tools/fetch-official.sh. tools/pack.sh picks one, live.
    readonly property string officialDir: (Quickshell.env("XDG_DATA_HOME") || Quickshell.env("HOME") + "/.local/share") + "/ping-wheel/official"
    readonly property var packs: ({
        custom: {
            dir: Qt.resolvedUrl("assets").toString(),
            hub: "generic",
            pings: [["danger", "#ff3b55"], ["push", "#35d27a"], ["omw", "#2e8bff"], ["allin", "#f2b320"],
                    ["assist", "#56d43c"], ["needvision", "#56d43c"], ["missing", "#f2c518"], ["enemyvision", "#ff3b55"]]
                .map(([id, color]) => ({ id: id, icon: id, art: [id], sound: id, color: color })),
            other: { id: "generic", icon: "generic", art: ["generic"], sound: "generic", color: "#2e8bff" }
        },
        official: {   // upstream src/shared/pings.ts
            dir: "file://" + officialDir,
            hub: "generic_ping",
            pings: [
                { id: "danger", icon: "pingwheel_retreatrender", art: ["pingwheel_retreatrender"], sound: "SRP_12", color: "#ff3b55" },
                { id: "push", icon: "push", art: ["pingwheel_pushrender"], sound: "SRP_9", color: "#35d27a" },
                { id: "omw", icon: "omw", art: ["omw"], sound: "OnMyWay", color: "#2e8bff" },
                { id: "allin", icon: "all_in", art: ["pingwheel_allin_render_01", "pingwheel_allin_render_02"], sound: "SRP_4", color: "#f2b320" },
                { id: "assist", icon: "assist_me", art: ["assist_me"], sound: "ComeHere", color: "#56d43c" },
                { id: "needvision", icon: "need_vision", art: ["need_vision"], sound: "SRP_7", color: "#56d43c" },
                { id: "missing", icon: "enemy_missing", art: ["enemy_missing"], sound: "MIA", color: "#f2c518" },
                { id: "enemyvision", icon: "pingwheel_enemyvisionrender", art: ["pingwheel_enemyvisionrender"], sound: "AreaIsWarded", color: "#ff3b55" }
            ],
            // ponytail: fetch-official.sh doesn't get upstream's generic art or sound; the hub icon stands in.
            other: { id: "generic", icon: "generic_ping", art: ["generic_ping"], sound: "button", color: "#2e8bff" }
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
    function setPack(name) { packFile.setText(name + "\n") }
    Process {
        id: fetcher
        command: [Qt.resolvedUrl("tools/fetch-official.sh").toString().replace("file://", "")]
        onExited: officialProbe.running = true
    }
    readonly property bool fetching: fetcher.running
    function fetchOfficial() { fetcher.running = true }
    readonly property var pings: pack.pings

    // Rooms (lolPing's "ping with friends"): tools/room.sh writes the code, name and tag colour, one per line;
    // room/room.mjs carries pings to and from Windows/Mac lolPing over the LAN and Nostr relays.
    readonly property var tagColors: ["#4fc3f7", "#ff8a65", "#aed581", "#ba68c8", "#ffd54f", "#4db6ac", "#f06292", "#e0e0e0"]   // upstream roomColors.ts
    FileView {
        id: roomFile
        path: root.stateDir + "/room"
        watchChanges: true
        printErrors: false   // no file: not in a room
        onFileChanged: reload()
    }
    // An empty code line means out of a room, with the name and colour kept for next time.
    readonly property var roomLines: roomFile.text().split("\n").map(l => l.trim())
    readonly property string roomCode: roomLines[0] || ""
    readonly property string roomName: roomLines[1] || Quickshell.env("USER") || "Linux"
    readonly property int roomColor: Math.max(0, Math.min(7, parseInt(roomLines[2]) || 0))
    readonly property var roomArgs: roomCode ? ["node", Qt.resolvedUrl("room/room.mjs").toString().replace("file://", ""),
                                                "--code", roomCode, "--name", roomName, "--color", String(roomColor)] : []
    function setRoom(code, name, color) {
        roomError = ""
        roomFile.setText(code + "\n" + String(name).replace(/\n/g, " ") + "\n" + color + "\n")
    }
    Process {
        id: newCode
        property string name
        property int color
        command: ["node", Qt.resolvedUrl("room/room.mjs").toString().replace("file://", ""), "--new-code"]
        stdout: StdioCollector { onStreamFinished: if (text.trim()) root.setRoom(text.trim(), newCode.name, newCode.color) }
    }
    property bool nodeReady: true
    Process {
        command: ["sh", "-c", "command -v node"]
        running: true
        onExited: code => root.nodeReady = code === 0
    }
    function createRoom(name, color) { newCode.name = name; newCode.color = color; newCode.running = true }
    function copy(text) { Quickshell.execDetached(["wl-copy", "--", text]) }
    onRoomArgsChanged: syncRoom()
    function syncRoom() {
        if (room.running && String(room.command) === String(roomArgs)) return   // a reload with the same room
        if (room.running) room.running = false   // its onExited starts the next one
        else if (roomArgs.length) { room.command = roomArgs; room.running = true }
    }
    property var members: []   // [{name, color, via}], everyone but us
    property var roomStatus: ({ lan: "off", internet: "off" })
    property string roomError: ""
    Process {
        id: room
        stdinEnabled: true
        stdout: SplitParser { onRead: line => root.fromRoom(line) }
        stderr: SplitParser { onRead: line => console.info("ping-wheel room: " + line) }
        onExited: code => {
            root.members = []
            root.roomStatus = { lan: "off", internet: "off" }
            // A changed or cleared room restarts or stops it; the same room after a failure doesn't loop.
            if (String(room.command) !== String(root.roomArgs)) root.syncRoom()
            else if (code !== 0) root.roomError = code === 2 ? "Not a room code" : code === 3 ? "That room is full (16)" : "Room helper stopped (" + code + ")"
        }
    }

    // Screen instances in room display order (#1 first), see wheel.js numberScreens.
    function numbered() {
        const ins = screens.instances
        return G.numberScreens(ins.map(w => w.modelData)).map(k => ins[k])
    }

    function fromRoom(line) {
        let m
        try { m = JSON.parse(line) } catch (e) { return }
        if (m.t === "ping") {
            if (paused) return
            const def = pings.find(p => p.id === m.id) || pack.other
            const list = numbered(), w = list[m.d - 1] || list[0]
            play(def.sound, volume)
            w.spawn(def, w.modelData.x + m.x * w.modelData.width, w.modelData.y + m.y * w.modelData.height,
                    m.name, tagColors[m.color] || tagColors[0])
        } else if (m.t === "members") {
            const now = m.list.map(x => x.name), was = members.map(x => x.name)
            now.filter(n => !was.includes(n)).forEach(n => notify(n + " joined the room"))
            was.filter(n => !now.includes(n)).forEach(n => notify(n + " left the room"))
            members = m.list
        } else if (m.t === "status") {
            roomStatus = { lan: m.lan, internet: m.internet }
        }
    }
    function notify(text) {
        Quickshell.execDetached(["notify-send", "-a", "Ping Wheel", text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")])
    }

    // ponytail: one pw-play per sound; preloaded SoundEffects if the ~30 ms spawn latency ever shows.
    function play(name, vol) {
        const path = (pack.dir + "/sounds/" + name + ".wav").replace("file://", "")
        Quickshell.execDetached(["pw-play", "--volume", String(vol), path])
    }

    // Paused (the bar icon's right click, as upstream's Ctrl+Alt+P): no wheel, no friends' pings.
    // ponytail: friends still see us as "on"; tell the helper if a paused status in their panel matters.
    property bool paused: false

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
            if (root.paused) return
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
        if (!room.running) return
        const list = numbered()
        const n = list.findIndex(w => { const g = w.modelData; return ox >= g.x && oy >= g.y && ox < g.x + g.width && oy < g.y + g.height })
        if (n < 0) return
        const g = list[n].modelData
        room.write(JSON.stringify({ t: "ping", id: pings[i].id, d: n + 1, x: (ox - g.x) / g.width, y: (oy - g.y) / g.height }) + "\n")
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

            function spawn(def, gx, gy, tag, tagColor) {
                const x = gx - modelData.x, y = gy - modelData.y
                if (x >= 0 && y >= 0 && x < width && y < height)
                    pingFx.createObject(win.contentItem, { def: def, dir: root.pack.dir, x: x, y: y, s: root.pingSize, dur: root.pingDur * 1000,
                                                               tag: tag || "", tagColor: tagColor || "white" })
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
