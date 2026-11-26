package ch57

import (
	"maps"
	"slices"
	"testing"
)

func TestSingleStrokeAllControls(t *testing.T) {
	for _, tt := range []struct {
		control Control
		slot    byte
	}{
		{Key1, 1},
		{Key2, 2},
		{Key3, 3},
		{KnobLeft, 13},
		{KnobPress, 14},
		{KnobRight, 15},
	} {
		t.Run(string(tt.control), func(t *testing.T) {
			got, err := EncodeKeyboard(ThreeKeyOneKnob(), tt.control, []Stroke{{Modifiers: 0x02, Usage: 0x04}})
			if err != nil {
				t.Fatal(err)
			}
			want := []Report{
				{0x03, 0xfe, 0x01, 0x01, 0x01},
				{0x03, tt.slot, 0x11, 0x01, 0x00, 0x00, 0x00},
				{0x03, tt.slot, 0x11, 0x01, 0x01, 0x02, 0x04},
				{0x03, 0xaa, 0xaa},
			}
			assertReports(t, got, want)
		})
	}
}

func TestFiveStrokes(t *testing.T) {
	strokes := []Stroke{
		{Modifiers: 0x01, Usage: 0x04},
		{Modifiers: 0x00, Usage: 0x05},
		{Modifiers: 0x00, Usage: 0x28},
		{Modifiers: 0x00, Usage: 0x68},
		{Modifiers: 0x00, Usage: 0x73},
	}
	got, err := EncodeKeyboard(ThreeKeyOneKnob(), Key2, strokes)
	if err != nil {
		t.Fatal(err)
	}
	want := []Report{
		{0x03, 0xfe, 0x01, 0x01, 0x01},
		{0x03, 0x02, 0x11, 0x05, 0x00, 0x00, 0x00},
		{0x03, 0x02, 0x11, 0x05, 0x01, 0x01, 0x04},
		{0x03, 0x02, 0x11, 0x05, 0x02, 0x00, 0x05},
		{0x03, 0x02, 0x11, 0x05, 0x03, 0x00, 0x28},
		{0x03, 0x02, 0x11, 0x05, 0x04, 0x00, 0x68},
		{0x03, 0x02, 0x11, 0x05, 0x05, 0x00, 0x73},
		{0x03, 0xaa, 0xaa},
	}
	assertReports(t, got, want)
}

func TestModifierOnlySingleStroke(t *testing.T) {
	for modifiers := 1; modifiers <= 255; modifiers++ {
		got, err := EncodeKeyboard(ThreeKeyOneKnob(), Key1, []Stroke{{Modifiers: modifiers, Usage: 0x00}})
		if err != nil {
			t.Fatal(modifiers, err)
		}
		want := []Report{
			{0x03, 0xfe, 0x01, 0x01, 0x01},
			{0x03, 0x01, 0x11, 0x01, 0x00, 0x00, 0x00},
			{0x03, 0x01, 0x11, 0x01, 0x01, byte(modifiers), 0x00},
			{0x03, 0xaa, 0xaa},
		}
		assertReports(t, got, want)
	}
}

func TestModifierOnlyFirstStrokeInSequence(t *testing.T) {
	strokes := []Stroke{
		{Modifiers: 0x05, Usage: 0x00},
		{Modifiers: 0x00, Usage: 0x04},
		{Modifiers: 0x00, Usage: 0x28},
	}
	got, err := EncodeKeyboard(ThreeKeyOneKnob(), Key3, strokes)
	if err != nil {
		t.Fatal(err)
	}
	want := []Report{
		{0x03, 0xfe, 0x01, 0x01, 0x01},
		{0x03, 0x03, 0x11, 0x03, 0x00, 0x00, 0x00},
		{0x03, 0x03, 0x11, 0x03, 0x01, 0x05, 0x00},
		{0x03, 0x03, 0x11, 0x03, 0x02, 0x00, 0x04},
		{0x03, 0x03, 0x11, 0x03, 0x03, 0x00, 0x28},
		{0x03, 0xaa, 0xaa},
	}
	assertReports(t, got, want)
}

