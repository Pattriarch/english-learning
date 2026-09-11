package studio

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
	"time"
)

func fullFixtureRow(id, cid, en string, start, end int) lexiconFullRow {
	hash := strings.Repeat("a", 64)
	return lexiconFullRow{
		RowID: id + ":" + cid, EntryID: id, ContextID: cid, SourceContextSHA256: hash, Action: "keep", En: en,
		Ru: "В отчёте есть проблема.", MeaningEn: "A problem requiring attention.", MeaningRu: "Проблема, которую нужно решить.", POS: "noun",
		Explanation:    "В этом предложении issue обозначает проблему с документом, а не выпуск журнала. Сочетание с with указывает, с чем именно возникла проблема. Так можно обозначить затруднение и перейти к обсуждению решения с коллегой.",
		ProductionTask: "Напиши коллеге два предложения с issue: назови проблему в другом документе и предложи следующий шаг.",
		UsageNotes:     []string{"Для проблемы с чем-либо используй an issue with + предмет или процесс.", "Когда проблему решают, можно использовать сочетание resolve an issue."},
		Collocations:   []lexiconFullCollocation{{"an issue with the report", "проблема с отчётом"}, {"resolve an issue", "решить проблему"}},
		CommonMistakes: []lexiconFullMistake{{"an issue of the report", "an issue with the report", "Для проблемы с чем-либо здесь нужен with; of может обозначать выпуск издания."}},
		RegisterTags:   []string{}, TargetSpans: []lexiconSpan{{start, end, string([]rune(en)[start:end])}},
		Review: lexiconFullReview{hash, hash, hash, hash},
	}
}

func fullFixtureBase(t *testing.T) (*Server, map[string]any, lexiconFullRow) {
	t.Helper()
	s := &Server{content: t.TempDir()}
	e := lexicalFixture("issue", "issue", "An issue needs attention.", "Вопрос требует внимания.", 3, 8)
	e["rank"] = map[string]any{"value": 101, "sourceId": "test-list"}
	e["senses"] = []any{map[string]any{"id": "original-sense", "pos": "noun", "definition": "Original dictionary definition.", "definitionRu": "Исходное словарное значение."}}
	c := e["contexts"].([]any)[0].(map[string]any)
	c["source"] = map[string]any{"sourceId": "original-corpus", "url": "https://example.org/source/1", "author": "Original contributor", "license": "CC-BY-2.0"}
	c["translationSource"] = map[string]any{"sourceId": "original-translation", "url": "https://example.org/translation/1", "author": "Original translator", "license": "CC-BY-2.0"}
	c["explanation"], c["senseId"], c["register"] = "Предыдущее объяснение.", "original-sense", "Предыдущая помета."
	writeLexicalFixture(t, s, "entries.json", lexicalDocument(e))
	writeLexicalFixture(t, s, "american-phrases.json", lexicalDocument())
	writeLexicalFixture(t, s, "coca-extension.json", lexicalExtension(nil, lexiconAlias{Word: "issues", EntryIDs: []string{"issue"}, Relation: "plural", SourceRow: 7}))
	return s, e, fullFixtureRow("issue", "issue-context", "An issue needs attention.", 3, 8)
}

func writeFullFixture(t *testing.T, s *Server, rows []lexiconFullRow, targetRows, targetEntries int) lexiconFullManifest {
	t.Helper()
	m := lexiconFullManifest{Version: lexiconFullVersion, TargetVariety: "en-US", Rows: len(rows), TargetRows: targetRows, TargetEntries: targetEntries, Complete: len(rows) == targetRows,
		Source: map[string]string{"id": lexiconFullVersion, "title": "Full contextual analyses", "license": "original-project-content", "author": "English project; AI drafting and separate semantic review", "checkedAt": "2026-09-11"}}
	for _, name := range []string{"entries.json", "coca-extension.json", "american-phrases.json"} {
		raw, err := os.ReadFile(filepath.Join(s.content, "lexicon", name))
		if err != nil {
			t.Fatal(err)
		}
		m.BaseFiles = append(m.BaseFiles, lexiconFullFile{Name: name, SHA256: lexiconDigest(raw)})
	}
	name := "full-analysis-" + lexiconDigest(lexicalRaw(rows))[:24] + ".json"
	shard := map[string]any{"version": lexiconFullVersion, "rows": rows}
	writeLexicalFixture(t, s, name, shard)
	m.Shards = []lexiconFullFile{{Name: name, SHA256: lexiconDigest(lexicalRaw(shard)), Rows: len(rows)}}
	writeLexicalFixture(t, s, "full-analysis.json", m)
	return m
}

