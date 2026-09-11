package studio

import (
	"crypto/sha256"
	"encoding/hex"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"testing"
)

func TestLibraryRelativePDFFilenames(t *testing.T) {
	for _, name := range []string{"Book.pdf", "more/Clear Speech.pdf", "more/ещё/Книга.PDF"} {
		if !validBookFilename(name) {
			t.Errorf("valid PDF rejected: %s", name)
		}
	}
	for _, name := range []string{"/book.pdf", "../book.pdf", "more/../book.pdf", "more//book.pdf", "more/./book.pdf",
		"C:/book.pdf", `more\book.pdf`, "book.pdf:stream", "more/CON.pdf", "more/LPT1.pdf", "more/COM¹.pdf",
		"more. /book.pdf", "more/book.pdf ", "more/book.txt", "more/x\x00.pdf"} {
		if validBookFilename(name) {
			t.Errorf("unsafe PDF accepted: %q", name)
		}
	}
}

func TestRegisteredNestedBooksAreServedWithBothURLEncodings(t *testing.T) {
	content, data := contentFixture(t)
	filename := "more/Книга с пробелами.pdf"
	book := libraryBook{ID: "new-book", Title: "New book", Filename: filename, UnitCount: 1, PDFPageCount: 20,
		Units: []libraryUnit{{ID: "new-book-001", Unit: 1, Title: "Full chapter", Page: 10, EndPage: 14, Pages: []int{10, 11, 12, 13, 14}}}}
	writeFixture(t, filepath.Join(content, "library.json"), map[string]any{"books": []libraryBook{book}})
	root := filepath.Join(content, "..", "..", "книги")
	if err := os.MkdirAll(filepath.Join(root, "more"), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, filepath.FromSlash(filename)), []byte("%PDF synthetic"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(root, "unregistered.pdf"), []byte("%PDF unregistered"), 0600); err != nil {
		t.Fatal(err)
	}
	s := openFixture(t, content, data)
	for _, path := range []string{"/books/" + url.PathEscape(filename), "/books/more/" + url.PathEscape("Книга с пробелами.pdf")} {
		w := call(t, s, "GET", path, nil)
		if w.Code != 200 || w.Body.String() != "%PDF synthetic" {
			t.Fatal(path, w.Code, w.Body.String())
		}
	}
	if w := call(t, s, "GET", "/books/unregistered.pdf", nil); w.Code != 404 {
		t.Fatal("unregistered source exposed", w.Code)
	}
	if w := call(t, s, "GET", "/books/"+url.PathEscape("more/../unregistered.pdf"), nil); w.Code != 400 {
		t.Fatal("encoded traversal accepted", w.Code)
	}
	outside := filepath.Join(t.TempDir(), "outside.pdf")
	if err := os.WriteFile(outside, []byte("private outside source"), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, filepath.Join(root, "link.pdf")); err != nil {
		t.Skip("Symlinks require Windows privileges:", err)
	}
	book.Filename = "link.pdf"
	writeFixture(t, filepath.Join(content, "library.json"), map[string]any{"books": []libraryBook{book}})
	s = openFixture(t, content, data)
	if w := call(t, s, "GET", "/books/link.pdf", nil); w.Code != 404 {
		t.Fatal("outside symlink served", w.Code, w.Body.String())
	}
}

func longBookFixture(t *testing.T) (*Server, string, bookLesson) {
	t.Helper()
	s, id, lesson := readyBookFixture(t)
	entry := s.libraryUnits[id]
	entry.Unit.EndPage = 14
	s.libraryUnits[id] = entry
	lesson.Provenance.Pages = entry.Unit.sourcePages()
	source := parsedBookUnit{UnitID: id, BookID: entry.Book.ID, Pages: lesson.Provenance.Pages, Text: "Full long chapter.", Source: "text-layer-layout"}
	hash := sha256.Sum256([]byte(source.Text))
	lesson.Provenance.SourceHash = hex.EncodeToString(hash[:])
	lesson.Provenance.VisualSourceUsed = true
	for _, page := range lesson.Provenance.Pages {
		raw := []byte("rendered page " + strconv.Itoa(page))
		hash := sha256.Sum256(raw)
		path := filepath.Join(s.content, "..", "data", "book-page-images", entry.Book.ID, strconv.Itoa(page)+".jpg")
		if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(path, raw, 0600); err != nil {
			t.Fatal(err)
		}
		lesson.Provenance.SourceImages = append(lesson.Provenance.SourceImages, bookSourceImage{Page: page, SHA256: hex.EncodeToString(hash[:])})
	}
	writeFixture(t, filepath.Join(s.content, "..", "data", "parsed-books", id+".json"), source)
	writeFixture(t, filepath.Join(s.content, "book-lessons", id+".json"), lesson)
	return s, id, lesson
}

