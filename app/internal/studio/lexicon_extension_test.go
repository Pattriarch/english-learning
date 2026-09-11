package studio

import (
	"encoding/json"
	"net/http/httptest"
	"os"
	"path/filepath"
	"testing"
)

func lexicalExtension(entries []map[string]any, aliases ...lexiconAlias) map[string]any {
	document := lexicalDocument(entries...)
	document["aliases"] = aliases
	document["sources"] = []any{map[string]any{"id": "user-coca-file", "title": "User-supplied file named COCA; corpus origin unverified"}}
	document["importSummary"] = map[string]any{"sourceRows": 4, "exactExisting": 1, "linkedForms": len(aliases), "newEntries": len(entries), "referenceOnly": 1}
	// Source-only records must never become teachable entries or boost word totals.
	document["referenceItems"] = []any{map[string]any{"word": "ProperName", "sourceRow": 4}}
	return document
}

func TestLexiconExtensionAddsEntriesAndExactAliasesWithoutChangingBaseRecords(t *testing.T) {
	s := &Server{content: t.TempDir()}
	write := preparedLexicalFixture("write", "write", "I write daily.", 2, 7, "ai-context-reviewed")
	incidental := preparedLexicalFixture("read", "read", "I read what she wrote.", 2, 6, "context-reviewed")
	incidental["quality"] = map[string]any{"status": "context-reviewed"}
	writeLexicalFixture(t, s, "entries.json", lexicalDocument(incidental, write))
	writeLexicalFixture(t, s, "coverage.json", map[string]any{"publishedWords": 2, "outputSHA256": "original-base-receipt"})
	base, err := s.currentLexicon()
	if err != nil {
		t.Fatal(err)
	}
	originalRaw := string(base.Items[base.ByID["write"]].Raw)
	newEntry := preparedLexicalFixture("snag", "snag", "A snag delayed us.", 2, 6, "ai-context-reviewed")
	alias := lexiconAlias{Word: "wrote", EntryIDs: []string{"write"}, Relation: "past tense", SourceRow: 3}
	writeLexicalFixture(t, s, "coca-extension.json", lexicalExtension([]map[string]any{newEntry}, alias))
	code, out := listLexicalFixture(t, s, "?q=WROTE")
	if code != 200 || out["total"] != float64(2) {
		t.Fatalf("source form did not resolve: %d %+v", code, out)
	}
	items := out["items"].([]any)
	first := items[0].(map[string]any)
	if first["id"] != "write" || first["matchedForms"].([]any)[0].(map[string]any)["relation"] != "past tense" {
		t.Fatalf("explicit form must outrank incidental context matches and explain the mapping: %+v", items)
	}
	metadata := out["metadata"].(map[string]any)
	if metadata["words"] != float64(3) || metadata["preparedEntries"] != float64(3) || metadata["totalEntries"] != float64(3) {
		t.Fatalf("aliases or reference items inflated learning totals: %+v", metadata)
	}
	if metadata["coverage"].(map[string]any)["outputSHA256"] != "original-base-receipt" || metadata["coverage"].(map[string]any)["publishedWords"] != float64(2) {
		t.Fatal("extension rewrote base release coverage")
	}
	extension := metadata["cocaExtension"].(map[string]any)
	if extension["newEntries"] != float64(1) || extension["aliasCount"] != float64(1) || len(extension["sources"].([]any)) != 1 {
		t.Fatalf("extension provenance is missing: %+v", extension)
	}
	_, out = listLexicalFixture(t, s, "?q=write")
	if _, leaked := out["items"].([]any)[0].(map[string]any)["matchedForms"]; leaked {
		t.Fatal("alias annotations leaked from an earlier query into the cache")
	}
	_, out = listLexicalFixture(t, s, "?q=wrot")
	if out["total"] != float64(1) || out["items"].([]any)[0].(map[string]any)["id"] != "read" {
		t.Fatal("partial alias was treated as an attested source mapping")
	}
	_, out = listLexicalFixture(t, s, "?q=wrote&list=missing")
	if out["total"] != float64(0) {
		t.Fatal("alias bypassed ordinary search filters")
	}
	_, out = listLexicalFixture(t, s, "?q=ProperName")
	if out["total"] != float64(0) {
		t.Fatal("nonstudy source reference became a learning entry")
	}
	r := httptest.NewRequest("GET", "/api/lexicon/write", nil)
	r.SetPathValue("id", "write")
	w := httptest.NewRecorder()
	s.lexiconGet(w, r)
	var detail struct {
		Entry   json.RawMessage `json:"entry"`
		Aliases []lexiconAlias  `json:"aliases"`
	}
	if err := json.Unmarshal(w.Body.Bytes(), &detail); err != nil {
		t.Fatal(err)
	}
	if w.Code != 200 || string(detail.Entry) != originalRaw || len(detail.Aliases) != 1 || detail.Aliases[0].SourceRow != 3 {
		t.Fatal("detail changed the original record or omitted source mapping evidence")
	}
	if len(base.Items) != 2 || len(base.Items[base.ByID["write"]].Aliases) != 0 {
		t.Fatal("extension mutated the previous immutable snapshot")
	}
	if err := os.Remove(filepath.Join(s.content, "lexicon", "coca-extension.json")); err != nil {
		t.Fatal(err)
	}
	_, out = listLexicalFixture(t, s, "?q=wrote")
	if out["metadata"].(map[string]any)["words"] != float64(2) || out["total"] != float64(1) {
		t.Fatal("removed optional extension or aliases survived hot reload")
	}
}

