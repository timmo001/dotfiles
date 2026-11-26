package sayo

import (
	"encoding/binary"
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"syscall"
	"time"

	"golang.org/x/sys/unix"
)

const candidateSayoReportDescriptor = "\x06\x00\xff\x09\x01\xa1\x01\x85\x02\x15\x00\x26\xff\x00\x75\x08\x95\x3f\x09\x01\x81\x00\x09\x01\x91\x00\xc0" +
	"\x06\x11\xff\x09\x02\xa1\x01\x85\x21\x15\x00\x26\xff\x00\x75\x08\x95\x3f\x09\x02\x81\x00\x09\x02\x91\x00\xc0" +
	"\x05\x01\x09\x06\xa1\x01\x85\x01\x05\x07\x19\x00\x29\xe7\x15\x00\x25\x01\x75\x01\x95\xe8\x81\x02\xc0" +
	"\x05\x01\x09\x02\xa1\x01\x85\x03\x09\x01\xa1\x00\x05\x09\x19\x01\x29\x08\x15\x00\x25\x01\x95\x08\x75\x01\x81\x02\x05\x01\x09\x30\x09\x31\x09\x38\x15\x81\x25\x7f\x75\x08\x95\x03\x81\x06\xc0\xc0" +
	"\x05\x0c\x09\x01\xa1\x01\x85\x04\x95\x01\x75\x10\x16\x00\x00\x26\xff\x02\x1a\x00\x00\x2a\xff\x02\x81\x00\xc0"

const candidateSayoV1OnlyReportDescriptor = "\x06\x00\xff\x09\x01\xa1\x01\x85\x02\x15\x00\x26\xff\x00\x75\x08\x95\x3f\x09\x01\x81\x00\x09\x01\x91\x00\xc0"

// DiscoveredCandidate binds a descriptor match to one sysfs device instance.
type DiscoveredCandidate struct {
	Candidate
	ProductName  string
	SysfsPath    string
	BusNumber    int
	DeviceNumber int
	// Bootloader records bootloader mode known from sysfs: a dedicated bootloader PID or the
	// product string "Bootloader". A bootloader without either is recognised by its report descriptor.
	Bootloader bool
	identity   [2]uint64
}

// ProbeStatus distinguishes a successful probe from a refusal or failed transfer.
type ProbeStatus string

const (
	ProbeRefused          ProbeStatus = "refused"
	ProbeDescriptorFailed ProbeStatus = "report-descriptor-failed"
	ProbeTransferFailed   ProbeStatus = "get-report-failed"
	ProbeInvalidReport    ProbeStatus = "invalid-report"
	ProbeRawReport        ProbeStatus = "raw-report-only"
	ProbeCloseFailed      ProbeStatus = "close-failed"
)

// ProbeResult preserves the first raw slot report and decoded DeviceLayout.
type ProbeResult struct {
	Status                   ProbeStatus
	Raw                      []byte
	Count                    int
	ReportDescriptor         []byte
	ReportDescriptorCount    int
	ReportDescriptorVerified bool
	Layout                   *DeviceLayout
}

// ApplyResult records whether a write sequence was started and how many reports completed.
type ApplyResult struct {
	WriteAttempted bool
	ReportsWritten int
}

type probeOps struct {
	readDir      func(string) ([]os.DirEntry, error)
	readFile     func(string, int) ([]byte, error)
	evalSymlinks func(string) (string, error)
	stat         func(string) (os.FileInfo, error)
	lstat        func(string, *unix.Stat_t) error
	access       func(string, uint32) error
	open         func(string, int, uint32) (int, error)
	fstat        func(int, *unix.Stat_t) error
	flock        func(int, int) error
	close        func(int) error
	writeHidraw  func(int, []byte) (int, error)
	readHidraw   func(int, []byte, int) (int, error)
	sleep        func(time.Duration)
	now          func() time.Time
	bootWait     time.Duration
}

func systemProbeOps() probeOps {
	return probeOps{
		readDir: os.ReadDir, readFile: readProbeFile, evalSymlinks: filepath.EvalSymlinks,
		stat: os.Stat, lstat: unix.Lstat, access: unix.Access, open: unix.Open, fstat: unix.Fstat,
		flock: unix.Flock, close: unix.Close, writeHidraw: writeHidrawReport,
		readHidraw: readHidrawReport, sleep: time.Sleep, now: time.Now, bootWait: bootloaderWait,
	}
}

// DiscoverCandidates reads cached descriptors below sysRoot, normally /sys/bus/usb/devices.
func DiscoverCandidates(sysRoot string) ([]DiscoveredCandidate, error) {
	return systemProbeOps().discover(sysRoot)
}

