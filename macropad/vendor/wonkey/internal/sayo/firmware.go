package sayo

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"io/fs"
	"net/http"
	"path/filepath"
	"strings"
	"time"

	"golang.org/x/sys/unix"
)

// FirmwareCDNBaseURL is the official SayoDevice firmware update CDN root.
const FirmwareCDNBaseURL = "https://a.sayobot.cn/firmware/update"

// FirmwareManifestCmds holds optional command overrides in a vendor config.json manifest.
type FirmwareManifestCmds struct {
	GetBootVersion byte `json:"get_boot_version"`
	CheckFW        byte `json:"check_fw"`
	WriteData      byte `json:"write_data"`
	ExecuteApp     byte `json:"execute_app"`
	EraseFlash     byte `json:"erase_flash"`
	Verify         byte `json:"verify"`
}

// FirmwareManifest describes a SayoDevice PID's vendor firmware update manifest (config.json).
type FirmwareManifest struct {
	VID             int                     `json:"vid"`
	PID             int                     `json:"pid"`
	PID2            int                     `json:"pid2"`
	AddrLen         int                     `json:"addr_len"`
	BootInfoAddr    int                     `json:"boot_info_addr"`
	AddrByteOrderBE int                     `json:"addr_byte_order_be"`
	EncryptFlag     int                     `json:"encrypt_flag"`
	EraseFlash      int                     `json:"erase_flash"`
	HIDChecksum     *int                    `json:"hid_checksum"`
	HIDErrForSize   int                     `json:"hid_err_for_size"`
	Cmd             FirmwareManifestCmds    `json:"cmd"`
	Data            []FirmwareManifestEntry `json:"data"`
}

// FirmwareManifestEntry describes a single hardware model's firmware image in config.json.
type FirmwareManifestEntry struct {
	Model     string `json:"model"`
	ModelCode uint16 `json:"model_code"`
	ROMSize   int    `json:"rom_size"`
	Version   uint16 `json:"version"`
	FilePath  string `json:"file_path"`
}

// UseChecksum reports whether bootloader WRITE_DATA packets use the 8-bit V1 sum checksum.
// Every other bootloader packet is always signed.
// When hid_checksum is omitted in config.json (such as PID 10), it defaults to 1 (true).
func (m FirmwareManifest) UseChecksum() bool {
	if m.HIDChecksum == nil {
		return true
	}
	return *m.HIDChecksum != 0
}

// VerifyCmd returns the manifest VERIFY command opcode, or 0x05 when the manifest omits it.
// The official tool uses `VERIFY ?? 5` whatever the hid_checksum value.
func (m FirmwareManifest) VerifyCmd() byte {
	if m.Cmd.Verify != 0 {
		return m.Cmd.Verify
	}
	return 0x05
}

// FindEntry locates the manifest entry matching a device's 16-bit model_code.
func (m FirmwareManifest) FindEntry(modelCode uint16) (FirmwareManifestEntry, bool) {
	for _, entry := range m.Data {
		if entry.ModelCode == modelCode {
			return entry, true
		}
	}
	return FirmwareManifestEntry{}, false
}

// ManifestURL returns the config.json URL for a SayoDevice application or bootloader PID.
func ManifestURL(baseURL string, pid uint16) string {
	return fmt.Sprintf("%s/%d/config.json", strings.TrimRight(baseURL, "/"), ManifestPID(pid))
}

// FirmwareBinaryURL validates filePath and returns the full firmware binary URL for pid.
func FirmwareBinaryURL(baseURL string, pid uint16, filePath string) (string, error) {
	trimmed := strings.TrimSpace(filePath)
	if trimmed == "" || strings.HasPrefix(trimmed, "/") || strings.Contains(trimmed, "..") || strings.Contains(trimmed, "://") || strings.ContainsAny(trimmed, "\\?#") {
		return "", fmt.Errorf("invalid firmware file_path %q in manifest", filePath)
	}
	return fmt.Sprintf("%s/%d/%s", strings.TrimRight(baseURL, "/"), ManifestPID(pid), trimmed), nil
}

