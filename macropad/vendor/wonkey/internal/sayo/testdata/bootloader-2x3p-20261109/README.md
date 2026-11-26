# Authentic SayoDevice 2x3P bootloader capture

These files are byte-for-byte copies of a read-only sysfs capture from 9 November 2026 at 10:58:32 UTC.
The device was a SayoDevice 2x3P (`8089:000c`, HID v2 application, manifest directory 12) at USB path `7-1.4.3.4`.
It was in bootloader mode after the HID v2 `0x0E` entry packet. No hidraw or USB device node was opened for the capture.

| File | Source |
| --- | --- |
| `descriptors` | `/sys/bus/usb/devices/7-1.4.3.4/descriptors`, 59 bytes |
| `report_descriptor` | `/sys/bus/usb/devices/7-1.4.3.4/7-1.4.3.4:1.0/0003:8089:000C.0031/report_descriptor`, 54 bytes |
| `uevent` | `/sys/bus/usb/devices/7-1.4.3.4/7-1.4.3.4:1.0/0003:8089:000C.0031/uevent` |

The capture also recorded these values, which the tests use to build a temporary sysfs tree:

- `idVendor` `8089`, `idProduct` `000c`, `bcdDevice` `089a`, `bNumInterfaces` `1`, `speed` `12`
- `product` `Bootloader`, `manufacturer` `SayoDevice`
- `busnum` `7`, `devnum` `36`, `dev` `189:803`
- HID device `0003:8089:000C.0031` on interface `1.0`, with the single node `hidraw5`
- Interface `1.0` entries: `0003:8089:000C.0031`, `authorized`, `bAlternateSetting`, `bInterfaceClass`, `bInterfaceNumber`, `bInterfaceProtocol`, `bInterfaceSubClass`, `bNumEndpoints`, `driver`, `ep_03`, `ep_82`, `modalias`, `power`, `subsystem`, `supports_autosuspend`, `uevent`, `usbmisc`

The bootloader keeps the application PID `0x000c` and reports the product string `Bootloader`.
Its report descriptor starts `06 a0 ff 09 01 a1 01 85 02` (vendor usage page `0xFFA0`, report ID `0x02`).

This is enumeration evidence only. It does not record a `GET_BOOT_VERSION` or `CHECK_FW` reply, and it does not prove a firmware write.
Never change these files to fit code. Copy them to a temporary directory before a corruption test.
