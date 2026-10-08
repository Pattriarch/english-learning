package studio

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"io"
	"math"
	"mime/multipart"
	"net/http"
	"net/url"
	"strings"
	"time"
	"unicode"
)

// A missing probability stays null: text-only ASR is not a confidence of 100%.
type transcriptWord struct {
	Word        string   `json:"word"`
	Start       *float64 `json:"start"`
	End         *float64 `json:"end"`
	Probability *float64 `json:"probability"`
}

type transcriptResult struct {
	Text                string           `json:"text"`
	Words               []transcriptWord `json:"words"`
	ConfidenceAvailable bool             `json:"confidenceAvailable"`
}

func whisperEndpoint(raw string) (*url.URL, error) {
	u, err := endpoint(strings.TrimSpace(raw))
	if err != nil {
		return nil, err
	}
	if u.Path == "" || u.Path == "/" {
		u.Path = "/inference"
	}
	return u, nil
}

func whisperClient(timeout time.Duration) *http.Client {
	return &http.Client{Timeout: timeout, CheckRedirect: func(*http.Request, []*http.Request) error { return http.ErrUseLastResponse }}
}

func (s *Server) checkWhisper(w http.ResponseWriter, r *http.Request) {
	var input struct {
		URL string `json:"url"`
	}
	if !decode(w, r, &input) {
		return
	}
	u, err := whisperEndpoint(input.URL)
	if err != nil {
		problem(w, 400, err)
		return
	}
	// Preserve an optional reverse-proxy prefix; never run inference for a ping.
	if strings.HasSuffix(u.Path, "/v1/audio/transcriptions") {
		u.Path = strings.TrimSuffix(u.Path, "/v1/audio/transcriptions") + "/health"
	} else {
		u.Path = strings.TrimSuffix(u.Path, "/inference") + "/health"
	}
	ctx, cancel := context.WithTimeout(r.Context(), 3*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, u.String(), nil)
	if err != nil {
		problem(w, 400, err)
		return
	}
	res, err := whisperClient(3 * time.Second).Do(req)
	if err != nil {
		problem(w, 502, errors.New("Whisper недоступен. Запусти локальный сервер и проверь адрес"))
		return
	}
	defer res.Body.Close()
	raw, err := io.ReadAll(io.LimitReader(res.Body, 16385))
	var health struct {
		Status string `json:"status"`
	}
	if err != nil || len(raw) > 16384 || res.StatusCode != 200 || json.Unmarshal(raw, &health) != nil || (health.Status != "ok" && health.Status != "ready") {
		problem(w, 502, errors.New("Whisper ещё не готов или адрес ведёт к другому сервису. Дождись загрузки модели и проверь /health"))
		return
	}
	jsonResponse(w, 200, map[string]string{"status": "ok", "message": "Whisper доступен. Можно записывать речь"})
}

func (s *Server) transcribe(w http.ResponseWriter, r *http.Request) {
	u, err := whisperEndpoint(s.db.config().WhisperURL)
	if err != nil {
		problem(w, 400, errors.New("Укажи адрес локального Whisper в настройках"))
		return
	}
	r.Body = http.MaxBytesReader(w, r.Body, 22<<20)
	if err = r.ParseMultipartForm(22 << 20); err != nil {
		problem(w, 400, errors.New("Запись слишком большая: максимум 22 МБ"))
		return
	}
	defer r.MultipartForm.RemoveAll()
	f, _, err := r.FormFile("file")
	if err != nil {
		problem(w, 400, errors.New("Нет аудиозаписи"))
		return
	}
	defer f.Close()
	var buf bytes.Buffer
	mw := multipart.NewWriter(&buf)
	part, err := mw.CreateFormFile("file", "speech.wav")
	if err == nil {
		_, err = io.Copy(part, f)
	}
	if err == nil {
		err = mw.WriteField("language", "en")
	}
	if err == nil {
		err = mw.WriteField("response_format", "verbose_json")
	}
	// whisper.cpp returns token probabilities in verbose_json. Request token
	// timing and join subword pieces below. Do not prompt it with the answer.
	if err == nil && strings.HasSuffix(u.Path, "/inference") {
		for key, value := range map[string]string{"token_timestamps": "true", "temperature": "0.0", "temperature_inc": "0.0", "no_context": "true"} {
			if err = mw.WriteField(key, value); err != nil {
				break
			}
		}
	}
	if err == nil && strings.HasSuffix(u.Path, "/v1/audio/transcriptions") {
		err = mw.WriteField("timestamp_granularities[]", "word")
	}
	if closeErr := mw.Close(); err == nil {
		err = closeErr
	}
	if err != nil {
		problem(w, 400, errors.New("Не удалось прочитать запись"))
		return
	}
	req, err := http.NewRequestWithContext(r.Context(), http.MethodPost, u.String(), &buf)
	if err != nil {
		problem(w, 400, err)
		return
	}
	req.Header.Set("Content-Type", mw.FormDataContentType())
	res, err := whisperClient(2 * time.Minute).Do(req)
	if err != nil {
		problem(w, 502, errors.New("Whisper недоступен. Проверь подключение в настройках"))
		return
	}
	defer res.Body.Close()
	if res.StatusCode != 200 {
		problem(w, 502, serviceError("Whisper", res.StatusCode))
		return
	}
	raw, err := io.ReadAll(io.LimitReader(res.Body, (4<<20)+1))
	if err != nil || len(raw) > 4<<20 {
		problem(w, 502, errors.New("Whisper вернул слишком большой или неполный ответ"))
		return
	}
	result, err := parseTranscript(raw, strings.HasSuffix(u.Path, "/inference"))
	if err != nil {
		problem(w, 422, err)
		return
	}
	jsonResponse(w, 200, result)
}

