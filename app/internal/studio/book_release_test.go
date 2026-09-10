package studio

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
	"time"
)

func releaseBookFixture(t *testing.T, s *Server, id string, lesson bookLesson) bookRelease {
	t.Helper()
	raw, err := os.ReadFile(filepath.Join(s.content, "book-lessons", id+".json"))
	if err != nil {
		t.Fatal(err)
	}
	hash := sha256.Sum256(raw)
	p := lesson.Provenance
	release := bookRelease{Version: 1, PublishedAt: "2026-09-10T12:00:00Z", Units: map[string]bookReleaseUnit{id: {
		LessonID: lesson.ID, BookID: p.BookID, Pages: p.Pages, Source: p.Source, SourceHash: p.SourceHash,
		LessonSHA256: hex.EncodeToString(hash[:]), VisualSourceUsed: p.VisualSourceUsed, SourceImages: p.SourceImages,
	}}}
	writeFixture(t, filepath.Join(s.content, "book-release.json"), release)
	return release
}

func visualReleaseFixture(t *testing.T) (*Server, string, bookLesson) {
	t.Helper()
	s, id, lesson := readyBookFixture(t)
	lesson.Provenance.VisualSourceUsed = true
	for _, page := range lesson.Provenance.Pages {
		raw := []byte("rendered source page " + strconv.Itoa(page))
		hash := sha256.Sum256(raw)
		path := filepath.Join(s.content, "..", "data", "book-page-images", "book-c2", strconv.Itoa(page)+".jpg")
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, raw, 0600); err != nil {
			t.Fatal(err)
		}
		lesson.Provenance.SourceImages = append(lesson.Provenance.SourceImages, bookSourceImage{Page: page, SHA256: hex.EncodeToString(hash[:])})
	}
	writeFixture(t, filepath.Join(s.content, "book-lessons", id+".json"), lesson)
	releaseBookFixture(t, s, id, lesson)
	return s, id, lesson
}

func TestReleasedBooksWorkWithoutPrivateOrPublicCopies(t *testing.T) {
	s, id, lesson := visualReleaseFixture(t)
	// Recreate clean-clone conditions. All paths belong to this test's tempdir.
	if err := os.RemoveAll(filepath.Join(s.content, "..", "data")); err != nil {
		t.Fatal(err)
	}
	s = openFixture(t, s.content, t.TempDir())
	pending := s.libraryUnits[id]
	pending.Unit.ID = "book-c2-002"
	pending.Unit.Page, pending.Unit.EndPage = 12, 13
	s.libraryUnits[pending.Unit.ID] = pending
	if _, err := s.loadBookLesson(id); err != nil {
		t.Fatal("released lesson unavailable without private artifacts", err)
	}
	w := call(t, s, "GET", "/api/library/unit/"+id, nil)
	if w.Code != 200 || !strings.Contains(w.Body.String(), `"lessonStatus":"ready"`) || !strings.Contains(w.Body.String(), `"sourceAvailable":false`) {
		t.Fatal(w.Body.String())
	}
	for _, path := range []string{"/book-content/status.json", "/api/library/status"} {
		w = call(t, s, "GET", path, nil)
		var status struct {
			Total, Ready, VisualReady int
			State                     string
		}
		if err := json.Unmarshal(w.Body.Bytes(), &status); err != nil || w.Code != 200 || status.Total != 2 || status.Ready != 1 || status.VisualReady != 1 || status.State != "partial" {
			t.Fatal("clean clone invented completion", path, w.Body.String(), err)
		}
	}
	w = call(t, s, "GET", "/book-content/"+id+".json", nil)
	var metadata bookLesson
	if err := json.Unmarshal(w.Body.Bytes(), &metadata); err != nil || w.Code != 200 || metadata.ID != lesson.ID || len(metadata.Exercises) != 8 {
		t.Fatal("planner cannot retrieve authoritative exercises", w.Code, w.Body.String(), err)
	}
	ex := lesson.Exercises[0]
	w = call(t, s, "POST", "/api/check", map[string]string{"id": "portable-answer", "lessonId": lesson.ID, "exerciseId": ex.ID + "--" + bookExerciseVersion(ex), "answer": ex.Answers[0]})
	if w.Code != 200 {
		t.Fatal("portable lesson cannot check an answer", w.Code, w.Body.String())
	}
	if w = call(t, s, "GET", "/book-content/book-c2-002.json", nil); w.Code != http.StatusNotFound {
		t.Fatal("pending lesson returned as prepared", w.Code)
	}
}

