// One ping at (x, y), timings from upstream overlay.css. Sizes scale with s, timing with dur.
import QtQuick
import QtQuick.Shapes
import QtQuick.Effects

Item {
    id: p
    property var def
    property real s: 110
    property int dur: 3200
    readonly property color col: def.color
    readonly property color clear: Qt.rgba(col.r, col.g, col.b, 0)

    function tex(name) { return Qt.resolvedUrl("assets/textures/" + name + ".png") }

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
                // pop, then a gentle bob.
                SequentialAnimation {
                    running: true
                    ParallelAnimation {
                        NumberAnimation { target: body; property: "scale"; from: 0.4; to: 1.15; duration: 170; easing.type: Easing.OutQuad }
                        NumberAnimation { target: body; property: "opacity"; from: 0; to: 1; duration: 170 }
                    }
                    NumberAnimation { target: body; property: "scale"; to: 1; duration: 110; easing.type: Easing.InOutQuad }
                }
                SequentialAnimation on y {
                    loops: Animation.Infinite
                    PauseAnimation { duration: 300 }
                    NumberAnimation { to: -5; duration: 800; easing.type: Easing.InOutSine }
                    NumberAnimation { to: 0; duration: 800; easing.type: Easing.InOutSine }
                }

                Image {
                    anchors.fill: parent
                    source: tex(p.def.id)
                    mipmap: true
                }
            }
        }
    }
}
