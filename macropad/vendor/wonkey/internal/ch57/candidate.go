package ch57

import (
	"encoding/binary"
	"fmt"
	"regexp"
)

// candidateUSBDescriptor is the reference 1189:8890 USB descriptor structure
// published at https://github.com/the-via/keyboards/issues/2169, not a device capture.
const candidateUSBDescriptor = "\x12\x01\x10\x01\x00\x00\x00\x08\x89\x11\x90\x88\x00\x00\x00\x00\x00\x01" +
	"\x09\x02\x6d\x00\x04\x01\x00\xa0\x32" +
	"\x09\x04\x00\x00\x01\x03\x01\x01\x00\x09\x21\x11\x01\x00\x01\x22\x40\x00\x07\x05\x81\x03\x40\x00\x0a" +
	"\x09\x04\x01\x00\x01\x03\x00\x00\x00\x09\x21\x00\x01\x00\x01\x22\x24\x00\x07\x05\x02\x03\x40\x00\x0a" +
	"\x09\x04\x02\x00\x01\x03\x00\x00\x00\x09\x21\x00\x01\x00\x01\x22\x56\x00\x07\x05\x83\x03\x04\x00\x0a" +
	"\x09\x04\x03\x00\x01\x03\x01\x02\x00\x09\x21\x10\x01\x00\x01\x22\x34\x00\x07\x05\x82\x03\x04\x00\x0a"

const candidate8851USBDescriptor = "\x12\x01\x10\x01\x00\x00\x00\x40\x4c\x51\x51\x88\x00\x01\x01\x02\x03\x01" +
	"\x09\x02\x42\x00\x02\x01\x00\x80\xc8" +
	"\x09\x04\x00\x00\x02\x03\x00\x00\x00\x09\x21\x11\x01\x00\x01\x22\x24\x00\x07\x05\x82\x03\x40\x00\x01\x07\x05\x02\x03\x40\x00\x01" +
	"\x09\x04\x01\x00\x01\x03\x01\x01\x00\x09\x21\x01\x02\x00\x01\x22\xcf\x00\x07\x05\x81\x03\x10\x00\x01"

const candidate8850USBDescriptor = "\x12\x01\x10\x01\x00\x00\x00\x40\x4c\x51\x50\x88\x00\x01\x01\x02\x03\x01" +
	"\x09\x02\x42\x00\x02\x01\x00\xa0\x32" +
	"\x09\x04\x00\x00\x02\x03\x00\x00\x00\x09\x21\x11\x01\x00\x01\x22\x24\x00\x07\x05\x84\x03\x40\x00\x01\x07\x05\x04\x03\x40\x00\x01" +
	"\x09\x04\x01\x00\x01\x03\x01\x01\x00\x09\x21\x01\x02\x00\x01\x22\xcf\x00\x07\x05\x82\x03\x10\x00\x01"

var physicalUSBPath = regexp.MustCompile(`^[1-9][0-9]*-[1-9][0-9]*(\.[1-9][0-9]*)*$`)

// hidDeviceName matches the HID device directories (bus:vendor:product.instance)
// below a USB interface, skipping entries such as physical_location and firmware_node.
var hidDeviceName = regexp.MustCompile(`^[0-9A-F]{4}:[0-9A-F]{4}:[0-9A-F]{4}\.[0-9A-F]{4}$`)

// Candidate is a provisional USB structure match, not firmware identification.
// It supplies no Profile, transport, or permission for device access.
// PhysicalPath is caller-supplied provenance, not a verified device association.
type Candidate struct {
	PhysicalPath  string
	VID           uint16
	PID           uint16
	Revision      uint16
	Configuration byte
	Interfaces    [4]CandidateInterface
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

// MatchCandidate checks caller-supplied Linux USB descriptor bytes without I/O.
// Missing, extra, malformed, or unsupported descriptors fail closed before field extraction.
// Report lengths do not prove report contents, control counts, or KriomantFE.
func MatchCandidate(physicalPath string, descriptors []byte) (Candidate, error) {
	if len(physicalPath) > 255 || !physicalUSBPath.MatchString(physicalPath) {
		return Candidate{}, fmt.Errorf("invalid Linux USB physical path")
	}
	if !validDescriptorHeader(descriptors) {
		return Candidate{}, fmt.Errorf("USB descriptors do not match a supported CH57x candidate structure")
	}
	bNumInterfaces := int(descriptors[22])
	ifaces, ok := parseTLVInterfaces(descriptors[27:], bNumInterfaces)
	if !ok {
		return Candidate{}, fmt.Errorf("USB descriptors do not match a supported CH57x candidate structure")
	}
	vid := binary.LittleEndian.Uint16(descriptors[8:10])
	pid := binary.LittleEndian.Uint16(descriptors[10:12])
	if !matchCandidateFamily(vid, pid, bNumInterfaces, ifaces) {
		return Candidate{}, fmt.Errorf("USB descriptors do not match a supported CH57x candidate structure")
	}
	candidate := Candidate{
		PhysicalPath:  physicalPath,
		VID:           vid,
		PID:           pid,
		Revision:      binary.LittleEndian.Uint16(descriptors[12:14]),
		Configuration: descriptors[23],
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
	return wTotalLength == len(descriptors)-18 && bNumInterfaces >= 2 && bNumInterfaces <= 4
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

func matchCandidateFamily(vid, pid uint16, ifaceCount int, ifaces [4]parsedInterface) bool {
	switch {
	case IsK8890Family(vid, pid):
		return ifaceCount == 4 && validK8890VendorInterface(ifaces[1].info, ifaces[1].endpoints)
	case IsK884xFamily(vid, pid):
		return ifaceCount >= 2 && validBidirectionalHIDInterface(ifaces[0].info, ifaces[0].endpoints)
	default:
		return false
	}
}

func validK8890VendorInterface(info CandidateInterface, endpoints []CandidateEndpoint) bool {
	if info.Class != 0x03 || info.Subclass != 0x00 || info.Protocol != 0x00 || info.ReportDescriptorLength != 36 || len(endpoints) != 1 {
		return false
	}
	ep := endpoints[0]
	return ep.Address == 0x02 && ep.Attributes == 0x03 && ep.MaxPacketSize == 64
}

func validBidirectionalHIDInterface(info CandidateInterface, endpoints []CandidateEndpoint) bool {
	if info.Class != 0x03 || info.Subclass != 0x00 || info.Protocol != 0x00 || info.ReportDescriptorLength != 36 || len(endpoints) != 2 {
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