// defaultHTTPGet downloads up to maxBytes from rawURL over HTTPS.
func defaultHTTPGet(rawURL string, maxBytes int) (data []byte, err error) {
	if !strings.HasPrefix(rawURL, "https://") {
		return nil, fmt.Errorf("refusing non-HTTPS firmware URL %q", rawURL)
	}
	client := &http.Client{
		Timeout: 15 * time.Second,
		CheckRedirect: func(req *http.Request, via []*http.Request) error {
			if req.URL.Scheme != "https" {
				return fmt.Errorf("refusing non-HTTPS redirect")
			}
			if len(via) >= 5 {
				return fmt.Errorf("too many redirects")
			}
			return nil
		},
	}
	req, err := http.NewRequestWithContext(context.Background(), http.MethodGet, rawURL, nil)
	if err != nil {
		return nil, err
	}
	resp, err := client.Do(req) // #nosec G107 -- URL scheme validated above and redirects restricted to HTTPS
	if err != nil {
		return nil, err
	}
	defer func() {
		if closeErr := resp.Body.Close(); closeErr != nil && err == nil {
			err = closeErr
		}
	}()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("HTTP %d from %s", resp.StatusCode, rawURL)
	}
	data, err = io.ReadAll(io.LimitReader(resp.Body, int64(maxBytes)+1))
	if err != nil {
		return nil, err
	}
	if len(data) > maxBytes {
		return nil, fmt.Errorf("response from %s exceeds %d bytes", rawURL, maxBytes)
	}
	return data, nil
}

// FetchFirmwareManifest downloads and parses the official SayoDevice config.json for pid.
func FetchFirmwareManifest(pid uint16) (FirmwareManifest, error) {
	return FetchFirmwareManifestFrom(FirmwareCDNBaseURL, pid, defaultHTTPGet)
}

// FetchFirmwareManifestFrom downloads and parses config.json using a caller-supplied HTTP getter.
func FetchFirmwareManifestFrom(baseURL string, pid uint16, httpGet func(string, int) ([]byte, error)) (FirmwareManifest, error) {
	url := ManifestURL(baseURL, pid)
	raw, err := httpGet(url, 1<<20)
	if err != nil {
		return FirmwareManifest{}, fmt.Errorf("fetch firmware manifest: %w", err)
	}
	var manifest FirmwareManifest
	if err := json.Unmarshal(raw, &manifest); err != nil {
		return FirmwareManifest{}, fmt.Errorf("decode firmware manifest: %w", err)
	}
	return manifest, nil
}

// FetchFirmwareBinary downloads the official SayoDevice firmware binary for pid and filePath.
func FetchFirmwareBinary(pid uint16, filePath string) ([]byte, error) {
	return FetchFirmwareBinaryFrom(FirmwareCDNBaseURL, pid, filePath, defaultHTTPGet)
}

// FetchFirmwareBinaryFrom downloads a firmware binary using a caller-supplied HTTP getter.
func FetchFirmwareBinaryFrom(baseURL string, pid uint16, filePath string, httpGet func(string, int) ([]byte, error)) ([]byte, error) {
	url, err := FirmwareBinaryURL(baseURL, pid, filePath)
	if err != nil {
		return nil, err
	}
	data, err := httpGet(url, 4<<20)
	if err != nil {
		return nil, fmt.Errorf("fetch firmware binary: %w", err)
	}
	return data, nil
}

// ValidateFirmwareBinary checks that fwBytes has a valid SayoDevice length, fits within entry.ROMSize,
// and satisfies optional manifest command opcode and address-length bounds.
func ValidateFirmwareBinary(fwBytes []byte, entry FirmwareManifestEntry, manifests ...FirmwareManifest) error {
	if len(fwBytes) < 64 || len(fwBytes)%16 != 0 {
		return fmt.Errorf("invalid SayoDevice firmware binary length %d", len(fwBytes))
	}
	if entry.ROMSize > 0 && len(fwBytes) > entry.ROMSize+16 {
		return fmt.Errorf("firmware binary length %d exceeds ROM limit %d", len(fwBytes), entry.ROMSize+16)
	}
	for _, m := range manifests {
		if m.Cmd.GetBootVersion != 0 ||
			(m.Cmd.CheckFW != 0 && m.Cmd.CheckFW != 1) ||
			(m.Cmd.WriteData != 0 && m.Cmd.WriteData != 2) ||
			(m.Cmd.ExecuteApp != 0 && m.Cmd.ExecuteApp != 3) ||
			(m.Cmd.EraseFlash != 0 && m.Cmd.EraseFlash != 4) ||
			(m.Cmd.Verify != 0 && m.Cmd.Verify != 5 && m.Cmd.Verify != 6) {
			return fmt.Errorf("unsupported bootloader command opcodes in manifest: %+v", m.Cmd)
		}
		if m.AddrLen == 2 && len(fwBytes) > 0xFFFF {
			return fmt.Errorf("firmware binary length %d exceeds 16-bit address limit", len(fwBytes))
		}
	}
	return nil
}

// QueryInfoPacketV2 returns the signed 64-byte HID v2 Info (0x00) query packet.
func QueryInfoPacketV2() Packet {
	pkt := Packet{0x21, 0x12, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00}
	SignPacketV2(&pkt)
	return pkt
}

