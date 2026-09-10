package studio

import (
	"bytes"
	"context"
	"encoding/binary"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"time"
)

func kokoroTestWAV() []byte {
	raw := speechTestWAV()
	binary.LittleEndian.PutUint32(raw[24:], 24000)
	binary.LittleEndian.PutUint32(raw[28:], 48000)
	return raw
}

func kokoroTestBackend(t *testing.T, handler http.HandlerFunc) *kokoroSpeechEngine {
	t.Helper()
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path == "/health" {
			jsonResponse(w, 200, map[string]any{"status": "ok", "engine": "kokoro-onnx", "model": "kokoro-v1.0", "voices": []string{"af_heart", "af_bella", "am_michael", "am_fenrir", "bf_emma"}})
			return
		}
		if r.Method != http.MethodPost || r.URL.Path != "/v1/audio/speech" {
			t.Errorf("unexpected service route: %s %s", r.Method, r.URL.Path)
		}
		handler(w, r)
	}))
	t.Cleanup(server.Close)
	engine := newKokoroSpeechEngine(server.URL)
	engine.timeout = time.Second
	return engine
}

func TestKokoroConfigPersistsSeparatelyAndPreviewKeepsSelection(t *testing.T) {
	profile := t.TempDir()
	settings := []byte(`{"provider":"compatible","apiKey":"private-api-key","endpoint":"https://example.invalid","dailyMinutes":120}`)
	if err := os.WriteFile(filepath.Join(profile, "settings.json"), settings, 0600); err != nil {
		t.Fatal(err)
	}
	db, err := openDatabase(profile)
	if err != nil {
		t.Fatal(err)
	}
	var requests atomic.Int32
	engine := kokoroTestBackend(t, func(w http.ResponseWriter, r *http.Request) {
		requests.Add(1)
		var input struct {
			Input, Voice, Lang, ResponseFormat string
			Speed                              int
		}
		var body map[string]any
		if json.NewDecoder(r.Body).Decode(&body) != nil {
			t.Error("invalid JSON forwarded to Kokoro")
		}
		// Check wire names as well as values; the service is OpenAI-compatible.
		input.Input, _ = body["input"].(string)
		input.Voice, _ = body["voice"].(string)
		input.Lang, _ = body["lang"].(string)
		if body["response_format"] != "wav" || body["speed"] != float64(1) || input.Input != "The deadline is Friday." || (input.Lang == "en-gb") != (input.Voice == "bf_emma") {
			t.Errorf("wrong synthesis contract: %#v", body)
		}
		w.Header().Set("Content-Type", "audio/wav")
		_, _ = w.Write(kokoroTestWAV())
	})
	s := &Server{db: db, web: t.TempDir(), speechBackend: engine}
	response := call(t, s, "GET", "/api/speech/config", nil)
	var config speechConfiguration
	if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &config) != nil || config.Voice != "af_heart" || !config.Available || config.Engine != "kokoro" || config.Culture != "en-US" || len(config.Voices) != 4 {
		t.Fatalf("default config: %d %s", response.Code, response.Body.String())
	}
	response = call(t, s, "POST", "/api/speech/config", speechSettings{Voice: "af_bella"})
	if response.Code != 200 {
		t.Fatalf("save config: %d %s", response.Code, response.Body.String())
	}
	for _, scenario := range []struct{ voice, lang, wantVoice, wantCulture string }{
		{"am_michael", "", "am_michael", "en-US"},
		{"", "", "af_bella", "en-US"},
		{"af_bella", "en-GB", "bf_emma", "en-GB"},
	} {
		response = call(t, s, "POST", "/api/speech", speechRequest{Text: "The deadline is Friday.", Voice: scenario.voice, Lang: scenario.lang})
		var output speechResult
		if response.Code != 200 || json.Unmarshal(response.Body.Bytes(), &output) != nil || output.Engine != "kokoro" || output.Voice != scenario.wantVoice || output.Culture != scenario.wantCulture {
			t.Fatalf("synthesis result: %d %s", response.Code, response.Body.String())
		}
		media := call(t, s, "GET", "/media/"+output.Audio, nil)
		if media.Code != 200 || !bytes.Equal(media.Body.Bytes(), kokoroTestWAV()) {
			t.Fatal("returned media is not playable")
		}
	}
	// A reopened profile sees the selection, and neither preview nor GB changes it.
	reopened, err := openDatabase(profile)
	if err != nil {
		t.Fatal(err)
	}
	persisted, err := (&Server{db: reopened}).loadSpeechSettings()
	if err != nil || persisted.Voice != "af_bella" || requests.Load() != 3 {
		t.Fatalf("selection did not persist: %#v %v", persisted, err)
	}
	after, err := os.ReadFile(filepath.Join(profile, "settings.json"))
	if err != nil || !bytes.Equal(settings, after) || db.config().APIKey != "private-api-key" || reopened.config().APIKey != "private-api-key" {
		t.Fatal("speech configuration touched provider settings or API key")
	}
	for _, voice := range []string{"bf_emma", "Microsoft Zira", "../af_heart", ""} {
		if call(t, s, "POST", "/api/speech/config", speechSettings{Voice: voice}).Code != 400 {
			t.Fatalf("invalid US voice accepted: %q", voice)
		}
	}
}

