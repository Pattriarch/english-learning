package bot

import (
	"strings"
	"testing"
)

func TestSplitMessageKeepsLimit(t *testing.T) {
	line := strings.Repeat("абвгд ", 200) // 1200 runes
	text := strings.Repeat(line+"\n", 10)
	chunks := splitMessage(text, maxMessageLen)
	if len(chunks) < 3 {
		t.Fatalf("got %d chunks, want at least 3", len(chunks))
	}
	joined := 0
	for i, c := range chunks {
		if n := len([]rune(c)); n > maxMessageLen {
			t.Fatalf("chunk %d has %d runes, limit is %d", i, n, maxMessageLen)
		}
		joined += strings.Count(c, "абвгд")
	}
	if want := strings.Count(text, "абвгд"); joined != want {
		t.Fatalf("lost content: %d words across chunks, want %d", joined, want)
	}
}

func TestSplitMessageShortText(t *testing.T) {
	chunks := splitMessage("<b>hi</b>", maxMessageLen)
	if len(chunks) != 1 || chunks[0] != "<b>hi</b>" {
		t.Fatalf("chunks = %q", chunks)
	}
}

func TestSplitMessageDoesNotCutTags(t *testing.T) {
	// one very long line made of short tagged fragments
	var b strings.Builder
	for i := 0; i < 500; i++ {
		b.WriteString("<b>word</b> ")
	}
	for _, c := range splitMessage(b.String(), maxMessageLen) {
		if strings.Count(c, "<b>") != strings.Count(c, "</b>") {
			t.Fatalf("unbalanced tags in chunk: %q", c[max(0, len(c)-60):])
		}
	}
}

func TestEscape(t *testing.T) {
	if got := esc(`a < b & c > d`); got != "a &lt; b &amp; c &gt; d" {
		t.Fatalf("esc = %q", got)
	}
}

func TestSplitCommand(t *testing.T) {
	cases := map[string]string{
		"/write":        "/write",
		"/write_new":    "/write_new",
		"/anki@my_bot":  "/anki",
		"/Stats extra":  "/stats",
		"just a letter": "",
	}
	for in, want := range cases {
		if got, _ := splitCommand(in); got != want {
			t.Errorf("splitCommand(%q) = %q, want %q", in, got, want)
		}
	}
}

func TestPromptPool(t *testing.T) {
	if len(Prompts) != 60 {
		t.Fatalf("pool has %d prompts, want 60", len(Prompts))
	}
	seen := map[string]bool{}
	for i, p := range Prompts {
		if p.EN == "" || p.RU == "" {
			t.Fatalf("prompt %d is incomplete: %+v", i, p)
		}
		if seen[p.EN] {
			t.Fatalf("duplicate prompt: %q", p.EN)
		}
		seen[p.EN] = true
	}
}
