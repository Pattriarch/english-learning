package studio

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
	"unicode/utf8"
)

const kokoroMaxText = 64 << 10
const kokoroCacheVersion = "kokoro-onnx/kokoro-v1.0/pcm16-24000/v1"

var errKokoroUnavailable = errors.New("Kokoro не запущен. Запусти приложение через Start-English.cmd и повтори попытку")
var errKokoroAudio = errors.New("Kokoro вернул неполный аудиофайл. Попробуй озвучить более короткий фрагмент")
var errKokoroStorage = errors.New("Не удалось сохранить озвучку в профиле приложения")
var errSpeechConfig = errors.New("Не удалось прочитать или сохранить настройки озвучки")

type speechVoice struct {
	ID      string `json:"id"`
	Name    string `json:"name"`
	Culture string `json:"culture"`
}

var kokoroUSVoices = []speechVoice{
	{ID: "af_heart", Name: "Heart", Culture: "en-US"},
	{ID: "af_bella", Name: "Bella", Culture: "en-US"},
	{ID: "am_michael", Name: "Michael", Culture: "en-US"},
	{ID: "am_fenrir", Name: "Fenrir", Culture: "en-US"},
}

type speechSettings struct {
	Voice string `json:"voice"`
}

type speechConfiguration struct {
	Engine    string        `json:"engine"`
	Voice     string        `json:"voice"`
	Culture   string        `json:"culture"`
	Voices    []speechVoice `json:"voices"`
	Available bool          `json:"available"`
}

type kokoroSpeechEngine struct {
	baseURL string
	client  *http.Client
	timeout time.Duration
	slots   chan struct{}
	cacheMu sync.Mutex
}

func newKokoroSpeechEngine(baseURL string) *kokoroSpeechEngine {
	return &kokoroSpeechEngine{
		baseURL: strings.TrimRight(baseURL, "/"),
		client: &http.Client{
			Timeout:       180 * time.Second,
			CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse },
		},
		timeout: 180 * time.Second,
		slots:   make(chan struct{}, 2),
	}
}

var kokoroSpeech = newKokoroSpeechEngine("http://127.0.0.1:8880")

func (s *Server) kokoro() *kokoroSpeechEngine {
	if s.speechBackend != nil {
		return s.speechBackend
	}
	return kokoroSpeech
}

func validUSSpeechVoice(voice string) bool {
	for _, option := range kokoroUSVoices {
		if option.ID == voice {
			return true
		}
	}
	return false
}

func validateKokoroSpeechRequest(b *speechRequest) error {
	if b.Lang == "" {
		b.Lang = "en-US"
	}
	b.Text = strings.TrimSpace(b.Text)
	if b.Text == "" || len(b.Text) > kokoroMaxText || !utf8.ValidString(b.Text) || strings.ContainsRune(b.Text, '\x00') {
		return errors.New("Для озвучки нужен текст до 64 КБ без нулевых символов; длинный текст раздели на фрагменты")
	}
	if b.Lang != "en-US" && b.Lang != "en-GB" {
		return errors.New("Для озвучки выбери язык en-US или en-GB")
	}
	if b.Voice != "" && !validUSSpeechVoice(b.Voice) && !(b.Lang == "en-GB" && b.Voice == "bf_emma") {
		return errors.New("Неизвестный голос озвучки")
	}
	return nil
}

// Read raw JSON before decoding: encoding/json alone replaces malformed UTF-8.
func decodeSpeechJSON(w http.ResponseWriter, r *http.Request, target any) bool {
	raw, err := io.ReadAll(http.MaxBytesReader(w, r.Body, 512<<10))
	if err != nil || !utf8.Valid(raw) {
		problem(w, http.StatusBadRequest, errors.New("Некорректные данные озвучки или слишком большой запрос"))
		return false
	}
	d := json.NewDecoder(bytes.NewReader(raw))
	d.DisallowUnknownFields()
	if err := d.Decode(target); err != nil {
		problem(w, http.StatusBadRequest, errors.New("Некорректные данные озвучки"))
		return false
	}
	if err := d.Decode(new(any)); err != io.EOF {
		problem(w, http.StatusBadRequest, errors.New("Ожидается один JSON-запрос озвучки"))
		return false
	}
	return true
}

