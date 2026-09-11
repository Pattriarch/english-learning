package studio

import (
	"encoding/json"
	"net/http/httptest"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

// These fixtures deliberately contain no private book or 10k pilot data.
func lexicalFixture(id, word, en, ru string, start, end int) map[string]any {
	return map[string]any{
		"id": id, "word": word, "kind": "word", "rank": map[string]any{"value": nil},
		"memberships": []any{map[string]any{"sourceId": "common-list"}},
		"topics":      []any{map[string]any{"id": "work", "title": "Work and collaboration"}},
		"senses":      []any{map[string]any{"definition": "A useful test meaning"}},
		"contexts":    []any{map[string]any{"id": id + "-context", "en": en, "ru": ru, "targetSpans": []any{map[string]any{"start": start, "end": end, "text": word}}}},
	}
}

func lexicalDocument(entries ...map[string]any) map[string]any {
	return map[string]any{"version": "context-lexicon-v1", "spanEncoding": "utf-16", "targetVariety": "en-US", "entries": entries}
}

func writeLexicalFixture(t *testing.T, s *Server, name string, value any) {
	t.Helper()
	dir := filepath.Join(s.content, "lexicon")
	if err := os.MkdirAll(dir, 0700); err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(dir, name)
	if err := os.WriteFile(path, raw, 0600); err != nil {
		t.Fatal(err)
	}
	// Ensure cache invalidation independently of Windows filesystem timestamp resolution.
	stamp := time.Now().Add(time.Duration(len(raw)) * time.Second)
	if err := os.Chtimes(path, stamp, stamp); err != nil {
		t.Fatal(err)
	}
}

func listLexicalFixture(t *testing.T, s *Server, query string) (int, map[string]any) {
	t.Helper()
	w := httptest.NewRecorder()
	s.lexiconList(w, httptest.NewRequest("GET", "/api/lexicon"+query, nil))
	var out map[string]any
	if err := json.Unmarshal(w.Body.Bytes(), &out); err != nil {
		t.Fatal(err)
	}
	return w.Code, out
}

func TestLexiconNullableRankAndExactUTF16Preview(t *testing.T) {
	entry := lexicalFixture("arrival", "arrive", "😀 We arrive early.", "Мы приезжаем рано.", 6, 12)
	raw, _ := json.Marshal(entry)
	item, err := readLexiconItem(raw)
	if err != nil {
		t.Fatal(err)
	}
	if item.Word != "arrive" || !strings.Contains(item.Search, "приезжаем") {
		t.Fatal("lost searchable source")
	}
	summary, _ := json.Marshal(item.Summary)
	var out struct {
		Rank struct {
			Value *int `json:"value"`
		} `json:"rank"`
		Preview struct {
			TargetSpans []lexiconSpan `json:"targetSpans"`
		} `json:"preview"`
	}
	if err := json.Unmarshal(summary, &out); err != nil {
		t.Fatal(err)
	}
	if out.Rank.Value != nil {
		t.Fatal("unranked entry must not invent a zero rank")
	}
	if len(out.Preview.TargetSpans) != 1 || out.Preview.TargetSpans[0].Start != 6 || out.Preview.TargetSpans[0].End != 12 {
		t.Fatal("highlight lost UTF-16 offsets")
	}
}

func TestLexiconUTF16RejectsSplitSurrogatesAndOverlappingSpans(t *testing.T) {
	for _, tc := range []struct {
		text  string
		spans []lexiconSpan
		valid bool
	}{
		{"😀 word", []lexiconSpan{{0, 2, "😀"}, {3, 7, "word"}}, true},
		{"😀", []lexiconSpan{{0, 1, "�"}}, false},
		{"😀", []lexiconSpan{{1, 2, "�"}}, false},
		{"word word", []lexiconSpan{{0, 4, "word"}, {3, 7, "d wo"}}, false},
		{"word", []lexiconSpan{{-1, 2, "wo"}}, false},
		{"word", []lexiconSpan{{0, 5, "word"}}, false},
		{"word", []lexiconSpan{{0, 4, "wrong"}}, false},
		{"word", nil, false},
	} {
		if got := validLexiconSpans(tc.text, tc.spans); got != tc.valid {
			t.Errorf("text %q spans %+v: got %v, want %v", tc.text, tc.spans, got, tc.valid)
		}
	}
}

func TestLexiconMissingMalformedAndDuplicateCatalogsStayUnavailable(t *testing.T) {
	for _, scenario := range []string{"missing", "malformed", "empty", "wrong-version", "wrong-variety", "duplicate-entry", "duplicate-context", "bad-context"} {
		t.Run(scenario, func(t *testing.T) {
			s := &Server{content: t.TempDir()}
			entry := lexicalFixture("first", "word", "word here", "слово здесь", 0, 4)
			doc := lexicalDocument(entry)
			switch scenario {
			case "missing":
			case "malformed":
				writeLexicalFixture(t, s, "entries.json", doc)
				if err := os.WriteFile(filepath.Join(s.content, "lexicon", "entries.json"), []byte("{"), 0600); err != nil {
					t.Fatal(err)
				}
			case "empty":
				writeLexicalFixture(t, s, "entries.json", lexicalDocument())
			case "wrong-version":
				doc["version"] = "unknown"
				writeLexicalFixture(t, s, "entries.json", doc)
			case "wrong-variety":
				doc["targetVariety"] = "en-GB"
				writeLexicalFixture(t, s, "entries.json", doc)
			case "duplicate-entry":
				writeLexicalFixture(t, s, "entries.json", lexicalDocument(entry, entry))
			case "duplicate-context":
				contexts := entry["contexts"].([]any)
				entry["contexts"] = append(contexts, contexts[0])
				writeLexicalFixture(t, s, "entries.json", doc)
			case "bad-context":
				entry["contexts"].([]any)[0].(map[string]any)["targetSpans"] = []lexiconSpan{{0, 4, "else"}}
				writeLexicalFixture(t, s, "entries.json", doc)
			}
			status, body := listLexicalFixture(t, s, "")
			if status != 503 {
				t.Fatalf("bad source became available: %d %+v", status, body)
			}
			if _, ok := body["items"]; ok {
				t.Fatal("unavailable source became a trustworthy empty result")
			}
		})
	}
}

func TestLexiconSearchFiltersPaginationAndExactHeadwordPriority(t *testing.T) {
	s := &Server{content: t.TempDir()}
	contextMatch := lexicalFixture("approach", "approach", "We approach the board.", "Подходим к доске.", 3, 11)
	board := lexicalFixture("board", "board", "board this train", "садиться в поезд", 0, 5)
	board["rank"] = map[string]any{"value": 5}
	phrase := lexicalFixture("on-board", "on board", "Everyone is on board.", "Все согласны.", 12, 20)
	phrase["kind"] = "phrase"
	phrase["memberships"] = []any{map[string]any{"sourceId": "american-phrases"}}
	writeLexicalFixture(t, s, "entries.json", lexicalDocument(contextMatch, board))
	writeLexicalFixture(t, s, "american-phrases.json", lexicalDocument(phrase))
	code, out := listLexicalFixture(t, s, "?q=BOARD&limit=1")
	if code != 200 || out["total"] != float64(3) {
		t.Fatalf("search failed: %+v", out)
	}
	items := out["items"].([]any)
	if len(items) != 1 || items[0].(map[string]any)["id"] != "board" {
		t.Fatal("exact headword did not outrank context match")
	}
	_, out = listLexicalFixture(t, s, "?q=board&offset=1&limit=1")
	if out["items"].([]any)[0].(map[string]any)["id"] != "approach" {
		t.Fatal("unstable pagination")
	}
	_, out = listLexicalFixture(t, s, "?list=american-phrases&topic=work&kind=phrase")
	if out["total"] != float64(1) || out["items"].([]any)[0].(map[string]any)["id"] != "on-board" {
		t.Fatal("combined filters ignored")
	}
	_, out = listLexicalFixture(t, s, "?q="+url.QueryEscape("САДИТЬСЯ"))
	if out["total"] != float64(1) {
		t.Fatal("Russian context not searchable")
	}
	_, out = listLexicalFixture(t, s, "?list=missing&offset=999999999&limit=101")
	if out["offset"] != float64(0) || len(out["items"].([]any)) != 0 || out["limit"] != float64(48) {
		t.Fatal("invalid pagination not bounded")
	}
	if code, _ := listLexicalFixture(t, s, "?q="+strings.Repeat("a", 301)); code != 400 {
		t.Fatal("oversized query accepted")
	}
}

func TestLexiconHotReloadValidSnapshotsAndRejectsBrokenReplacement(t *testing.T) {
	s := &Server{content: t.TempDir()}
	first := lexicalFixture("one", "word", "word here", "слово здесь", 0, 4)
	writeLexicalFixture(t, s, "entries.json", lexicalDocument(first))
	one, err := s.currentLexicon()
	if err != nil || len(one.Items) != 1 {
		t.Fatalf("initial: %v", err)
	}
	second := lexicalFixture("two", "test", "a test", "проверка", 2, 6)
	writeLexicalFixture(t, s, "entries.json", lexicalDocument(first, second))
	two, err := s.currentLexicon()
	if err != nil || len(two.Items) != 2 {
		t.Fatalf("new published entry invisible: %v", err)
	}
	if len(one.Items) != 1 {
		t.Fatal("old immutable snapshot was mutated")
	}
	writeLexicalFixture(t, s, "sources.json", map[string]any{"sources": []string{"official-test"}})
	valid, err := s.currentLexicon()
	if err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(s.content, "lexicon", "sources.json"), []byte("[broken"), 0600); err != nil {
		t.Fatal(err)
	}
	if code, _ := listLexicalFixture(t, s, ""); code != 503 {
		t.Fatal("broken update was advertised as valid")
	}
	if s.lexicon.snapshot != valid || len(s.lexicon.snapshot.Items) != 2 {
		t.Fatal("broken update replaced last trustworthy cached snapshot")
	}
	writeLexicalFixture(t, s, "sources.json", map[string]any{"sources": []string{"official-test-restored"}})
	if code, body := listLexicalFixture(t, s, ""); code != 200 || body["total"] != float64(2) {
		t.Fatal("restored valid snapshot did not recover")
	}
}

