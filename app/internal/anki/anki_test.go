package anki

import "testing"

func TestTSV(t *testing.T) {
	got := string(TSV([]Card{
		{Front: "снаружи", Back: "outside", Note: "нареч."},
		{Front: "внезапно", Back: "out of nowhere", Note: ""},
	}))
	want := "снаружи\toutside\tнареч.\nвнезапно\tout of nowhere\t\n"
	if got != want {
		t.Fatalf("TSV = %q, want %q", got, want)
	}
}

func TestTSVEmpty(t *testing.T) {
	if got := TSV(nil); len(got) != 0 {
		t.Fatalf("TSV(nil) = %q, want empty", got)
	}
}

func TestTSVFlattensWhitespace(t *testing.T) {
	got := string(TSV([]Card{{Front: "  a\tb  ", Back: "line1\nline2", Note: "x\r\ny"}}))
	want := "a b\tline1 line2\tx y\n"
	if got != want {
		t.Fatalf("TSV = %q, want %q", got, want)
	}
}