func (ops probeOps) discover(sysRoot string) ([]DiscoveredCandidate, error) {
	if !filepath.IsAbs(sysRoot) {
		return nil, fmt.Errorf("sysfs root must be absolute")
	}
	entries, err := ops.readDir(sysRoot)
	if err != nil {
		return nil, err
	}
	var candidates []DiscoveredCandidate
	for _, entry := range entries {
		name := entry.Name()
		if len(name) > 255 || !physicalUSBPath.MatchString(name) {
			continue
		}
		candidate, err := ops.inspect(sysRoot, name)
		if err != nil {
			if candidate.PhysicalPath != "" {
				return nil, fmt.Errorf("inspect candidate %s: %w", name, err)
			}
			continue
		}
		candidates = append(candidates, candidate)
	}
	return candidates, nil
}

func (ops probeOps) inspect(sysRoot, physicalPath string) (DiscoveredCandidate, error) {
	var result DiscoveredCandidate
	if !filepath.IsAbs(sysRoot) || len(physicalPath) > 255 || !physicalUSBPath.MatchString(physicalPath) {
		return result, fmt.Errorf("invalid sysfs root or physical path")
	}
	path, err := ops.evalSymlinks(filepath.Join(sysRoot, physicalPath))
	if err != nil {
		return result, err
	}
	if filepath.Base(path) != physicalPath {
		return result, fmt.Errorf("sysfs path does not match the selected physical path")
	}
	before, err := ops.stat(path)
	if err != nil {
		return result, err
	}
	st, ok := before.Sys().(*syscall.Stat_t)
	if !ok || !before.IsDir() {
		return result, fmt.Errorf("sysfs device is not a directory with Linux identity")
	}
	descriptors, err := ops.readFile(filepath.Join(path, "descriptors"), 512)
	if err != nil {
		return result, err
	}
	candidate, err := MatchCandidate(physicalPath, descriptors)
	if err != nil {
		return result, err
	}
	var productName string
	if rawProduct, err := ops.readFile(filepath.Join(path, "product"), 128); err == nil {
		productName = strings.TrimSpace(string(rawProduct))
	}
	result.Candidate = candidate
	result.ProductName = productName
	bus, err := ops.number(path, "busnum", 65535)
	if err != nil {
		return result, err
	}
	device, err := ops.number(path, "devnum", 127)
	if err != nil {
		return result, err
	}
	if !strings.HasPrefix(physicalPath, strconv.Itoa(bus)+"-") {
		return result, fmt.Errorf("bus number does not match physical path")
	}
	dev, err := ops.readFile(filepath.Join(path, "dev"), 32)
	if err != nil {
		return result, err
	}
	if strings.TrimSpace(string(dev)) != fmt.Sprintf("189:%d", (bus-1)*128+device-1) {
		return result, fmt.Errorf("sysfs device number does not match USB bus and address")
	}
	after, err := ops.stat(path)
	if err != nil {
		return result, err
	}
	if !os.SameFile(before, after) {
		return result, fmt.Errorf("sysfs device changed during inspection")
	}
	return DiscoveredCandidate{
		Candidate: candidate, ProductName: productName, SysfsPath: path, BusNumber: bus, DeviceNumber: device,
		Bootloader: IsBootloaderPID(candidate.VID, candidate.PID) || strings.EqualFold(productName, "Bootloader"),
		identity:   [2]uint64{st.Dev, st.Ino},
	}, nil
}

func (ops probeOps) number(path, name string, maximum int) (int, error) {
	data, err := ops.readFile(filepath.Join(path, name), 16)
	if err != nil {
		return 0, err
	}
	value := strings.TrimSuffix(string(data), "\n")
	if value == "" || strings.Trim(value, "0123456789") != "" {
		return 0, fmt.Errorf("invalid %s", name)
	}
	n, err := strconv.Atoi(value)
	if err != nil || n < 1 || n > maximum {
		return 0, fmt.Errorf("invalid %s", name)
	}
	return n, nil
}

func readProbeFile(path string, limit int) (data []byte, err error) {
	file, err := os.OpenFile(path, os.O_RDONLY|unix.O_NOFOLLOW|unix.O_CLOEXEC|unix.O_NONBLOCK, 0)
	if err != nil {
		return nil, err
	}
	defer func() { err = errors.Join(err, file.Close()) }()
	info, err := file.Stat()
	if err != nil {
		return nil, err
	}
	if !info.Mode().IsRegular() {
		return nil, fmt.Errorf("sysfs attribute is not a regular file")
	}
	data, err = io.ReadAll(io.LimitReader(file, int64(limit)+1))
	if err != nil {
		return nil, err
	}
	if len(data) > limit {
		return nil, fmt.Errorf("sysfs attribute exceeds %d bytes", limit)
	}
	return data, nil
}

