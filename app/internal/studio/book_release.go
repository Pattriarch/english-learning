package studio

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
)

// This reviewed, version-controlled inventory pins the complete bytes of each
// lesson validated locally by publish_book_release.py. It contains no PDF/OCR.
type bookRelease struct {
	Version     int                        `json:"version"`
	PublishedAt string                     `json:"publishedAt"`
	Units       map[string]bookReleaseUnit `json:"units"`
}

type bookReleaseUnit struct {
	LessonID         string            `json:"lessonId"`
	BookID           string            `json:"bookId"`
	Pages            []int             `json:"pages"`
	LessonSHA256     string            `json:"lessonSHA256"`
	Source           string            `json:"source"`
	SourceHash       string            `json:"sourceHash"`
	VisualSourceUsed bool              `json:"visualSourceUsed"`
	SourceImages     []bookSourceImage `json:"sourceImages,omitempty"`
}

func validBookSHA256(value string) bool {
	if len(value) != 64 || strings.ToLower(value) != value {
		return false
	}
	_, err := hex.DecodeString(value)
	return err == nil
}

func (s *Server) readBookRelease() *bookRelease {
	release, _ := s.bookReleaseSnapshot()
	return release
}

func (s *Server) bookReleaseSnapshot() (*bookRelease, string) {
	path := filepath.Join(s.content, "book-release.json")
	raw, err := readBookBytes(path)
	if err != nil {
		return nil, bookFileStamp(path)
	}
	// Hash the small manifest's actual bytes, avoiding a read/stat race when a
	// publisher atomically replaces it during a status request.
	hash := sha256.Sum256(raw)
	stamp := hex.EncodeToString(hash[:])
	var release bookRelease
	if err := json.Unmarshal(raw, &release); err != nil || release.Version != 1 {
		return nil, stamp
	}
	return &release, stamp
}

func (r *bookRelease) matches(id string, raw []byte, lesson bookLesson) bool {
	if r == nil || r.Version != 1 {
		return false
	}
	unit, ok := r.Units[id]
	p := lesson.Provenance
	hash := sha256.Sum256(raw)
	if !ok || unit.LessonSHA256 != hex.EncodeToString(hash[:]) ||
		unit.LessonID != lesson.ID || unit.BookID != p.BookID ||
		unit.Source != p.Source || unit.SourceHash != p.SourceHash ||
		len(unit.Pages) != 2 || unit.Pages[0] != p.Pages[0] || unit.Pages[1] != p.Pages[1] ||
		unit.VisualSourceUsed != p.VisualSourceUsed || len(unit.SourceImages) != len(p.SourceImages) {
		return false
	}
	for i, sourceImage := range unit.SourceImages {
		if sourceImage != p.SourceImages[i] {
			return false
		}
	}
	return true
}

type bookReadiness struct {
	Stamp  string
	Ready  bool
	Visual bool
}

type bookReadinessCache struct {
	sync.Mutex
	units map[string]bookReadiness
}

func bookFileStamp(path string) string {
	info, err := os.Stat(path)
	if errors.Is(err, os.ErrNotExist) {
		return "missing"
	}
	if err != nil {
		return "unreadable"
	}
	return fmt.Sprintf("%d:%d:%s", info.Size(), info.ModTime().UnixNano(), info.Mode())
}

// Status polling stats the dependencies instead of re-hashing the page-image
// collection every time. Opening/grading a lesson always uses the strict loader
// above, independently of this availability-only cache.
func (s *Server) bookAvailability(id, releaseStamp string, release *bookRelease) (bool, bool) {
	entry := s.libraryUnits[id]
	stamps := []string{entry.Book.ID, strconv.Itoa(entry.Unit.Page), strconv.Itoa(entry.Unit.EndPage), releaseStamp,
		bookFileStamp(filepath.Join(s.content, "book-lessons", id+".json")),
		bookFileStamp(filepath.Join(s.content, "..", "data", "parsed-books", id+".json")),
	}
	for _, page := range []int{entry.Unit.Page, entry.Unit.EndPage} {
		stamps = append(stamps, bookFileStamp(filepath.Join(s.content, "..", "data", "book-page-images", entry.Book.ID, strconv.Itoa(page)+".jpg")))
	}
	stamp := strings.Join(stamps, "|")
	s.bookReadiness.Lock()
	defer s.bookReadiness.Unlock()
	if previous, ok := s.bookReadiness.units[id]; ok && previous.Stamp == stamp {
		return previous.Ready, previous.Visual
	}
	lesson, err := s.loadBookLessonWithRelease(id, release)
	ready := err == nil
	visual := ready && lesson.Provenance.VisualSourceUsed
	if s.bookReadiness.units == nil {
		s.bookReadiness.units = make(map[string]bookReadiness)
	}
	s.bookReadiness.units[id] = bookReadiness{Stamp: stamp, Ready: ready, Visual: visual}
	return ready, visual
}

// These routes replace the generator's optional ignored web copies. The lesson
// returned to planner/old-client consumers has passed the same checks as /unit.
func (s *Server) releasedBookContent(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	id := strings.TrimSuffix(name, ".json")
	if id == name || !safeID.MatchString(id) {
		http.NotFound(w, r)
		return
	}
	lesson, err := s.loadBookLesson(id)
	if err != nil {
		http.NotFound(w, r)
		return
	}
	jsonResponse(w, http.StatusOK, lesson)
}
