package studio

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"
)

func TestStudyRouteRejectsInvalidCurriculumRelations(t *testing.T) {
	base := `{"version":1,"overviewLessonIds":["review"],"relations":[{"lessonId":"primary","kind":"book","id":"grammar-001","title":"Shared core and further practice","relation":"related"}],"deepening":[{"lessonId":"advanced","afterLessonId":"primary","reason":"A distinct audience and response"}]}`
	for _, tc := range []struct {
		name      string
		edit      func(map[string]any)
		wantError bool
	}{
		{"valid", func(map[string]any) {}, false},
		{"unknown overview", func(v map[string]any) { v["overviewLessonIds"] = []string{"missing"} }, true},
		{"duplicate overview", func(v map[string]any) { v["overviewLessonIds"] = []string{"review", "review"} }, true},
		{"unknown book", func(v map[string]any) { v["relations"].([]any)[0].(map[string]any)["id"] = "missing" }, true},
		{"alternate edition", func(v map[string]any) { v["relations"].([]any)[0].(map[string]any)["id"] = "duplicate-001" }, true},
		{"duplicate relation", func(v map[string]any) { r := v["relations"].([]any); v["relations"] = append(r, r[0]) }, true},
		{"overview as primary", func(v map[string]any) { v["relations"].([]any)[0].(map[string]any)["lessonId"] = "review" }, true},
		{"self prerequisite", func(v map[string]any) { v["deepening"].([]any)[0].(map[string]any)["afterLessonId"] = "advanced" }, true},
		{"cycle", func(v map[string]any) {
			v["deepening"] = append(v["deepening"].([]any), map[string]any{"lessonId": "primary", "afterLessonId": "advanced", "reason": "cycle"})
		}, true},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s := &Server{content: t.TempDir(), lessons: []Lesson{{ID: "primary"}, {ID: "advanced"}, {ID: "review"}}, libraryUnits: map[string]libraryEntry{
				"grammar-001":   {Unit: libraryUnit{ID: "grammar-001"}},
				"duplicate-001": {Book: libraryBook{DuplicateOf: "grammar"}, Unit: libraryUnit{ID: "duplicate-001", EquivalentUnitID: "grammar-001"}},
			}}
			var value map[string]any
			if err := json.Unmarshal([]byte(base), &value); err != nil {
				t.Fatal(err)
			}
			tc.edit(value)
			raw, err := json.Marshal(value)
			if err != nil {
				t.Fatal(err)
			}
			if err = os.WriteFile(filepath.Join(s.content, "study-route.json"), raw, 0600); err != nil {
				t.Fatal(err)
			}
			if err = s.loadStudyRoute(); (err != nil) != tc.wantError {
				t.Fatalf("loadStudyRoute error = %v; want error %v", err, tc.wantError)
			}
			if tc.wantError && len(s.studyRoute) > 0 {
				t.Fatal("invalid route exposed")
			}
		})
	}
}

func TestShippedStudyRouteUsesOnlyCurrentCanonicalSources(t *testing.T) {
	content := filepath.Join("..", "..", "content")
	s := &Server{content: content, libraryUnits: map[string]libraryEntry{}}
	files, err := filepath.Glob(filepath.Join(content, "courses", "*.json"))
	if err != nil {
		t.Fatal(err)
	}
	for _, file := range append(files, filepath.Join(content, "curriculum.json")) {
		raw, err := os.ReadFile(file)
		if err != nil {
			t.Fatal(err)
		}
		var lessons []Lesson
		if err = json.Unmarshal(raw, &lessons); err != nil {
			t.Fatal(err)
		}
		s.lessons = append(s.lessons, lessons...)
	}
	raw, err := os.ReadFile(filepath.Join(content, "library.json"))
	if err != nil {
		t.Fatal(err)
	}
	var catalog struct {
		Books []libraryBook `json:"books"`
	}
	if err = json.Unmarshal(raw, &catalog); err != nil {
		t.Fatal(err)
	}
	for _, book := range catalog.Books {
		for _, unit := range book.Units {
			s.libraryUnits[unit.ID] = libraryEntry{Book: book, Unit: unit}
		}
	}
	if err = s.loadStudyRoute(); err != nil {
		t.Fatal(err)
	}
	if len(s.studyRoute) == 0 {
		t.Fatal("shipped route missing")
	}
}