// ProbeCandidate opens the revalidated SayoDevice vendor hidraw node and reads its layout and settings.
func ProbeCandidate(sysRoot, devRoot string, candidate DiscoveredCandidate) (ProbeResult, error) {
	return systemProbeOps().probe(sysRoot, devRoot, candidate)
}

// ApplyCandidate revalidates candidate and executes a read-modify-write-ACK and Save transaction.
func ApplyCandidate(sysRoot, devRoot string, candidate DiscoveredCandidate, req WriteRequest) (ApplyResult, error) {
	return systemProbeOps().apply(sysRoot, devRoot, candidate, req)
}

func (ops probeOps) revalidate(sysRoot string, candidate DiscoveredCandidate) error {
	fresh, err := ops.inspect(sysRoot, candidate.PhysicalPath)
	if err != nil {
		return err
	}
	if fresh != candidate {
		return fmt.Errorf("selected descriptors, physical path or sysfs identity changed")
	}
	return nil
}

func writeHidrawReport(fd int, data []byte) (int, error) {
	if len(data) != 64 || (data[0] != 0x21 && data[0] != 0x02) {
		return 0, fmt.Errorf("refused hidraw write outside 64-byte report ID 0x21 or 0x02")
	}
	for {
		n, err := unix.Write(fd, data)
		if errors.Is(err, unix.EINTR) {
			continue
		}
		return n, err
	}
}

func readHidrawReport(fd int, data []byte, timeoutMs int) (int, error) {
	if fd < 0 || fd > 0x7fffffff || len(data) != 64 || timeoutMs <= 0 {
		return 0, fmt.Errorf("invalid hidraw read buffer or timeout")
	}
	pfd := []unix.PollFd{{Fd: int32(fd), Events: unix.POLLIN}}
	for {
		n, err := unix.Poll(pfd, timeoutMs)
		if errors.Is(err, unix.EINTR) {
			continue
		}
		if err != nil {
			return 0, err
		}
		if n == 0 {
			return 0, unix.ETIMEDOUT
		}
		break
	}
	for {
		n, err := unix.Read(fd, data)
		if errors.Is(err, unix.EINTR) {
			continue
		}
		return n, err
	}
}

func hidrawRoot(devRoot string) string {
	if filepath.Clean(devRoot) == "/dev/bus/usb" {
		return "/dev"
	}
	return devRoot
}

func parseDevNumbers(raw string) (uint32, uint32, error) {
	parts := strings.Split(strings.TrimSpace(raw), ":")
	if len(parts) != 2 {
		return 0, 0, fmt.Errorf("invalid dev attribute")
	}
	maj, errMaj := strconv.ParseUint(parts[0], 10, 32)
	min, errMin := strconv.ParseUint(parts[1], 10, 32)
	if errMaj != nil || errMin != nil || maj == 0 {
		return 0, 0, fmt.Errorf("invalid dev attribute")
	}
	return uint32(maj), uint32(min), nil
}

func checkHidrawNode(st unix.Stat_t, wantMajor, wantMinor uint32) error {
	if st.Mode&unix.S_IFMT != unix.S_IFCHR || unix.Major(st.Rdev) != wantMajor || unix.Minor(st.Rdev) != wantMinor {
		return fmt.Errorf("selected node is not the expected hidraw character device")
	}
	return nil
}

func (ops probeOps) locateSayoHidraw(candidate DiscoveredCandidate) (string, []byte, ProtocolVersion, uint32, uint32, error) {
	iface := int(candidate.VendorInterface)
	if candidate.VID == 0 && candidate.PID == 0 && iface == 0 {
		iface = 1
	}
	ifaceDir := filepath.Join(candidate.SysfsPath, fmt.Sprintf("%s:1.%d", candidate.PhysicalPath, iface))
	entries, err := ops.readDir(ifaceDir)
	if err != nil {
		return "", nil, 0, 0, 0, err
	}
	var hidDirs []string
	for _, entry := range entries {
		name := entry.Name()
		if !entry.IsDir() && entry.Type()&os.ModeSymlink == 0 {
			continue
		}
		if !hidDeviceName.MatchString(name) {
			continue
		}
		hidDirs = append(hidDirs, filepath.Join(ifaceDir, name))
	}
	if len(hidDirs) != 1 {
		return "", nil, 0, 0, 0, fmt.Errorf("interface %d requires exactly one HID device", iface)
	}
	hidDir := hidDirs[0]
	descriptor, err := ops.readFile(filepath.Join(hidDir, "report_descriptor"), 512)
	if err != nil {
		return "", descriptor, 0, 0, 0, fmt.Errorf("read interface %d report descriptor: %w", iface, err)
	}
	proto, ok := DetectProtocolVersion(descriptor)
	if !ok {
		return "", descriptor, 0, 0, 0, fmt.Errorf("interface %d report descriptor differs from expected SayoDevice layout", iface)
	}
	hidrawEntries, err := ops.readDir(filepath.Join(hidDir, "hidraw"))
	if err != nil || len(hidrawEntries) != 1 || !strings.HasPrefix(hidrawEntries[0].Name(), "hidraw") {
		return "", descriptor, proto, 0, 0, fmt.Errorf("interface %d requires exactly one hidraw node", iface)
	}
	hidrawName := hidrawEntries[0].Name()
	devBytes, err := ops.readFile(filepath.Join(hidDir, "hidraw", hidrawName, "dev"), 32)
	if err != nil {
		return "", descriptor, proto, 0, 0, err
	}
	wantMajor, wantMinor, err := parseDevNumbers(string(devBytes))
	if err != nil {
		return "", descriptor, proto, 0, 0, err
	}
	return hidrawName, descriptor, proto, wantMajor, wantMinor, nil
}