// QueryInfoPacketV1 returns the signed 64-byte HID v1 Info (0x00) query packet.
func QueryInfoPacketV1() Packet {
	pkt := Packet{0x02, 0x00, 0x00}
	SignPacketV1(&pkt)
	return pkt
}

// BootloaderEntryPacketV2 returns the signed 64-byte HID v2 bootloader entry packet (cmd 0x0E).
func BootloaderEntryPacketV2() Packet {
	pkt := Packet{0x21, 0x12, 0x00, 0x00, 0x08, 0x00, 0x0e, 0x00, 0x96, 0x72, 0xff, 0x00}
	SignPacketV2(&pkt)
	return pkt
}

// BootloaderEntryPacketV1 returns the signed 64-byte HID v1 bootloader entry packet (cmd 0xFF).
func BootloaderEntryPacketV1() Packet {
	pkt := Packet{0x02, 0xff, 0x02, 0x72, 0x96}
	SignPacketV1(&pkt)
	return pkt
}

// Bootloader reply timeouts per step, in milliseconds. They match or exceed the official tool's waits.
const (
	bootGetVersionTimeoutMs = 2000
	bootCheckFWTimeoutMs    = 2000
	bootEraseFlashTimeoutMs = 5000
	bootWriteDataTimeoutMs  = 2000
	bootVerifyTimeoutMs     = 2000
)

// ReplyPrefixHex formats up to the first 8 bytes of a reply in hexadecimal, as evidence of the reply layout.
func ReplyPrefixHex(raw []byte) string {
	return fmt.Sprintf("% x", raw[:min(len(raw), 8)])
}

func bootStatusOK(rx Packet, errForSize int, allowOne bool) bool {
	status := rx[1]
	if errForSize != 0 {
		status = rx[2]
	}
	return status == 0x00 || (allowOne && status == 0x01)
}

func putBootUint32(dst []byte, v uint32, be bool) {
	if be {
		binary.BigEndian.PutUint32(dst, v)
	} else {
		binary.LittleEndian.PutUint32(dst, v)
	}
}

// The official tool signs every bootloader packet except WRITE_DATA regardless of hid_checksum.
// Only WRITE_DATA omits the checksum when hid_checksum is 0.

// BootGetVersionPacket returns the signed 64-byte bootloader GET_BOOT_VERSION (0x00) packet.
func BootGetVersionPacket() Packet {
	pkt := Packet{0x02, 0x00, 0x00}
	SignPacketV1(&pkt)
	return pkt
}

// BootCheckFWPacket returns the signed 64-byte bootloader CHECK_FW (0x01) packet.
func BootCheckFWPacket() Packet {
	pkt := Packet{0x02, 0x01, 0x00}
	SignPacketV1(&pkt)
	return pkt
}

// BootEraseFlashPacket returns the signed 64-byte bootloader ERASE_FLASH (0x04) packet.
func BootEraseFlashPacket(totalBytes uint32, be bool) Packet {
	pkt := Packet{0x02, 0x04, 0x04}
	putBootUint32(pkt[3:7], totalBytes, be)
	SignPacketV1(&pkt)
	return pkt
}

// BootWriteDataPacket returns a 64-byte bootloader WRITE_DATA (0x02) packet for one <=32-byte chunk,
// signed only when useChecksum is true.
func BootWriteDataPacket(addr uint32, addrLen int, be bool, encryptFlag int, chunk []byte, useChecksum bool) Packet {
	var pkt Packet
	pos := 3
	if addrLen == 2 {
		if be {
			binary.BigEndian.PutUint16(pkt[pos:pos+2], uint16(addr&0xffff))
		} else {
			binary.LittleEndian.PutUint16(pkt[pos:pos+2], uint16(addr&0xffff))
		}
		pos += 2
	} else {
		putBootUint32(pkt[pos:pos+4], addr, be)
		pos += 4
	}
	if encryptFlag == 1 {
		pkt[pos] = 0x01
		pos++
	}
	copy(pkt[pos:], chunk)
	pos += len(chunk)
	pkt[0] = 0x02
	pkt[1] = 0x02
	pkt[2] = byte((pos - 3) & 255)
	if useChecksum {
		SignPacketV1(&pkt)
	}
	return pkt
}

// BootVerifyPacket returns the signed 64-byte bootloader VERIFY (0x05 or 0x06) packet.
func BootVerifyPacket(verifyCmd byte, verifyBytes uint32, be bool) Packet {
	pkt := Packet{0x02, verifyCmd, 0x04}
	putBootUint32(pkt[3:7], verifyBytes, be)
	SignPacketV1(&pkt)
	return pkt
}

