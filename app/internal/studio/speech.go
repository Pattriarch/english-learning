package studio

import (
	"context"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
	"unicode/utf8"
)

const speechMaxText = 8000
const speechMaxWAV = 32 << 20

var errSpeechBusy = errors.New("Озвучивание занято. Через несколько секунд нажми «Послушать» ещё раз")
var errSpeechUnavailable = errors.New("Локальная озвучка требует Windows и установленного американского голоса English (United States)")

type speechRequest struct {
	Text string `json:"text"`
	Lang string `json:"lang"`
}

type speechResult struct {
	Audio   string `json:"audio"`
	Voice   string `json:"voice"`
	Culture string `json:"culture"`
}

type speechCacheRecord struct {
	speechResult
	SourceHash string `json:"sourceHash"`
	WAVHash    string `json:"wavHash"`
}

type speechRunner func(context.Context, string, string, string, string) error

type speechEngine struct {
	slots   chan struct{}
	run     speechRunner
	timeout time.Duration
}

var localSpeech = speechEngine{slots: make(chan struct{}, 2), run: runWindowsSpeech, timeout: 60 * time.Second}

func validateSpeechRequest(b *speechRequest) error {
	if b.Lang == "" {
		b.Lang = "en-US"
	}
	b.Text = strings.TrimSpace(b.Text)
	if b.Lang != "en-US" || b.Text == "" || len(b.Text) > speechMaxText || !utf8.ValidString(b.Text) || strings.ContainsRune(b.Text, '\x00') {
		return errors.New("Для озвучки нужен текст до 8000 байт и язык en-US; длинный текст раздели на фрагменты")
	}
	return nil
}

func speechHash(b speechRequest) string {
	h := sha256.Sum256([]byte("local-system-speech-v1\x00" + b.Lang + "\x00" + b.Text))
	return hex.EncodeToString(h[:])
}

// System.Speech is configured to emit PCM mono 22,050 Hz, 16 bit. Check complete
// RIFF chunks, not only the .wav suffix, before a cached result becomes playable.
func validSpeechWAV(raw []byte) bool {
	if len(raw) < 46 || len(raw) > speechMaxWAV || string(raw[:4]) != "RIFF" || string(raw[8:12]) != "WAVE" || uint64(binary.LittleEndian.Uint32(raw[4:8]))+8 != uint64(len(raw)) {
		return false
	}
	fmtOK, dataOK := false, false
	for pos := 12; pos < len(raw); {
		if pos+8 > len(raw) {
			return false
		}
		size := uint64(binary.LittleEndian.Uint32(raw[pos+4 : pos+8]))
		end := uint64(pos+8) + size
		if end > uint64(len(raw)) {
			return false
		}
		switch string(raw[pos : pos+4]) {
		case "fmt ":
			if size < 16 {
				return false
			}
			p := raw[pos+8 : int(end)]
			fmtOK = binary.LittleEndian.Uint16(p[:2]) == 1 && binary.LittleEndian.Uint16(p[2:4]) == 1 && binary.LittleEndian.Uint32(p[4:8]) == 22050 && binary.LittleEndian.Uint32(p[8:12]) == 44100 && binary.LittleEndian.Uint16(p[12:14]) == 2 && binary.LittleEndian.Uint16(p[14:16]) == 16
		case "data":
			dataOK = size > 0 && size%2 == 0
		}
		pos = int(end + size%2)
		if pos > len(raw) {
			return false
		}
	}
	return fmtOK && dataOK
}

func readBoundedFile(path string, max int64) ([]byte, error) {
	f, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	defer f.Close()
	info, err := f.Stat()
	if err != nil || !info.Mode().IsRegular() || info.Size() > max {
		return nil, errors.New("invalid speech cache file")
	}
	data, err := io.ReadAll(io.LimitReader(f, max+1))
	if int64(len(data)) > max {
		return nil, errors.New("speech file exceeds limit")
	}
	return data, err
}

func cachedSpeech(profile, key string) (speechResult, bool) {
	var cached speechCacheRecord
	raw, err := readBoundedFile(filepath.Join(profile, "speech-cache", key+".json"), 4096)
	if err != nil || json.Unmarshal(raw, &cached) != nil || cached.SourceHash != key || cached.Audio != key+".wav" || cached.Culture != "en-US" || cached.Voice == "" {
		return speechResult{}, false
	}
	wav, err := readBoundedFile(filepath.Join(profile, "media", cached.Audio), speechMaxWAV)
	if err != nil || !validSpeechWAV(wav) {
		return speechResult{}, false
	}
	h := sha256.Sum256(wav)
	if hex.EncodeToString(h[:]) != cached.WAVHash {
		return speechResult{}, false
	}
	return cached.speechResult, true
}