func TestLongBookChaptersRequireEveryPageAndInvalidateMiddleImage(t *testing.T) {
	s, id, lesson := longBookFixture(t)
	if _, err := s.loadBookLesson(id); err != nil {
		t.Fatal("complete chapter rejected", err)
	}
	if s.bookBuildStatus()["ready"] != 1 {
		t.Fatal("chapter unavailable")
	}
	image := filepath.Join(s.content, "..", "data", "book-page-images", "book-c2", "12.jpg")
	if err := os.WriteFile(image, []byte("changed middle page content"), 0600); err != nil {
		t.Fatal(err)
	}
	if _, err := s.loadBookLesson(id); err == nil || s.bookBuildStatus()["ready"] != 0 {
		t.Fatal("changed middle image was ignored")
	}
	lesson.Provenance.SourceImages = append(lesson.Provenance.SourceImages[:2], lesson.Provenance.SourceImages[3:]...)
	writeFixture(t, filepath.Join(s.content, "book-lessons", id+".json"), lesson)
	if _, err := s.loadBookLesson(id); err == nil {
		t.Fatal("missing middle image accepted")
	}
}

func TestLongBookChapterPortableReleasePinsCompletePageInventory(t *testing.T) {
	s, id, lesson := longBookFixture(t)
	release := releaseBookFixture(t, s, id, lesson)
	if err := os.Remove(filepath.Join(s.content, "..", "data", "parsed-books", id+".json")); err != nil {
		t.Fatal(err)
	}
	if _, err := s.loadBookLesson(id); err != nil {
		t.Fatal("portable chapter rejected", err)
	}
	item := release.Units[id]
	item.Pages = []int{10, 14}
	release.Units[id] = item
	writeFixture(t, filepath.Join(s.content, "book-release.json"), release)
	if _, err := s.loadBookLesson(id); err == nil {
		t.Fatal("range endpoints substituted for full release inventory")
	}
}

func TestLongSourceCachesRejectEndpointOnlyInventories(t *testing.T) {
	s, id, _ := longBookFixture(t)
	parsed, ok := s.parsedBookSource(id)
	if !ok {
		t.Fatal("complete source rejected")
	}
	parsed.Pages = []int{10, 14}
	writeFixture(t, filepath.Join(s.content, "..", "data", "parsed-books", id+".json"), parsed)
	s.libraryText[id] = libraryText{Text: "old endpoint cache", Source: "text-layer", Pages: []int{10, 14}}
	if _, ok := s.parsedBookSource(id); ok {
		t.Fatal("incomplete source accepted")
	}
	if source := s.unitSource(id); source.Text != "" || len(source.Pages) != 5 {
		t.Fatal("old endpoint cache accepted", source.Pages)
	}
}

func TestParsedChapterPageTextsCannotOmitTheMiddle(t *testing.T) {
	s, id, _ := longBookFixture(t)
	parsed, _ := s.parsedBookSource(id)
	parsed.PageTexts = []parsedBookPage{{10}, {11}, {13}, {14}}
	writeFixture(t, filepath.Join(s.content, "..", "data", "parsed-books", id+".json"), parsed)
	if _, ok := s.parsedBookSource(id); ok {
		t.Fatal("missing extracted page accepted despite full claimed page list")
	}
	parsed.PageTexts = []parsedBookPage{{10}, {11}, {12}, {13}, {14}}
	writeFixture(t, filepath.Join(s.content, "..", "data", "parsed-books", id+".json"), parsed)
	if _, ok := s.parsedBookSource(id); !ok {
		t.Fatal("complete extracted page inventory rejected")
	}
}