func validASRNumber(p *float64, probability bool) *float64 {
	if p == nil || math.IsNaN(*p) || math.IsInf(*p, 0) || *p < 0 || (probability && *p > 1) {
		return nil
	}
	return p
}

func parseTranscript(raw []byte, tokens bool) (transcriptResult, error) {
	var response struct {
		Text     string           `json:"text"`
		Words    []transcriptWord `json:"words"`
		Segments []struct {
			Text  string           `json:"text"`
			Words []transcriptWord `json:"words"`
		} `json:"segments"`
	}
	if json.Unmarshal(raw, &response) != nil {
		return transcriptResult{}, errors.New("Whisper вернул неожиданный ответ")
	}
	result := transcriptResult{Text: strings.TrimSpace(response.Text), Words: []transcriptWord{}}
	pieces := response.Words
	if len(pieces) == 0 {
		for _, segment := range response.Segments {
			pieces = append(pieces, segment.Words...)
			if response.Text == "" {
				result.Text += segment.Text
			}
		}
	}
	result.Text = strings.TrimSpace(result.Text)
	for _, piece := range pieces {
		if strings.HasPrefix(strings.TrimSpace(piece.Word), "[_") || strings.HasPrefix(strings.TrimSpace(piece.Word), "<|") {
			continue
		}
		piece.Start = validASRNumber(piece.Start, false)
		piece.End = validASRNumber(piece.End, false)
		piece.Probability = validASRNumber(piece.Probability, true)
		lexical := strings.ContainsFunc(piece.Word, func(c rune) bool { return unicode.IsLetter(c) || unicode.IsDigit(c) })
		if !lexical {
			// Punctuation confidence says nothing about pronunciation. Keep the
			// punctuation in the transcript, but exclude it from word confidence.
			piece.Probability = nil
		}
		if piece.Start != nil && piece.End != nil && *piece.End < *piece.Start {
			piece.Start = nil
			piece.End = nil
		}
		// A leading space starts a new whisper.cpp word. Punctuation and
		// continuation tokens belong to the previous word, including apostrophes.
		newWord := len(result.Words) == 0 || !tokens || (len(piece.Word) > 0 && unicode.IsSpace([]rune(piece.Word)[0]))
		if newWord {
			piece.Word = strings.TrimSpace(piece.Word)
			if piece.Word != "" {
				result.Words = append(result.Words, piece)
			}
		} else {
			last := &result.Words[len(result.Words)-1]
			last.Word += piece.Word
			if lexical && piece.End != nil {
				last.End = piece.End
			}
			if piece.Probability != nil && (last.Probability == nil || *piece.Probability < *last.Probability) {
				last.Probability = piece.Probability
			}
		}
	}
	for _, word := range result.Words {
		if word.Probability != nil {
			result.ConfidenceAvailable = true
			break
		}
	}
	if result.Text == "" {
		return transcriptResult{}, errors.New("Речь не распознана. Подойди ближе к микрофону и повтори")
	}
	return result, nil
}
