package studio

import (
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// Guides add a gentle entry to the published material. They do not rewrite a
// book release, invalidate its receipts, or reuse an old answer for a new task.
type CourseGuideSource struct {
	ID    string `json:"id"`
	Title string `json:"title"`
	URL   string `json:"url"`
	Kind  string `json:"kind"`
	Notes string `json:"notes"`
}
type CourseGuide struct {
	LessonID       string              `json:"lessonId"`
	Prerequisites  []string            `json:"prerequisites"`
	Purpose        string              `json:"purpose"`
	Explanation    []Section           `json:"explanation"`
	Examples       []Example           `json:"examples"`
	Practice       []Exercise          `json:"practice"`
	Replacements   []Exercise          `json:"replacements,omitempty"`
	BeforePractice string              `json:"beforePractice"`
	SourceIDs      []string            `json:"sourceIds"`
	Sources        []CourseGuideSource `json:"sources,omitempty"`
}

func (s *Server) loadCourseGuides() error {
	s.courseGuides = map[string]CourseGuide{}
	paths, err := filepath.Glob(filepath.Join(s.content, "course-guides-*.json"))
	if err != nil {
		return err
	}
	known := map[string]Lesson{}
	for _, l := range s.lessons {
		known[l.ID] = l
	}
	for _, path := range paths {
		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		var set struct {
			Version int                 `json:"version"`
			Sources []CourseGuideSource `json:"sources"`
			Lessons []CourseGuide       `json:"lessons"`
		}
		if err = json.Unmarshal(raw, &set); err != nil {
			return fmt.Errorf("course guide %s: %w", path, err)
		}
		if set.Version != 1 {
			return fmt.Errorf("unsupported course guide version: %s", path)
		}
		sources := map[string]CourseGuideSource{}
		for _, source := range set.Sources {
			if !safeID.MatchString(source.ID) || !strings.HasPrefix(source.URL, "https://") || source.Title == "" {
				return fmt.Errorf("invalid course guide source: %s", path)
			}
			sources[source.ID] = source
		}
		for _, g := range set.Lessons {
			l, ok := known[g.LessonID]
			if _, duplicate := s.courseGuides[g.LessonID]; !ok || duplicate || g.Purpose == "" || len(g.Explanation) < 3 || len(g.Examples) < 2 || g.BeforePractice == "" || len(g.SourceIDs) == 0 {
				return fmt.Errorf("invalid/duplicate course guide %s", g.LessonID)
			}
			for _, section := range g.Explanation {
				if strings.TrimSpace(section.Title) == "" || strings.TrimSpace(section.Body) == "" {
					return fmt.Errorf("empty teaching section: %s", g.LessonID)
				}
			}
			for _, example := range g.Examples {
				if strings.TrimSpace(example.English) == "" || strings.TrimSpace(example.Russian) == "" || strings.TrimSpace(example.Why) == "" {
					return fmt.Errorf("incomplete teaching example: %s", g.LessonID)
				}
			}
			for _, id := range g.Prerequisites {
				if _, ok := known[id]; !ok || id == g.LessonID {
					return fmt.Errorf("missing/self prerequisite %s: %s", g.LessonID, id)
				}
			}
			ids := map[string]bool{}
			originals := map[string]Exercise{}
			for _, e := range l.Exercises {
				ids[e.ID] = true
				originals[e.ID] = e
			}
			replaced := map[string]bool{}
			for _, e := range g.Replacements {
				old, exists := originals[e.ID]
				if !exists || replaced[e.ID] || e.Revision <= old.Revision {
					return fmt.Errorf("invalid replacement or unchanged revision %s: %s", g.LessonID, e.ID)
				}
				replaced[e.ID] = true
			}
			for i := range g.Practice {
				e := &g.Practice[i]
				if !strings.HasPrefix(e.ID, "prepare-") || ids[e.ID] || e.PracticeStage != "guided" || e.Guidance == nil || len(e.Answers) == 0 {
					return fmt.Errorf("invalid preparation %s: %s", g.LessonID, e.ID)
				}
				if e.Revision == 0 {
					e.Revision = 1
				}
				ids[e.ID] = true
			}
			for _, id := range g.SourceIDs {
				source, ok := sources[id]
				if !ok {
					return fmt.Errorf("missing guide source %s: %s", g.LessonID, id)
				}
				g.Sources = append(g.Sources, source)
			}
			check := l
			check.Exercises = guidedExercises(l.Exercises, g)
			if err := validateLesson(check); err != nil {
				return fmt.Errorf("guide %s: %w", g.LessonID, err)
			}
			s.courseGuides[g.LessonID] = g
		}
	}
	// Detect every dependency cycle, including edges back to the initial course.
	visiting, done := map[string]bool{}, map[string]bool{}
	var visit func(string) error
	visit = func(id string) error {
		if done[id] {
			return nil
		}
		if visiting[id] {
			return fmt.Errorf("course prerequisite cycle: %s", id)
		}
		visiting[id] = true
		deps := known[id].Prerequisites
		if g, ok := s.courseGuides[id]; ok {
			deps = g.Prerequisites
		}
		for _, dep := range deps {
			if err := visit(dep); err != nil {
				return err
			}
		}
		visiting[id] = false
		done[id] = true
		return nil
	}
	for id := range known {
		if err := visit(id); err != nil {
			return err
		}
	}
	return nil
}
func (s *Server) withCourseGuide(l Lesson) Lesson {
	if g, ok := s.courseGuides[l.ID]; ok {
		l.CourseGuide = &g
		l.Prerequisites = append([]string{}, g.Prerequisites...)
		l.Exercises = guidedExercises(l.Exercises, g)
	}
	return l
}

func guidedExercises(original []Exercise, g CourseGuide) []Exercise {
	out := append([]Exercise{}, g.Practice...)
	for _, old := range original {
		e := old
		for _, revised := range g.Replacements {
			if revised.ID == old.ID {
				e = revised
				break
			}
		}
		out = append(out, e)
	}
	return out
}
