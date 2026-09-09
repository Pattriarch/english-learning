package store

import (
	"database/sql"
	_ "embed"
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"time"

	_ "modernc.org/sqlite"
)

//go:embed schema.sql
var schemaSQL string

// TimeFormat is the layout used for every timestamp column.
const TimeFormat = time.RFC3339

type Store struct {
	db *sql.DB
}

func Open(path string) (*Store, error) {
	dsn := path
	if path != ":memory:" {
		if dir := filepath.Dir(path); dir != "" && dir != "." {
			if err := os.MkdirAll(dir, 0o755); err != nil {
				return nil, fmt.Errorf("create db dir: %w", err)
			}
		}
		dsn = "file:" + path + "?" + url.Values{
			"_pragma": {"busy_timeout(5000)", "journal_mode(WAL)", "foreign_keys(on)"},
		}.Encode()
	}
	db, err := sql.Open("sqlite", dsn)
	if err != nil {
		return nil, err
	}
	db.SetMaxOpenConns(1)
	if _, err := db.Exec(schemaSQL); err != nil {
		db.Close()
		return nil, fmt.Errorf("migrate: %w", err)
	}
	return &Store{db: db}, nil
}

func (s *Store) Close() error { return s.db.Close() }

func (s *Store) DB() *sql.DB { return s.db }

func now() string { return time.Now().UTC().Format(TimeFormat) }

// --- topics ---

type Topic struct {
	ID       string `json:"id"`
	Book     string `json:"book"`
	Unit     string `json:"unit"`
	Category string `json:"category"`
	Title    string `json:"title"`
	TitleRU  string `json:"title_ru"`
	Level    string `json:"level"`
}

// UnmarshalJSON accepts both snake_case and camelCase spellings so the catalog
// file stays forgiving about which convention it was written in.
func (t *Topic) UnmarshalJSON(b []byte) error {
	var raw struct {
		ID         string `json:"id"`
		Book       string `json:"book"`
		Unit       any    `json:"unit"`
		Category   string `json:"category"`
		Title      string `json:"title"`
		TitleRU    string `json:"title_ru"`
		TitleRUAlt string `json:"titleRu"`
		Level      string `json:"level"`
	}
	if err := json.Unmarshal(b, &raw); err != nil {
		return err
	}
	t.ID = raw.ID
	t.Book = raw.Book
	t.Category = raw.Category
	t.Title = raw.Title
	t.TitleRU = raw.TitleRU
	if t.TitleRU == "" {
		t.TitleRU = raw.TitleRUAlt
	}
	t.Level = raw.Level
	switch v := raw.Unit.(type) {
	case string:
		t.Unit = v
	case float64:
		t.Unit = fmt.Sprintf("%g", v)
	}
	return nil
}