func fullEntryMap(t *testing.T, snapshot *lexiconSnapshot, id string) map[string]any {
	t.Helper()
	var entry map[string]any
	if err := json.Unmarshal(snapshot.Items[snapshot.ByID[id]].Raw, &entry); err != nil {
		t.Fatal(err)
	}
	return entry
}

func fullContext(t *testing.T, entry map[string]any, id string) map[string]any {
	t.Helper()
	for _, raw := range entry["contexts"].([]any) {
		context := raw.(map[string]any)
		if context["id"] == id {
			return context
		}
	}
	t.Fatalf("missing context %s", id)
	return nil
}

func TestLexiconFullKeepBindsSourcesPreservesIDsAndAddsOriginalSense(t *testing.T) {
	s, original, row := fullFixtureBase(t)
	originalContext := original["contexts"].([]any)[0].(map[string]any)
	baseBytes, _ := os.ReadFile(filepath.Join(s.content, "lexicon", "entries.json"))
	writeFullFixture(t, s, []lexiconFullRow{row}, 1, 1)
	snapshot, err := s.currentLexicon()
	if err != nil {
		t.Fatal(err)
	}
	entry := fullEntryMap(t, snapshot, "issue")
	c := fullContext(t, entry, "issue-context")
	if c["en"] != row.En || c["meaningRu"] != row.MeaningRu || c["senseId"] != "issue-context-rich-sense-v1" || c["quality"] != "ai-context-reviewed" || c["variety"] != "en-US-compatible" {
		t.Fatalf("rich context missing or source ID changed: %+v", c)
	}
	if !reflect.DeepEqual(c["source"], originalContext["source"]) || c["register"] != nil {
		t.Fatal("English attribution was changed or obsolete register text remained active")
	}
	history := c["analysisHistory"].([]any)[0].(map[string]any)["previousContext"].(map[string]any)
	if history["ru"] != originalContext["ru"] || history["explanation"] != originalContext["explanation"] || history["register"] != originalContext["register"] {
		t.Fatal("previous translation/explanation/register lost")
	}
	senses := entry["senses"].([]any)
	if len(senses) != 2 || senses[0].(map[string]any)["definition"] != "Original dictionary definition." || senses[1].(map[string]any)["definitionRu"] != row.MeaningRu {
		t.Fatal("new contextual definition overwrote the source dictionary")
	}
	if snapshot.Metadata["fullAnalysisEntries"] != 1 || snapshot.Metadata["fullAnalysisContexts"] != 1 || !snapshot.Items[0].Prepared {
		t.Fatalf("actual coverage absent: %+v", snapshot.Metadata)
	}
	meta := snapshot.Metadata["fullAnalysis"].(map[string]any)
	if meta["complete"] != true || meta["humanVerified"] != false || meta["rows"] != 1 {
		t.Fatal("publication completeness or review provenance is wrong")
	}
	if got, _ := os.ReadFile(filepath.Join(s.content, "lexicon", "entries.json")); string(got) != string(baseBytes) {
		t.Fatal("runtime rewrote original source bank")
	}
	_, response := listLexicalFixture(t, s, "?q=issues&prepared=1")
	first := response["items"].([]any)[0].(map[string]any)
	if first["id"] != "issue" || first["rank"].(map[string]any)["value"] != float64(101) || len(first["matchedForms"].([]any)) != 1 {
		t.Fatal("rank, alias mapping or stable progress entry ID was lost")
	}
}