func (e *speechEngine) synthesize(ctx context.Context, profile, content string, b speechRequest) (speechResult, error) {
	if err := validateSpeechRequest(&b); err != nil {
		return speechResult{}, err
	}
	if err := ctx.Err(); err != nil {
		return speechResult{}, err
	}
	key := speechHash(b)
	if out, ok := cachedSpeech(profile, key); ok {
		return out, nil
	}
	select {
	case e.slots <- struct{}{}:
		defer func() { <-e.slots }()
	default:
		return speechResult{}, errSpeechBusy
	}
	ctx, cancel := context.WithTimeout(ctx, e.timeout)
	defer cancel()
	// Cache paths contain only our SHA, never the user's words or filename.
	cache := filepath.Join(profile, "speech-cache")
	if err := os.MkdirAll(cache, 0700); err != nil {
		return speechResult{}, err
	}
	if err := os.MkdirAll(filepath.Join(profile, "media"), 0700); err != nil {
		return speechResult{}, err
	}
	work, err := os.MkdirTemp(cache, "pending-")
	if err != nil {
		return speechResult{}, err
	}
	defer os.RemoveAll(work)
	input, wavPath, metaPath := filepath.Join(work, "input.json"), filepath.Join(work, "speech.wav"), filepath.Join(work, "voice.json")
	inputBytes, _ := json.Marshal(b)
	if err = os.WriteFile(input, inputBytes, 0600); err != nil {
		return speechResult{}, err
	}
	script, err := filepath.Abs(filepath.Join(content, "..", "scripts", "speak-local.ps1"))
	if err != nil {
		return speechResult{}, err
	}
	if err = e.run(ctx, script, input, wavPath, metaPath); err != nil {
		if ctx.Err() != nil {
			return speechResult{}, ctx.Err()
		}
		return speechResult{}, err
	}
	if ctx.Err() != nil {
		return speechResult{}, ctx.Err()
	}
	var out speechResult
	metadata, err := readBoundedFile(metaPath, 4096)
	if err != nil || json.Unmarshal(metadata, &out) != nil || out.Culture != "en-US" || out.Voice == "" || len(out.Voice) > 200 {
		return speechResult{}, errors.New("Не удалось подтвердить американский голос локальной озвучки")
	}
	wav, err := readBoundedFile(wavPath, speechMaxWAV)
	if err != nil || !validSpeechWAV(wav) {
		return speechResult{}, errors.New("Локальная озвучка вернула неполный аудиофайл; попробуй более короткий фрагмент")
	}
	out.Audio = key + ".wav"
	// Both source and destination are inside one profile. Rename publishes the
	// completed WAV atomically; cache metadata is published only afterwards.
	if err = os.Rename(wavPath, filepath.Join(profile, "media", out.Audio)); err != nil {
		return speechResult{}, err
	}
	h := sha256.Sum256(wav)
	if err = atomicJSON(filepath.Join(cache, key+".json"), speechCacheRecord{speechResult: out, SourceHash: key, WAVHash: hex.EncodeToString(h[:])}); err != nil {
		return speechResult{}, err
	}
	return out, nil
}

func (s *Server) speech(w http.ResponseWriter, r *http.Request) {
	r.Body = http.MaxBytesReader(w, r.Body, 64<<10)
	var b speechRequest
	if !decode(w, r, &b) {
		return
	}
	if err := validateSpeechRequest(&b); err != nil {
		problem(w, 400, err)
		return
	}
	out, err := localSpeech.synthesize(r.Context(), s.db.dir, s.content, b)
	if err != nil {
		status := http.StatusServiceUnavailable
		if errors.Is(err, errSpeechBusy) {
			status = http.StatusTooManyRequests
		} else if errors.Is(err, context.DeadlineExceeded) || errors.Is(err, context.Canceled) {
			status = http.StatusGatewayTimeout
			err = errors.New("Озвучивание не успело завершиться. Попробуй более короткий фрагмент")
		}
		problem(w, status, err)
		return
	}
	jsonResponse(w, 200, out)
}
