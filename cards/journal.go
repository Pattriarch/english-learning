package main

import (
	"encoding/json"
	"errors"
	"fmt"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"sync/atomic"
	"time"
)

// journalCap: сколько самых свежих записей остаётся на диске.
const journalCap = 500

type journal struct {
	mu      sync.Mutex
	path    string
	entries []Entry // newest first
}

func newJournal(path string) (*journal, error) {
	j := &journal{path: path}
	b, err := os.ReadFile(path)
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return j, nil
		}
		return nil, fmt.Errorf("журнал %s: %w", path, err)
	}
	if len(b) == 0 {
		return j, nil
	}
	if err := json.Unmarshal(b, &j.entries); err != nil {
		return nil, fmt.Errorf("журнал %s: %w", path, err)
	}
	return j, nil
}

func (j *journal) Add(e Entry) error {
	j.mu.Lock()
	defer j.mu.Unlock()
	j.entries = append([]Entry{e}, j.entries...)
	return j.save()
}

func (j *journal) Update(id string, mutate func(*Entry)) error {
	j.mu.Lock()
	defer j.mu.Unlock()
	for i := range j.entries {
		if j.entries[i].ID == id {
			mutate(&j.entries[i])
			return j.save()
		}
	}
	return fmt.Errorf("запись %s не найдена в журнале", id)
}

func (j *journal) All() []Entry {
	j.mu.Lock()
	defer j.mu.Unlock()
	out := make([]Entry, len(j.entries))
	copy(out, j.entries)
	return out
}

func (j *journal) Get(id string) (Entry, bool) {
	j.mu.Lock()
	defer j.mu.Unlock()
	for _, e := range j.entries {
		if e.ID == id {
			return e, true
		}
	}
	return Entry{}, false
}

// Pending returns pending entries oldest first — ретраи идут в порядке очереди.
func (j *journal) Pending() []Entry {
	j.mu.Lock()
	defer j.mu.Unlock()
	var out []Entry
	for i := len(j.entries) - 1; i >= 0; i-- {
		if j.entries[i].Status == StatusPending {
			out = append(out, j.entries[i])
		}
	}
	return out
}

// save writes atomically; caller holds j.mu.
func (j *journal) save() error {
	if len(j.entries) > journalCap {
		j.entries = j.entries[:journalCap]
	}
	b, err := json.MarshalIndent(j.entries, "", "  ")
	if err != nil {
		return err
	}
	b = append(b, '\n')
	if dir := filepath.Dir(j.path); dir != "" {
		if err := os.MkdirAll(dir, 0o755); err != nil {
			return err
		}
	}
	tmp := j.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o644); err != nil {
		return err
	}
	if err := os.Rename(tmp, j.path); err != nil {
		os.Remove(tmp)
		return err
	}
	return nil
}

// lastEntryID keeps ids unique even when two goroutines read the same nanosecond.
var lastEntryID atomic.Int64

func newEntryID() string {
	for {
		now := time.Now().UnixNano()
		prev := lastEntryID.Load()
		if now <= prev {
			now = prev + 1
		}
		if lastEntryID.CompareAndSwap(prev, now) {
			return strconv.FormatInt(now, 16)
		}
	}
}