// BootExecuteAppPacket returns the signed 64-byte bootloader EXECUTE_APP (0x03) packet.
func BootExecuteAppPacket() Packet {
	pkt := Packet{0x02, 0x03, 0x00}
	SignPacketV1(&pkt)
	return pkt
}

// FirmwareProgressFunc reports cumulative firmware bytes written and total firmware size.
type FirmwareProgressFunc func(written, total int)

// FlashFirmware enters bootloader mode (when in app mode), waits for USB re-enumeration,
// and executes the bootloader erase, write, verify, and execute-app sequence.
func FlashFirmware(sysRoot, devRoot string, candidate DiscoveredCandidate, proto ProtocolVersion, inBootloader bool, manifest FirmwareManifest, entry FirmwareManifestEntry, fwBytes []byte, onProgress FirmwareProgressFunc) (ApplyResult, error) {
	return systemProbeOps().flashFirmware(sysRoot, devRoot, candidate, proto, inBootloader, manifest, entry, fwBytes, onProgress)
}

func isUSBRebootWriteErr(err error) bool {
	for _, target := range []error{
		unix.EPROTO, unix.EIO, unix.ENODEV, unix.ESHUTDOWN,
		unix.EPIPE, unix.ETIMEDOUT, unix.ECONNRESET, unix.ENOENT,
		unix.EILSEQ, unix.ECOMM, unix.EREMOTEIO,
	} {
		if errors.Is(err, target) {
			return true
		}
	}
	return false
}

// IsDeviceRestartErr reports whether err is a USB error that a restarting or disconnecting device returns.
func IsDeviceRestartErr(err error) bool {
	for _, target := range []error{unix.EPROTO, unix.ENODEV, unix.EIO, unix.ESHUTDOWN, unix.ENOENT} {
		if errors.Is(err, target) {
			return true
		}
	}
	return false
}

func (ops probeOps) flashFirmware(sysRoot, devRoot string, candidate DiscoveredCandidate, proto ProtocolVersion, inBootloader bool, manifest FirmwareManifest, entry FirmwareManifestEntry, fwBytes []byte, onProgress FirmwareProgressFunc) (result ApplyResult, err error) {
	if !filepath.IsAbs(devRoot) {
		return result, fmt.Errorf("USB device root must be absolute")
	}
	if err := ValidateFirmwareBinary(fwBytes, entry, manifest); err != nil {
		return result, err
	}
	if err := ops.revalidate(sysRoot, candidate); err != nil {
		return result, err
	}
	var bootFD int
	if !inBootloader {
		if err := ops.enterBootloader(sysRoot, devRoot, candidate, proto, &result); err != nil {
			return result, err
		}
		bootFD, err = ops.waitForBootloaderHidraw(sysRoot, devRoot, candidate, manifest, &result)
		if err != nil {
			return result, err
		}
	} else {
		bootFD, err = ops.openBootloaderHidraw(sysRoot, devRoot, candidate)
		if err != nil {
			return result, err
		}
	}
	rebootIssued := false
	defer func() {
		if closeErr := ops.close(bootFD); closeErr != nil && (!rebootIssued || !isUSBRebootWriteErr(closeErr)) {
			err = errors.Join(err, closeErr)
		}
	}()
	result.WriteAttempted = true
	if inBootloader {
		if err := ops.bootStepGetVersion(bootFD, &result); err != nil {
			return result, err
		}
	}
	return ops.flashBootloader(bootFD, manifest, entry, fwBytes, result, &rebootIssued, onProgress)
}

func (ops probeOps) openValidatedHidraw(sysRoot, devRoot string, candidate DiscoveredCandidate) (int, ProtocolVersion, error) {
	hidrawName, _, proto, wantMajor, wantMinor, err := ops.locateSayoHidraw(candidate)
	if err != nil {
		return -1, 0, err
	}
	fd, err := ops.openLocatedHidraw(sysRoot, devRoot, candidate, hidrawName, wantMajor, wantMinor)
	return fd, proto, err
}

func (ops probeOps) openLocatedHidraw(sysRoot, devRoot string, candidate DiscoveredCandidate, hidrawName string, wantMajor, wantMinor uint32) (int, error) {
	node := filepath.Join(hidrawRoot(devRoot), hidrawName)
	var named unix.Stat_t
	if err := ops.lstat(node, &named); err != nil {
		return -1, err
	}
	if err := checkHidrawNode(named, wantMajor, wantMinor); err != nil {
		return -1, err
	}
	fd, err := ops.open(node, unix.O_RDWR|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return -1, fmt.Errorf("open %s: %w", node, err)
	}
	if err := ops.validateHidrawOpen(sysRoot, node, fd, candidate, named, wantMajor, wantMinor); err != nil {
		_ = ops.close(fd)
		return -1, err
	}
	return fd, nil
}

