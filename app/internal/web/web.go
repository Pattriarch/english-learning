package web

import (
	"encoding/json"
	"errors"
	"io/fs"
	"net/http"
	"os"
	"path"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"english/app/internal/anki"
	"english/app/internal/store"
)

type Server struct {
	store      *store.Store
	lessonsDir string
	webDir     string
	botLink    string
}

func New(st *store.Store, lessonsDir, webDir, botLink string) *Server {
	return &Server{store: st, lessonsDir: lessonsDir, webDir: webDir, botLink: botLink}
}

func (s *Server) Handler() http.Handler {
	mux := http.NewServeMux()
	mux.HandleFunc("GET /api/topics", s.getTopics)
	mux.HandleFunc("GET /api/topics/{id}", s.getTopic)
	mux.HandleFunc("GET /api/lessons/{topicId}", s.getLesson)
	mux.HandleFunc("POST /api/progress", s.postProgress)
	mux.HandleFunc("GET /api/letters", s.getLetters)
	mux.HandleFunc("GET /api/anki/export.tsv", s.exportAnki)
	mux.HandleFunc("GET /api/stats", s.getStats)
	mux.HandleFunc("/", s.static)
	return mux
}

func writeJSON(w http.ResponseWriter, code int, v any) {
	w.Header().Set("content-type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	enc := json.NewEncoder(w)
	enc.SetEscapeHTML(false)
	_ = enc.Encode(v)
}

func writeErr(w http.ResponseWriter, code int, msg string) {
	writeJSON(w, code, map[string]string{"error": msg})
}

func (s *Server) getTopics(w http.ResponseWriter, r *http.Request) {
	statuses, err := s.store.TopicStatuses()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]topicListItem, 0, len(statuses))
	for _, st := range statuses {
		out = append(out, topicListItem{TopicStatus: st, HasLesson: s.lessonExists(st.Topic.ID)})
	}
	writeJSON(w, http.StatusOK, out)
}

// topicListItem tells the catalog which topics are trainable without making it
// probe /api/lessons for each of the 200+ entries.
type topicListItem struct {
	store.TopicStatus
	HasLesson bool `json:"has_lesson"`
}

func (s *Server) getTopic(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	topic, err := s.store.Topic(id)
	if err != nil {
		writeErr(w, http.StatusNotFound, "topic not found")
		return
	}
	events, err := s.store.TopicEvents(id, time.Now().AddDate(0, 0, -90))
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	progress, hasProgress, err := s.store.GetLessonProgress(id)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	resp := map[string]any{
		"topic":        topic,
		"theory":       s.theory(id),
		"events":       events,
		"has_lesson":   s.lessonExists(id),
		"has_progress": hasProgress,
	}
	if hasProgress {
		resp["progress"] = progress
	}
	writeJSON(w, http.StatusOK, resp)
}

func (s *Server) getLesson(w http.ResponseWriter, r *http.Request) {
	data, err := s.lessonFile(r.PathValue("topicId"))
	if err != nil {
		writeErr(w, http.StatusNotFound, "lesson not found")
		return
	}
	w.Header().Set("content-type", "application/json; charset=utf-8")
	_, _ = w.Write(data)
}

type progressRequest struct {
	TopicID  string             `json:"topicId"`
	SceneIdx int                `json:"sceneIdx"`
	Event    string             `json:"event"`
	Detail   string             `json:"detail"`
	Score    *store.LessonScore `json:"score"`
}

var progressEvents = map[string]bool{"ex_pass": true, "ex_fail": true, "theory_read": true}

