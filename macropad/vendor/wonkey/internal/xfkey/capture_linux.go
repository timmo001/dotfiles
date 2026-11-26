package xfkey

import (
	"encoding/hex"
	"fmt"
	"io"
)

type CaptureResult struct {
	PhysicalPath string         `json:"physical_path,omitempty"`
	Identity     deviceIdentity `json:"identity"`
	Readback     *Readback      `json:"readback,omitempty"`
	KeyPrefix    string         `json:"key_prefix_hex,omitempty"`
	Warning      string         `json:"warning"`
}

type captureQuery struct {
	result  CaptureResult
	replies map[byte][]byte
	config  []byte
}

func queryCapture(t queryTransport, readback bool) (captureQuery, error) {
	q := captureQuery{result: CaptureResult{Warning: "Current query replies only, not a verified restore image. Field meanings are host-derived."}, replies: map[byte][]byte{}}
	commands := []byte{1}
	if readback {
		commands = append(commands, 6, 7, 8)
	}
	var replies [3][]byte
	for i, command := range commands {
		reply, err := query(t, command)
		if len(reply) > 0 {
			q.replies[command] = append([]byte(nil), reply...)
		}
		if err != nil {
			return q, fmt.Errorf("AF %02x: %w", command, err)
		}
		if i == 0 {
			q.result.Identity, err = parseIdentity(reply)
			if err != nil {
				return q, err
			}
		}
	}
	if readback {
		for i := range replies {
			replies[i] = q.replies[byte(i+6)]
		}
		parsed, err := parseReadback(replies)
		if err != nil {
			return q, err
		}
		q.config, _ = hex.DecodeString(parsed.Configuration)
		q.result.Readback = &parsed
		q.result.KeyPrefix = hex.EncodeToString(q.config[:5])
	}
	return q, nil
}

var (
	liveDiscover   = discover
	liveOpenTarget = func(target Candidate) (queryTransport, io.Closer, error) {
		t, err := openTarget(target)
		return t, t, err
	}
)

func querySelected(target Candidate, readback bool) (CaptureResult, error) {
	t, closer, err := liveOpenTarget(target)
	if err != nil {
		return CaptureResult{}, err
	}
	defer closer.Close()
	q, err := queryCapture(t, readback)
	q.result.PhysicalPath = target.PhysicalPath
	return q.result, err
}
