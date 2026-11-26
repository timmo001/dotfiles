package ch57

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"unsafe"

	"golang.org/x/sys/unix"
)

// These bytes reconstruct the complete 36-byte item listing published at
// https://github.com/the-via/keyboards/issues/2169. They are not a local capture.
// Report ID 3 has 64 eight-bit Input fields and 64 eight-bit Output fields.
const candidateReportDescriptor = "\x06\x00\xff\x09\x01\xa1\x01\x85\x03\x09\x02\x15\x00\x26\x00\xff\x75\x08\x95\x40\x81\x06\x09\x02\x15\x00\x26\x00\xff\x75\x08\x95\x40\x91\x06\xc0"

// DiscoveredCandidate binds a descriptor match to one sysfs device instance.
// Obtain this value through DiscoverCandidates. Do not persist it across runs.
type DiscoveredCandidate struct {
	Candidate
	ProductName  string
	SysfsPath    string
	BusNumber    int
	DeviceNumber int
	identity     [2]uint64
}

// ProbeStatus distinguishes a raw report from a refusal or failed transfer.
type ProbeStatus string

const (
	ProbeRefused          ProbeStatus = "refused"
	ProbeDescriptorFailed ProbeStatus = "report-descriptor-failed"
	ProbeTransferFailed   ProbeStatus = "get-report-failed"
	ProbeInvalidReport    ProbeStatus = "invalid-report"
	ProbeRawReport        ProbeStatus = "raw-report-only"
	ProbeCloseFailed      ProbeStatus = "close-failed"
)

type SlotActionType byte

const (
	SlotActionNone     SlotActionType = 0
	SlotActionKeyboard SlotActionType = 1
	SlotActionMedia    SlotActionType = 2
	SlotActionMouse    SlotActionType = 3
	SlotActionMacro    SlotActionType = 5
)

type SlotBinding struct {
	Slot       byte
	Layer      byte
	ActionType SlotActionType
	Strokes    []Stroke
	MediaUsage uint16
	Mouse      MouseEvent
}

type LayoutInfo struct {
	Keys     int
	Knobs    int
	Kind     int
	Bindings map[byte]SlotBinding
}

// ProbeResult preserves raw GET_REPORT bytes, including an invalid short reply.
// A valid report is not proof of settings readback or firmware identity.
type ProbeResult struct {
	Status                   ProbeStatus
	Raw                      []byte
	Count                    int
	ReportDescriptor         []byte
	ReportDescriptorCount    int
	ReportDescriptorVerified bool
	Warning                  string
	Layout                   *LayoutInfo
}

// ApplyResult records whether a write sequence was started and how many encoded reports completed.
type ApplyResult struct {
	WriteAttempted bool
	ReportsWritten int
}

// usbControlTransfer follows struct usbdevfs_ctrltransfer in Linux UAPI.
// Go supplies the native pointer alignment, including padding after Timeout.
type usbControlTransfer struct {
	RequestType uint8
	Request     uint8
	Value       uint16
	Index       uint16
	Length      uint16
	Timeout     uint32
	Data        unsafe.Pointer
}

// usbBulkTransfer follows struct usbdevfs_bulktransfer in Linux UAPI.
type usbBulkTransfer struct {
	Ep      uint32
	Len     uint32
	Timeout uint32
	Data    unsafe.Pointer
}

// usbIoctl follows struct usbdevfs_ioctl in Linux UAPI.
type usbIoctl struct {
	Ifno      int32
	IoctlCode int32
	Data      unsafe.Pointer
}

// _IOWR('U', 0, sizeof(struct usbdevfs_ctrltransfer)). The combined direction
// bits are 0xc0000000 on Linux, including MIPS and PowerPC ioctl encodings.
const (
	usbdevfsControl          = uintptr(0xc0005500) | unsafe.Sizeof(usbControlTransfer{})<<16
	usbdevfsBulk             = uintptr(0xc0005502) | unsafe.Sizeof(usbBulkTransfer{})<<16
	usbdevfsClaimInterface   = uintptr(0x8004550f)
	usbdevfsReleaseInterface = uintptr(0x80045510)
	usbdevfsIoctl            = uintptr(0xc0005512) | unsafe.Sizeof(usbIoctl{})<<16
	usbdevfsDisconnect       = int32(0x00005516)
	usbdevfsConnect          = int32(0x00005517)
)