func TestLexiconFullUnchangedTranslationRetainsItsAttribution(t *testing.T) {
	s, original, row := fullFixtureBase(t)
	c := original["contexts"].([]any)[0].(map[string]any)
	row.Ru = c["ru"].(string)
	writeFullFixture(t, s, []lexiconFullRow{row}, 1, 1)
	snapshot, err := s.currentLexicon()
	if err != nil {
		t.Fatal(err)
	}
	actual := fullContext(t, fullEntryMap(t, snapshot, "issue"), "issue-context")
	if !reflect.DeepEqual(actual["translationSource"], c["translationSource"]) {
		t.Fatal("unchanged third-party translation was relabeled as original project content")
	}
}

func TestLexiconFullReplacementArchivesSourceAndUsesSeparatePracticeIdentity(t *testing.T) {
	s, original, row := fullFixtureBase(t)
	originalContext := original["contexts"].([]any)[0].(map[string]any)
	row.Action, row.En = "replace", "We have an issue with this report."
	row.TargetSpans = []lexiconSpan{{11, 16, "issue"}}
	row.ReplacementReason = "Новый пример уточняет ситуацию и заменяет неподходящий исходный контекст."
	writeFullFixture(t, s, []lexiconFullRow{row}, 1, 1)
	snapshot, err := s.currentLexicon()
	if err != nil {
		t.Fatal(err)
	}
	entry := fullEntryMap(t, snapshot, "issue")
	old, current := fullContext(t, entry, row.ContextID), fullContext(t, entry, row.ContextID+"-rich-v1")
	if old["excludedFromStudy"] != true || old["exclusionReason"] != row.ReplacementReason || old["en"] != originalContext["en"] || old["ru"] != originalContext["ru"] || !reflect.DeepEqual(old["source"], originalContext["source"]) {
		t.Fatal("replacement rewrote or discarded source/history")
	}
	if old["replacedBy"] != current["id"] || current["en"] != row.En || current["source"].(map[string]any)["license"] != "original-project-content" {
		t.Fatal("new original example has no distinct practice ID/attribution")
	}
	derived := current["derivedFrom"].(map[string]any)
	if derived["contextId"] != row.ContextID || !reflect.DeepEqual(derived["source"], originalContext["source"]) {
		t.Fatal("replacement lost its source relationship")
	}
	item := snapshot.Items[0]
	if item.Summary["contextCount"] != 1 || item.Summary["preview"].(map[string]any)["id"] != current["id"] || item.FullAnalysisContexts != 1 {
		t.Fatal("archived source inflated coverage or appeared as study preview")
	}
}

func TestLexiconFullPartialPublicationCountsOnlyAppliedRowsAndPrioritizesRichPreview(t *testing.T) {
	s, e, row := fullFixtureBase(t)
	first := e["contexts"].([]any)[0].(map[string]any)
	second := map[string]any{}
	for key, value := range first {
		second[key] = value
	}
	second["id"], second["en"], second["targetSpans"] = "second", "A second issue needs attention.", []lexiconSpan{{9, 14, "issue"}}
	first["quality"] = "ai-context-reviewed"
	e["contexts"] = []any{first, second}
	writeLexicalFixture(t, s, "entries.json", lexicalDocument(e))
	row.ContextID, row.RowID, row.En, row.TargetSpans = "second", "issue:second", second["en"].(string), second["targetSpans"].([]lexiconSpan)
	writeFullFixture(t, s, []lexiconFullRow{row}, 2, 1)
	snapshot, err := s.currentLexicon()
	if err != nil {
		t.Fatal(err)
	}
	meta := snapshot.Metadata["fullAnalysis"].(map[string]any)
	if meta["complete"] != false || meta["rows"] != 1 || meta["targetRows"] != 2 || snapshot.Metadata["fullAnalysisContexts"] != 1 {
		t.Fatal("partial publication claimed complete coverage")
	}
	if snapshot.Items[0].Summary["preview"].(map[string]any)["id"] != "second" {
		t.Fatal("basic context hid the complete context in the search preview")
	}
	if _, err := s.currentLexicon(); err != nil {
		t.Fatal(err)
	}
	if err := os.Remove(filepath.Join(s.content, "lexicon", "full-analysis.json")); err != nil {
		t.Fatal(err)
	}
	base, err := s.currentLexicon()
	if err != nil || base.Metadata["fullAnalysisContexts"] != 0 || base.Items[0].Summary["preview"].(map[string]any)["id"] != "issue-context" {
		t.Fatal("removing optional overlay retained augmented data")
	}
	if snapshot.Metadata["fullAnalysisContexts"] != 1 {
		t.Fatal("cache rebuild mutated the previous immutable snapshot")
	}
}