func TestStrokeCounts(t *testing.T) {
	for count := 1; count <= 5; count++ {
		strokes := slices.Repeat([]Stroke{{Usage: 0x04}}, count)
		got, err := EncodeKeyboard(ThreeKeyOneKnob(), Key1, strokes)
		if err != nil {
			t.Fatal(count, err)
		}
		want := []Report{{0x03, 0xfe, 0x01, 0x01, 0x01}, {0x03, 1, 0x11, byte(count)}}
		for index := 1; index <= count; index++ {
			want = append(want, Report{0x03, 1, 0x11, byte(count), byte(index), 0, 0x04})
		}
		want = append(want, Report{0x03, 0xaa, 0xaa})
		assertReports(t, got, want)
	}
}

func TestRejectInvalidStrokes(t *testing.T) {
	for _, tt := range []struct {
		name    string
		strokes []Stroke
	}{
		{"nil", nil},
		{"empty", []Stroke{}},
		{"too many", slices.Repeat([]Stroke{{Usage: 0x04}}, 6)},
		{"negative modifiers", []Stroke{{Modifiers: -1, Usage: 0x04}}},
		{"large modifiers", []Stroke{{Modifiers: 256, Usage: 0x04}}},
		{"negative usage", []Stroke{{Usage: -1}}},
		{"empty stroke", []Stroke{{Modifiers: 0, Usage: 0}}},
		{"empty second stroke", []Stroke{{Usage: 0x04}, {Modifiers: 0, Usage: 0}}},
		{"error usage", []Stroke{{Usage: 0x03}}},
		{"unsupported usage", []Stroke{{Usage: 0x74}}},
		{"modifier usage", []Stroke{{Usage: 0xe0}}},
		{"large usage", []Stroke{{Usage: 256}}},
		{"invalid final stroke", []Stroke{{Usage: 0x04}, {Usage: 0x03}}},
		{"modifiers on second stroke", []Stroke{{Usage: 0x04}, {Modifiers: 0x01, Usage: 0x05}}},
		{"modifiers on third stroke", []Stroke{{Usage: 0x04}, {Usage: 0x05}, {Modifiers: 0x02, Usage: 0x06}}},
		{"modifiers on fourth stroke", []Stroke{{Usage: 0x04}, {Usage: 0x05}, {Usage: 0x06}, {Modifiers: 0x04, Usage: 0x07}}},
		{"modifiers on fifth stroke", []Stroke{{Usage: 0x04}, {Usage: 0x05}, {Usage: 0x06}, {Usage: 0x07}, {Modifiers: 0x08, Usage: 0x08}}},
		{"modifier-only on second stroke", []Stroke{{Usage: 0x04}, {Modifiers: 0x01, Usage: 0x00}}},
		{"modifier-only on fifth stroke", []Stroke{{Usage: 0x04}, {Usage: 0x05}, {Usage: 0x06}, {Usage: 0x07}, {Modifiers: 0x80, Usage: 0x00}}},
	} {
		t.Run(tt.name, func(t *testing.T) {
			got, err := EncodeKeyboard(ThreeKeyOneKnob(), Key1, tt.strokes)
			if err == nil || got != nil {
				t.Fatalf("got %x, %v, want nil reports and an error", got, err)
			}
		})
	}

	knob1Profile := ThreeKeyOneKnob()
	knob1Profile.Layer = 2
	knob1Profile.ControlSlots = map[Control]byte{
		Key1:       1,
		Key2:       2,
		Key3:       3,
		Knob1Left:  13,
		Knob1Press: 14,
		Knob1Right: 15,
	}
	got, err := EncodeKeyboard(knob1Profile, KnobLeft, []Stroke{
		{Usage: 0x04},
		{Modifiers: 0x02, Usage: 0x05},
	})
	if err == nil || got != nil {
		t.Fatalf("got %x, %v, want nil reports and an error", got, err)
	}
}

