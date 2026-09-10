package studio

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

// Book lessons live outside the learner's progress. A batch can add a lesson
// atomically while the application is running, without rebuilding bootstrap.
type parsedBookUnit struct {
	UnitID string `json:"unitId"`
	BookID string `json:"bookId"`
	Pages  []int  `json:"pages"`
	Text   string `json:"text"`
	Source string `json:"source"`
}

type bookSourceImage struct {
	Page   int    `json:"page"`
	SHA256 string `json:"sha256"`
}

type bookLesson struct {
	Lesson
	Provenance struct {
		UnitID         string `json:"unitId"`
		BookID         string `json:"bookId"`
		Pages          []int  `json:"pages"`
		Source         string `json:"source"`
		SourceHash     string `json:"sourceHash"`
		SourceCoverage []struct {
			Point        string `json:"point"`
			SectionTitle string `json:"sectionTitle"`
		} `json:"sourceCoverage"`
		Warnings         []string          `json:"warnings"`
		VisualSourceUsed bool              `json:"visualSourceUsed,omitempty"`
		SourceImages     []bookSourceImage `json:"sourceImages,omitempty"`
		VisualCoverage   json.RawMessage   `json:"visualCoverage,omitempty"`
	} `json:"provenance"`
}

func (s *Server) canonicalBookUnit(id string) string {
	entry, ok := s.libraryUnits[id]
	if !ok {
		return ""
	}
	if alias := entry.Unit.EquivalentUnitID; alias != "" {
		if target, exists := s.libraryUnits[alias]; exists && target.Book.DuplicateOf == "" {
			return alias
		}
	}
	return id
}

func readBookJSON(path string, target any) error {
	raw, err := readBookBytes(path)
	if err != nil {
		return err
	}
	return json.Unmarshal(raw, target)
}

func readBookBytes(path string) ([]byte, error) {
	info, err := os.Stat(path)
	if err != nil {
		return nil, err
	}
	if info.Size() > 8<<20 {
		return nil, errors.New("book file too large")
	}
	return os.ReadFile(path)
}

func (s *Server) parsedBookSource(id string) (parsedBookUnit, bool) {
	entry, ok := s.libraryUnits[id]
	if !ok {
		return parsedBookUnit{}, false
	}
	var source parsedBookUnit
	err := readBookJSON(filepath.Join(s.content, "..", "data", "parsed-books", id+".json"), &source)
	valid := err == nil && source.UnitID == id && source.BookID == entry.Book.ID &&
		len(source.Pages) == 2 && source.Pages[0] == entry.Unit.Page && source.Pages[1] == entry.Unit.EndPage &&
		strings.TrimSpace(source.Text) != "" && (source.Source == "text-layer-layout" || source.Source == "ocr")
	return source, valid
}

func (s *Server) loadBookLesson(id string) (bookLesson, error) {
	return s.loadBookLessonWithRelease(id, nil)
}

func (s *Server) loadBookLessonWithRelease(id string, release *bookRelease) (bookLesson, error) {
	id = s.canonicalBookUnit(id)
	if id == "" {
		return bookLesson{}, os.ErrNotExist
	}
	var lesson bookLesson
	raw, err := readBookBytes(filepath.Join(s.content, "book-lessons", id+".json"))
	if err != nil {
		return lesson, err
	}
	if err := json.Unmarshal(raw, &lesson); err != nil {
		return lesson, err
	}
	entry := s.libraryUnits[id]
	p := lesson.Provenance
	if lesson.ID != "book-"+id || p.UnitID != id || p.BookID != entry.Book.ID ||
		!validBookSHA256(p.SourceHash) || len(p.Pages) != 2 ||
		p.Pages[0] != entry.Unit.Page || p.Pages[1] != entry.Unit.EndPage ||
		(p.Source != "text-layer-layout" && p.Source != "ocr") {
		return lesson, errors.New("lesson source needs review")
	}
	if err := validateLesson(lesson.Lesson); err != nil {
		return lesson, err
	}
	if len(lesson.Sections) < 4 || len(lesson.Examples) < 4 || len(lesson.Exercises) < 8 || len(p.SourceCoverage) == 0 {
		return lesson, errors.New("incomplete book lesson")
	}
	sectionTitles := map[string]bool{}
	for _, section := range lesson.Sections {
		sectionTitles[section.Title] = true
	}
	for _, coverage := range p.SourceCoverage {
		if strings.TrimSpace(coverage.Point) == "" || !sectionTitles[coverage.SectionTitle] {
			return lesson, errors.New("unmapped source teaching point")
		}
	}
	// The portable release only substitutes absent private artifacts. A source
	// that is present but changed, unreadable or corrupt must still be rejected.
	missingPrivate := false
	sourcePath := filepath.Join(s.content, "..", "data", "parsed-books", id+".json")
	if _, err := os.Stat(sourcePath); errors.Is(err, os.ErrNotExist) {
		missingPrivate = true
	} else {
		source, ok := s.parsedBookSource(id)
		hash := sha256.Sum256([]byte(source.Text))
		if err != nil || !ok || source.Source != p.Source || p.SourceHash != hex.EncodeToString(hash[:]) {
			return lesson, errors.New("lesson source needs review")
		}
	}
	if p.VisualSourceUsed {
		if len(p.SourceImages) != 2 {
			return lesson, errors.New("missing source images")
		}
		for i, sourceImage := range p.SourceImages {
			if sourceImage.Page != p.Pages[i] || !validBookSHA256(sourceImage.SHA256) {
				return lesson, errors.New("wrong source image page")
			}
			imageBytes, err := os.ReadFile(filepath.Join(s.content, "..", "data", "book-page-images", p.BookID, strconv.Itoa(sourceImage.Page)+".jpg"))
			if errors.Is(err, os.ErrNotExist) {
				missingPrivate = true
				continue
			}
			imageHash := sha256.Sum256(imageBytes)
			if err != nil || sourceImage.SHA256 != hex.EncodeToString(imageHash[:]) {
				return lesson, errors.New("source image changed")
			}
		}
	}
	if missingPrivate {
		if release == nil {
			release = s.readBookRelease()
		}
		if !release.matches(id, raw, lesson) {
			return lesson, errors.New("private source unavailable and lesson has no matching release")
		}
	}
	return lesson, nil
}

