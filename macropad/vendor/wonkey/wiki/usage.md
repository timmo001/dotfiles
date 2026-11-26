# Usage and configuration

[Wiki home](Home) · [Hardware operations and safety](hardware)

Build WonKey as described in the [project overview](https://github.com/wimpysworld/WonKey/blob/main/README.md#get-started).
Run command examples from the project root. Device examples are instructions, not permission to access hardware.

[Read settings](#read-settings) · [Set the key](#set-the-key) · [Mouse, media, and macro actions](#mouse-media-and-macro-actions) · [Lighting](#lighting) · [Device selection](#device-selection-and-verification)

WonKey configures supported USB macropads and mini-keyboards on Linux.
Changes require a supported device from the table below (`0112`, CH57x `1189`/`514c`, or SayoDevice `8089`). WonKey validates device capabilities and descriptors before writing, shows the proposed change, and verifies all 128 configuration bytes in memory after each settings upload on `0112` (or verifies per-packet acknowledgements on SayoDevice `8089`).

## Supported devices

| Device | USB ID | Controls | Supported Commands | Settings Readback |
| --- | --- | --- | --- | --- |
| XFKEY One Key Max (`0112`) | `af88:6688` | 1 key | `key`, `trigger`, `macro`, `mouse`, `media`, `rgb` | Full 128-byte readback |
| CH57x Macropad (Gen 1) | `1189:8890`, `514c:8890` | Up to 12 keys, 3 knobs, 15 layers | `key`, `macro`, `mouse`, `media`, `led` | Write-only firmware |
| CH57x Macropad (Gen 2) | `1189` / `514c` : `8830`, `8831`, `8832`, `8833`, `8840`, `8842`, `8850`, `8851` | Up to 12 keys, 4 knobs, 15 layers | `key`, `macro`, `mouse`, `media`, `led` | Layout (`0xFB`) and Layer 1 (`0xFA`) readback |
| SayoDevice Macropad (HID v1 / v2) | `8089:0002`, `0003`, `0004`, `0005`, `0009`, `000a`, `000b`, `000c`, `000e` | Up to 12 keys, 4 knobs, 5 layers | `key`, `macro`, `mouse`, `media`, `rgb`, `firmware` | Key (`0x10` / `0x16`), Light (`0x11` / `0x10`), and Info (`0x00`) readback |
| SayoDevice Bootloader (Recovery) | Application PID with product `Bootloader` (`8089:000c` for the 2x3P, confirmed by capture), or manifest `pid2` `8089:0006`, `0007`, `0008`, `0009` for HID v1 directories 2 to 5 (unconfirmed). PID `0009` is also a HID v2 macropad PID, so WonKey recognises a bootloader by its report descriptor | Bootloader mode only | `firmware` | Model and version via CHECK_FW (`0x01`) |

## Read settings

```sh
./wonkey
```

Bare `wonkey` discovers and inspects all connected supported macropads automatically without prompting for selection, sorted deterministically by USB physical path (`[1]`, `[2]`, and so on).
On each XFKEY One Key Max (`0112`), the section heading is `[N] XFKEY One Key Max (0112)` and `wonkey` shows the physical USB path, `Supports` (`key, trigger, mouse, media, macro, rgb`), the keyboard combination and trigger (or the current typed action), and the RGB mode and configured colour.
For an unsupported `0112` configuration, bare `wonkey` instead shows an explicit unknown layout.
It shows the raw type at byte 0 and configuration bytes 0 to 15 as hexadecimal.
It does not decode key, trigger, lighting, mouse, media, or macro fields from an unknown layout.
This read-only display does not enable changes. Live writes remain blocked for unsupported configurations.

On each CH57x Macropad (Gen 1, `1189:8890` and `514c:8890`) device, the section heading is `[N] CH57x Macropad (1189:8890)` (or `514c:8890`) and bare `wonkey` shows the USB path, `Supports` (`key, mouse, media, macro, led`), and `Settings   Write-only (not readable over USB)` (plus `Input hex` when a 65-byte report ID 3 reply is returned).
The USB check requests Input report ID 3.
Stock `1189:8890` write-only firmware returns a 1-byte `0xaa` status response to `GET_REPORT`. WonKey accepts that 1-byte `0xaa` status (exit 0) alongside 65-byte report ID 3 replies.

On each CH57x Macropad (Gen 2, `1189` / `514c` : `8830`, `8831`, `8832`, `8833`, `8840`, `8842`, `8850`, `8851`, such as `514c:8851` and `514c:8850`), bare `wonkey` queries `0xFB` on interface 0 `hidraw` for the layout (`keys`, `knobs`, and firmware `kind`) and `0xFA` for Layer 1 key and knob bindings (or falls back to `Settings   Write-only (not readable over USB)` when `0xFA` times out on write-only `kind >= 10` units).
When a CH57x Macropad (Gen 1 or Gen 2) is selected for a write command, WonKey checks per-device capabilities first (accepting optional `[CONTROL]` in `key1`..`key12`, `knob-left`, `knob-press`, `knob-right`, `knob1-left`..`knob4-right` validated against the device layout and defaulting to `key1`, and `--layer <1..15>` defaulting to `1` on `key`, `macro`, `mouse`, and `media`, and rejecting `trigger`, keys outside `0x04..0x73`, `macro` options `--interval` or `--repeat`, sequences over 5 strokes, `rgb` with a hint to use `wonkey led`, and unsupported media usages), shows the proposed change, revalidates the descriptors, and writes the report sequence (`0x02` interrupt OUT on Gen 1, or `0xFE` / `0xFD` report ID 3 over `hidraw` on Gen 2).

On each SayoDevice Macropad (`8089:0002..0005`, `0009..000c`, `000e`, such as `8089:000c`), bare `wonkey` queries `Info` (`0x00`) for the model code and firmware version, reads key and rotary knob bindings across layers `1..5` (`0x10` on HID v2, `0x16` on HID v1), and reads RGB lighting (`0x11` on HID v2, `0x10` on HID v1). On a SayoDevice in bootloader mode, bare `wonkey` sends only `GET_BOOT_VERSION` (`0x00`) and `CHECK_FW` (`0x01`) for the model and firmware version, and reports `Supports   firmware`. When the device restarts or disconnects during the bootloader probe (`EPROTO`, `ENODEV`, `EIO`, `ESHUTDOWN`, or `ENOENT`), bare `wonkey` keeps the raw error in the `Detail` field, prints `Device is restarting. Wait a few seconds and run wonkey again.` and `If it stays in bootloader mode, run wonkey firmware update --device <N> to recover.`, and exits with status 1. The 2x3P bootloader keeps `8089:000c` and reports the product `Bootloader`. HID v1 directories 2 to 5 give manifest `pid2` values `8089:0006..0009` for bootloader mode, which are unconfirmed on hardware. Run `wonkey firmware update --device <N>` to recover a device in bootloader mode.

`wonkey --help` and help for each command show help without device access. Running `key`, `trigger`, `macro`, `mouse`, `media`, `rgb`, or `led` without arguments returns usage guidance without device access. Running `wonkey firmware` or `wonkey firmware check` checks for official SayoDevice vendor firmware updates without modifying the device, and `wonkey firmware update` installs the latest official vendor firmware or recovers a SayoDevice in bootloader mode.

## Set the key

These commands change stored key and trigger settings:

```sh
./wonkey key f13
./wonkey key ctrl+shift+f13
./wonkey key ctrl+a
./wonkey key shift+1
./wonkey key f12
./wonkey key ctrl+left
./wonkey key mute
./wonkey key key2 f13
./wonkey trigger release
./wonkey trigger press
```

A key expression is the complete combination. `key f13` means **<kbd>F13</kbd> without modifiers**, not <kbd>F13</kbd> with the previous modifiers.

Use `wonkey key [CONTROL] <COMBINATION> [--layer N] [--device N]` with one base key from the [supported key names](#supported-key-names).
On multi-control CH57x (`1189` / `514c`) and SayoDevice (`8089`) macropads, `[CONTROL]` accepts `key1`..`key12`, `knob-left`, `knob-press`, `knob-right`, or `knob1-left`..`knob4-right` (validated per device and defaulting to `key1`), and `--layer` accepts `1..15` on CH57x devices or `1..5` on SayoDevice devices (defaulting to `1`). On single-key XFKEY One Key Max (`0112`), `[CONTROL]` and `--layer` are rejected (`XFKEY One Key Max (0112) has a single key and does not support ...` / `XFKEY One Key Max (0112) does not support --layer`).
Names cover letters, digits, function keys, punctuation keys, navigation, keypad keys, and defined keyboard usages through `0x91` on `0112` (or `0x04..0x73` on CH57x and SayoDevice).
Use names such as `semicolon` and `keypadplus`, not punctuation symbols or raw usage numbers.
The `key` command does not accept mouse or consumer media names, or a `--on` flag. Multi-stroke sequences use `macro`, and right-hand modifiers remain unsupported.
Prefix modifiers with `+`: `ctrl`, `shift`, `alt`, and `super`, each at most once.
`super` is the <kbd>Super</kbd>/<kbd>Windows</kbd>/<kbd>Command</kbd> modifier. Put the base key last. Names ignore letter case.

Uppercase names do not imply <kbd>Shift</kbd>: `A` and `a` select the same key. Use `shift+a` to include <kbd>Shift</kbd>.
Names select USB Human Interface Device (HID) keyboard usages, not guaranteed text. The active host layout and modifiers determine the output.
`mute`, `volumeup`, and `volumedown` select keyboard-page usages, not consumer-page media commands.
`power` selects the keyboard Power usage. The host determines its effect.

`key <COMBINATION>` preserves an existing keyboard trigger on `0112`, or defaults to `press` when replacing another action.
Use `wonkey trigger <press|release|both> [--device N]` on `0112` to change when the configured keyboard key fires; `trigger` requires a keyboard key to be configured on `0112` and is rejected on CH57x and SayoDevice pads.
Repeated modifiers, unsupported keys, and extra arguments are rejected before device access.
Key and trigger changes preserve lighting and unrelated bytes. Conversion to or from a keyboard action with `both` is rejected because separate release fields remain uncertain.

Hardware tests confirmed <kbd>F13</kbd> events and persistence on XFKEY One Key Max (`0112`), key bindings on CH57x Macropads (`1189:8890`, `514c:8851`, and `514c:8850`), and key bindings on SayoDevice 2x3P (`8089:000c`), as recorded in [hardware verification](protocol#hardware-verification).
All other selectable keys remain hardware-unverified. The captured descriptor confirms that the added usages fit, not that firmware executes them.
Desktop keymaps can show different symbols for function keys. Check the key name in your target shortcut editor.

## Mouse, media, and macro actions

Each command changes the complete action on a supported device (`0112`, CH57x `1189` / `514c`, or SayoDevice `8089`). Run `./wonkey` without arguments to read the current action and lighting.

| Command | Example | Input and limits |
|---|---|---|
| `mouse` | `./wonkey mouse left+right --x=-20 --y 10 --wheel -1` | Syntax: `wonkey mouse [CONTROL] <BUTTONS> [--x N] [--y N] [--wheel N] [--layer N] [--device N]`. Use `left`, `right`, `middle`, or a `+` combination without repeats. Use `none` alone for no button, or `wheelup` or `wheeldown` alone for one tick. `--x`, `--y`, and `--wheel` take integers from `-127` to `127`; omitted values are zero. Do not combine a wheel name with `--wheel`. |
| `media` | `./wonkey media playpause`, `./wonkey media knob-right volumeup` | Syntax: `wonkey media [CONTROL] <ACTION\|0xHHHH> [--layer N] [--device N]`. Use a name below or `0xHHHH` with exactly four hexadecimal digits. The usage must be `0x0001` to `0x023c` on `0112` (or one of the device-supported media usages on CH57x and SayoDevice). |
| `macro` | `./wonkey macro a,f13,enter --interval 50 --repeat 2`, `./wonkey macro key3 ctrl+c,ctrl+v --layer 2` | Syntax: `wonkey macro [CONTROL] <STROKE[,STROKE...]> [--interval MS] [--repeat COUNT] [--layer N] [--device N]`. Replaces `multi`. On `0112`, use 1 to 115 comma-separated base key names from [supported key names](#supported-key-names) without modifiers or raw usage numbers; `--interval` takes 1 to 65535 milliseconds (default 50) and `--repeat` takes 1 to 255 (default 1). On CH57x (`1189` / `514c`), use 1 to 5 comma-separated strokes (`0x04..0x73`) including optional per-stroke modifiers such as `ctrl+c,ctrl+v`, without `--interval` or `--repeat`. On SayoDevice (`8089`), use 1 to 3 comma-separated strokes (`0x04..0x73`, with optional modifiers on 1-stroke or 2-stroke sequences, or on stroke 1 of a 3-stroke sequence), without `--interval` or `--repeat`. |

On multi-control CH57x (`1189` / `514c`) and SayoDevice (`8089`) devices, `mouse`, `media`, and `macro` accept an optional `[CONTROL]` (`key1`..`key12`, `knob-left`, `knob-press`, `knob-right`, `knob1-left`..`knob4-right`, validated per device and defaulting to `key1`) before the action argument and `--layer <1..15>` on CH57x or `--layer <1..5>` on SayoDevice (defaulting to `1`). On single-key `0112` devices, `[CONTROL]` and `--layer` are rejected (`XFKEY One Key Max (0112) has a single key and does not support ...` / `XFKEY One Key Max (0112) does not support --layer`).

Media names ignore case: `play`, `pause`, `record`, `fastforward`, `rewind`, `next`, `prev`, `previous`, `stop`, `eject`, `playpause`, `mute`, `volumeup`, `volumedown`, `calculator`, `mycomputer`, `browser`, `email`, `search`, `home`, `back`, `forward`, `refresh`, and `bookmarks`.
`prev` and `previous` select the same usage. A raw usage within the bound does not prove that the device or host supports its effect.
Media, mouse, and macro actions replace the complete current action, not only one field.
The `media` command uses HID consumer page `0x0c`. In contrast, `key mute` uses keyboard page `0x07`.

Mouse values are signed relative movement, not pointer positions. `wheelup` means `+1` and `wheeldown` means `-1`.
On `0112`, the `macro` key limit stops at configuration byte 119, so bytes 120 to 123 remain unchanged.
The options accept `--name VALUE` or `--name=VALUE` and each option can appear once. Repeated names, invalid values, and extra actions fail before device access.
See [wire layouts and evidence](protocol#action-layouts) for the stored fields and [hardware verification](protocol#hardware-verification) for tested actions on CH57x and SayoDevice hardware.

## Lighting

These commands change or validate lighting settings:

```sh
./wonkey rgb static 0000ff
./wonkey rgb static
./wonkey rgb off
./wonkey led reactive
./wonkey led cycle
./wonkey led off
```

`wonkey rgb <MODE> [RGB] [--device N]` configures RGB lighting on XFKEY One Key Max (`0112`) and supported SayoDevice Macropads (`8089:0002..0005`, `0009..000c`, `000e`), and is rejected on CH57x devices with a hint to use `wonkey led`.
`static`, `breathe`, `flash`, `held`, and `toggle` (on `0112`) accept an optional colour: exactly six hexadecimal digits without `#`.
`0000ff` is blue. Omit the colour to preserve all three RGB bytes.
`cycle-slow`, `cycle-fast`, and `off` do not use a colour. They reject supplied colours before device access and preserve the stored colour.
RGB commands preserve the current typed action and unrelated bytes.

`wonkey led <MODE> [--device N]` configures LED backlight mode (`off`, `reactive`, or `cycle`, encoded as mode indices `0`, `1`, and `2`) on CH57x Macropads (`1189` / `514c` : `8830..8833`, `8840`, `8842`, `8850`, `8851`, `8890`) and is rejected on `0112` and SayoDevice pads with a hint to use `wonkey rgb`. Hardware checks confirmed `off`, `reactive`, and `cycle` backlight modes on a 3-key, 1-knob CH57x Macropad (`1189:8890`), and live LED programming on `514c:8851` and `514c:8850`.

| Mode | Description | Stored byte |
|---|---|---|
| `static` | Single static colour | `02` |
| `breathe` | Single breathing colour | `03` |
| `cycle-slow` | Full-colour slow cycle | `01` |
| `cycle-fast` | Full-colour fast cycle | `05` |
| `flash` | Flash on click | `04` |
| `held` | On while pressed, off on release | `07` |
| `toggle` | Toggle on click | `08` |
| `off` | Lights off | `06` |

Descriptions reflect user observations, not automated hardware verification. See [protocol evidence](protocol#evidence) for the original vendor labels.
Old public names are not accepted. WonKey has no brightness or speed option.

## Device selection and verification

WonKey enumerates compatible XFKEY One Key Max (`0112`), CH57x Macropads (`1189` / `514c`: `8890`, `8830..8851`), and SayoDevice Macropads (`8089`) together and sorts them deterministically by USB physical path (`1-1.2` before `1-1.10` before `2-1`), assigning `1..N` device IDs shown as `[1]`, `[2]`, and so on.
Bare `wonkey` inspects all compatible devices without modifying them.
For changes (`key`, `trigger`, `macro`, `mouse`, `media`, `rgb`, and `led`), one compatible device is selected automatically as `[1]`.
When multiple compatible devices are connected, pass `--device <N>` (or `--device=<N>`) to select the target device; omitting `--device` or passing an out-of-range number fails before opening any device node.

When applying a change, WonKey inspects the selected device, shows its `[N]` heading, and prints the proposed change (current-to-proposed values where readable on `0112`, CH57x Gen 2 `1189`/`514c`, and SayoDevice `8089`, or `write-only -> <value>` on write-only firmware and unpopulated slots).
On `0112`, if the requested setting already matches the current configuration, WonKey skips the write without sending a settings upload or commit.

Before writing to `0112`, WonKey revalidates the selected descriptors, node, physical path, identifier, and version, and performs a fresh readback to check for settings drift before upload. Any settings drift stops the transaction, including drift in unrelated bytes or drift that makes the request a no-op.

After `AF02` upload and `AF04` commit on `0112`, WonKey reads back and compares all 128 configuration bytes in memory. On CH57x Gen 1 (`1189:8890`, `514c:8890`), WonKey probes the device, shows the proposed change, revalidates the USB descriptors and interface 1 report descriptor, and writes the 64-byte report sequence to endpoint `0x02`. On CH57x Gen 2 (`1189`/`514c`: `8830..8851`), WonKey probes the layout and Layer 1 bindings, shows the proposed change, revalidates the USB descriptors and vendor hidraw node, and writes the 65-byte report ID 3 sequence. On SayoDevice (`8089`), WonKey probes the layout and bindings, shows the proposed change, revalidates the USB descriptors and vendor hidraw node, and runs a read-modify-write-ACK and save transaction over 64-byte hidraw reports. A failure stops without retry or rollback.
A submitted write can still complete after timeout. Stop when the tool reports uncertain state.
Persistence after reconnect and observed key/lighting effects require separate hardware checks.

## Supported configuration fields

| Field | Configuration byte |
|---|---|
| Trigger | 1 |
| Keyboard modifier mask | 2 |
| Keyboard base key (HID usage below) | 4 |
| Lighting mode | 124 |
| RGB channels | 125 to 127 |

Byte 0 selects the action type on `0112`: `00` keyboard, `01` mouse, `02` media, or `03` multi-key (`macro`). Keyboard byte 3 must be `01`.
Changes accept only validated actions and RGB modes. WonKey changes active action bytes and explicit RGB fields, and preserves other bytes.
Unknown action types, invalid fields, and unsupported special, macro (`06`), or touch layouts fail closed for changes, even for RGB-only changes.
For exact offsets, see [action layouts](protocol#action-layouts).

### Supported key names

Each row lists names in usage order. Ranges include both ends.
Help and output use these canonical names.

| Base key names | HID usage at byte 4 |
|---|---|
| `a` to `z` | `0x04` to `0x1d` |
| `1` to `9`, `0` | `0x1e` to `0x27` |
| `enter`, `esc`, `backspace`, `tab`, `space` | `0x28` to `0x2c` |
| `minus`, `equal`, `leftbracket`, `rightbracket`, `backslash`, `nonushash` | `0x2d` to `0x32` |
| `semicolon`, `apostrophe`, `grave`, `comma`, `period`, `slash`, `capslock` | `0x33` to `0x39` |
| `f1` to `f12` | `0x3a` to `0x45` |
| `printscreen`, `scrolllock`, `pause`, `insert`, `home`, `pageup` | `0x46` to `0x4b` |
| `delete`, `end`, `pagedown`, `right`, `left`, `down`, `up` | `0x4c` to `0x52` |
| `numlock`, `keypaddivide`, `keypadmultiply`, `keypadminus`, `keypadplus`, `keypadenter` | `0x53` to `0x58` |
| `keypad1` to `keypad9`, `keypad0`, `keypadperiod` | `0x59` to `0x63` |
| `nonusbackslash`, `application`, `power`, `keypadequal` | `0x64` to `0x67` |
| `f13` to `f24` | `0x68` to `0x73` |
| `execute`, `help`, `menu`, `select`, `stop`, `again`, `undo` | `0x74` to `0x7a` |
| `cut`, `copy`, `paste`, `find`, `mute`, `volumeup`, `volumedown` | `0x7b` to `0x81` |
| `lockingcapslock`, `lockingnumlock`, `lockingscrolllock` | `0x82` to `0x84` |
| `keypadcomma`, `keypadequalas400` | `0x85` to `0x86` |
| `international1` to `international9` | `0x87` to `0x8f` |
| `lang1`, `lang2` | `0x90` to `0x91` |

Accepted aliases are `escape` for `esc`, `pgup` for `pageup`, and `pgdn` for `pagedown`.
`arrowright`, `arrowleft`, `arrowdown`, and `arrowup` select `right`, `left`, `down`, and `up`.
No other aliases are accepted. `return` is not an alias because HID also defines a separate Return usage outside this range.

`delete` is forward Delete, not Backspace. `application` and `menu` are distinct usages.
The `locking*` names select distinct locking usages, not the ordinary lock keys.
Keypad effects depend on the host layout and Num Lock state.
The `nonus*`, `international*`, and `lang*` names identify usages without assuming a national layout.

The [USB HID Usage Tables](https://www.usb.org/sites/default/files/hut1_7.pdf), keyboard/keypad page `0x07`, define these values.
The captured keyboard descriptor has a usage maximum of `0x91` and a logical maximum of `0xff`.
WonKey rejects no-event, error, reserved, and out-of-range usages. Descriptor coverage does not prove hardware effects or persistence.
See [protocol evidence](protocol#evidence) for upstream encoding and fixture sources.

## Output and options

Human output is not a machine-readable contract. Redirected output, `TERM=dumb`, and non-empty `NO_COLOR` produce plain text.
True-colour terminals also show a configured RGB swatch. The swatch does not prove the observed LED colour.
Output escapes control characters in external text.

Public flags are `-h`/`--help`, `--device`, `--layer`, `mouse --x`/`--y`/`--wheel`, and `macro --interval`/`--repeat`.
Unknown or retired commands and flags, including `multi`, `show`, `set`, `advanced`, `apply`, `plan`, `--on`, `--report`, `--json`, `--yes`, and `--dry-run`, fail before hardware access.
There is one executable, `wonkey`. The developer executable, protocol commands, and helper scripts are removed.
WonKey has no arbitrary packet sender or reset command, and `wonkey firmware` supports only official SayoDevice vendor firmware checks and updates.
