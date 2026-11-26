package xfkey

import (
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"testing"
)

func put(t *testing.T, path string, b []byte) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, b, 0o600); err != nil {
		t.Fatal(err)
	}
}

func fixture(t *testing.T, root, name string) string {
	t.Helper()
	dir := filepath.Join(root, name)
	for attr, value := range map[string]string{"idVendor": "af88", "idProduct": "6688", "bcdDevice": "0100"} {
		put(t, filepath.Join(dir, attr), []byte(value+"\n"))
	}
	usb, err := hex.DecodeString(usbDescriptorHex)
	if err != nil {
		t.Fatal(err)
	}
	put(t, filepath.Join(dir, "descriptors"), usb)
	for i, value := range reportDescriptorHex {
		interfaceDir := filepath.Join(dir, fmt.Sprintf("%s:1.%d", name, i))
		put(t, filepath.Join(interfaceDir, "bInterfaceNumber"), []byte(fmt.Sprintf("%02x", i)))
		descriptor, err := hex.DecodeString(value)
		if err != nil {
			t.Fatal(err)
		}
		put(t, filepath.Join(interfaceDir, "0003:AF88:6688.synthetic", "report_descriptor"), descriptor)
		if i == 3 {
			if err := os.MkdirAll(filepath.Join(interfaceDir, "0003:AF88:6688.synthetic", "hidraw", "hidraw99"), 0o700); err != nil {
				t.Fatal(err)
			}
		}
	}
	return dir
}

func TestDiscoveryAndSelection(t *testing.T) {
	root := t.TempDir()
	fixture(t, root, "1-2.3")
	// A dangling node path proves that discovery only needs sysfs and stat.
	devRoot := filepath.Join(t.TempDir(), "no-device-nodes")
	candidates, err := discover(root, devRoot)
	if err != nil || len(candidates) != 1 {
		t.Fatalf("%v %v", candidates, err)
	}
	c := candidates[0]
	if !c.Compatible || c.VendorNode.Error == "" || c.VendorNode.Path != filepath.Join(devRoot, "hidraw99") {
		t.Fatalf("%+v", c)
	}
	for i, n := range []int{62, 114, 25, 34} {
		if len(c.Reports[i]) != 2*n {
			t.Fatal("descriptor length", i)
		}
	}
	if _, err := selectCandidate(candidates, ""); err != nil {
		t.Fatal(err)
	}
	fixture(t, root, "1-2.4")
	candidates, err = discover(root, devRoot)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := selectCandidate(candidates, ""); err == nil {
		t.Fatal("ambiguous selection accepted")
	}
	if chosen, err := selectCandidate(candidates, "1-2.4"); err != nil || chosen.PhysicalPath != "1-2.4" {
		t.Fatalf("%+v %v", chosen, err)
	}
	if _, err := selectCandidate(candidates, "XFKEY"); err == nil {
		t.Fatal("serial accepted as identity")
	}
}

func TestDiscoveryFailsClosed(t *testing.T) {
	for _, mutation := range []string{"revision", "usb", "vendor report", "other report", "interface", "missing descriptor", "duplicate descriptor", "missing mapping", "wrong VID", "wrong PID"} {
		t.Run(mutation, func(t *testing.T) {
			root := t.TempDir()
			dir := fixture(t, root, "1-2")
			vendor := filepath.Join(dir, "1-2:1.3", "0003:AF88:6688.synthetic")
			switch mutation {
			case "revision":
				put(t, filepath.Join(dir, "bcdDevice"), []byte("0101"))
			case "usb":
				put(t, filepath.Join(dir, "descriptors"), []byte{0})
			case "vendor report":
				put(t, filepath.Join(vendor, "report_descriptor"), []byte{0})
			case "other report":
				put(t, filepath.Join(dir, "1-2:1.0", "0003:AF88:6688.synthetic", "report_descriptor"), []byte{0})
			case "interface":
				put(t, filepath.Join(dir, "1-2:1.3", "bInterfaceNumber"), []byte("02"))
			case "missing descriptor":
				if err := os.Remove(filepath.Join(vendor, "report_descriptor")); err != nil {
					t.Fatal(err)
				}
			case "duplicate descriptor":
				put(t, filepath.Join(dir, "1-2:1.3", "duplicate", "report_descriptor"), []byte{0})
			case "missing mapping":
				if err := os.RemoveAll(filepath.Join(vendor, "hidraw")); err != nil {
					t.Fatal(err)
				}
			case "wrong VID":
				put(t, filepath.Join(dir, "idVendor"), []byte("0000"))
			case "wrong PID":
				put(t, filepath.Join(dir, "idProduct"), []byte("0000"))
			}
			candidates, err := discover(root, t.TempDir())
			if err != nil {
				t.Fatal(err)
			}
			if _, err := selectCandidate(candidates, "1-2"); err == nil {
				t.Fatal("invalid device selected")
			}
		})
	}
}