// errApplicationDescriptor marks a vendor interface that still has the HID v2 application report descriptor.
var errApplicationDescriptor = errors.New("vendor interface has the HID v2 application report descriptor")

func (ops probeOps) openBootloaderHidraw(sysRoot, devRoot string, candidate DiscoveredCandidate) (int, error) {
	hidrawName, _, proto, wantMajor, wantMinor, err := ops.locateSayoHidraw(candidate)
	if err != nil {
		return -1, err
	}
	if proto != ProtocolV1 {
		return -1, fmt.Errorf("interface %d: %w", candidate.VendorInterface, errApplicationDescriptor)
	}
	return ops.openLocatedHidraw(sysRoot, devRoot, candidate, hidrawName, wantMajor, wantMinor)
}

func (ops probeOps) enterBootloader(sysRoot, devRoot string, candidate DiscoveredCandidate, proto ProtocolVersion, result *ApplyResult) (err error) {
	fd, _, err := ops.openValidatedHidraw(sysRoot, devRoot, candidate)
	if err != nil {
		return err
	}
	defer func() {
		if closeErr := ops.close(fd); closeErr != nil && !isUSBRebootWriteErr(closeErr) {
			err = errors.Join(err, closeErr)
		}
	}()
	result.WriteAttempted = true
	if proto == ProtocolV2 {
		req := BootloaderEntryPacketV2()
		if n, wErr := ops.writeHidraw(fd, req[:]); wErr != nil || n != 64 {
			if wErr != nil {
				if isUSBRebootWriteErr(wErr) {
					return nil
				}
				return fmt.Errorf("write v2 bootloader entry packet: %w", wErr)
			}
			return fmt.Errorf("write v2 bootloader entry packet wrote %d bytes, want 64", n)
		}
		result.ReportsWritten++
		return nil
	}
	req := BootloaderEntryPacketV1()
	for i := range 2 {
		if n, wErr := ops.writeHidraw(fd, req[:]); wErr != nil || n != 64 {
			if wErr != nil {
				if isUSBRebootWriteErr(wErr) {
					return nil
				}
				return fmt.Errorf("write v1 bootloader entry packet %d: %w", i+1, wErr)
			}
			return fmt.Errorf("write v1 bootloader entry packet %d wrote %d bytes, want 64", i+1, n)
		}
		result.ReportsWritten++
	}
	return nil
}

const (
	// bootloaderWait bounds the wait for the bootloader after the entry packet.
	bootloaderWait = 30 * time.Second
	bootloaderPoll = 100 * time.Millisecond
)

// errReturnedToApplication marks a device that re-enumerated with its application descriptor.
var errReturnedToApplication = errors.New("returned to application mode")

func (ops probeOps) clock() (func() time.Time, func(time.Duration)) {
	now, sleep := ops.now, ops.sleep
	if now == nil {
		now = time.Now
	}
	if sleep == nil {
		sleep = time.Sleep
	}
	return now, sleep
}

func (ops probeOps) waitForBootloaderHidraw(sysRoot, devRoot string, prev DiscoveredCandidate, m FirmwareManifest, result *ApplyResult) (int, error) {
	now, sleep := ops.clock()
	wait := ops.bootWait
	if wait <= 0 {
		wait = bootloaderWait
	}
	deadline := now().Add(wait)
	for {
		sleep(bootloaderPoll)
		fd, stage, observed, err := ops.tryBootloaderHidraw(sysRoot, devRoot, prev, m, result)
		if err == nil {
			return fd, nil
		}
		if errors.Is(err, errReturnedToApplication) {
			return -1, fmt.Errorf("SayoDevice at USB path %s (%s) %w instead of staying in the bootloader", prev.PhysicalPath, observed, err)
		}
		if stage == "GET_BOOT_VERSION" && !errors.Is(err, unix.ETIMEDOUT) {
			return -1, fmt.Errorf("SayoDevice at USB path %s (%s) failed the bootloader handshake: %w", prev.PhysicalPath, observed, err)
		}
		if now().Before(deadline) {
			continue
		}
		hint := ""
		if errors.Is(err, unix.EACCES) || errors.Is(err, unix.EPERM) {
			hint = ". Check that a udev rule gives your user read and write access to the bootloader hidraw node"
		}
		if observed == "" {
			observed = "no compatible device"
		}
		return -1, fmt.Errorf("timed out waiting for SayoDevice bootloader at USB path %s after %s (last seen: %s, rejected at %s: %w)%s",
			prev.PhysicalPath, wait, observed, stage, err, hint)
	}
}

