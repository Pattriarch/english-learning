package studio

import (
	"encoding/json"
	"net/http/httptest"
	"reflect"
	"testing"
)

func TestLexiconGroupingBeforePaginationPreservesEveryFilteredMember(t *testing.T) {
	s := &Server{content: t.TempDir()}
	thread := lexicalFixture("lex-thread", "thread", "thread for sewing", "нить для шитья", 0, 6)
	other := lexicalFixture("other", "other", "other meaning", "другое значение", 0, 5)
	phrase := lexicalFixture("us-thread", "thread", "thread online", "ветка обсуждения", 0, 6)
	phrase["kind"] = "phrase"
	phrase["memberships"] = []any{map[string]any{"sourceId": "phrases"}}
	phrase["topics"] = []any{map[string]any{"id": "online", "title": "Online discussions"}}
	writeLexicalFixture(t, s, "entries.json", lexicalDocument(thread, other))
	writeLexicalFixture(t, s, "american-phrases.json", lexicalDocument(phrase))
	code, first := listLexicalFixture(t, s, "?limit=1")
	if code != 200 || first["total"] != float64(2) || first["matchedEntries"] != float64(3) {
		t.Fatalf("entry pages were not grouped first: %+v", first)
	}
	item := first["items"].([]any)[0].(map[string]any)
	if item["memberCount"] != float64(2) || item["groupContextCount"] != float64(2) || item["contextCount"] != float64(1) {
		t.Fatalf("lost individual/group counts: %+v", item)
	}
	members := item["members"].([]any)
	if members[0].(map[string]any)["id"] != "lex-thread" || members[1].(map[string]any)["id"] != "us-thread" {
		t.Fatal("separated page member was lost")
	}
	_, second := listLexicalFixture(t, s, "?limit=1&offset=1")
	if second["items"].([]any)[0].(map[string]any)["id"] != "other" {
		t.Fatal("the same headword reappeared on the next page")
	}
	metadata := first["metadata"].(map[string]any)
	if metadata["uniqueHeadwords"] != float64(2) || metadata["sourceCollections"] != float64(3) || metadata["totalEntries"] != float64(3) {
		t.Fatal("source entries were conflated with displayed headwords")
	}
	for _, query := range []string{"?kind=phrase", "?list=phrases", "?topic=online", "?q=ветка"} {
		_, filtered := listLexicalFixture(t, s, query)
		row := filtered["items"].([]any)[0].(map[string]any)
		if filtered["total"] != float64(1) || filtered["matchedEntries"] != float64(1) || row["id"] != "us-thread" || row["memberCount"] != float64(1) || row["allMemberCount"] != float64(2) {
			t.Fatalf("filter pulled in an unrelated sibling: %s %+v", query, filtered)
		}
	}
	_, filtered := listLexicalFixture(t, s, "?kind=word&q=thread")
	if filtered["items"].([]any)[0].(map[string]any)["id"] != "lex-thread" || filtered["matchedEntries"] != float64(1) {
		t.Fatal("word filter included phrase collection")
	}
}

func TestLexiconGroupedExactLookupRetainsOriginalSourcesAndSnapshot(t *testing.T) {
	s := &Server{content: t.TempDir()}
	one := lexicalFixture("lex-runway", "runway", "runway for a plane", "полоса для самолёта", 0, 6)
	two := lexicalFixture("us-runway", "runway", "runway for a startup", "запас средств стартапа", 0, 6)
	two["kind"] = "phrase"
	writeLexicalFixture(t, s, "entries.json", lexicalDocument(one))
	writeLexicalFixture(t, s, "american-phrases.json", lexicalDocument(two))
	snapshot, err := s.currentLexicon()
	if err != nil {
		t.Fatal(err)
	}
	before, _ := json.Marshal(snapshot)
	for _, original := range []map[string]any{one, two} {
		id := original["id"].(string)
		r := httptest.NewRequest("GET", "/api/lexicon/"+id, nil)
		r.SetPathValue("id", id)
		w := httptest.NewRecorder()
		s.lexiconGet(w, r)
		var response struct {
			Entry    map[string]any
			Siblings []map[string]any
		}
		if err := json.Unmarshal(w.Body.Bytes(), &response); err != nil {
			t.Fatal(err)
		}
		expected, _ := json.Marshal(original)
		actual, _ := json.Marshal(response.Entry)
		if w.Code != 200 || string(expected) != string(actual) || len(response.Siblings) != 2 {
			t.Fatalf("exact lookup merged or lost raw source: %s %s", id, w.Body.String())
		}
	}
	listLexicalFixture(t, s, "?q=startup&limit=1")
	after, _ := json.Marshal(snapshot)
	if !reflect.DeepEqual(before, after) {
		t.Fatal("request grouping mutated cached source/progress identity")
	}
}

func TestLexiconHeadwordNormalizationDoesNotMergeCaseOrDifferentSpellings(t *testing.T) {
	if lexiconHeadword("  can’t\t wait  ") != "can't wait" {
		t.Fatal("whitespace/apostrophe normalization")
	}
	for _, pair := range [][2]string{{"US", "us"}, {"resume", "résumé"}, {"co-operate", "cooperate"}, {"ｔｈｒｅａｄ", "thread"}} {
		if lexiconHeadword(pair[0]) == lexiconHeadword(pair[1]) {
			t.Fatalf("unsupported equivalence: %v", pair)
		}
	}
}