func (ops probeOps) validateHidrawOpen(sysRoot, node string, fd int, candidate DiscoveredCandidate, before unix.Stat_t, wantMajor, wantMinor uint32) error {
	if err := ops.revalidate(sysRoot, candidate); err != nil {
		return err
	}
	var opened, named unix.Stat_t
	if err := ops.fstat(fd, &opened); err != nil {
		return err
	}
	if err := ops.lstat(node, &named); err != nil {
		return err
	}
	if err := checkHidrawNode(opened, wantMajor, wantMinor); err != nil {
		return err
	}
	if named.Mode&unix.S_IFMT != unix.S_IFCHR || opened.Dev != before.Dev || opened.Ino != before.Ino ||
		opened.Rdev != before.Rdev || opened.Dev != named.Dev || opened.Ino != named.Ino || opened.Rdev != named.Rdev {
		return fmt.Errorf("opened hidraw node identity changed")
	}
	if ops.flock != nil {
		if err := ops.flock(fd, unix.LOCK_EX|unix.LOCK_NB); err != nil && !errors.Is(err, unix.EBADF) {
			return fmt.Errorf("lock hidraw node: %w", err)
		}
	}
	return nil
}

func (ops probeOps) probe(sysRoot, devRoot string, candidate DiscoveredCandidate) (result ProbeResult, err error) {
	result.Status = ProbeRefused
	if !filepath.IsAbs(devRoot) {
		return result, fmt.Errorf("USB device root must be absolute")
	}
	if err := ops.revalidate(sysRoot, candidate); err != nil {
		return result, err
	}
	hidrawName, descriptor, proto, wantMajor, wantMinor, err := ops.locateSayoHidraw(candidate)
	result.ReportDescriptor = descriptor
	result.ReportDescriptorCount = len(descriptor)
	if err != nil {
		if descriptor != nil {
			result.Status = ProbeDescriptorFailed
		}
		return result, err
	}
	result.ReportDescriptorVerified = true
	node := filepath.Join(hidrawRoot(devRoot), hidrawName)
	var named unix.Stat_t
	if err := ops.lstat(node, &named); err != nil {
		return result, err
	}
	if err := checkHidrawNode(named, wantMajor, wantMinor); err != nil {
		return result, err
	}
	fd, err := ops.open(node, unix.O_RDWR|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return result, err
	}
	defer func() {
		if closeErr := ops.close(fd); closeErr != nil {
			err = errors.Join(err, closeErr)
			if result.Status == ProbeRawReport {
				result.Status = ProbeCloseFailed
			}
		}
	}()
	if err := ops.validateHidrawOpen(sysRoot, node, fd, candidate, named, wantMajor, wantMinor); err != nil {
		return result, err
	}
	if proto == ProtocolV1 || IsBootloaderPID(candidate.VID, candidate.PID) {
		return ops.exchangeV1LayoutAndSettings(fd, candidate.PID, IsBootloaderReportDescriptor(descriptor), result)
	}
	return ops.exchangeV2LayoutAndSettings(fd, result)
}

// probeBootloaderErrForSize returns the bootloader status-byte rule used by bare probing, which has
// no manifest. The live manifests set hid_err_for_size 1 only in directory 2 (application PID 0x0002,
// bootloader PID 0x0006). The bare probe sends only signed packets, because hid_checksum applies
// only to WRITE_DATA. Firmware updates use the manifest values.
func probeBootloaderErrForSize(pid uint16) int {
	if ManifestPID(pid) == 2 {
		return 1
	}
	return 0
}

