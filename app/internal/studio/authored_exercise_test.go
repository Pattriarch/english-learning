package studio

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestAuthoredExerciseRevisionProtectsAssessmentAndHistory(t *testing.T) {
	s := testServer(t)
	l := s.lessons[0]
	l.ID = "revision-fixture"
	l.Exercises[1].Revision = 1
	s.lessons = append(s.lessons, l)
	ex := l.Exercises[1]
	current := authoredExerciseID(ex)
	if current != ex.ID+"--revision-1" || authoredExerciseID(l.Exercises[0]) != l.Exercises[0].ID {
		t.Fatal("revision changed an unchanged task or lost original identity")
	}
	for _, id := range []string{ex.ID, ex.ID + "--revision-2"} {
		w := call(t, s, "POST", "/api/check", map[string]string{"id": "stale-" + id, "lessonId": l.ID, "exerciseId": id, "answer": "My meaningful answer."})
		if w.Code != http.StatusConflict {
			t.Fatal("obsolete identity accepted", id, w.Code, w.Body.String())
		}
	}
	if len(s.db.snapshot().Attempts) != 0 {
		t.Fatal("a rejected revision created learning evidence")
	}
	if _, found, ok := s.findExercise(l.ID, current); !ok || found.ID != current || found.Prompt != ex.Prompt {
		t.Fatal("current exercise lookup lost authoritative question")
	}
	withMockModel(t, s, func(w http.ResponseWriter, r *http.Request) {
		_, input := modelInput(t, r)
		if input["task"] != ex.Prompt || input["teachingNote"] != ex.Explanation {
			t.Error("client replaced the current authored assessment", input)
		}
		jsonResponse(w, 200, map[string]any{"message": map[string]string{"content": `{"verdict":"correct","summary":"Верно","corrected":"My meaningful answer.","explanation":"The answer addresses this question."}`}})
	})
	w := call(t, s, "POST", "/api/check", map[string]string{"id": "current-authored-answer", "lessonId": l.ID, "exerciseId": current, "answer": "My meaningful answer.", "prompt": "Spoofed old question"})
	var attempt Attempt
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &attempt) != nil || attempt.ExerciseID != current || attempt.Prompt != ex.Prompt {
		t.Fatal(w.Code, w.Body.String())
	}
	s.lessons[len(s.lessons)-1].Exercises[1].Revision = 2
	w = call(t, s, "POST", "/api/check", map[string]string{"id": "outdated-authored-answer", "lessonId": l.ID, "exerciseId": current, "answer": "Another meaningful answer."})
	if w.Code != http.StatusConflict || len(s.db.snapshot().Attempts) != 1 || s.db.snapshot().Attempts[0].ExerciseID != current {
		t.Fatal("revision bump failed to reject stale work or damaged history", w.Code, w.Body.String())
	}
}

func TestAuthoredRevisionValidation(t *testing.T) {
	s := testServer(t)
	for _, revision := range []int{-1, 1000001} {
		l := s.lessons[0]
		l.Exercises = append([]Exercise(nil), l.Exercises...)
		l.Exercises[0].Revision = revision
		if validateLesson(l) == nil {
			t.Fatal("accepted invalid revision", revision)
		}
	}
	l := s.lessons[0]
	l.Exercises = append([]Exercise(nil), l.Exercises...)
	l.Exercises[0].Revision = 1
	l.Exercises[1].ID = authoredExerciseID(l.Exercises[0])
	if validateLesson(l) == nil {
		t.Fatal("two content tasks share a practice identity")
	}
}
