package studio

import (
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func speechTestWAV() []byte {
	raw := make([]byte, 48)
	copy(raw, "RIFF")
	binary.LittleEndian.PutUint32(raw[4:], 40)
	copy(raw[8:], "WAVEfmt ")
	binary.LittleEndian.PutUint32(raw[16:], 16)
	binary.LittleEndian.PutUint16(raw[20:], 1)
	binary.LittleEndian.PutUint16(raw[22:], 1)
	binary.LittleEndian.PutUint32(raw[24:], 22050)
	binary.LittleEndian.PutUint32(raw[28:], 44100)
	binary.LittleEndian.PutUint16(raw[32:], 2)
	binary.LittleEndian.PutUint16(raw[34:], 16)
	copy(raw[36:], "data")
	binary.LittleEndian.PutUint32(raw[40:], 4)
	raw[44], raw[46] = 1, 2
	return raw
}

func speechTestOutput(wav, metadata string) error {
	if err := os.WriteFile(wav, speechTestWAV(), 0600); err != nil {
		return err
	}
	return os.WriteFile(metadata, []byte(`{"voice":"Test US voice","culture":"en-US"}`), 0600)
}

func TestSpeechInputBoundsAndStableCacheIdentity(t *testing.T) {
	for _, input := range []speechRequest{{Text: " "}, {Text: "Hello", Lang: "en-GB"}, {Text: strings.Repeat("é", 4001)}, {Text: "hidden\x00text"}} {
		if validateSpeechRequest(&input) == nil {
			t.Fatal("invalid speech request accepted")
		}
	}
	input := speechRequest{Text: "  I'm ready — let's start.  "}
	if err := validateSpeechRequest(&input); err != nil || input.Lang != "en-US" || input.Text != "I'm ready — let's start." {
		t.Fatalf("normalization: %#v %v", input, err)
	}
	if speechHash(input) == speechHash(speechRequest{Text: input.Text + "!", Lang: input.Lang}) {
		t.Fatal("different text shares a cache key")
	}
}

func TestSpeechWAVValidationRejectsIncompleteAndWrongFormat(t *testing.T) {
	valid := speechTestWAV()
	if !validSpeechWAV(valid) {
		t.Fatal("valid PCM rejected")
	}
	for _, raw := range [][]byte{nil, valid[:44], append(append([]byte{}, valid...), 0)} {
		if validSpeechWAV(raw) {
			t.Fatal("truncated or invalid RIFF accepted")
		}
	}
	wrong := append([]byte{}, valid...)
	binary.LittleEndian.PutUint16(wrong[20:], 3)
	if validSpeechWAV(wrong) {
		t.Fatal("non-PCM accepted")
	}
	wrong = append([]byte{}, valid...)
	binary.LittleEndian.PutUint32(wrong[40:], 10000)
	if validSpeechWAV(wrong) {
		t.Fatal("data chunk beyond EOF accepted")
	}
}

func TestSpeechPrivateJSONInputAndVerifiedCache(t *testing.T) {
	profile := t.TempDir()
	text := `Let's read "budget"; $(Get-Process); café — now.`
	calls := 0
	engine := speechEngine{slots: make(chan struct{}, 2), timeout: time.Second, run: func(_ context.Context, script, input, wav, metadata string) error {
		calls++
		if !filepath.IsAbs(script) || filepath.Base(script) != "speak-local.ps1" || !strings.HasPrefix(input, profile+string(filepath.Separator)) {
			t.Fatal("unexpected speech paths")
		}
		raw, err := os.ReadFile(input)
		if err != nil {
			return err
		}
		var request speechRequest
		if err := json.Unmarshal(raw, &request); err != nil || request.Text != text || request.Lang != "en-US" {
			t.Fatalf("plain input changed: %#v %v", request, err)
		}
		return speechTestOutput(wav, metadata)
	}}
	request := speechRequest{Text: text, Lang: "en-US"}
	first, err := engine.synthesize(context.Background(), profile, t.TempDir(), request)
	if err != nil || first.Culture != "en-US" || first.Audio != speechHash(request)+".wav" {
		t.Fatalf("synthesis: %#v %v", first, err)
	}
	second, err := engine.synthesize(context.Background(), profile, t.TempDir(), request)
	if err != nil || second != first || calls != 1 {
		t.Fatalf("cache not reused: %d %v", calls, err)
	}
	pending, _ := filepath.Glob(filepath.Join(profile, "speech-cache", "pending-*"))
	if len(pending) != 0 {
		t.Fatal("temporary source text survived synthesis")
	}
	// A corrupt cache file must trigger synthesis rather than a false success.
	if err := os.WriteFile(filepath.Join(profile, "media", first.Audio), []byte("RIFF broken"), 0600); err != nil {
		t.Fatal(err)
	}
	third, err := engine.synthesize(context.Background(), profile, t.TempDir(), request)
	if err != nil || third != first || calls != 2 {
		t.Fatalf("bad cache was trusted or not replaceable: %d %v", calls, err)
	}
}

func TestSpeechTimeoutCleansInputAndDoesNotPublish(t *testing.T) {
	profile := t.TempDir()
	engine := speechEngine{slots: make(chan struct{}, 1), timeout: 10 * time.Millisecond, run: func(ctx context.Context, _, _, _, _ string) error {
		<-ctx.Done()
		return ctx.Err()
	}}
	_, err := engine.synthesize(context.Background(), profile, t.TempDir(), speechRequest{Text: "A short message.", Lang: "en-US"})
	if !errors.Is(err, context.DeadlineExceeded) {
		t.Fatalf("timeout lost: %v", err)
	}
	files, _ := os.ReadDir(filepath.Join(profile, "speech-cache"))
	media, _ := os.ReadDir(filepath.Join(profile, "media"))
	if len(files) != 0 || len(media) != 0 || len(engine.slots) != 0 {
		t.Fatal("failed request left private text, published output or occupied slot")
	}
}

func TestSpeechConcurrencyBoundAndCancellation(t *testing.T) {
	var active, peak atomic.Int32
	started, release, done := make(chan struct{}, 2), make(chan struct{}), make(chan error, 2)
	engine := speechEngine{slots: make(chan struct{}, 2), timeout: time.Second, run: func(ctx context.Context, _, _, wav, metadata string) error {
		n := active.Add(1)
		defer active.Add(-1)
		for old := peak.Load(); n > old && !peak.CompareAndSwap(old, n); old = peak.Load() {
		}
		started <- struct{}{}
		select {
		case <-release:
			return speechTestOutput(wav, metadata)
		case <-ctx.Done():
			return ctx.Err()
		}
	}}
	profile, content := t.TempDir(), t.TempDir()
	for _, text := range []string{"First message.", "Second message."} {
		go func(text string) {
			_, err := engine.synthesize(context.Background(), profile, content, speechRequest{Text: text, Lang: "en-US"})
			done <- err
		}(text)
	}
	<-started
	<-started
	_, err := engine.synthesize(context.Background(), profile, content, speechRequest{Text: "Third message.", Lang: "en-US"})
	if !errors.Is(err, errSpeechBusy) || peak.Load() != 2 {
		t.Fatalf("unbounded speech workers: peak=%d err=%v", peak.Load(), err)
	}
	close(release)
	for i := 0; i < 2; i++ {
		if err := <-done; err != nil {
			t.Fatal(err)
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := engine.synthesize(ctx, profile, content, speechRequest{Text: "Cancelled.", Lang: "en-US"}); !errors.Is(err, context.Canceled) {
		t.Fatal("cancelled work was allowed to start")
	}
}

func TestSpeechHTTPReturnsPlayableCachedMediaAndRejectsInvalidInput(t *testing.T) {
	profile, content := t.TempDir(), t.TempDir()
	engine := speechEngine{slots: make(chan struct{}, 1), timeout: time.Second, run: func(_ context.Context, _, _, wav, metadata string) error { return speechTestOutput(wav, metadata) }}
	request := speechRequest{Text: "The deadline is Friday.", Lang: "en-US"}
	want, err := engine.synthesize(context.Background(), profile, content, request)
	if err != nil {
		t.Fatal(err)
	}
	s := &Server{db: &database{dir: profile}, content: content, web: t.TempDir()}
	response := call(t, s, "POST", "/api/speech", request)
	var got speechResult
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &got) != nil || got != want {
		t.Fatalf("speech route: %d %s", response.Code, response.Body.String())
	}
	media := call(t, s, "GET", "/media/"+got.Audio, nil)
	if media.Code != 200 || !validSpeechWAV(media.Body.Bytes()) {
		t.Fatal("returned audio is not served")
	}
	if call(t, s, "POST", "/api/speech", speechRequest{Text: "Hello", Lang: "en-GB"}).Code != 400 {
		t.Fatal("wrong accent request accepted")
	}
	if call(t, s, "POST", "/api/speech", speechRequest{Text: strings.Repeat("é", 4001), Lang: "en-US"}).Code != 400 {
		t.Fatal("UTF-8 size bound not enforced")
	}
}

func TestSpeechRejectsWrongVoiceAndIncompleteOutput(t *testing.T) {
	for _, mode := range []string{"voice", "wave"} {
		t.Run(mode, func(t *testing.T) {
			profile := t.TempDir()
			engine := speechEngine{slots: make(chan struct{}, 1), timeout: time.Second, run: func(_ context.Context, _, _, wav, metadata string) error {
				if err := speechTestOutput(wav, metadata); err != nil {
					return err
				}
				if mode == "voice" {
					return os.WriteFile(metadata, []byte(`{"voice":"UK voice","culture":"en-GB"}`), 0600)
				}
				return os.WriteFile(wav, []byte("RIFF"), 0600)
			}}
			if _, err := engine.synthesize(context.Background(), profile, t.TempDir(), speechRequest{Text: "Test.", Lang: "en-US"}); err == nil {
				t.Fatal("invalid synthesis accepted")
			}
			files, _ := os.ReadDir(filepath.Join(profile, "media"))
			if len(files) != 0 {
				t.Fatal("invalid output published")
			}
		})
	}
}

// Explicit local integration check; ordinary CI needs neither Windows voices nor
// a microphone. This uses only a fresh temporary profile and one original line.
func TestSpeechWindowsIntegration(t *testing.T) {
	if runtime.GOOS != "windows" || os.Getenv("ENGLISH_TEST_LOCAL_SPEECH") != "1" {
		t.Skip("set ENGLISH_TEST_LOCAL_SPEECH=1 for the installed Windows voice check")
	}
	profile := t.TempDir()
	out, err := localSpeech.synthesize(context.Background(), profile, "../../content", speechRequest{Text: "I'm ready to practice American English.", Lang: "en-US"})
	if err != nil {
		t.Fatal(err)
	}
	if out.Culture != "en-US" || out.Voice == "" {
		t.Fatalf("wrong local voice: %#v", out)
	}
	if _, ok := cachedSpeech(profile, speechHash(speechRequest{Text: "I'm ready to practice American English.", Lang: "en-US"})); !ok {
		t.Fatal("real System.Speech WAV was not cacheable")
	}
	t.Logf("Local TTS confirmed: %s (%s)", out.Voice, out.Culture)
}
