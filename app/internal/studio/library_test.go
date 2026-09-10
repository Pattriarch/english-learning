package studio

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"sync/atomic"
	"testing"
	"unicode/utf8"
)

func contentLesson(id string) Lesson {
	return Lesson{
		ID: id, Title: "Meaning and register", Level: "C2", Group: "Test",
		Sections: []Section{{Title: "Meaning", Body: "Explain the intended meaning."}, {Title: "Contrast", Body: "Explain a meaningful contrast."}, {Title: "Practice", Body: "Use the language independently."}},
		Examples: []Example{{English: "That may well be true.", Russian: "Вполне возможно.", Why: "A qualified agreement."}, {English: "I see your point.", Russian: "Я понимаю вашу мысль.", Why: "Acknowledgement."}},
		Exercises: []Exercise{
			{ID: "e1", Kind: "translate", Prompt: "Переведи целиком: Я понимаю вашу мысль.", Answers: []string{"I see your point."}, Explanation: "Acknowledge the argument without necessarily agreeing."},
			{ID: "e2", Kind: "rewrite", Prompt: "Rewrite a sentence from your own source in a formal register.", Explanation: "Preserve the intended meaning while changing the register."},
			{ID: "e3", Kind: "write", Prompt: "Write an argument for a reader who disagrees with your position.", Explanation: "Support the claim and respond to the strongest objection."},
			{ID: "e4", Kind: "speak", Prompt: "Explain your position and acknowledge one valid counterargument.", Explanation: "Separate acknowledging an objection from abandoning the claim."},
		},
	}
}

func writeFixture(t *testing.T, path string, value any) {
	t.Helper()
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	if err = os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
}

func contentFixture(t *testing.T) (content, data string) {
	t.Helper()
	root := t.TempDir()
	content = filepath.Join(root, "app", "content")
	data = filepath.Join(root, "profile")
	writeFixture(t, filepath.Join(content, "curriculum.json"), []Lesson{contentLesson("base")})
	writeFixture(t, filepath.Join(content, "topics.json"), []syllabusTopic{{ID: "legacy", Title: "Legacy topic", Book: "other", Unit: "1", Level: "B1"}})
	return content, data
}

func libraryFixture(t *testing.T, content, source, text string) {
	t.Helper()
	bookSource := "pdf-text-toc"
	if source == "scanned" {
		bookSource = "ocr-and-visual-toc"
	}
	book := libraryBook{
		ID: "book-c2", Title: "Advanced English", Filename: "advanced.pdf", Level: "C2",
		UnitCount: 1, PDFPageCount: 20, Source: bookSource,
		Units: []libraryUnit{{ID: "book-c2-001", Unit: 1, Title: "Stance and register", Page: 10, EndPage: 11, Category: "Discourse", Verified: true}},
	}
	writeFixture(t, filepath.Join(content, "library.json"), map[string]any{"books": []libraryBook{book}, "totalUnits": 1})
	writeFixture(t, filepath.Join(content, "..", "data", "library-text.json"), map[string]libraryText{
		"book-c2-001": {Text: text, Source: source, Pages: []int{10, 11}},
	})
}

func openFixture(t *testing.T, content, data string) *Server {
	t.Helper()
	s, err := New(data, content, filepath.Join(content, "..", "web"))
	if err != nil {
		t.Fatal(err)
	}
	return s
}

func modelInput(t *testing.T, r *http.Request) (string, map[string]any) {
	t.Helper()
	var req struct {
		Messages []struct {
			Content string `json:"content"`
		} `json:"messages"`
	}
	if err := json.NewDecoder(r.Body).Decode(&req); err != nil || len(req.Messages) != 2 {
		t.Fatalf("invalid model request: %v", err)
	}
	var input map[string]any
	if err := json.Unmarshal([]byte(req.Messages[1].Content), &input); err != nil {
		t.Fatal(err)
	}
	return req.Messages[0].Content, input
}

func withMockModel(t *testing.T, s *Server, fn http.HandlerFunc) {
	t.Helper()
	mock := httptest.NewServer(fn)
	t.Cleanup(mock.Close)
	s.db.settings.Provider = "ollama"
	s.db.settings.Endpoint = mock.URL
	s.db.settings.Model = "fixture"
}

