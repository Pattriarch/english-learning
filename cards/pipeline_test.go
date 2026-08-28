package main

import (
	"errors"
	"io"
	"log"
	"os"
	"path/filepath"
	"sync"
	"testing"
)

// --- фейки интерфейсов конвейера ---

type stubExtractor struct {
	mu    sync.Mutex
	out   Extraction
	err   error
	calls []string
}

func (s *stubExtractor) Extract(path string) (Extraction, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.calls = append(s.calls, path)
	return s.out, s.err
}

func (s *stubExtractor) set(out Extraction, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.out, s.err = out, err
}

func (s *stubExtractor) count() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.calls)
}

type stubFinder struct {
	mu      sync.Mutex
	data    []byte
	ext     string
	err     error
	queries []string
}

func (s *stubFinder) Find(query string) ([]byte, string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.queries = append(s.queries, query)
	if s.err != nil {
		return nil, "", s.err
	}
	return append([]byte(nil), s.data...), s.ext, nil
}

func (s *stubFinder) set(data []byte, ext string, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.data, s.ext, s.err = data, ext, err
}

type storedNote struct {
	deck  string
	e     Extraction
	media string
}

type stubAnki struct {
	mu      sync.Mutex
	decks   []string
	stored  map[string][]byte
	notes   []storedNote
	deleted []int64

	deckErr  error
	storeErr error
	addErr   error
	noteID   int64
}

var _ AnkiClient = (*stubAnki)(nil)

func newStubAnki() *stubAnki {
	return &stubAnki{stored: map[string][]byte{}, noteID: 777}
}

func (s *stubAnki) EnsureDeck(deck string) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.decks = append(s.decks, deck)
	return s.deckErr
}

func (s *stubAnki) StoreMedia(filename string, data []byte) (string, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.storeErr != nil {
		return "", s.storeErr
	}
	s.stored[filename] = append([]byte(nil), data...)
	return filename, nil
}

func (s *stubAnki) AddNote(deck string, e Extraction, mediaFile string) (int64, error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.notes = append(s.notes, storedNote{deck: deck, e: e, media: mediaFile})
	if s.addErr != nil {
		return 0, s.addErr
	}
	return s.noteID, nil
}

func (s *stubAnki) DeleteNote(noteID int64) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.deleted = append(s.deleted, noteID)
	return nil
}

func (s *stubAnki) Ping() error { return nil }

func (s *stubAnki) setAddErr(err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.addErr = err
}

func (s *stubAnki) addedNotes() []storedNote {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]storedNote(nil), s.notes...)
}

func (s *stubAnki) storedMedia(name string) ([]byte, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	b, ok := s.stored[name]
	return b, ok
}

func (s *stubAnki) storedCount() int {
	s.mu.Lock()
	defer s.mu.Unlock()
	return len(s.stored)
}

func (s *stubAnki) deckCalls() []string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]string(nil), s.decks...)
}

// --- обвязка ---

type fixture struct {
	cfg     Config
	extract *stubExtractor
	finder  *stubFinder
	anki    *stubAnki
	journal *journal
	p       *pipeline
}

func newFixture(t *testing.T) *fixture {
	t.Helper()

	old := log.Writer()
	log.SetOutput(io.Discard)
	t.Cleanup(func() { log.SetOutput(old) })

	base := t.TempDir()
	cfg := Config{
		InboxDir:       filepath.Join(base, "inbox"),
		DataDir:        filepath.Join(base, "data"),
		Deck:           "English",
		Model:          "claude-opus-5",
		JournalPort:    8787,
		AnkiConnectURL: "http://127.0.0.1:8765",
	}
	if err := ensureDirs(cfg); err != nil {
		t.Fatalf("ensureDirs: %v", err)
	}
	j, err := newJournal(cfg.journalPath())
	if err != nil {
		t.Fatalf("newJournal: %v", err)
	}

	f := &fixture{
		cfg:     cfg,
		extract: &stubExtractor{out: sampleExtraction()},
		finder:  &stubFinder{data: []byte("\xff\xd8jpeg-bytes"), ext: ".jpg"},
		anki:    newStubAnki(),
		journal: j,
	}
	f.p = newPipeline(cfg, f.extract, f.finder, f.anki, j)
	return f
}

// drop кладёт "скриншот" в inbox и возвращает путь.
func (f *fixture) drop(t *testing.T, name, content string) string {
	t.Helper()
	path := filepath.Join(f.cfg.InboxDir, name)
	if err := os.WriteFile(path, []byte(content), 0o644); err != nil {
		t.Fatalf("не могу создать %s: %v", path, err)
	}
	return path
}

// only возвращает единственную запись журнала.
func (f *fixture) only(t *testing.T) Entry {
	t.Helper()
	all := f.journal.All()
	if len(all) != 1 {
		t.Fatalf("в журнале %d записей, want 1: %+v", len(all), all)
	}
	return all[0]
}