func (ops probeOps) readV2Info(fd int) (uint16, uint16, error) {
	req := QueryInfoPacketV2()
	if n, err := ops.writeHidraw(fd, req[:]); err != nil || n != 64 {
		if err != nil {
			return 0, 0, fmt.Errorf("write 0x00 info query: %w", err)
		}
		return 0, 0, fmt.Errorf("write 0x00 info query wrote %d bytes, want 64", n)
	}
	var rx Packet
	n, err := ops.readHidraw(fd, rx[:], 1000)
	if err != nil {
		return 0, 0, fmt.Errorf("read 0x00 info reply: %w", err)
	}
	if n != 64 || rx[0] != 0x21 || rx[5]&0x40 != 0 || rx[6] != 0x00 {
		return 0, 0, fmt.Errorf("invalid 0x00 info reply")
	}
	return binary.LittleEndian.Uint16(rx[8:10]), binary.LittleEndian.Uint16(rx[10:12]), nil
}

// readV1Info sends the HID v1 Info (0x00) query, which a bootloader answers as GET_BOOT_VERSION.
func (ops probeOps) readV1Info(fd int) (Packet, error) {
	req := QueryInfoPacketV1()
	if n, err := ops.writeHidraw(fd, req[:]); err != nil || n != 64 {
		if err != nil {
			return Packet{}, fmt.Errorf("write 0x00 info query: %w", err)
		}
		return Packet{}, fmt.Errorf("write 0x00 info query wrote %d bytes, want 64", n)
	}
	var rx Packet
	n, err := ops.readHidraw(fd, rx[:], 1000)
	if err != nil {
		return rx, fmt.Errorf("read 0x00 info reply: %w", err)
	}
	if n != 64 || rx[0] != 0x02 {
		return rx, fmt.Errorf("invalid 0x00 info reply")
	}
	return rx, nil
}

func (ops probeOps) readV1InfoOrBootloader(fd int, pid uint16) (uint16, uint16, bool, Packet, error) {
	rx, err := ops.readV1Info(fd)
	if err != nil {
		return 0, 0, false, rx, err
	}
	if rx[1] == 0x02 {
		errForSize := probeBootloaderErrForSize(pid)
		chkReq := BootCheckFWPacket()
		if n, err := ops.writeHidraw(fd, chkReq[:]); err != nil || n != 64 {
			if err != nil {
				return 0, 0, true, rx, fmt.Errorf("write bootloader CHECK_FW query: %w", err)
			}
			return 0, 0, true, rx, fmt.Errorf("write bootloader CHECK_FW query wrote %d bytes, want 64", n)
		}
		var fwRx Packet
		n, err := ops.readHidraw(fd, fwRx[:], bootCheckFWTimeoutMs)
		if err != nil {
			return 0, 0, true, fwRx, fmt.Errorf("read bootloader CHECK_FW reply: %w", err)
		}
		validBootStatus := bootStatusOK(fwRx, errForSize, true) || (fwRx[1] == 0x00 && fwRx[2] == 0x04)
		if n != 64 || fwRx[0] != 0x02 || !validBootStatus {
			return 0, 0, true, fwRx, fmt.Errorf("invalid bootloader CHECK_FW reply (reply %s)", ReplyPrefixHex(fwRx[:]))
		}
		fwVer := binary.BigEndian.Uint16(fwRx[3:5])
		modelCode := binary.BigEndian.Uint16(fwRx[5:7])
		return modelCode, fwVer, true, fwRx, nil
	}
	if rx[1] != 0x00 {
		return 0, 0, false, rx, fmt.Errorf("unexpected 0x00 info status %#02x", rx[1])
	}
	fwVer := binary.BigEndian.Uint16(rx[3:5])
	modelCode := binary.BigEndian.Uint16(rx[5:7])
	return modelCode, fwVer, false, rx, nil
}