func TestModifierAndUsageBoundaries(t *testing.T) {
	for modifiers := 0; modifiers <= 255; modifiers++ {
		for _, usage := range []int{0x04, 0x73} {
			got, err := EncodeKeyboard(ThreeKeyOneKnob(), Key1, []Stroke{{Modifiers: modifiers, Usage: usage}})
			if err != nil {
				t.Fatal(modifiers, usage, err)
			}
			if int(got[2][5]) != modifiers || int(got[2][6]) != usage {
				t.Fatalf("stroke changed: %x", got[2])
			}
		}
	}
}

func twelveKeyThreeKnobProfile(useKnob1Names bool) Profile {
	slots := map[Control]byte{
		Key1:       1,
		Key2:       2,
		Key3:       3,
		Key4:       4,
		Key5:       5,
		Key6:       6,
		Key7:       7,
		Key8:       8,
		Key9:       9,
		Key10:      10,
		Key11:      11,
		Key12:      12,
		Knob2Left:  16,
		Knob2Press: 17,
		Knob2Right: 18,
		Knob3Left:  19,
		Knob3Press: 20,
		Knob3Right: 21,
	}
	if useKnob1Names {
		slots[Knob1Left] = 13
		slots[Knob1Press] = 14
		slots[Knob1Right] = 15
	} else {
		slots[KnobLeft] = 13
		slots[KnobPress] = 14
		slots[KnobRight] = 15
	}
	return Profile{
		VID:          0x1189,
		PID:          0x8890,
		Variant:      KriomantFE,
		ControlSlots: slots,
	}
}

func allK8890ControlSlots() []struct {
	control Control
	slot    byte
} {
	return []struct {
		control Control
		slot    byte
	}{
		{Key1, 1},
		{Key2, 2},
		{Key3, 3},
		{Key4, 4},
		{Key5, 5},
		{Key6, 6},
		{Key7, 7},
		{Key8, 8},
		{Key9, 9},
		{Key10, 10},
		{Key11, 11},
		{Key12, 12},
		{KnobLeft, 13},
		{KnobPress, 14},
		{KnobRight, 15},
		{Knob1Left, 13},
		{Knob1Press, 14},
		{Knob1Right, 15},
		{Knob2Left, 16},
		{Knob2Press, 17},
		{Knob2Right, 18},
		{Knob3Left, 19},
		{Knob3Press, 20},
		{Knob3Right, 21},
	}
}

func TestSingleStrokeFullK8890Controls(t *testing.T) {
	for _, useKnob1Names := range []bool{false, true} {
		profile := twelveKeyThreeKnobProfile(useKnob1Names)
		for _, tt := range allK8890ControlSlots() {
			t.Run(string(tt.control), func(t *testing.T) {
				got, err := EncodeKeyboard(profile, tt.control, []Stroke{{Modifiers: 0x02, Usage: 0x04}})
				if err != nil {
					t.Fatal(err)
				}
				want := []Report{
					{0x03, 0xfe, 0x01, 0x01, 0x01},
					{0x03, tt.slot, 0x11, 0x01, 0x00, 0x00, 0x00},
					{0x03, tt.slot, 0x11, 0x01, 0x01, 0x02, 0x04},
					{0x03, 0xaa, 0xaa},
				}
				assertReports(t, got, want)
			})
		}
	}
}

func TestMultiStrokeModifiersFullK8890Profile(t *testing.T) {
	strokes := []Stroke{
		{Modifiers: 0x00, Usage: 0x04},
		{Modifiers: 0x02, Usage: 0x05},
		{Modifiers: 0x05, Usage: 0x00},
		{Modifiers: 0x10, Usage: 0x28},
		{Modifiers: 0x80, Usage: 0x73},
	}
	for _, useKnob1Names := range []bool{false, true} {
		profile := twelveKeyThreeKnobProfile(useKnob1Names)
		profile.Layer = 3
		got, err := EncodeKeyboard(profile, Key12, strokes)
		if err != nil {
			t.Fatal(useKnob1Names, err)
		}
		want := []Report{
			{0x03, 0xfe, 0x03, 0x01, 0x01},
			{0x03, 0x0c, 0x31, 0x05, 0x00, 0x00, 0x00},
			{0x03, 0x0c, 0x31, 0x05, 0x01, 0x00, 0x04},
			{0x03, 0x0c, 0x31, 0x05, 0x02, 0x02, 0x05},
			{0x03, 0x0c, 0x31, 0x05, 0x03, 0x05, 0x00},
			{0x03, 0x0c, 0x31, 0x05, 0x04, 0x10, 0x28},
			{0x03, 0x0c, 0x31, 0x05, 0x05, 0x80, 0x73},
			{0x03, 0xaa, 0xaa},
		}
		assertReports(t, got, want)
	}
}

