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

## Asset packs

Two packs, switchable at any time; the plugin picks up the change at once, no restart.

| Pack | What it is | Where it comes from |
| --- | --- | --- |
| `custom` (default) | This project's own icons and sounds | Bundled in `assets/` |
| `official` | The original League of Legends ping art and sounds, with All In's two-halves clash | Downloaded to your machine by `tools/fetch-official.sh`; never part of this repository |

The official files are Riot Games' property. The fetch script pulls them from [darrenprx/lolPing](https://github.com/darrenprx/lolPing) at a pinned commit, over HTTPS, only when you run it. Whether to use them is your call; Riot's [fan content policy](https://www.riotgames.com/en/legal) covers free, non-commercial fan use, so read it if that matters to you.

```sh
P=~/.config/omarchy/plugins/io.github.unayung.ping-wheel

$P/tools/fetch-official.sh     # once: download the official pack to ~/.local/share/ping-wheel/official
$P/tools/pack.sh official      # switch to it
$P/tools/pack.sh custom        # back to the bundled pack
$P/tools/pack.sh toggle        # flip between the two
$P/tools/pack.sh               # print the current pack
```

`pack.sh` writes the choice to `~/.local/state/ping-wheel/pack`, which the plugin watches. Picking `official` before downloading it is refused; if the files go missing later, the plugin falls back to `custom` and logs a warning. To switch from a key, bind the script, e.g. `o.bind("SUPER + ALT + P", "Ping wheel pack", "~/.config/omarchy/plugins/io.github.unayung.ping-wheel/tools/pack.sh toggle")`.

## Remove

```sh
omarchy plugin remove io.github.unayung.ping-wheel
```

and delete the `pingwheel:wheel` line from `~/.config/hypr/bindings.lua`. If you used the official pack, also `rm -rf ~/.local/share/ping-wheel ~/.local/state/ping-wheel`.

## Without the Omarchy shell

Any Hyprland + Quickshell setup can run it on its own: `qs -p /path/to/omarchy-lol-ping`, with the same bind (`bind = ALT, mouse:272, global, pingwheel:wheel` in a classic `hyprland.conf`).

## Assets

- Icons: generated with OpenAI `gpt-image-2.5-sunburst` from `tools/icons-prompt.txt` as one sheet (`tools/icons-sheet.png`), sliced into `assets/textures/`.
- Sounds: synthesised by `tools/gen-sounds.py` (`python3 tools/gen-sounds.py` rebuilds `assets/sounds/`).

No game art or audio is included in this repository (the optional official pack is fetched separately, see [Asset packs](#asset-packs)). Not affiliated with Riot Games or League of Legends.

## Dependencies

Omarchy (Hyprland, Quickshell `omarchy-shell`), PipeWire `pw-play`. Development check: `node check.mjs` (slice picking).

## License

MIT, see `LICENSE`.
