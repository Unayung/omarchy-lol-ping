# Ping Wheel

A MOBA-style ping wheel for the whole [Omarchy](https://omarchy.org/) desktop. Hold **Alt**, drag, let go on a ping: an animated marker pops where you pressed, with a sound, on top of any app.

![Ping Wheel](preview.png)

An Omarchy shell plugin (a `service` that runs inside `omarchy-shell`), inspired by [darrenprx/lolPing](https://github.com/darrenprx/lolPing), whose Linux build is X11-only. The wheel geometry and animation timings are ported from it; the icons and sounds are this project's own (see [Assets](#assets)).

## Install

```sh
omarchy plugin add https://github.com/Unayung/omarchy-lol-ping --enable
```

Then add the trigger to `~/.config/hypr/bindings.lua` (the plugin never edits your config itself):

```lua
o.bind("ALT + mouse:272", "Ping wheel", hl.dsp.global("pingwheel:wheel"))
```

Hyprland reloads the file on save. Needs `pw-play` (PipeWire), which Omarchy ships.

## Use

| To | Do this |
| --- | --- |
| Ping | Hold **Alt + left mouse**, drag, let go on a slice |
| Cancel | Let go in the centre, right-click, or press **Esc** |

The wheel, from the top going clockwise: Danger, Push, On My Way, All In, Assist Me, Need Vision, Enemy Missing, Enemy Vision.

Ping size, duration and volume are constants at the top of `PingWheel.qml`.

While the bind is active, Alt + left click no longer reaches apps: Wayland gives no way to replay a click that the compositor has already taken.

## Remove

```sh
omarchy plugin remove io.github.unayung.ping-wheel
```

and delete the `pingwheel:wheel` line from `~/.config/hypr/bindings.lua`.

## Without the Omarchy shell

Any Hyprland + Quickshell setup can run it on its own: `qs -p /path/to/omarchy-lol-ping`, with the same bind (`bind = ALT, mouse:272, global, pingwheel:wheel` in a classic `hyprland.conf`).

## Assets

- Icons: generated with OpenAI `gpt-image-2.5-sunburst` from `tools/icons-prompt.txt` as one sheet (`tools/icons-sheet.png`), sliced into `assets/textures/`.
- Sounds: synthesised by `tools/gen-sounds.py` (`python3 tools/gen-sounds.py` rebuilds `assets/sounds/`).

No game art or audio is included. Not affiliated with Riot Games or League of Legends.

## Dependencies

Omarchy (Hyprland, Quickshell `omarchy-shell`), PipeWire `pw-play`. Development check: `node check.mjs` (slice picking).

## License

MIT, see `LICENSE`.
