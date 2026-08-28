package main

import (
	"encoding/base64"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"sync"
	"testing"
)

type capturedRequest struct {
	Action string
	Raw    []byte
	Params map[string]any
}

type fakeAnki struct {
	mu       sync.Mutex
	requests []capturedRequest
	// respond returns the JSON literal for "result" and the "error" field value.
	respond func(req capturedRequest) (result string, apiErr string)
}

func (f *fakeAnki) ServeHTTP(w http.ResponseWriter, r *http.Request) {
	raw, _ := io.ReadAll(r.Body)
	var parsed struct {
		Action  string         `json:"action"`
		Version int            `json:"version"`
		Params  map[string]any `json:"params"`
	}
	if err := json.Unmarshal(raw, &parsed); err != nil {
		http.Error(w, err.Error(), http.StatusBadRequest)
		return
	}
	if parsed.Version != 6 {
		http.Error(w, "bad version", http.StatusBadRequest)
		return
	}
	req := capturedRequest{Action: parsed.Action, Raw: raw, Params: parsed.Params}
	f.mu.Lock()
	f.requests = append(f.requests, req)
	f.mu.Unlock()

	result, apiErr := "null", ""
	if f.respond != nil {
		result, apiErr = f.respond(req)
	}
	if result == "" {
		result = "null"
	}
	errField := "null"
	if apiErr != "" {
		b, _ := json.Marshal(apiErr)
		errField = string(b)
	}
	w.Header().Set("Content-Type", "application/json")
	io.WriteString(w, `{"result":`+result+`,"error":`+errField+`}`)
}

func (f *fakeAnki) last(t *testing.T) capturedRequest {
	t.Helper()
	f.mu.Lock()
	defer f.mu.Unlock()
	if len(f.requests) == 0 {
		t.Fatal("сервер не получил ни одного запроса")
	}
	return f.requests[len(f.requests)-1]
}

func newFakeAnki(t *testing.T, respond func(capturedRequest) (string, string)) (*ankiClient, *fakeAnki) {
	t.Helper()
	f := &fakeAnki{respond: respond}
	srv := httptest.NewServer(f)
	t.Cleanup(srv.Close)
	return newAnkiClient(Config{AnkiConnectURL: srv.URL}), f
}

func sampleExtraction() Extraction {
	return Extraction{
		Phrase:        "to hit the road",
		TranslationRU: "отправиться в путь",
		ExampleEN:     "We should hit the road before dawn.",
		ExampleRU:     "Нам стоит отправиться в путь до рассвета.",
		ImageQuery:    "empty highway at dawn",
	}
}

func TestAddNoteSuccess(t *testing.T) {
	c, f := newFakeAnki(t, func(r capturedRequest) (string, string) {
		if r.Action != "addNote" {
			t.Errorf("action = %q, want addNote", r.Action)
		}
		return "1496198395707", ""
	})

	id, err := c.AddNote("English", sampleExtraction(), "road.jpg")
	if err != nil {
		t.Fatalf("AddNote: %v", err)
	}
	if id != 1496198395707 {
		t.Errorf("noteID = %d, want 1496198395707", id)
	}

	note := f.last(t).Params["note"].(map[string]any)
	if note["deckName"] != "English" {
		t.Errorf("deckName = %v", note["deckName"])
	}
	if note["modelName"] != "Basic" {
		t.Errorf("modelName = %v", note["modelName"])
	}
	opts := note["options"].(map[string]any)
	if opts["allowDuplicate"] != false || opts["duplicateScope"] != "deck" {
		t.Errorf("options = %v", opts)
	}
	tags := note["tags"].([]any)
	if len(tags) != 1 || tags[0] != "englishd" {
		t.Errorf("tags = %v", tags)
	}
	fields := note["fields"].(map[string]any)
	front := fields["Front"].(string)
	back := fields["Back"].(string)
	// Front must be the phrase alone — Anki's duplicate check hashes the first field.
	if front != "<div>to hit the road</div>" {
		t.Errorf("Front = %q", front)
	}
	if !strings.Contains(back, "отправиться в путь") ||
		!strings.Contains(back, "<i>We should hit the road before dawn.</i>") ||
		!strings.Contains(back, `<img src="road.jpg">`) {
		t.Errorf("Back = %q", back)
	}
	if strings.Contains(front, "<img") {
		t.Errorf("картинка не должна быть на лицевой стороне: %q", front)
	}
}

