package studio

import "testing"

func TestDuplicateTopicLabelsShareFilterWithoutDuplicatingWords(t *testing.T) {
	s := &Server{content: t.TempDir()}
	makeEntry := func(id, word, topicID, title string) map[string]any {
		entry := lexicalFixture(id, word, word+" online", "ветка обсуждения", 0, len(word))
		entry["topics"] = []any{map[string]any{"id": topicID, "title": title}}
		return entry
	}
	writeLexicalFixture(t, s, "entries.json", lexicalDocument(
		makeEntry("first", "thread", "a", "Договорённости"),
		makeEntry("second", "thread", "b", "договоренности"),
		makeEntry("third", "agreement", "b", "договоренности"),
		makeEntry("fourth", "chat", "c", "Общение")))
	for _, id := range []string{"a", "b"} {
		code, out := listLexicalFixture(t, s, "?topic="+id)
		if code != 200 || out["total"] != float64(2) || out["matchedEntries"] != float64(3) {
			t.Fatalf("lost alias filter: %+v", out)
		}
		metadata := out["metadata"].(map[string]any)
		topics := metadata["topics"].([]any)
		if len(topics) != 2 {
			t.Fatalf("duplicate topic label: %+v", topics)
		}
		for _, raw := range topics {
			row := raw.(map[string]any)
			if row["id"] == "a" && row["count"] != float64(2) {
				t.Fatal("topic count includes duplicate words")
			}
		}
	}
	_, missing := listLexicalFixture(t, s, "?topic=missing")
	if missing["total"] != float64(0) {
		t.Fatal("unknown topic matched untagged words")
	}
}