func TestLexiconDetailKeepsRawFieldsAndUnknownIDReturns404(t *testing.T) {
	s := &Server{content: t.TempDir()}
	entry := lexicalFixture("one", "word", "word here", "слово здесь", 0, 4)
	entry["provenance"] = map[string]any{"type": "original-fixture"}
	writeLexicalFixture(t, s, "entries.json", lexicalDocument(entry))
	for _, id := range []string{"one", "unknown"} {
		r := httptest.NewRequest("GET", "/api/lexicon/"+id, nil)
		r.SetPathValue("id", id)
		w := httptest.NewRecorder()
		s.lexiconGet(w, r)
		if id == "unknown" {
			if w.Code != 404 {
				t.Fatal(w.Code)
			}
			continue
		}
		if w.Code != 200 {
			t.Fatal(w.Body.String())
		}
		var body struct {
			Entry map[string]any `json:"entry"`
		}
		if err := json.Unmarshal(w.Body.Bytes(), &body); err != nil {
			t.Fatal(err)
		}
		if body.Entry["provenance"].(map[string]any)["type"] != "original-fixture" {
			t.Fatal("detail dropped provenance")
		}
	}
}

func preparedLexicalFixture(id, word, en string, start, end int, quality string) map[string]any {
	entry := lexicalFixture(id, word, en, "Русский перевод.", start, end)
	entry["senses"] = []any{map[string]any{"id": "sense-1", "definition": "The meaning in this example"}}
	context := entry["contexts"].([]any)[0].(map[string]any)
	context["senseId"], context["quality"] = "sense-1", quality
	return entry
}

