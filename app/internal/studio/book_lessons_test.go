package studio

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

func readyBookFixture(t *testing.T) (*Server, string, bookLesson) {
	content, data := contentFixture(t)
	libraryFixture(t, content, "text-layer", "old extraction")
	id := "book-c2-001"
	source := parsedBookUnit{UnitID: id, BookID: "book-c2", Pages: []int{10, 11}, Text: "Actual complete source: смысл и регистр.\nTwo separate paragraphs.", Source: "text-layer-layout"}
	writeFixture(t, filepath.Join(content, "..", "data", "parsed-books", id+".json"), source)
	l := bookLesson{Lesson: contentLesson("book-" + id)}
	l.Sections = append(l.Sections, l.Sections[0])
	l.Examples = append(l.Examples, l.Examples...)
	for _, ex := range append([]Exercise{}, l.Exercises...) {
		ex.ID += "-extra"
		l.Exercises = append(l.Exercises, ex)
	}
	l.Provenance.UnitID = id
	l.Provenance.BookID = "book-c2"
	l.Provenance.Pages = source.Pages
	l.Provenance.Source = source.Source
	hash := sha256.Sum256([]byte(source.Text))
	l.Provenance.SourceHash = hex.EncodeToString(hash[:])
	l.Provenance.SourceCoverage = append(l.Provenance.SourceCoverage, struct {
		Point        string `json:"point"`
		SectionTitle string `json:"sectionTitle"`
	}{"Stance", "Meaning"})
	writeFixture(t, filepath.Join(content, "book-lessons", id+".json"), l)
	return openFixture(t, content, data), id, l
}

func TestBookLessonPublishedWithoutServerRestart(t *testing.T) {
	s, id, l := readyBookFixture(t)
	if source := s.unitSource(id); !strings.Contains(source.Text, "смысл") {
		t.Fatal("did not prefer rebuilt source")
	}
	w := call(t, s, "GET", "/api/library/unit/"+id, nil)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"lessonStatus":"ready"`) {
		t.Fatal(w.Body.String())
	}
	if !strings.Contains(w.Body.String(), `"taskVersions":true`) {
		t.Fatal("unit did not advertise versioned exercise checks")
	}
	if _, ex, ok := s.findExercise(l.ID, "e1"); !ok || ex.Prompt != l.Exercises[0].Prompt {
		t.Fatal("authoritative exercise missing")
	}
	if _, _, ok := s.findExercise(l.ID, "invented"); ok {
		t.Fatal("accepted invented task")
	}
	l.Title = "Updated while running"
	writeFixture(t, filepath.Join(s.content, "book-lessons", id+".json"), l)
	if current, err := s.loadBookLesson(id); err != nil || current.Title != l.Title {
		t.Fatal("dynamic publication not visible", err)
	}
	if strings.Contains(call(t, s, "GET", "/api/bootstrap", nil).Body.String(), "Actual complete source") {
		t.Fatal("bootstrap leaked source")
	}
}

func TestBookLessonRejectsStaleSourceAndSupportsCanonicalEdition(t *testing.T) {
	s, id, l := readyBookFixture(t)
	alias := s.libraryUnits[id]
	alias.Book.ID = "duplicate"
	alias.Book.DuplicateOf = "book-c2"
	alias.Unit.ID = "duplicate-001"
	alias.Unit.EquivalentUnitID = id
	s.libraryUnits[alias.Unit.ID] = alias
	if current, err := s.loadBookLesson(alias.Unit.ID); err != nil || current.ID != l.ID {
		t.Fatal("duplicate did not resolve", err)
	}
	l.Provenance.SourceHash = "wrong"
	writeFixture(t, filepath.Join(s.content, "book-lessons", id+".json"), l)
	if _, err := s.loadBookLesson(id); err == nil {
		t.Fatal("stale source accepted")
	}
	if _, _, ok := s.findExercise(l.ID, "e1"); ok {
		t.Fatal("stale task accepted")
	}
	if w := call(t, s, "GET", "/api/library/unit/"+id, nil); strings.Contains(w.Body.String(), `"lessonStatus":"ready"`) {
		t.Fatal("stale lesson shown as ready")
	}
	if _, err := s.loadBookLesson("../../data/settings"); err == nil {
		t.Fatal("unsafe unit accepted")
	}
}

func TestBookStatusOmitsPrivateBatchDiagnostics(t *testing.T) {
	s, id, _ := readyBookFixture(t)
	writeFixture(t, filepath.Join(s.content, "..", "data", "book-build-status.json"), map[string]any{"state": "running", "units": map[string]any{id: map[string]any{"status": "ready", "error": "PRIVATE MODEL DIAGNOSTIC"}}})
	w := call(t, s, "GET", "/api/library/status", nil)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"ready":1`) || strings.Contains(w.Body.String(), "PRIVATE") {
		t.Fatal(w.Body.String())
	}
}

