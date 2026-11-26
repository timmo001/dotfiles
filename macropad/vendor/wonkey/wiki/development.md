# Development

[Wiki home](Home) · [Protocol and evidence](protocol)

WonKey is a Linux CLI for configuring supported USB macropads: XFKEY One Key Max (`af88:6688` model `0112`), CH57x Macropad (`1189` / `514c` : `8830..8833`, `8840`, `8842`, `8850`, `8851`, `8890`), and SayoDevice Macropad (`8089:0002..0005`, `0009..000c`, `000e`, plus HID v1 bootloader PIDs `0006..0009` from manifest `pid2` for directories 2 to 5, unconfirmed. The 2x3P bootloader keeps `000c`, confirmed by capture).
It has one executable: bare `wonkey` inspects connected macropads, `key`, `trigger`, `macro`, `mouse`, `media`, `rgb`, and `led` validate device capabilities and configure supported devices, and `firmware` checks or updates official vendor firmware on SayoDevice macropads.
`cmd/wonkey` handles process entry and exit. CLI, protocol, and unified Linux device discovery across `internal/xfkey` (`af88:6688` model `0112`), `internal/ch57` (`1189` / `514c` : `8830..8833`, `8840`, `8842`, `8850`, `8851`, `8890`), and `internal/sayo` (`8089:0002..0005`, `0009..000c`, `000e`, plus HID v1 bootloader PIDs `0006..0009` from manifest `pid2` for directories 2 to 5, unconfirmed. The 2x3P bootloader keeps `000c`, confirmed by capture) stay in `internal/`.

## Offline checks

Run the [build and test checks](https://github.com/wimpysworld/WonKey/blob/main/AGENTS.md#build-and-test) from the project root.
They use synthetic transports without connected hardware.

The [protocol reference](protocol) records framing, configuration fields, and pinned source evidence.
The developer executable, legacy command interfaces, and helper scripts are removed.

## Evidence fixtures

Keep `internal/xfkey/testdata/hardware-20260911` byte-for-byte unchanged, including warnings, paths, and genuine hardware identifiers.
Copy fixtures to temporary directories before corruption tests.

The authentic fixture confirms query framing.
Do not modify evidence to match changed output.
Query fixtures do not prove upload effects or persistence after reconnect.

See [hardware safety](hardware#apply-safety) before changing transaction order.