func TestLexiconPreparedRequiresOneActiveReviewedContextWithTranslationAndSense(t *testing.T) {
	for _, scenario := range []string{"editorial", "ai", "entry-status-only", "missing-ru", "blank-ru", "missing-sense", "unknown-sense", "blank-definition", "imported-quality", "archived"} {
		t.Run(scenario, func(t *testing.T) {
			entry := preparedLexicalFixture("ready", "word", "word here", 0, 4, "context-reviewed")
			context := entry["contexts"].([]any)[0].(map[string]any)
			entry["quality"] = map[string]any{"status": "context-reviewed"}
			switch scenario {
			case "ai":
				context["quality"] = "ai-context-reviewed"
			case "entry-status-only":
				delete(context, "quality")
			case "missing-ru":
				delete(context, "ru")
			case "blank-ru":
				context["ru"] = " \n\t "
			case "missing-sense":
				delete(context, "senseId")
			case "unknown-sense":
				context["senseId"] = "other"
			case "blank-definition":
				entry["senses"].([]any)[0].(map[string]any)["definition"] = " \n "
			case "imported-quality":
				context["quality"] = "imported"
			case "archived":
				context["excludedFromStudy"] = true
			}
			fallback := lexicalFixture("reference", "word", "word there", "слово там", 0, 4)["contexts"].([]any)[0]
			entry["contexts"] = append(entry["contexts"].([]any), fallback)
			raw, _ := json.Marshal(entry)
			item, err := readLexiconItem(raw)
			if err != nil {
				t.Fatal(err)
			}
			want := scenario == "editorial" || scenario == "ai"
			if item.Prepared != want {
				t.Fatalf("prepared=%v, want %v", item.Prepared, want)
			}
			if !item.Reviewed {
				t.Fatal("context readiness changed the existing editorial entry status")
			}
		})
	}
}