func TestVisualBookLessonRequiresMatchingBothPageImages(t *testing.T) {
	s, id, lesson := readyBookFixture(t)
	lesson.Provenance.VisualSourceUsed = true
	for _, page := range []int{10, 11} {
		raw := []byte("rendered original page " + strconv.Itoa(page))
		hash := sha256.Sum256(raw)
		path := filepath.Join(s.content, "..", "data", "book-page-images", "book-c2", strconv.Itoa(page)+".jpg")
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, raw, 0600); err != nil {
			t.Fatal(err)
		}
		lesson.Provenance.SourceImages = append(lesson.Provenance.SourceImages, bookSourceImage{Page: page, SHA256: hex.EncodeToString(hash[:])})
	}
	path := filepath.Join(s.content, "book-lessons", id+".json")
	writeFixture(t, path, lesson)
	if _, err := s.loadBookLesson(id); err != nil {
		t.Fatal(err)
	}
	lesson.Provenance.SourceImages[1].SHA256 = lesson.Provenance.SourceImages[0].SHA256
	writeFixture(t, path, lesson)
	if _, err := s.loadBookLesson(id); err == nil {
		t.Fatal("accepted mismatched image")
	}
}

func TestBookExerciseVersionMatchesBrowser(t *testing.T) {
	// Snapshot of the real Murphy Unit 3 question. The expected version was
	// computed with the frontend's UTF-8 field/separator format in Node.js.
	ex := Exercise{
		ID: "e1", Kind: "translate",
		Prompt:      "Переведите полное сообщение коллеге: «Обычно я отвечаю на сообщения утром, но сегодня я готовлю презентацию. Ты сейчас ждёшь моего ответа? Я пока не проверяю почту».",
		Context:     "Коллега написал вам в рабочий чат. Вы объясняете отличие сегодняшней ситуации от обычного распорядка и уточняете, нужен ли ответ прямо сейчас.",
		Hint:        "Отделите привычный распорядок от сегодняшнего процесса. Последний вопрос и отрицание относятся к текущей ситуации.",
		Explanation: "Usually reply описывает привычку. Am preparing показывает сегодняшнюю работу в процессе. В вопросе о текущем ожидании are ставится перед you; в отрицании not следует за am. Right now и at the moment делают временной смысл явным, но при понятном контексте могут быть опущены. Допустимы другие естественные переводы, например answer messages или work on a presentation; образец не является единственным правильным ответом.",
		Answers:     []string{"I usually reply to messages in the morning, but today I’m preparing a presentation. Are you waiting for my reply right now? I’m not checking my email at the moment."},
	}
	if got := bookExerciseVersion(ex); got != "b9b3ceada2ec4931" {
		t.Fatal("browser and server disagree on task version:", got)
	}
	// A second browser-generated vector exercises the answer separator too.
	ex = Exercise{Kind: "translate", Prompt: "Переведи: «Я сейчас работаю».", Context: "A café — right now.\nTry again.", Hint: "Сейчас ≠ обычно", Explanation: "Use am + working.", Answers: []string{"I’m working now.", "I am working right now."}}
	if got := bookExerciseVersion(ex); got != "9f989056732a442d" {
		t.Fatal("browser and server disagree on multiple answers:", got)
	}
}

