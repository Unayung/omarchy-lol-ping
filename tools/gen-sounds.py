#!/usr/bin/env python3
"""Synthesises the ping sounds into assets/sounds/. Run: python3 tools/gen-sounds.py"""
import wave
from pathlib import Path

import numpy as np

SR = 48000
OUT = Path(__file__).resolve().parent.parent / "assets" / "sounds"


def t(sec):
    return np.arange(int(SR * sec)) / SR


def bell(freq, sec, decay=6.0, partials=((1, 1.0), (2.0, 0.35), (3.01, 0.15))):
    x = t(sec)
    tone = sum(a * np.sin(2 * np.pi * freq * m * x) for m, a in partials)
    attack = np.minimum(x / 0.004, 1.0)
    return tone * attack * np.exp(-decay * x)


def glide(f0, f1, sec, decay=5.0):
    x = t(sec)
    phase = 2 * np.pi * np.cumsum(np.linspace(f0, f1, x.size)) / SR
    return (np.sin(phase) + 0.25 * np.sin(2 * phase)) * np.minimum(x / 0.005, 1.0) * np.exp(-decay * x)


def seq(*parts, gap=0.0):
    """Concatenates (offset_seconds, signal) pairs into one buffer."""
    end = max(off + len(sig) / SR for off, sig in parts) + gap
    buf = np.zeros(int(SR * end) + 1)
    for off, sig in parts:
        i = int(SR * off)
        buf[i:i + len(sig)] += sig
    return buf


rng = np.random.default_rng(7)
SOUNDS = {
    # Two sharp falling tones: back off.
    "danger": seq((0, bell(1046, 0.25, 12)), (0.13, bell(784, 0.45, 8))),
    # Rising fourth: go.
    "push": seq((0, bell(523, 0.2, 10)), (0.1, bell(784, 0.5, 7))),
    # Soft rising arpeggio.
    "omw": seq((0, bell(440, 0.3, 8)), (0.08, bell(554, 0.3, 8)), (0.16, bell(659, 0.6, 6))),
    # Metallic clang: inharmonic partials plus a noise strike.
    "allin": seq(
        (0, bell(620, 0.9, 5, ((1, 1.0), (2.76, 0.6), (5.4, 0.4), (8.93, 0.25)))),
        (0, rng.standard_normal(int(SR * 0.05)) * np.exp(-60 * t(0.05)) * 0.8),
    ),
    # Three quick upward blips.
    "assist": seq((0, bell(659, 0.12, 20)), (0.09, bell(784, 0.12, 20)), (0.18, bell(988, 0.4, 9))),
    # Airy shimmer with tremolo.
    "needvision": bell(1318, 0.8, 4) * (0.75 + 0.25 * np.sin(2 * np.pi * 14 * t(0.8))),
    # Questioning rise, then a lower answer.
    "missing": seq((0, glide(587, 880, 0.3, 4)), (0.28, bell(740, 0.5, 7))),
    # Low, beating, ominous pair.
    "enemyvision": bell(330, 0.9, 3.5) + bell(311, 0.9, 3.5),
    # One clean ping.
    "generic": bell(1046, 0.6, 7),
    # Hover tick.
    "button": bell(3000, 0.04, 120, ((1, 1.0),)),
}


def write(name, sig):
    sig = sig / np.max(np.abs(sig)) * 0.8
    tail = min(len(sig), int(SR * 0.01))
    sig[-tail:] *= np.linspace(1, 0, tail)  # no click at the end
    with wave.open(str(OUT / f"{name}.wav"), "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes((sig * 32767).astype("<i2").tobytes())


if __name__ == "__main__":
    OUT.mkdir(parents=True, exist_ok=True)
    for name, sig in SOUNDS.items():
        write(name, sig)
    print(f"wrote {len(SOUNDS)} sounds to {OUT}")
