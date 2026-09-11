package studio

import (
	"bytes"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
)

const maxBookRecordingBytes = 32 << 20

type bookRecording struct {
	ID              string  `json:"id"`
	BookID          string  `json:"bookId"`
	UnitID          string  `json:"unitId"`
	Task            string  `json:"task"`
	Track           int     `json:"track"`
	Filename        string  `json:"filename"`
	SHA256          string  `json:"sha256"`
	Bytes           int64   `json:"bytes"`
	DurationSeconds float64 `json:"durationSeconds"`
}

type bookRecordingRegistry struct {
	Version    int             `json:"version"`
	Recordings []bookRecording `json:"recordings"`
}

func validBookRecordingID(id string) bool {
	base := strings.TrimSuffix(id, ".mp3")
	return base != id && safeID.MatchString(base)
}

func validBookRecordingPath(name string) bool {
	extension := filepath.Ext(name)
	// Reuse the platform-independent rejection of traversal, streams, Windows
	// device names and ambiguous path aliases already used by the PDF registry.
	return strings.EqualFold(extension, ".mp3") && validBookFilename(strings.TrimSuffix(name, extension)+".pdf")
}

func (s *Server) bookRecordings() (map[string]bookRecording, error) {
	var registry bookRecordingRegistry
	if err := readBookJSON(filepath.Join(s.content, "book-recordings.json"), &registry); err != nil {
		return nil, err
	}
	if registry.Version != 1 {
		return nil, errors.New("unsupported book recording registry")
	}
	byID := make(map[string]bookRecording, len(registry.Recordings))
	for _, recording := range registry.Recordings {
		if _, duplicate := byID[recording.ID]; duplicate || !validBookRecordingID(recording.ID) ||
			!validBookRecordingPath(recording.Filename) || !validBookSHA256(recording.SHA256) ||
			!safeID.MatchString(recording.BookID) || !safeID.MatchString(recording.UnitID) ||
			!strings.HasPrefix(recording.UnitID, recording.BookID+"-") || recording.Track < 1 ||
			len(recording.Task) != 1 || recording.Task[0] < 'A' || recording.Task[0] > 'Z' ||
			recording.Bytes < 1 || recording.Bytes > maxBookRecordingBytes || recording.DurationSeconds <= 0 {
			return nil, errors.New("invalid book recording registry entry")
		}
		byID[recording.ID] = recording
	}
	return byID, nil
}

func (s *Server) serveBookRecording(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !validBookRecordingID(id) {
		http.NotFound(w, r)
		return
	}
	registry, err := s.bookRecordings()
	if err != nil {
		http.NotFound(w, r)
		return
	}
	recording, ok := registry[id]
	if !ok {
		http.NotFound(w, r)
		return
	}
	root, err := os.OpenRoot(filepath.Join(s.content, "..", "..", "книги"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer root.Close()
	file, err := root.Open(filepath.FromSlash(recording.Filename))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer file.Close()
	info, err := file.Stat()
	if err != nil || !info.Mode().IsRegular() {
		http.NotFound(w, r)
		return
	}
	if info.Size() != recording.Bytes {
		problem(w, http.StatusConflict, errors.New("Локальная запись отличается от проверенного аудио учебника"))
		return
	}
	// Current source clips are at most 2.04 MB. Verify the exact response bytes
	// on every request so a changed file cannot hide behind a stat/cache hit.
	// A byte reader also prevents a file changing between its hash and response.
	raw, err := io.ReadAll(io.LimitReader(file, recording.Bytes+1))
	hash := sha256.Sum256(raw)
	if err != nil || int64(len(raw)) != recording.Bytes || hex.EncodeToString(hash[:]) != recording.SHA256 {
		problem(w, http.StatusConflict, errors.New("Локальная запись отличается от проверенного аудио учебника"))
		return
	}
	w.Header().Set("Content-Type", "audio/mpeg")
	w.Header().Set("X-Content-Type-Options", "nosniff")
	w.Header().Set("Cache-Control", "private, no-cache")
	w.Header().Set("ETag", `"`+recording.SHA256+`"`)
	http.ServeContent(w, r, recording.ID, info.ModTime(), bytes.NewReader(raw))
}