// Keep this wire-format hash in sync with book-reader.js. A learner can keep a
// question open while its lesson is replaced, so the exercise's ID alone is not
// enough to identify the question that their answer belongs to.
func bookExerciseVersion(exercise Exercise) string {
	fields := []string{exercise.Kind, exercise.Prompt, exercise.Context, exercise.Hint, exercise.Explanation, strings.Join(exercise.Answers, "\x1e")}
	hash := sha256.Sum256([]byte(strings.Join(fields, "\x1f")))
	return hex.EncodeToString(hash[:8])
}

func (s *Server) bookExercise(lessonID, exerciseID string) (Lesson, Exercise, bool) {
	baseID, version := exerciseID, ""
	separator := strings.LastIndex(exerciseID, "--")
	if separator >= 0 {
		baseID, version = exerciseID[:separator], exerciseID[separator+2:]
	}
	id := strings.TrimPrefix(lessonID, "book-")
	lesson, err := s.loadBookLesson(id)
	if err == nil && lesson.ID == lessonID {
		for _, exercise := range lesson.Exercises {
			if exercise.ID == exerciseID {
				return lesson.Lesson, exercise, true
			}
			if separator >= 0 && exercise.ID == baseID && version == bookExerciseVersion(exercise) {
				exercise.ID = exerciseID
				return lesson.Lesson, exercise, true
			}
		}
	}
	return Lesson{}, Exercise{}, false
}

func (s *Server) bookBuildStatus() map[string]any {
	var stored struct {
		State     string `json:"state"`
		UpdatedAt string `json:"updatedAt"`
		Units     map[string]struct {
			Status      string `json:"status"`
			BuildStatus string `json:"buildStatus"`
			VisualReady bool   `json:"visualReady"`
		} `json:"units"`
	}
	if err := readBookJSON(filepath.Join(s.web, "book-content", "status.json"), &stored); err != nil {
		_ = readBookJSON(filepath.Join(s.content, "..", "data", "book-build-status.json"), &stored)
	}
	release, releaseStamp := s.bookReleaseSnapshot()
	if stored.UpdatedAt == "" && release != nil {
		stored.UpdatedAt = release.PublishedAt
	}
	units := map[string]map[string]any{}
	books := map[string]map[string]int{}
	total, ready, visualReady, running, failed := 0, 0, 0, 0, 0
	for id, entry := range s.libraryUnits {
		if entry.Book.DuplicateOf != "" {
			continue
		}
		total++
		if books[entry.Book.ID] == nil {
			books[entry.Book.ID] = map[string]int{"total": 0, "ready": 0, "visualReady": 0}
		}
		books[entry.Book.ID]["total"]++
		unit := stored.Units[id]
		status := "pending"
		buildStatus := unit.BuildStatus
		if buildStatus == "" {
			buildStatus = unit.Status
		}
		available, visual := s.bookAvailability(id, releaseStamp, release)
		if available {
			status = "ready"
			ready++
			books[entry.Book.ID]["ready"]++
			if buildStatus == "" {
				buildStatus = "ready"
			}
		} else if buildStatus == "ready" {
			buildStatus = "pending"
		}
		// An available lesson can be upgraded by the batch at the same time.
		// Availability and build work are independent counters, not one enum.
		switch buildStatus {
		case "running":
			running++
		case "failed":
			failed++
		case "ready", "queued", "waiting-source", "paused":
		default:
			buildStatus = "pending"
		}
		if visual {
			visualReady++
			books[entry.Book.ID]["visualReady"]++
		}
		units[id] = map[string]any{"status": status, "buildStatus": buildStatus, "visualReady": visual}
	}
	if stored.State == "" || stored.State == "complete" {
		stored.State = "partial"
		if ready == total && total > 0 {
			stored.State = "complete"
		}
	}
	// Keep private model diagnostics, source text and machine paths off bootstrap.
	return map[string]any{"state": stored.State, "updatedAt": stored.UpdatedAt, "total": total, "ready": ready, "visualReady": visualReady, "running": running, "failed": failed, "units": units, "books": books}
}

func (s *Server) libraryStatus(w http.ResponseWriter, r *http.Request) {
	jsonResponse(w, 200, s.bookBuildStatus())
}