func TestVersionedBookCheckUsesAuthoritativeExercise(t *testing.T) {
	s, id, lesson := readyBookFixture(t)
	lesson.Exercises[0].Context = "Acknowledge a colleague's argument."
	writeFixture(t, filepath.Join(s.content, "book-lessons", id+".json"), lesson)
	ex := lesson.Exercises[0]
	versionedID := ex.ID + "--" + bookExerciseVersion(ex)
	if _, found, ok := s.findExercise(lesson.ID, versionedID); !ok || found.ID != versionedID {
		t.Fatal("versioned task lookup lost its identity")
	}
	var modelCalls int
	withMockModel(t, s, func(w http.ResponseWriter, r *http.Request) {
		modelCalls++
		_, input := modelInput(t, r)
		if input["task"] != ex.Prompt || input["context"] != ex.Context || input["level"] != lesson.Level || input["teachingNote"] != ex.Explanation {
			t.Error("client overrode the authoritative book question", input)
		}
		refs, ok := input["referenceExamples"].([]any)
		if !ok || len(refs) != 1 || refs[0] != ex.Answers[0] {
			t.Error("model did not receive this version's reference answer", input["referenceExamples"])
		}
		jsonResponse(w, 200, map[string]any{"message": map[string]string{"content": `{"verdict":"correct","summary":"Верно","corrected":"I see your point.","explanation":"An appropriate acknowledgement."}`}})
	})
	w := call(t, s, "POST", "/api/check", map[string]string{"id": "versioned-answer", "lessonId": lesson.ID, "exerciseId": versionedID, "answer": ex.Answers[0], "prompt": "Different question", "context": "Different context", "level": "A1"})
	if w.Code != 200 || modelCalls != 1 {
		t.Fatal(w.Code, modelCalls, w.Body.String())
	}
	var attempt Attempt
	if err := json.Unmarshal(w.Body.Bytes(), &attempt); err != nil || attempt.ExerciseID != versionedID || attempt.Prompt != ex.Prompt {
		t.Fatal("saved result did not identify the checked question", attempt, err)
	}
}

func TestVersionedBookCheckRejectsChangedQuestion(t *testing.T) {
	changes := map[string]func(*Exercise){
		"kind": func(ex *Exercise) { ex.Kind = "rewrite" },
		"prompt": func(ex *Exercise) {
			ex.Prompt = "Переведи целиком: Я не согласен с вами."
		},
		"context":     func(ex *Exercise) { ex.Context = "Disagree with the argument." },
		"hint":        func(ex *Exercise) { ex.Hint = "Express disagreement." },
		"explanation": func(ex *Exercise) { ex.Explanation = "This version teaches disagreement." },
		"answers":     func(ex *Exercise) { ex.Answers = []string{"I disagree with you."} },
	}
	for name, change := range changes {
		t.Run(name, func(t *testing.T) {
			s, id, lesson := readyBookFixture(t)
			oldExercise := lesson.Exercises[0]
			oldID := oldExercise.ID + "--" + bookExerciseVersion(oldExercise)
			change(&lesson.Exercises[0])
			writeFixture(t, filepath.Join(s.content, "book-lessons", id+".json"), lesson)
			if _, err := s.loadBookLesson(id); err != nil {
				t.Fatal("replacement lesson must be valid", err)
			}
			w := call(t, s, "POST", "/api/check", map[string]string{"id": "stale-answer", "lessonId": lesson.ID, "exerciseId": oldID, "answer": oldExercise.Answers[0]})
			if w.Code != http.StatusConflict || len(s.db.snapshot().Attempts) != 0 {
				t.Fatal("answer to the old question was graded against its replacement", w.Code, w.Body.String())
			}
			current := lesson.Exercises[0]
			newID := current.ID + "--" + bookExerciseVersion(current)
			w = call(t, s, "POST", "/api/check", map[string]string{"id": "current-answer", "lessonId": lesson.ID, "exerciseId": newID, "answer": current.Answers[0]})
			if w.Code != 200 || len(s.db.snapshot().Attempts) != 1 {
				t.Fatal("current question could not be checked", w.Code, w.Body.String())
			}
		})
	}
}