func TestLexiconExtensionRejectsInvalidTargetsAndKeepsPriorSnapshot(t *testing.T) {
	for _, scenario := range []string{"missing-target", "repeated-target", "empty-targets", "empty-form", "blank-relation", "missing-row", "duplicate-entry", "invalid-variety"} {
		t.Run(scenario, func(t *testing.T) {
			s := &Server{content: t.TempDir()}
			entry := lexicalFixture("write", "write", "I write daily.", "Я пишу каждый день.", 2, 7)
			writeLexicalFixture(t, s, "entries.json", lexicalDocument(entry))
			prior, err := s.currentLexicon()
			if err != nil {
				t.Fatal(err)
			}
			alias := lexiconAlias{Word: "wrote", EntryIDs: []string{"write"}, Relation: "past tense", SourceRow: 1}
			switch scenario {
			case "missing-target":
				alias.EntryIDs = []string{"unknown"}
			case "repeated-target":
				alias.EntryIDs = []string{"write", "write"}
			case "empty-targets":
				alias.EntryIDs = nil
			case "empty-form":
				alias.Word = " \n "
			case "blank-relation":
				alias.Relation = " "
			case "missing-row":
				alias.SourceRow = 0
			}
			doc := lexicalExtension(nil, alias)
			if scenario == "duplicate-entry" {
				doc["entries"] = []any{entry}
			}
			if scenario == "invalid-variety" {
				doc["targetVariety"] = "en-GB"
			}
			writeLexicalFixture(t, s, "coca-extension.json", doc)
			if code, _ := listLexicalFixture(t, s, ""); code != 503 {
				t.Fatal("malformed extension became available")
			}
			if s.lexicon.snapshot != prior {
				t.Fatal("failed extension replaced the previous valid snapshot")
			}
		})
	}
}

func TestLexiconAliasCanLinkSeveralValidEntriesAndNormalizeApostrophes(t *testing.T) {
	s := &Server{content: t.TempDir()}
	first := lexicalFixture("it", "it", "it works", "это работает", 0, 2)
	second := lexicalFixture("be", "be", "be careful", "будь осторожен", 0, 2)
	writeLexicalFixture(t, s, "entries.json", lexicalDocument(first))
	writeLexicalFixture(t, s, "coca-extension.json", lexicalExtension([]map[string]any{second}, lexiconAlias{Word: "it's", EntryIDs: []string{"it", "be"}, Relation: "contraction of it is", SourceRow: 2}))
	code, out := listLexicalFixture(t, s, "?q=IT%E2%80%99S")
	if code != 200 || out["total"] != float64(2) {
		t.Fatalf("apostrophe normalization or multiple targets failed: %d %+v", code, out)
	}
	for _, raw := range out["items"].([]any) {
		if len(raw.(map[string]any)["matchedForms"].([]any)) != 1 {
			t.Fatal("mapping evidence missing from one linked entry")
		}
	}
}
