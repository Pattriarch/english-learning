package studio

import (
	"bytes"
	"encoding/json"
	"mime/multipart"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestNotebookTranslationPreservesInputAndUsesAmericanCoach(t *testing.T) {
	s := testServer(t)
	answer := notebookTranslation{English: "I haven't figured it out yet.", Explanation: "Yet показывает, что результат пока не достигнут.", Phrases: []notebookPhrase{{English: "figured it out", Russian: "разобрался"}}, Practice: "Расскажи, с какой другой задачей ты пока не разобрался."}
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var req struct {
			Messages []struct{ Role, Content string }
		}
		if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.Messages) != 2 {
			t.Error("invalid model request")
		}
		if !strings.Contains(req.Messages[0].Content, "American English") || !strings.Contains(req.Messages[0].Content, "Never add promises") || !strings.Contains(req.Messages[1].Content, "Я пока не разобрался") {
			t.Error("lost source or coaching constraints")
		}
		raw, _ := json.Marshal(answer)
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": string(raw)}}}})
	}))
	defer provider.Close()
	s.db.settings.Provider, s.db.settings.Endpoint, s.db.settings.Model = "openai", provider.URL, "test"
	w := call(t, s, "POST", "/api/notebook/translate", map[string]string{"russian": "Я пока не разобрался", "context": "Сообщение коллеге", "register": "work"})
	if w.Code != 200 || !strings.Contains(w.Body.String(), "figured it out") {
		t.Fatalf("translation failed: %d %s", w.Code, w.Body.String())
	}
	if len(s.db.snapshot().Attempts) != 0 || len(s.db.snapshot().Cards) != 0 {
		t.Fatal("viewing a translation must not claim practice or add a card")
	}
}

func TestNotebookRejectsIncompleteOrUnrelatedModelPhrases(t *testing.T) {
	good := notebookTranslation{English: "I'll look into it.", Explanation: "Look into означает изучить проблему.", Phrases: []notebookPhrase{{English: "look into", Russian: "разобраться"}}, Practice: "Обещай изучить другой вопрос."}
	if err := validateNotebookTranslation(good); err != nil {
		t.Fatal(err)
	}
	bad := good
	bad.Phrases = []notebookPhrase{{English: "make up", Russian: "выдумать"}}
	if validateNotebookTranslation(bad) == nil {
		t.Fatal("unrelated teaching phrase accepted")
	}
	bad = good
	bad.English = " "
	if validateNotebookTranslation(bad) == nil {
		t.Fatal("empty translation accepted")
	}
	s := testServer(t)
	for _, body := range []map[string]string{{"russian": "", "register": "neutral"}, {"russian": "Мысль", "register": "<script>"}, {"russian": strings.Repeat("Я", 4000), "register": "work"}} {
		if w := call(t, s, "POST", "/api/notebook/translate", body); w.Code != 400 {
			t.Fatalf("invalid input reached provider: %d", w.Code)
		}
	}
}

func TestNotebookAudioIsLocalContentAddressedAndRejectsHTML(t *testing.T) {
	s := testServer(t)
	var wav bytes.Buffer
	wav.WriteString("RIFF")
	wav.Write([]byte{36, 0, 0, 0})
	wav.WriteString("WAVEfmt ")
	wav.Write(make([]byte, 64))
	for _, tc := range []struct {
		data []byte
		want int
	}{{wav.Bytes(), 200}, {[]byte("<!doctype html><script>alert('not audio')</script>"), 400}, {[]byte("RIFF"), 400}} {
		var body bytes.Buffer
		form := multipart.NewWriter(&body)
		part, _ := form.CreateFormFile("file", "../../outside.html")
		_, _ = part.Write(tc.data)
		_ = form.Close()
		r := httptest.NewRequest("POST", "http://127.0.0.1:8777/api/notebook/audio", &body)
		r.Header.Set("Content-Type", form.FormDataContentType())
		w := httptest.NewRecorder()
		s.Handler().ServeHTTP(w, r)
		if w.Code != tc.want {
			t.Fatalf("audio status %d: %s", w.Code, w.Body.String())
		}
		if tc.want == 200 {
			var out map[string]string
			_ = json.Unmarshal(w.Body.Bytes(), &out)
			if len(out["audio"]) != 68 || !strings.HasSuffix(out["audio"], ".wav") {
				t.Fatal("untrusted upload name leaked")
			}
			got, err := os.ReadFile(filepath.Join(s.db.dir, "media", out["audio"]))
			if err != nil || !bytes.Equal(got, tc.data) {
				t.Fatal("recording not preserved")
			}
		}
	}
}

func TestNotebookTranslationEnvelopeFitsProgressDraftWithoutTruncation(t *testing.T) {
	v := notebookTranslation{English: "Thanks " + strings.Repeat("a", 7993), Explanation: strings.Repeat("я", 2200), Phrases: []notebookPhrase{{English: "Thanks", Russian: "Благодарность"}}, Practice: "Используй фразу в другой ситуации."}
	if err := validateNotebookTranslation(v); err != nil {
		t.Fatal(err)
	}
	raw, _ := json.Marshal(v)
	if len(raw) > notebookTranslationBytes {
		t.Fatal("response exceeded accepted wire budget")
	}
	var envelope map[string]any
	if err := json.Unmarshal(raw, &envelope); err != nil {
		t.Fatal(err)
	}
	envelope["source"], envelope["version"], envelope["at"] = "sha256:"+strings.Repeat("a", 64), 1, "2026-09-10T12:00:00.000Z"
	saved, err := json.Marshal(envelope)
	if err != nil || len(saved) > 19500 {
		t.Fatalf("valid complete output cannot fit progress: %d %v", len(saved), err)
	}
	if envelope["english"] != v.English || envelope["explanation"] != v.Explanation {
		t.Fatal("content was silently truncated")
	}
	v.Explanation = strings.Repeat("я", 3000)
	if validateNotebookTranslation(v) == nil {
		t.Fatal("over-budget output should explicitly fail, not be shortened")
	}
}
