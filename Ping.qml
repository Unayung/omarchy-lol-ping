// One ping at (x, y), timings from upstream overlay.css. Sizes scale with s, timing with dur.
import QtQuick
import QtQuick.Shapes
import QtQuick.Effects

Item {
    id: p
    property var def
    property string dir: Qt.resolvedUrl("assets").toString()
    property real s: 110
    property int dur: 3200
    readonly property color col: def.color
    readonly property color clear: Qt.rgba(col.r, col.g, col.b, 0)
    readonly property bool clash: def.art.length === 2   // the official All In: two halves that collide
    property string tag: ""   // a room member's name under their ping
    property color tagColor: "white"

    function tex(name) { return dir + "/textures/" + name + ".png" }

    Timer { running: true; interval: p.dur + 150; onTriggered: p.destroy() }

    // Ground glow: a circular gradient squashed into an ellipse.
    Shape {
        x: -0.42 * p.s; y: 0.2 * p.s
        width: 0.84 * p.s; height: 0.84 * p.s
        transform: Scale { yScale: 0.24 / 0.84 }
        opacity: 0
        ShapePath {
            strokeColor: "transparent"
            fillGradient: RadialGradient {
                centerX: 0.42 * p.s; centerY: centerX; focalX: centerX; focalY: centerX; centerRadius: centerX
                GradientStop { position: 0; color: p.col }
                GradientStop { position: 1; color: p.clear }
            }
            PathAngleArc { centerX: 0.42 * p.s; centerY: centerX; radiusX: centerX; radiusY: centerX; sweepAngle: 360 }
        }
        SequentialAnimation on opacity {
            NumberAnimation { to: 0.75; duration: p.dur * 0.10; easing.type: Easing.OutQuad }
            NumberAnimation { to: 0.55; duration: p.dur * 0.75 }
            NumberAnimation { to: 0; duration: p.dur * 0.15 }
        }
    }

    // Name tag, as upstream's .ping .tag. PlainText: the name comes from another machine.
    Rectangle {
        visible: p.tag !== ""
        x: -width / 2; y: 0.45 * p.s
        width: Math.min(name.implicitWidth + 14, 220); height: 18; radius: 4
        color: Qt.rgba(8 / 255, 12 / 255, 16 / 255, 0.62)
        Text {
            id: name
            anchors.centerIn: parent
            width: parent.width - 14
            horizontalAlignment: Text.AlignHCenter
            text: p.tag; textFormat: Text.PlainText; elide: Text.ElideRight
            color: p.tagColor; font.pixelSize: 13; font.weight: Font.DemiBold
            style: Text.Raised; styleColor: "black"
        }
        SequentialAnimation on opacity {
            PauseAnimation { duration: p.dur * 0.87 }
            NumberAnimation { to: 0; duration: p.dur * 0.13 }
        }
    }

    // Rings and art share one glow layer; its box must hold the 1.35x rings and the bob.
    Item {
        x: -0.8 * p.s; y: -1.0 * p.s
        width: 1.6 * p.s; height: 1.8 * p.s
        layer.enabled: true
        layer.effect: MultiEffect {
            shadowEnabled: true; shadowColor: p.col; shadowBlur: 0.6
            shadowHorizontalOffset: 0; shadowVerticalOffset: 0
        }

        Repeater {
            model: [0, 220, 1400]
            Rectangle {
                id: ring
                required property int modelData
                x: 0.8 * p.s - width / 2; y: 1.0 * p.s - height / 2
                width: 1.09 * p.s; height: width; radius: width / 2
                color: "transparent"; border.color: p.col; border.width: 3
                opacity: 0
                SequentialAnimation {
                    running: true
                    PauseAnimation { duration: modelData }
                    ParallelAnimation {
                        NumberAnimation { target: ring; property: "scale"; from: 0.25; to: 1.35; duration: 650; easing.type: Easing.OutQuad }
                        NumberAnimation { target: ring; property: "opacity"; from: 0.95; to: 0; duration: 650; easing.type: Easing.OutQuad }
                    }
                }
            }
        }

        // The art: fades out over the last 13% of the ping's life.
        Item {
            id: art
            x: 0.3 * p.s; y: 0.27 * p.s
            width: p.s; height: p.s
            SequentialAnimation on opacity {
                PauseAnimation { duration: p.dur * 0.87 }
                NumberAnimation { to: 0; duration: p.dur * 0.13 }
            }

            Item {
                id: body
                width: p.s; height: p.s
                // pop (or the clash's shake), then a gentle bob.
                SequentialAnimation {
                    running: !p.clash
                    ParallelAnimation {
                        NumberAnimation { target: body; property: "scale"; from: 0.4; to: 1.15; duration: 170; easing.type: Easing.OutQuad }
                        NumberAnimation { target: body; property: "opacity"; from: 0; to: 1; duration: 170 }
                    }
                    NumberAnimation { target: body; property: "scale"; to: 1; duration: 110; easing.type: Easing.InOutQuad }
                }
                SequentialAnimation {
                    running: p.clash
                    PauseAnimation { duration: 220 }
                    NumberAnimation { target: body; property: "x"; to: -3; duration: 60 }
                    NumberAnimation { target: body; property: "x"; to: 3; duration: 60 }
                    NumberAnimation { target: body; property: "x"; to: -2; duration: 60 }
                    NumberAnimation { target: body; property: "x"; to: 0; duration: 70 }
                }
                SequentialAnimation on y {
                    loops: Animation.Infinite
                    PauseAnimation { duration: p.clash ? 500 : 300 }
                    NumberAnimation { to: -5; duration: 800; easing.type: Easing.InOutSine }
                    NumberAnimation { to: 0; duration: 800; easing.type: Easing.InOutSine }
                }

                Repeater {
                    model: p.def.art
                    Image {
                        id: half
                        required property int index
                        required property string modelData
                        width: p.s; height: p.s
                        source: tex(modelData)
                        mipmap: true
                        // All In's halves slide in from the top corners.
                        ParallelAnimation {
                            running: p.clash
                            NumberAnimation { target: half; property: "x"; from: (half.index ? -0.64 : 0.64) * p.s; to: 0; duration: 220; easing.type: Easing.InQuad }
                            NumberAnimation { target: half; property: "y"; from: -0.64 * p.s; to: 0; duration: 220; easing.type: Easing.InQuad }
                            NumberAnimation { target: half; property: "opacity"; from: 0; to: 1; duration: 220 }
                        }
                    }
                }

                // The clash flash.
                Shape {
                    id: flash
                    visible: p.clash
                    x: 0.25 * p.s; y: 0.25 * p.s; width: 0.5 * p.s; height: width
                    opacity: 0
                    ShapePath {
                        strokeColor: "transparent"
                        fillGradient: RadialGradient {
                            centerX: 0.25 * p.s; centerY: centerX; focalX: centerX; focalY: centerX; centerRadius: centerX
                            GradientStop { position: 0; color: "white" }
                            GradientStop { position: 0.4; color: p.col }
                            GradientStop { position: 1; color: p.clear }
                        }
                        PathAngleArc { centerX: 0.25 * p.s; centerY: centerX; radiusX: centerX; radiusY: centerX; sweepAngle: 360 }
                    }
                    SequentialAnimation {
                        running: p.clash
                        PauseAnimation { duration: 200 }
                        ParallelAnimation {
                            NumberAnimation { target: flash; property: "scale"; from: 0.3; to: 2.2; duration: 350; easing.type: Easing.OutQuad }
                            SequentialAnimation {
                                NumberAnimation { target: flash; property: "opacity"; to: 1; duration: 105 }
                                NumberAnimation { target: flash; property: "opacity"; to: 0; duration: 245 }
                            }
                        }
                    }
                }
            }
        }
    }
}