type probeOps struct {
	readDir          func(string) ([]os.DirEntry, error)
	readFile         func(string, int) ([]byte, error)
	evalSymlinks     func(string) (string, error)
	stat             func(string) (os.FileInfo, error)
	lstat            func(string, *unix.Stat_t) error
	open             func(string, int, uint32) (int, error)
	fstat            func(int, *unix.Stat_t) error
	close            func(int) error
	ioctl            func(int, uintptr, *usbControlTransfer) (int, error)
	claimInterface   func(int, uint32) error
	releaseInterface func(int, uint32) error
	detachDriver     func(int, int32) error
	attachDriver     func(int, int32) error
	bulkOut          func(int, *usbBulkTransfer) (int, error)
	writeHidraw      func(int, []byte) (int, error)
	readHidraw       func(int, []byte, int) (int, error)
}

func systemProbeOps() probeOps {
	return probeOps{
		readDir: os.ReadDir, readFile: readProbeFile, evalSymlinks: filepath.EvalSymlinks,
		stat: os.Stat, lstat: unix.Lstat, open: unix.Open, fstat: unix.Fstat,
		close: unix.Close, ioctl: controlIN,
		claimInterface: claimUSBInterface, releaseInterface: releaseUSBInterface,
		detachDriver: detachUSBDriver, attachDriver: attachUSBDriver, bulkOut: writeBulkOut,
		writeHidraw: writeHidrawReport, readHidraw: readHidrawReport,
	}
}

// DiscoverCandidates reads cached descriptors below sysRoot, normally
// /sys/bus/usb/devices. It does not open USB device nodes or send requests.
// Callers must obtain user authority before inspecting real sysfs devices.
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

