package studio

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"unicode/utf16"
)

type lexiconItem struct {
	ID, Word, Kind, Search string
	Reviewed               bool
	Prepared               bool
	Rank                   int
	Lists, Topics          []string
	Raw                    json.RawMessage
	Summary                map[string]any
	Aliases                []lexiconAlias
}

// Aliases describe attested source forms, not additional learned words or senses.
type lexiconAlias struct {
	Word      string   `json:"word"`
	EntryIDs  []string `json:"entryIds"`
	Relation  string   `json:"relation"`
	SourceRow int      `json:"sourceRow"`
	SourceID  string   `json:"sourceId,omitempty"`
}

func normalizeLexiconWord(word string) string {
	return strings.ToLower(strings.ReplaceAll(strings.TrimSpace(word), "’", "'"))
}

func (item lexiconItem) matchingAliases(query string) []lexiconAlias {
	var matches []lexiconAlias
	if query == "" {
		return matches
	}
	for _, alias := range item.Aliases {
		if normalizeLexiconWord(alias.Word) == query {
			matches = append(matches, alias)
		}
	}
	return matches
}

type lexiconSnapshot struct {
	Items    []lexiconItem
	ByID     map[string]int
	Metadata map[string]any
}

type lexiconCache struct {
	mu       sync.Mutex
	stamp    string
	snapshot *lexiconSnapshot
}

type lexiconSpan struct {
	Start int    `json:"start"`
	End   int    `json:"end"`
	Text  string `json:"text"`
}

func validLexiconSpans(text string, spans []lexiconSpan) bool {
	units := utf16.Encode([]rune(text))
	if len(spans) == 0 {
		return false
	}
	previous := 0
	boundary := func(i int) bool {
		return i <= 0 || i >= len(units) || !(units[i-1] >= 0xD800 && units[i-1] <= 0xDBFF && units[i] >= 0xDC00 && units[i] <= 0xDFFF)
	}
	for _, span := range spans {
		if span.Start < previous || span.End <= span.Start || span.End > len(units) || !boundary(span.Start) || !boundary(span.End) || span.Text == "" || string(utf16.Decode(units[span.Start:span.End])) != span.Text {
			return false
		}
		previous = span.End
	}
	return true
}

func readLexiconItem(raw json.RawMessage) (lexiconItem, error) {
	var entry struct {
		ID, Word, Kind string
		Rank           struct{ Value int }
		Memberships    []struct{ SourceID string }
		Topics         []struct{ ID, Title string }
		Contexts       []struct {
			ID, En, Ru        string
			SenseID, Quality  string
			TargetSpans       []lexiconSpan
			ExcludedFromStudy bool
		}
		Senses  []struct{ ID, Definition string }
		Quality struct{ Status string }
	}
	if err := json.Unmarshal(raw, &entry); err != nil {
		return lexiconItem{}, err
	}
	if !safeID.MatchString(entry.ID) || strings.TrimSpace(entry.Word) == "" || len(entry.Word) > 200 || len(entry.Contexts) == 0 {
		return lexiconItem{}, errors.New("incomplete lexical entry")
	}
	item := lexiconItem{ID: entry.ID, Word: entry.Word, Kind: entry.Kind, Rank: entry.Rank.Value, Raw: raw}
	item.Reviewed = entry.Quality.Status == "context-reviewed"
	if item.Kind == "" {
		item.Kind = "word"
	}
	search := []string{entry.Word}
	seen := map[string]bool{}
	active := entry.Contexts[:0]
	for _, c := range entry.Contexts {
		if !safeID.MatchString(c.ID) || seen[c.ID] || strings.TrimSpace(c.En) == "" || !validLexiconSpans(c.En, c.TargetSpans) {
			return lexiconItem{}, fmt.Errorf("invalid context in %s", entry.ID)
		}
		seen[c.ID] = true
		if c.ExcludedFromStudy {
			continue
		}
		active = append(active, c)
		search = append(search, c.En, c.Ru)
	}
	entry.Contexts = active
	if len(entry.Contexts) == 0 {
		return lexiconItem{}, fmt.Errorf("no usable context in %s", entry.ID)
	}
	preparedSenses := map[string]bool{}
	for _, sense := range entry.Senses {
		search = append(search, sense.Definition)
		if strings.TrimSpace(sense.ID) != "" && strings.TrimSpace(sense.Definition) != "" {
			preparedSenses[sense.ID] = true
		}
	}
	previewIndex, preparedContexts := 0, 0
	for i, c := range entry.Contexts {
		if strings.TrimSpace(c.Ru) != "" && preparedSenses[c.SenseID] && (c.Quality == "context-reviewed" || c.Quality == "ai-context-reviewed") {
			if preparedContexts == 0 {
				previewIndex = i
			}
			preparedContexts++
		}
	}
	item.Prepared = preparedContexts > 0
	for _, member := range entry.Memberships {
		item.Lists = append(item.Lists, member.SourceID)
	}
	for _, topic := range entry.Topics {
		item.Topics = append(item.Topics, topic.ID)
		search = append(search, topic.Title)
	}
	item.Search = strings.ToLower(strings.Join(search, " "))
	var object map[string]json.RawMessage
	_ = json.Unmarshal(raw, &object)
	preview := entry.Contexts[previewIndex]
	item.Summary = map[string]any{"id": item.ID, "word": item.Word, "kind": item.Kind, "rank": object["rank"], "memberships": object["memberships"], "topics": object["topics"], "quality": object["quality"], "contextCount": len(entry.Contexts), "preparedContexts": preparedContexts, "senseCount": len(entry.Senses), "preview": map[string]any{"id": preview.ID, "en": preview.En, "ru": preview.Ru, "targetSpans": preview.TargetSpans}}
	for _, field := range []string{"displayHeadword", "lexicalType"} {
		if value, ok := object[field]; ok {
			item.Summary[field] = value
		}
	}
	return item, nil
}

