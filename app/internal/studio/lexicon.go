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
	Rank                   int
	Lists, Topics          []string
	Raw                    json.RawMessage
	Summary                map[string]any
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
			ID, En, Ru  string
			TargetSpans []lexiconSpan
		}
		Senses  []struct{ Definition string }
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
	for _, c := range entry.Contexts {
		if !safeID.MatchString(c.ID) || seen[c.ID] || strings.TrimSpace(c.En) == "" || !validLexiconSpans(c.En, c.TargetSpans) {
			return lexiconItem{}, fmt.Errorf("invalid context in %s", entry.ID)
		}
		seen[c.ID] = true
		search = append(search, c.En, c.Ru)
	}
	for _, sense := range entry.Senses {
		search = append(search, sense.Definition)
	}
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
	item.Summary = map[string]any{"id": item.ID, "word": item.Word, "kind": item.Kind, "rank": object["rank"], "memberships": object["memberships"], "topics": object["topics"], "quality": object["quality"], "contextCount": len(entry.Contexts), "senseCount": len(entry.Senses), "preview": map[string]any{"en": entry.Contexts[0].En, "ru": entry.Contexts[0].Ru, "targetSpans": entry.Contexts[0].TargetSpans}}
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
	files := []string{"entries.json", "american-phrases.json", "sources.json", "coverage.json", "scenes.json"}
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
	for _, name := range files {
		raw, err := os.ReadFile(filepath.Join(dir, name))
		if errors.Is(err, os.ErrNotExist) && name != "entries.json" {
			continue
		}
		if err != nil {
			return nil, err
		}
		if name != "entries.json" && name != "american-phrases.json" {
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
	}
	if len(out.Items) == 0 {
		return nil, errors.New("Контекстный словарь пока пуст")
	}
	out.Metadata["targetVariety"] = "en-US"
	out.Metadata["totalEntries"] = len(out.Items)
	words, phrases := 0, 0
	reviewed := 0
	for _, item := range out.Items {
		if item.Reviewed {
			reviewed++
		}
		if item.Kind == "phrase" {
			phrases++
		} else {
			words++
		}
	}
	out.Metadata["words"], out.Metadata["phrases"] = words, phrases
	out.Metadata["reviewedEntries"] = reviewed
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
	q := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("q")))
	list, topic, kind := r.URL.Query().Get("list"), r.URL.Query().Get("topic"), r.URL.Query().Get("kind")
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
		if q != "" && !strings.Contains(item.Search, q) || list != "" && !contains(item.Lists, list) || topic != "" && !contains(item.Topics, topic) || kind != "" && item.Kind != kind {
			continue
		}
		matches = append(matches, i)
	}
	// Exact headwords lead search; prepared explanations lead general browsing.
	sort.SliceStable(matches, func(i, j int) bool {
		score := func(item lexiconItem) int {
			n := 0
			if item.Reviewed {
				n++
			}
			if q != "" && strings.ToLower(item.Word) == q {
				n += 2
			}
			return n
		}
		return score(all.Items[matches[i]]) > score(all.Items[matches[j]])
	})
	items := []map[string]any{}
	offset = min(offset, len(matches))
	for _, i := range matches[min(offset, len(matches)):min(offset+limit, len(matches))] {
		items = append(items, all.Items[i].Summary)
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
	jsonResponse(w, 200, map[string]any{"entry": all.Items[i].Raw, "metadata": all.Metadata})
}
