# WonKey documentation

WonKey is a macropad configuration tool for Linux. One key, to rule them all.

Configure supported USB macropads and mini-keyboards from one CLI: inspect connected pads with `wonkey`, bind keys, rotary knobs, multi-stroke macros, consumer media controls, and relative mouse actions, and set RGB or LED lighting.
WonKey validates device capabilities and descriptors before every write, and verifies all 128 configuration bytes in memory after each write on XFKEY One Key Max (0112).

[Build WonKey](https://github.com/wimpysworld/WonKey/blob/main/README.md#get-started), then [read the current settings](usage#read-settings).
Read [device access requirements](hardware#device-selection-and-access) before a hardware command.

## Supported devices

| Device | USB ID | Controls | Supported Commands | Settings Readback |
| --- | --- | --- | --- | --- |
| XFKEY One Key Max (`0112`) | `af88:6688` | 1 key | `key`, `trigger`, `macro`, `mouse`, `media`, `rgb` | Full 128-byte readback |
| CH57x Macropad (Gen 1) | `1189:8890`, `514c:8890` | Up to 12 keys, 3 knobs, 15 layers | `key`, `macro`, `mouse`, `media`, `led` | Write-only firmware |
| CH57x Macropad (Gen 2) | `1189` / `514c` : `8830`, `8831`, `8832`, `8833`, `8840`, `8842`, `8850`, `8851` | Up to 12 keys, 4 knobs, 15 layers | `key`, `macro`, `mouse`, `media`, `led` | Layout (`0xFB`) and Layer 1 (`0xFA`) readback |
| SayoDevice Macropad (HID v1 / v2) | `8089:0002`, `0003`, `0004`, `0005`, `0009`, `000a`, `000b`, `000c`, `000e` | Up to 12 keys, 4 knobs, 5 layers | `key`, `macro`, `mouse`, `media`, `rgb`, `firmware` | Key (`0x10` / `0x16`), Light (`0x11` / `0x10`), and Info (`0x00`) readback |
| SayoDevice Bootloader (Recovery) | Application PID with product `Bootloader` (`8089:000c` for the 2x3P, confirmed by capture), or manifest `pid2` `8089:0006`, `0007`, `0008`, `0009` for HID v1 directories 2 to 5 (unconfirmed) | Bootloader mode only | `firmware` | Model and version via `CHECK_FW` (`0x01`) |

## Use WonKey

| Task | Guide |
|---|---|
| Inspect settings or probe a device | [Read settings](usage#read-settings) |
| Assign a key with modifiers and set its trigger | [Set the key](usage#set-the-key) |
| Set a mouse, consumer media, or macro action | [Mouse, media, and macro actions](usage#mouse-media-and-macro-actions) |
| Choose an RGB or LED lighting mode | [Lighting](usage#lighting) |
| Select a device and verify a change | [Device selection and verification](usage#device-selection-and-verification) |

The [usage guide](usage) covers command syntax, unified device discovery, and supported settings.
Bare `wonkey` reads settings and inspects connected devices without modifying them. `key`, `trigger`, `macro`, `mouse`, `media`, `rgb`, `led`, and `firmware` validate device capabilities (including optional `[CONTROL]` and `--layer` on `key`, `macro`, `mouse`, and `media`, `rgb` on `0112` and SayoDevice macropads, `led <off|reactive|cycle>` on CH57x devices, and `firmware [check|update]` on SayoDevice macropads) and configure all supported devices in the table above.

## Hardware and development

| Page | Use it to |
|---|---|
| [Hardware operations and safety](hardware) | Check device discovery, compatibility, hardware effects, and guarded write verification. |
| [Protocol and evidence](protocol) | Read packet layouts, hardware test results, and pinned source evidence. |
| [Development](development) | Find offline checks, architecture notes, and fixture requirements. |