func TestLexiconFullRejectsInvalidManifestsWithoutReplacingLastValidSnapshot(t *testing.T) {
	for _, scenario := range []string{"version", "variety", "duplicate-base", "unknown-base", "bad-base-hash", "duplicate-shard", "traversal", "absolute-path", "shard-count", "false-complete", "target-entry-count", "target-context-count", "missing-source", "missing-shard"} {
		t.Run(scenario, func(t *testing.T) {
			s, _, row := fullFixtureBase(t)
			manifest := writeFullFixture(t, s, []lexiconFullRow{row}, 1, 1)
			prior, err := s.currentLexicon()
			if err != nil {
				t.Fatal(err)
			}
			switch scenario {
			case "version":
				manifest.Version = "other"
			case "variety":
				manifest.TargetVariety = "en-GB"
			case "duplicate-base":
				manifest.BaseFiles[1] = manifest.BaseFiles[0]
			case "unknown-base":
				manifest.BaseFiles[1].Name = "../entries.json"
			case "bad-base-hash":
				manifest.BaseFiles[0].SHA256 = strings.Repeat("0", 64)
			case "duplicate-shard":
				manifest.Shards = append(manifest.Shards, manifest.Shards[0])
			case "traversal":
				manifest.Shards[0].Name = "../" + manifest.Shards[0].Name
			case "absolute-path":
				manifest.Shards[0].Name = filepath.Join(s.content, manifest.Shards[0].Name)
			case "shard-count":
				manifest.Shards[0].Rows++
			case "false-complete":
				manifest.Complete = false
			case "target-entry-count":
				manifest.TargetEntries++
			case "target-context-count":
				manifest.TargetRows++
				manifest.Complete = false
			case "missing-source":
				manifest.Source = nil
			case "missing-shard":
				if err := os.Remove(filepath.Join(s.content, "lexicon", manifest.Shards[0].Name)); err != nil {
					t.Fatal(err)
				}
			}
			writeLexicalFixture(t, s, "full-analysis.json", manifest)
			if _, err := s.currentLexicon(); err == nil {
				t.Fatal("invalid publication was served")
			}
			if s.lexicon.snapshot != prior {
				t.Fatal("failed overlay replaced last valid snapshot")
			}
		})
	}
}

func TestLexiconFullChangedBaseOrShardInvalidatesCacheAndFailsDigestValidation(t *testing.T) {
	for _, which := range []string{"entries.json", "coca-extension.json", "american-phrases.json", "shard"} {
		t.Run(which, func(t *testing.T) {
			s, _, row := fullFixtureBase(t)
			manifest := writeFullFixture(t, s, []lexiconFullRow{row}, 1, 1)
			prior, err := s.currentLexicon()
			if err != nil {
				t.Fatal(err)
			}
			name := which
			if which == "shard" {
				name = manifest.Shards[0].Name
			}
			path := filepath.Join(s.content, "lexicon", name)
			original, _ := os.ReadFile(path)
			if err := os.WriteFile(path, append(original, '\n'), 0600); err != nil {
				t.Fatal(err)
			}
			if _, err := s.currentLexicon(); err == nil || !strings.Contains(err.Error(), "hash changed") {
				t.Fatalf("cache reused changed published bytes: %v", err)
			}
			if s.lexicon.snapshot != prior {
				t.Fatal("tampering replaced valid snapshot")
			}
			if err := os.WriteFile(path, original, 0600); err != nil {
				t.Fatal(err)
			}
			if restored, err := s.currentLexicon(); err != nil || restored.Metadata["fullAnalysisContexts"] != 1 {
				t.Fatalf("valid restored bytes did not recover: %v", err)
			}
		})
	}
}

