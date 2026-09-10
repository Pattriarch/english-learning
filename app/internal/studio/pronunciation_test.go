package studio

import (
	"encoding/json"
	"net/http"
	"path/filepath"
	"strings"
	"testing"
)

func pronunciationFixture(t *testing.T, content string) pronunciationLesson {
	t.Helper()
	lesson := pronunciationLesson{
		ID: "ipa-vowels", Title: "Read vowel symbols", Level: "A2", Goal: "Distinguish a letter from a sound symbol.",
		Practice: pronunciationPractice{
			Prompt:    "Read the examples aloud, then describe the vowel contrast in a short written reflection.",
			Reference: "I compared /ɪ/ and /iː/ and recorded both examples. I will compare them again with the reference audio.",
			Criteria:  []string{"Name both symbols", "Describe one observation as a self-report"},
		},
	}
	writeFixture(t, filepath.Join(content, "pronunciation.json"), map[string]any{"title": "Pronunciation", "lessons": []pronunciationLesson{lesson}})
	return lesson
}

func TestPronunciationUsesAuthoritativeTaskAndLimitsFeedbackToText(t *testing.T) {
	for _, mode := range []string{"writing", "speaking"} {
		t.Run(mode, func(t *testing.T) {
			content, data := contentFixture(t)
			lesson := pronunciationFixture(t, content)
			s := openFixture(t, content, data)
			withMockModel(t, s, func(w http.ResponseWriter, r *http.Request) {
				system, input := modelInput(t, r)
				context, _ := input["context"].(string)
				if input["level"] != "A2" || input["task"] != lesson.Practice.Prompt || input["mode"] != mode || strings.Contains(context, "CLIENT OVERRIDE") || !strings.Contains(context, lesson.Practice.Criteria[1]) {
					t.Error("Client overrode pronunciation task", input)
				}
				references, _ := input["referenceExamples"].([]any)
				if len(references) != 1 || references[0] != lesson.Practice.Reference {
					t.Error("Reference must come from the lesson", references)
				}
				if !strings.Contains(system, "NEVER evaluate or score actual pronunciation") || !strings.Contains(context, "A transcript and a self-report do not prove any acoustic performance") {
					t.Error("Missing text-only assessment boundary")
				}
				jsonResponse(w, 200, map[string]any{"message": map[string]string{"content": `{"verdict":"correct","summary":"Различие описано понятно","corrected":"I compared /ɪ/ and /iː/.","explanation":"Названы оба символа.","scope":"acoustic"}`}})
			})
			w := call(t, s, "POST", "/api/check", map[string]string{"id": "pronunciation-answer", "lessonId": "pronunciation", "exerciseId": lesson.ID, "answer": "I compared /ɪ/ and /iː/.", "prompt": "CLIENT OVERRIDE", "context": "CLIENT OVERRIDE", "level": "C2", "mode": mode})
			if w.Code != 200 {
				t.Fatal(w.Code, w.Body.String())
			}
			reopened := openFixture(t, content, data)
			attempts := reopened.db.snapshot().Attempts
			if len(attempts) != 1 || attempts[0].LessonID != "pronunciation" || attempts[0].ExerciseID != lesson.ID || attempts[0].Prompt != lesson.Practice.Prompt || attempts[0].Mode != mode {
				t.Fatal("Pronunciation attempt did not persist", attempts)
			}
			feedback := attempts[0].Feedback
			if feedback.Scope != "text-reflection" || !strings.Contains(feedback.Explanation, pronunciationAssessmentNote) {
				t.Fatal("Feedback was not explicitly scoped to the reflection", feedback)
			}
		})
	}
}

