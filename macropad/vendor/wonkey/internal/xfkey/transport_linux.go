package xfkey

import (
	"bytes"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"syscall"
	"time"
	"unsafe"

	"golang.org/x/sys/unix"
)

const transactionTimeout = 2 * time.Second

type queryTransport interface {
	Validate() error
	Wait(write bool, deadline time.Time) error
	StartWrite([]byte, time.Time) (<-chan writeResult, error)
	Read([]byte) (int, error)
}

type writeResult struct {
	n   int
	err error
}

func query(t queryTransport, command byte) ([]byte, error) {
	return queryWithTimeout(t, command, transactionTimeout)
}

func queryWithTimeout(t queryTransport, command byte, timeout time.Duration) ([]byte, error) {
	switch command {
	case 1, 6, 7, 8:
	default:
		return nil, fmt.Errorf("query %02x is not authorised", command)
	}
	return exchange(t, vendorPacket{0xaf, command}, timeout)
}

// exchange is internal transport only. Callers retain separate query and upload guards.
func exchange(t queryTransport, packet vendorPacket, timeout time.Duration) ([]byte, error) {
	if err := t.Validate(); err != nil {
		return nil, err
	}
	deadline := time.Now().Add(timeout)
	if err := t.Wait(true, deadline); err != nil {
		return nil, err
	}
	output := hidrawOutput(packet)
	// hidraw O_NONBLOCK does not bound the kernel's USB output call.
	// On timeout, abandon this session without further queries or retries.
	remaining := time.Until(deadline)
	if remaining <= 0 {
		return nil, os.ErrDeadlineExceeded
	}
	timer := time.NewTimer(remaining)
	defer timer.Stop()
	written, err := t.StartWrite(output[:], deadline)
	if err != nil {
		return nil, err
	}
	var n int
	select {
	case result := <-written:
		n, err = result.n, result.err
	case <-timer.C:
		return nil, os.ErrDeadlineExceeded
	}
	if time.Now().After(deadline) {
		return nil, os.ErrDeadlineExceeded
	}
	if err != nil {
		return nil, err
	}
	if n != len(output) {
		return nil, fmt.Errorf("short report write: %d of 65; no retry", n)
	}
	if err := t.Wait(false, deadline); err != nil {
		return nil, err
	}
	var reply [65]byte
	n, err = t.Read(reply[:])
	if err != nil {
		if n > 0 {
			return reply[:n], err
		}
		return nil, err
	}
	if time.Now().After(deadline) {
		return reply[:n], os.ErrDeadlineExceeded
	}
	if err := validateReply(reply[:n], packet[1]); err != nil {
		return reply[:n], err
	}
	return reply[:n], nil
}

type hidrawTransport struct {
	fd     int
	target Candidate
}

func ioctl(fd int, request uintptr, pointer unsafe.Pointer) error {
	_, _, errno := syscall.Syscall(syscall.SYS_IOCTL, uintptr(fd), request, uintptr(pointer))
	if errno != 0 {
		return errno
	}
	return nil
}

func revalidateCandidate(target Candidate) (*Candidate, error) {
	fresh, err := discover("/sys/bus/usb/devices", "/dev")
	if err != nil {
		return nil, err
	}
	c, err := selectCandidate(fresh, target.PhysicalPath)
	if err != nil {
		return nil, err
	}
	if !sameCandidate(*c, target) {
		return nil, fmt.Errorf("selected descriptor, path or node changed")
	}
	return c, nil
}

func openTarget(target Candidate) (*hidrawTransport, error) {
	c, err := revalidateCandidate(target)
	if err != nil {
		return nil, err
	}
	fd, err := syscall.Open(c.VendorNode.Path, syscall.O_RDWR|syscall.O_NONBLOCK|syscall.O_CLOEXEC|syscall.O_NOFOLLOW, 0)
	if err != nil {
		return nil, err
	}
	t := &hidrawTransport{fd, *c}
	if err := t.Validate(); err != nil {
		syscall.Close(fd)
		return nil, err
	}
	return t, nil
}