func TestLexiconPreparedPreviewIsStableAndPreservesRawContextIDs(t *testing.T) {
	entry := lexicalFixture("word", "word", "word reference", "справочный пример", 0, 4)
	entry["senses"] = []any{map[string]any{"id": "sense-1", "definition": "Meaning"}}
	archived := preparedLexicalFixture("archived", "word", "word archived", 0, 4, "context-reviewed")["contexts"].([]any)[0].(map[string]any)
	archived["excludedFromStudy"] = true
	first := preparedLexicalFixture("first-ready", "word", "word first ready", 0, 4, "ai-context-reviewed")["contexts"].([]any)[0]
	second := preparedLexicalFixture("second-ready", "word", "word second ready", 0, 4, "context-reviewed")["contexts"].([]any)[0]
	entry["contexts"] = append(entry["contexts"].([]any), archived, first, second)
	raw, _ := json.Marshal(entry)
	item, err := readLexiconItem(raw)
	if err != nil {
		t.Fatal(err)
	}
	preview := item.Summary["preview"].(map[string]any)
	if preview["id"] != "first-ready-context" || preview["en"] != "word first ready" || item.Summary["preparedContexts"] != 2 || item.Summary["contextCount"] != 3 {
		t.Fatalf("wrong active prepared preview: %+v", item.Summary)
	}
	if string(item.Raw) != string(raw) {
		t.Fatal("preview selection changed original contexts, IDs or archived provenance")
	}
}

func TestLexiconPreparedFilterMetadataAndEditorialPriority(t *testing.T) {
	s := &Server{content: t.TempDir()}
	imported := lexicalFixture("issue", "issue", "issue here", "проблема здесь", 0, 5)
	ai := preparedLexicalFixture("approach", "approach", "An approach to this issue.", 3, 11, "ai-context-reviewed")
	ai["quality"] = map[string]any{"status": "ai-context-reviewed"}
	editorial := preparedLexicalFixture("board", "board", "A board issue arose.", 2, 7, "context-reviewed")
	editorial["quality"] = map[string]any{"status": "context-reviewed"}
	statusOnly := lexicalFixture("draft", "draft", "draft here", "черновик здесь", 0, 5)
	statusOnly["quality"] = map[string]any{"status": "context-reviewed"}
	writeLexicalFixture(t, s, "entries.json", lexicalDocument(imported, ai, editorial, statusOnly))
	code, body := listLexicalFixture(t, s, "?prepared=1&kind=word&list=common-list&topic=work")
	if code != 200 || body["total"] != float64(2) {
		t.Fatalf("prepared filter failed: %d %+v", code, body)
	}
	items := body["items"].([]any)
	if items[0].(map[string]any)["id"] != "board" || items[1].(map[string]any)["id"] != "approach" {
		t.Fatal("editorial entries must retain priority over other prepared entries")
	}
	metadata := body["metadata"].(map[string]any)
	if metadata["preparedEntries"] != float64(2) || metadata["reviewedEntries"] != float64(2) || metadata["totalEntries"] != float64(4) {
		t.Fatalf("prepared and existing editorial counts confused: %+v", metadata)
	}
	_, body = listLexicalFixture(t, s, "?q=issue")
	items = body["items"].([]any)
	if items[0].(map[string]any)["id"] != "issue" || items[1].(map[string]any)["id"] != "board" || items[2].(map[string]any)["id"] != "approach" {
		t.Fatal("exact headword must lead, then editorial and AI-prepared entries")
	}
	_, body = listLexicalFixture(t, s, "?prepared=1&q=issue&offset=1&limit=1")
	if body["total"] != float64(2) || body["items"].([]any)[0].(map[string]any)["id"] != "approach" {
		t.Fatal("prepared search pagination lost a matching entry")
	}
	_, body = listLexicalFixture(t, s, "?prepared=0")
	if body["total"] != float64(4) {
		t.Fatal("all mode must preserve reference entries")
	}
}