// tryBootloaderHidraw inspects only prev.PhysicalPath, so an unrelated device cannot abort the wait.
// On failure it returns the rejecting stage and a description of the device seen at that path.
func (ops probeOps) tryBootloaderHidraw(sysRoot, devRoot string, prev DiscoveredCandidate, m FirmwareManifest, result *ApplyResult) (int, string, string, error) {
	c, err := ops.inspect(sysRoot, prev.PhysicalPath)
	observed := describeObservedCandidate(c)
	if err != nil {
		return -1, "inspect", observed, err
	}
	if m.PID2 > 0 && int(c.PID) != m.PID2 {
		return -1, "PID check", observed, fmt.Errorf("PID 0x%04x differs from manifest pid2 0x%04x", c.PID, m.PID2)
	}
	fd, err := ops.openBootloaderHidraw(sysRoot, devRoot, c)
	if errors.Is(err, errApplicationDescriptor) {
		if c.DeviceNumber != prev.DeviceNumber || c.identity != prev.identity {
			return -1, "report descriptor", observed, errReturnedToApplication
		}
		return -1, "report descriptor", observed, fmt.Errorf("device has not left application mode: %w", err)
	}
	if err != nil {
		return -1, "hidraw", observed, err
	}
	if err := ops.bootStepGetVersion(fd, result); err != nil {
		_ = ops.close(fd)
		return -1, "GET_BOOT_VERSION", observed, err
	}
	return fd, "", observed, nil
}

func describeObservedCandidate(c DiscoveredCandidate) string {
	if c.VID == 0 && c.PID == 0 {
		return ""
	}
	observed := fmt.Sprintf("%04x:%04x %q", c.VID, c.PID, c.ProductName)
	if c.DeviceNumber > 0 {
		observed += fmt.Sprintf(" devnum %d", c.DeviceNumber)
	}
	return observed
}

const (
	// applicationWait bounds the wait for the application after EXECUTE_APP. The official tool waits a fixed 5 s.
	applicationWait = 60 * time.Second
	// applicationSettle gives udev time to finish the new hidraw node before the version query.
	applicationSettle = time.Second
)

// RestartResult describes what WaitForApplication saw at the selected USB path after EXECUTE_APP.
type RestartResult struct {
	Restarted bool
	Candidate DiscoveredCandidate
	Elapsed   time.Duration
	LastSeen  string
}

// WaitForApplication polls only prev.PhysicalPath, without opening a device node, until a SayoDevice
// application descriptor appears with a sysfs identity that differs from prev, or the deadline passes.
func WaitForApplication(sysRoot, devRoot string, prev DiscoveredCandidate) RestartResult {
	return systemProbeOps().waitForApplication(sysRoot, devRoot, prev)
}

func (ops probeOps) waitForApplication(sysRoot, devRoot string, prev DiscoveredCandidate) RestartResult {
	now, sleep := ops.clock()
	start := now()
	deadline := start.Add(applicationWait)
	for {
		sleep(bootloaderPoll)
		c, seen, ok := ops.tryApplication(sysRoot, devRoot, prev)
		elapsed := now().Sub(start)
		if ok {
			sleep(applicationSettle)
			return RestartResult{Restarted: true, Candidate: c, Elapsed: elapsed, LastSeen: seen}
		}
		if !now().Before(deadline) {
			return RestartResult{Elapsed: elapsed, LastSeen: seen}
		}
	}
}

// tryApplication reads sysfs and stats the hidraw node only. It returns the device seen at the path
// and whether that device is a new application instance.
func (ops probeOps) tryApplication(sysRoot, devRoot string, prev DiscoveredCandidate) (DiscoveredCandidate, string, bool) {
	c, err := ops.inspect(sysRoot, prev.PhysicalPath)
	observed := describeObservedCandidate(c)
	if err != nil {
		if observed != "" {
			return c, fmt.Sprintf("%s, not ready (%v)", observed, err), false
		}
		if errors.Is(err, fs.ErrNotExist) {
			return c, "no device", false
		}
		return c, fmt.Sprintf("no compatible device (%v)", err), false
	}
	hidrawName, descriptor, _, wantMajor, wantMinor, err := ops.locateSayoHidraw(c)
	if c.Bootloader || IsBootloaderReportDescriptor(descriptor) {
		return c, fmt.Sprintf("bootloader mode (%s)", observed), false
	}
	if err != nil {
		return c, fmt.Sprintf("%s, not ready (%v)", observed, err), false
	}
	if c.DeviceNumber == prev.DeviceNumber && c.identity == prev.identity {
		return c, fmt.Sprintf("unchanged device (%s)", observed), false
	}
	node := filepath.Join(hidrawRoot(devRoot), hidrawName)
	var named unix.Stat_t
	if err := ops.lstat(node, &named); err != nil {
		return c, fmt.Sprintf("%s, not ready (%v)", observed, err), false
	}
	if err := checkHidrawNode(named, wantMajor, wantMinor); err != nil {
		return c, fmt.Sprintf("%s, not ready (%v)", observed, err), false
	}
	// devtmpfs creates the node root-only. Wait for udev to grant read-write access, without opening it.
	if err := ops.access(node, unix.R_OK|unix.W_OK); err != nil {
		return c, fmt.Sprintf("%s, not ready (access %s: %v)", observed, node, err), false
	}
	return c, fmt.Sprintf("application (%s)", observed), true
}