func (t *hidrawTransport) Validate() error {
	c, err := revalidateCandidate(t.target)
	if err != nil {
		return err
	}
	var opened, named syscall.Stat_t
	if err := syscall.Fstat(t.fd, &opened); err != nil {
		return err
	}
	if err := syscall.Lstat(c.VendorNode.Path, &named); err != nil {
		return err
	}
	if [3]uint64{opened.Dev, opened.Ino, opened.Rdev} != t.target.VendorNode.identity {
		return fmt.Errorf("selected node identity changed")
	}
	if opened.Mode&syscall.S_IFMT != syscall.S_IFCHR || named.Mode&syscall.S_IFMT != syscall.S_IFCHR || opened.Rdev != named.Rdev || opened.Ino != named.Ino || opened.Dev != named.Dev {
		return fmt.Errorf("opened node identity mismatch")
	}
	major := unix.Major(opened.Rdev)
	minor := unix.Minor(opened.Rdev)
	actual, err := filepath.EvalSymlinks(fmt.Sprintf("/sys/dev/char/%d:%d/device", major, minor))
	if err != nil {
		return err
	}
	expected, err := filepath.Glob(filepath.Join(c.SysfsPath, c.PhysicalPath+":1.3", "*", "hidraw", filepath.Base(c.VendorNode.Path)))
	if err != nil || len(expected) != 1 {
		return fmt.Errorf("vendor mapping disappeared")
	}
	hid, err := filepath.EvalSymlinks(filepath.Dir(filepath.Dir(expected[0])))
	if err != nil {
		return err
	}
	if actual != hid {
		return fmt.Errorf("opened device is not selected vendor interface")
	}
	var info struct {
		Bus             uint32
		Vendor, Product uint16
	}
	if err := ioctl(t.fd, 0x80084803, unsafe.Pointer(&info)); err != nil {
		return err
	}
	if info.Bus != 3 || info.Vendor != 0xaf88 || info.Product != 0x6688 {
		return fmt.Errorf("opened HID identity differs")
	}
	var size uint32
	if err := ioctl(t.fd, 0x80044801, unsafe.Pointer(&size)); err != nil {
		return err
	}
	wanted, _ := hex.DecodeString(reportDescriptorHex[3])
	if uint64(size) != uint64(len(wanted)) {
		return fmt.Errorf("opened report descriptor length differs")
	}
	descriptor := struct {
		Size  uint32
		Value [4096]byte
	}{Size: size}
	if err := ioctl(t.fd, 0x90044802, unsafe.Pointer(&descriptor)); err != nil {
		return err
	}
	if descriptor.Size != size || !bytes.Equal(descriptor.Value[:size], wanted) {
		return fmt.Errorf("opened report descriptor differs")
	}
	return nil
}

func (t *hidrawTransport) Wait(write bool, deadline time.Time) error {
	if time.Until(deadline) <= 0 {
		return os.ErrDeadlineExceeded
	}
	// hidraw poll reports input readiness, not output readiness.
	if write {
		return nil
	}
	var set syscall.FdSet
	width := int(unsafe.Sizeof(set.Bits[0])) * 8
	if t.fd < 0 || t.fd >= len(set.Bits)*width {
		return fmt.Errorf("fd exceeds select bound")
	}
	remaining := time.Until(deadline)
	if remaining <= 0 {
		return os.ErrDeadlineExceeded
	}
	set.Bits[t.fd/width] |= 1 << uint(t.fd%width)
	timeout := syscall.NsecToTimeval(remaining.Nanoseconds())
	n, err := syscall.Select(t.fd+1, &set, nil, nil, &timeout)
	if err != nil {
		return err
	}
	if n == 0 || time.Now().After(deadline) {
		return os.ErrDeadlineExceeded
	}
	return nil
}

func (t *hidrawTransport) StartWrite(b []byte, deadline time.Time) (<-chan writeResult, error) {
	fd, _, errno := syscall.Syscall(syscall.SYS_FCNTL, uintptr(t.fd), syscall.F_DUPFD_CLOEXEC, 0)
	if errno != 0 {
		return nil, errno
	}
	result := make(chan writeResult, 1)
	go func() {
		defer syscall.Close(int(fd))
		if time.Now().After(deadline) {
			result <- writeResult{0, os.ErrDeadlineExceeded}
			return
		}
		n, err := syscall.Write(int(fd), b)
		result <- writeResult{n, err}
	}()
	return result, nil
}
func (t *hidrawTransport) Read(b []byte) (int, error) { return syscall.Read(t.fd, b) }
func (t *hidrawTransport) Close() error               { return syscall.Close(t.fd) }