func TestKokoroCacheSeparatesVoicesAccentsAndLegacy(t *testing.T) {
	var calls atomic.Int32
	engine := kokoroTestBackend(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		_, _ = w.Write(kokoroTestWAV())
	})
	profile := t.TempDir()
	seen := map[string]bool{}
	for _, input := range []speechRequest{
		{Text: "Same words.", Lang: "en-US", Voice: "af_heart"},
		{Text: "Same words.", Lang: "en-US", Voice: "af_bella"},
		{Text: "Same words.", Lang: "en-GB", Voice: "bf_emma"},
	} {
		first, err := engine.synthesize(context.Background(), profile, input)
		if err != nil || seen[first.Audio] || first.Audio == speechHash(input)+".wav" {
			t.Fatalf("cache identity collision: %#v %v", first, err)
		}
		seen[first.Audio] = true
		second, err := engine.synthesize(context.Background(), profile, input)
		if err != nil || first != second {
			t.Fatalf("cache reuse failed: %#v %v", second, err)
		}
	}
	if calls.Load() != 3 {
		t.Fatalf("cache did not avoid generation: %d", calls.Load())
	}
	// Metadata claiming a different engine must not pass merely because its WAV is valid.
	b := speechRequest{Text: "Same words.", Lang: "en-US", Voice: "af_heart"}
	key := kokoroSpeechHash(b)
	raw, err := os.ReadFile(filepath.Join(profile, "speech-cache", key+".json"))
	if err != nil {
		t.Fatal(err)
	}
	var cache speechCacheRecord
	if json.Unmarshal(raw, &cache) != nil {
		t.Fatal("invalid cache")
	}
	cache.Engine = "system"
	if err := atomicJSON(filepath.Join(profile, "speech-cache", key+".json"), cache); err != nil {
		t.Fatal(err)
	}
	if _, err := engine.synthesize(context.Background(), profile, b); err != nil || calls.Load() != 4 {
		t.Fatalf("legacy engine cache was reused: %v", err)
	}
}

func TestKokoroConcurrentDuplicatePublicationAndWorkerLimit(t *testing.T) {
	started, release := make(chan struct{}, 2), make(chan struct{})
	var sequence atomic.Int32
	engine := kokoroTestBackend(t, func(w http.ResponseWriter, r *http.Request) {
		n := sequence.Add(1)
		started <- struct{}{}
		<-release
		wav := kokoroTestWAV()
		wav[44] = byte(n)
		_, _ = w.Write(wav)
	})
	profile := t.TempDir()
	b := speechRequest{Text: "Concurrent words.", Lang: "en-US", Voice: "af_heart"}
	completed := make(chan error, 2)
	for i := 0; i < 2; i++ {
		go func() {
			_, err := engine.synthesize(context.Background(), profile, b)
			completed <- err
		}()
	}
	<-started
	<-started
	if _, err := engine.synthesize(context.Background(), profile, speechRequest{Text: "Third request."}); !errors.Is(err, errSpeechBusy) {
		t.Fatalf("third concurrent request accepted: %v", err)
	}
	close(release)
	for i := 0; i < 2; i++ {
		if err := <-completed; err != nil {
			t.Fatal(err)
		}
	}
	if _, ok := engine.cached(profile, kokoroSpeechHash(b), b); !ok || len(engine.slots) != 0 {
		t.Fatal("concurrent results produced mismatched audio and metadata or leaked slot")
	}
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := engine.synthesize(ctx, profile, b); !errors.Is(err, context.Canceled) {
		t.Fatal("cancelled request was served")
	}
}

func TestKokoroTimeoutDoesNotPublishOrLeakWorkers(t *testing.T) {
	release := make(chan struct{})
	engine := kokoroTestBackend(t, func(w http.ResponseWriter, r *http.Request) {
		<-release
	})
	// Release the intentionally stalled handler before httptest closes its server.
	t.Cleanup(func() { close(release) })
	engine.timeout = 15 * time.Millisecond
	profile := t.TempDir()
	_, err := engine.synthesize(context.Background(), profile, speechRequest{Text: "Timeout."})
	if !errors.Is(err, context.DeadlineExceeded) || len(engine.slots) != 0 {
		t.Fatalf("timeout or worker release failed: %v", err)
	}
	files, _ := os.ReadDir(profile)
	if len(files) != 0 {
		t.Fatal("timed out request left files")
	}
}

