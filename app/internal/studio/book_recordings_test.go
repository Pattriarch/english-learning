package studio

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func recordingFixture(t *testing.T) (*Server, bookRecording, string, []byte) {
	t.Helper()
	content, data := contentFixture(t)
	raw := []byte("ID3 synthetic source audio bytes for range checks")
	hash := sha256.Sum256(raw)
	entry := bookRecording{ID: "clear-speech-3-track-001.mp3", BookID: "clear-speech-3", UnitID: "clear-speech-3-001",
		Task: "A", Track: 1, Filename: "more/Clear Speech Audio CD/01.mp3", SHA256: hex.EncodeToString(hash[:]), Bytes: int64(len(raw)), DurationSeconds: 71.497}
	writeFixture(t, filepath.Join(content, "book-recordings.json"), bookRecordingRegistry{Version: 1, Recordings: []bookRecording{entry}})
	path := filepath.Join(content, "..", "..", "книги", filepath.FromSlash(entry.Filename))
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	return openFixture(t, content, data), entry, path, raw
}

func requestRecording(t *testing.T, s *Server, method, id string, headers map[string]string) *httptest.ResponseRecorder {
	t.Helper()
	r := httptest.NewRequest(method, "http://127.0.0.1:8777/book-recordings/"+id, nil)
	for name, value := range headers {
		r.Header.Set(name, value)
	}
	w := httptest.NewRecorder()
	s.Handler().ServeHTTP(w, r)
	return w
}

func TestBookRecordingServesVerifiedBytesRangesAndConditions(t *testing.T) {
	s, entry, _, raw := recordingFixture(t)
	etag := `"` + entry.SHA256 + `"`
	w := requestRecording(t, s, "GET", entry.ID, nil)
	if w.Code != http.StatusOK || w.Body.String() != string(raw) || w.Header().Get("ETag") != etag ||
		w.Header().Get("Content-Type") != "audio/mpeg" || w.Header().Get("X-Content-Type-Options") != "nosniff" ||
		w.Header().Get("Cache-Control") != "private, no-cache" {
		t.Fatalf("invalid audio response: %d %v %q", w.Code, w.Header(), w.Body.String())
	}
	w = requestRecording(t, s, "GET", entry.ID, map[string]string{"Range": "bytes=4-12"})
	if w.Code != http.StatusPartialContent || w.Body.String() != string(raw[4:13]) || !strings.HasPrefix(w.Header().Get("Content-Range"), "bytes 4-12/") {
		t.Fatalf("range unsupported: %d %v %q", w.Code, w.Header(), w.Body.String())
	}
	w = requestRecording(t, s, "HEAD", entry.ID, nil)
	if w.Code != http.StatusOK || w.Body.Len() != 0 || w.Header().Get("Content-Length") == "" {
		t.Fatalf("invalid HEAD: %d %v %q", w.Code, w.Header(), w.Body.String())
	}
	w = requestRecording(t, s, "GET", entry.ID, map[string]string{"If-None-Match": etag})
	if w.Code != http.StatusNotModified || w.Body.Len() != 0 {
		t.Fatalf("invalid conditional response: %d %q", w.Code, w.Body.String())
	}
	w = requestRecording(t, s, "GET", entry.ID, map[string]string{"Range": "bytes=999-1000"})
	if w.Code != http.StatusRequestedRangeNotSatisfiable {
		t.Fatalf("invalid out-of-range response: %d", w.Code)
	}
}

func TestBookRecordingRejectsChangedBytesEvenWithRestoredFileIdentity(t *testing.T) {
	s, entry, path, raw := recordingFixture(t)
	info, err := os.Stat(path)
	if err != nil {
		t.Fatal(err)
	}
	if w := requestRecording(t, s, "GET", entry.ID, nil); w.Code != http.StatusOK {
		t.Fatal(w.Code)
	}
	raw[5] ^= 1
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(path, info.ModTime(), info.ModTime()); err != nil {
		t.Fatal(err)
	}
	// Matching size, timestamps and conditional headers must not bypass SHA verification.
	w := requestRecording(t, s, "GET", entry.ID, map[string]string{"If-None-Match": `"` + entry.SHA256 + `"`})
	if w.Code != http.StatusConflict || strings.Contains(w.Body.String(), string(raw)) {
		t.Fatalf("changed source accepted: %d %q", w.Code, w.Body.String())
	}
	if err := os.WriteFile(path, append(raw, 'x'), 0600); err != nil {
		t.Fatal(err)
	}
	if w = requestRecording(t, s, "GET", entry.ID, nil); w.Code != http.StatusConflict {
		t.Fatal("changed source size accepted", w.Code)
	}
}