func (ops probeOps) exchangeV2LayoutAndSettings(fd int, result ProbeResult) (ProbeResult, error) {
	var records []RawSlotRecord
	for index := range 24 {
		result.Status = ProbeTransferFailed
		req := QueryKeyPacketV2(byte(index))
		if n, err := ops.writeHidraw(fd, req[:]); err != nil || n != 64 {
			if err != nil {
				return result, fmt.Errorf("write 0x10 key %d query: %w", index, err)
			}
			return result, fmt.Errorf("write 0x10 key %d query wrote %d bytes, want 64", index, n)
		}
		var rx Packet
		n, err := ops.readHidraw(fd, rx[:], 1000)
		if index == 0 {
			result.Count = n
			if n >= 0 && n <= len(rx) {
				result.Raw = append([]byte(nil), rx[:n]...)
			}
		}
		if err != nil {
			return result, fmt.Errorf("read 0x10 key %d reply: %w", index, err)
		}
		result.Status = ProbeInvalidReport
		if n != 64 || rx[0] != 0x21 || rx[6] != 0x10 || rx[7] != byte(index) {
			return result, fmt.Errorf("invalid 0x10 key %d reply", index)
		}
		if rx[5]&0x40 != 0 {
			break
		}
		if rx[4] != 0x3c || rx[5] != 0x00 {
			return result, fmt.Errorf("unexpected 0x10 key %d reply length (%#02x, %#02x)", index, rx[4], rx[5])
		}
		var rec RawSlotRecord
		rec.KeyType = rx[9]
		slot := byte(index + 1)
		for fn := range 5 {
			off := 24 + fn*8
			rec.Layers[fn] = DecodeSlotV2(slot, byte(fn+1), rx[off:off+8])
		}
		records = append(records, rec)
	}
	result.Status = ProbeTransferFailed
	lightReq := QueryLightPacketV2(0)
	if n, err := ops.writeHidraw(fd, lightReq[:]); err != nil || n != 64 {
		if err != nil {
			return result, fmt.Errorf("write 0x11 light query: %w", err)
		}
		return result, fmt.Errorf("write 0x11 light query wrote %d bytes, want 64", n)
	}
	var lightRx Packet
	n, err := ops.readHidraw(fd, lightRx[:], 1000)
	if err != nil {
		return result, fmt.Errorf("read 0x11 light reply: %w", err)
	}
	result.Status = ProbeInvalidReport
	if n != 64 || lightRx[0] != 0x21 || lightRx[4] != 0x3c || lightRx[5] != 0x00 || lightRx[6] != 0x11 || lightRx[7] != 0x00 {
		return result, fmt.Errorf("invalid 0x11 light reply")
	}
	mode, colour := DecodeLightV2(lightRx[24:32])
	modelCode, fwVer, infoErr := ops.readV2Info(fd)
	if infoErr != nil {
		modelCode, fwVer = 0, 0
	}
	layout, err := BuildDeviceLayout(ProtocolV2, records, mode, colour)
	if err != nil {
		result.Status = ProbeInvalidReport
		return result, err
	}
	layout.ModelCode = modelCode
	layout.FirmwareVersion = fwVer
	result.Status = ProbeRawReport
	result.Layout = layout
	return result, nil
}

func (ops probeOps) exchangeV1LayoutAndSettings(fd int, pid uint16, bootloaderDescriptor bool, result ProbeResult) (ProbeResult, error) {
	result.Status = ProbeTransferFailed
	modelCode, fwVer, isBoot, bootRx, err := ops.readV1InfoOrBootloader(fd, pid)
	if err != nil {
		if strings.HasPrefix(err.Error(), "invalid ") || strings.HasPrefix(err.Error(), "unexpected ") {
			result.Status = ProbeInvalidReport
		}
		return result, err
	}
	if isBoot || bootloaderDescriptor {
		return bootloaderProbeResult(result, modelCode, fwVer, isBoot, bootRx)
	}
	var records []RawSlotRecord
	for index := range 24 {
		result.Status = ProbeTransferFailed
		req := QueryKeyPacketV1(byte(index))
		if n, err := ops.writeHidraw(fd, req[:]); err != nil || n != 64 {
			if err != nil {
				return result, fmt.Errorf("write 0x16 key %d query: %w", index, err)
			}
			return result, fmt.Errorf("write 0x16 key %d query wrote %d bytes, want 64", index, n)
		}
		var rx Packet
		n, err := ops.readHidraw(fd, rx[:], 1000)
		if index == 0 {
			result.Count = n
			if n >= 0 && n <= len(rx) {
				result.Raw = append([]byte(nil), rx[:n]...)
			}
		}
		if err != nil {
			return result, fmt.Errorf("read 0x16 key %d reply: %w", index, err)
		}
		result.Status = ProbeInvalidReport
		if n != 64 || rx[0] != 0x02 || rx[1] != 0x16 {
			return result, fmt.Errorf("invalid 0x16 key %d reply", index)
		}
		if rx[2] == 0 || rx[4] != byte(index) || rx[5] == 0 {
			break
		}
		var rec RawSlotRecord
		rec.KeyType = rx[6]
		slot := byte(index + 1)
		for fn := range 5 {
			off := 19 + fn*6
			rec.Layers[fn] = DecodeSlotV1(slot, byte(fn+1), rx[off:off+6])
		}
		records = append(records, rec)
	}
	result.Status = ProbeTransferFailed
	lightReq := QueryLightPacketV1(0)
	if n, err := ops.writeHidraw(fd, lightReq[:]); err != nil || n != 64 {
		if err != nil {
			return result, fmt.Errorf("write 0x10 light query: %w", err)
		}
		return result, fmt.Errorf("write 0x10 light query wrote %d bytes, want 64", n)
	}
	var lightRx Packet
	n, err := ops.readHidraw(fd, lightRx[:], 1000)
	if err != nil {
		return result, fmt.Errorf("read 0x10 light reply: %w", err)
	}
	result.Status = ProbeInvalidReport
	if n != 64 || lightRx[0] != 0x02 || lightRx[1] != 0x10 || lightRx[4] != 0x00 {
		return result, fmt.Errorf("invalid 0x10 light reply")
	}
	mode, colour := DecodeLightV1(lightRx[5:12])
	layout, err := BuildDeviceLayout(ProtocolV1, records, mode, colour)
	if err != nil {
		return result, err
	}
	layout.ModelCode = modelCode
	layout.FirmwareVersion = fwVer
	result.Status = ProbeRawReport
	result.Layout = layout
	return result, nil
}

