package studio

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestLessonMaterialsSurviveJSONAndSupplyOnlySelectedContext(t *testing.T) {
	lesson := contentLesson("materials-test")
	lesson.Materials = []LessonMaterial{{ID: "source-a", Title: "First report", Kind: "reading", Text: "The first trial ended on Monday.", Source: "Original teaching text"}, {ID: "source-b", Title: "Private later turn", Kind: "dialogue", Text: "A later unexpected constraint."}}
	lesson.Exercises[0].MaterialIDs = []string{"source-a"}
	raw, err := json.Marshal(lesson)
	if err != nil {
		t.Fatal(err)
	}
	var restored Lesson
	if err = json.Unmarshal(raw, &restored); err != nil {
		t.Fatal(err)
	}
	if err = validateLesson(restored); err != nil {
		t.Fatal(err)
	}
	context := lessonExerciseContext(restored, restored.Exercises[0])
	if !strings.Contains(context, lesson.Materials[0].Text) || strings.Contains(context, lesson.Materials[1].Text) {
		t.Fatalf("wrong selected material context: %s", context)
	}
}

func TestLessonMaterialReferencesAndBoundedContentAreValidated(t *testing.T) {
	lesson := contentLesson("materials-test")
	lesson.Exercises[0].MaterialIDs = []string{"missing"}
	if validateLesson(lesson) == nil {
		t.Fatal("missing source accepted")
	}
	lesson.Materials = []LessonMaterial{{ID: "missing", Title: "Text", Kind: "reading", Text: "The intended source."}}
	if err := validateLesson(lesson); err != nil {
		t.Fatal(err)
	}
	lesson.Materials = append(lesson.Materials, lesson.Materials[0])
	if validateLesson(lesson) == nil {
		t.Fatal("duplicate source ID accepted")
	}
	lesson.Materials = lesson.Materials[:1]
	lesson.Materials[0].Text = strings.Repeat("x", 50001)
	if validateLesson(lesson) == nil {
		t.Fatal("unbounded material accepted")
	}
}

func TestPreparedFigureMetadataIsBoundedAndStageSpecific(t *testing.T) {
	lesson := contentLesson("figure-test")
	lesson.Materials = []LessonMaterial{
		{ID: "m1", Title: "Initial text", Kind: "reading", Text: "Initial material."},
		{ID: "m2", Title: "Chart", Kind: "reference", Text: "January: 30 of 100; June: 60 of 150.", Figure: &LessonFigure{ID: "commuting-active-share", Alt: "Line chart: month and percentage of respondents", Caption: "Separate voluntary samples; fictional figures."}},
	}
	lesson.Exercises[0].MaterialIDs = []string{"m1"}
	if err := validateLesson(lesson); err != nil {
		t.Fatal(err)
	}
	if strings.Contains(lessonExerciseContext(lesson, lesson.Exercises[0]), "voluntary") {
		t.Fatal("later figure leaked into first task")
	}
	lesson.Exercises[0].MaterialIDs = []string{"m2"}
	if !strings.Contains(lessonExerciseContext(lesson, lesson.Exercises[0]), "January: 30 of 100") || !strings.Contains(lessonExerciseContext(lesson, lesson.Exercises[0]), "percentage") {
		t.Fatal("chart data/units missing from assessment context")
	}
	copy := copyExtendedLessons([]Lesson{lesson})
	copy[0].Materials[1].Figure.Alt = "changed by caller"
	if lesson.Materials[1].Figure.Alt == "changed by caller" {
		t.Fatal("figure pointer escaped cache copy")
	}
	lesson.Materials[1].Figure.Format = "png"
	if err := validateLesson(lesson); err != nil {
		t.Fatal("prepared PNG rejected:", err)
	}
	if copyExtendedLessons([]Lesson{lesson})[0].Materials[1].Figure.Format != "png" {
		t.Fatal("PNG format lost in lesson copy")
	}
	for _, bad := range []LessonFigure{{ID: "../private", Alt: "Chart", Caption: "Source"}, {ID: "chart", Caption: "Source"}, {ID: "chart", Alt: "Chart", Caption: strings.Repeat("x", 2001)}, {ID: "chart", Format: "../../png", Alt: "Chart", Caption: "Source"}} {
		lesson.Materials[1].Figure = &bad
		if validateLesson(lesson) == nil {
			t.Fatal("unsafe or incomplete figure accepted")
		}
	}
}