func (s *Server) loadSpeechSettings() (speechSettings, error) {
	s.db.mu.Lock()
	defer s.db.mu.Unlock()
	raw, err := readBoundedFile(filepath.Join(s.db.dir, "speech-settings.json"), 4096)
	if errors.Is(err, os.ErrNotExist) {
		return speechSettings{Voice: "af_heart"}, nil
	}
	var config speechSettings
	if err != nil || json.Unmarshal(raw, &config) != nil || !validUSSpeechVoice(config.Voice) {
		return speechSettings{}, errSpeechConfig
	}
	return config, nil
}

func (s *Server) speechConfig(w http.ResponseWriter, r *http.Request) {
	var config speechSettings
	var err error
	if r.Method == http.MethodPost {
		if !decodeSpeechJSON(w, r, &config) {
			return
		}
		if !validUSSpeechVoice(config.Voice) {
			problem(w, http.StatusBadRequest, errors.New("Выбери один из доступных американских голосов"))
			return
		}
		s.db.mu.Lock()
		err = atomicJSON(filepath.Join(s.db.dir, "speech-settings.json"), config)
		s.db.mu.Unlock()
	} else {
		config, err = s.loadSpeechSettings()
	}
	if err != nil {
		problem(w, http.StatusInternalServerError, errSpeechConfig)
		return
	}
	jsonResponse(w, http.StatusOK, speechConfiguration{
		Engine: "kokoro", Voice: config.Voice, Culture: "en-US", Voices: kokoroUSVoices,
		Available: s.kokoro().available(r.Context(), config.Voice),
	})
}

func (e *kokoroSpeechEngine) available(ctx context.Context, voice string) bool {
	ctx, cancel := context.WithTimeout(ctx, 2*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, e.baseURL+"/health", nil)
	if err != nil {
		return false
	}
	resp, err := e.client.Do(req)
	if err != nil {
		return false
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return false
	}
	raw, err := io.ReadAll(io.LimitReader(resp.Body, (16<<10)+1))
	var health struct {
		Status string   `json:"status"`
		Engine string   `json:"engine"`
		Model  string   `json:"model"`
		Voices []string `json:"voices"`
	}
	if err != nil || len(raw) > 16<<10 || json.Unmarshal(raw, &health) != nil || health.Status != "ok" || health.Engine != "kokoro-onnx" || health.Model != "kokoro-v1.0" {
		return false
	}
	for _, found := range health.Voices {
		if found == voice {
			return true
		}
	}
	return false
}

func kokoroSpeechHash(b speechRequest) string {
	h := sha256.Sum256([]byte(kokoroCacheVersion + "\x00" + b.Voice + "\x00" + b.Lang + "\x00" + b.Text))
	return hex.EncodeToString(h[:])
}

func (e *kokoroSpeechEngine) cached(profile, key string, b speechRequest) (speechResult, bool) {
	out, ok := cachedSpeech(profile, key)
	return out, ok && out.Engine == "kokoro" && out.Voice == b.Voice && out.Culture == b.Lang
}

