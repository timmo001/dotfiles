package xfkey

import (
	"encoding/hex"
	"fmt"
	"time"
)

type ApplyTarget struct {
	Identifier string `json:"identifier"`
	Version    string `json:"version_hex"`
}

func (target ApplyTarget) validate() error {
	for _, field := range []struct {
		value string
		size  int
	}{{target.Identifier, 8}, {target.Version, 4}} {
		if len(field.value) != field.size {
			return fmt.Errorf("--expect-identifier (8 hex digits) and --expect-version (4 hex digits) are required")
		}
		if _, err := hex.DecodeString(field.value); err != nil {
			return err
		}
	}
	return nil
}

func (target ApplyTarget) matches(identity deviceIdentity) bool {
	id, _ := hex.DecodeString(target.Identifier)
	version, _ := hex.DecodeString(target.Version)
	return identity.Model == 0x0112 && identity.Identifier == hex.EncodeToString(id) && identity.Version == uint16(version[0])<<8|uint16(version[1])
}

type submissionTrackingTransport struct {
	queryTransport
	submitted *bool
}

func (t submissionTrackingTransport) StartWrite(b []byte, deadline time.Time) (<-chan writeResult, error) {
	result, err := t.queryTransport.StartWrite(b, deadline)
	if err == nil {
		*t.submitted = true
	}
	return result, err
}

type ApplyResult struct {
	Outcome             string       `json:"outcome"`
	Changes             []changeView `json:"changes"`
	CommitEcho          bool         `json:"commit_echo_received"`
	ReadbackVerified    bool         `json:"all_128_bytes_readback_verified"`
	WriteAttempted      bool         `json:"write_attempted"`
	PersistenceVerified bool         `json:"persistence_after_reconnect_verified"`
	Error               string       `json:"error,omitempty"`
	Warning             string       `json:"warning"`
}

// This transaction is the only live configuration path. Query permissions stay unchanged.
func applySettings(t queryTransport, target ApplyTarget, changes configurationChanges, write bool, timeout time.Duration) (ApplyResult, error) {
	return applySettingsConfirmed(t, target, changes, write, timeout, func(configuration, configuration) (bool, error) { return true, nil })
}

func applySettingsConfirmed(t queryTransport, target ApplyTarget, changes configurationChanges, write bool, timeout time.Duration, confirm func(configuration, configuration) (bool, error), checkNoOp ...bool) (result ApplyResult, err error) {
	result = ApplyResult{Outcome: "failed-before-upload", Warning: "No automatic retry or rollback. Readback verifies current state only, not persistence after reconnect. A timed-out submitted write can still complete in the kernel."}
	if !write {
		return result, errWriteRequired
	}
	if err = target.validate(); err != nil {
		return result, err
	}
	if err = changes.validate(); err != nil {
		return result, err
	}
	defer func() {
		if err != nil {
			result.Error = err.Error()
		}
	}()
	fresh, err := queryCapture(t, true)
	if err != nil {
		return result, err
	}
	if !target.matches(fresh.result.Identity) {
		return result, fmt.Errorf("current identity differs from explicitly expected target")
	}
	if len(fresh.config) != 128 {
		return result, fmt.Errorf("device settings need exactly 128 bytes")
	}
	var current configuration
	copy(current[:], fresh.config)
	intended, err := changes.configuration(current)
	if err != nil {
		return result, err
	}
	result.Changes = actionSettingViews(current, intended)
	plan := settingsPlan(current, intended)
	if len(plan.ChangedOffsets) == 0 && (len(checkNoOp) == 0 || !checkNoOp[0]) {
		result.Outcome = "no-op"
		return result, nil
	}
	confirmed, confirmErr := confirm(current, intended)
	if confirmErr != nil {
		return result, confirmErr
	}
	if !confirmed {
		result.Outcome = "cancelled"
		return result, nil
	}
	if len(plan.ChangedOffsets) == 0 {
		result.Outcome = "no-op"
		return result, nil
	}
	packets := preview(intended)
	for i, packet := range packets[1:] {
		name := fmt.Sprintf("write-%d", i+1)
		transport := t
		if i == 0 {
			transport = submissionTrackingTransport{queryTransport: t, submitted: &result.WriteAttempted}
		}
		reply, exchangeErr := exchange(transport, packet, timeout)
		if result.WriteAttempted {
			result.Outcome = "failed-state-unknown"
		}
		if exchangeErr != nil {
			return result, fmt.Errorf("%s: %w; no further commands", name, exchangeErr)
		}
		if err = validateEcho(packet, reply); err != nil {
			return result, fmt.Errorf("%s: %w", name, err)
		}
	}
	result.CommitEcho = true
	err = verifyAppliedSettings(t, intended, timeout, &result)
	return result, err
}

func verifyAppliedSettings(t queryTransport, intended configuration, timeout time.Duration, result *ApplyResult) error {
	var replies [3][]byte
	for i := range replies {
		reply, queryErr := queryWithTimeout(t, byte(6+i), timeout)
		if queryErr != nil {
			return fmt.Errorf("post-commit readback: %w; no rollback", queryErr)
		}
		replies[i] = reply
	}
	observed, err := parseReadback(replies)
	if err != nil {
		return err
	}
	if observed.Configuration != hex.EncodeToString(intended[:]) {
		result.Outcome = "readback-mismatch"
		return fmt.Errorf("post-commit configuration differs from intended bytes; no rollback, persistence unverified")
	}
	result.Outcome = "readback-verified"
	result.ReadbackVerified = true
	return nil
}

func liveApplyBound(path string, target ApplyTarget, changes configurationChanges, write bool, confirm func(configuration, configuration) (bool, error), pinned *Candidate, checkNoOp ...bool) (result ApplyResult, err error) {
	if !write {
		return result, errWriteRequired
	}
	if path == "" {
		return result, fmt.Errorf("apply requires explicit --path")
	}
	if err := target.validate(); err != nil {
		return result, err
	}
	if err := changes.validate(); err != nil {
		return result, err
	}
	candidates, err := liveDiscover("/sys/bus/usb/devices", "/dev")
	if err != nil {
		return result, err
	}
	selected, err := selectCandidate(candidates, path)
	if err != nil {
		return result, err
	}
	if pinned != nil && !sameCandidate(*selected, *pinned) {
		return result, fmt.Errorf("selected descriptor, path or node changed; no settings write sent")
	}
	t, closer, err := liveOpenTarget(*selected)
	if err != nil {
		return result, err
	}
	defer closer.Close()
	return applySettingsConfirmed(t, target, changes, write, transactionTimeout, confirm, checkNoOp...)
}
