package studio

import (
	"encoding/json"
	"net/http"
	"testing"
)

func TestEveryCourseLessonHasTeachingBeforeProduction(t *testing.T) {
	s := testServer(t)
	base := map[string]Lesson{}
	for _, l := range s.lessons {
		base[l.ID] = l
	}
	count, preparation, guided := 0, 0, 0
	for _, l := range s.allLessons() {
		if _, published := base[l.ID]; !published {
			continue
		}
		count++
		if l.Guided {
			// One explanation layer, checked sources, and an explained first step.
			guided++
			if l.CourseGuide != nil || len(l.Sources) == 0 || len(l.Exercises) == 0 || l.Exercises[0].Guidance == nil || l.Exercises[0].PracticeStage != "guided" {
				t.Fatalf("guided lesson does not teach once before asking: %s", l.ID)
			}
			continue
		}
		if l.Beginner {
			continue
		}
		g := l.CourseGuide
		if g == nil || len(g.Explanation) < 3 || len(g.Examples) < 2 || len(g.Practice) < 2 || len(g.Sources) == 0 || len(g.Prerequisites) == 0 {
			t.Fatalf("lesson has no complete teaching entry: %s", l.ID)
		}
		preparation += len(g.Practice)
		if len(l.Exercises) != len(base[l.ID].Exercises)+len(g.Practice) {
			t.Fatalf("missing practice %s", l.ID)
		}
		for i, e := range base[l.ID].Exercises {
			got := l.Exercises[i+len(g.Practice)]
			revised := false
			for _, replacement := range g.Replacements {
				if replacement.ID == e.ID {
					revised = true
				}
			}
			if revised && (got.ID != e.ID || got.Revision <= e.Revision) {
				t.Fatalf("replacement reused old answer identity: %s/%s", l.ID, e.ID)
			}
			if !revised && (authoredExerciseID(got) != authoredExerciseID(e) || got.Prompt != e.Prompt) {
				t.Fatalf("existing answer identity changed: %s/%s", l.ID, e.ID)
			}
		}
	}
	if count != 220 || guided < 168 {
		t.Fatalf("incomplete course coverage: %d lessons, %d guided, %d overlay preparations", count, guided, preparation)
	}
}

func TestCoursePreparationChecksAuthoritativeNewTaskAndPersists(t *testing.T) {
	s := testServer(t)
	l := s.withCourseGuide(func() Lesson {
		for _, l := range s.lessons {
			if l.ID == "path-present-perfect-continuous" {
				return l
			}
		}
		return Lesson{}
	}())
	if !l.Guided && l.CourseGuide == nil {
		t.Fatal("missing teaching before the first task")
	}
	e := l.Exercises[0]
	w := call(t, s, "POST", "/api/check", map[string]string{"id": "course-preparation-check", "lessonId": l.ID, "exerciseId": authoredExerciseID(e), "answer": e.Answers[0], "prompt": "untrusted replacement"})
	var a Attempt
	if w.Code != http.StatusOK || json.Unmarshal(w.Body.Bytes(), &a) != nil || a.Feedback.Verdict != "correct" || a.Prompt != e.Prompt || a.Feedback.Source != "reference" {
		t.Fatalf("preparation was not checked against current teaching: %d %s", w.Code, w.Body.String())
	}
	if len(s.db.snapshot().Attempts) != 1 {
		t.Fatal("new preparation was not saved")
	}
}

func TestRewrittenBeginnerScenarioRejectsOldTaskVersion(t *testing.T) {
	s := testServer(t)
	var original Lesson
	for _, l := range s.lessons {
		if l.ID == "extended-a1-registration" {
			original = l
		}
	}
	var current Exercise
	for _, e := range s.withCourseGuide(original).Exercises {
		if e.ID == "e1" {
			current = e
		}
	}
	// The first published version of e1 had no revision; the scenario has been rewritten since.
	previous := Exercise{ID: "e1"}
	if current.Revision <= 1 || current.Prompt == "" {
		t.Fatal("no meaningful beginner replacement")
	}
	old := call(t, s, "POST", "/api/check", map[string]string{"id": "old-scenario", "lessonId": original.ID, "exerciseId": authoredExerciseID(previous), "answer": "Kim Reed."})
	if old.Code != http.StatusConflict || len(s.db.snapshot().Attempts) != 0 {
		t.Fatal("outdated scenario was accepted as current", old.Code)
	}
	updated := call(t, s, "POST", "/api/check", map[string]string{"id": "new-scenario", "lessonId": original.ID, "exerciseId": authoredExerciseID(current), "answer": current.Answers[0]})
	var a Attempt
	if updated.Code != http.StatusOK || json.Unmarshal(updated.Body.Bytes(), &a) != nil || (a.Feedback.Verdict != "ungraded" && a.Feedback.Verdict != "correct") || a.Feedback.Source != "reference" || a.Prompt != current.Prompt {
		t.Fatal("short scenario answer not accepted", updated.Code, updated.Body.String())
	}
}