func TestAddNoteNoMediaHasNoImgTag(t *testing.T) {
	c, f := newFakeAnki(t, func(capturedRequest) (string, string) { return "1", "" })
	if _, err := c.AddNote("English", sampleExtraction(), ""); err != nil {
		t.Fatalf("AddNote: %v", err)
	}
	note := f.last(t).Params["note"].(map[string]any)
	back := note["fields"].(map[string]any)["Back"].(string)
	if strings.Contains(back, "<img") {
		t.Errorf("Back содержит <img> без медиафайла: %q", back)
	}
}

func TestAddNoteDuplicate(t *testing.T) {
	for _, msg := range []string{
		"cannot create note because it is a duplicate",
		"Cannot create note because it is a DUPLICATE",
	} {
		c, _ := newFakeAnki(t, func(capturedRequest) (string, string) { return "null", msg })
		id, err := c.AddNote("English", sampleExtraction(), "")
		if !errors.Is(err, errDuplicate) {
			t.Fatalf("err = %v, want errDuplicate (msg %q)", err, msg)
		}
		if id != 0 {
			t.Errorf("noteID = %d, want 0", id)
		}
	}
}

func TestAddNoteAPIError(t *testing.T) {
	c, _ := newFakeAnki(t, func(capturedRequest) (string, string) {
		return "null", "deck was not found: English"
	})
	_, err := c.AddNote("English", sampleExtraction(), "")
	if err == nil {
		t.Fatal("ожидалась ошибка")
	}
	if errors.Is(err, errDuplicate) || errors.Is(err, errAnkiUnreachable) {
		t.Fatalf("ошибка API не должна быть errDuplicate/errAnkiUnreachable: %v", err)
	}
	if !strings.Contains(err.Error(), "deck was not found") {
		t.Errorf("err = %v, сообщение API потеряно", err)
	}
}

func TestAddNoteNullResultWithoutError(t *testing.T) {
	c, _ := newFakeAnki(t, func(capturedRequest) (string, string) { return "null", "" })
	if _, err := c.AddNote("English", sampleExtraction(), ""); err == nil {
		t.Fatal("null result без error должен быть ошибкой")
	}
}

func TestDeadServerIsUnreachable(t *testing.T) {
	srv := httptest.NewServer(&fakeAnki{})
	url := srv.URL
	srv.Close() // порт закрыт: connection refused

	c := newAnkiClient(Config{AnkiConnectURL: url})
	if err := c.Ping(); !errors.Is(err, errAnkiUnreachable) {
		t.Errorf("Ping err = %v, want errAnkiUnreachable", err)
	}
	if _, err := c.AddNote("English", sampleExtraction(), ""); !errors.Is(err, errAnkiUnreachable) {
		t.Errorf("AddNote err = %v, want errAnkiUnreachable", err)
	}
	if _, err := c.StoreMedia("a.jpg", []byte("x")); !errors.Is(err, errAnkiUnreachable) {
		t.Errorf("StoreMedia err = %v, want errAnkiUnreachable", err)
	}
	if err := c.EnsureDeck("English"); !errors.Is(err, errAnkiUnreachable) {
		t.Errorf("EnsureDeck err = %v, want errAnkiUnreachable", err)
	}
	if err := c.DeleteNote(1); !errors.Is(err, errAnkiUnreachable) {
		t.Errorf("DeleteNote err = %v, want errAnkiUnreachable", err)
	}
}

func TestStoreMediaBase64RoundTrip(t *testing.T) {
	payload := []byte{0x00, 0xff, 0x10, 'j', 'p', 'g', 0x7f, 0x80}
	c, f := newFakeAnki(t, func(r capturedRequest) (string, string) {
		if r.Action != "storeMediaFile" {
			t.Errorf("action = %q", r.Action)
		}
		return `""`, ""
	})

	name, err := c.StoreMedia("road.jpg", payload)
	if err != nil {
		t.Fatalf("StoreMedia: %v", err)
	}
	if name != "road.jpg" {
		t.Errorf("name = %q, пустой result должен давать исходное имя", name)
	}

	req := f.last(t)
	if req.Params["filename"] != "road.jpg" {
		t.Errorf("filename = %v", req.Params["filename"])
	}
	got, err := base64.StdEncoding.DecodeString(req.Params["data"].(string))
	if err != nil {
		t.Fatalf("сервер получил не base64: %v", err)
	}
	if string(got) != string(payload) {
		t.Errorf("data = %v, want %v", got, payload)
	}
}

