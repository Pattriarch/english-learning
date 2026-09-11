package studio

import (
	"strings"
	"testing"
)

func TestSourceMediationSuppliesIndependentSourceEvidenceToEveryRevisedTask(t *testing.T) {
	s := testServer(t)
	var lesson Lesson
	for _, candidate := range s.allLessons() {
		if candidate.ID == "path-source-mediation" {
			lesson = candidate
		}
	}
	if err := validateLesson(lesson); err != nil {
		t.Fatal(err)
	}
	if len(lesson.Materials) != 1 || len(lesson.Exercises) != 6 {
		t.Fatal("missing supplied source dossier or exercises")
	}
	material := lesson.Materials[0]
	if material.Kind != "reading" || material.SourceURL != "" || !strings.Contains(material.Source, "fictional") || !strings.Contains(material.Text, "Fictional teaching dossier") {
		t.Fatal("invented sources presented as external research")
	}
	for _, fact := range []string{"report WB-01 as its only evidence", "no new data", "RV-02", "30 different learners", "no language assessment", "no comparison group", "no later follow-up"} {
		if !strings.Contains(material.Text, fact) {
			t.Error("task lacks a necessary supplied provenance or limitation", fact)
		}
	}
	for i, exercise := range lesson.Exercises {
		if i < 3 {
			if exercise.Revision != 0 || len(exercise.MaterialIDs) != 0 || authoredExerciseID(exercise) != exercise.ID {
				t.Fatal("unmodified exercises were invalidated")
			}
			continue
		}
		if exercise.Revision != 1 || len(exercise.MaterialIDs) != 1 || exercise.MaterialIDs[0] != material.ID {
			t.Fatal("changed exercise is not version protected or self-contained", exercise.ID)
		}
		_, found, ok := s.findExercise(lesson.ID, exercise.ID+"--revision-1")
		if !ok || !strings.Contains(lessonExerciseContext(lesson, found), material.Text) {
			t.Fatal("assessment did not receive the source evidence", exercise.ID)
		}
		if len(exercise.Answers) != 1 || !strings.Contains(exercise.Answers[0], "WB-01") || !strings.Contains(exercise.Answers[0], "RV-02") || !strings.Contains(exercise.Answers[0], "replication") {
			t.Fatal("model answer omits provenance versus replication", exercise.ID)
		}
		count := len(strings.Fields(exercise.Answers[0]))
		if (i == 3 && (count < 100 || count > 150)) || (i == 4 && (count < 230 || count > 300)) || (i == 5 && (count < 200 || count > 330)) {
			t.Fatal("reference answer does not satisfy the output scale", exercise.ID, count)
		}
	}
}