func (s *Store) UpsertTopics(topics []Topic) error {
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	stmt, err := tx.Prepare(`INSERT INTO topics (id, book, unit, category, title, title_ru, level)
		VALUES (?, ?, ?, ?, ?, ?, ?)
		ON CONFLICT(id) DO UPDATE SET book=excluded.book, unit=excluded.unit, category=excluded.category,
			title=excluded.title, title_ru=excluded.title_ru, level=excluded.level`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	for _, t := range topics {
		if t.ID == "" {
			continue
		}
		if _, err := stmt.Exec(t.ID, t.Book, t.Unit, t.Category, t.Title, t.TitleRU, t.Level); err != nil {
			return fmt.Errorf("upsert topic %s: %w", t.ID, err)
		}
	}
	return tx.Commit()
}

func (s *Store) Topics() ([]Topic, error) {
	rows, err := s.db.Query(`SELECT id, book, COALESCE(unit, ''), category, title, title_ru, level
		FROM topics ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	var out []Topic
	for rows.Next() {
		var t Topic
		if err := rows.Scan(&t.ID, &t.Book, &t.Unit, &t.Category, &t.Title, &t.TitleRU, &t.Level); err != nil {
			return nil, err
		}
		out = append(out, t)
	}
	return out, rows.Err()
}

func (s *Store) Topic(id string) (Topic, error) {
	var t Topic
	err := s.db.QueryRow(`SELECT id, book, COALESCE(unit, ''), category, title, title_ru, level
		FROM topics WHERE id = ?`, id).Scan(&t.ID, &t.Book, &t.Unit, &t.Category, &t.Title, &t.TitleRU, &t.Level)
	return t, err
}

// TopicsCompact renders the catalog as "id\ttitle" lines for the analysis prompt.
func (s *Store) TopicsCompact() (string, error) {
	topics, err := s.Topics()
	if err != nil {
		return "", err
	}
	var b strings.Builder
	for _, t := range topics {
		b.WriteString(t.ID)
		b.WriteByte('\t')
		b.WriteString(t.Title)
		b.WriteByte('\n')
	}
	return b.String(), nil
}

// --- letters ---

type Letter struct {
	ID        int64           `json:"id"`
	CreatedAt string          `json:"created_at"`
	Prompt    string          `json:"prompt"`
	Original  string          `json:"original"`
	Analysis  json.RawMessage `json:"analysis"`
}

func (s *Store) InsertLetter(prompt, original, analysisJSON string) (int64, error) {
	res, err := s.db.Exec(`INSERT INTO letters (created_at, prompt, original, analysis_json) VALUES (?, ?, ?, ?)`,
		now(), prompt, original, analysisJSON)
	if err != nil {
		return 0, err
	}
	return res.LastInsertId()
}

func (s *Store) LettersList(limit int) ([]Letter, error) {
	if limit <= 0 {
		limit = 50
	}
	rows, err := s.db.Query(`SELECT id, created_at, prompt, original, analysis_json
		FROM letters ORDER BY id DESC LIMIT ?`, limit)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Letter{}
	for rows.Next() {
		var l Letter
		var raw string
		if err := rows.Scan(&l.ID, &l.CreatedAt, &l.Prompt, &l.Original, &raw); err != nil {
			return nil, err
		}
		if json.Valid([]byte(raw)) {
			l.Analysis = json.RawMessage(raw)
		} else {
			l.Analysis = json.RawMessage("null")
		}
		out = append(out, l)
	}
	return out, rows.Err()
}

// --- topic events ---

type Event struct {
	ID        int64  `json:"id"`
	TopicID   string `json:"topic_id"`
	Kind      string `json:"kind"`
	LetterID  *int64 `json:"letter_id,omitempty"`
	Detail    string `json:"detail"`
	CreatedAt string `json:"created_at"`
}

func (s *Store) InsertTopicEvent(topicID, kind string, letterID *int64, detail string) error {
	if topicID == "" || kind == "" {
		return fmt.Errorf("topic event needs topic_id and kind")
	}
	_, err := s.db.Exec(`INSERT INTO topic_events (topic_id, kind, letter_id, detail, created_at) VALUES (?, ?, ?, ?, ?)`,
		topicID, kind, letterID, detail, now())
	return err
}

func (s *Store) TopicEvents(topicID string, since time.Time) ([]Event, error) {
	rows, err := s.db.Query(`SELECT id, topic_id, kind, letter_id, COALESCE(detail, ''), created_at
		FROM topic_events WHERE topic_id = ? AND created_at >= ? ORDER BY id DESC`,
		topicID, since.UTC().Format(TimeFormat))
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []Event{}
	for rows.Next() {
		var e Event
		if err := rows.Scan(&e.ID, &e.TopicID, &e.Kind, &e.LetterID, &e.Detail, &e.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, e)
	}
	return out, rows.Err()
}

// --- anki ---

type AnkiCard struct {
	ID        int64  `json:"id"`
	Front     string `json:"front"`
	Back      string `json:"back"`
	Note      string `json:"note"`
	TopicID   string `json:"topic_id"`
	CreatedAt string `json:"created_at"`
}

func (s *Store) InsertAnkiCards(cards []AnkiCard) (int, error) {
	if len(cards) == 0 {
		return 0, nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return 0, err
	}
	defer tx.Rollback()
	stmt, err := tx.Prepare(`INSERT INTO anki_cards (front, back, note, topic_id, exported_at, created_at)
		VALUES (?, ?, ?, ?, NULL, ?)`)
	if err != nil {
		return 0, err
	}
	defer stmt.Close()
	n := 0
	ts := now()
	for _, c := range cards {
		if strings.TrimSpace(c.Front) == "" || strings.TrimSpace(c.Back) == "" {
			continue
		}
		var topicID any
		if c.TopicID != "" {
			topicID = c.TopicID
		}
		if _, err := stmt.Exec(c.Front, c.Back, c.Note, topicID, ts); err != nil {
			return 0, err
		}
		n++
	}
	if err := tx.Commit(); err != nil {
		return 0, err
	}
	return n, nil
}

// QueueAnki returns the cards that have not been exported yet.
func (s *Store) QueueAnki() ([]AnkiCard, error) {
	rows, err := s.db.Query(`SELECT id, front, back, COALESCE(note, ''), COALESCE(topic_id, ''), created_at
		FROM anki_cards WHERE exported_at IS NULL ORDER BY id`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := []AnkiCard{}
	for rows.Next() {
		var c AnkiCard
		if err := rows.Scan(&c.ID, &c.Front, &c.Back, &c.Note, &c.TopicID, &c.CreatedAt); err != nil {
			return nil, err
		}
		out = append(out, c)
	}
	return out, rows.Err()
}

func (s *Store) MarkAnkiExported(ids []int64) error {
	if len(ids) == 0 {
		return nil
	}
	tx, err := s.db.Begin()
	if err != nil {
		return err
	}
	defer tx.Rollback()
	stmt, err := tx.Prepare(`UPDATE anki_cards SET exported_at = ? WHERE id = ? AND exported_at IS NULL`)
	if err != nil {
		return err
	}
	defer stmt.Close()
	ts := now()
	for _, id := range ids {
		if _, err := stmt.Exec(ts, id); err != nil {
			return err
		}
	}
	return tx.Commit()
}

// --- lesson progress ---

type LessonScore struct {
	Passed     int  `json:"passed"`
	Failed     int  `json:"failed"`
	StreakBest int  `json:"streakBest"`
	Done       bool `json:"done"`
}

type LessonProgress struct {
	TopicID   string      `json:"topic_id"`
	SceneIdx  int         `json:"scene_idx"`
	Score     LessonScore `json:"score"`
	UpdatedAt string      `json:"updated_at"`
}

func (s *Store) UpsertLessonProgress(topicID string, sceneIdx int, score LessonScore) error {
	raw, err := json.Marshal(score)
	if err != nil {
		return err
	}
	_, err = s.db.Exec(`INSERT INTO lesson_progress (topic_id, scene_idx, score_json, updated_at)
		VALUES (?, ?, ?, ?)
		ON CONFLICT(topic_id) DO UPDATE SET
			scene_idx = MAX(lesson_progress.scene_idx, excluded.scene_idx),
			score_json = excluded.score_json,
			updated_at = excluded.updated_at`,
		topicID, sceneIdx, string(raw), now())
	return err
}

func (s *Store) GetLessonProgress(topicID string) (LessonProgress, bool, error) {
	var p LessonProgress
	var raw string
	err := s.db.QueryRow(`SELECT topic_id, scene_idx, score_json, updated_at FROM lesson_progress WHERE topic_id = ?`,
		topicID).Scan(&p.TopicID, &p.SceneIdx, &raw, &p.UpdatedAt)
	if err == sql.ErrNoRows {
		return p, false, nil
	}
	if err != nil {
		return p, false, err
	}
	_ = json.Unmarshal([]byte(raw), &p.Score)
	return p, true, nil
}