func TestKokoroHTTPRejectsMalformedInputAndSanitizesServiceErrors(t *testing.T) {
	var calls atomic.Int32
	engine := kokoroTestBackend(t, func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		w.WriteHeader(http.StatusInternalServerError)
		_, _ = io.WriteString(w, `secret API_KEY in C:\private\profile: `+strings.Repeat("x", 100000))
	})
	s := &Server{db: &database{dir: t.TempDir()}, web: t.TempDir(), speechBackend: engine}
	for _, input := range [][]byte{
		[]byte(`{"text":"Hello","lang":"de-DE"}`),
		[]byte(`{"text":"Hello","voice":"Microsoft Zira"}`),
		[]byte(`{"text":"Hello","voice":"bf_emma"}`),
		[]byte(`{"text":"Hello","engine":"system"}`),
		[]byte(`{"text":"Hello"} {"text":"Second"}`),
		[]byte(`{"text":"\u0000"}`),
		append(append([]byte(`{"text":"`), byte(0xff)), []byte(`"}`)...),
		[]byte(`{"text":"` + strings.Repeat("é", kokoroMaxText/2+1) + `"}`),
	} {
		w := httptest.NewRecorder()
		r := httptest.NewRequest("POST", "http://127.0.0.1:8777/api/speech", bytes.NewReader(input))
		s.Handler().ServeHTTP(w, r)
		if w.Code != 400 {
			t.Fatalf("invalid request accepted: %d", w.Code)
		}
	}
	if calls.Load() != 0 {
		t.Fatal("invalid requests reached service")
	}
	response := call(t, s, "POST", "/api/speech", speechRequest{Text: "A safe line."})
	if response.Code != 503 || strings.Contains(response.Body.String(), "secret") || strings.Contains(response.Body.String(), "private") || response.Body.Len() > 1024 {
		t.Fatalf("service details leaked: %d %s", response.Code, response.Body.String())
	}
}

type speechRoundTrip func(*http.Request) (*http.Response, error)

func (f speechRoundTrip) RoundTrip(r *http.Request) (*http.Response, error) { return f(r) }

type speechCountingReader struct{ remaining, read int64 }

func (r *speechCountingReader) Read(p []byte) (int, error) {
	if r.remaining == 0 {
		return 0, io.EOF
	}
	n := min(int64(len(p)), r.remaining)
	clear(p[:n])
	r.remaining -= n
	r.read += n
	return int(n), nil
}

func TestKokoroBoundsChunkedAudioReply(t *testing.T) {
	reader := &speechCountingReader{remaining: speechMaxWAV * 2}
	engine := newKokoroSpeechEngine("http://127.0.0.1:8880")
	engine.client.Transport = speechRoundTrip(func(*http.Request) (*http.Response, error) {
		return &http.Response{StatusCode: 200, ContentLength: -1, Body: io.NopCloser(reader)}, nil
	})
	if _, err := engine.synthesize(context.Background(), t.TempDir(), speechRequest{Text: "Hello."}); !errors.Is(err, errKokoroAudio) || reader.read != speechMaxWAV+1 {
		t.Fatalf("response read was not bounded: %d %v", reader.read, err)
	}
}

func TestKokoroWAVRequiresConsistentPCM(t *testing.T) {
	if !validSpeechWAV(kokoroTestWAV()) {
		t.Fatal("Kokoro 24kHz WAV rejected")
	}
	for _, mutate := range []func([]byte){
		func(raw []byte) { binary.LittleEndian.PutUint16(raw[22:], 2) },
		func(raw []byte) { binary.LittleEndian.PutUint32(raw[28:], 44100) },
		func(raw []byte) { binary.LittleEndian.PutUint32(raw[24:], 48000) },
		func(raw []byte) { binary.LittleEndian.PutUint16(raw[34:], 32) },
	} {
		raw := kokoroTestWAV()
		mutate(raw)
		if validSpeechWAV(raw) {
			t.Fatal("inconsistent PCM accepted")
		}
	}
}

func TestKokoroLocalIntegration(t *testing.T) {
	if os.Getenv("ENGLISH_TEST_KOKORO") != "1" {
		t.Skip("set ENGLISH_TEST_KOKORO=1 to check the installed local service")
	}
	engine := newKokoroSpeechEngine("http://127.0.0.1:8880")
	profile := t.TempDir()
	for _, accent := range []struct{ culture, voice string }{{"en-US", "af_heart"}, {"en-GB", "bf_emma"}} {
		if !engine.available(context.Background(), accent.voice) {
			t.Fatalf("local service is not ready for %s", accent.voice)
		}
		out, err := engine.synthesize(context.Background(), profile, speechRequest{Text: "I'm ready to practice English.", Lang: accent.culture, Voice: accent.voice})
		if err != nil || out.Engine != "kokoro" || out.Culture != accent.culture || out.Voice != accent.voice {
			t.Fatalf("installed service synthesis: %#v %v", out, err)
		}
		wav, err := os.ReadFile(filepath.Join(profile, "media", out.Audio))
		if err != nil || !validSpeechWAV(wav) || binary.LittleEndian.Uint32(wav[24:]) != 24000 {
			t.Fatalf("installed service returned invalid 24kHz PCM: %v", err)
		}
		t.Logf("Kokoro confirmed: %s (%s), %d WAV bytes", out.Voice, out.Culture, len(wav))
	}
}
