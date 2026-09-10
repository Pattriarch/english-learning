package studio

import (
	"net/http"
	"path/filepath"
	"strings"
	"testing"
)

func TestResearchTaskUsesAuthoritativeCriteriaAndPersists(t *testing.T) {
	content, data := contentFixture(t)
	topic := researchTopic{ID: "compare-evidence", Title: "Compare evidence", Level: "C2", Skill: "mediation", Why: "Preserve uncertainty", PracticePrompt: "Summarise the two observations without claiming causation.", SuccessCriteria: []string{"Preserve both observations", "Do not infer causation"}}
	writeFixture(t, filepath.Join(content, "research-topics.json"), map[string]any{"topics": []researchTopic{topic}})
	s := openFixture(t, content, data)
	withMockModel(t, s, func(w http.ResponseWriter, r *http.Request) {
		_, input := modelInput(t, r)
		if input["level"] != "C2" || input["task"] != topic.PracticePrompt || !strings.Contains(input["context"].(string), "Do not infer causation") || strings.Contains(input["context"].(string), "CLIENT OVERRIDE") {
			t.Error("Client overrode research task", input)
		}
		if !strings.Contains(input["context"].(string), "cannot demonstrate pronunciation") {
			t.Error("Missing assessment boundary")
		}
		jsonResponse(w, 200, map[string]any{"message": map[string]string{"content": `{"verdict":"correct","summary":"Верно","corrected":"The observations do not establish causation.","explanation":"The limitation is preserved."}`}})
	})
	w := call(t, s, "POST", "/api/check", map[string]string{"id": "research-answer", "lessonId": "research", "exerciseId": topic.ID, "answer": "The observations do not establish causation.", "prompt": "CLIENT OVERRIDE", "context": "CLIENT OVERRIDE", "level": "A1"})
	if w.Code != 200 {
		t.Fatal(w.Code, w.Body.String())
	}
	reopened := openFixture(t, content, data)
	if a := reopened.db.snapshot().Attempts; len(a) != 1 || a[0].LessonID != "research" || a[0].ExerciseID != topic.ID || a[0].Prompt != topic.PracticePrompt {
		t.Fatal("Research answer did not persist", a)
	}
	if _, _, ok := s.findExercise("research", "missing"); ok {
		t.Fatal("Unknown topic accepted")
	}
}

func TestResearchCatalogRejectsMissingTaskDuplicateAndInvalidLevel(t *testing.T) {
	valid := researchTopic{ID: "clarify", Title: "Clarify", Level: "A2", PracticePrompt: "Ask for clarification.", SuccessCriteria: []string{"Ask a clear question"}}
	for _, name := range []string{"missing-task", "duplicate", "invalid-level"} {
		t.Run(name, func(t *testing.T) {
			content, data := contentFixture(t)
			topic := valid
			topics := []researchTopic{topic}
			switch name {
			case "missing-task":
				topics[0].PracticePrompt = ""
			case "duplicate":
				topics = append(topics, topic)
			case "invalid-level":
				topics[0].Level = "C3"
			}
			writeFixture(t, filepath.Join(content, "research-topics.json"), map[string]any{"topics": topics})
			if _, err := New(data, content, ""); err == nil {
				t.Fatal("Invalid research catalog accepted")
			}
		})
	}
}
