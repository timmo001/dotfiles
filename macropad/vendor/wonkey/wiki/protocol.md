# Protocol and evidence

[Wiki home](Home) · [Development](development)

WonKey reads and writes macropad settings through each supported device's USB or vendor HID interface.
This reference records reply layouts, report encodings, and the evidence behind the implementation.

[Hardware verification](#hardware-verification) · [Reply layout](#reply-layout) · [Action layouts](#action-layouts) · [Source evidence](#evidence)

See [device selection](hardware#device-selection-and-access) for descriptor requirements and [apply safety](hardware#apply-safety) for upload framing.

## Hardware verification

### XFKEY One Key Max (`0112`)

The authentic user fixture in `internal/xfkey/testdata/hardware-20260911` confirms identify/readback framing on this unit:
model `0112`, version `1014`, identifier `be077ba2`, <kbd>Enter</kbd> on press without modifiers, and RGB API mode 0 with channels `255,255,255`.
The four report descriptors also match. Separate user-run tests confirmed upload/commit echoes and full 128-byte readback after <kbd>F13</kbd> and steady-blue changes.
The user confirmed <kbd>F13</kbd> press/release events, steady-blue RGB, and persistence of both settings after reconnect.
All other selectable keys on `0112`, including the added keyboard usages through `0x91`, and all mouse, consumer media, and macro (`03` multi-key) actions on `0112` remain hardware-unverified.
Existing parser output and fixture metadata retain the status `host-derived, hardware-unverified`.
The included query fixture does not record the later upload tests.

### CH57x Macropad (`1189:8890`)

Hardware checks on a 3-key, 1-knob CH57x Macropad (`1189:8890`) unit confirmed:

- Inspection via `GET_REPORT` Input report ID 3 returning the 1-byte `0xaa` status response on stock write-only firmware.
- Keyboard bindings on `key1`..`key3` via report ID `0x03` sequences on interrupt OUT endpoint `0x02`.
- Rotary knob consumer media actions on `knob-left`, `knob-right`, and `knob-press` (volume down, volume up, and mute).
- LED backlight modes via `wonkey led` (`off` = `0`, `reactive` = `1`, `cycle` = `2`, encoded with `03 a1 01`, `03 b0 18 <mode>`, and `03 aa a1`).

Other controls (`key4`..`key12`, `knob2`..`knob3`), higher layers (`2..15`), mouse actions, multi-stroke macros, and unverified keyboard/media usages on `1189:8890` remain hardware-unverified.

### CH57x Macropad (`1189` / `514c` : `8830`, `8831`, `8832`, `8833`, `8840`, `8842`, `8850`, `8851`)

Hardware checks on a 4-key, 1-knob (`514c:8851`, `kind = 0`) unit and a 12-key, 4-knob (`514c:8850`, `kind = 11`) unit confirmed:

- Layout discovery via 65-byte report ID `0x03` command `0xFB` (`03 fb fb fb`) on interface 0 `hidraw` returning `[0x03, 0xfb, keys, knobs, kind, ...]`.
- Layer 1 slot binding readback via `0xFA` (`03 fa 0f 03 01` returning 24 reports on `kind < 10`, and `03 fa 19 00 01` returning 25 reports on `kind >= 10`, with a write-only layout fallback when `0xFA` times out).
- Live programming of `key`, `macro`, `mouse`, `media`, and `led` via `0xFE` (`kind < 10`) and `0xFD` (`kind >= 10`) report sequences.

### SayoDevice Macropads (`8089:0002..0005`, `0009..000c`, `000e`)

Hardware checks on a 6-key SayoDevice 2x3P (`8089:000c`, `bcdDevice = 0x089a`) unit confirmed:

- SayoDevice HID v2 (`Report ID 0x21`, 64-byte packets on interface 1 `hidraw` with 16-bit little-endian word checksum at `pkt[2..3]`).
- Dynamic key and rotary knob (`key_type` `0`, `1`, `2`) discovery and Layer 1..5 slot readback via `cmd_id = 0x10` on v2 (`index = 0..5`, with `index = 6` returning `rx[5] = 0x40`).
- Per-key RGB lighting readback via `cmd_id = 0x11` on v2 (`index = 0`, factory default `00 01 64 64 40 40 40 00` -> `held`, `#404040`).
- Read-modify-write programming of `key`, `macro`, `mouse`, `media` (`cmd_id = 0x10`) and `rgb` (`cmd_id = 0x11`) preserving the button geometry header, committed with Save (`cmd_id = 0x0D` on v2).
- Firmware version and model code query via `cmd_id = 0x00` (`Info`) on v2 and manifest lookup on `a.sayobot.cn/firmware/update/12/config.json`.

SayoDevice HID v1 (`Report ID 0x02` on `0xFF00` with 8-bit sum checksum, firmware version and model code query via `cmd = 0x00` (`Info`), slot readback and programming via `cmd = 0x16`, RGB readback and programming via `cmd = 0x10`, and Save via `cmd = 0x04` for `8089:0002..0005`), bootloader mode outside directory 12 (`CHECK_FW` (`0x01`) version query and flashing via `GET_BOOT_VERSION` (`0x00`), `CHECK_FW` (`0x01`), `ERASE_FLASH` (`0x04`), `WRITE_DATA` (`0x02`), `VERIFY` (`0x05` / `0x06`), and `EXECUTE_APP` (`0x03`)), and the other untested PIDs (`8089:0009..000b`, `000e`) are host-derived from protocol documentation and remain hardware-unverified.

A read-only sysfs capture of the 2x3P in bootloader mode (`internal/sayo/testdata/bootloader-2x3p-20261109`) confirmed the enumeration only:

- The bootloader keeps `8089:000c`, as the manifest `pid2` value 12 states, and reports the product `Bootloader`.
- It has one HID interface (interface 0, HID 1.10, interrupt endpoints `0x82` IN and `0x03` OUT, 64 bytes each) with one `hidraw` node.
- Its 54-byte report descriptor starts `06 a0 ff 09 01 a1 01 85 02` (usage page `0xFFA0`, report ID `0x02`, HID v1 framing).

On 2026-11-09, a user-authorised update flashed a 2x3P (directory 12) from firmware 2202 (`0x089a`) to 2214 (`0x08a6`) through the full bootloader sequence, 49152 bytes in 32-byte `WRITE_DATA` chunks. The application then enumerated with `bcdDevice` `0x08a6`, and `wonkey firmware check` reported 2214. After `EXECUTE_APP`, the device stayed in bootloader mode for some seconds before it restarted by itself. The post-flash restart wait and version confirmation remain hardware-unverified. Bootloader handshakes and flashing in other directories remain hardware-unverified. HID v1 directories 2 to 5 give manifest `pid2` values `8089:0006..0009` for bootloader mode, which are unconfirmed on hardware. The 2x3P bootloader (directory 12) keeps `8089:000c`, confirmed by capture.

Bootloader checksums follow the official tool. The manifest `hid_checksum` value applies only to `WRITE_DATA`. WonKey always signs `GET_BOOT_VERSION` (`02 00 00 02`), `CHECK_FW` (`02 01 00 03`), `ERASE_FLASH`, `VERIFY`, and `EXECUTE_APP` with the 8-bit sum, which includes the report ID. This rule also applies to the `CHECK_FW` query from bare `wonkey`. The evidence is the [official Flutter app](https://app.sayodevice.com/) (fetched 2026-11-09). In `main.dart.js`, the bootloader check uses constant signed packets, and the upgrade routine appends a sum to `ERASE_FLASH`, `VERIFY`, and `EXECUTE_APP` without a check of `hid_checksum`. Only the `WRITE_DATA` loop in `sayo_lib_rs_bg.wasm` tests `hidCheckSum != 0`. The older official tool signs every packet. Only directory 2 sets `hid_checksum` 0. Its packets have tests, but they are unverified on directory 2 hardware.

## Reply layout

Each reply contains exactly 64 vendor bytes, without a Linux report-ID placeholder.
The public executable has no offline parser or protocol command interface.
The internal parser and authentic fixtures retain the raw protocol evidence.

Identify has model at offsets 2 to 3, version at 4 to 5, both big-endian, and identifier at 6 to 9.
Readback copies `RX6[2:64]` to `C[0:62]`, `RX7[2:64]` to `C[62:124]`, and `RX8[2:6]` to `C[124:128]`.
The authentic fixture retains all raw replies, including unused RX8 bytes.
Internal parsing retains unknown RGB values, labelled `unknown`.

See [lighting](usage#lighting) for public modes and [configuration fields](usage#supported-configuration-fields) for writable offsets.

## Action layouts

The 128-byte configuration uses byte 0 as an action type. These layouts apply only to model `0112` with the exact checked descriptors.

| Type | Active bytes | Validation |
|---|---|---|
| `00` keyboard | 1 trigger (`01` press, `02` release, `03` both), 2 left-modifier mask (`0x00` to `0x0f`), 3 count (`01`), 4 keyboard-page usage | Defined keyboard usages `0x04` to `0x91`; right modifiers are unsupported. |
| `01` relative mouse | 1 button bitmap (left `01`, right `02`, middle `04`), 2 signed X, 3 signed Y, 4 signed wheel | Button mask `0..7`; X, Y, and wheel each `-127..127` (signed byte). |
| `02` consumer media | 1 low usage byte, 2 high usage byte | Consumer-page usage `0x0001..0x023c`; little-endian bytes, for example volume up `0x00e9` is `e9 00`. |
| `03` multi-key (`macro`) | 1 to 2 interval in milliseconds (big-endian), 3 repeat count, 4 key count, 5 onward keyboard-page usage bytes | Interval `1..65535`, repeat `1..255`, count `1..115`; each key uses the supported keyboard name table. |

The `03` multi-key (`macro`) count stops at 115 because keys occupy bytes 5 to 119. WonKey preserves bytes 120 to 123 and RGB bytes 124 to 127.
Only active fields change. On a type change, WonKey clears the previous active span. On a shorter same-type action, it clears retired active bytes.
It preserves unknown bytes outside those spans. Keyboard trigger `both` can involve separate release fields, so conversion to or from another type is rejected.
Unsupported special (`04`), macro (`06`), touch (`07`), unknown types, and malformed known actions fail closed, including RGB-only changes.
The public command is not a raw packet writer. See [action syntax](usage#mouse-media-and-macro-actions).

## Evidence

Sources are pinned to `cuylerstuwe/xfkey-cross-platform` commit `d86f50af54c5ce6395c41c958f8598d42e1d8a15`:

- [TECH.md descriptors and protocol](https://github.com/cuylerstuwe/xfkey-cross-platform/blob/d86f50af54c5ce6395c41c958f8598d42e1d8a15/TECH.md). Some descriptor lengths and its identify layout are incorrect.
- [Python encoder, configuration and framing](https://github.com/cuylerstuwe/xfkey-cross-platform/blob/d86f50af54c5ce6395c41c958f8598d42e1d8a15/flash_xfkey.py#L284-L323) documents mouse, media, and multi-key bytes. The [upload code](https://github.com/cuylerstuwe/xfkey-cross-platform/blob/d86f50af54c5ce6395c41c958f8598d42e1d8a15/flash_xfkey.py#L326-L428) documents framing.
- [Python key table](https://github.com/cuylerstuwe/xfkey-cross-platform/blob/d86f50af54c5ce6395c41c958f8598d42e1d8a15/flash_xfkey.py#L165-L181) supplies a subset of the [supported HID usages](usage#supported-key-names), including letters, digits, Enter, and F1-F24.
- [Browser encoder](https://github.com/cuylerstuwe/xfkey-cross-platform/blob/d86f50af54c5ce6395c41c958f8598d42e1d8a15/examples/listener-web/index.html#L402-L454) also stores media low byte first.
- [Vendor executable, static analysis only](https://github.com/cuylerstuwe/xfkey-cross-platform/blob/d86f50af54c5ce6395c41c958f8598d42e1d8a15/xfp-win/xfp-win.exe), SHA-256 `0fdd932071b00064cf63b91c34d70b2be13ded06f14ce03f46c38dbd8a2b510c`.
- [Vendor database](https://github.com/cuylerstuwe/xfkey-cross-platform/blob/d86f50af54c5ce6395c41c958f8598d42e1d8a15/xfp-win/userdata.db), five “One Key Max” rows with type 274 (`0112`).

Vendor executable evidence: big-endian model at VA `0046A989–0046A9A1`, version at `0046AB17–0046AB27`, identifier at `0046A9BD–0046AA15`, readback copies at `0046ACEF–0046AE71`, and full configuration copy at `0042E8A0–0042E8D6`.
RGB strings are at file offsets `000A6D46–000A6DA9`, indexed insertion at VA `00435234–00435618`, and assignment at `00436110–00436121`.
The authentic fixture confirms queries only.

Public names differ from the historical vendor interpretations retained by the internal parser and fixture metadata:

| Public mode | Stored byte | Historical vendor interpretation | Former public name |
| --- | --- | --- | --- |
| `static` | `02` | Single-colour steady | `steady` |
| `breathe` | `03` | Single-colour flowing | `flowing` |
| `cycle-slow` | `01` | Full-colour gradient | `gradient` |
| `cycle-fast` | `05` | Neon flowing | `neon` |
| `flash` | `04` | Flash on click | unchanged |
| `held` | `07` | On while pressed, off on release | unchanged |
| `toggle` | `08` | Toggle on click | unchanged |
| `off` | `06` | Lights off | unchanged |

The public descriptions reflect user observations. The rename does not add automated hardware verification or change protocol values.
Former names are not aliases.

The [USB HID Usage Tables](https://www.usb.org/sites/default/files/hut1_7.pdf), section 10, define keyboard/keypad usages on page `0x07`.
WonKey accepts the defined key usages from `0x04` through `0x91`, excluding the preceding no-event and error values.
The captured keyboard descriptor has a usage maximum of `0x91` and a logical maximum of `0xff`.
The accepted usages fit the existing single-key configuration field.
This confirms representation, not firmware execution. WonKey now accepts consumer-page media, but not right-hand modifiers.
The vendor's pre-swapped integer constants represent bytes in the opposite display order. The pinned Python and browser encoders write the low usage byte first, so `0x00e9` stores `e9 00`, not `00 e9`.
The [HID Usage Tables](https://www.usb.org/sites/default/files/hut1_7.pdf), consumer page `0x0c`, define media usages. The upper bound `0x023c` follows the upstream supported range, not a claim that every value has a device effect.
