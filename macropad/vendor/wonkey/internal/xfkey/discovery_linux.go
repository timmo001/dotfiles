package xfkey

import (
	"bytes"
	"encoding/hex"
	"fmt"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"syscall"
)

const usbDescriptorHex = "120110010000004088af886600010102030109027400040100a05a090400000103010100092111010001223e000705810308000109040100010301020009211001000122720007058203060001090402000103000000092110010001221900070583030400010904030002030000000921000100012222000705840340000107050403400001"

var reportDescriptorHex = [...]string{
	"05010906a101050719e029e7150025017501950881029501750881019503750105081901290391029505750191019506750826ff000507190029918100c0",
	"05010902a1010901a10085010509190129031500250175019503810275059501810105010930093109381581257f750895038106c0c005010902a1010901a10085020509190129031500250195037501810295017505810305010930093116000026ff7f36000046ff7f751095028102c0c0",
	"050c0901a101850519002a3c021500263c02950175108100c0",
	"0600ff0901a101090215002600ff750895408106090215002600ff750895409106c0",
}

type NodeMetadata struct {
	identity [3]uint64
	Path     string `json:"path"`
	Mode     string `json:"mode,omitempty"`
	UID      uint32 `json:"uid"`
	GID      uint32 `json:"gid"`
	Error    string `json:"error,omitempty"`
}

type Candidate struct {
	PhysicalPath  string       `json:"physical_path"`
	Product       string       `json:"product,omitempty"`
	SysfsPath     string       `json:"sysfs_path"`
	Revision      string       `json:"revision"`
	Compatible    bool         `json:"descriptor_match_not_model_confirmation"`
	Reasons       []string     `json:"rejection_reasons"`
	USBDescriptor string       `json:"usb_descriptor_hex"`
	Reports       [4]string    `json:"report_descriptors_hex"`
	VendorNode    NodeMetadata `json:"vendor_interface_3_node"`
}

func readAttribute(dir, name string) string {
	b, err := os.ReadFile(filepath.Join(dir, name))
	if err != nil {
		return ""
	}
	return strings.TrimSpace(string(b))
}

func matchDescriptor(path, expected string) (string, error) {
	actual, err := os.ReadFile(path)
	if err != nil {
		return "", err
	}
	wanted, err := hex.DecodeString(expected)
	if err != nil {
		return "", err
	}
	if !bytes.Equal(actual, wanted) {
		return hex.EncodeToString(actual), fmt.Errorf("descriptor differs from pinned specimen")
	}
	return hex.EncodeToString(actual), nil
}

func discover(root, devRoot string) ([]Candidate, error) {
	entries, err := os.ReadDir(root)
	if err != nil {
		return nil, err
	}
	candidates := []Candidate{}
	for _, entry := range entries {
		name := entry.Name()
		dir := filepath.Join(root, name)
		if readAttribute(dir, "idVendor") != "af88" || readAttribute(dir, "idProduct") != "6688" {
			continue
		}
		c := Candidate{PhysicalPath: name, SysfsPath: dir, Revision: readAttribute(dir, "bcdDevice"), Reasons: []string{}}
		reject := func(err error) {
			if err != nil {
				c.Reasons = append(c.Reasons, err.Error())
			}
		}
		if c.Revision != "0100" {
			reject(fmt.Errorf("revision must be 0100"))
		}
		c.USBDescriptor, err = matchDescriptor(filepath.Join(dir, "descriptors"), usbDescriptorHex)
		reject(err)
		for i, expected := range reportDescriptorHex {
			interfaceDir := filepath.Join(dir, fmt.Sprintf("%s:1.%d", name, i))
			if readAttribute(interfaceDir, "bInterfaceNumber") != fmt.Sprintf("%02x", i) {
				reject(fmt.Errorf("interface %d: missing or wrong number", i))
			}
			descriptors, globErr := filepath.Glob(filepath.Join(interfaceDir, "*", "report_descriptor"))
			reject(globErr)
			if len(descriptors) != 1 {
				reject(fmt.Errorf("interface %d: need exactly one cached report descriptor", i))
				continue
			}
			c.Reports[i], err = matchDescriptor(descriptors[0], expected)
			if err != nil {
				reject(fmt.Errorf("interface %d: %w", i, err))
			}
			if i == 3 {
				nodes, globErr := filepath.Glob(filepath.Join(filepath.Dir(descriptors[0]), "hidraw", "hidraw*"))
				reject(globErr)
				if len(nodes) != 1 {
					reject(fmt.Errorf("interface 3: need exactly one hidraw mapping"))
					continue
				}
				c.VendorNode.Path = filepath.Join(devRoot, filepath.Base(nodes[0]))
				info, statErr := os.Stat(c.VendorNode.Path)
				if statErr != nil {
					c.VendorNode.Error = statErr.Error()
				} else {
					c.VendorNode.Mode = info.Mode().String()
					if st, ok := info.Sys().(*syscall.Stat_t); ok {
						c.VendorNode.UID, c.VendorNode.GID = st.Uid, st.Gid
						c.VendorNode.identity = [3]uint64{st.Dev, st.Ino, st.Rdev}
					}
				}
			}
		}
		c.Compatible = len(c.Reasons) == 0
		candidates = append(candidates, c)
	}
	return candidates, nil
}

func sameCandidate(a, b Candidate) bool {
	return reflect.DeepEqual(a, b)
}

func selectCandidate(candidates []Candidate, path string) (*Candidate, error) {
	var selected *Candidate
	for i := range candidates {
		c := &candidates[i]
		if path != "" && c.PhysicalPath != path {
			continue
		}
		if !c.Compatible {
			if path != "" {
				return nil, fmt.Errorf("selected physical path failed descriptor/revision guards")
			}
			continue
		}
		if selected != nil {
			return nil, fmt.Errorf("multiple compatible devices require terminal selection")
		}
		selected = c
	}
	if selected == nil {
		return nil, fmt.Errorf("no compatible candidate for physical path %q", path)
	}
	return selected, nil
}