func TestKeyboardLayers(t *testing.T) {
	for layer := 0; layer <= 15; layer++ {
		profile := ThreeKeyOneKnob()
		profile.Layer = layer
		wantLayer := byte(layer)
		if wantLayer == 0 {
			wantLayer = 1
		}
		kind := (wantLayer << 4) | 0x01
		got, err := EncodeKeyboard(profile, Key2, []Stroke{
			{Modifiers: 0x01, Usage: 0x04},
			{Modifiers: 0x00, Usage: 0x05},
		})
		if err != nil {
			t.Fatal(layer, err)
		}
		want := []Report{
			{0x03, 0xfe, wantLayer, 0x01, 0x01},
			{0x03, 0x02, kind, 0x02, 0x00, 0x00, 0x00},
			{0x03, 0x02, kind, 0x02, 0x01, 0x01, 0x04},
			{0x03, 0x02, kind, 0x02, 0x02, 0x00, 0x05},
			{0x03, 0xaa, 0xaa},
		}
		assertReports(t, got, want)
	}
}

func TestRejectInvalidProfilesAndControls(t *testing.T) {
	for _, tt := range []struct {
		name   string
		change func(*Profile)
	}{
		{"zero profile", func(p *Profile) { *p = Profile{} }},
		{"vendor", func(p *Profile) { p.VID = 0x8844 }},
		{"product", func(p *Profile) { p.PID = 0x8840 }},
		{"empty variant", func(p *Profile) { p.Variant = "" }},
		{"A1 variant", func(p *Profile) { p.Variant = "a1" }},
		{"unknown variant", func(p *Profile) { p.Variant = "other" }},
		{"negative layer", func(p *Profile) { p.Layer = -1 }},
		{"large layer", func(p *Profile) { p.Layer = 16 }},
		{"nil controls", func(p *Profile) { p.ControlSlots = nil }},
		{"empty controls", func(p *Profile) { p.ControlSlots = map[Control]byte{} }},
		{"missing control", func(p *Profile) { delete(p.ControlSlots, Key2) }},
		{"non-contiguous key5", func(p *Profile) { p.ControlSlots[Key5] = 5 }},
		{"extra control key13", func(p *Profile) { p.ControlSlots["key13"] = 13 }},
		{"incomplete knob1", func(p *Profile) { delete(p.ControlSlots, KnobPress) }},
		{"incomplete knob2", func(p *Profile) { p.ControlSlots[Knob2Left] = 16 }},
		{"non-contiguous knob3", func(p *Profile) {
			p.ControlSlots[Knob3Left] = 19
			p.ControlSlots[Knob3Press] = 20
			p.ControlSlots[Knob3Right] = 21
		}},
		{"duplicate knob1 alias", func(p *Profile) { p.ControlSlots[Knob1Left] = 13 }},
		{"remapped control", func(p *Profile) { p.ControlSlots[KnobLeft] = 4 }},
		{"duplicate slot", func(p *Profile) { p.ControlSlots[Key2] = 1 }},
		{"zero slot", func(p *Profile) { p.ControlSlots[Key1] = 0 }},
	} {
		t.Run(tt.name, func(t *testing.T) {
			profile := ThreeKeyOneKnob()
			tt.change(&profile)
			encoders := bindingEncoders()
			encoders["LED"] = func(p Profile, _ Control) ([]Report, error) { return EncodeLED(p, 0) }
			for name, encode := range encoders {
				got, err := encode(profile, Key1)
				if err == nil || got != nil {
					t.Fatalf("%s: got %x, %v, want nil reports and an error", name, got, err)
				}
			}
		})
	}
	for _, control := range []Control{"", "key4", "key13", "13", "knob2-left", "knob3-right"} {
		for name, encode := range bindingEncoders() {
			got, err := encode(ThreeKeyOneKnob(), control)
			if err == nil || got != nil {
				t.Fatalf("%s control %q: got %x, %v", name, control, got, err)
			}
		}
	}
}