func assertFileContent(t *testing.T, path, want string) {
	t.Helper()
	b, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("не могу прочитать %s: %v", path, err)
	}
	if string(b) != want {
		t.Errorf("%s = %q, want %q", path, b, want)
	}
}

func assertGone(t *testing.T, path string) {
	t.Helper()
	if _, err := os.Stat(path); !os.IsNotExist(err) {
		t.Errorf("%s должен был исчезнуть (stat err = %v)", path, err)
	}
}

// --- тесты ---

func TestPipelineHappyPath(t *testing.T) {
	f := newFixture(t)
	src := f.drop(t, "shot.png", "screenshot")

	f.p.Process(src)

	assertGone(t, src)
	e := f.only(t)
	if e.Status != StatusCreated {
		t.Fatalf("статус = %q, want %q (%+v)", e.Status, StatusCreated, e)
	}
	if e.NoteID != 777 {
		t.Errorf("NoteID = %d, want 777", e.NoteID)
	}
	if e.Error != "" {
		t.Errorf("Error = %q, want пусто", e.Error)
	}
	if e.Phrase != sampleExtraction().Phrase {
		t.Errorf("Phrase = %q", e.Phrase)
	}
	if e.Screenshot != "shot.png" {
		t.Errorf("Screenshot = %q, want shot.png", e.Screenshot)
	}
	assertFileContent(t, filepath.Join(f.cfg.processedDir(), "shot.png"), "screenshot")

	if e.MediaFile == "" {
		t.Fatal("MediaFile пуст, картинка должна была сохраниться")
	}
	if filepath.Ext(e.MediaFile) != ".jpg" {
		t.Errorf("MediaFile = %q, ожидалось расширение .jpg", e.MediaFile)
	}
	assertFileContent(t, filepath.Join(f.cfg.mediaDir(), e.MediaFile), "\xff\xd8jpeg-bytes")

	if got := f.anki.deckCalls(); len(got) != 1 || got[0] != "English" {
		t.Errorf("EnsureDeck = %v, want [English]", got)
	}
	stored, ok := f.anki.storedMedia(e.MediaFile)
	if !ok {
		t.Fatalf("StoreMedia не получил %q", e.MediaFile)
	}
	if string(stored) != "\xff\xd8jpeg-bytes" {
		t.Errorf("StoreMedia получил %q", stored)
	}
	notes := f.anki.addedNotes()
	if len(notes) != 1 {
		t.Fatalf("AddNote вызван %d раз, want 1", len(notes))
	}
	if notes[0].deck != "English" || notes[0].media != e.MediaFile {
		t.Errorf("AddNote(%q, media=%q)", notes[0].deck, notes[0].media)
	}
	if notes[0].e != sampleExtraction() {
		t.Errorf("AddNote получил %+v", notes[0].e)
	}
}

func TestPipelineNoPhraseGoesToFailed(t *testing.T) {
	f := newFixture(t)
	f.extract.set(Extraction{}, errNoPhrase)
	src := f.drop(t, "shot.png", "screenshot")

	f.p.Process(src)

	assertGone(t, src)
	assertFileContent(t, filepath.Join(f.cfg.failedDir(), "shot.png"), "screenshot")
	assertGone(t, filepath.Join(f.cfg.processedDir(), "shot.png"))

	e := f.only(t)
	if e.Status != StatusFailed {
		t.Errorf("статус = %q, want %q", e.Status, StatusFailed)
	}
	if e.Error == "" {
		t.Error("Error пуст, причина отказа должна попасть в журнал")
	}
	if e.Screenshot != "shot.png" {
		t.Errorf("Screenshot = %q, want shot.png", e.Screenshot)
	}
	if n := len(f.anki.addedNotes()); n != 0 {
		t.Errorf("AddNote вызван %d раз при нераспознанном скрине", n)
	}
}

func TestPipelineNoImageStillCreatesCard(t *testing.T) {
	f := newFixture(t)
	f.finder.set(nil, "", errNoImage)
	src := f.drop(t, "shot.png", "screenshot")

	f.p.Process(src)

	e := f.only(t)
	if e.Status != StatusCreated {
		t.Fatalf("статус = %q, want %q: отсутствие картинки не блокер", e.Status, StatusCreated)
	}
	if e.MediaFile != "" {
		t.Errorf("MediaFile = %q, want пусто", e.MediaFile)
	}
	if e.NoteID != 777 {
		t.Errorf("NoteID = %d, want 777", e.NoteID)
	}
	assertFileContent(t, filepath.Join(f.cfg.processedDir(), "shot.png"), "screenshot")

	entries, err := os.ReadDir(f.cfg.mediaDir())
	if err != nil {
		t.Fatal(err)
	}
	if len(entries) != 0 {
		t.Errorf("в data/media появились файлы: %v", entries)
	}
	if n := f.anki.storedCount(); n != 0 {
		t.Errorf("StoreMedia вызван %d раз без картинки", n)
	}
	notes := f.anki.addedNotes()
	if len(notes) != 1 {
		t.Fatalf("AddNote вызван %d раз, want 1", len(notes))
	}
	if notes[0].media != "" {
		t.Errorf("AddNote получил mediaFile = %q, want пусто", notes[0].media)
	}
}

