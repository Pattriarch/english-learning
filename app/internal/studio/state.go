package studio

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"time"
)

type Attempt struct {
	ID         string   `json:"id"`
	LessonID   string   `json:"lessonId"`
	ExerciseID string   `json:"exerciseId"`
	Prompt     string   `json:"prompt"`
	Answer     string   `json:"answer"`
	Mode       string   `json:"mode"`
	At         string   `json:"at"`
	Feedback   Feedback `json:"feedback"`
}
type Mistake struct {
	Original   string `json:"original"`
	Correction string `json:"correction"`
	Why        string `json:"why"`
	Rule       string `json:"rule"`
}
type Feedback struct {
	Verdict      string    `json:"verdict"`
	Summary      string    `json:"summary"`
	Corrected    string    `json:"corrected"`
	Explanation  string    `json:"explanation"`
	Mistakes     []Mistake `json:"mistakes"`
	Alternatives []string  `json:"alternatives"`
	FollowUp     string    `json:"followUp"`
	Source       string    `json:"source"`
	Scope        string    `json:"scope,omitempty"`
}
type Card struct {
	ID          string  `json:"id"`
	Front       string  `json:"front"`
	Back        string  `json:"back"`
	Note        string  `json:"note"`
	Source      string  `json:"source"`
	Image       string  `json:"image"`
	Created     string  `json:"created"`
	Due         string  `json:"due"`
	Interval    float64 `json:"interval"`
	Ease        float64 `json:"ease"`
	Repetitions int     `json:"repetitions"`
	Lapses      int     `json:"lapses"`
	AnkiID      int64   `json:"ankiId"`
}
type Review struct {
	ID     string `json:"id"`
	CardID string `json:"cardId"`
	At     string `json:"at"`
	Rating int    `json:"rating"`
	Answer string `json:"answer"`
}
type Draft struct {
	Text string `json:"text"`
	At   string `json:"at"`
}
type Progress struct {
	Version  int               `json:"version"`
	Updated  string            `json:"updated"`
	Attempts []Attempt         `json:"attempts"`
	Cards    []Card            `json:"cards"`
	Reviews  []Review          `json:"reviews"`
	Drafts   map[string]Draft  `json:"drafts"`
	Read     map[string]string `json:"read"`
	Activity map[string]int    `json:"activity"`
	Lessons  []Lesson          `json:"lessons"`
}
type Settings struct {
	Provider     string `json:"provider"`
	Endpoint     string `json:"endpoint"`
	Model        string `json:"model"`
	APIKey       string `json:"apiKey,omitempty"`
	WhisperURL   string `json:"whisperUrl"`
	DailyMinutes int    `json:"dailyMinutes"`
	Deck         string `json:"deck"`
}
type database struct {
	mu       sync.Mutex
	dir      string
	state    Progress
	settings Settings
}

func initial() Progress {
	return Progress{Version: 1, Attempts: []Attempt{}, Cards: []Card{}, Reviews: []Review{}, Drafts: map[string]Draft{}, Read: map[string]string{}, Activity: map[string]int{}, Lessons: []Lesson{}}
}
func openDatabase(dir string) (*database, error) {
	if err := os.MkdirAll(filepath.Join(dir, "media"), 0700); err != nil {
		return nil, err
	}
	d := &database{dir: dir, state: initial(), settings: Settings{Provider: "offline", Endpoint: "http://127.0.0.1:11434", Model: "", DailyMinutes: 120, Deck: "English Workshop"}}
	for name, target := range map[string]any{"progress.json": &d.state, "settings.json": &d.settings} {
		b, e := os.ReadFile(filepath.Join(dir, name))
		if errors.Is(e, os.ErrNotExist) {
			continue
		}
		if e != nil {
			return nil, e
		}
		if e = json.Unmarshal(b, target); e != nil {
			return nil, fmt.Errorf("%s is invalid; restore its .bak file: %w", name, e)
		}
	}
	if d.state.Version != 1 || d.state.Drafts == nil || d.state.Read == nil || d.state.Activity == nil {
		return nil, errors.New("unsupported or incomplete progress file")
	}
	return d, nil
}
func atomicJSON(file string, v any) error {
	b, e := json.MarshalIndent(v, "", "  ")
	if e != nil {
		return e
	}
	b = append(b, '\n')
	t, e := os.CreateTemp(filepath.Dir(file), ".save-*")
	if e != nil {
		return e
	}
	name := t.Name()
	defer os.Remove(name)
	if _, e = t.Write(b); e != nil {
		t.Close()
		return e
	}
	if e = t.Sync(); e != nil {
		t.Close()
		return e
	}
	if e = t.Close(); e != nil {
		return e
	}
	if previous, e := os.ReadFile(file); e == nil {
		if e = os.WriteFile(file+".bak", previous, 0600); e != nil {
			return e
		}
	}
	return os.Rename(name, file)
}
func (d *database) change(fn func(*Progress) error) error {
	d.mu.Lock()
	defer d.mu.Unlock()
	b, _ := json.Marshal(d.state)
	var next Progress
	_ = json.Unmarshal(b, &next)
	if e := fn(&next); e != nil {
		return e
	}
	next.Updated = time.Now().UTC().Format(time.RFC3339)
	if e := atomicJSON(filepath.Join(d.dir, "progress.json"), next); e != nil {
		return e
	}
	d.state = next
	return nil
}
func (d *database) snapshot() Progress {
	d.mu.Lock()
	defer d.mu.Unlock()
	b, _ := json.Marshal(d.state)
	var p Progress
	_ = json.Unmarshal(b, &p)
	return p
}
func (d *database) config() Settings { d.mu.Lock(); defer d.mu.Unlock(); return d.settings }
func stamp() string                  { return time.Now().UTC().Format(time.RFC3339) }

// SM-2-style intervals. A failed recall returns to the learning step (10 minutes).
func schedule(c *Card, rating int, now time.Time) {
	if c.Ease < 1.3 {
		c.Ease = 2.5
	}
	if rating == 0 {
		c.Lapses++
		c.Repetitions = 0
		c.Interval = 10.0 / 1440
		c.Ease = max(1.3, c.Ease-.2)
	} else {
		if c.Repetitions == 0 {
			c.Interval = 1
		} else if c.Repetitions == 1 {
			c.Interval = 3
		} else {
			c.Interval = max(1, c.Interval*c.Ease)
		}
		if rating == 1 {
			c.Interval = max(1, c.Interval*.6)
			c.Ease = max(1.3, c.Ease-.15)
		}
		if rating == 3 {
			c.Interval *= 1.3
			c.Ease += .15
		}
		c.Repetitions++
	}
	c.Due = now.Add(time.Duration(c.Interval * float64(24*time.Hour))).UTC().Format(time.RFC3339)
}