func (s *Server) postProgress(w http.ResponseWriter, r *http.Request) {
	var req progressRequest
	if err := json.NewDecoder(http.MaxBytesReader(w, r.Body, 1<<20)).Decode(&req); err != nil {
		writeErr(w, http.StatusBadRequest, "bad json: "+err.Error())
		return
	}
	if req.TopicID == "" {
		writeErr(w, http.StatusBadRequest, "topicId is required")
		return
	}
	if req.Event != "" {
		if !progressEvents[req.Event] {
			writeErr(w, http.StatusBadRequest, "unknown event: "+req.Event)
			return
		}
		if err := s.store.InsertTopicEvent(req.TopicID, req.Event, nil, req.Detail); err != nil {
			writeErr(w, http.StatusInternalServerError, err.Error())
			return
		}
	}
	score := store.LessonScore{}
	if prev, ok, err := s.store.GetLessonProgress(req.TopicID); err == nil && ok {
		score = prev.Score
	}
	if req.Score != nil {
		score = *req.Score
	}
	if err := s.store.UpsertLessonProgress(req.TopicID, req.SceneIdx, score); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	statuses, err := s.store.TopicStatuses()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	for _, st := range statuses {
		if st.Topic.ID == req.TopicID {
			writeJSON(w, http.StatusOK, st)
			return
		}
	}
	writeJSON(w, http.StatusOK, map[string]string{"ok": "1"})
}

func (s *Server) getLetters(w http.ResponseWriter, r *http.Request) {
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	letters, err := s.store.LettersList(limit)
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, letters)
}

func (s *Server) exportAnki(w http.ResponseWriter, r *http.Request) {
	cards, err := s.store.QueueAnki()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	out := make([]anki.Card, 0, len(cards))
	ids := make([]int64, 0, len(cards))
	for _, c := range cards {
		out = append(out, anki.Card{Front: c.Front, Back: c.Back, Note: c.Note})
		ids = append(ids, c.ID)
	}
	body := anki.TSV(out)
	if err := s.store.MarkAnkiExported(ids); err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	w.Header().Set("content-type", "text/tab-separated-values; charset=utf-8")
	w.Header().Set("content-disposition", `attachment; filename="anki.tsv"`)
	_, _ = w.Write(body)
}

func (s *Server) getStats(w http.ResponseWriter, r *http.Request) {
	st, err := s.store.Stats()
	if err != nil {
		writeErr(w, http.StatusInternalServerError, err.Error())
		return
	}
	writeJSON(w, http.StatusOK, struct {
		store.Stats
		BotLink string `json:"bot_link"`
	}{st, s.botLink})
}

// --- lessons on disk ---

func lessonName(topicID string) (string, bool) {
	if topicID == "" || strings.ContainsAny(topicID, `/\`) || strings.Contains(topicID, "..") {
		return "", false
	}
	return topicID + ".json", true
}

func (s *Server) lessonFile(topicID string) ([]byte, error) {
	name, ok := lessonName(topicID)
	if !ok {
		return nil, errors.New("bad topic id")
	}
	return os.ReadFile(filepath.Join(s.lessonsDir, name))
}

func (s *Server) lessonExists(topicID string) bool {
	name, ok := lessonName(topicID)
	if !ok {
		return false
	}
	_, err := os.Stat(filepath.Join(s.lessonsDir, name))
	return err == nil
}

func (s *Server) theory(topicID string) string {
	data, err := s.lessonFile(topicID)
	if err != nil {
		return ""
	}
	var lesson struct {
		Theory string `json:"theory"`
	}
	if err := json.Unmarshal(data, &lesson); err != nil {
		return ""
	}
	return lesson.Theory
}

// --- static SPA ---

func (s *Server) static(w http.ResponseWriter, r *http.Request) {
	if strings.HasPrefix(r.URL.Path, "/api/") {
		writeErr(w, http.StatusNotFound, "not found")
		return
	}
	root := os.DirFS(s.webDir)
	if _, err := fs.Stat(root, "index.html"); err != nil {
		writeErr(w, http.StatusServiceUnavailable, "frontend is not built yet: no "+filepath.Join(s.webDir, "index.html"))
		return
	}
	name := strings.TrimPrefix(path.Clean(r.URL.Path), "/")
	if name == "" || name == "." {
		name = "index.html"
	}
	if info, err := fs.Stat(root, name); err != nil || info.IsDir() {
		name = "index.html"
	}
	http.ServeFileFS(w, r, root, name)
}