func TestBookRecordingDoesNotExposeUnregisteredOrMissingSources(t *testing.T) {
	s, entry, path, _ := recordingFixture(t)
	for _, id := range []string{"unknown.mp3", "01.mp3", "clear-speech-3-track-001", "more%2FClear%20Speech%20Audio%20CD%2F01.mp3"} {
		w := requestRecording(t, s, "GET", id, nil)
		if w.Code != http.StatusNotFound {
			t.Errorf("unregistered or path-based source exposed: %s %d", id, w.Code)
		}
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if w := requestRecording(t, s, "GET", entry.ID, nil); w.Code != http.StatusNotFound {
		t.Fatal("missing source did not fail closed", w.Code)
	}
}

func TestBookRecordingRegistryRejectsUnsafeOrAmbiguousEntries(t *testing.T) {
	s, entry, _, _ := recordingFixture(t)
	changes := map[string]func(*bookRecording){
		"unsafe-id":         func(r *bookRecording) { r.ID = "../source.mp3" },
		"missing-extension": func(r *bookRecording) { r.ID = "source" },
		"traversal":         func(r *bookRecording) { r.Filename = "more/../source.mp3" },
		"absolute-path":     func(r *bookRecording) { r.Filename = "C:/source.mp3" },
		"backslash":         func(r *bookRecording) { r.Filename = `more\source.mp3` },
		"device-name":       func(r *bookRecording) { r.Filename = "more/CON.mp3" },
		"alternate-stream":  func(r *bookRecording) { r.Filename = "source.mp3:stream.mp3" },
		"wrong-extension":   func(r *bookRecording) { r.Filename = "source.pdf" },
		"bad-hash":          func(r *bookRecording) { r.SHA256 = "fake" },
		"empty-book":        func(r *bookRecording) { r.BookID = "" },
		"unrelated-unit":    func(r *bookRecording) { r.UnitID = "other-001" },
		"empty-task":        func(r *bookRecording) { r.Task = "" },
		"lowercase-task":    func(r *bookRecording) { r.Task = "a" },
		"invalid-track":     func(r *bookRecording) { r.Track = 0 },
		"empty-source":      func(r *bookRecording) { r.Bytes = 0 },
		"oversized-source":  func(r *bookRecording) { r.Bytes = maxBookRecordingBytes + 1 },
		"invalid-duration":  func(r *bookRecording) { r.DurationSeconds = 0 },
	}
	for name, mutate := range changes {
		t.Run(name, func(t *testing.T) {
			invalid := entry
			mutate(&invalid)
			writeFixture(t, filepath.Join(s.content, "book-recordings.json"), bookRecordingRegistry{Version: 1, Recordings: []bookRecording{invalid}})
			if _, err := s.bookRecordings(); err == nil {
				t.Fatal("invalid registry accepted")
			}
		})
	}
	for _, registry := range []bookRecordingRegistry{{Version: 2, Recordings: []bookRecording{entry}}, {Version: 1, Recordings: []bookRecording{entry, entry}}} {
		writeFixture(t, filepath.Join(s.content, "book-recordings.json"), registry)
		if _, err := s.bookRecordings(); err == nil {
			t.Fatal("unsupported or duplicated registry accepted")
		}
		if w := requestRecording(t, s, "GET", entry.ID, nil); w.Code != http.StatusNotFound {
			t.Fatal("invalid registry exposed source", w.Code)
		}
	}
}

func TestBookRecordingRootRejectsEscapingSymlink(t *testing.T) {
	s, entry, path, raw := recordingFixture(t)
	outside := filepath.Join(t.TempDir(), "outside.mp3")
	if err := os.WriteFile(outside, raw, 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(path); err != nil {
		t.Fatal(err)
	}
	if err := os.Symlink(outside, path); err != nil {
		t.Skip("Symlinks require Windows privileges:", err)
	}
	if w := requestRecording(t, s, "GET", entry.ID, nil); w.Code != http.StatusNotFound {
		t.Fatal("outside symlink served", w.Code)
	}
}

func TestShippedBookRecordingRegistryPinsAllStudentTracks(t *testing.T) {
	s := &Server{content: "../../content"}
	registry, err := s.bookRecordings()
	if err != nil || len(registry) != 82 {
		t.Fatal("incomplete shipped audio registry", len(registry), err)
	}
	first, last := registry["clear-speech-3-track-001.mp3"], registry["clear-speech-3-track-082.mp3"]
	if first.UnitID != "clear-speech-3-001" || first.Task != "A" || last.UnitID != "clear-speech-3-015" || last.Task != "K" {
		t.Fatal("incorrect boundary track mappings", first, last)
	}
	for _, recording := range registry {
		if recording.BookID != "clear-speech-3" {
			t.Fatal("unprovided course audio claimed", recording)
		}
	}
}
