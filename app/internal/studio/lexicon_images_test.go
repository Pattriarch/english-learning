package studio

import (
	"encoding/json"
	"os"
	"path/filepath"
	"reflect"
	"testing"
)

func imageOverlayFixture(t *testing.T, s *Server, entryID, contextID, english, sense, meaning string) (lexiconImageOverlay, []byte) {
	t.Helper()
	s.web = t.TempDir()
	// A PNG signature suffices for the upload/media type check; no external image.
	png := append([]byte("\x89PNG\r\n\x1a\n"), make([]byte, 64)...)
	asset := lexiconImageAsset{ID: "test-scene", Src: "/assets/learning-figures/test-scene.png", SHA256: lexiconDigest(png), Alt: "A person reading on a bench.", SourceID: "test-original-image", AssociationRu: "Иллюстрация выбранной ситуации, не описание всей сцены."}
	path := filepath.Join(s.web, "assets", "learning-figures", "test-scene.png")
	if err := os.MkdirAll(filepath.Dir(path), 0700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(path, png, 0600); err != nil {
		t.Fatal(err)
	}
	return lexiconImageOverlay{Version: lexiconImagesVersion, Assets: []lexiconImageAsset{asset}, Bindings: []lexiconImageBinding{{
		EntryID: entryID, ContextID: contextID, EnglishSHA256: lexiconDigest([]byte(english)), SenseID: sense,
		MeaningRuSHA256: lexiconDigest([]byte(meaning)), ImageID: asset.ID, Evidence: "The inspected scene matches only the selected context and its concrete meaning.",
	}}}, png
}

func TestLexiconContextImageAppliesAfterFullAnalysisWithoutChangingSourceOrHistory(t *testing.T) {
	s, original, row := fullFixtureBase(t)
	original["images"] = []any{map[string]any{"src": "/assets/vocabulary-scenes/legacy.png", "contextId": "different-context", "alt": "Existing image."}}
	writeLexicalFixture(t, s, "entries.json", lexicalDocument(original))
	writeFullFixture(t, s, []lexiconFullRow{row}, 1, 1)
	beforeBase, _ := os.ReadFile(filepath.Join(s.content, "lexicon", "entries.json"))
	beforePublication, _ := os.ReadFile(filepath.Join(s.content, "lexicon", "full-analysis.json"))
	before, err := s.currentLexicon()
	if err != nil {
		t.Fatal(err)
	}
	old := fullEntryMap(t, before, "issue")
	registry, _ := imageOverlayFixture(t, s, row.EntryID, row.ContextID, row.En, row.ContextID+"-rich-sense-v1", row.MeaningRu)
	writeLexicalFixture(t, s, "context-images.json", registry)
	after, err := s.currentLexicon()
	if err != nil {
		t.Fatal(err)
	}
	entry := fullEntryMap(t, after, "issue")
	images := entry["images"].([]any)
	if len(images) != 2 || !reflect.DeepEqual(images[0], old["images"].([]any)[0]) {
		t.Fatal("existing image was lost or duplicated")
	}
	image := images[1].(map[string]any)
	if image["contextId"] != row.ContextID || image["src"] != registry.Assets[0].Src {
		t.Fatal("wrong context or asset attached")
	}
	entry["images"] = old["images"]
	if !reflect.DeepEqual(entry, old) || !reflect.DeepEqual(after.Metadata["fullAnalysis"], before.Metadata["fullAnalysis"]) {
		t.Fatal("image overlay changed source meaning, history, identity or publication counts")
	}
	for name, expected := range map[string][]byte{"entries.json": beforeBase, "full-analysis.json": beforePublication} {
		actual, _ := os.ReadFile(filepath.Join(s.content, "lexicon", name))
		if string(actual) != string(expected) {
			t.Fatalf("image application wrote %s", name)
		}
	}
}

func TestLexiconContextImageRejectsStaleTextMeaningSiblingAndArchive(t *testing.T) {
	s := &Server{content: t.TempDir()}
	e := lexicalFixture("bench", "bench", "I read on the bench.", "Я читаю на скамейке.", 14, 19)
	c := e["contexts"].([]any)[0].(map[string]any)
	c["senseId"], c["meaningRu"] = "bench-seat", "скамейка"
	registry, _ := imageOverlayFixture(t, s, "bench", "bench-context", c["en"].(string), "bench-seat", "скамейка")
	writeLexicalFixture(t, s, "context-images.json", registry)
	overlay, _, err := readLexiconContextImages(filepath.Join(s.content, "lexicon"), s.web)
	if err != nil {
		t.Fatal(err)
	}
	for _, scenario := range []string{"valid", "same-ID-new-English", "same-English-new-meaning", "new-sense", "sibling-entry", "sibling-context", "archive"} {
		t.Run(scenario, func(t *testing.T) {
			var altered map[string]any
			_ = json.Unmarshal(lexicalRaw(e), &altered)
			context := altered["contexts"].([]any)[0].(map[string]any)
			switch scenario {
			case "same-ID-new-English":
				context["en"] = "The judge took her place on the bench."
			case "same-English-new-meaning":
				context["meaningRu"] = "судейская коллегия"
			case "new-sense":
				context["senseId"] = "bench-judges"
			case "sibling-entry":
				altered["id"] = "other-bench"
			case "sibling-context":
				context["id"] = "another-context"
			case "archive":
				context["excludedFromStudy"] = true
			}
			raw, err := overlay.apply(lexicalRaw(altered))
			if err != nil {
				t.Fatal(err)
			}
			var result map[string]any
			_ = json.Unmarshal(raw, &result)
			if (result["images"] != nil) != (scenario == "valid") {
				t.Fatalf("incorrect image binding for %s", scenario)
			}
		})
	}
}

func TestLexiconContextImageAssetChangeInvalidatesCacheWithoutRemovingDictionary(t *testing.T) {
	s := &Server{content: t.TempDir()}
	e := lexicalFixture("bench", "bench", "I read on the bench.", "Я читаю на скамейке.", 14, 19)
	c := e["contexts"].([]any)[0].(map[string]any)
	c["senseId"], c["meaningRu"] = "bench-seat", "скамейка"
	writeLexicalFixture(t, s, "entries.json", lexicalDocument(e))
	registry, png := imageOverlayFixture(t, s, "bench", "bench-context", c["en"].(string), "bench-seat", "скамейка")
	writeLexicalFixture(t, s, "context-images.json", registry)
	before, err := s.currentLexicon()
	if err != nil || fullEntryMap(t, before, "bench")["images"] == nil {
		t.Fatal("missing initial image", err)
	}
	path := filepath.Join(s.web, "assets", "learning-figures", "test-scene.png")
	info, _ := os.Stat(path)
	png[len(png)-1] = 1 // Same length and timestamp must not reuse the old image proof.
	_ = os.WriteFile(path, png, 0600)
	_ = os.Chtimes(path, info.ModTime(), info.ModTime())
	after, err := s.currentLexicon()
	if err != nil || len(after.Items) != 1 || fullEntryMap(t, after, "bench")["images"] != nil {
		t.Fatal("changed optional image must disappear without blocking dictionary text", err)
	}
	if after.Metadata["contextImages"].(map[string]any)["unavailableAssets"] != 1 {
		t.Fatal("unavailable image was not reported")
	}
}

func TestLexiconContextImageRegistryRestrictsPathsAndUniqueBindings(t *testing.T) {
	s := &Server{content: t.TempDir()}
	registry, _ := imageOverlayFixture(t, s, "bench", "context", "Read on a bench.", "seat", "скамейка")
	for _, source := range []string{"https://example.com/image.png", "/assets/learning-figures/../secret.png", "/assets/learning-figures/x%2fy.png", "/assets/learning-figures/x.svg", "/media/private.png", "/assets/learning-figures/x.png?other"} {
		copy := registry
		copy.Assets = append([]lexiconImageAsset(nil), registry.Assets...)
		copy.Assets[0].Src = source
		writeLexicalFixture(t, s, "context-images.json", copy)
		if _, _, err := readLexiconContextImages(filepath.Join(s.content, "lexicon"), s.web); err == nil {
			t.Errorf("accepted unsafe asset %q", source)
		}
	}
	registry.Bindings = append(registry.Bindings, registry.Bindings[0])
	writeLexicalFixture(t, s, "context-images.json", registry)
	if _, _, err := readLexiconContextImages(filepath.Join(s.content, "lexicon"), s.web); err == nil {
		t.Fatal("duplicate binding accepted")
	}
}

func TestPublishedContextImagesPreserveExistingPhraseImagesAndFullCounts(t *testing.T) {
	s := &Server{content: filepath.Join("..", "..", "content"), web: filepath.Join("..", "..", "studio")}
	all, err := s.currentLexicon()
	if err != nil {
		t.Fatal(err)
	}
	entry := fullEntryMap(t, all, "lex-bench-1b32c28c")
	images := entry["images"].([]any)
	if len(images) != 1 || images[0].(map[string]any)["contextId"] != "tatoeba-7909298-7909303" {
		t.Fatal("published bench example has no exact scene")
	}
	var phraseBank struct{ Entries []map[string]any }
	raw, err := os.ReadFile(filepath.Join(s.content, "lexicon", "american-phrases.json"))
	if err != nil || json.Unmarshal(raw, &phraseBank) != nil {
		t.Fatal("cannot read phrase image baseline", err)
	}
	for _, original := range phraseBank.Entries {
		active := fullEntryMap(t, all, original["id"].(string))
		if !reflect.DeepEqual(active["images"], original["images"]) {
			t.Fatalf("existing phrase images changed: %s", original["id"])
		}
	}
	if all.Metadata["fullAnalysisContexts"] != 18534 || all.Metadata["fullAnalysisEntries"] != 10987 {
		t.Fatal("image overlay altered publication coverage")
	}
}