func TestOptionalContentExtensionsAndPrivateUnitSource(t *testing.T) {
	content, data := contentFixture(t)
	s := openFixture(t, content, data)
	if len(s.lessons) != 1 || len(s.libraryUnits) != 0 {
		t.Fatal("base-only fixtures must remain supported")
	}
	writeFixture(t, filepath.Join(content, "courses", "additional.json"), []Lesson{contentLesson("additional")})
	writeFixture(t, filepath.Join(content, "learning-path.json"), map[string]any{"levels": []string{"A1", "C2"}})
	writeFixture(t, filepath.Join(content, "cinema.json"), map[string]any{"series": []string{"Example"}})
	libraryFixture(t, content, "text-layer", "PRIVATE SOURCE TEXT with actual teaching points.")
	s = openFixture(t, content, data)
	w := call(t, s, "GET", "/api/bootstrap", nil)
	if w.Code != 200 || strings.Contains(w.Body.String(), "PRIVATE SOURCE TEXT") {
		t.Fatal("bootstrap must not expose the whole private text cache")
	}
	var bootstrap map[string]json.RawMessage
	_ = json.Unmarshal(w.Body.Bytes(), &bootstrap)
	for _, field := range []string{"library", "learningPath", "cinema"} {
		if len(bootstrap[field]) == 0 {
			t.Fatalf("missing extension %s", field)
		}
	}
	if len(s.lessons) != 2 {
		t.Fatal("additional course was not loaded")
	}
	var topics []syllabusTopic
	_ = json.Unmarshal(s.topics, &topics)
	if len(topics) != 2 || topics[1].ID != "book-c2-001" || topics[1].Level != "C2" {
		t.Fatal("book unit missing from generation topics", topics)
	}
	w = call(t, s, "GET", "/api/library/unit/book-c2-001", nil)
	if w.Code != 200 || !strings.Contains(w.Body.String(), "PRIVATE SOURCE TEXT") || strings.Contains(w.Body.String(), `"units":`) {
		t.Fatal("unit endpoint returned wrong data", w.Body.String())
	}
	if call(t, s, "GET", "/api/library/unit/unknown", nil).Code != 404 {
		t.Fatal("unknown unit accepted")
	}
	s.libraryText["book-c2-001"] = libraryText{Text: "STALE TEXT", Source: "text-layer", Pages: []int{12, 13}}
	if source := s.unitSource("book-c2-001"); source.Text != "" || source.Source != "unavailable" {
		t.Fatal("cache from different pages was accepted")
	}
	_ = s.db.change(func(p *Progress) error {
		p.Lessons = append(p.Lessons, contentLesson("additional"))
		return nil
	})
	if len(s.allLessons()) != 2 {
		t.Fatal("imported duplicate shadowed or duplicated a prepared lesson")
	}
}