// bootloaderProbeResult records a bootloader reply. A bootloader report descriptor without a
// bootloader reply is refused, so no settings query reaches a bootloader.
func bootloaderProbeResult(result ProbeResult, modelCode, fwVer uint16, isBoot bool, rx Packet) (ProbeResult, error) {
	result.Count = 64
	result.Raw = append([]byte(nil), rx[:]...)
	if !isBoot {
		result.Status = ProbeInvalidReport
		return result, fmt.Errorf("bootloader report descriptor, but the 0x00 reply is not a bootloader reply")
	}
	result.Status = ProbeRawReport
	result.Layout = &DeviceLayout{
		Protocol:        ProtocolV1,
		ModelCode:       modelCode,
		FirmwareVersion: fwVer,
		Bootloader:      true,
	}
	return result, nil
}

func (ops probeOps) apply(sysRoot, devRoot string, candidate DiscoveredCandidate, req WriteRequest) (result ApplyResult, err error) {
	if !filepath.IsAbs(devRoot) {
		return result, fmt.Errorf("USB device root must be absolute")
	}
	if err := ops.revalidate(sysRoot, candidate); err != nil {
		return result, err
	}
	hidrawName, descriptor, proto, wantMajor, wantMinor, err := ops.locateSayoHidraw(candidate)
	if err != nil {
		return result, err
	}
	if candidate.Bootloader || IsBootloaderReportDescriptor(descriptor) {
		return result, fmt.Errorf("device is in bootloader mode, settings writes are refused")
	}
	node := filepath.Join(hidrawRoot(devRoot), hidrawName)
	var named unix.Stat_t
	if err := ops.lstat(node, &named); err != nil {
		return result, err
	}
	if err := checkHidrawNode(named, wantMajor, wantMinor); err != nil {
		return result, err
	}
	fd, err := ops.open(node, unix.O_RDWR|unix.O_NOFOLLOW|unix.O_CLOEXEC, 0)
	if err != nil {
		return result, err
	}
	defer func() {
		if closeErr := ops.close(fd); closeErr != nil {
			err = errors.Join(err, closeErr)
		}
	}()
	if err := ops.validateHidrawOpen(sysRoot, node, fd, candidate, named, wantMajor, wantMinor); err != nil {
		return result, err
	}
	result.WriteAttempted = true
	if proto == ProtocolV1 {
		return ops.applyV1(fd, req, result)
	}
	return ops.applyV2(fd, req, result)
}

func (ops probeOps) applyV2(fd int, req WriteRequest, result ApplyResult) (ApplyResult, error) {
	if req.IsRGB {
		count := req.SlotCount
		if count < 1 {
			count = 6
		}
		for i := range count {
			idx := byte(i)
			cur, err := ops.readRecordV2(fd, i, 0x11, idx)
			if err != nil {
				return result, err
			}
			if err := MergeLightRecordV2(&cur, idx, req); err != nil {
				return result, err
			}
			if err := ops.writeWithAckV2(fd, i, cur, 0x11, idx); err != nil {
				return result, err
			}
			result.ReportsWritten++
		}
		if err := ops.writeWithAckV2(fd, count, SavePacketV2(), 0x0d, 0); err != nil {
			return result, err
		}
		result.ReportsWritten++
		return result, nil
	}
	cur, err := ops.readRecordV2(fd, 0, 0x10, req.SlotIndex)
	if err != nil {
		return result, err
	}
	MergeKeyRecordV2(&cur, req)
	if err := ops.writeWithAckV2(fd, 0, cur, 0x10, req.SlotIndex); err != nil {
		return result, err
	}
	result.ReportsWritten++
	if err := ops.writeWithAckV2(fd, 1, SavePacketV2(), 0x0d, 0); err != nil {
		return result, err
	}
	result.ReportsWritten++
	return result, nil
}

