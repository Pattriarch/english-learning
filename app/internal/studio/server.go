package studio

import (
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type Section struct {
	Title string `json:"title"`
	Body  string `json:"body"`
}
type Example struct {
	English string `json:"en"`
	Russian string `json:"ru"`
	Why     string `json:"why"`
}
type LessonFigure struct {
	ID      string `json:"id"`
	Format  string `json:"format,omitempty"`
	Alt     string `json:"alt"`
	Caption string `json:"caption"`
}
type LessonMaterial struct {
	ID         string        `json:"id"`
	Title      string        `json:"title"`
	Kind       string        `json:"kind"`
	Text       string        `json:"text"`
	Source     string        `json:"source"`
	SourceURL  string        `json:"sourceUrl,omitempty"`
	AudioFile  string        `json:"audioFile,omitempty"`
	InputSkill string        `json:"inputSkill,omitempty"`
	Figure     *LessonFigure `json:"figure,omitempty"`
}
type Exercise struct {
	Revision    int      `json:"revision,omitempty"`
	ID          string   `json:"id"`
	Kind        string   `json:"kind"`
	Prompt      string   `json:"prompt"`
	Context     string   `json:"context"`
	Answers     []string `json:"answers"`
	Hint        string   `json:"hint"`
	Explanation string   `json:"explanation"`
	MaterialIDs []string `json:"materialIds,omitempty"`
}
type LessonStudyStage struct {
	ID          string   `json:"id"`
	Title       string   `json:"title"`
	Purpose     string   `json:"purpose"`
	ExerciseIDs []string `json:"exerciseIds"`
	Minutes     int      `json:"minutes"`
}
type LessonStudyPlan struct {
	Stages              []LessonStudyStage `json:"stages"`
	RevisionExerciseIDs []string           `json:"revisionExerciseIds"`
	Transfer            LessonTransferPlan `json:"transfer"`
}
type LessonTransferPlan struct {
	ExerciseIDs []string `json:"exerciseIds"`
	DelayDays   int      `json:"delayDays"`
}
type Lesson struct {
	ID        string           `json:"id"`
	Title     string           `json:"title"`
	Subtitle  string           `json:"subtitle"`
	Level     string           `json:"level"`
	Group     string           `json:"group"`
	Units     string           `json:"units"`
	Minutes   int              `json:"minutes"`
	Goal      string           `json:"goal"`
	Formula   string           `json:"formula"`
	Sections  []Section        `json:"sections"`
	Examples  []Example        `json:"examples"`
	Exercises []Exercise       `json:"exercises"`
	Generated bool             `json:"generated"`
	Materials []LessonMaterial `json:"materials,omitempty"`
	StudyPlan *LessonStudyPlan `json:"studyPlan,omitempty"`
}
type Server struct {
	db                   *database
	content, web         string
	lessons              []Lesson
	topics               json.RawMessage
	library              json.RawMessage
	learningPath         json.RawMessage
	studyRoute           json.RawMessage
	cinema               json.RawMessage
	research             json.RawMessage
	pronunciation        json.RawMessage
	subtitles            json.RawMessage
	researchTopics       map[string]researchTopic
	pronunciationLessons map[string]pronunciationLesson
	libraryUnits         map[string]libraryEntry
	libraryText          map[string]libraryText
	bookReadiness        bookReadinessCache
	extendedCourse       extendedCourseCache
	lexicon              lexiconCache
	speechBackend        *kokoroSpeechEngine
}

func New(data, content, web string) (*Server, error) {
	d, e := openDatabase(data)
	if e != nil {
		return nil, e
	}
	s := &Server{db: d, content: content, web: web}
	if e = s.loadContent(); e != nil {
		return nil, e
	}
	return s, nil
}
func jsonResponse(w http.ResponseWriter, code int, v any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(code)
	_ = json.NewEncoder(w).Encode(v)
}
func problem(w http.ResponseWriter, code int, e error) {
	jsonResponse(w, code, map[string]string{"error": e.Error()})
}
func decode(w http.ResponseWriter, r *http.Request, v any) bool {
	if e := json.NewDecoder(http.MaxBytesReader(w, r.Body, 24<<20)).Decode(v); e != nil {
		problem(w, 400, errors.New("Некорректные данные или слишком большой файл"))
		return false
	}
	return true
}

var safeID = regexp.MustCompile(`^[a-zA-Z0-9_-]{1,100}$`)

func (s *Server) Handler() http.Handler {
	m := http.NewServeMux()
	m.HandleFunc("GET /api/bootstrap", s.bootstrap)
	m.HandleFunc("GET /api/library/unit/{id}", s.libraryUnit)
	m.HandleFunc("GET /api/library/status", s.libraryStatus)
	m.HandleFunc("GET /api/curriculum/coverage", s.curriculumCoverage)
	m.HandleFunc("GET /api/curriculum/mastery", s.curriculumMastery)
	m.HandleFunc("GET /api/projects", s.projects)
	m.HandleFunc("GET /api/conversation/scenarios", s.conversationCatalog)
	m.HandleFunc("POST /api/conversation/turn", s.conversationReply)
	m.HandleFunc("GET /book-content/status.json", s.libraryStatus)
	m.HandleFunc("GET /book-content/{name}", s.releasedBookContent)
	m.HandleFunc("GET /book-recordings/{id}", s.serveBookRecording)
	m.HandleFunc("POST /api/settings", s.settings)
	m.HandleFunc("POST /api/check", s.check)
	m.HandleFunc("POST /api/ai/test", s.testAI)
	m.HandleFunc("POST /api/lessons/generate", s.generate)
	m.HandleFunc("POST /api/practice/task", s.practiceTask)
	m.HandleFunc("POST /api/draft", s.draft)
	m.HandleFunc("POST /api/read", s.read)
	m.HandleFunc("POST /api/activity", s.activity)
	m.HandleFunc("GET /api/progress/export", s.exportProgress)
	m.HandleFunc("POST /api/progress/snapshot", s.gitSnapshot)
	m.HandleFunc("POST /api/progress/import", s.importProgress)
	m.HandleFunc("POST /api/cards", s.addCard)
	m.HandleFunc("DELETE /api/cards/{id}", s.deleteCard)
	m.HandleFunc("POST /api/review", s.review)
	m.HandleFunc("POST /api/media", s.upload)
	m.HandleFunc("POST /api/ocr", s.ocr)
	m.HandleFunc("POST /api/translate", s.translate)
	m.HandleFunc("POST /api/notebook/translate", s.notebookTranslate)
	m.HandleFunc("POST /api/notebook/audio", s.notebookAudio)
	m.HandleFunc("POST /api/speech", s.speech)
	m.HandleFunc("GET /api/speech/config", s.speechConfig)
	m.HandleFunc("POST /api/speech/config", s.speechConfig)
	m.HandleFunc("GET /api/lexicon", s.lexiconList)
	m.HandleFunc("GET /api/lexicon/{id}", s.lexiconGet)
	m.HandleFunc("POST /api/transcribe", s.transcribe)
	m.HandleFunc("GET /api/anki/export", s.exportAnki)
	m.HandleFunc("POST /api/anki/sync", s.syncAnki)
	m.HandleFunc("GET /books/{name...}", s.book)
	m.Handle("GET /media/", http.StripPrefix("/media/", http.FileServer(http.Dir(filepath.Join(s.db.dir, "media")))))
	m.Handle("GET /", http.FileServer(http.Dir(s.web)))
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		// Local application: reject cross-origin writes and DNS rebinding.
		host := strings.Split(r.Host, ":")[0]
		if host != "127.0.0.1" && host != "localhost" && host != "[" {
			problem(w, 403, errors.New("Local access only"))
			return
		}
		if o := r.Header.Get("Origin"); o != "" {
			u, e := url.Parse(o)
			if e != nil || u.Host != r.Host {
				problem(w, 403, errors.New("Cross-origin request blocked"))
				return
			}
		}
		w.Header().Set("X-Content-Type-Options", "nosniff")
		w.Header().Set("Referrer-Policy", "no-referrer")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Content-Security-Policy", "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'; object-src 'none'; base-uri 'self'")
		m.ServeHTTP(w, r)
	})
}
func (s *Server) allLessons() []Lesson {
	extended, startupExtended := s.currentExtendedCourse()
	lessons := make([]Lesson, 0, len(s.lessons)+len(extended))
	for _, lesson := range s.lessons {
		if !startupExtended[lesson.ID] {
			lessons = append(lessons, lesson)
		}
	}
	lessons = append(lessons, extended...)
	seen := make(map[string]bool, len(lessons))
	for _, lesson := range lessons {
		seen[lesson.ID] = true
	}
	for _, lesson := range s.db.snapshot().Lessons {
		if !seen[lesson.ID] {
			lessons = append(lessons, lesson)
			seen[lesson.ID] = true
		}
	}
	return lessons
}
func (s *Server) findExercise(lesson, exercise string) (Lesson, Exercise, bool) {
	if lesson == "conversation" {
		return s.conversationExercise(exercise)
	}
	if strings.HasPrefix(lesson, "project-") {
		return s.projectExercise(lesson, exercise)
	}
	if strings.HasPrefix(lesson, "book-") {
		return s.bookExercise(lesson, exercise)
	}
	if lesson == "research" {
		return s.researchExercise(exercise)
	}
	if lesson == "pronunciation" {
		return s.pronunciationExercise(exercise)
	}
	for _, l := range s.allLessons() {
		if l.ID == lesson {
			for _, e := range l.Exercises {
				if authoredExerciseID(e) == exercise {
					e.ID = exercise
					return l, e, true
				}
			}
		}
	}
	return Lesson{}, Exercise{}, false
}
func (s *Server) bootstrap(w http.ResponseWriter, r *http.Request) {
	c := s.db.config()
	hasKey := c.APIKey != ""
	c.APIKey = ""
	books := []string{}
	_ = filepath.WalkDir(filepath.Join(s.content, "..", "..", "книги"), func(p string, d os.DirEntry, e error) error {
		if e == nil && !d.IsDir() {
			books = append(books, d.Name())
		}
		return nil
	})
	out := map[string]any{"state": s.db.snapshot(), "settings": c, "hasKey": hasKey, "lessons": s.allLessons(), "topics": s.topics, "books": books}
	out["bookStatus"] = s.bookBuildStatus()
	for key, value := range map[string]json.RawMessage{"library": s.library, "learningPath": s.learningPath, "studyRoute": s.studyRoute, "cinema": s.cinema, "research": s.research, "pronunciation": s.pronunciation, "subtitleSources": s.subtitles} {
		if len(value) > 0 {
			out[key] = value
		}
	}
	jsonResponse(w, 200, out)
}
func (s *Server) settings(w http.ResponseWriter, r *http.Request) {
	var c Settings
	if !decode(w, r, &c) {
		return
	}
	if c.Provider != "offline" && c.Provider != "ollama" && c.Provider != "compatible" && c.Provider != "claude" && c.Provider != "codex" {
		problem(w, 400, errors.New("Неизвестный провайдер"))
		return
	}
	if c.DailyMinutes < 15 || c.DailyMinutes > 480 {
		problem(w, 400, errors.New("Цель: от 15 до 480 минут"))
		return
	}
	if c.Provider == "ollama" || c.Provider == "compatible" {
		if _, e := endpoint(c.Endpoint); e != nil {
			problem(w, 400, e)
			return
		}
		if strings.TrimSpace(c.Model) == "" {
			problem(w, 400, errors.New("Укажите имя установленной или API-модели"))
			return
		}
	}
	if c.WhisperURL != "" {
		if _, e := endpoint(c.WhisperURL); e != nil {
			problem(w, 400, e)
			return
		}
	}
	s.db.mu.Lock()
	defer s.db.mu.Unlock()
	if c.APIKey == "" {
		c.APIKey = s.db.settings.APIKey
	}
	if c.APIKey == "__CLEAR__" {
		c.APIKey = ""
	}
	if e := atomicJSON(filepath.Join(s.db.dir, "settings.json"), c); e != nil {
		problem(w, 500, e)
		return
	}
	s.db.settings = c
	c.APIKey = ""
	jsonResponse(w, 200, c)
}
func (s *Server) draft(w http.ResponseWriter, r *http.Request) {
	var b struct{ Key, Text string }
	if !decode(w, r, &b) {
		return
	}
	if len(b.Key) > 150 || len(b.Text) > 20000 {
		problem(w, 400, errors.New("Слишком длинный черновик"))
		return
	}
	var saved Draft
	e := s.db.change(func(p *Progress) error {
		saved = Draft{Text: b.Text, At: time.Now().UTC().Format(time.RFC3339Nano)}
		p.Drafts[b.Key] = saved
		return nil
	})
	if e != nil {
		problem(w, 500, e)
		return
	}
	jsonResponse(w, 200, map[string]any{"ok": true, "draft": saved})
}
func (s *Server) read(w http.ResponseWriter, r *http.Request) {
	var b struct{ ID string }
	if !decode(w, r, &b) {
		return
	}
	valid := safeID.MatchString(b.ID)
	if id, pronunciation := strings.CutPrefix(b.ID, "pronunciation:"); pronunciation {
		_, valid = s.pronunciationLessons[id]
	}
	if !valid {
		problem(w, 400, errors.New("Некорректная тема"))
		return
	}
	e := s.db.change(func(p *Progress) error { p.Read[b.ID] = stamp(); return nil })
	s.saved(w, e)
}
func (s *Server) activity(w http.ResponseWriter, r *http.Request) {
	var b struct {
		Day     string
		Seconds int
	}
	if !decode(w, r, &b) {
		return
	}
	if _, e := time.Parse("2006-01-02", b.Day); e != nil || b.Seconds < 1 || b.Seconds > 30 {
		problem(w, 400, errors.New("Некорректное время занятия"))
		return
	}
	e := s.db.change(func(p *Progress) error { p.Activity[b.Day] += b.Seconds; return nil })
	s.saved(w, e)
}
func (s *Server) saved(w http.ResponseWriter, e error) {
	if e != nil {
		problem(w, 500, e)
		return
	}
	jsonResponse(w, 200, map[string]bool{"ok": true})
}
func (s *Server) exportProgress(w http.ResponseWriter, r *http.Request) {
	w.Header().Set("Content-Disposition", `attachment; filename="english-progress.json"`)
	jsonResponse(w, 200, s.db.snapshot())
}

