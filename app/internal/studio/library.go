package studio

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

type libraryBook struct {
	ID           string        `json:"id"`
	Title        string        `json:"title"`
	Author       string        `json:"author"`
	Filename     string        `json:"filename"`
	Level        string        `json:"level"`
	UnitCount    int           `json:"unitCount"`
	Verified     bool          `json:"verified"`
	TOCPages     []int         `json:"tocPages,omitempty"`
	PDFPageCount int           `json:"pdfPageCount,omitempty"`
	Source       string        `json:"source,omitempty"`
	Notes        string        `json:"notes,omitempty"`
	DuplicateOf  string        `json:"duplicateOf,omitempty"`
	Units        []libraryUnit `json:"units,omitempty"`
}

type libraryUnit struct {
	ID               string `json:"id"`
	Unit             int    `json:"unit"`
	Title            string `json:"title"`
	TitleRu          string `json:"titleRu,omitempty"`
	Category         string `json:"category,omitempty"`
	Page             int    `json:"page,omitempty"`
	EndPage          int    `json:"endPage,omitempty"`
	PrintedPage      int    `json:"printedPage,omitempty"`
	TOCPage          int    `json:"tocPage,omitempty"`
	TopicID          string `json:"topicId,omitempty"`
	Verified         bool   `json:"verified"`
	EquivalentUnitID string `json:"equivalentUnitId,omitempty"`
}

type libraryEntry struct {
	Book libraryBook
	Unit libraryUnit
}

type libraryText struct {
	Text   string `json:"text"`
	Pages  []int  `json:"pages"`
	Source string `json:"source"`
}

type syllabusTopic struct {
	ID            string `json:"id"`
	Title         string `json:"title"`
	TitleRu       string `json:"title_ru,omitempty"`
	Book          string `json:"book"`
	Unit          string `json:"unit"`
	Level         string `json:"level"`
	Category      string `json:"category,omitempty"`
	LibraryUnitID string `json:"libraryUnitId,omitempty"`
	Filename      string `json:"filename,omitempty"`
	Page          int    `json:"page,omitempty"`
}

func practiceLevel(value string) (string, bool) {
	level := strings.ToUpper(strings.TrimSpace(value))
	if level == "" {
		level = "B1"
	}
	switch level {
	case "A1", "A2", "B1", "B2", "C1", "C2":
		return level, true
	}
	return "", false
}

func optionalJSON(path string) (json.RawMessage, error) {
	raw, err := os.ReadFile(path)
	if errors.Is(err, os.ErrNotExist) {
		return nil, nil
	}
	if err != nil {
		return nil, err
	}
	if !json.Valid(raw) {
		return nil, fmt.Errorf("%s: invalid JSON", path)
	}
	return raw, nil
}