func (s *Server) currentLexicon() (*lexiconSnapshot, error) {
	c := &s.lexicon
	c.mu.Lock()
	defer c.mu.Unlock()
	dir := filepath.Join(s.content, "lexicon")
	files := []string{"entries.json", "american-phrases.json", "coca-extension.json", "sources.json", "coverage.json", "scenes.json"}
	var stamps []string
	for _, name := range files {
		info, err := os.Stat(filepath.Join(dir, name))
		if err != nil {
			if name == "entries.json" || !errors.Is(err, os.ErrNotExist) {
				return nil, errors.New("Контекстный словарь ещё готовится. Другие уроки доступны в программе")
			}
			stamps = append(stamps, name+":absent")
			continue
		}
		stamps = append(stamps, fmt.Sprintf("%s:%d:%d", name, info.Size(), info.ModTime().UnixNano()))
	}
	stamp := strings.Join(stamps, "|")
	if stamp == c.stamp && c.snapshot != nil {
		return c.snapshot, nil
	}
	out := &lexiconSnapshot{ByID: map[string]int{}, Metadata: map[string]any{}}
	var aliases []lexiconAlias
	for _, name := range files {
		raw, err := os.ReadFile(filepath.Join(dir, name))
		if errors.Is(err, os.ErrNotExist) && name != "entries.json" {
			continue
		}
		if err != nil {
			return nil, err
		}
		if name != "entries.json" && name != "american-phrases.json" && name != "coca-extension.json" {
			var value any
			if err = json.Unmarshal(raw, &value); err != nil {
				return nil, fmt.Errorf("invalid lexicon metadata: %s", name)
			}
			out.Metadata[strings.TrimSuffix(name, ".json")] = value
			continue
		}
		var document struct {
			Version       string
			TargetVariety string
			SpanEncoding  string
			Entries       []json.RawMessage
			Aliases       []lexiconAlias
			Sources       []json.RawMessage
			ImportSummary json.RawMessage
		}
		if err = json.Unmarshal(raw, &document); err != nil || document.Version != "context-lexicon-v1" || document.SpanEncoding != "utf-16" || document.TargetVariety != "en-US" {
			return nil, errors.New("invalid context lexicon format")
		}
		for _, rawEntry := range document.Entries {
			item, err := readLexiconItem(rawEntry)
			if err != nil {
				return nil, err
			}
			if _, found := out.ByID[item.ID]; found {
				return nil, errors.New("duplicate lexical ID")
			}
			out.ByID[item.ID] = len(out.Items)
			out.Items = append(out.Items, item)
		}
		if name == "coca-extension.json" {
			aliases = document.Aliases
			out.Metadata["cocaExtension"] = map[string]any{"sources": document.Sources, "importSummary": document.ImportSummary, "newEntries": len(document.Entries), "aliasCount": len(document.Aliases)}
		}
	}
	for _, alias := range aliases {
		if normalizeLexiconWord(alias.Word) == "" || len(alias.Word) > 200 || strings.ContainsAny(alias.Word, "\r\n\t") || strings.TrimSpace(alias.Relation) == "" || len(alias.Relation) > 2000 || alias.SourceRow < 1 || len(alias.EntryIDs) == 0 {
			return nil, errors.New("invalid lexical source alias")
		}
		seen := map[string]bool{}
		for _, id := range alias.EntryIDs {
			i, found := out.ByID[id]
			if !found || seen[id] {
				return nil, errors.New("invalid lexical alias target")
			}
			seen[id] = true
			out.Items[i].Aliases = append(out.Items[i].Aliases, alias)
		}
	}
	if len(out.Items) == 0 {
		return nil, errors.New("Контекстный словарь пока пуст")
	}
	out.Metadata["targetVariety"] = "en-US"
	out.Metadata["totalEntries"] = len(out.Items)
	words, phrases := 0, 0
	reviewed, prepared := 0, 0
	for _, item := range out.Items {
		if item.Reviewed {
			reviewed++
		}
		if item.Prepared {
			prepared++
		}
		if item.Kind == "phrase" {
			phrases++
		} else {
			words++
		}
	}
	out.Metadata["words"], out.Metadata["phrases"] = words, phrases
	out.Metadata["reviewedEntries"] = reviewed
	out.Metadata["preparedEntries"] = prepared
	topicCounts := map[string]map[string]any{}
	for _, item := range out.Items {
		var topics []struct{ ID, Title string }
		if raw, ok := item.Summary["topics"].(json.RawMessage); ok {
			_ = json.Unmarshal(raw, &topics)
		}
		for _, topic := range topics {
			if topic.ID == "" {
				continue
			}
			if topicCounts[topic.ID] == nil {
				topicCounts[topic.ID] = map[string]any{"id": topic.ID, "title": topic.Title, "count": 0}
			}
			topicCounts[topic.ID]["count"] = topicCounts[topic.ID]["count"].(int) + 1
		}
	}
	topics := []map[string]any{}
	for _, topic := range topicCounts {
		topics = append(topics, topic)
	}
	sort.Slice(topics, func(i, j int) bool { return topics[i]["title"].(string) < topics[j]["title"].(string) })
	out.Metadata["topics"] = topics
	c.stamp, c.snapshot = stamp, out
	return out, nil
}

