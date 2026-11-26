// Package sayo encodes reports and performs guarded USB operations for SayoDevice macropads.
package sayo

import (
	"encoding/binary"
	"fmt"
	"regexp"
)

var physicalUSBPath = regexp.MustCompile(`^[1-9][0-9]*-[1-9][0-9]*(\.[1-9][0-9]*)*$`)

// hidDeviceName matches the HID device directories (bus:vendor:product.instance)
// below a USB interface, skipping entries such as physical_location and firmware_node.
var hidDeviceName = regexp.MustCompile(`^[0-9A-F]{4}:[0-9A-F]{4}:[0-9A-F]{4}\.[0-9A-F]{4}$`)

// Candidate is a provisional USB structure match for a SayoDevice macropad.
type Candidate struct {
	PhysicalPath    string
	VID             uint16
	PID             uint16
	Revision        uint16
	Configuration   byte
	VendorInterface byte
	Interfaces      [4]CandidateInterface
}

type CandidateInterface struct {
	Number                 byte
	AlternateSetting       byte
	Class                  byte
	Subclass               byte
	Protocol               byte
	HIDVersion             uint16
	ReportDescriptorLength uint16
	Endpoint               CandidateEndpoint
}

type CandidateEndpoint struct {
	Address       byte
	Attributes    byte
	MaxPacketSize uint16
	Interval      byte
}

type parsedInterface struct {
	info        CandidateInterface
	wantEpCount int
	hasHID      bool
	endpoints   []CandidateEndpoint
}

// IsSupportedPID reports whether vid:pid is a supported SayoDevice application USB ID.
func IsSupportedPID(vid, pid uint16) bool {
	if vid != 0x8089 {
		return false
	}
	return IsV1Family(pid) || IsV2Family(pid)
}

// IsSayoCandidatePID reports whether vid:pid is a supported SayoDevice application or bootloader USB ID.
func IsSayoCandidatePID(vid, pid uint16) bool {
	return IsSupportedPID(vid, pid) || IsBootloaderPID(vid, pid)
}

// ManifestPID maps a SayoDevice application or bootloader PID to its vendor CDN directory ID.
func ManifestPID(pid uint16) int {
	switch pid {
	case 0x0006:
		return 2
	case 0x0007:
		return 3
	case 0x0008:
		return 4
	default:
		return int(pid)
	}
}

// IsV1Family reports whether pid is a SayoDevice HID v1 application product ID.
func IsV1Family(pid uint16) bool {
	switch pid {
	case 0x0002, 0x0003, 0x0004, 0x0005:
		return true
	default:
		return false
	}
}

// IsV2Family reports whether pid is a SayoDevice HID v2 application product ID.
func IsV2Family(pid uint16) bool {
	switch pid {
	case 0x0009, 0x000a, 0x000b, 0x000c, 0x000e:
		return true
	default:
		return false
	}
}

// IsBootloaderPID reports whether vid:pid is a dedicated SayoDevice bootloader USB ID.
// The HID v1 directories 2 to 5 give manifest pid2 values 0x0006..0x0009, unconfirmed on hardware.
// This function covers 0x0006..0x0008. 0x0009 is also a HID v2 application PID, so a directory 5
// bootloader is recognised by its report descriptor. ManifestPID maps 0x0009 to directory 9, whose
// manifest is identical to directory 5. The directory 12 (2x3P) bootloader keeps PID
// 0x000c (confirmed by capture) and is also recognised by its report descriptor, not by this function.
func IsBootloaderPID(vid, pid uint16) bool {
	if vid != 0x8089 {
		return false
	}
	switch pid {
	case 0x0006, 0x0007, 0x0008:
		return true
	default:
		return false
	}
}

// MatchCandidate checks caller-supplied Linux USB descriptor bytes without I/O.
func MatchCandidate(physicalPath string, descriptors []byte) (Candidate, error) {
	if len(physicalPath) > 255 || !physicalUSBPath.MatchString(physicalPath) {
		return Candidate{}, fmt.Errorf("invalid Linux USB physical path")
	}
	if !validDescriptorHeader(descriptors) {
		return Candidate{}, fmt.Errorf("USB descriptors do not match a supported SayoDevice candidate structure")
	}
	bNumInterfaces := int(descriptors[22])
	ifaces, ok := parseTLVInterfaces(descriptors[27:], bNumInterfaces)
	if !ok {
		return Candidate{}, fmt.Errorf("USB descriptors do not match a supported SayoDevice candidate structure")
	}
	vid := binary.LittleEndian.Uint16(descriptors[8:10])
	pid := binary.LittleEndian.Uint16(descriptors[10:12])
	vendorIface, ok := matchSayoCandidate(vid, pid, bNumInterfaces, ifaces)
	if !ok {
		return Candidate{}, fmt.Errorf("USB descriptors do not match a supported SayoDevice candidate structure")
	}
	candidate := Candidate{
		PhysicalPath:    physicalPath,
		VID:             vid,
		PID:             pid,
		Revision:        binary.LittleEndian.Uint16(descriptors[12:14]),
		Configuration:   descriptors[23],
		VendorInterface: vendorIface,
	}
	for i := range bNumInterfaces {
		candidate.Interfaces[i] = ifaces[i].info
	}
	return candidate, nil
}

