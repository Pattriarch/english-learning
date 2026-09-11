package studio

import (
	"strings"
	"testing"
	"time"
)

func TestBookMaterialVersionBindsOnlyAttachedMaterial(t *testing.T) {
	e := Exercise{ID: "e1", Kind: "write", Prompt: "Объясни 📚", Context: "Context", Hint: "Hint", Answers: []string{"One", "Two"}, Explanation: "Why", MaterialIDs: []string{"m1"}}
	m := []LessonMaterial{{ID: "m1", Title: "A recording", Kind: "listening", Text: "This is the source.", Source: "Original", AudioFile: "/book-recordings/cs-01.mp3", InputSkill: "listening"}, {ID: "m2", Text: "Unrelated"}}
	original := bookExerciseVersionWithMaterials(e, m)
	if original == bookExerciseVersion(e) {
		t.Fatal("linked material missing from version")
	}
	m[1].Text = "Changed unlinked material"
	if bookExerciseVersionWithMaterials(e, m) != original {
		t.Fatal("unlinked material invalidated task")
	}
	m[0].Text += " A changed source."
	if bookExerciseVersionWithMaterials(e, m) == original {
		t.Fatal("changed material preserved task version")
	}
	e.MaterialIDs = nil
	if bookExerciseVersionWithMaterials(e, m) != bookExerciseVersion(e) {
		t.Fatal("legacy version changed")
	}
}

func TestBookMaterialVersionMatchesBrowserFixture(t *testing.T) {
	e := Exercise{ID: "task--one", Kind: "write", Prompt: "Explain the chart.", Context: "To a colleague.", Hint: "Use the figures.", Explanation: "Describe the change.", Answers: []string{"A complete answer."}, MaterialIDs: []string{"second", "first"}}
	materials := []LessonMaterial{
		{ID: "first", Title: "Chart", Kind: "reading", Text: "June: 40%.", Source: "Original chart", SourceURL: "https://example.org/chart", Figure: &LessonFigure{ID: "chart", Format: "svg", Alt: "A chart", Caption: "Independent samples"}},
		{ID: "unused", Text: "Unused secret reference"},
		{ID: "second", Title: "Interview", Kind: "listening", Text: "An original transcript.", Source: "Course recording", AudioFile: "/book-recordings/course-track-01.mp3", InputSkill: "listening"},
	}
	if got := bookExerciseVersion(e); got != "edcfb493d8fea10f" {
		t.Fatal("legacy browser fixture differs:", got)
	}
	if got := bookExerciseVersionWithMaterials(e, materials); got != "ba98ec8358de563c" {
		t.Fatal("material-aware browser fixture differs:", got)
	}
}

func studyFixture(now time.Time) (Lesson, Progress) {
	l := coursebookStudyPlanFixture()
	l.ID = "book-study-test"
	var p Progress
	for _, index := range []int{3, 4, 5, 6} {
		e := l.Exercises[index]
		when := now.Add(-16 * 24 * time.Hour)
		if index >= 5 {
			when = now.Add(-15 * 24 * time.Hour)
		}
		mode := "writing"
		if e.Kind == "speak" {
			mode = "speaking"
		}
		p.Attempts = append(p.Attempts, Attempt{ID: e.ID, LessonID: l.ID, ExerciseID: currentBookExerciseID(l, e), Answer: "My own meaningful answer.", At: when.Format(time.RFC3339Nano), Mode: mode, Feedback: Feedback{Verdict: "correct", Source: "codex"}})
	}
	return l, p
}