func TestReleasedLessonRejectsAnyChangedLessonBytes(t *testing.T) {
	s, id, lesson := readyBookFixture(t)
	releaseBookFixture(t, s, id, lesson)
	if err := os.Remove(filepath.Join(s.content, "..", "data", "parsed-books", id+".json")); err != nil {
		t.Fatal(err)
	}
	if s.bookBuildStatus()["ready"] != 1 {
		t.Fatal("release did not start ready")
	}
	path := filepath.Join(s.content, "book-lessons", id+".json")
	file, err := os.OpenFile(path, os.O_APPEND|os.O_WRONLY, 0600)
	if err != nil {
		t.Fatal(err)
	}
	_, err = file.WriteString("\n ") // Valid identical JSON semantics; different pinned bytes.
	_ = file.Close()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := s.loadBookLesson(id); err == nil || s.bookBuildStatus()["ready"] != 0 {
		t.Fatal("unreleased byte change accepted")
	}
	if w := call(t, s, "GET", "/book-content/"+id+".json", nil); w.Code != http.StatusNotFound {
		t.Fatal("public route bypassed release check", w.Code)
	}
}

func TestReleaseNeverMasksPresentInvalidPrivateSources(t *testing.T) {
	for _, scenario := range []string{"source-changed", "source-corrupt", "image-changed", "missing-source-present-bad-image"} {
		t.Run(scenario, func(t *testing.T) {
			s, id, _ := visualReleaseFixture(t)
			if s.bookBuildStatus()["ready"] != 1 {
				t.Fatal("valid fixture not ready")
			}
			source := filepath.Join(s.content, "..", "data", "parsed-books", id+".json")
			image := filepath.Join(s.content, "..", "data", "book-page-images", "book-c2", "10.jpg")
			switch scenario {
			case "source-changed":
				parsed, _ := s.parsedBookSource(id)
				parsed.Text += " Changed teaching material."
				writeFixture(t, source, parsed)
			case "source-corrupt":
				if err := os.WriteFile(source, []byte("not JSON"), 0600); err != nil {
					t.Fatal(err)
				}
			case "missing-source-present-bad-image":
				if err := os.Remove(source); err != nil {
					t.Fatal(err)
				}
				fallthrough
			case "image-changed":
				if err := os.WriteFile(image, []byte("wrong image bytes"), 0600); err != nil {
					t.Fatal(err)
				}
			}
			if _, err := s.loadBookLesson(id); err == nil || s.bookBuildStatus()["ready"] != 0 {
				t.Fatal("release masked a changed local artifact")
			}
		})
	}
}