func (e *kokoroSpeechEngine) synthesize(ctx context.Context, profile string, b speechRequest) (speechResult, error) {
	if err := validateKokoroSpeechRequest(&b); err != nil {
		return speechResult{}, err
	}
	if b.Lang == "en-GB" {
		b.Voice = "bf_emma"
	} else if b.Voice == "" {
		b.Voice = "af_heart"
	}
	if err := ctx.Err(); err != nil {
		return speechResult{}, err
	}
	key := kokoroSpeechHash(b)
	e.cacheMu.Lock()
	out, found := e.cached(profile, key, b)
	e.cacheMu.Unlock()
	if found {
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
	body, _ := json.Marshal(struct {
		Input          string `json:"input"`
		Voice          string `json:"voice"`
		Lang           string `json:"lang"`
		Speed          int    `json:"speed"`
		ResponseFormat string `json:"response_format"`
	}{b.Text, b.Voice, strings.ToLower(b.Lang), 1, "wav"})
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, e.baseURL+"/v1/audio/speech", bytes.NewReader(body))
	if err != nil {
		return speechResult{}, errKokoroUnavailable
	}
	req.Header.Set("Content-Type", "application/json")
	resp, err := e.client.Do(req)
	if err != nil {
		if ctx.Err() != nil {
			return speechResult{}, ctx.Err()
		}
		return speechResult{}, errKokoroUnavailable
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		// Never expose service response bodies, request text, or local paths.
		return speechResult{}, fmt.Errorf("Kokoro не смог создать озвучку (HTTP %d). Попробуй более короткий фрагмент", resp.StatusCode)
	}
	if resp.ContentLength > speechMaxWAV {
		return speechResult{}, errKokoroAudio
	}
	wav, err := io.ReadAll(io.LimitReader(resp.Body, speechMaxWAV+1))
	if ctx.Err() != nil {
		return speechResult{}, ctx.Err()
	}
	if err != nil || !validSpeechWAV(wav) {
		return speechResult{}, errKokoroAudio
	}
	e.cacheMu.Lock()
	defer e.cacheMu.Unlock()
	// Identical concurrent requests can finish together. Publish only one complete
	// audio/metadata pair and always read a pair while holding the same lock.
	if out, found := e.cached(profile, key, b); found {
		return out, nil
	}
	cache, media := filepath.Join(profile, "speech-cache"), filepath.Join(profile, "media")
	if os.MkdirAll(cache, 0700) != nil || os.MkdirAll(media, 0700) != nil {
		return speechResult{}, errKokoroStorage
	}
	file, err := os.CreateTemp(media, ".speech-*.tmp")
	if err != nil {
		return speechResult{}, errKokoroStorage
	}
	temp := file.Name()
	defer os.Remove(temp)
	_, writeErr := file.Write(wav)
	syncErr := file.Sync()
	closeErr := file.Close()
	if writeErr != nil || syncErr != nil || closeErr != nil {
		return speechResult{}, errKokoroStorage
	}
	if ctx.Err() != nil {
		return speechResult{}, ctx.Err()
	}
	out = speechResult{Audio: key + ".wav", Voice: b.Voice, Culture: b.Lang, Engine: "kokoro"}
	if err = os.Rename(temp, filepath.Join(media, out.Audio)); err != nil {
		return speechResult{}, errKokoroStorage
	}
	h := sha256.Sum256(wav)
	if err = atomicJSON(filepath.Join(cache, key+".json"), speechCacheRecord{speechResult: out, SourceHash: key, WAVHash: hex.EncodeToString(h[:])}); err != nil {
		return speechResult{}, errKokoroStorage
	}
	return out, nil
}

func (s *Server) speech(w http.ResponseWriter, r *http.Request) {
	var request speechRequest
	if !decodeSpeechJSON(w, r, &request) {
		return
	}
	if err := validateKokoroSpeechRequest(&request); err != nil {
		problem(w, http.StatusBadRequest, err)
		return
	}
	if request.Lang == "en-GB" {
		request.Voice = "bf_emma"
	} else if request.Voice == "" {
		config, err := s.loadSpeechSettings()
		if err != nil {
			problem(w, http.StatusInternalServerError, errSpeechConfig)
			return
		}
		request.Voice = config.Voice
	}
	out, err := s.kokoro().synthesize(r.Context(), s.db.dir, request)
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
	jsonResponse(w, http.StatusOK, out)
}