// inspect preserves Candidate after an exact descriptor match, even if later checks fail.
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
	if strings.EqualFold(productName, "LCKEY") {
		return result, fmt.Errorf("LCKEY LCD device is not a supported CH57x macropad")
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
		identity: [2]uint64{st.Dev, st.Ino},
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

// ProbeCandidate opens one revalidated node below devRoot, normally /dev/bus/usb.
// It sends only GET_DESCRIPTOR and Input GET_REPORT, once each, with a 1000 ms
// kernel timeout per request. Linux usbfs requires O_RDWR even for control IN.
// Callers must obtain user authority before calling this function on hardware.
// A bound interface can cause EBUSY. No driver is detached to bypass that error.
// It does not reset devices, retry, or decode settings.
func ProbeCandidate(sysRoot, devRoot string, candidate DiscoveredCandidate) (ProbeResult, error) {
	return systemProbeOps().probe(sysRoot, devRoot, candidate)
}

// ProbeOutputCandidate uses the same checks and bounds as ProbeCandidate, but
// requests Output report ID 3 instead of Input. GET_REPORT remains control IN.
// Callers must obtain user authority before calling this function on hardware.
func ProbeOutputCandidate(sysRoot, devRoot string, candidate DiscoveredCandidate) (ProbeResult, error) {
	return systemProbeOps().probeReport(sysRoot, devRoot, candidate, true)
}

// ApplyCandidate revalidates candidate, verifies interface 1 report descriptor,
// claims interface 1, and writes the 64-byte zero initialisation packet followed
// by reports to endpoint 0x02 with a 1000 ms timeout per transfer.
func ApplyCandidate(sysRoot, devRoot string, candidate DiscoveredCandidate, reports []Report) (ApplyResult, error) {
	return systemProbeOps().apply(sysRoot, devRoot, candidate, reports)
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

func (ops probeOps) probe(sysRoot, devRoot string, candidate DiscoveredCandidate) (ProbeResult, error) {
	if IsK884xFamily(candidate.VID, candidate.PID) {
		return ops.probe514C(sysRoot, devRoot, candidate)
	}
	return ops.probeReport(sysRoot, devRoot, candidate, false)
}

func (ops probeOps) probeReport(sysRoot, devRoot string, candidate DiscoveredCandidate, output bool) (result ProbeResult, err error) {
	report, value := "input", uint16(0x0103)
	if output {
		report, value = "output", 0x0203
	}
	result.Status = ProbeRefused
	result.Warning = "No stock 8890 settings readback is known. Raw " + report + " is not decoded settings or firmware identification."
	if !filepath.IsAbs(devRoot) {
		return result, fmt.Errorf("USB device root must be absolute")
	}
	if err := ops.revalidate(sysRoot, candidate); err != nil {
		return result, err
	}
	node := filepath.Join(devRoot, fmt.Sprintf("%03d", candidate.BusNumber), fmt.Sprintf("%03d", candidate.DeviceNumber))
	var named unix.Stat_t
	if err := ops.lstat(node, &named); err != nil {
		return result, err
	}
	if err := checkUSBNode(named, candidate); err != nil {
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
	if err := ops.validateOpen(sysRoot, node, fd, candidate, named); err != nil {
		return result, err
	}
	result.Status = ProbeDescriptorFailed
	descriptor := make([]byte, len(candidateReportDescriptor))
	count, err := ops.readControl(fd, 0x81, 0x06, 0x2200, descriptor)
	result.ReportDescriptorCount = count
	if count >= 0 && count <= len(descriptor) {
		result.ReportDescriptor = descriptor[:count]
	}
	if err != nil {
		return result, fmt.Errorf("GET_DESCRIPTOR: %w", err)
	}
	if count != len(descriptor) || string(descriptor) != candidateReportDescriptor {
		return result, fmt.Errorf("interface 1 report descriptor differs from published report ID 3 layout")
	}
	result.ReportDescriptorVerified = true
	result.Status = ProbeRefused
	if err := ops.validateOpen(sysRoot, node, fd, candidate, named); err != nil {
		return result, err
	}
	result.Status = ProbeTransferFailed
	data := make([]byte, 65)
	count, err = ops.readControl(fd, 0xa1, 0x01, value, data)
	result.Count = count
	if count >= 0 && count <= len(data) {
		result.Raw = data[:count]
	}
	if err != nil {
		return result, fmt.Errorf("%s GET_REPORT: %w", report, err)
	}
	result.Status = ProbeInvalidReport
	if count == 1 && data[0] == 0xaa {
		result.Status = ProbeRawReport
		return result, nil
	}
	if count != 65 {
		return result, fmt.Errorf("%s GET_REPORT returned %d bytes, want 65 including report ID", report, count)
	}
	if data[0] != 3 {
		return result, fmt.Errorf("%s GET_REPORT returned report ID %d, want 3", report, data[0])
	}
	result.Status = ProbeRawReport
	return result, nil
}

func checkUSBNode(st unix.Stat_t, candidate DiscoveredCandidate) error {
	minor := (candidate.BusNumber-1)*128 + candidate.DeviceNumber - 1
	if minor < 0 || minor > 0xfffff {
		return fmt.Errorf("USB device number is out of range")
	}
	if st.Mode&unix.S_IFMT != unix.S_IFCHR || unix.Major(st.Rdev) != 189 || unix.Minor(st.Rdev) != uint32(minor) {
		return fmt.Errorf("selected node is not the expected USB character device")
	}
	return nil
}

func (ops probeOps) validateOpen(sysRoot, node string, fd int, candidate DiscoveredCandidate, before unix.Stat_t) error {
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
	if err := checkUSBNode(opened, candidate); err != nil {
		return err
	}
	if named.Mode&unix.S_IFMT != unix.S_IFCHR || opened.Dev != before.Dev || opened.Ino != before.Ino ||
		opened.Rdev != before.Rdev || opened.Dev != named.Dev || opened.Ino != named.Ino || opened.Rdev != named.Rdev {
		return fmt.Errorf("opened USB node identity changed")
	}
	return nil
}

func (ops probeOps) readControl(fd int, requestType, request uint8, value uint16, data []byte) (int, error) {
	length := len(data)
	if length < 1 || length > 65 {
		return 0, fmt.Errorf("invalid control IN buffer size")
	}
	transfer := usbControlTransfer{
		RequestType: requestType, Request: request, Value: value, Index: 1,
		Length: uint16(length), Timeout: 1000, Data: unsafe.Pointer(&data[0]),
	}
	count, err := ops.ioctl(fd, usbdevfsControl, &transfer)
	runtime.KeepAlive(data)
	return count, err
}

func controlIN(fd int, request uintptr, transfer *usbControlTransfer) (int, error) {
	if transfer == nil {
		return 0, fmt.Errorf("missing control IN transfer")
	}
	isDescriptor := transfer.RequestType == 0x81 && transfer.Request == 6 && transfer.Value == 0x2200 && transfer.Length == 36
	isReport := transfer.RequestType == 0xa1 && transfer.Request == 1 && (transfer.Value == 0x0103 || transfer.Value == 0x0203) && transfer.Length == 65
	if request != usbdevfsControl || transfer.Index != 1 || transfer.Timeout != 1000 || transfer.Data == nil || (!isDescriptor && !isReport) {
		return 0, fmt.Errorf("refused control request outside the read-only probe")
	}
	n, _, errno := syscall.Syscall(syscall.SYS_IOCTL, uintptr(fd), request, uintptr(unsafe.Pointer(transfer)))
	runtime.KeepAlive(transfer)
	if errno != 0 {
		return 0, errno
	}
	return int(n), nil
}

func (ops probeOps) apply(sysRoot, devRoot string, candidate DiscoveredCandidate, reports []Report) (result ApplyResult, err error) {
	if len(reports) < 1 || len(reports) > 16 {
		return result, fmt.Errorf("apply requires 1..16 reports")
	}
	if !filepath.IsAbs(devRoot) {
		return result, fmt.Errorf("USB device root must be absolute")
	}
	for i, r := range reports {
		if r[0] != 0x03 {
			return result, fmt.Errorf("report %d requires report ID 3", i+1)
		}
	}
	if IsK884xFamily(candidate.VID, candidate.PID) {
		return ops.apply514C(sysRoot, devRoot, candidate, reports)
	}
	if err := ops.revalidate(sysRoot, candidate); err != nil {
		return result, err
	}
	node := filepath.Join(devRoot, fmt.Sprintf("%03d", candidate.BusNumber), fmt.Sprintf("%03d", candidate.DeviceNumber))
	var named unix.Stat_t
	if err := ops.lstat(node, &named); err != nil {
		return result, err
	}
	if err := checkUSBNode(named, candidate); err != nil {
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
	if err := ops.validateOpen(sysRoot, node, fd, candidate, named); err != nil {
		return result, err
	}
	descriptor := make([]byte, len(candidateReportDescriptor))
	count, err := ops.readControl(fd, 0x81, 0x06, 0x2200, descriptor)
	if err != nil {
		return result, fmt.Errorf("GET_DESCRIPTOR: %w", err)
	}
	if count != len(descriptor) || string(descriptor) != candidateReportDescriptor {
		return result, fmt.Errorf("interface 1 report descriptor differs from published report ID 3 layout")
	}
	if err := ops.validateOpen(sysRoot, node, fd, candidate, named); err != nil {
		return result, err
	}
	if err := ops.detachDriver(fd, 1); err != nil {
		return result, fmt.Errorf("detach interface 1 driver: %w", err)
	}
	if err := ops.claimInterface(fd, 1); err != nil {
		_ = ops.attachDriver(fd, 1)
		return result, fmt.Errorf("claim interface 1: %w", err)
	}
	defer func() {
		err = errors.Join(err, ops.releaseInterface(fd, 1), ops.attachDriver(fd, 1))
	}()
	result.WriteAttempted = true
	var initPacket Report
	if err := ops.writeReport(fd, initPacket); err != nil {
		return result, fmt.Errorf("write initialisation packet: %w", err)
	}
	for i, report := range reports {
		if err := ops.writeReport(fd, report); err != nil {
			return result, fmt.Errorf("write report %d: %w", i+1, err)
		}
		result.ReportsWritten++
	}
	return result, nil
}

func (ops probeOps) writeReport(fd int, report Report) error {
	data := report
	transfer := usbBulkTransfer{
		Ep:      0x02,
		Len:     uint32(len(data)),
		Timeout: 1000,
		Data:    unsafe.Pointer(&data[0]),
	}
	count, err := ops.bulkOut(fd, &transfer)
	runtime.KeepAlive(&data)
	if err != nil {
		return err
	}
	if count != len(data) {
		return fmt.Errorf("wrote %d bytes, want %d", count, len(data))
	}
	return nil
}

func claimUSBInterface(fd int, ifno uint32) error {
	if ifno != 1 {
		return fmt.Errorf("refused USB interface claim for interface %d", ifno)
	}
	_, _, errno := syscall.Syscall(syscall.SYS_IOCTL, uintptr(fd), usbdevfsClaimInterface, uintptr(unsafe.Pointer(&ifno)))
	runtime.KeepAlive(&ifno)
	if errno != 0 {
		return errno
	}
	return nil
}

func releaseUSBInterface(fd int, ifno uint32) error {
	if ifno != 1 {
		return fmt.Errorf("refused USB interface release for interface %d", ifno)
	}
	_, _, errno := syscall.Syscall(syscall.SYS_IOCTL, uintptr(fd), usbdevfsReleaseInterface, uintptr(unsafe.Pointer(&ifno)))
	runtime.KeepAlive(&ifno)
	if errno != 0 {
		return errno
	}
	return nil
}

func detachUSBDriver(fd int, ifno int32) error {
	if ifno != 1 {
		return fmt.Errorf("refused USB driver detach for interface %d", ifno)
	}
	command := usbIoctl{Ifno: ifno, IoctlCode: usbdevfsDisconnect}
	_, _, errno := syscall.Syscall(syscall.SYS_IOCTL, uintptr(fd), usbdevfsIoctl, uintptr(unsafe.Pointer(&command)))
	runtime.KeepAlive(&command)
	if errno != 0 && errno != unix.ENODATA {
		return errno
	}
	return nil
}

func attachUSBDriver(fd int, ifno int32) error {
	if ifno != 1 {
		return fmt.Errorf("refused USB driver attach for interface %d", ifno)
	}
	command := usbIoctl{Ifno: ifno, IoctlCode: usbdevfsConnect}
	_, _, errno := syscall.Syscall(syscall.SYS_IOCTL, uintptr(fd), usbdevfsIoctl, uintptr(unsafe.Pointer(&command)))
	runtime.KeepAlive(&command)
	if errno != 0 && errno != unix.ENODATA && errno != unix.EBUSY {
		return errno
	}
	return nil
}

func writeBulkOut(fd int, transfer *usbBulkTransfer) (int, error) {
	if transfer == nil || transfer.Ep != 0x02 || transfer.Len != 64 || transfer.Timeout != 1000 || transfer.Data == nil {
		return 0, fmt.Errorf("refused bulk transfer outside interface 1 endpoint 0x02 report write")
	}
	n, _, errno := syscall.Syscall(syscall.SYS_IOCTL, uintptr(fd), usbdevfsBulk, uintptr(unsafe.Pointer(transfer)))
	runtime.KeepAlive(transfer)
	if errno != 0 {
		return 0, errno
	}
	return int(n), nil
}

func writeHidrawReport(fd int, data []byte) (int, error) {
	if len(data) != 65 || data[0] != 0x03 {
		return 0, fmt.Errorf("refused hidraw write outside 65-byte report ID 3")
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
	if fd < 0 || fd > 0x7fffffff || len(data) != 65 || timeoutMs <= 0 {
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

func (ops probeOps) locate514CHidraw(candidate DiscoveredCandidate) (string, []byte, uint32, uint32, error) {
	return ops.locateCandidateHidraw(candidate, 0, len(candidateReportDescriptor), func(d []byte) bool {
		return string(d) == candidateReportDescriptor
	})
}

func (ops probeOps) locateCandidateHidraw(candidate DiscoveredCandidate, iface, maxDescriptor int, checkDescriptor func([]byte) bool) (string, []byte, uint32, uint32, error) {
	ifaceDir := filepath.Join(candidate.SysfsPath, fmt.Sprintf("%s:1.%d", candidate.PhysicalPath, iface))
	entries, err := ops.readDir(ifaceDir)
	if err != nil {
		return "", nil, 0, 0, err
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
		return "", nil, 0, 0, fmt.Errorf("interface %d requires exactly one HID device", iface)
	}
	hidDir := hidDirs[0]
	descriptor, err := ops.readFile(filepath.Join(hidDir, "report_descriptor"), maxDescriptor)
	if err != nil {
		return "", descriptor, 0, 0, fmt.Errorf("read interface %d report descriptor: %w", iface, err)
	}
	if !checkDescriptor(descriptor) {
		return "", descriptor, 0, 0, fmt.Errorf("interface %d report descriptor differs from expected layout", iface)
	}
	hidrawEntries, err := ops.readDir(filepath.Join(hidDir, "hidraw"))
	if err != nil || len(hidrawEntries) != 1 || !strings.HasPrefix(hidrawEntries[0].Name(), "hidraw") {
		return "", descriptor, 0, 0, fmt.Errorf("interface %d requires exactly one hidraw node", iface)
	}
	hidrawName := hidrawEntries[0].Name()
	devBytes, err := ops.readFile(filepath.Join(hidDir, "hidraw", hidrawName, "dev"), 32)
	if err != nil {
		return "", descriptor, 0, 0, err
	}
	wantMajor, wantMinor, err := parseDevNumbers(string(devBytes))
	if err != nil {
		return "", descriptor, 0, 0, err
	}
	return hidrawName, descriptor, wantMajor, wantMinor, nil
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
	return nil
}

func (ops probeOps) probe514C(sysRoot, devRoot string, candidate DiscoveredCandidate) (result ProbeResult, err error) {
	result.Status = ProbeRefused
	if !filepath.IsAbs(devRoot) {
		return result, fmt.Errorf("USB device root must be absolute")
	}
	if err := ops.revalidate(sysRoot, candidate); err != nil {
		return result, err
	}
	hidrawName, descriptor, wantMajor, wantMinor, err := ops.locate514CHidraw(candidate)
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
	return ops.exchange514CLayoutAndSettings(fd, result)
}

func (ops probeOps) exchange514CLayoutAndSettings(fd int, result ProbeResult) (ProbeResult, error) {
	result.Status = ProbeTransferFailed
	fbReq := [65]byte{0x03, 0xfb, 0xfb, 0xfb}
	if n, err := ops.writeHidraw(fd, fbReq[:]); err != nil || n != 65 {
		if err != nil {
			return result, fmt.Errorf("write 0xFB layout query: %w", err)
		}
		return result, fmt.Errorf("write 0xFB layout query wrote %d bytes, want 65", n)
	}
	var fbReply [65]byte
	n, err := ops.readHidraw(fd, fbReply[:], 1000)
	result.Count = n
	if n >= 0 && n <= len(fbReply) {
		result.Raw = fbReply[:n]
	}
	if err != nil {
		return result, fmt.Errorf("read 0xFB layout reply: %w", err)
	}
	result.Status = ProbeInvalidReport
	if n != 65 || fbReply[0] != 0x03 || fbReply[1] != 0xfb {
		return result, fmt.Errorf("invalid 0xFB layout reply")
	}
	keys, knobs, kind := int(fbReply[2]), int(fbReply[3]), int(fbReply[4])
	if keys < 1 || keys > 12 || knobs < 0 || knobs > 4 {
		return result, fmt.Errorf("unsupported 0xFB layout (%d keys, %d knobs)", keys, knobs)
	}
	result.Status = ProbeTransferFailed
	faReq := [65]byte{0x03, 0xfa, 0x0f, 0x03, 0x01}
	reportCount := 24
	if kind >= 10 {
		faReq = [65]byte{0x03, 0xfa, 0x19, 0x00, 0x01}
		reportCount = 25
	}
	if n, err := ops.writeHidraw(fd, faReq[:]); err != nil || n != 65 {
		if err != nil {
			return result, fmt.Errorf("write 0xFA settings query: %w", err)
		}
		return result, fmt.Errorf("write 0xFA settings query wrote %d bytes, want 65", n)
	}
	bindings := make(map[byte]SlotBinding, reportCount)
	for i := range reportCount {
		var r [65]byte
		n, err := ops.readHidraw(fd, r[:], 1000)
		if err != nil {
			if i == 0 && errors.Is(err, unix.ETIMEDOUT) {
				result.Status = ProbeRawReport
				result.Layout = &LayoutInfo{Keys: keys, Knobs: knobs, Kind: kind}
				return result, nil
			}
			return result, fmt.Errorf("read 0xFA report %d: %w", i+1, err)
		}
		if n != 65 || r[0] != 0x03 || r[1] != 0xfa {
			result.Status = ProbeInvalidReport
			return result, fmt.Errorf("invalid 0xFA report %d", i+1)
		}
		if kind >= 10 {
			b := DecodeFASlotKindGe10(r[:])
			bindings[b.Slot] = b
		} else {
			b := DecodeFASlotKindLt10(r[:])
			bindings[b.Slot] = b
		}
	}
	result.Status = ProbeRawReport
	result.Layout = &LayoutInfo{Keys: keys, Knobs: knobs, Kind: kind, Bindings: bindings}
	return result, nil
}

// DecodeFASlotKindLt10 decodes a 65-byte 0xFA slot report for kind < 10 firmware.
func DecodeFASlotKindLt10(r []byte) SlotBinding {
	b := SlotBinding{
		Slot:       r[2],
		Layer:      r[3],
		ActionType: SlotActionType(r[4]),
	}
	switch b.ActionType {
	case SlotActionKeyboard, SlotActionMacro:
		count := int(r[10])
		if count == 0 && r[11] != 0 && r[12] == 0 {
			b.Strokes = []Stroke{{Modifiers: int(r[11]), Usage: 0}}
			return b
		}
		for i := 0; i < count && 12+2*i < len(r); i++ {
			mod := int(r[11+2*i])
			usage := int(r[12+2*i])
			if mod != 0 || usage != 0 {
				b.Strokes = append(b.Strokes, Stroke{Modifiers: mod, Usage: usage})
			}
		}
	case SlotActionMedia:
		b.MediaUsage = uint16(r[11]) | (uint16(r[12]) << 8)
	case SlotActionMouse:
		b.Mouse = decodeMouseEvent(MouseModifier(r[11]), MouseButtons(r[12]), signedReportByte(r[13]), signedReportByte(r[14]), signedReportByte(r[15]))
	}
	return b
}

// DecodeFASlotKindGe10 decodes a 65-byte 0xFA slot report for kind >= 10 firmware.
func DecodeFASlotKindGe10(r []byte) SlotBinding {
	b := SlotBinding{
		Slot:       r[2],
		Layer:      r[3],
		ActionType: SlotActionType(r[4]),
	}
	switch b.ActionType {
	case SlotActionKeyboard, SlotActionMacro:
		entryCount := int(r[6])
		pendingMods := 0
		for i := 0; i < entryCount && 9+3*i < len(r); i++ {
			code := r[9+3*i]
			switch {
			case code >= 0xf1 && code <= 0xf8:
				bit := 1 << (code - 0xf1)
				if pendingMods&bit != 0 {
					b.Strokes = append(b.Strokes, Stroke{Modifiers: pendingMods, Usage: 0})
					pendingMods = bit
				} else {
					pendingMods |= bit
				}
			case code != 0 && code < 0xf0:
				b.Strokes = append(b.Strokes, Stroke{Modifiers: pendingMods, Usage: int(code)})
				pendingMods = 0
			}
		}
		if pendingMods != 0 {
			b.Strokes = append(b.Strokes, Stroke{Modifiers: pendingMods, Usage: 0})
		}
	case SlotActionMedia:
		b.MediaUsage = uint16(r[9]) | (uint16(r[12]) << 8)
	case SlotActionMouse:
		modCode := r[9]
		var mod MouseModifier
		if modCode >= 0xf1 && modCode <= 0xf8 {
			mod = MouseModifier(1 << (modCode - 0xf1))
		} else {
			mod = MouseModifier(modCode)
		}
		b.Mouse = decodeMouseEvent(mod, MouseButtons(r[12]), signedReportByte(r[15]), signedReportByte(r[18]), signedReportByte(r[21]))
	}
	return b
}

func signedReportByte(value byte) int {
	if value > 127 {
		return int(value) - 256
	}
	return int(value)
}

func decodeMouseEvent(mod MouseModifier, buttons MouseButtons, dx, dy, wheel int) MouseEvent {
	var action MouseAction
	switch {
	case wheel != 0:
		action = MouseWheel
	case buttons != 0 && (dx != 0 || dy != 0):
		action = MouseDrag
	case buttons != 0:
		action = MouseClick
	case dx != 0 || dy != 0:
		action = MouseMove
	}
	return MouseEvent{Action: action, Buttons: buttons, DX: dx, DY: dy, Wheel: wheel, Modifier: mod}
}

func (ops probeOps) apply514C(sysRoot, devRoot string, candidate DiscoveredCandidate, reports []Report) (result ApplyResult, err error) {
	if err := ops.revalidate(sysRoot, candidate); err != nil {
		return result, err
	}
	hidrawName, _, wantMajor, wantMinor, err := ops.locate514CHidraw(candidate)
	if err != nil {
		return result, err
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
	for i, report := range reports {
		var raw [65]byte
		copy(raw[:64], report[:])
		n, err := ops.writeHidraw(fd, raw[:])
		if err != nil {
			return result, fmt.Errorf("write report %d: %w", i+1, err)
		}
		if n != 65 {
			return result, fmt.Errorf("write report %d: wrote %d bytes, want 65", i+1, n)
		}
		result.ReportsWritten++
	}
	return result, nil
}
