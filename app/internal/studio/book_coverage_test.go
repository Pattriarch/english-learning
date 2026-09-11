package studio

import (
	"path/filepath"
	"strings"
	"testing"
)

func readyBookWithSharedTeachingPoint(t *testing.T) (*Server, string, bookLesson) {
	t.Helper()
	s, id, lesson := readyBookFixture(t)
	study := coursebookStudyPlanFixture()
	lesson.Exercises, lesson.StudyPlan = study.Exercises, study.StudyPlan
	coverage := &lesson.Provenance.SourceCoverage[0]
	coverage.PointID = "p001"
	coverage.ExerciseIDs = []string{"e1"}
	second := *coverage
	second.SectionTitle = lesson.Sections[1].Title
	second.ExerciseIDs = []string{"e3"}
	if second.SectionTitle == coverage.SectionTitle {
		t.Fatal("fixture needs two distinct explanation sections")
	}
	lesson.Provenance.SourceCoverage = append(lesson.Provenance.SourceCoverage, second)
	writeFixture(t, filepath.Join(s.content, "book-lessons", id+".json"), lesson)
	return s, id, lesson
}

func TestBookTeachingPointCanCoverSeveralSections(t *testing.T) {
	s, id, expected := readyBookWithSharedTeachingPoint(t)
	actual, err := s.loadBookLesson(id)
	if err != nil {
		t.Fatal("valid chapter contract rejected at runtime:", err)
	}
	if len(actual.Provenance.SourceCoverage) != 2 || actual.Provenance.SourceCoverage[1].Point != expected.Provenance.SourceCoverage[0].Point {
		t.Fatal("coverage evidence was dropped or rewritten")
	}
	response := call(t, s, "GET", "/api/library/unit/"+id, nil)
	if response.Code != 200 || !strings.Contains(response.Body.String(), `"lessonStatus":"ready"`) {
		t.Fatal("valid chapter unavailable in the reader:", response.Body.String())
	}
}

func TestBookTeachingPointRejectsConflictingOrInvalidMappings(t *testing.T) {
	cases := map[string]func(*bookLesson){
		"same point and section twice": func(l *bookLesson) {
			l.Provenance.SourceCoverage[1].SectionTitle = l.Provenance.SourceCoverage[0].SectionTitle
		},
		"changed meaning under same ID": func(l *bookLesson) {
			l.Provenance.SourceCoverage[1].Point += " An unrelated teaching point."
		},
		"missing point ID": func(l *bookLesson) {
			l.Provenance.SourceCoverage[1].PointID = ""
		},
		"missing practice": func(l *bookLesson) {
			l.Provenance.SourceCoverage[1].ExerciseIDs = []string{"absent"}
		},
		"repeated practice": func(l *bookLesson) {
			l.Provenance.SourceCoverage[1].ExerciseIDs = []string{"e3", "e3"}
		},
		"empty practice": func(l *bookLesson) {
			l.Provenance.SourceCoverage[1].ExerciseIDs = nil
		},
	}
	for name, change := range cases {
		t.Run(name, func(t *testing.T) {
			s, id, lesson := readyBookWithSharedTeachingPoint(t)
			change(&lesson)
			writeFixture(t, filepath.Join(s.content, "book-lessons", id+".json"), lesson)
			if _, err := s.loadBookLesson(id); err == nil {
				t.Fatal("invalid source mapping accepted")
			}
		})
	}
}
