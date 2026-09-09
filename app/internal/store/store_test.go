package store

import (
	"testing"
	"time"
)

func newTestStore(t *testing.T) *Store {
	t.Helper()
	s, err := Open(":memory:")
	if err != nil {
		t.Fatalf("open: %v", err)
	}
	t.Cleanup(func() { s.Close() })
	return s
}

func seedTopics(t *testing.T, s *Store, ids ...string) {
	t.Helper()
	topics := make([]Topic, 0, len(ids))
	for _, id := range ids {
		topics = append(topics, Topic{ID: id, Book: "egiu", Unit: "1", Category: "Tenses", Title: "Title " + id, TitleRU: "Тема " + id, Level: "B1"})
	}
	if err := s.UpsertTopics(topics); err != nil {
		t.Fatalf("upsert topics: %v", err)
	}
}

// event inserts a topic event backdated by the given age.
func event(t *testing.T, s *Store, topicID, kind string, age time.Duration) {
	t.Helper()
	if err := s.InsertTopicEvent(topicID, kind, nil, ""); err != nil {
		t.Fatalf("insert event: %v", err)
	}
	if age == 0 {
		return
	}
	ts := time.Now().UTC().Add(-age).Format(TimeFormat)
	if _, err := s.DB().Exec(`UPDATE topic_events SET created_at = ? WHERE id = (SELECT MAX(id) FROM topic_events)`, ts); err != nil {
		t.Fatalf("backdate: %v", err)
	}
}

func statusOf(t *testing.T, s *Store, topicID string) TopicStatus {
	t.Helper()
	statuses, err := s.TopicStatuses()
	if err != nil {
		t.Fatalf("statuses: %v", err)
	}
	for _, st := range statuses {
		if st.Topic.ID == topicID {
			return st
		}
	}
	t.Fatalf("topic %s not found", topicID)
	return TopicStatus{}
}

func TestUpsertTopicsIsIdempotent(t *testing.T) {
	s := newTestStore(t)
	seedTopics(t, s, "egiu-001")
	if err := s.UpsertTopics([]Topic{{ID: "egiu-001", Book: "egiu", Category: "Tenses", Title: "New title", TitleRU: "Новое", Level: "B2"}}); err != nil {
		t.Fatalf("upsert: %v", err)
	}
	topics, err := s.Topics()
	if err != nil {
		t.Fatalf("topics: %v", err)
	}
	if len(topics) != 1 {
		t.Fatalf("want 1 topic, got %d", len(topics))
	}
	if topics[0].Title != "New title" || topics[0].Level != "B2" {
		t.Fatalf("topic not updated: %+v", topics[0])
	}
}

func TestUsageStatuses(t *testing.T) {
	s := newTestStore(t)
	seedTopics(t, s, "t-unknown", "t-struggling", "t-shaky", "t-active", "t-stale")

	event(t, s, "t-struggling", "letter_error", 0)
	event(t, s, "t-struggling", "letter_error", 5*24*time.Hour)

	event(t, s, "t-shaky", "letter_error", 0)
	event(t, s, "t-shaky", "letter_ok", 0)
	event(t, s, "t-shaky", "letter_ok", 0)

	for i := 0; i < 3; i++ {
		event(t, s, "t-active", "letter_ok", 0)
	}

	// old errors fall out of the 30-day window, the topic is no longer struggling
	event(t, s, "t-stale", "letter_error", 60*24*time.Hour)
	event(t, s, "t-stale", "letter_error", 45*24*time.Hour)

	want := map[string]string{
		"t-unknown":    UsageUnknown,
		"t-struggling": UsageStruggling,
		"t-shaky":      UsageShaky,
		"t-active":     UsageActive,
		"t-stale":      UsageShaky,
	}
	for id, expected := range want {
		if got := statusOf(t, s, id).UsageStatus; got != expected {
			t.Errorf("%s: usage_status = %q, want %q", id, got, expected)
		}
	}
}

func TestUsageActiveRequiresNoRecentErrors(t *testing.T) {
	s := newTestStore(t)
	seedTopics(t, s, "t1")
	for i := 0; i < 5; i++ {
		event(t, s, "t1", "letter_ok", 0)
	}
	event(t, s, "t1", "letter_error", 0)
	if got := statusOf(t, s, "t1").UsageStatus; got != UsageShaky {
		t.Fatalf("usage_status = %q, want %q", got, UsageShaky)
	}
}

func TestStudyStatuses(t *testing.T) {
	s := newTestStore(t)
	seedTopics(t, s, "t-untouched", "t-started", "t-completed", "t-mastered")

	event(t, s, "t-started", "theory_read", 0)
	if err := s.UpsertLessonProgress("t-started", 1, LessonScore{Passed: 1, Failed: 1}); err != nil {
		t.Fatalf("progress: %v", err)
	}

	// 3 of 5 correct — done but below 85%
	for i := 0; i < 3; i++ {
		event(t, s, "t-completed", "ex_pass", 0)
	}
	for i := 0; i < 2; i++ {
		event(t, s, "t-completed", "ex_fail", 0)
	}
	if err := s.UpsertLessonProgress("t-completed", 4, LessonScore{Passed: 3, Failed: 2, Done: true}); err != nil {
		t.Fatalf("progress: %v", err)
	}

	for i := 0; i < 9; i++ {
		event(t, s, "t-mastered", "ex_pass", 0)
	}
	event(t, s, "t-mastered", "ex_fail", 0)
	if err := s.UpsertLessonProgress("t-mastered", 4, LessonScore{Passed: 9, Failed: 1, Done: true}); err != nil {
		t.Fatalf("progress: %v", err)
	}

	want := map[string]string{
		"t-untouched": StudyUntouched,
		"t-started":   StudyStarted,
		"t-completed": StudyCompleted,
		"t-mastered":  StudyMastered,
	}
	for id, expected := range want {
		if got := statusOf(t, s, id).StudyStatus; got != expected {
			t.Errorf("%s: study_status = %q, want %q", id, got, expected)
		}
	}
}

