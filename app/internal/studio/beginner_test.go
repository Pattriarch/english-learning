package studio

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func TestBeginnerGuidanceAndShortAnswerCheck(t *testing.T) {
	s := testServer(t)
	l := s.lessons[0]
	l.ID, l.Beginner = "beginner-fixture", true
	l.Exercises = append([]Exercise(nil), l.Exercises...)
	l.Exercises[0] = Exercise{ID: "e1", Revision: 1, Kind: "translate", Prompt: "Скажи: Я устал. Tired — устал.", Answers: []string{"I am tired."}, Explanation: "После I нужна форма am.", PracticeStage: "guided", Guidance: &ExerciseGuidance{Title: "Я готов", Body: "По-английски между I и ready ставим am.", Example: "I am ready.", Translation: "Я готов."}}
	s.lessons = append(s.lessons, l)
	calls := 0
	withMockModel(t, s, func(w http.ResponseWriter, r *http.Request) {
		calls++
		system, input := modelInput(t, r)
		guidance, ok := input["guidance"].(map[string]any)
		if !ok || guidance["example"] != "I am ready." || !strings.Contains(system, "Do not demand longer answers") {
			t.Error("checker lost the beginner teaching boundary", input)
		}
		jsonResponse(w, 200, map[string]any{"message": map[string]string{"content": `{"verdict":"correct","summary":"Верно","corrected":"I feel tired.","explanation":"Можно передать усталость и через feel tired."}`}})
	})
	for i, answer := range []string{"I am tired.", "I feel tired."} {
		w := call(t, s, "POST", "/api/check", map[string]string{"id": []string{"exact-beginner", "alternate-beginner"}[i], "lessonId": l.ID, "exerciseId": "e1--revision-1", "answer": answer})
		var attempt Attempt
		if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &attempt) != nil || attempt.Feedback.Verdict != "correct" || calls != i {
			t.Fatal("short or alternate answer was not accepted", w.Code, calls, w.Body.String())
		}
		if i == 0 && attempt.Feedback.Source != "reference" {
			t.Fatal("local comparison presented as model assessment")
		}
	}
	if len(s.db.snapshot().Attempts) != 2 {
		t.Fatal("beginner responses were not persisted")
	}
}

func TestLessonRequiresCompleteGuidance(t *testing.T) {
	s := testServer(t)
	l := s.lessons[0]
	l.Exercises = append([]Exercise(nil), l.Exercises...)
	l.Beginner = true
	l.Exercises[0].PracticeStage = "guided"
	if validateLesson(l) == nil {
		t.Fatal("task can precede its teaching")
	}
	l.Exercises[0].Guidance = &ExerciseGuidance{Title: "Сначала разберёмся", Body: "Небольшое объяснение.", Example: "I am ready.", Translation: "Я готов."}
	if err := validateLesson(l); err != nil {
		t.Fatal(err)
	}
	l.Exercises[0].Guidance.Translation = ""
	if validateLesson(l) == nil {
		t.Fatal("beginner model has no meaning")
	}
}
