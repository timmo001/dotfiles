<h1 align="center">
  <img src="pages/icon.svg" width="256" height="256" alt="WonKey">
  <br />
  WonKey
</h1>

<p align="center"><b>Macropad configuration tool for Linux. One key, to rule them all 1️⃣</b></p>

<p align="center">Made with 💝 for 🐧</p>

Configure USB macropads and mini-keyboards from one Linux CLI. Inspect connected pads with `wonkey`, bind keys, rotary knobs, multi-stroke macros, consumer media controls, and relative mouse actions, and set RGB or LED lighting.

## Supported devices

| Device | USB ID | Controls | Supported Commands | Settings Readback |
| --- | --- | --- | --- | --- |
| XFKEY One Key Max (`0112`) | `af88:6688` | 1 key | `key`, `trigger`, `macro`, `mouse`, `media`, `rgb` | Full settings readback |
| CH57x Macropad (Gen 1) | `1189:8890`, `514c:8890` | Up to 12 keys, 3 knobs, 15 layers | `key`, `macro`, `mouse`, `media`, `led` | Write-only firmware |
| CH57x Macropad (Gen 2) | `1189` / `514c` : `8830`, `8831`, `8832`, `8833`, `8840`, `8842`, `8850`, `8851` | Up to 12 keys, 4 knobs, 15 layers | `key`, `macro`, `mouse`, `media`, `led` | Layout and Layer 1 bindings |
| SayoDevice Macropad | `8089:0002`, `0003`, `0004`, `0005`, `0009`, `000a`, `000b`, `000c`, `000e` | Up to 12 keys, 4 knobs, 5 layers | `key`, `macro`, `mouse`, `media`, `rgb`, `firmware` | Key bindings, lighting, and firmware version |
| SayoDevice Bootloader (Recovery) | Application PID with product `Bootloader` (`8089:000c` for the 2x3P, confirmed by capture), or manifest `pid2` `8089:0006`, `0007`, `0008`, `0009` for HID v1 directories 2 to 5 (unconfirmed) | Bootloader mode only | `firmware` | Model, firmware version, and `CHECK_FW` reply bytes |

## Install

| | Platform | Repository |
| :-: | --- | --- |
| <img src="https://apt.wimpys.world/logo.svg" width="32" height="32" alt=""> | Debian and Ubuntu | [apt.wimpys.world](https://apt.wimpys.world/#wonkey) |
| <img src="https://rpm.wimpys.world/logo.svg" width="32" height="32" alt=""> | Fedora and openSUSE | [rpm.wimpys.world](https://rpm.wimpys.world/#wonkey) |
| <img src="https://pkg.wimpys.world/logo.svg" width="32" height="32" alt=""> | Arch Linux | [pkg.wimpys.world](https://pkg.wimpys.world/#wonkey) |
| <img src="https://apk.wimpys.world/logo.svg" width="32" height="32" alt=""> | Alpine Linux | [apk.wimpys.world](https://apk.wimpys.world/#wonkey) |
| <img src="https://nix.wimpys.world/logo.svg" width="32" height="32" alt=""> | Nix and NixOS | [nix.wimpys.world](https://nix.wimpys.world/#wonkey) |

Each repository is signed, and its page gives the setup steps and keeps WonKey up to date.

### Any Linux

[bin](https://github.com/marcosnils/bin) installs and updates the release binary:

```sh
bin install github.com/wimpysworld/WonKey
```

Your user needs permission to access the macropad's USB or vendor `hidraw` device node.

### Build from source

Requires Git, Go 1.25 or later, and [just](https://just.systems/).

```sh
just build
sudo install -m 0755 ./bin/wonkey /usr/local/bin/wonkey
```

## Make it yours

Inspect connected macropads and read current settings without changing them:

```sh
wonkey
```

`wonkey` lists each connected macropad with its `[N]` device number, USB path, layout where readable, supported commands, and readable settings. When multiple macropads are connected, pass `--device <N>` to target device `[N]` (for example `wonkey key f13 --device 2`).

Bind keys, rotary knobs, and key triggers:

```sh
wonkey key f13
wonkey key ctrl+shift+a
wonkey key key2 f13
wonkey key knob-press mute --layer 2
wonkey trigger release
```

Combine a base key with optional `ctrl+`, `shift+`, `alt+`, or `super+` modifiers. On multi-control pads, pass an optional control name (`key1`..`key12`, `knob-left`, `knob-press`, `knob-right`, `knob1-left`..`knob4-right`) and `--layer <N>`, or use `wonkey trigger <press|release|both>` on single-key pads that support triggers.

Bind relative mouse actions, consumer media controls, or multi-stroke macros:

```sh
wonkey mouse left+right --x -20 --y 10
wonkey mouse wheelup
wonkey media playpause
wonkey media knob-right volumeup
wonkey macro a,f13,enter --interval 50 --repeat 2
wonkey macro key3 ctrl+c,ctrl+v --layer 2
```

Assign mouse buttons, relative cursor movement, wheel ticks, media keys, or comma-separated key sequences to any supported button or rotary knob.

Set RGB lighting or LED backlight modes:

```sh
wonkey rgb static 0000ff
wonkey rgb off
wonkey led reactive
wonkey led cycle
wonkey led off
```

Use `wonkey rgb` for 24-bit RGB modes and hex colours on XFKEY and SayoDevice macropads, or `wonkey led` for LED backlight modes (`off`, `reactive`, `cycle`) on CH57x macropads.

Check or update official vendor firmware on SayoDevice macropads:

```sh
wonkey firmware
wonkey firmware check
wonkey firmware update
```

`wonkey firmware` checks the device's firmware version against the official SayoDevice vendor manifest without modifying the pad. `wonkey firmware update` downloads and installs the latest official vendor firmware or recovers a device in bootloader mode. After the flash, it waits up to 60 seconds for the device to restart, then confirms the model and firmware version with one `Info` query. When the restart or the version is not confirmed, the command prints the next step and exits with status 1.

## Documentation

- [Usage and configuration](wiki/usage.md) - Command syntax, supported key and media names, controls, layers, and lighting modes
- [Hardware operations and safety](wiki/hardware.md) - Device permissions, capability rules, hardware verification, and guarded writes
- [Protocol and evidence](wiki/protocol.md) - Packet formats, firmware update protocol, and hardware test records
- [Development](wiki/development.md) - Architecture, quality checks, and test fixtures
