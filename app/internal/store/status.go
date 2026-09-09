package store

import (
	"encoding/json"
	"sort"
	"time"
)

const (
	UsageUnknown    = "unknown"
	UsageStruggling = "struggling"
	UsageShaky      = "shaky"
	UsageActive     = "active"

	StudyUntouched = "untouched"
	StudyStarted   = "started"
	StudyCompleted = "completed"
	StudyMastered  = "mastered"
)

// UsageWindow is how far back letter events count toward the usage status.
const UsageWindow = 30 * 24 * time.Hour

type Counts struct {
	LetterError   int `json:"letter_error"`
	LetterOK      int `json:"letter_ok"`
	LetterError30 int `json:"letter_error_30d"`
	LetterOK30    int `json:"letter_ok_30d"`
	ExPass        int `json:"ex_pass"`
	ExFail        int `json:"ex_fail"`
	TheoryRead    int `json:"theory_read"`
}

type TopicStatus struct {
	Topic       Topic           `json:"topic"`
	UsageStatus string          `json:"usage_status"`
	StudyStatus string          `json:"study_status"`
	Counts      Counts          `json:"counts"`
	SceneIdx    int             `json:"scene_idx"`
	Score       LessonScore     `json:"score"`
	Progress    *LessonProgress `json:"progress,omitempty"`
}

// TopicStatuses computes the usage and study status of every catalog topic.
func (s *Store) TopicStatuses() ([]TopicStatus, error) {
	topics, err := s.Topics()
	if err != nil {
		return nil, err
	}
	counts, err := s.eventCounts()
	if err != nil {
		return nil, err
	}
	progress, err := s.allLessonProgress()
	if err != nil {
		return nil, err
	}
	out := make([]TopicStatus, 0, len(topics))
	for _, t := range topics {
		c := counts[t.ID]
		st := TopicStatus{
			Topic:       t,
			Counts:      c,
			UsageStatus: usageStatus(c),
		}
		p, ok := progress[t.ID]
		if ok {
			st.SceneIdx = p.SceneIdx
			st.Score = p.Score
			pc := p
			st.Progress = &pc
		}
		st.StudyStatus = studyStatus(c, p, ok)
		out = append(out, st)
	}
	return out, nil
}

func usageStatus(c Counts) string {
	if c.LetterError+c.LetterOK == 0 {
		return UsageUnknown
	}
	switch {
	case c.LetterError30 >= 2:
		return UsageStruggling
	case c.LetterOK30 >= 3 && c.LetterError30 == 0:
		return UsageActive
	default:
		return UsageShaky
	}
}

func studyStatus(c Counts, p LessonProgress, hasProgress bool) string {
	if !hasProgress && c.ExPass+c.ExFail+c.TheoryRead == 0 {
		return StudyUntouched
	}
	if !p.Score.Done {
		return StudyStarted
	}
	pass, fail := c.ExPass, c.ExFail
	if pass+fail == 0 {
		pass, fail = p.Score.Passed, p.Score.Failed
	}
	if pass+fail > 0 && float64(pass)/float64(pass+fail) >= 0.85 {
		return StudyMastered
	}
	return StudyCompleted
}

func (s *Store) eventCounts() (map[string]Counts, error) {
	since := time.Now().UTC().Add(-UsageWindow).Format(TimeFormat)
	rows, err := s.db.Query(`SELECT topic_id, kind,
			COUNT(*),
			SUM(CASE WHEN created_at >= ? THEN 1 ELSE 0 END)
		FROM topic_events GROUP BY topic_id, kind`, since)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]Counts{}
	for rows.Next() {
		var topicID, kind string
		var total, recent int
		if err := rows.Scan(&topicID, &kind, &total, &recent); err != nil {
			return nil, err
		}
		c := out[topicID]
		switch kind {
		case "letter_error":
			c.LetterError = total
			c.LetterError30 = recent
		case "letter_ok":
			c.LetterOK = total
			c.LetterOK30 = recent
		case "ex_pass":
			c.ExPass = total
		case "ex_fail":
			c.ExFail = total
		case "theory_read":
			c.TheoryRead = total
		}
		out[topicID] = c
	}
	return out, rows.Err()
}