func TestVersionedBookCheckRejectsRemovedExercise(t *testing.T) {
	s, id, lesson := readyBookFixture(t)
	ex := lesson.Exercises[0]
	lesson.Exercises[0].ID = "replacement"
	writeFixture(t, filepath.Join(s.content, "book-lessons", id+".json"), lesson)
	w := call(t, s, "POST", "/api/check", map[string]string{"id": "removed-answer", "lessonId": lesson.ID, "exerciseId": ex.ID + "--" + bookExerciseVersion(ex), "answer": ex.Answers[0]})
	if w.Code != http.StatusConflict || len(s.db.snapshot().Attempts) != 0 {
		t.Fatal("removed question was accepted", w.Code, w.Body.String())
	}
}

func TestVersionedBookCheckRejectsUnavailableLesson(t *testing.T) {
	s, id, lesson := readyBookFixture(t)
	ex := lesson.Exercises[0]
	lesson.Provenance.SourceHash = "changed-source"
	writeFixture(t, filepath.Join(s.content, "book-lessons", id+".json"), lesson)
	w := call(t, s, "POST", "/api/check", map[string]string{"id": "unavailable-answer", "lessonId": lesson.ID, "exerciseId": ex.ID + "--" + bookExerciseVersion(ex), "answer": ex.Answers[0]})
	if w.Code != http.StatusConflict || len(s.db.snapshot().Attempts) != 0 {
		t.Fatal("unvalidated source version was accepted", w.Code, w.Body.String())
	}
}

func TestVersionedBookCheckRejectsUnknownVersions(t *testing.T) {
	s, _, lesson := readyBookFixture(t)
	for i, exerciseID := range []string{"e1--", "e1--0000000000000000", "e1--not-a-hash", "missing--" + bookExerciseVersion(lesson.Exercises[0])} {
		w := call(t, s, "POST", "/api/check", map[string]string{"id": "unknown-version-" + strconv.Itoa(i), "lessonId": lesson.ID, "exerciseId": exerciseID, "answer": "I see your point."})
		if w.Code != http.StatusConflict {
			t.Fatal("unknown version did not request recovery", exerciseID, w.Code, w.Body.String())
		}
	}
	if len(s.db.snapshot().Attempts) != 0 {
		t.Fatal("unknown versions saved attempts")
	}
	w := call(t, s, "POST", "/api/check", map[string]string{"id": "unknown-legacy", "lessonId": lesson.ID, "exerciseId": "missing", "answer": "I see your point."})
	if w.Code != http.StatusBadRequest {
		t.Fatal("unknown legacy task changed its error contract", w.Code, w.Body.String())
	}
}

func TestBookCheckStillAcceptsLegacyIDs(t *testing.T) {
	s, id, lesson := readyBookFixture(t)
	for i, exerciseID := range []string{"e1", "old--exercise"} {
		lesson.Exercises[0].ID = exerciseID
		writeFixture(t, filepath.Join(s.content, "book-lessons", id+".json"), lesson)
		w := call(t, s, "POST", "/api/check", map[string]string{"id": "legacy-answer-" + strconv.Itoa(i), "lessonId": lesson.ID, "exerciseId": exerciseID, "answer": lesson.Exercises[0].Answers[0]})
		if w.Code != 200 {
			t.Fatal("existing unversioned book task no longer works", w.Code, w.Body.String())
		}
	}
	if len(s.db.snapshot().Attempts) != 2 {
		t.Fatal("legacy attempts were not saved")
	}
}

func TestVersionedBookCheckRetryPreservesOriginalResult(t *testing.T) {
	s, id, lesson := readyBookFixture(t)
	ex := lesson.Exercises[0]
	request := map[string]string{"id": "retry-versioned", "lessonId": lesson.ID, "exerciseId": ex.ID + "--" + bookExerciseVersion(ex), "answer": ex.Answers[0]}
	first := call(t, s, "POST", "/api/check", request)
	if first.Code != 200 {
		t.Fatal(first.Code, first.Body.String())
	}
	lesson.Exercises[0].Prompt = "A new question published after the response was saved."
	writeFixture(t, filepath.Join(s.content, "book-lessons", id+".json"), lesson)
	retry := call(t, s, "POST", "/api/check", request)
	if retry.Code != 200 || retry.Body.String() != first.Body.String() || len(s.db.snapshot().Attempts) != 1 {
		t.Fatal("retry lost or replaced the saved original assessment", retry.Code, retry.Body.String())
	}
}