func TestPronunciationReadDraftAndBootstrapPersistWithoutAI(t *testing.T) {
	content, data := contentFixture(t)
	lesson := pronunciationFixture(t, content)
	s := openFixture(t, content, data)
	key := "pronunciation:" + lesson.ID
	for _, draft := range []struct{ Key, Text string }{{key, "My observation"}, {key + ":checklist", "[0,1,2]"}} {
		w := call(t, s, "POST", "/api/draft", draft)
		if w.Code != 200 {
			t.Fatal(w.Code, w.Body.String())
		}
	}
	if w := call(t, s, "POST", "/api/read", map[string]string{"id": key}); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	if w := call(t, s, "POST", "/api/check", map[string]string{"id": "offline-pronunciation", "lessonId": "pronunciation", "exerciseId": lesson.ID, "answer": lesson.Practice.Reference, "mode": "writing"}); w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	reopened := openFixture(t, content, data)
	p := reopened.db.snapshot()
	if p.Read[key] == "" || p.Drafts[key].Text != "My observation" || p.Drafts[key+":checklist"].Text != "[0,1,2]" {
		t.Fatal("Read/checklist/reflection did not persist", p)
	}
	if len(p.Attempts) != 1 || p.Attempts[0].Feedback.Verdict != "ungraded" || p.Attempts[0].Feedback.Scope != "text-reflection" {
		t.Fatal("Reference match must not produce pronunciation score", p.Attempts)
	}
	w := call(t, reopened, "GET", "/api/bootstrap", nil)
	var bootstrap struct {
		Pronunciation struct {
			Lessons []pronunciationLesson `json:"lessons"`
		} `json:"pronunciation"`
		State Progress `json:"state"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &bootstrap); err != nil || w.Code != 200 || len(bootstrap.Pronunciation.Lessons) != 1 || bootstrap.Pronunciation.Lessons[0].ID != lesson.ID || bootstrap.State.Read[key] == "" {
		t.Fatal("Bootstrap omitted pronunciation content or progress", w.Code, w.Body.String(), err)
	}
}

func TestPronunciationRejectsUnknownTasksReadKeysAndModes(t *testing.T) {
	content, data := contentFixture(t)
	lesson := pronunciationFixture(t, content)
	s := openFixture(t, content, data)
	for _, key := range []string{"pronunciation:missing", "pronunciation:", "pronunciation:" + lesson.ID + ":checklist", "unknown:" + lesson.ID} {
		if w := call(t, s, "POST", "/api/read", map[string]string{"id": key}); w.Code != 400 {
			t.Error("Invalid read key accepted", key, w.Code, w.Body.String())
		}
	}
	for _, request := range []map[string]string{
		{"id": "unknown-task", "lessonId": "pronunciation", "exerciseId": "missing", "answer": "A reflection", "mode": "writing"},
		{"id": "unknown-mode", "lessonId": "pronunciation", "exerciseId": lesson.ID, "answer": "A reflection", "mode": "sound-score"},
	} {
		if w := call(t, s, "POST", "/api/check", request); w.Code != 400 {
			t.Error("Invalid pronunciation check accepted", w.Code, w.Body.String())
		}
	}
	if p := s.db.snapshot(); len(p.Attempts) != 0 || len(p.Read) != 0 {
		t.Fatal("Invalid request mutated progress", p)
	}
	if w := call(t, s, "POST", "/api/read", map[string]string{"id": "base"}); w.Code != 200 {
		t.Fatal("Existing lesson read keys no longer work", w.Code, w.Body.String())
	}
}

func TestPronunciationCatalogValidationAndOptionalAbsence(t *testing.T) {
	content, data := contentFixture(t)
	s := openFixture(t, content, data)
	if _, _, ok := s.findExercise("pronunciation", "missing"); ok {
		t.Fatal("Missing optional catalog must not invent a lesson")
	}
	for _, name := range []string{"duplicate", "invalid-id", "invalid-level", "missing-prompt", "missing-reference", "missing-criteria", "empty-criterion", "empty-catalog"} {
		t.Run(name, func(t *testing.T) {
			content, data := contentFixture(t)
			valid := pronunciationFixture(t, content)
			lessons := []pronunciationLesson{valid}
			switch name {
			case "duplicate":
				lessons = append(lessons, valid)
			case "invalid-id":
				lessons[0].ID = "bad:id"
			case "invalid-level":
				lessons[0].Level = "C3"
			case "missing-prompt":
				lessons[0].Practice.Prompt = " "
			case "missing-reference":
				lessons[0].Practice.Reference = ""
			case "missing-criteria":
				lessons[0].Practice.Criteria = nil
			case "empty-criterion":
				lessons[0].Practice.Criteria = []string{" "}
			case "empty-catalog":
				lessons = nil
			}
			writeFixture(t, filepath.Join(content, "pronunciation.json"), map[string]any{"lessons": lessons})
			if _, err := New(data, content, ""); err == nil {
				t.Fatal("Invalid pronunciation catalog accepted")
			}
		})
	}
}