func validDescriptorHeader(descriptors []byte) bool {
	if len(descriptors) < 27 || len(descriptors) > 512 {
		return false
	}
	if descriptors[0] != 18 || descriptors[1] != 0x01 || descriptors[17] != 1 ||
		descriptors[18] != 9 || descriptors[19] != 0x02 || descriptors[23] == 0 {
		return false
	}
	wTotalLength := int(binary.LittleEndian.Uint16(descriptors[20:22]))
	bNumInterfaces := int(descriptors[22])
	return wTotalLength == len(descriptors)-18 && bNumInterfaces >= 1 && bNumInterfaces <= 4
}

func parseTLVInterfaces(body []byte, bNumInterfaces int) ([4]parsedInterface, bool) {
	var ifaces [4]parsedInterface
	ifaceCount := 0
	var current *parsedInterface
	for pos := 0; pos < len(body); {
		if pos+2 > len(body) {
			return ifaces, false
		}
		length := int(body[pos])
		dtype := body[pos+1]
		if length < 2 || pos+length > len(body) {
			return ifaces, false
		}
		item := body[pos : pos+length]
		pos += length
		switch dtype {
		case 0x04:
			if !validInterfaceItem(item, ifaceCount, bNumInterfaces) {
				return ifaces, false
			}
			ifaces[ifaceCount] = parsedInterface{
				info: CandidateInterface{
					Number:           item[2],
					AlternateSetting: item[3],
					Class:            item[5],
					Subclass:         item[6],
					Protocol:         item[7],
				},
				wantEpCount: int(item[4]),
			}
			current = &ifaces[ifaceCount]
			ifaceCount++
		case 0x21:
			if !applyHIDItem(current, item) {
				return ifaces, false
			}
		case 0x05:
			if !applyEndpointItem(current, item) {
				return ifaces, false
			}
		default:
			return ifaces, false
		}
	}
	if ifaceCount != bNumInterfaces {
		return ifaces, false
	}
	for i := range ifaceCount {
		if !ifaces[i].hasHID || len(ifaces[i].endpoints) != ifaces[i].wantEpCount {
			return ifaces, false
		}
	}
	return ifaces, true
}

func validInterfaceItem(item []byte, ifaceCount, bNumInterfaces int) bool {
	return len(item) == 9 && ifaceCount < bNumInterfaces && int(item[2]) == ifaceCount &&
		item[3] == 0 && item[4] >= 1 && item[4] <= 2 && item[5] == 0x03
}

func applyHIDItem(cur *parsedInterface, item []byte) bool {
	if len(item) != 9 || cur == nil || cur.hasHID || len(cur.endpoints) != 0 || item[5] != 1 || item[6] != 0x22 {
		return false
	}
	repLen := binary.LittleEndian.Uint16(item[7:9])
	if repLen == 0 {
		return false
	}
	cur.info.HIDVersion = binary.LittleEndian.Uint16(item[2:4])
	cur.info.ReportDescriptorLength = repLen
	cur.hasHID = true
	return true
}

func applyEndpointItem(cur *parsedInterface, item []byte) bool {
	if len(item) != 7 || cur == nil || !cur.hasHID || len(cur.endpoints) >= cur.wantEpCount {
		return false
	}
	ep := CandidateEndpoint{
		Address:       item[2],
		Attributes:    item[3],
		MaxPacketSize: binary.LittleEndian.Uint16(item[4:6]),
		Interval:      item[6],
	}
	if len(cur.endpoints) == 0 {
		cur.info.Endpoint = ep
	}
	cur.endpoints = append(cur.endpoints, ep)
	return true
}

func matchSayoCandidate(vid, pid uint16, ifaceCount int, ifaces [4]parsedInterface) (byte, bool) {
	if !IsSayoCandidatePID(vid, pid) {
		return 0, false
	}
	if ifaceCount > 1 && validVendorHIDInterface(ifaces[1].info, ifaces[1].endpoints) {
		return 1, true
	}
	for i := range ifaceCount {
		if validVendorHIDInterface(ifaces[i].info, ifaces[i].endpoints) {
			return byte(i), true
		}
	}
	return 0, false
}

func validVendorHIDInterface(info CandidateInterface, endpoints []CandidateEndpoint) bool {
	if info.Class != 0x03 || info.Subclass != 0x00 || info.Protocol != 0x00 || info.ReportDescriptorLength < 20 || len(endpoints) != 2 {
		return false
	}
	var hasIN, hasOUT bool
	for _, ep := range endpoints {
		if ep.Attributes != 0x03 || ep.MaxPacketSize != 64 {
			return false
		}
		switch {
		case ep.Address >= 0x81 && ep.Address <= 0x8f:
			hasIN = true
		case ep.Address >= 0x01 && ep.Address <= 0x0f:
			hasOUT = true
		}
	}
	return hasIN && hasOUT
}