// FirmwareInfo is the model code and firmware version from one Info (0x00) query.
// Bootloader is true when the device answers as a bootloader, and then no version is read.
type FirmwareInfo struct {
	ModelCode       uint16
	FirmwareVersion uint16
	Bootloader      bool
}

// QueryFirmwareVersion opens the revalidated vendor hidraw node and sends only the Info (0x00) query.
func QueryFirmwareVersion(sysRoot, devRoot string, candidate DiscoveredCandidate) (FirmwareInfo, error) {
	return systemProbeOps().queryFirmwareVersion(sysRoot, devRoot, candidate)
}

func (ops probeOps) queryFirmwareVersion(sysRoot, devRoot string, candidate DiscoveredCandidate) (info FirmwareInfo, err error) {
	if !filepath.IsAbs(devRoot) {
		return info, fmt.Errorf("USB device root must be absolute")
	}
	hidrawName, descriptor, proto, wantMajor, wantMinor, err := ops.locateSayoHidraw(candidate)
	if err != nil {
		return info, err
	}
	if candidate.Bootloader || IsBootloaderReportDescriptor(descriptor) {
		return FirmwareInfo{Bootloader: true}, nil
	}
	fd, err := ops.openLocatedHidraw(sysRoot, devRoot, candidate, hidrawName, wantMajor, wantMinor)
	if err != nil {
		return info, err
	}
	defer func() {
		if closeErr := ops.close(fd); closeErr != nil {
			err = errors.Join(err, closeErr)
		}
	}()
	if proto == ProtocolV2 {
		info.ModelCode, info.FirmwareVersion, err = ops.readV2Info(fd)
		return info, err
	}
	rx, err := ops.readV1Info(fd)
	if err != nil {
		return info, err
	}
	switch rx[1] {
	case 0x02:
		return FirmwareInfo{Bootloader: true}, nil
	case 0x00:
		return FirmwareInfo{ModelCode: binary.BigEndian.Uint16(rx[5:7]), FirmwareVersion: binary.BigEndian.Uint16(rx[3:5])}, nil
	}
	return info, fmt.Errorf("unexpected 0x00 info status %#02x", rx[1])
}

func (ops probeOps) flashBootloader(bootFD int, m FirmwareManifest, entry FirmwareManifestEntry, fwBytes []byte, result ApplyResult, rebootIssued *bool, onProgress FirmwareProgressFunc) (ApplyResult, error) {
	be := m.AddrByteOrderBE != 0
	if err := ops.bootStepCheckFW(bootFD, m.HIDErrForSize, entry.ModelCode, &result); err != nil {
		return result, err
	}
	if m.EraseFlash != 0 {
		if err := ops.bootStepEraseFlash(bootFD, uint32(len(fwBytes)), be, m.HIDErrForSize, &result); err != nil { // #nosec G115 -- validated <= 4 MiB
			return result, err
		}
	}
	if err := ops.bootStepWriteData(bootFD, m, fwBytes, &result, onProgress); err != nil {
		return result, err
	}
	if err := ops.bootStepVerify(bootFD, m, uint32(len(fwBytes)-16), be, &result); err != nil { // #nosec G115 -- validated >= 64 and <= 4 MiB
		return result, err
	}
	execReq := BootExecuteAppPacket()
	if rebootIssued != nil {
		*rebootIssued = true
	}
	if n, err := ops.writeHidraw(bootFD, execReq[:]); err != nil || n != 64 {
		if err != nil {
			if isUSBRebootWriteErr(err) {
				return result, nil
			}
			return result, fmt.Errorf("write EXECUTE_APP: %w", err)
		}
		return result, fmt.Errorf("write EXECUTE_APP wrote %d bytes, want 64", n)
	}
	result.ReportsWritten++
	return result, nil
}

