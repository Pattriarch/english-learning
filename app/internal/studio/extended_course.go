package studio

import (
	"errors"
	"path/filepath"
	"strings"
	"sync"
)

// Only this course is generated incrementally. Other startup curricula remain
// immutable, and each accepted course snapshot is replaced as a whole.
type extendedCourseCache struct {
	sync.Mutex
	stamp      string
	startupIDs map[string]bool
	lessons    []Lesson
}

func isExtendedCoursePath(content, path string) bool {
	return filepath.Clean(path) == filepath.Join(filepath.Clean(content), "courses", "extended-skills.json")
}

func validateExtendedCourse(lessons []Lesson, reserved map[string]bool) error {
	if len(lessons) == 0 {
		return errors.New("extended course contains no prepared lessons")
	}
	seen := make(map[string]bool, len(lessons))
	for _, lesson := range lessons {
		if !strings.HasPrefix(lesson.ID, "extended-") || seen[lesson.ID] || reserved[lesson.ID] {
			return errors.New("invalid or duplicate extended lesson ID")
		}
		if err := validateLesson(lesson); err != nil {
			return err
		}
		seen[lesson.ID] = true
	}
	return nil
}

// Protect the accepted snapshot from callers changing a returned exercise or
// material slice. Strings themselves are immutable; only slice storage copies.
func copyExtendedLessons(source []Lesson) []Lesson {
	result := make([]Lesson, len(source))
	for i, lesson := range source {
		lesson.Sections = append([]Section(nil), lesson.Sections...)
		lesson.Examples = append([]Example(nil), lesson.Examples...)
		lesson.Materials = append([]LessonMaterial(nil), lesson.Materials...)
		for j := range lesson.Materials {
			if lesson.Materials[j].Figure != nil {
				figure := *lesson.Materials[j].Figure
				lesson.Materials[j].Figure = &figure
			}
		}
		lesson.Exercises = append([]Exercise(nil), lesson.Exercises...)
		for j := range lesson.Exercises {
			lesson.Exercises[j].Answers = append([]string(nil), lesson.Exercises[j].Answers...)
			lesson.Exercises[j].MaterialIDs = append([]string(nil), lesson.Exercises[j].MaterialIDs...)
		}
		result[i] = lesson
	}
	return result
}

// Called only during loadContent, after the exact source file was validated.
// Recording its IDs avoids treating similarly named lessons in other files as
// part of this reloadable course.
func (s *Server) seedExtendedCourse(lessons []Lesson) {
	c := &s.extendedCourse
	c.Lock()
	defer c.Unlock()
	c.startupIDs = make(map[string]bool, len(lessons))
	for _, lesson := range lessons {
		c.startupIDs[lesson.ID] = true
	}
	c.lessons = copyExtendedLessons(lessons)
}

func (s *Server) currentExtendedCourse() ([]Lesson, map[string]bool) {
	c := &s.extendedCourse
	c.Lock()
	defer c.Unlock()
	path := filepath.Join(s.content, "courses", "extended-skills.json")
	stamp := bookFileStamp(path)
	if stamp != c.stamp {
		// Remember rejected stamps too: keep the last valid course, and retry
		// when the publisher changes the file instead of parsing it per request.
		c.stamp = stamp
		var candidate []Lesson
		if err := readBookJSON(path, &candidate); err == nil {
			reserved := make(map[string]bool, len(s.lessons))
			for _, lesson := range s.lessons {
				if !c.startupIDs[lesson.ID] {
					reserved[lesson.ID] = true
				}
			}
			if validateExtendedCourse(candidate, reserved) == nil {
				c.lessons = candidate
			}
		}
	}
	return copyExtendedLessons(c.lessons), c.startupIDs
}