func (s *Server) lexiconList(w http.ResponseWriter, r *http.Request) {
	all, err := s.currentLexicon()
	if err != nil {
		problem(w, 503, err)
		return
	}
	q := normalizeLexiconWord(r.URL.Query().Get("q"))
	list, topic, kind := r.URL.Query().Get("list"), r.URL.Query().Get("topic"), r.URL.Query().Get("kind")
	preparedOnly := r.URL.Query().Get("prepared") == "1"
	if len(q) > 300 || len(list) > 100 || len(topic) > 100 {
		problem(w, 400, errors.New("Слишком длинный поиск"))
		return
	}
	offset, _ := strconv.Atoi(r.URL.Query().Get("offset"))
	if offset < 0 {
		offset = 0
	}
	limit, _ := strconv.Atoi(r.URL.Query().Get("limit"))
	if limit < 1 || limit > 100 {
		limit = 48
	}
	matches := []int{}
	contains := func(values []string, wanted string) bool {
		for _, value := range values {
			if value == wanted {
				return true
			}
		}
		return false
	}
	for i, item := range all.Items {
		if q != "" && !strings.Contains(item.Search, q) && len(item.matchingAliases(q)) == 0 || list != "" && !contains(item.Lists, list) || topic != "" && !contains(item.Topics, topic) || kind != "" && item.Kind != kind || preparedOnly && !item.Prepared {
			continue
		}
		matches = append(matches, i)
	}
	// Exact headwords, then explicit source forms, precede incidental matches.
	sort.SliceStable(matches, func(i, j int) bool {
		score := func(item lexiconItem) int {
			n := 0
			if item.Reviewed {
				n += 2
			}
			if item.Prepared {
				n++
			}
			if len(item.matchingAliases(q)) > 0 {
				n += 4
			}
			if q != "" && normalizeLexiconWord(item.Word) == q {
				n += 8
			}
			return n
		}
		return score(all.Items[matches[i]]) > score(all.Items[matches[j]])
	})
	items := []map[string]any{}
	offset = min(offset, len(matches))
	for _, i := range matches[min(offset, len(matches)):min(offset+limit, len(matches))] {
		item := all.Items[i]
		summary := item.Summary
		if forms := item.matchingAliases(q); len(forms) > 0 {
			// Request-specific annotations must not leak into the cached snapshot.
			summary = make(map[string]any, len(item.Summary)+1)
			for key, value := range item.Summary {
				summary[key] = value
			}
			summary["matchedForms"] = forms
		}
		items = append(items, summary)
	}
	jsonResponse(w, 200, map[string]any{"items": items, "total": len(matches), "offset": offset, "limit": limit, "metadata": all.Metadata})
}

func (s *Server) lexiconGet(w http.ResponseWriter, r *http.Request) {
	all, err := s.currentLexicon()
	if err != nil {
		problem(w, 503, err)
		return
	}
	i, ok := all.ByID[r.PathValue("id")]
	if !ok {
		problem(w, 404, errors.New("Слово не найдено"))
		return
	}
	jsonResponse(w, 200, map[string]any{"entry": all.Items[i].Raw, "aliases": all.Items[i].Aliases, "metadata": all.Metadata})
}