func TestPipelineDuplicate(t *testing.T) {
	f := newFixture(t)
	f.anki.setAddErr(errDuplicate)
	src := f.drop(t, "shot.png", "screenshot")

	f.p.Process(src)

	e := f.only(t)
	if e.Status != StatusDuplicate {
		t.Fatalf("статус = %q, want %q", e.Status, StatusDuplicate)
	}
	if e.NoteID != 0 {
		t.Errorf("NoteID = %d, дубликат ноты не создаёт", e.NoteID)
	}
	assertFileContent(t, filepath.Join(f.cfg.processedDir(), "shot.png"), "screenshot")
}

func TestPipelineAnkiUnreachableStaysPendingThenRetrySucceeds(t *testing.T) {
	f := newFixture(t)
	f.anki.setAddErr(errAnkiUnreachable)
	src := f.drop(t, "shot.png", "screenshot")

	f.p.Process(src)

	e := f.only(t)
	if e.Status != StatusPending {
		t.Fatalf("статус = %q, want %q: недоступный Anki — не отказ", e.Status, StatusPending)
	}
	if e.NoteID != 0 {
		t.Errorf("NoteID = %d, want 0", e.NoteID)
	}
	// Скрин уезжает из inbox сразу, чтобы вотчер не взял его второй раз.
	assertGone(t, src)
	assertFileContent(t, filepath.Join(f.cfg.processedDir(), "shot.png"), "screenshot")

	if got := f.journal.Pending(); len(got) != 1 {
		t.Fatalf("Pending() = %d записей, want 1", len(got))
	}

	// Anki открыли — ретрай дожимает запись, Claude больше не зовём.
	extractCallsBefore := f.extract.count()
	f.anki.setAddErr(nil)
	f.p.RetryPending()

	e = f.only(t)
	if e.Status != StatusCreated {
		t.Fatalf("после RetryPending статус = %q, want %q", e.Status, StatusCreated)
	}
	if e.NoteID != 777 {
		t.Errorf("NoteID = %d, want 777", e.NoteID)
	}
	if e.Error != "" {
		t.Errorf("Error = %q, want пусто после успеха", e.Error)
	}
	if got := f.extract.count(); got != extractCallsBefore {
		t.Errorf("Extract вызван ещё %d раз при ретрае", got-extractCallsBefore)
	}
	if got := len(f.journal.Pending()); got != 0 {
		t.Errorf("Pending() = %d, want 0", got)
	}
}

func TestPipelineNameCollisionKeepsBothFiles(t *testing.T) {
	f := newFixture(t)
	existing := filepath.Join(f.cfg.processedDir(), "shot.png")
	if err := os.WriteFile(existing, []byte("старый"), 0o644); err != nil {
		t.Fatal(err)
	}
	src := f.drop(t, "shot.png", "новый")

	f.p.Process(src)

	assertFileContent(t, existing, "старый")

	e := f.only(t)
	if e.Screenshot == "shot.png" {
		t.Fatal("новый скрин записан под занятым именем: старый файл потерян")
	}
	if e.Screenshot != "shot-1.png" {
		t.Errorf("Screenshot = %q, want shot-1.png", e.Screenshot)
	}
	assertFileContent(t, filepath.Join(f.cfg.processedDir(), e.Screenshot), "новый")
	assertGone(t, src)
}

func TestRetryPendingGivesUpAfterCap(t *testing.T) {
	f := newFixture(t)
	stuck := Entry{
		ID:         newEntryID(),
		Screenshot: "shot.png",
		Status:     StatusPending,
		Extraction: sampleExtraction(),
		Attempts:   maxAnkiAttempts,
	}
	if err := f.journal.Add(stuck); err != nil {
		t.Fatal(err)
	}

	f.p.RetryPending()

	e := f.only(t)
	if e.Status != StatusFailed {
		t.Fatalf("статус = %q, want %q после %d попыток", e.Status, StatusFailed, maxAnkiAttempts)
	}
	if e.Error == "" {
		t.Error("Error пуст, причина сдачи должна попасть в журнал")
	}
	if n := len(f.anki.addedNotes()); n != 0 {
		t.Errorf("AddNote вызван %d раз после исчерпания попыток", n)
	}
	if got := len(f.journal.Pending()); got != 0 {
		t.Errorf("Pending() = %d, want 0", got)
	}
}

func TestPipelineAnkiAPIErrorIsFailed(t *testing.T) {
	f := newFixture(t)
	f.anki.setAddErr(errors.New("deck was not found: English"))
	src := f.drop(t, "shot.png", "screenshot")

	f.p.Process(src)

	e := f.only(t)
	if e.Status != StatusFailed {
		t.Fatalf("статус = %q, want %q: ретраи по ошибке API бессмысленны", e.Status, StatusFailed)
	}
	if e.Error == "" {
		t.Error("Error пуст")
	}
}