func TestUpsertLessonProgressKeepsFurthestScene(t *testing.T) {
	s := newTestStore(t)
	seedTopics(t, s, "t1")
	if err := s.UpsertLessonProgress("t1", 3, LessonScore{Passed: 3}); err != nil {
		t.Fatalf("progress: %v", err)
	}
	if err := s.UpsertLessonProgress("t1", 1, LessonScore{Passed: 4}); err != nil {
		t.Fatalf("progress: %v", err)
	}
	p, ok, err := s.GetLessonProgress("t1")
	if err != nil || !ok {
		t.Fatalf("get progress: ok=%v err=%v", ok, err)
	}
	if p.SceneIdx != 3 {
		t.Errorf("scene_idx = %d, want 3", p.SceneIdx)
	}
	if p.Score.Passed != 4 {
		t.Errorf("passed = %d, want 4", p.Score.Passed)
	}
}

func TestGetLessonProgressMissing(t *testing.T) {
	s := newTestStore(t)
	if _, ok, err := s.GetLessonProgress("nope"); err != nil || ok {
		t.Fatalf("ok=%v err=%v, want false/nil", ok, err)
	}
}

func TestAnkiQueueAndExport(t *testing.T) {
	s := newTestStore(t)
	n, err := s.InsertAnkiCards([]AnkiCard{
		{Front: "снаружи", Back: "outside", Note: "нареч.", TopicID: "t1"},
		{Front: "", Back: "skipped"},
		{Front: "внезапно", Back: "out of nowhere"},
	})
	if err != nil {
		t.Fatalf("insert cards: %v", err)
	}
	if n != 2 {
		t.Fatalf("inserted %d cards, want 2", n)
	}
	queue, err := s.QueueAnki()
	if err != nil {
		t.Fatalf("queue: %v", err)
	}
	if len(queue) != 2 {
		t.Fatalf("queue size %d, want 2", len(queue))
	}
	if err := s.MarkAnkiExported([]int64{queue[0].ID}); err != nil {
		t.Fatalf("mark exported: %v", err)
	}
	queue, err = s.QueueAnki()
	if err != nil {
		t.Fatalf("queue: %v", err)
	}
	if len(queue) != 1 || queue[0].Front != "внезапно" {
		t.Fatalf("queue after export = %+v", queue)
	}
}

func TestLettersAndStats(t *testing.T) {
	s := newTestStore(t)
	seedTopics(t, s, "t1", "t2")
	id, err := s.InsertLetter("write about your day", "Hello, i has a cat", `{"corrected":"Hello, I have a cat"}`)
	if err != nil {
		t.Fatalf("insert letter: %v", err)
	}
	if err := s.InsertTopicEvent("t1", "letter_error", &id, "i has"); err != nil {
		t.Fatalf("event: %v", err)
	}
	event(t, s, "t1", "letter_error", 0)
	if _, err := s.InsertAnkiCards([]AnkiCard{{Front: "a", Back: "b"}}); err != nil {
		t.Fatalf("cards: %v", err)
	}

	letters, err := s.LettersList(10)
	if err != nil {
		t.Fatalf("letters: %v", err)
	}
	if len(letters) != 1 || letters[0].Prompt != "write about your day" {
		t.Fatalf("letters = %+v", letters)
	}
	if string(letters[0].Analysis) != `{"corrected":"Hello, I have a cat"}` {
		t.Fatalf("analysis = %s", letters[0].Analysis)
	}

	st, err := s.Stats()
	if err != nil {
		t.Fatalf("stats: %v", err)
	}
	if st.Letters != 1 || st.Topics != 2 || st.AnkiQueue != 1 {
		t.Fatalf("stats = %+v", st)
	}
	if st.Streak != 1 {
		t.Errorf("streak = %d, want 1", st.Streak)
	}
	if st.Usage[UsageStruggling] != 1 || st.Usage[UsageUnknown] != 1 {
		t.Errorf("usage = %v", st.Usage)
	}
	if len(st.WeakTopics) != 1 || st.WeakTopics[0].TopicID != "t1" {
		t.Errorf("weak topics = %+v", st.WeakTopics)
	}
}

func TestTopicEventsWindow(t *testing.T) {
	s := newTestStore(t)
	seedTopics(t, s, "t1")
	event(t, s, "t1", "letter_error", 0)
	event(t, s, "t1", "letter_error", 120*24*time.Hour)
	events, err := s.TopicEvents("t1", time.Now().AddDate(0, 0, -90))
	if err != nil {
		t.Fatalf("events: %v", err)
	}
	if len(events) != 1 {
		t.Fatalf("events in window = %d, want 1", len(events))
	}
}

func TestTopicsCompact(t *testing.T) {
	s := newTestStore(t)
	seedTopics(t, s, "b", "a")
	compact, err := s.TopicsCompact()
	if err != nil {
		t.Fatalf("compact: %v", err)
	}
	want := "a\tTitle a\nb\tTitle b\n"
	if compact != want {
		t.Fatalf("compact = %q, want %q", compact, want)
	}
}
