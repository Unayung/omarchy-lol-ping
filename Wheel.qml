// The League-style wheel (upstream src/renderer/overlay/wheel.ts), 0 = N then clockwise.
import QtQuick
import QtQuick.Shapes
import QtQuick.Effects
import "wheel.js" as G

Item {
        id: wheel
        property bool shown
    property var pings: []
        property int hot: -1
        width: G.WHEEL.size; height: G.WHEEL.size
        opacity: shown ? 1 : 0
        scale: shown ? 1 : 0.85
        Behavior on opacity { NumberAnimation { duration: 120; easing.type: Easing.OutQuad } }
        Behavior on scale { NumberAnimation { duration: 120; easing.type: Easing.OutQuad } }
        readonly property real c: G.WHEEL.size / 2
    function tex(name) { return Qt.resolvedUrl("assets/textures/" + name + ".png") }

        Shape {
            anchors.fill: parent
            preferredRendererType: Shape.CurveRenderer
            // Outer fans behind the even slices.
            ShapePath {
                strokeColor: "transparent"
                fillGradient: RadialGradient {
                    centerX: wheel.c; centerY: wheel.c; focalX: wheel.c; focalY: wheel.c; centerRadius: G.WHEEL.extR
                    GradientStop { position: G.WHEEL.outerR / G.WHEEL.extR; color: "#8c5c6066" }
                    GradientStop { position: 1; color: "#005c6066" }
                }
                PathSvg { path: [0, 2, 4, 6].map(i => G.sector(G.WHEEL.outerR, G.WHEEL.extR, -112.5 + i * 45, -67.5 + i * 45)).join(" ") }
            }
            // The ring.
            ShapePath {
                strokeColor: "transparent"
                fillRule: ShapePath.OddEvenFill
                fillGradient: RadialGradient {
                    centerX: wheel.c; centerY: wheel.c; focalX: wheel.c; focalY: wheel.c; centerRadius: G.WHEEL.outerR
                    GradientStop { position: G.WHEEL.innerR / G.WHEEL.outerR; color: "#eb2a2d31" }
                    GradientStop { position: 1; color: "#eb4a4e54" }
                }
                PathAngleArc { centerX: wheel.c; centerY: wheel.c; radiusX: G.WHEEL.outerR; radiusY: G.WHEEL.outerR; sweepAngle: 360 }
                PathAngleArc { centerX: wheel.c; centerY: wheel.c; radiusX: G.WHEEL.innerR; radiusY: G.WHEEL.innerR; sweepAngle: 360; moveToStart: true }
            }
            // Gold dividers.
            ShapePath {
                strokeColor: "#73a08a5c"
                strokeWidth: 1.2
                fillColor: "transparent"
                PathSvg {
                    path: [0, 1, 2, 3, 4, 5, 6, 7].map(i => "M" + G.polar(G.WHEEL.innerR, -112.5 + i * 45) + " L" + G.polar(G.WHEEL.outerR, -112.5 + i * 45)).join(" ")
                }
            }
        }

        Repeater {
            model: 8
            Shape {
                required property int index
                anchors.fill: parent
                preferredRendererType: Shape.CurveRenderer
                opacity: wheel.hot === index ? 0.55 : 0
                Behavior on opacity { NumberAnimation { duration: 80 } }
                ShapePath {
                    strokeColor: "transparent"
                    fillGradient: RadialGradient {
                        centerX: wheel.c; centerY: wheel.c; focalX: wheel.c; focalY: wheel.c; centerRadius: G.WHEEL.extR
                        GradientStop { position: G.WHEEL.innerR / G.WHEEL.extR; color: "#8a8f96" }
                        GradientStop { position: G.WHEEL.outerR / G.WHEEL.extR; color: "#9aa0a8" }
                        GradientStop { position: 1; color: "#009aa0a8" }
                    }
                    PathSvg { path: G.sector(G.WHEEL.innerR, index % 2 ? G.WHEEL.outerR : G.WHEEL.extR, -112.5 + index * 45, -67.5 + index * 45) }
                }
            }
        }

        Repeater {
            model: wheel.pings
            Image {
                required property int index
                required property var modelData
                readonly property var at: G.polar(G.WHEEL.iconR, -90 + index * 45)
                readonly property bool isHot: wheel.hot === index
                x: at[0] - width / 2; y: at[1] - height / 2
                width: G.WHEEL.iconSize; height: G.WHEEL.iconSize
                source: tex(modelData.id)
                smooth: true; mipmap: true
                scale: isHot ? 1.18 : 1
                Behavior on scale { NumberAnimation { duration: 100 } }
                // Idle icons are gold-tinted, like League's; the hot one shows its own colours.
                layer.enabled: true
                layer.effect: MultiEffect {
                    saturation: isHot ? 0 : -1
                    colorization: isHot ? 0 : 0.55
                    colorizationColor: "#c8aa6e"
                    brightness: isHot ? 0 : 0.1
                }
            }
        }

        // Hub.
        Rectangle {
            anchors.centerIn: parent
            width: 2 * (G.WHEEL.innerR + 4); height: width; radius: width / 2
            color: "transparent"; border.color: "#991a1a1a"; border.width: 6
        }
        Shape {
            anchors.fill: parent
            preferredRendererType: Shape.CurveRenderer
            ShapePath {
                strokeColor: "#c8aa6e"; strokeWidth: 3
                fillGradient: RadialGradient {
                    centerX: wheel.c; centerY: wheel.c - 10; focalX: centerX; focalY: centerY; centerRadius: G.WHEEL.innerR
                    GradientStop { position: 0; color: "#2c5d60" }
                    GradientStop { position: 1; color: "#11292c" }
                }
                PathAngleArc { centerX: wheel.c; centerY: wheel.c; radiusX: G.WHEEL.innerR; radiusY: G.WHEEL.innerR; sweepAngle: 360 }
            }
        }
        Rectangle {
            anchors.centerIn: parent
            width: 2 * (G.WHEEL.innerR - 7); height: width; radius: width / 2
            color: "transparent"; border.color: "#998a7448"; border.width: 1
        }
        Image {
            x: wheel.c - 20; y: wheel.c - 58; width: 40; height: 40
            source: tex("generic"); mipmap: true
        }
        Text {
            anchors.horizontalCenter: parent.horizontalCenter
            y: wheel.c - 12
            text: "PING"; color: "#1fa9e0"
            font { pixelSize: 15; weight: Font.DemiBold; letterSpacing: 1 }
        }
        Text {
            anchors.horizontalCenter: parent.horizontalCenter
            y: wheel.c + 42
            text: "BACK"; color: "#6c7a7c"
            font { pixelSize: 9; weight: Font.DemiBold; letterSpacing: 0.5 }
        }
    }