func TestBookStudyRevisionGetsActualCurrentWork(t *testing.T) {
	now := time.Date(2026, 9, 11, 13, 0, 0, 0, time.UTC)
	l, p := studyFixture(now)
	p.Attempts[0].Answer = "I wrote this actual paragraph."
	p.Attempts[0].Feedback.Explanation = "Explain this particular mistake."
	e := l.Exercises[5]
	e.ID = currentBookExerciseID(l, e)
	input, err := bookStudyDependencies(l, e, p, now)
	if err != nil || input == nil || input.Stage != "revision" || len(input.OriginalWork) != 2 {
		t.Fatal("missing actual work:", err)
	}
	if input.OriginalWork[0].Attempt.Answer != p.Attempts[0].Answer || input.OriginalWork[0].Attempt.Feedback.Explanation != p.Attempts[0].Feedback.Explanation {
		t.Fatal("lost actual learner work or feedback")
	}
	changed := input.OriginalWork[0].Attempt
	changed.At = now.Add(-time.Hour).Format(time.RFC3339Nano)
	changed.Answer = "This is my revised first draft."
	p.Attempts = append(p.Attempts, changed)
	next, err := bookStudyDependencies(l, e, p, now)
	if err != nil || sameBookStudyInput(input, next) {
		t.Fatal("did not detect changed work during grading")
	}
}

func TestBookStudyDelayedTransferEvidence(t *testing.T) {
	now := time.Date(2026, 9, 11, 13, 0, 0, 0, time.UTC)
	l, p := studyFixture(now)
	input, err := bookStudyDependencies(l, l.Exercises[7], p, now)
	if err != nil || input.Stage != "transfer" || len(input.Revisions) != 2 {
		t.Fatal("valid delayed application rejected:", err)
	}
	for name, mutate := range map[string]func(*Lesson, *Progress){
		"missing spoken output":   func(_ *Lesson, p *Progress) { p.Attempts[1].Mode = "writing" },
		"nonmeaningful output":    func(_ *Lesson, p *Progress) { p.Attempts[0].Answer = "..." },
		"future evidence":         func(_ *Lesson, p *Progress) { p.Attempts[0].At = now.Add(time.Hour).Format(time.RFC3339Nano) },
		"invalid date":            func(_ *Lesson, p *Progress) { p.Attempts[0].At = "2026-02-31T10:00:00Z" },
		"reference feedback":      func(_ *Lesson, p *Progress) { p.Attempts[2].Feedback.Source = "reference" },
		"unknown feedback source": func(_ *Lesson, p *Progress) { p.Attempts[2].Feedback.Source = "imported" },
		"partial revision":        func(_ *Lesson, p *Progress) { p.Attempts[2].Feedback.Verdict = "partial" },
		"revision before production": func(_ *Lesson, p *Progress) {
			p.Attempts[0].At = now.Add(-14 * 24 * time.Hour).Format(time.RFC3339Nano)
		},
		"not yet due": func(_ *Lesson, p *Progress) { p.Attempts[2].At = now.Add(-time.Hour).Format(time.RFC3339Nano) },
		"changed source": func(l *Lesson, _ *Progress) {
			l.Exercises[3].MaterialIDs = []string{"m1"}
			l.Materials = []LessonMaterial{{ID: "m1", Text: "A different source"}}
		},
		"old exercise version": func(_ *Lesson, p *Progress) { p.Attempts[0].ExerciseID += "outdated" },
		"latest answer invalid": func(_ *Lesson, p *Progress) {
			a := p.Attempts[0]
			a.At = now.Add(-time.Hour).Format(time.RFC3339Nano)
			a.Answer = "no"
			p.Attempts = append(p.Attempts, a)
		},
	} {
		t.Run(name, func(t *testing.T) {
			l, p := studyFixture(now)
			mutate(&l, &p)
			if _, err := bookStudyDependencies(l, l.Exercises[7], p, now); err == nil {
				t.Fatal("invalid evidence accepted")
			}
		})
	}
	// Exactly the due instant is valid; a millisecond before it is not.
	due := now.Add(-24 * time.Hour)
	if _, err := bookStudyDependencies(l, l.Exercises[7], p, due); err != nil {
		t.Fatal(err)
	}
	if _, err := bookStudyDependencies(l, l.Exercises[7], p, due.Add(-time.Millisecond)); err == nil || !strings.Contains(err.Error(), "откроется") {
		t.Fatal("early transfer accepted")
	}
}

func TestBookStudyLegacyLessonsRemainAvailable(t *testing.T) {
	l := contentLesson("legacy")
	if input, err := bookStudyDependencies(l, l.Exercises[0], Progress{}, time.Now()); input != nil || err != nil {
		t.Fatal("legacy lesson became gated")
	}
}
