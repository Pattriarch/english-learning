package main

import (
	"bytes"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"net/http"
	"strings"
	"time"
)

type ankiClient struct {
	url  string
	http *http.Client
}

func newAnkiClient(cfg Config) *ankiClient {
	return &ankiClient{
		url:  cfg.AnkiConnectURL,
		http: &http.Client{Timeout: 15 * time.Second},
	}
}

type ankiRequest struct {
	Action  string `json:"action"`
	Version int    `json:"version"`
	Params  any    `json:"params,omitempty"`
}

type ankiResponse struct {
	Result json.RawMessage `json:"result"`
	Error  *string         `json:"error"`
}

// ankiAPIError is a non-nil "error" field in an otherwise HTTP-200 response:
// a rejection by Anki, not a transport failure.
type ankiAPIError struct {
	Action  string
	Message string
}

func (e *ankiAPIError) Error() string {
	return "AnkiConnect " + e.Action + ": " + e.Message
}

// call performs one AnkiConnect action. result may be nil; a null API result is
// left untouched so callers decide whether it is legal.
func (c *ankiClient) call(action string, params any, result any) error {
	body, err := json.Marshal(ankiRequest{Action: action, Version: 6, Params: params})
	if err != nil {
		return fmt.Errorf("AnkiConnect %s: %w", action, err)
	}
	resp, err := c.http.Post(c.url, "application/json", bytes.NewReader(body))
	if err != nil {
		return fmt.Errorf("%w: %v", errAnkiUnreachable, err)
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return fmt.Errorf("AnkiConnect %s: HTTP %d", action, resp.StatusCode)
	}
	var r ankiResponse
	if err := json.NewDecoder(resp.Body).Decode(&r); err != nil {
		return fmt.Errorf("AnkiConnect %s: не разобрать ответ: %w", action, err)
	}
	if r.Error != nil && *r.Error != "" {
		return &ankiAPIError{Action: action, Message: *r.Error}
	}
	if result == nil || len(r.Result) == 0 || bytes.Equal(r.Result, []byte("null")) {
		return nil
	}
	if err := json.Unmarshal(r.Result, result); err != nil {
		return fmt.Errorf("AnkiConnect %s: не разобрать result: %w", action, err)
	}
	return nil
}

func (c *ankiClient) Ping() error {
	var version int
	return c.call("version", nil, &version)
}

func (c *ankiClient) EnsureDeck(deck string) error {
	return c.call("createDeck", map[string]any{"deck": deck}, nil)
}

func (c *ankiClient) StoreMedia(filename string, data []byte) (string, error) {
	params := map[string]any{
		"filename": filename,
		"data":     base64.StdEncoding.EncodeToString(data),
	}
	var stored string
	if err := c.call("storeMediaFile", params, &stored); err != nil {
		return "", err
	}
	if stored == "" {
		return filename, nil
	}
	return stored, nil
}

func (c *ankiClient) AddNote(deck string, e Extraction, mediaFile string) (int64, error) {
	params := map[string]any{
		"note": map[string]any{
			"deckName":  deck,
			"modelName": "Basic",
			"fields": map[string]any{
				"Front": frontHTML(e),
				"Back":  backHTML(e, mediaFile),
			},
			"options": map[string]any{
				"allowDuplicate": false,
				"duplicateScope": "deck",
			},
			"tags": []string{"englishd"},
		},
	}
	var raw json.RawMessage
	if err := c.call("addNote", params, &raw); err != nil {
		var apiErr *ankiAPIError
		if errors.As(err, &apiErr) && strings.Contains(strings.ToLower(apiErr.Message), "duplicate") {
			return 0, errDuplicate
		}
		return 0, err
	}
	if len(raw) == 0 || bytes.Equal(raw, []byte("null")) {
		return 0, errors.New("AnkiConnect addNote: не вернул id заметки")
	}
	var id int64
	if err := json.Unmarshal(raw, &id); err != nil {
		return 0, fmt.Errorf("AnkiConnect addNote: некорректный id заметки: %w", err)
	}
	return id, nil
}

func (c *ankiClient) DeleteNote(noteID int64) error {
	return c.call("deleteNotes", map[string]any{"notes": []int64{noteID}}, nil)
}

// Front holds the phrase alone: Anki checksums the first field to detect
// duplicates, and the generated example differs on every run, so anything
// else here would defeat that check.
func frontHTML(e Extraction) string {
	return "<div>" + html.EscapeString(e.Phrase) + "</div>"
}

func backHTML(e Extraction, mediaFile string) string {
	var b strings.Builder
	b.WriteString("<div>")
	b.WriteString(html.EscapeString(e.TranslationRU))
	b.WriteString("</div>")
	if e.ExampleEN != "" {
		b.WriteString("<div><i>")
		b.WriteString(html.EscapeString(e.ExampleEN))
		b.WriteString("</i></div>")
	}
	if e.ExampleRU != "" {
		b.WriteString("<div><i>")
		b.WriteString(html.EscapeString(e.ExampleRU))
		b.WriteString("</i></div>")
	}
	if mediaFile != "" {
		b.WriteString(`<div><img src="`)
		b.WriteString(html.EscapeString(mediaFile))
		b.WriteString(`"></div>`)
	}
	return b.String()
}

var _ AnkiClient = (*ankiClient)(nil)
