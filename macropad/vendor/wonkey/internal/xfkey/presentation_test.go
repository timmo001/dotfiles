package xfkey

import (
	"reflect"
	"strings"
	"testing"
)

func TestSharedSettingsAcceptColourForEveryMode(t *testing.T) {
	for mode, value := range lightingValues {
		t.Run(mode, func(t *testing.T) {
			changes, err := parseSettings("", "", "", mode, "#1234ab")
			want := Changes{"rgb-mode": value, "red": 0x12, "green": 0x34, "blue": 0xab}
			if err != nil || !reflect.DeepEqual(changes, want) {
				t.Fatal(changes, err)
			}
		})
	}
}

func TestSettingsValidationOrderAndFriendlyValues(t *testing.T) {
	changes, err := parseSettings("f13", "release", "ctrl,shift", "static", "#0000ff")
	if err != nil {
		t.Fatal(err)
	}
	want := Changes{"key": 0x68, "trigger": 2, "modifiers": 3, "rgb-mode": 1, "red": 0, "green": 0, "blue": 255}
	for key, value := range want {
		if changes[key] != value {
			t.Fatalf("%s = %d", key, changes[key])
		}
	}
	for range 20 {
		err = (Changes{"blue": 999, "key": 1}).validate()
		if err == nil || !strings.Contains(err.Error(), "key=1") {
			t.Fatalf("non-deterministic error: %v", err)
		}
	}
}

func TestSuperModifierPresentation(t *testing.T) {
	for _, tc := range []struct {
		mask byte
		want string
	}{
		{8, "super"},
		{12, "alt,super"},
		{15, "ctrl,shift,alt,super"},
	} {
		if got := modifierName(tc.mask); got != tc.want {
			t.Fatalf("modifierName(%d) = %q, want %q", tc.mask, got, tc.want)
		}
		changes, err := parseSettings("", "", tc.want, "", "")
		if err != nil || changes["modifiers"] != int(tc.mask) {
			t.Fatal(changes, err)
		}
	}
	current := syntheticSettings()
	intended := current
	intended[2] = 8
	views := settingViews(current, intended)
	if len(views) != 1 || views[0] != (changeView{"modifiers", "none", "super"}) {
		t.Fatal(views)
	}
}