func (ops probeOps) readRecordV2(fd, step int, cmdID, index byte) (Packet, error) {
	readReq := Packet{0x21, 0x12, 0x00, 0x00, 0x04, 0x00, cmdID, index}
	SignPacketV2(&readReq)
	if n, err := ops.writeHidraw(fd, readReq[:]); err != nil || n != 64 {
		if err != nil {
			return Packet{}, fmt.Errorf("read-before-write report %d query: %w", step+1, err)
		}
		return Packet{}, fmt.Errorf("read-before-write report %d query wrote %d bytes, want 64", step+1, n)
	}
	var cur Packet
	n, err := ops.readHidraw(fd, cur[:], 1000)
	if err != nil {
		return Packet{}, fmt.Errorf("read-before-write report %d reply: %w", step+1, err)
	}
	if n != 64 || cur[0] != 0x21 || cur[4] != 0x3c || cur[5] != 0x00 || cur[6] != cmdID || cur[7] != index {
		return Packet{}, fmt.Errorf("invalid read-before-write report %d reply", step+1)
	}
	return cur, nil
}

func (ops probeOps) writeWithAckV2(fd, step int, pkt Packet, cmdID, index byte) error {
	if n, err := ops.writeHidraw(fd, pkt[:]); err != nil || n != 64 {
		if err != nil {
			return fmt.Errorf("write report %d: %w", step+1, err)
		}
		return fmt.Errorf("write report %d: wrote %d bytes, want 64", step+1, n)
	}
	var ack Packet
	n, err := ops.readHidraw(fd, ack[:], 1000)
	if err != nil {
		return fmt.Errorf("read report %d ACK: %w", step+1, err)
	}
	if n != 64 || ack[0] != 0x21 || ack[5]&0x40 != 0 || ack[6] != cmdID || (cmdID != 0x0d && ack[7] != index) {
		return fmt.Errorf("invalid report %d ACK", step+1)
	}
	return nil
}

func (ops probeOps) applyV1(fd int, req WriteRequest, result ApplyResult) (ApplyResult, error) {
	if req.IsRGB {
		count := req.SlotCount
		if count < 1 {
			count = 6
		}
		for i := range count {
			idx := byte(i)
			cur, err := ops.readRecordV1(fd, i, 0x10, idx)
			if err != nil {
				return result, err
			}
			if err := MergeLightRecordV1(&cur, idx, req); err != nil {
				return result, err
			}
			if err := ops.writeWithAckV1(fd, i, cur, 0x10, idx); err != nil {
				return result, err
			}
			result.ReportsWritten++
		}
		if err := ops.writeWithAckV1(fd, count, SavePacketV1(), 0x04, 0); err != nil {
			return result, err
		}
		result.ReportsWritten++
		return result, nil
	}
	cur, err := ops.readRecordV1(fd, 0, 0x16, req.SlotIndex)
	if err != nil {
		return result, err
	}
	MergeKeyRecordV1(&cur, req)
	if err := ops.writeWithAckV1(fd, 0, cur, 0x16, req.SlotIndex); err != nil {
		return result, err
	}
	result.ReportsWritten++
	if err := ops.writeWithAckV1(fd, 1, SavePacketV1(), 0x04, 0); err != nil {
		return result, err
	}
	result.ReportsWritten++
	return result, nil
}

func (ops probeOps) readRecordV1(fd, step int, cmd, index byte) (Packet, error) {
	var readReq Packet
	if cmd == 0x16 {
		readReq = QueryKeyPacketV1(index)
	} else {
		readReq = QueryLightPacketV1(index)
	}
	if n, err := ops.writeHidraw(fd, readReq[:]); err != nil || n != 64 {
		if err != nil {
			return Packet{}, fmt.Errorf("read-before-write report %d query: %w", step+1, err)
		}
		return Packet{}, fmt.Errorf("read-before-write report %d query wrote %d bytes, want 64", step+1, n)
	}
	var cur Packet
	n, err := ops.readHidraw(fd, cur[:], 1000)
	if err != nil {
		return Packet{}, fmt.Errorf("read-before-write report %d reply: %w", step+1, err)
	}
	if n != 64 || cur[0] != 0x02 || cur[1] != cmd || cur[4] != index {
		return Packet{}, fmt.Errorf("invalid read-before-write report %d reply", step+1)
	}
	return cur, nil
}

func (ops probeOps) writeWithAckV1(fd, step int, pkt Packet, cmd, index byte) error {
	if n, err := ops.writeHidraw(fd, pkt[:]); err != nil || n != 64 {
		if err != nil {
			return fmt.Errorf("write report %d: %w", step+1, err)
		}
		return fmt.Errorf("write report %d: wrote %d bytes, want 64", step+1, n)
	}
	var ack Packet
	n, err := ops.readHidraw(fd, ack[:], 1000)
	if err != nil {
		return fmt.Errorf("read report %d ACK: %w", step+1, err)
	}
	if n != 64 || ack[0] != 0x02 || ack[1] != cmd || (cmd != 0x04 && ack[4] != index) {
		return fmt.Errorf("invalid report %d ACK", step+1)
	}
	return nil
}
