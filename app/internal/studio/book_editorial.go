package studio

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strings"
)

// An editorial edition is tied to exact published bytes. It cannot bypass
// source verification, mutate the preserved edition, or inherit old answers.
type bookEditorial struct {
	Version          int        `json:"version"`
	UnitID           string     `json:"unitId"`
	BaseLessonSHA256 string     `json:"baseLessonSHA256"`
	ReviewedAt       string     `json:"reviewedAt"`
	Notes            string     `json:"notes"`
	Title            string     `json:"title"`
	Goal             string     `json:"goal"`
	Formula          string     `json:"formula"`
	Minutes          int        `json:"minutes"`
	Beginner         bool       `json:"beginner"`
	Sections         []Section  `json:"sections"`
	Examples         []Example  `json:"examples"`
	Exercises        []Exercise `json:"exercises"`
}

type bookEditorialInfo struct {
	Version    int    `json:"version"`
	ReviewedAt string `json:"reviewedAt"`
	Notes      string `json:"notes"`
}

func (s *Server) applyBookEditorial(id string, baseBytes []byte, base bookLesson) (bookLesson, error) {
	raw, err := readBookBytes(filepath.Join(s.content, "book-editorial", id+".json"))
	if errors.Is(err, os.ErrNotExist) {
		return base, nil
	}
	if err != nil {
		return base, err
	}
	var edit bookEditorial
	if err := json.Unmarshal(raw, &edit); err != nil {
		return base, err
	}
	digest := sha256.Sum256(baseBytes)
	if edit.Version != 1 || edit.UnitID != id || edit.BaseLessonSHA256 != hex.EncodeToString(digest[:]) ||
		strings.TrimSpace(edit.ReviewedAt) == "" || strings.TrimSpace(edit.Notes) == "" || base.StudyPlan != nil {
		return base, errors.New("book editorial edition does not match its reviewed source")
	}
	// Keep the original coverage anchors and task IDs. A rewrite must still
	// address every original section and exercise, not silently omit topics.
	if len(edit.Sections) != len(base.Sections) || len(edit.Exercises) != len(base.Exercises) || len(edit.Examples) < 4 {
		return base, errors.New("book editorial edition has incomplete coverage")
	}
	for i, section := range edit.Sections {
		if section.Title != base.Sections[i].Title || strings.TrimSpace(section.Body) == "" {
			return base, errors.New("book editorial section lost its source anchor")
		}
	}
	for i, task := range edit.Exercises {
		old := base.Exercises[i]
		if task.ID != old.ID || task.Revision <= old.Revision || bookExerciseVersion(task) == bookExerciseVersion(old) {
			return base, fmt.Errorf("book editorial task needs a distinct current version: %s", task.ID)
		}
	}
	base.Title, base.Goal, base.Formula, base.Minutes = edit.Title, edit.Goal, edit.Formula, edit.Minutes
	base.Beginner = edit.Beginner
	base.Sections, base.Examples, base.Exercises = edit.Sections, edit.Examples, edit.Exercises
	if err := validateLesson(base.Lesson); err != nil {
		return base, err
	}
	base.Editorial = &bookEditorialInfo{Version: edit.Version, ReviewedAt: edit.ReviewedAt, Notes: edit.Notes}
	return base, nil
}
