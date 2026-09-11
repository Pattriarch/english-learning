package studio

import (
	"encoding/json"
	"fmt"
	"path/filepath"
	"strings"
)

type studyRoute struct {
	Version           int      `json:"version"`
	OverviewLessonIDs []string `json:"overviewLessonIds"`
	Relations         []struct {
		LessonID string `json:"lessonId"`
		Kind     string `json:"kind"`
		ID       string `json:"id"`
		Title    string `json:"title"`
		Relation string `json:"relation"`
	} `json:"relations"`
	Deepening []struct {
		LessonID      string `json:"lessonId"`
		AfterLessonID string `json:"afterLessonId"`
		Reason        string `json:"reason"`
	} `json:"deepening"`
}

// The route describes presentation and sequencing, never equivalent credit.
// In particular a shared core does not make two whole chapters interchangeable.
func (s *Server) loadStudyRoute() error {
	raw, err := optionalJSON(filepath.Join(s.content, "study-route.json"))
	if err != nil || len(raw) == 0 {
		return err
	}
	var route studyRoute
	if err = json.Unmarshal(raw, &route); err != nil {
		return fmt.Errorf("study-route.json: %w", err)
	}
	lessons := map[string]bool{}
	for _, lesson := range s.lessons {
		if !strings.HasPrefix(lesson.ID, "cinema-") {
			lessons[lesson.ID] = true
		}
	}
	if route.Version != 1 {
		return fmt.Errorf("study-route.json: unsupported version")
	}
	overviews := map[string]bool{}
	for _, id := range route.OverviewLessonIDs {
		if !lessons[id] || overviews[id] {
			return fmt.Errorf("study-route.json: unknown or duplicate overview %q", id)
		}
		overviews[id] = true
	}
	relations := map[string]bool{}
	for _, relation := range route.Relations {
		key := relation.LessonID + ":" + relation.Kind + ":" + relation.ID
		validTarget := false
		switch relation.Kind {
		case "lesson":
			validTarget = lessons[relation.ID] && relation.ID != relation.LessonID
		case "book":
			entry, ok := s.libraryUnits[relation.ID]
			validTarget = ok && entry.Book.DuplicateOf == "" && entry.Unit.EquivalentUnitID == ""
		}
		if !lessons[relation.LessonID] || overviews[relation.LessonID] || !validTarget ||
			strings.TrimSpace(relation.Title) == "" || relations[key] ||
			(relation.Relation != "alternative" && relation.Relation != "related") {
			return fmt.Errorf("study-route.json: invalid source relation %q", key)
		}
		relations[key] = true
	}
	parents := map[string]string{}
	for _, step := range route.Deepening {
		if !lessons[step.LessonID] || !lessons[step.AfterLessonID] ||
			overviews[step.LessonID] || overviews[step.AfterLessonID] ||
			step.LessonID == step.AfterLessonID || parents[step.LessonID] != "" ||
			strings.TrimSpace(step.Reason) == "" {
			return fmt.Errorf("study-route.json: invalid deepening %q", step.LessonID)
		}
		parents[step.LessonID] = step.AfterLessonID
	}
	for id := range parents {
		seen := map[string]bool{}
		for current := id; current != ""; current = parents[current] {
			if seen[current] {
				return fmt.Errorf("study-route.json: cyclic deepening %q", id)
			}
			seen[current] = true
		}
	}
	s.studyRoute = raw
	return nil
}
