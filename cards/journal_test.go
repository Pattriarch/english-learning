package main

import (
	"fmt"
	"os"
	"path/filepath"
	"sync"
	"testing"
	"time"
)

func testEntry(id string, st Status) Entry {
	return Entry{
		ID:         id,
		CreatedAt:  time.Now().UTC().Truncate(time.Second),
		Screenshot: id + ".png",
		Status:     st,
		Extraction: Extraction{Phrase: "phrase " + id, TranslationRU: "фраза " + id},
	}
}

func newTestJournal(t *testing.T) (*journal, string) {
	t.Helper()
	path := filepath.Join(t.TempDir(), "journal.json")
	j, err := newJournal(path)
	if err != nil {
		t.Fatalf("newJournal: %v", err)
	}
	return j, path
}

func TestJournalMissingFileIsEmpty(t *testing.T) {
	j, path := newTestJournal(t)
	if got := j.All(); len(got) != 0 {
		t.Fatalf("All() = %v, want empty", got)
	}
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Errorf("newJournal не должен создавать файл до первой записи (stat err = %v)", err)
	}
}

func TestJournalCorruptFileIsError(t *testing.T) {
	path := filepath.Join(t.TempDir(), "journal.json")
	if err := os.WriteFile(path, []byte("{ not json"), 0o644); err != nil {
		t.Fatal(err)
	}
	if _, err := newJournal(path); err == nil {
		t.Fatal("битый журнал должен быть ошибкой")
	}
}

func TestJournalAddReloadRoundTrip(t *testing.T) {
	j, path := newTestJournal(t)
	for _, id := range []string{"a", "b", "c"} {
		if err := j.Add(testEntry(id, StatusPending)); err != nil {
			t.Fatalf("Add %s: %v", id, err)
		}
	}

	want := []string{"c", "b", "a"} // newest first
	assertIDs(t, j.All(), want)

	reloaded, err := newJournal(path)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	assertIDs(t, reloaded.All(), want)

	e, ok := reloaded.Get("b")
	if !ok {
		t.Fatal("Get(b) не нашёл запись")
	}
	if e.Phrase != "phrase b" || e.Screenshot != "b.png" {
		t.Errorf("запись потеряла поля: %+v", e)
	}
	if _, ok := reloaded.Get("zzz"); ok {
		t.Error("Get неизвестного id вернул ok")
	}
}

func TestJournalAllIsDefensiveCopy(t *testing.T) {
	j, _ := newTestJournal(t)
	if err := j.Add(testEntry("a", StatusPending)); err != nil {
		t.Fatal(err)
	}
	got := j.All()
	got[0].Phrase = "испорчено"
	if j.All()[0].Phrase != "phrase a" {
		t.Error("All() отдаёт ссылку на внутренний срез")
	}
}

func TestJournalUpdatePersists(t *testing.T) {
	j, path := newTestJournal(t)
	if err := j.Add(testEntry("a", StatusPending)); err != nil {
		t.Fatal(err)
	}
	err := j.Update("a", func(e *Entry) {
		e.Status = StatusCreated
		e.NoteID = 42
		e.Attempts = 3
		e.MediaFile = "a.jpg"
	})
	if err != nil {
		t.Fatalf("Update: %v", err)
	}

	reloaded, err := newJournal(path)
	if err != nil {
		t.Fatal(err)
	}
	e, ok := reloaded.Get("a")
	if !ok {
		t.Fatal("запись пропала")
	}
	if e.Status != StatusCreated || e.NoteID != 42 || e.Attempts != 3 || e.MediaFile != "a.jpg" {
		t.Errorf("мутация не сохранилась: %+v", e)
	}
}

func TestJournalUpdateUnknownID(t *testing.T) {
	j, _ := newTestJournal(t)
	called := false
	err := j.Update("нет", func(*Entry) { called = true })
	if err == nil {
		t.Fatal("Update неизвестного id должен вернуть ошибку")
	}
	if called {
		t.Error("mutate не должен вызываться для неизвестного id")
	}
}