func TestEncoderHasNoSharedState(t *testing.T) {
	profile := ThreeKeyOneKnob()
	if profile.VID != 0x1189 || profile.PID != 0x8890 || profile.Variant != KriomantFE {
		t.Fatalf("unexpected profile: %#v", profile)
	}
	originalSlots := maps.Clone(profile.ControlSlots)
	strokes := []Stroke{{Modifiers: 0x40, Usage: 0x04}}
	originalStrokes := slices.Clone(strokes)
	first, err := EncodeKeyboard(profile, KnobPress, strokes)
	if err != nil {
		t.Fatal(err)
	}
	if !maps.Equal(profile.ControlSlots, originalSlots) || !slices.Equal(strokes, originalStrokes) {
		t.Fatal("encoder changed its inputs")
	}
	want := slices.Clone(first)
	first[0][0] = 0xff
	second, err := EncodeKeyboard(profile, KnobPress, strokes)
	if err != nil {
		t.Fatal(err)
	}
	assertReports(t, second, want)
	profile.ControlSlots[Key1] = 9
	if ThreeKeyOneKnob().ControlSlots[Key1] != 1 {
		t.Fatal("profiles share a mutable control map")
	}
	strokes[0].Usage = 0x05
	assertReports(t, second, want)
}

func assertReports(t *testing.T, got, want []Report) {
	t.Helper()
	if !slices.Equal(got, want) {
		t.Fatalf("reports:\n got %x\nwant %x", got, want)
	}
	for i, report := range got {
		if len(report) != 64 || report[0] != 0x03 {
			t.Fatalf("report %d has invalid framing: %x", i, report)
		}
		for offset, value := range report[8:] {
			if value != 0 {
				t.Fatalf("report %d has non-zero padding at %d", i, offset+8)
			}
		}
	}
}

func TestEncodeKeyboardK884xFEAndFD(t *testing.T) {
	feProfile := K884xProfile(0x8851, 0, 1)
	feGot, err := EncodeKeyboard(feProfile, Knob1Right, []Stroke{
		{Modifiers: 0x01, Usage: 0x06},
		{Modifiers: 0x01, Usage: 0x19},
	})
	if err != nil {
		t.Fatal(err)
	}
	feWant := []Report{
		{0x03, 0xfe, 18, 1, 0x01, 0, 0, 0, 0, 0, 2, 0x01, 0x06, 0x01, 0x19},
		{0x03, 0xaa, 0xaa},
		{0x03, 0xfd, 0xfe, 0xff},
		{0x03, 0xaa, 0xaa},
	}
	if !slices.Equal(feGot, feWant) {
		t.Fatalf("K884xFE keyboard:\n got %x\nwant %x", feGot, feWant)
	}

	feModOnly, err := EncodeKeyboard(feProfile, Key1, []Stroke{{Modifiers: 0x03, Usage: 0x00}})
	if err != nil {
		t.Fatal(err)
	}
	if feModOnly[0][10] != 0 || feModOnly[0][11] != 0x03 || feModOnly[0][12] != 0x00 {
		t.Fatalf("K884xFE mod-only: %x", feModOnly[0])
	}

	fdProfile := K884xProfile(0x8850, 11, 1)
	fdGot, err := EncodeKeyboard(fdProfile, Knob4Left, []Stroke{
		{Modifiers: 0x03, Usage: 0x68},
	})
	if err != nil {
		t.Fatal(err)
	}
	fdWant := []Report{
		{0x03, 0xfd, 13, 1, 0x01, 0x00, 3, 0x00, 0x00, 0xf1, 0x00, 0x00, 0xf2, 0x00, 0x00, 0x68},
		{0x03, 0xfd, 0xfe, 0xff},
	}
	if !slices.Equal(fdGot, fdWant) {
		t.Fatalf("K884xFD keyboard:\n got %x\nwant %x", fdGot, fdWant)
	}
}