func TestLexiconFullManifestContentChangeIsDetectedEvenWithRestoredTimestamp(t *testing.T) {
	s, _, row := fullFixtureBase(t)
	writeFullFixture(t, s, []lexiconFullRow{row}, 1, 1)
	if _, err := s.currentLexicon(); err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(s.content, "lexicon", "full-analysis.json")
	info, _ := os.Stat(path)
	raw, _ := os.ReadFile(path)
	changed := strings.Replace(string(raw), `"en-US"`, `"en-GB"`, 1)
	if len(changed) != len(raw) {
		t.Fatal("fixture must retain byte length")
	}
	if err := os.WriteFile(path, []byte(changed), 0600); err != nil {
		t.Fatal(err)
	}
	if err := os.Chtimes(path, time.Now(), info.ModTime()); err != nil {
		t.Fatal(err)
	}
	if _, err := s.currentLexicon(); err == nil {
		t.Fatal("manifest content change hid behind cached file metadata")
	}
}

func TestLexiconFullShardsRejectMalformedContentAndDuplicatesAcrossShards(t *testing.T) {
	for _, scenario := range []string{"bad-json", "wrong-version", "wrong-row-count", "duplicate-across-shards"} {
		t.Run(scenario, func(t *testing.T) {
			s, _, row := fullFixtureBase(t)
			manifest := writeFullFixture(t, s, []lexiconFullRow{row}, 1, 1)
			name := manifest.Shards[0].Name
			var raw []byte
			switch scenario {
			case "bad-json":
				raw = []byte("{broken")
			case "wrong-version":
				raw = lexicalRaw(map[string]any{"version": "other", "rows": []lexiconFullRow{row}})
			case "wrong-row-count":
				raw = lexicalRaw(map[string]any{"version": lexiconFullVersion, "rows": []lexiconFullRow{}})
			case "duplicate-across-shards":
				raw = lexicalRaw(map[string]any{"version": lexiconFullVersion, "rows": []lexiconFullRow{row}})
				name = "full-analysis-" + strings.Repeat("b", 24) + ".json"
				manifest.Shards = append(manifest.Shards, lexiconFullFile{Name: name, SHA256: lexiconDigest(raw), Rows: 1})
				manifest.Rows, manifest.TargetRows = 2, 2
			}
			if err := os.WriteFile(filepath.Join(s.content, "lexicon", name), raw, 0600); err != nil {
				t.Fatal(err)
			}
			if scenario != "duplicate-across-shards" {
				manifest.Shards[0].SHA256 = lexiconDigest(raw)
			}
			writeLexicalFixture(t, s, "full-analysis.json", manifest)
			if _, err := s.currentLexicon(); err == nil {
				t.Fatal("matching digest bypassed shard validation")
			}
		})
	}
}

func TestLexiconFullReplacementSupportsWholePhrasesWithUTF16Offsets(t *testing.T) {
	s, _, row := fullFixtureBase(t)
	e := lexicalFixture("issue", "figure out", "We figure out the problem.", "Мы разбираемся в проблеме.", 3, 13)
	writeLexicalFixture(t, s, "entries.json", lexicalDocument(e))
	row.Action, row.En, row.ReplacementReason = "replace", "😀 We figure out the problem together.", "Новый авторский пример показывает решение проблемы вместе с коллегой."
	row.TargetSpans = []lexiconSpan{{6, 16, "figure out"}}
	row.ProductionTask = "Напиши коллеге два предложения с figure out: предложи разобраться в другой проблеме вместе."
	writeFullFixture(t, s, []lexiconFullRow{row}, 1, 1)
	snapshot, err := s.currentLexicon()
	if err != nil {
		t.Fatal(err)
	}
	preview := snapshot.Items[0].Summary["preview"].(map[string]any)
	spans := preview["targetSpans"].([]lexiconSpan)
	if len(spans) != 1 || spans[0].Start != 6 || spans[0].End != 16 || spans[0].Text != "figure out" || !validLexiconSpans(preview["en"].(string), spans) {
		t.Fatal("multiword target or Unicode offset was changed by the overlay")
	}
}