func TestStoreMediaRenamedByAnki(t *testing.T) {
	c, _ := newFakeAnki(t, func(capturedRequest) (string, string) { return `"road_1.jpg"`, "" })
	name, err := c.StoreMedia("road.jpg", []byte("data"))
	if err != nil {
		t.Fatalf("StoreMedia: %v", err)
	}
	if name != "road_1.jpg" {
		t.Errorf("name = %q, want road_1.jpg", name)
	}
}

func TestHTMLEscapingInFields(t *testing.T) {
	e := Extraction{
		Phrase:        `<b>a & b</b>`,
		TranslationRU: `"кавычки" & <тег>`,
		ExampleEN:     `if x < y && y > z`,
		ExampleRU:     `если x < y`,
	}
	c, f := newFakeAnki(t, func(capturedRequest) (string, string) { return "42", "" })
	if _, err := c.AddNote("English", e, `pic<1>.jpg`); err != nil {
		t.Fatalf("AddNote: %v", err)
	}

	req := f.last(t)
	body := string(req.Raw)
	// В теле запроса лежит уже HTML-экранированный текст; encoding/json поверх
	// этого прячет < > & в \uXXXX, поэтому искомое прогоняем через json.Marshal.
	for _, want := range []string{"&lt;b&gt;a &amp; b&lt;/b&gt;", "if x &lt; y &amp;&amp; y &gt; z"} {
		enc, err := json.Marshal(want)
		if err != nil {
			t.Fatal(err)
		}
		needle := strings.Trim(string(enc), `"`)
		if !strings.Contains(body, needle) {
			t.Errorf("тело запроса не содержит %q (как %q):\n%s", want, needle, body)
		}
	}
	fields := req.Params["note"].(map[string]any)["fields"].(map[string]any)
	front := fields["Front"].(string)
	back := fields["Back"].(string)
	if strings.Contains(front, "<b>") {
		t.Errorf("сырой тег протёк во Front: %q", front)
	}
	if !strings.Contains(back, "&#34;кавычки&#34;") || !strings.Contains(back, "&lt;тег&gt;") {
		t.Errorf("Back не экранирован: %q", back)
	}
	if !strings.Contains(back, `<img src="pic&lt;1&gt;.jpg">`) {
		t.Errorf("имя медиафайла не экранировано: %q", back)
	}
}

func TestPingEnsureDeckDeleteNote(t *testing.T) {
	c, f := newFakeAnki(t, func(r capturedRequest) (string, string) {
		switch r.Action {
		case "version":
			return "6", ""
		case "createDeck":
			return "1234567890", ""
		case "deleteNotes":
			return "null", ""
		}
		return "null", "unexpected action " + r.Action
	})

	if err := c.Ping(); err != nil {
		t.Fatalf("Ping: %v", err)
	}
	if err := c.EnsureDeck("English"); err != nil {
		t.Fatalf("EnsureDeck: %v", err)
	}
	if got := f.last(t).Params["deck"]; got != "English" {
		t.Errorf("deck = %v", got)
	}
	if err := c.DeleteNote(1496198395707); err != nil {
		t.Fatalf("DeleteNote: %v", err)
	}
	notes := f.last(t).Params["notes"].([]any)
	if len(notes) != 1 || notes[0].(float64) != 1496198395707 {
		t.Errorf("notes = %v", notes)
	}
}

func TestEnsureDeckAlreadyExists(t *testing.T) {
	// AnkiConnect идемпотентен: повторный createDeck возвращает id без error.
	c, _ := newFakeAnki(t, func(capturedRequest) (string, string) { return "1234567890", "" })
	for i := 0; i < 2; i++ {
		if err := c.EnsureDeck("English"); err != nil {
			t.Fatalf("EnsureDeck #%d: %v", i, err)
		}
	}
}
