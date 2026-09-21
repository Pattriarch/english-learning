package studio

import (
	"crypto/sha256"
	"encoding/hex"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func editorialFixture(t *testing.T, s *Server, id string, base bookLesson) bookEditorial {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(s.content, "book-lessons", id+".json"))
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(raw)
	edit := bookEditorial{Version: 1, UnitID: id, BaseLessonSHA256: hex.EncodeToString(hash[:]), ReviewedAt: "2026-09-21", Notes: "Short steps before independent use.", Title: base.Title, Goal: base.Goal, Formula: base.Formula, Minutes: 25, Sections: base.Sections, Examples: base.Examples, Exercises: append([]Exercise{}, base.Exercises...)}
	for i := range edit.Exercises {
		edit.Exercises[i].Revision++
		edit.Exercises[i].Prompt = "Одна новая мысль: " + edit.Exercises[i].Prompt
		edit.Exercises[i].PracticeStage = "guided"
		edit.Exercises[i].Guidance = &ExerciseGuidance{Title: "A short step", Body: "Use am to describe yourself.", Example: "I am ready.", Translation: "Я готов."}
	}
	writeFixture(t, filepath.Join(s.content, "book-editorial", id+".json"), edit)
	return edit
}

func TestBookEditorialPreservesReleaseAndRejectsOldAnswersWithoutPrivateSources(t *testing.T) {
	s, id, base := readyBookFixture(t)
	releaseBookFixture(t, s, id, base)
	edit := editorialFixture(t, s, id, base)
	edit.Beginner = true
	writeFixture(t, filepath.Join(s.content, "book-editorial", id+".json"), edit)
	if err := os.Remove(filepath.Join(s.content, "..", "data", "parsed-books", id+".json")); err != nil {
		t.Fatal(err)
	}
	got, err := s.loadBookLesson(id)
	if err != nil || got.Editorial == nil || !got.Beginner || got.Exercises[0].Prompt != edit.Exercises[0].Prompt {
		t.Fatal("editorial unavailable without PDF", err)
	}
	old := base.Exercises[0]
	if _, _, ok := s.findExercise(base.ID, old.ID+"--"+bookExerciseVersion(old)); ok {
		t.Fatal("rewritten question inherited old answer identity")
	}
	current := got.Exercises[0]
	if _, _, ok := s.findExercise(base.ID, current.ID+"--"+bookExerciseVersion(current)); !ok {
		t.Fatal("new task is not authoritative")
	}
	// The publisher's original bytes still match: the teaching edit is separate.
	raw, _ := os.ReadFile(filepath.Join(s.content, "book-lessons", id+".json"))
	if !s.readBookRelease().matches(id, raw, base) {
		t.Fatal("editorial changed the pinned book release")
	}
	if s.bookBuildStatus()["ready"] != 1 {
		t.Fatal("editorial removed an available book")
	}
}

func TestBookEditorialCannotHideChangedSourceOrIncompleteCoverage(t *testing.T) {
	s, id, base := readyBookFixture(t)
	edit := editorialFixture(t, s, id, base)
	for _, scenario := range []string{"wrong-base", "wrong-unit", "missing-section", "missing-task", "old-task", "wrong-anchor"} {
		t.Run(scenario, func(t *testing.T) {
			copy := edit
			copy.Sections = append([]Section{}, edit.Sections...)
			copy.Exercises = append([]Exercise{}, edit.Exercises...)
			switch scenario {
			case "wrong-base":
				copy.BaseLessonSHA256 = strings.Repeat("0", 64)
			case "wrong-unit":
				copy.UnitID = "different-unit"
			case "missing-section":
				copy.Sections = copy.Sections[1:]
			case "missing-task":
				copy.Exercises = copy.Exercises[1:]
			case "old-task":
				copy.Exercises[0] = base.Exercises[0]
			case "wrong-anchor":
				copy.Sections[0].Title = "Different topic"
			}
			writeFixture(t, filepath.Join(s.content, "book-editorial", id+".json"), copy)
			if _, err := s.loadBookLesson(id); err == nil {
				t.Fatal("accepted invalid edition", scenario)
			}
		})
	}
	writeFixture(t, filepath.Join(s.content, "book-editorial", id+".json"), edit)
	writeFixture(t, filepath.Join(s.content, "..", "data", "parsed-books", id+".json"), parsedBookUnit{})
	if _, err := s.loadBookLesson(id); err == nil {
		t.Fatal("editorial bypassed source verification")
	}
}

func TestBookGuidanceChangesTaskIdentityButLegacyHashStaysCompatible(t *testing.T) {
	ex := Exercise{Kind: "translate", Prompt: "Say ready.", Context: "Use am.", Hint: "I am", Explanation: "Describes a state.", Answers: []string{"I am ready."}}
	before := bookExerciseVersion(ex)
	ex.Guidance = &ExerciseGuidance{Title: "First", Body: "Try one sentence.", Example: "I am tired.", Translation: "Я устал."}
	ex.PracticeStage = "guided"
	after := bookExerciseVersion(ex)
	if before == after {
		t.Fatal("new support reused an unsupported answer version")
	}
	ex.Guidance.Body = "A different support."
	if bookExerciseVersion(ex) == after {
		t.Fatal("guidance change did not change task identity")
	}
	ex.Guidance = nil
	ex.PracticeStage = ""
	if bookExerciseVersion(ex) != before {
		t.Fatal("legacy tasks were needlessly invalidated")
	}
}

func TestRepositoryBeginnerBookEditorialIsUsable(t *testing.T) {
	s := testServer(t)
	paths, err := filepath.Glob(filepath.Join(s.content, "book-editorial", "*.json"))
	if err != nil {
		t.Fatal(err)
	}
	if len(paths) < 10 {
		t.Fatal("missing authored editions")
	}
	for _, path := range paths {
		id := strings.TrimSuffix(filepath.Base(path), ".json")
		lesson, err := s.loadBookLesson(id)
		if err != nil {
			t.Fatal(id, err)
		}
		if lesson.Editorial == nil || !lesson.Beginner {
			t.Fatal("missing editorial marker", id)
		}
		for i, ex := range lesson.Exercises {
			if i < 5 && (ex.Guidance == nil || ex.PracticeStage != "guided") {
				t.Fatal("new form requires preparation", id, ex.ID)
			}
			if len(ex.Answers) == 0 {
				t.Fatal("beginner task needs a model after the attempt", id, ex.ID)
			}
			for _, answer := range ex.Answers {
				if len(strings.Fields(answer)) > 24 {
					t.Fatal("beginner model is too long", id, ex.ID)
				}
			}
		}
	}
}