func TestLexiconFullRejectsUnboundTargetsAndInvalidTeachingRows(t *testing.T) {
	for _, scenario := range []string{"missing-entry", "missing-context", "row-id-mismatch", "missing-review", "missing-source-hash", "keep-text-change", "keep-span-change", "replace-same-text", "replace-missing-reason", "short-explanation", "missing-russian", "one-note", "untranslated-collocation", "unchanged-pitfall", "missing-pitfall-reason", "missing-target-task", "invalid-pos", "null-register-tags", "duplicate-target", "archived-target", "replacement-id-collision", "sense-id-collision", "wrong-replacement-target"} {
		t.Run(scenario, func(t *testing.T) {
			s, e, row := fullFixtureBase(t)
			targetRows, rows := 1, []lexiconFullRow{}
			switch scenario {
			case "missing-entry":
				row.EntryID, row.RowID = "missing", "missing:issue-context"
			case "missing-context":
				row.ContextID, row.RowID = "missing", "issue:missing"
			case "row-id-mismatch":
				row.RowID = "issue:other"
			case "missing-review":
				row.Review.SemanticReviewSHA256 = ""
			case "missing-source-hash":
				row.SourceContextSHA256 = ""
			case "keep-text-change":
				row.En = "An issue needs discussion."
			case "keep-span-change":
				row.TargetSpans = []lexiconSpan{{3, 5, "is"}}
			case "replace-same-text":
				row.Action, row.ReplacementReason = "replace", "Нужно изменить неподходящий исходный пример."
			case "replace-missing-reason":
				row.Action, row.En = "replace", "An issue needs discussion."
			case "short-explanation":
				row.Explanation = "Это проблема."
			case "missing-russian":
				row.MeaningRu = "A problem"
			case "one-note":
				row.UsageNotes = row.UsageNotes[:1]
			case "untranslated-collocation":
				row.Collocations[1].Ru = ""
			case "unchanged-pitfall":
				row.CommonMistakes[0].Wrong = row.CommonMistakes[0].Correct
			case "missing-pitfall-reason":
				row.CommonMistakes[0].Why = ""
			case "missing-target-task":
				row.ProductionTask = "Напиши коллеге два предложения и предложи следующий шаг для решения проблемы."
			case "invalid-pos":
				row.POS = "phrasal verb"
			case "null-register-tags":
				row.RegisterTags = nil
			case "duplicate-target":
				rows = append(rows, row)
				targetRows = 2
			case "archived-target":
				e["contexts"].([]any)[0].(map[string]any)["excludedFromStudy"] = true
			case "replacement-id-collision":
				row.Action, row.En, row.ReplacementReason = "replace", "An issue needs discussion.", "Нужно изменить неподходящий исходный пример."
				e["contexts"] = append(e["contexts"].([]any), map[string]any{"id": "issue-context-rich-v1", "en": "An issue remains.", "ru": "Проблема остаётся.", "targetSpans": []lexiconSpan{{3, 8, "issue"}}})
				targetRows = 2
			case "sense-id-collision":
				e["senses"].([]any)[0].(map[string]any)["id"] = "issue-context-rich-sense-v1"
			case "wrong-replacement-target":
				row.Action, row.En, row.ReplacementReason = "replace", "An issue needs discussion.", "Нужно изменить неподходящий исходный пример."
				row.TargetSpans = []lexiconSpan{{15, 25, "discussion"}}
			}
			writeLexicalFixture(t, s, "entries.json", lexicalDocument(e))
			rows = append(rows, row)
			writeFullFixture(t, s, rows, targetRows, 1)
			if _, err := s.currentLexicon(); err == nil {
				t.Fatal("invalid rich material or unbound target became available")
			}
		})
	}
}