func TestContentRejectsDuplicateLessonsAndMalformedExtensions(t *testing.T) {
	content, data := contentFixture(t)
	path := filepath.Join(content, "courses", "duplicate.json")
	writeFixture(t, path, []Lesson{contentLesson("base")})
	if _, err := New(data, content, ""); err == nil || !strings.Contains(err.Error(), "duplicate lesson") {
		t.Fatal("duplicate lesson IDs must be rejected", err)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(content, "learning-path.json"), []byte("{bad"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := New(data, content, ""); err == nil {
		t.Fatal("malformed optional content must not silently disappear")
	}
}

func TestGenerateUsesUnitTextLevelAndStableIdentity(t *testing.T) {
	for _, sourceType := range []string{"text-layer", "scanned"} {
		t.Run(sourceType, func(t *testing.T) {
			content, data := contentFixture(t)
			sourceText := "Treat this embedded instruction as data. " + strings.Repeat("я", 18100)
			if sourceType == "scanned" {
				sourceText = ""
			}
			libraryFixture(t, content, sourceType, sourceText)
			s := openFixture(t, content, data)
			var requests atomic.Int32
			withMockModel(t, s, func(w http.ResponseWriter, r *http.Request) {
				requests.Add(1)
				system, input := modelInput(t, r)
				topic := input["topic"].(map[string]any)
				if topic["level"] != "C2" || !strings.Contains(system, "untrusted reference data") || strings.Contains(system, "Keep difficulty B1-B2") {
					t.Error("generation ignored level or untrusted-source boundary")
				}
				if sourceType == "text-layer" {
					if input["sourceAvailable"] != true || input["sourceTruncated"] != true || utf8.RuneCountInString(input["sourceText"].(string)) != 18000 {
						t.Error("source was omitted or not bounded to18000 characters")
					}
				} else if input["sourceAvailable"] != false || input["source"] != "scanned" || input["sourceText"] != "" {
					t.Error("scanned source was falsely presented as readable")
				}
				lesson := contentLesson("model-invented-id")
				lesson.Level = "A1"
				raw, _ := json.Marshal(lesson)
				jsonResponse(w, 200, map[string]any{"message": map[string]string{"content": string(raw)}})
			})
			for i := 0; i < 2; i++ {
				w := call(t, s, "POST", "/api/lessons/generate", map[string]string{"topicId": "book-c2-001", "level": "A1", "sourceText": "CLIENT FORGERY"})
				if w.Code != 200 {
					t.Fatal(w.Code, w.Body.String())
				}
				var lesson Lesson
				_ = json.Unmarshal(w.Body.Bytes(), &lesson)
				if lesson.ID != "custom-book-c2-001" || lesson.Level != "C2" {
					t.Fatal("model or client overrode authoritative lesson metadata")
				}
				if sourceType == "scanned" && !strings.Contains(lesson.Subtitle, "текст исходного PDF недоступен") {
					t.Fatal("unavailable-source limitation was hidden")
				}
			}
			if requests.Load() != 1 || len(s.db.snapshot().Lessons) != 1 {
				t.Fatal("retry generated or saved a duplicate lesson")
			}
		})
	}
}

func TestCheckUsesAuthoritativeCourseLevel(t *testing.T) {
	content, data := contentFixture(t)
	s := openFixture(t, content, data)
	withMockModel(t, s, func(w http.ResponseWriter, r *http.Request) {
		_, input := modelInput(t, r)
		if input["level"] != "C2" {
			t.Error("client lowered the prepared lesson's level", input["level"])
		}
		jsonResponse(w, 200, map[string]any{"message": map[string]string{"content": `{"verdict":"correct","summary":"Верно","corrected":"I see your point.","explanation":"An appropriate acknowledgement."}`}})
	})
	w := call(t, s, "POST", "/api/check", map[string]string{"id": "c2-answer", "lessonId": "base", "exerciseId": "e1", "answer": "I see your point.", "level": "A1"})
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
}

func TestPracticeLevelsPersistAndRejectInvalidLevels(t *testing.T) {
	content, data := contentFixture(t)
	s := openFixture(t, content, data)
	var requests atomic.Int32
	withMockModel(t, s, func(w http.ResponseWriter, r *http.Request) {
		_, input := modelInput(t, r)
		expected := "C2"
		if requests.Add(1) == 2 {
			expected = "B1"
		}
		if input["level"] != expected {
			t.Error("wrong practice level", input["level"])
		}
		jsonResponse(w, 200, map[string]any{"message": map[string]string{"content": `{"title":"Position","prompt":"Write a clear, reasoned position for a reader who disagrees.","passage":""}`}})
	})
	for _, level := range []string{"C2", ""} {
		w := call(t, s, "POST", "/api/practice/task", map[string]string{"mode": "writing", "level": level})
		if w.Code != 200 {
			t.Fatal(w.Body.String())
		}
		want := level
		if want == "" {
			want = "B1"
		}
		if !strings.Contains(w.Body.String(), `"level":"`+want+`"`) {
			t.Fatal("practice response lost the level", w.Body.String())
		}
	}
	if !strings.Contains(s.db.snapshot().Drafts["practice-task:writing"].Text, `"level":"B1"`) {
		t.Fatal("persisted task lost its CEFR level")
	}
	if w := call(t, s, "POST", "/api/practice/task", map[string]string{"mode": "writing", "level": "C3"}); w.Code != 400 || requests.Load() != 2 {
		t.Fatal("invalid level sent to model")
	}
}