func (ops probeOps) bootStepGetVersion(fd int, result *ApplyResult) error {
	pkt := BootGetVersionPacket()
	rx, err := ops.exchangeBootPacket(fd, pkt, bootGetVersionTimeoutMs, "GET_BOOT_VERSION", result)
	if err != nil {
		return err
	}
	if rx[0] != 0x02 || rx[1] != 0x02 {
		return fmt.Errorf("device is not in bootloader mode (GET_BOOT_VERSION reply %s)", ReplyPrefixHex(rx[:]))
	}
	return nil
}

func (ops probeOps) bootStepCheckFW(fd, errForSize int, wantModelCode uint16, result *ApplyResult) error {
	pkt := BootCheckFWPacket()
	rx, err := ops.exchangeBootPacket(fd, pkt, bootCheckFWTimeoutMs, "CHECK_FW", result)
	if err != nil {
		return err
	}
	validStatus := bootStatusOK(rx, errForSize, true) || (rx[1] == 0x00 && rx[2] == 0x04)
	if !validStatus {
		return fmt.Errorf("invalid bootloader CHECK_FW reply (reply %s)", ReplyPrefixHex(rx[:]))
	}
	gotModel := binary.BigEndian.Uint16(rx[5:7])
	if gotModel != wantModelCode {
		return fmt.Errorf("bootloader model_code 0x%04x does not match expected 0x%04x (reply %s)", gotModel, wantModelCode, ReplyPrefixHex(rx[:]))
	}
	return nil
}

func (ops probeOps) bootStepEraseFlash(fd int, totalBytes uint32, be bool, errForSize int, result *ApplyResult) error {
	pkt := BootEraseFlashPacket(totalBytes, be)
	rx, err := ops.exchangeBootPacket(fd, pkt, bootEraseFlashTimeoutMs, "ERASE_FLASH", result)
	if err != nil {
		return err
	}
	if !bootStatusOK(rx, errForSize, false) {
		return fmt.Errorf("bootloader ERASE_FLASH failed (reply %s)", ReplyPrefixHex(rx[:]))
	}
	return nil
}

func (ops probeOps) bootStepWriteData(fd int, m FirmwareManifest, fwBytes []byte, result *ApplyResult, onProgress FirmwareProgressFunc) error {
	be := m.AddrByteOrderBE != 0
	useChecksum := m.UseChecksum()
	if onProgress != nil {
		onProgress(0, len(fwBytes))
	}
	for offset := 0; offset < len(fwBytes); {
		chunk := fwBytes[offset:min(offset+32, len(fwBytes))]
		pkt := BootWriteDataPacket(uint32(offset), m.AddrLen, be, m.EncryptFlag, chunk, useChecksum) // #nosec G115 -- validated <= 4 MiB
		rx, err := ops.exchangeBootPacket(fd, pkt, bootWriteDataTimeoutMs, fmt.Sprintf("WRITE_DATA at 0x%x", offset), result)
		if err != nil {
			return err
		}
		if !bootStatusOK(rx, m.HIDErrForSize, false) {
			return fmt.Errorf("bootloader WRITE_DATA failed at offset 0x%x (reply %s)", offset, ReplyPrefixHex(rx[:]))
		}
		offset += len(chunk)
		if onProgress != nil {
			onProgress(offset, len(fwBytes))
		}
	}
	return nil
}

func (ops probeOps) bootStepVerify(fd int, m FirmwareManifest, verifyBytes uint32, be bool, result *ApplyResult) error {
	pkt := BootVerifyPacket(m.VerifyCmd(), verifyBytes, be)
	rx, err := ops.exchangeBootPacket(fd, pkt, bootVerifyTimeoutMs, "VERIFY", result)
	if err != nil {
		return err
	}
	if !bootStatusOK(rx, m.HIDErrForSize, true) {
		return fmt.Errorf("bootloader VERIFY failed (reply %s)", ReplyPrefixHex(rx[:]))
	}
	return nil
}

func (ops probeOps) exchangeBootPacket(fd int, pkt Packet, timeoutMs int, stepName string, result *ApplyResult) (Packet, error) {
	if n, err := ops.writeHidraw(fd, pkt[:]); err != nil || n != 64 {
		if err != nil {
			return Packet{}, fmt.Errorf("write %s: %w", stepName, err)
		}
		return Packet{}, fmt.Errorf("write %s wrote %d bytes, want 64", stepName, n)
	}
	result.ReportsWritten++
	var rx Packet
	n, err := ops.readHidraw(fd, rx[:], timeoutMs)
	if err != nil {
		return Packet{}, fmt.Errorf("read %s reply: %w", stepName, err)
	}
	if n != 64 || rx[0] != 0x02 {
		return Packet{}, fmt.Errorf("invalid %s reply (%d bytes, reply %s)", stepName, n, ReplyPrefixHex(rx[:min(max(n, 0), len(rx))]))
	}
	return rx, nil
}