func TestReleaseAllowsPartiallyAbsentPrivateArtifacts(t *testing.T) {
	s, id, _ := visualReleaseFixture(t)
	if err := os.Remove(filepath.Join(s.content, "..", "data", "book-page-images", "book-c2", "11.jpg")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.loadBookLesson(id); err != nil {
		t.Fatal("matching release could not substitute the absent image", err)
	}
	if err := os.Remove(filepath.Join(s.content, "book-release.json")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.loadBookLesson(id); err == nil {
		t.Fatal("missing image accepted without a release")
	}
}

func TestReleaseRequiresExactCatalogAndProvenance(t *testing.T) {
	for _, scenario := range []string{"version", "book", "pages", "source-hash", "missing-unit"} {
		t.Run(scenario, func(t *testing.T) {
			s, id, lesson := readyBookFixture(t)
			release := releaseBookFixture(t, s, id, lesson)
			unit := release.Units[id]
			switch scenario {
			case "version":
				release.Version = 2
			case "book":
				unit.BookID = "another-book"
			case "pages":
				unit.Pages = []int{11, 12}
			case "source-hash":
				unit.SourceHash = strings.Repeat("0", 64)
			}
			release.Units[id] = unit
			if scenario == "missing-unit" {
				delete(release.Units, id)
			}
			writeFixture(t, filepath.Join(s.content, "book-release.json"), release)
			// Present, verified private source is sufficient even before republishing.
			if _, err := s.loadBookLesson(id); err != nil {
				t.Fatal("local validation became dependent on portable release", err)
			}
			if err := os.Remove(filepath.Join(s.content, "..", "data", "parsed-books", id+".json")); err != nil {
				t.Fatal(err)
			}
			if _, err := s.loadBookLesson(id); err == nil {
				t.Fatal("incorrect release provenance accepted")
			}
		})
	}
}

func TestBookStatusIgnoresStalePublicAvailability(t *testing.T) {
	s, id, _ := readyBookFixture(t)
	writeFixture(t, filepath.Join(s.web, "book-content", "status.json"), map[string]any{"state": "complete", "units": map[string]any{id: map[string]any{"status": "ready", "visualReady": true}}})
	if s.bookBuildStatus()["visualReady"] != 0 {
		t.Fatal("old static manifest invented visual validation")
	}
	if err := os.Remove(filepath.Join(s.content, "book-lessons", id+".json")); err != nil {
		t.Fatal(err)
	}
	writeFixture(t, filepath.Join(s.web, "book-content", id+".json"), map[string]string{"id": "stale public copy"})
	status := s.bookBuildStatus()
	if status["ready"] != 0 || status["state"] != "partial" {
		t.Fatal("deleted lesson still marked ready", status)
	}
	if w := call(t, s, "GET", "/book-content/"+id+".json", nil); w.Code != http.StatusNotFound {
		t.Fatal("stale static copy bypassed validated route")
	}
}

func TestBookReadinessCacheDoesNotWeakenStrictLessonLoads(t *testing.T) {
	s, id, _ := visualReleaseFixture(t)
	if s.bookBuildStatus()["ready"] != 1 {
		t.Fatal("valid fixture not ready")
	}
	path := filepath.Join(s.content, "..", "data", "book-page-images", "book-c2", "10.jpg")
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, []byte(strings.Repeat("x", int(info.Size()))), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(path, info.ModTime(), info.ModTime()); err != nil {
		t.Fatal(err)
	}
	// Polling reuses a stamp; actual reads do not rely on that cache, even when
	// someone deliberately changes bytes while preserving size and mtime.
	if s.bookBuildStatus()["ready"] != 1 {
		t.Fatal("unchanged dependency stamps did not use the availability cache")
	}
	if _, err := s.loadBookLesson(id); err == nil {
		t.Fatal("readiness cache bypassed strict page hash checking")
	}
	if err := os.Chtimes(path, info.ModTime(), info.ModTime().Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	if s.bookBuildStatus()["ready"] != 0 {
		t.Fatal("image stat change did not invalidate readiness")
	}
}

// Opt-in release gate for the real, changing inventory. It starts a new server
// against a temporary clean checkout containing only public content JSON. No
// listener, real profile, PDF, OCR cache, audio or public-web copy is used.
func TestRepositoryBookReleaseCleanClone(t *testing.T) {
	if os.Getenv("ENGLISH_VERIFY_BOOK_RELEASE") != "1" {
		t.Skip("set ENGLISH_VERIFY_BOOK_RELEASE=1 after publishing a release snapshot")
	}
	original, err := filepath.Abs(filepath.Join("..", "..", "content"))
	if err != nil {
		t.Fatal(err)
	}
	root := t.TempDir()
	content := filepath.Join(root, "app", "content")
	err = filepath.Walk(original, func(path string, info os.FileInfo, walkErr error) error {
		if walkErr != nil {
			return walkErr
		}
		if info.IsDir() || filepath.Ext(path) != ".json" {
			return nil
		}
		relative, err := filepath.Rel(original, path)
		if err != nil {
			return err
		}
		destination := filepath.Join(content, relative)
		if err := os.MkdirAll(filepath.Dir(destination), 0700); err != nil {
			return err
		}
		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		return os.WriteFile(destination, raw, 0600)
	})
	if err != nil {
		t.Fatal(err)
	}
	s := openFixture(t, content, filepath.Join(root, "test-profile"))
	release := s.readBookRelease()
	if release == nil || len(release.Units) == 0 {
		t.Fatal("publish a nonempty release snapshot before running this gate")
	}
	start := time.Now()
	status := s.bookBuildStatus()
	cold := time.Since(start)
	start = time.Now()
	warm := s.bookBuildStatus()
	t.Logf("clean clone: %d ready; cold status %s; cached status %s", len(release.Units), cold, time.Since(start))
	if status["ready"] != len(release.Units) || warm["ready"] != len(release.Units) {
		t.Fatal("a pinned lesson cannot load in a clean clone", status["ready"], len(release.Units))
	}
	for id := range release.Units {
		w := call(t, s, "GET", "/book-content/"+id+".json", nil)
		if w.Code != 200 || !strings.Contains(w.Body.String(), `"exercises":[`) {
			t.Fatal("ready planner metadata unavailable", id, w.Code)
		}
	}
}
