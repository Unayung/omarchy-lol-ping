// Wheel geometry, ported from upstream src/shared/geometry.ts and src/renderer/overlay/wheel.ts.
// Plain JS on purpose: QML imports it, check.mjs runs it under node.

var WHEEL = { size: 600, innerR: 86, outerR: 188, extR: 288, iconR: 137, iconSize: 48 };

// -1 inside the dead zone, else 0..7 where 0 = N and indices go clockwise. Screen coords (y down).
function pickSlice(dx, dy, deadZone) {
    if (Math.hypot(dx, dy) < deadZone) return -1;
    var deg = ((Math.atan2(dy, dx) * 180) / Math.PI + 90 + 22.5 + 360) % 360;
    return Math.floor(deg / 45) % 8;
}

function polar(r, deg) {
    var a = (deg * Math.PI) / 180;
    return [WHEEL.size / 2 + r * Math.cos(a), WHEEL.size / 2 + r * Math.sin(a)];
}

// SVG path of a ring sector, in a WHEEL.size box centred on the wheel.
function sector(r0, r1, a0, a1) {
    var p0 = polar(r0, a0), p1 = polar(r1, a0), p2 = polar(r1, a1), p3 = polar(r0, a1);
    return "M" + p0 + " L" + p1 + " A" + r1 + "," + r1 + " 0 0 1 " + p2 + " L" + p3 + " A" + r0 + "," + r0 + " 0 0 0 " + p0 + "Z";
}
