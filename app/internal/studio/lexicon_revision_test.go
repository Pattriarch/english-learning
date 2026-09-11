package studio

import (
	"os"
	"path/filepath"
	"reflect"
	"strings"
	"testing"
)

func revisedLexiconExample(row lexiconFullRow, en string, start int) lexiconFullRow {
	row.Action, row.En = "replace", en
	row.TargetSpans = []lexiconSpan{{start, start + 5, "issue"}}
	row.ReplacementReason = "Предыдущий пример сохранён в истории; эта новая ситуация исправляет выбор учебного значения."
	row.ExampleRevision, row.PreviousAnalyses = 0, nil
	return row
}

func priorLexiconExample(revision int, row lexiconFullRow) lexiconPreviousAnalysis {
	row.ExampleRevision, row.PreviousAnalyses = 0, nil
	return lexiconPreviousAnalysis{revision, row.Review.ReceiptSHA256, row}
}

func TestLexiconRevisedExamplePreservesAllPriorWorkIdentities(t *testing.T) {
	for _, firstAction := range []string{"keep", "replace"} {
		t.Run(firstAction, func(t *testing.T) {
			s, original, first := fullFixtureBase(t)
			basePath := filepath.Join(s.content, "lexicon", "entries.json")
			baseBytes, _ := os.ReadFile(basePath)
			if firstAction == "replace" {
				first = revisedLexiconExample(first, "We have an issue with this report.", 11)
			}
			second := revisedLexiconExample(first, "The issue delayed the launch.", 4)
			second.Review.ReceiptSHA256 = strings.Repeat("b", 64)
			second.MeaningRu = "Предыдущее уточнённое значение, сохранённое для истории."
			third := revisedLexiconExample(first, "Please explain the issue before we vote.", 19)
			third.Review.ReceiptSHA256 = strings.Repeat("c", 64)
			third.ExampleRevision = 3
			third.PreviousAnalyses = []lexiconPreviousAnalysis{priorLexiconExample(1, first), priorLexiconExample(2, second)}
			writeFullFixture(t, s, []lexiconFullRow{third}, 1, 1)
			snapshot, err := s.currentLexicon()
			if err != nil {
				t.Fatal(err)
			}
			entry := fullEntryMap(t, snapshot, "issue")
			firstID := first.ContextID
			if firstAction == "replace" {
				firstID += "-rich-v1"
			}
			old := fullContext(t, entry, firstID)
			middle := fullContext(t, entry, first.ContextID+"-rich-v2")
			active := fullContext(t, entry, first.ContextID+"-rich-v3")
			for _, expected := range []struct {
				context map[string]any
				row     lexiconFullRow
				next    string
			}{{old, first, first.ContextID + "-rich-v2"}, {middle, second, first.ContextID + "-rich-v3"}} {
				if expected.context["en"] != expected.row.En || expected.context["ru"] != expected.row.Ru ||
					expected.context["explanation"] != expected.row.Explanation || expected.context["productionTask"] != expected.row.ProductionTask ||
					expected.context["meaningRu"] != expected.row.MeaningRu || expected.context["excludedFromStudy"] != true || expected.context["replacedBy"] != expected.next ||
					expected.context["review"].(map[string]any)["receiptSHA256"] != expected.row.Review.ReceiptSHA256 {
					t.Fatal("prior task identity lost its exact text, review or successor")
				}
			}
			if active["en"] != third.En || active["excludedFromStudy"] == true || active["senseId"] != first.ContextID+"-rich-sense-v3" {
				t.Fatal("new task reused old identity or was archived")
			}
			if len(entry["senses"].([]any)) != 4 || snapshot.Items[0].Summary["contextCount"] != 1 || snapshot.Items[0].FullAnalysisContexts != 1 ||
				snapshot.Items[0].Summary["preview"].(map[string]any)["id"] != active["id"] || snapshot.Metadata["fullAnalysis"].(map[string]any)["rows"] != 1 {
				t.Fatal("historical examples inflated active coverage or appeared in preview")
			}
			origin := original["contexts"].([]any)[0].(map[string]any)
			if firstAction == "replace" {
				source := fullContext(t, entry, first.ContextID)
				if source["en"] != origin["en"] || !reflect.DeepEqual(source["source"], origin["source"]) {
					t.Fatal("original corpus example lost")
				}
			} else {
				source := old["analysisHistory"].([]any)[0].(map[string]any)["previousContext"].(map[string]any)
				if source["en"] != origin["en"] || source["explanation"] != origin["explanation"] || !reflect.DeepEqual(source["source"], origin["source"]) {
					t.Fatal("original context history lost")
				}
			}
			if bytes, _ := os.ReadFile(basePath); string(bytes) != string(baseBytes) {
				t.Fatal("revision rewrote frozen source bank")
			}
		})
	}
}

func TestLexiconExampleRevisionRejectsBrokenHistory(t *testing.T) {
	for _, scenario := range []string{"missing-history", "extra-history", "negative", "oversized", "current-keep", "sequence", "nested", "foreign-source", "foreign-row", "receipt", "no-review", "same-example", "bad-archived-spans", "bad-archived-headword", "colliding-archive"} {
		t.Run(scenario, func(t *testing.T) {
			s, entry, old := fullFixtureBase(t)
			row := revisedLexiconExample(old, "We have an issue with this report.", 11)
			row.ExampleRevision = 2
			row.PreviousAnalyses = []lexiconPreviousAnalysis{priorLexiconExample(1, old)}
			switch scenario {
			case "missing-history":
				row.PreviousAnalyses = nil
			case "extra-history":
				row.ExampleRevision = 1
			case "negative":
				row.ExampleRevision = -1
			case "oversized":
				row.ExampleRevision = 33
			case "current-keep":
				row.Action, row.ReplacementReason = "keep", ""
			case "sequence":
				row.PreviousAnalyses[0].ExampleRevision = 2
			case "nested":
				row.PreviousAnalyses[0].Row.PreviousAnalyses = []lexiconPreviousAnalysis{priorLexiconExample(1, old)}
			case "foreign-source":
				row.PreviousAnalyses[0].Row.SourceContextSHA256 = strings.Repeat("b", 64)
			case "foreign-row":
				row.PreviousAnalyses[0].Row.RowID = "another:source"
			case "receipt":
				row.PreviousAnalyses[0].ReceiptSHA256 = strings.Repeat("b", 64)
			case "no-review":
				row.PreviousAnalyses[0].Row.Review.SemanticReviewSHA256 = ""
			case "same-example":
				row.En, row.TargetSpans = old.En, old.TargetSpans
			case "bad-archived-spans":
				row.PreviousAnalyses[0].Row.TargetSpans = []lexiconSpan{{0, 5, "issue"}}
			case "bad-archived-headword":
				row.PreviousAnalyses[0].Row.ProductionTask = "Напиши адресату два предложения о новой ситуации и предложи конкретное действие."
			case "colliding-archive":
				row.PreviousAnalyses[0].Row = revisedLexiconExample(old, "The issue delayed the launch.", 4)
				entry["contexts"] = append(entry["contexts"].([]any), map[string]any{"id": old.ContextID + "-rich-v1", "en": "An issue remains.", "ru": "Проблема остаётся.", "targetSpans": []lexiconSpan{{3, 8, "issue"}}})
				writeLexicalFixture(t, s, "entries.json", lexicalDocument(entry))
			}
			writeFullFixture(t, s, []lexiconFullRow{row}, 1, 1)
			if _, err := s.currentLexicon(); err == nil {
				t.Fatal("invalid revision was accepted: " + scenario)
			}
		})
	}
}