func (s *Store) allLessonProgress() (map[string]LessonProgress, error) {
	rows, err := s.db.Query(`SELECT topic_id, scene_idx, score_json, updated_at FROM lesson_progress`)
	if err != nil {
		return nil, err
	}
	defer rows.Close()
	out := map[string]LessonProgress{}
	for rows.Next() {
		var p LessonProgress
		var raw string
		if err := rows.Scan(&p.TopicID, &p.SceneIdx, &raw, &p.UpdatedAt); err != nil {
			return nil, err
		}
		_ = json.Unmarshal([]byte(raw), &p.Score)
		out[p.TopicID] = p
	}
	return out, rows.Err()
}

// --- dashboard stats ---

type WeakTopic struct {
	TopicID string `json:"topic_id"`
	Title   string `json:"title"`
	TitleRU string `json:"title_ru"`
	Errors  int    `json:"errors"`
}

type Stats struct {
	Topics       int            `json:"topics"`
	Letters      int            `json:"letters"`
	AnkiQueue    int            `json:"anki_queue"`
	AnkiExported int            `json:"anki_exported"`
	Usage        map[string]int `json:"usage"`
	Study        map[string]int `json:"study"`
	Streak       int            `json:"streak"`
	LastLetterAt string         `json:"last_letter_at"`
	WeakTopics   []WeakTopic    `json:"weak_topics"`
}

func (s *Store) Stats() (Stats, error) {
	st := Stats{
		Usage:      map[string]int{UsageUnknown: 0, UsageStruggling: 0, UsageShaky: 0, UsageActive: 0},
		Study:      map[string]int{StudyUntouched: 0, StudyStarted: 0, StudyCompleted: 0, StudyMastered: 0},
		WeakTopics: []WeakTopic{},
	}
	statuses, err := s.TopicStatuses()
	if err != nil {
		return st, err
	}
	st.Topics = len(statuses)
	weak := []WeakTopic{}
	for _, t := range statuses {
		st.Usage[t.UsageStatus]++
		st.Study[t.StudyStatus]++
		if t.UsageStatus == UsageStruggling {
			weak = append(weak, WeakTopic{
				TopicID: t.Topic.ID,
				Title:   t.Topic.Title,
				TitleRU: t.Topic.TitleRU,
				Errors:  t.Counts.LetterError30,
			})
		}
	}
	sort.Slice(weak, func(i, j int) bool {
		if weak[i].Errors != weak[j].Errors {
			return weak[i].Errors > weak[j].Errors
		}
		return weak[i].TopicID < weak[j].TopicID
	})
	if len(weak) > 10 {
		weak = weak[:10]
	}
	st.WeakTopics = weak

	if err := s.db.QueryRow(`SELECT COUNT(*) FROM letters`).Scan(&st.Letters); err != nil {
		return st, err
	}
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM anki_cards WHERE exported_at IS NULL`).Scan(&st.AnkiQueue); err != nil {
		return st, err
	}
	if err := s.db.QueryRow(`SELECT COUNT(*) FROM anki_cards WHERE exported_at IS NOT NULL`).Scan(&st.AnkiExported); err != nil {
		return st, err
	}
	var last *string
	if err := s.db.QueryRow(`SELECT MAX(created_at) FROM letters`).Scan(&last); err != nil {
		return st, err
	}
	if last != nil {
		st.LastLetterAt = *last
	}
	st.Streak, err = s.letterStreak()
	return st, err
}

func (s *Store) letterStreak() (int, error) {
	rows, err := s.db.Query(`SELECT DISTINCT substr(created_at, 1, 10) FROM letters ORDER BY 1 DESC LIMIT 400`)
	if err != nil {
		return 0, err
	}
	defer rows.Close()
	days := map[string]bool{}
	for rows.Next() {
		var d string
		if err := rows.Scan(&d); err != nil {
			return 0, err
		}
		days[d] = true
	}
	if err := rows.Err(); err != nil {
		return 0, err
	}
	cur := time.Now().UTC()
	if !days[cur.Format("2006-01-02")] {
		cur = cur.AddDate(0, 0, -1)
	}
	streak := 0
	for days[cur.Format("2006-01-02")] {
		streak++
		cur = cur.AddDate(0, 0, -1)
	}
	return streak, nil
}