func (s *Server) gitSnapshot(w http.ResponseWriter, r *http.Request) {
	dir := filepath.Join(s.content, "..", "..", "progress")
	if e := os.MkdirAll(dir, 0700); e != nil {
		problem(w, 500, e)
		return
	}
	if e := atomicJSON(filepath.Join(dir, "english-progress.json"), s.db.snapshot()); e != nil {
		problem(w, 500, e)
		return
	}
	jsonResponse(w, 200, map[string]string{"path": "progress/english-progress.json"})
}
func validateProgress(p Progress) error {
	if p.Version != 1 || p.Drafts == nil || p.Read == nil || p.Activity == nil {
		return errors.New("Ожидается файл прогресса English Workshop версии 1")
	}
	ids := map[string]bool{}
	for _, c := range p.Cards {
		if !safeID.MatchString(c.ID) || c.Front == "" || c.Back == "" || ids[c.ID] || !validMedia(c.Image) {
			return errors.New("Некорректная карточка в файле")
		}
		if _, e := time.Parse(time.RFC3339, c.Due); e != nil {
			return errors.New("Некорректная дата повторения")
		}
		ids[c.ID] = true
	}
	for _, a := range p.Attempts {
		if !safeID.MatchString(a.ID) || len(a.Answer) > 20000 {
			return errors.New("Некорректная попытка")
		}
	}
	for _, l := range p.Lessons {
		if e := validateLesson(l); e != nil {
			return e
		}
	}
	for day, n := range p.Activity {
		if _, e := time.Parse("2006-01-02", day); e != nil || n < 0 || n > 86400 {
			return errors.New("Некорректная статистика")
		}
	}
	return nil
}
func (s *Server) importProgress(w http.ResponseWriter, r *http.Request) {
	var incoming Progress
	if !decode(w, r, &incoming) {
		return
	}
	if e := validateProgress(incoming); e != nil {
		problem(w, 400, e)
		return
	}
	e := s.db.change(func(p *Progress) error {
		aids := map[string]bool{}
		for _, a := range p.Attempts {
			aids[a.ID] = true
		}
		for _, a := range incoming.Attempts {
			if !aids[a.ID] {
				p.Attempts = append(p.Attempts, a)
				aids[a.ID] = true
			}
		}
		cids := map[string]bool{}
		for _, c := range p.Cards {
			cids[c.ID] = true
		}
		for _, c := range incoming.Cards {
			if !cids[c.ID] {
				p.Cards = append(p.Cards, c)
				cids[c.ID] = true
			}
		}
		rids := map[string]bool{}
		for _, v := range p.Reviews {
			rids[v.ID] = true
		}
		for _, v := range incoming.Reviews {
			if !rids[v.ID] {
				p.Reviews = append(p.Reviews, v)
				rids[v.ID] = true
			}
		}
		for k, v := range incoming.Drafts {
			if v.At > p.Drafts[k].At {
				p.Drafts[k] = v
			}
		}
		for k, v := range incoming.Read {
			if v > p.Read[k] {
				p.Read[k] = v
			}
		}
		for k, v := range incoming.Activity {
			p.Activity[k] = max(p.Activity[k], v)
		}
		lids := map[string]bool{}
		for _, l := range p.Lessons {
			lids[l.ID] = true
		}
		for _, l := range incoming.Lessons {
			if !lids[l.ID] {
				p.Lessons = append(p.Lessons, l)
				lids[l.ID] = true
			}
		}
		return nil
	})
	s.saved(w, e)
}
func endpoint(raw string) (*url.URL, error) {
	u, e := url.Parse(strings.TrimRight(raw, "/"))
	if e != nil || u.Host == "" || u.User != nil || u.RawQuery != "" || u.Fragment != "" {
		return nil, errors.New("Укажите корректный адрес сервиса")
	}
	if u.Scheme != "https" && !(u.Scheme == "http" && (u.Hostname() == "localhost" || u.Hostname() == "127.0.0.1" || u.Hostname() == "::1")) {
		return nil, errors.New("HTTP разрешён только для локальных сервисов; для API используйте HTTPS")
	}
	return u, nil
}
func boundedRead(r io.Reader) ([]byte, error) { return io.ReadAll(io.LimitReader(r, 4<<20)) }
func serviceError(label string, status int) error {
	return fmt.Errorf("%s вернул HTTP %d. Проверьте подключение, модель и ключ в настройках.", label, status)
}

func (s *Server) book(w http.ResponseWriter, r *http.Request) {
	name := r.PathValue("name")
	if !validBookFilename(name) {
		problem(w, 400, errors.New("Неверное имя книги"))
		return
	}
	var catalog struct {
		Books []libraryBook `json:"books"`
	}
	_ = json.Unmarshal(s.library, &catalog)
	registered := false
	for _, book := range catalog.Books {
		if book.Filename == name {
			registered = true
			break
		}
	}
	if !registered {
		http.NotFound(w, r)
		return
	}
	root, err := os.OpenRoot(filepath.Join(s.content, "..", "..", "книги"))
	if err != nil {
		http.NotFound(w, r)
		return
	}
	defer root.Close()
	file, err := root.Open(filepath.FromSlash(name))
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
	w.Header().Set("Content-Type", "application/pdf")
	http.ServeContent(w, r, filepath.Base(name), info.ModTime(), file)
}
