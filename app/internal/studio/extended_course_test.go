package studio

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func extendedFixtureLesson(id, materialID, text string) Lesson {
	lesson := contentLesson(id)
	lesson.Materials = []LessonMaterial{{ID: materialID, Title: "Read this source", Kind: "reading", Text: text, Source: "original"}}
	lesson.Exercises[0].MaterialIDs = []string{materialID}
	return lesson
}

func lessonMap(lessons []Lesson) map[string]Lesson {
	result := make(map[string]Lesson, len(lessons))
	for _, lesson := range lessons {
		result[lesson.ID] = lesson
	}
	return result
}

func TestExtendedCoursePublishesWithoutRestartAndUpdatesExerciseMaterials(t *testing.T) {
	content, data := contentFixture(t)
	s := openFixture(t, content, data)
	startup := copyExtendedLessons(s.lessons)
	if len(s.allLessons()) != 1 {
		t.Fatal("unexpected initial lessons")
	}
	path := filepath.Join(content, "courses", "extended-skills.json")
	first := extendedFixtureLesson("extended-reading", "m1", "The original source describes a crowded train.")
	writeFixture(t, path, []Lesson{first})
	w := call(t, s, "GET", "/api/bootstrap", nil)
	var result struct {
		Lessons []Lesson `json:"lessons"`
	}
	if w.Code != 200 || json.Unmarshal(w.Body.Bytes(), &result) != nil || len(result.Lessons) != 2 || lessonMap(result.Lessons)[first.ID].ID != first.ID {
		t.Fatal("newly published course not visible to bootstrap", w.Body.String())
	}
	updated := extendedFixtureLesson(first.ID, "new-source", "This updated passage describes a quiet bus and its new timetable.")
	second := extendedFixtureLesson("extended-listening", "audio-script", "A new announcement for passengers.")
	writeFixture(t, path, []Lesson{updated, second})
	lesson, exercise, ok := s.findExercise(first.ID, "e1")
	if !ok || !reflect.DeepEqual(exercise.MaterialIDs, []string{"new-source"}) || lesson.Materials[0].Text != updated.Materials[0].Text {
		t.Fatal("exercise lookup returned stale material references", lesson, exercise)
	}
	if len(s.allLessons()) != 3 || !reflect.DeepEqual(s.lessons, startup) {
		t.Fatal("hot publication changed startup courses or lost a new lesson")
	}
}