func (s *Server) loadContent() error {
	files := []string{filepath.Join(s.content, "curriculum.json")}
	extras, err := filepath.Glob(filepath.Join(s.content, "courses", "*.json"))
	if err != nil {
		return err
	}
	files = append(files, extras...)
	seenLessons := map[string]bool{}
	for _, path := range files {
		raw, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		var lessons []Lesson
		if err = json.Unmarshal(raw, &lessons); err != nil {
			return fmt.Errorf("%s: expected a lesson array: %w", path, err)
		}
		if isExtendedCoursePath(s.content, path) && len(lessons) > 0 {
			if err = validateExtendedCourse(lessons, nil); err != nil {
				return fmt.Errorf("%s: %w", path, err)
			}
		}
		for _, lesson := range lessons {
			if err = validateLesson(lesson); err != nil {
				return fmt.Errorf("%s, lesson %q: %w", path, lesson.ID, err)
			}
			if seenLessons[lesson.ID] {
				return fmt.Errorf("%s: duplicate lesson ID %q", path, lesson.ID)
			}
			seenLessons[lesson.ID] = true
			s.lessons = append(s.lessons, lesson)
		}
		if isExtendedCoursePath(s.content, path) {
			s.seedExtendedCourse(lessons)
		}
	}
	if len(s.lessons) == 0 {
		return errors.New("curriculum contains no lessons")
	}
	topicsRaw, err := os.ReadFile(filepath.Join(s.content, "topics.json"))
	if err != nil {
		return err
	}
	var topics []syllabusTopic
	if err = json.Unmarshal(topicsRaw, &topics); err != nil {
		return fmt.Errorf("topics.json: %w", err)
	}
	seenTopics := map[string]bool{}
	for _, topic := range topics {
		if !safeID.MatchString(topic.ID) || seenTopics[topic.ID] {
			return fmt.Errorf("topics.json: invalid or duplicate topic ID %q", topic.ID)
		}
		seenTopics[topic.ID] = true
	}
	for filename, target := range map[string]*json.RawMessage{
		"library.json": &s.library, "learning-path.json": &s.learningPath, "cinema.json": &s.cinema,
		"research-topics.json": &s.research, "subtitle-sources.json": &s.subtitles,
		"pronunciation.json": &s.pronunciation,
	} {
		*target, err = optionalJSON(filepath.Join(s.content, filename))
		if err != nil {
			return err
		}
	}
	if err = s.loadResearch(); err != nil {
		return err
	}
	if err = s.loadPronunciation(); err != nil {
		return err
	}
	s.libraryUnits = map[string]libraryEntry{}
	s.libraryText = map[string]libraryText{}
	if len(s.library) > 0 {
		var catalog struct {
			Books []libraryBook `json:"books"`
		}
		if err = json.Unmarshal(s.library, &catalog); err != nil {
			return fmt.Errorf("library.json: %w", err)
		}
		bookIDs := map[string]bool{}
		for _, book := range catalog.Books {
			if !safeID.MatchString(book.ID) || bookIDs[book.ID] || book.Title == "" ||
				filepath.Base(book.Filename) != book.Filename || strings.ContainsAny(book.Filename, `/\`) ||
				!strings.EqualFold(filepath.Ext(book.Filename), ".pdf") || book.UnitCount != len(book.Units) {
				return fmt.Errorf("library.json: invalid or duplicate book %q", book.ID)
			}
			bookIDs[book.ID] = true
			meta := book
			meta.Units = nil
			numbers := map[int]bool{}
			for _, unit := range book.Units {
				_, exists := s.libraryUnits[unit.ID]
				if !safeID.MatchString(unit.ID) || exists || unit.Unit < 1 || numbers[unit.Unit] ||
					unit.Title == "" || unit.Page < 0 || unit.EndPage < unit.Page ||
					(book.PDFPageCount > 0 && unit.EndPage > book.PDFPageCount) {
					return fmt.Errorf("library.json: invalid or duplicate unit %q", unit.ID)
				}
				numbers[unit.Unit] = true
				s.libraryUnits[unit.ID] = libraryEntry{Book: meta, Unit: unit}
				if !seenTopics[unit.ID] {
					topics = append(topics, syllabusTopic{
						ID: unit.ID, Title: unit.Title, TitleRu: unit.TitleRu, Book: book.ID,
						Unit: strconv.Itoa(unit.Unit), Level: book.Level, Category: unit.Category,
						LibraryUnitID: unit.ID, Filename: book.Filename, Page: unit.Page,
					})
					seenTopics[unit.ID] = true
				}
			}
		}
		cache, err := optionalJSON(filepath.Join(s.content, "..", "data", "library-text.json"))
		if err != nil {
			return err
		}
		if len(cache) > 0 {
			if err = json.Unmarshal(cache, &s.libraryText); err != nil {
				return fmt.Errorf("library-text.json: %w", err)
			}
		}
		// Older saved topic IDs remain valid, while generation can use the
		// matching local unit. These aliases refer to the audited editions.
		aliases := map[string]string{
			"egiu": "grammar-intermediate", "colloc": "collocations-intermediate",
			"phrasal": "phrasal-advanced", "vocab": "vocabulary-upper-intermediate",
		}
		for i := range topics {
			topic := &topics[i]
			if topic.LibraryUnitID != "" {
				continue
			}
			number, err := strconv.Atoi(topic.Unit)
			if err != nil || aliases[topic.Book] == "" {
				continue
			}
			id := fmt.Sprintf("%s-%03d", aliases[topic.Book], number)
			if entry, ok := s.libraryUnits[id]; ok {
				topic.LibraryUnitID = id
				topic.Filename = entry.Book.Filename
				topic.Page = entry.Unit.Page
			}
		}
	}
	s.topics, err = json.Marshal(topics)
	return err
}

func (s *Server) unitSource(id string) libraryText {
	entry, exists := s.libraryUnits[id]
	if !exists {
		return libraryText{Source: "unavailable"}
	}
	if parsed, ok := s.parsedBookSource(id); ok {
		source := parsed.Source
		if source == "text-layer-layout" {
			source = "text-layer"
		}
		return libraryText{Text: parsed.Text, Pages: parsed.Pages, Source: source}
	}
	if cached, ok := s.libraryText[id]; ok {
		// Reject a stale cache pointing at pages of a different edition.
		if len(cached.Pages) == 2 && cached.Pages[0] == entry.Unit.Page && cached.Pages[1] == entry.Unit.EndPage {
			if strings.TrimSpace(cached.Text) != "" && (cached.Source == "text-layer" || cached.Source == "ocr") {
				return cached
			}
		}
	}
	source := "unavailable"
	if entry.Book.Source == "ocr-and-visual-toc" {
		source = "scanned"
	}
	return libraryText{Source: source, Pages: []int{entry.Unit.Page, entry.Unit.EndPage}}
}

func (s *Server) libraryUnit(w http.ResponseWriter, r *http.Request) {
	id := r.PathValue("id")
	if !safeID.MatchString(id) {
		problem(w, 400, errors.New("Некорректный номер юнита"))
		return
	}
	entry, ok := s.libraryUnits[id]
	if !ok {
		problem(w, 404, errors.New("Юнит не найден в библиотеке"))
		return
	}
	source := s.unitSource(id)
	canonical := s.canonicalBookUnit(id)
	var ready *bookLesson
	status := "pending"
	if lesson, err := s.loadBookLesson(id); err == nil {
		ready, status = &lesson, "ready"
	}
	jsonResponse(w, 200, map[string]any{
		"book": entry.Book, "unit": entry.Unit,
		"sourceText": source.Text, "source": source.Source,
		"sourceAvailable": strings.TrimSpace(source.Text) != "",
		"canonicalUnitId": canonical, "lesson": ready, "lessonStatus": status,
		"taskVersions": true,
	})
}