func TestJournalPendingOldestFirst(t *testing.T) {
	j, _ := newTestJournal(t)
	add := func(id string, st Status) {
		t.Helper()
		if err := j.Add(testEntry(id, st)); err != nil {
			t.Fatal(err)
		}
	}
	add("1", StatusPending)
	add("2", StatusCreated)
	add("3", StatusPending)
	add("4", StatusFailed)
	add("5", StatusPending)

	assertIDs(t, j.Pending(), []string{"1", "3", "5"})
}

func TestJournalCapsAt500(t *testing.T) {
	j, path := newTestJournal(t)
	for i := 0; i < journalCap+30; i++ {
		if err := j.Add(testEntry(fmt.Sprintf("e%03d", i), StatusCreated)); err != nil {
			t.Fatalf("Add %d: %v", i, err)
		}
	}
	if got := len(j.All()); got != journalCap {
		t.Fatalf("в памяти %d записей, want %d", got, journalCap)
	}
	reloaded, err := newJournal(path)
	if err != nil {
		t.Fatal(err)
	}
	all := reloaded.All()
	if len(all) != journalCap {
		t.Fatalf("на диске %d записей, want %d", len(all), journalCap)
	}
	if all[0].ID != fmt.Sprintf("e%03d", journalCap+29) {
		t.Errorf("самая свежая запись = %s", all[0].ID)
	}
	if _, ok := reloaded.Get("e000"); ok {
		t.Error("самая старая запись должна была выпасть за пределы cap")
	}
}

func TestJournalNoTempFileLeftBehind(t *testing.T) {
	j, path := newTestJournal(t)
	if err := j.Add(testEntry("a", StatusPending)); err != nil {
		t.Fatal(err)
	}
	if _, err := os.Stat(path + ".tmp"); !os.IsNotExist(err) {
		t.Errorf(".tmp остался после сохранения (err = %v)", err)
	}
}

func TestJournalConcurrentAdd(t *testing.T) {
	j, path := newTestJournal(t)
	const n = 50

	var wg sync.WaitGroup
	for i := 0; i < n; i++ {
		wg.Add(1)
		go func() {
			defer wg.Done()
			e := testEntry(newEntryID(), StatusPending)
			if err := j.Add(e); err != nil {
				t.Errorf("Add: %v", err)
			}
			_ = j.All()
			_ = j.Pending()
			_, _ = j.Get(e.ID)
		}()
	}
	wg.Wait()

	if got := len(j.All()); got != n {
		t.Fatalf("записей %d, want %d", got, n)
	}
	reloaded, err := newJournal(path)
	if err != nil {
		t.Fatalf("reload: %v", err)
	}
	seen := map[string]bool{}
	for _, e := range reloaded.All() {
		if seen[e.ID] {
			t.Fatalf("дубликат id %s", e.ID)
		}
		seen[e.ID] = true
	}
	if len(seen) != n {
		t.Errorf("на диске %d уникальных id, want %d", len(seen), n)
	}
}

func TestNewEntryIDUniqueAndSortable(t *testing.T) {
	const n = 1000
	ids := make([]string, n)
	seen := make(map[string]bool, n)
	for i := range ids {
		ids[i] = newEntryID()
		if seen[ids[i]] {
			t.Fatalf("повтор id %s на позиции %d", ids[i], i)
		}
		seen[ids[i]] = true
	}
	for i := 1; i < n; i++ {
		if len(ids[i]) == len(ids[i-1]) && ids[i] <= ids[i-1] {
			t.Fatalf("id не возрастают: %s после %s", ids[i], ids[i-1])
		}
	}
}

func assertIDs(t *testing.T, got []Entry, want []string) {
	t.Helper()
	if len(got) != len(want) {
		t.Fatalf("получено %d записей (%v), want %v", len(got), ids(got), want)
	}
	for i := range want {
		if got[i].ID != want[i] {
			t.Fatalf("порядок = %v, want %v", ids(got), want)
		}
	}
}

func ids(es []Entry) []string {
	out := make([]string, len(es))
	for i, e := range es {
		out[i] = e.ID
	}
	return out
}