func TestExtendedCourseInvalidSnapshotsPreserveLastGood(t *testing.T) {
	content, data := contentFixture(t)
	s := openFixture(t, content, data)
	path := filepath.Join(content, "courses", "extended-skills.json")
	good := extendedFixtureLesson("extended-kept", "m1", "The last valid passage must remain available.")
	writeFixture(t, path, []Lesson{good})
	if lessonMap(s.allLessons())[good.ID].ID == "" {
		t.Fatal("could not establish the last valid snapshot")
	}
	badReference := extendedFixtureLesson("extended-bad-reference", "m1", "A valid-looking passage.")
	badReference.Exercises[0].MaterialIDs = []string{"does-not-exist"}
	for name, candidate := range map[string]any{
		"empty": []Lesson{}, "null": nil, "duplicate": []Lesson{good, good},
		"base-ID": []Lesson{contentLesson("base")}, "wrong-namespace": []Lesson{contentLesson("generated-other")},
		"missing-material": []Lesson{badReference}, "incomplete": []Lesson{{ID: "extended-incomplete", Title: "A shell"}},
	} {
		t.Run(name, func(t *testing.T) {
			writeFixture(t, path, candidate)
			lessons := s.allLessons()
			if len(lessons) != 2 || !reflect.DeepEqual(lessonMap(lessons)[good.ID], good) {
				t.Fatal("invalid snapshot replaced the last good course", lessons)
			}
		})
	}
	if err := os.WriteFile(path, []byte("[{unfinished"), 0600); err != nil {
		t.Fatal(err)
	}
	if len(s.allLessons()) != 2 {
		t.Fatal("corrupt JSON removed the accepted course")
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if len(s.allLessons()) != 2 {
		t.Fatal("temporarily absent file removed the accepted course")
	}
	// A later valid file must recover after any previously cached failure.
	newLesson := extendedFixtureLesson("extended-recovered", "m2", "A newly completed source.")
	writeFixture(t, path, []Lesson{newLesson})
	if lessons := lessonMap(s.allLessons()); lessons[newLesson.ID].ID == "" || lessons[good.ID].ID != "" {
		t.Fatal("a valid replacement could not supersede the previous snapshot", lessons)
	}
}

func TestExtendedCourseReplacesOnlyItsOwnStartupLessons(t *testing.T) {
	content, data := contentFixture(t)
	path := filepath.Join(content, "courses", "extended-skills.json")
	old := extendedFixtureLesson("extended-old", "m1", "The startup version.")
	writeFixture(t, path, []Lesson{old})
	reserved := extendedFixtureLesson("extended-other-course", "other", "A static lesson from another course.")
	writeFixture(t, filepath.Join(content, "courses", "other-course.json"), []Lesson{reserved})
	s := openFixture(t, content, data)
	startup := copyExtendedLessons(s.lessons)
	newLesson := extendedFixtureLesson("extended-new", "m2", "The replacement is a new valid snapshot.")
	writeFixture(t, path, []Lesson{newLesson})
	lessons := lessonMap(s.allLessons())
	if len(lessons) != 3 || lessons[old.ID].ID != "" || !reflect.DeepEqual(lessons[reserved.ID], reserved) || lessons[newLesson.ID].ID == "" {
		t.Fatal("the hot course did not replace only its own startup entries", lessons)
	}
	writeFixture(t, path, []Lesson{newLesson, extendedFixtureLesson(reserved.ID, "override", "An attempt to overwrite another course.")})
	lessons = lessonMap(s.allLessons())
	if len(lessons) != 3 || !reflect.DeepEqual(lessons[reserved.ID], reserved) || !reflect.DeepEqual(s.lessons, startup) {
		t.Fatal("hot publication overwrote a static course")
	}
}

func TestExtendedCourseReturnedSlicesCannotMutateCachedSnapshot(t *testing.T) {
	content, data := contentFixture(t)
	good := extendedFixtureLesson("extended-immutable", "m1", "An immutable source passage.")
	writeFixture(t, filepath.Join(content, "courses", "extended-skills.json"), []Lesson{good})
	s := openFixture(t, content, data)
	startup := copyExtendedLessons(s.lessons)
	lesson, exercise, ok := s.findExercise(good.ID, "e1")
	if !ok {
		t.Fatal("fixture missing")
	}
	lesson.Materials[0].Text = "Changed by caller"
	lesson.Sections[0].Body = "Changed by caller"
	lesson.Examples[0].English = "Changed by caller"
	exercise.Answers[0] = "Changed by caller"
	exercise.MaterialIDs[0] = "Changed by caller"
	if actual := lessonMap(s.allLessons())[good.ID]; !reflect.DeepEqual(actual, good) || !reflect.DeepEqual(s.lessons, startup) {
		t.Fatal("returned data mutated the accepted cache or startup lessons", actual)
	}
}

func TestExtendedCourseEmptyOrCorruptFirstPublicationDoesNotCreateReadyLesson(t *testing.T) {
	content, data := contentFixture(t)
	s := openFixture(t, content, data)
	path := filepath.Join(content, "courses", "extended-skills.json")
	writeFixture(t, path, []Lesson{})
	if len(s.allLessons()) != 1 {
		t.Fatal("empty snapshot created a ready lesson")
	}
	if err := os.WriteFile(path, []byte("not a lesson array"), 0600); err != nil {
		t.Fatal(err)
	}
	if len(s.allLessons()) != 1 {
		t.Fatal("corrupt snapshot created a ready lesson")
	}
}
