package studio

import (
	"encoding/json"
	"net/http"
	"strings"
	"testing"
)

func TestBeginnerFreeListeningAcceptsShortTaughtMaterialAndPersists(t *testing.T) {
	content, data := contentFixture(t)
	s := openFixture(t, content, data)
	passages := map[string]string{
		"A1": "My name is Sam. I am here.",
		"A2": "Sam is at the cafe. He wants tea and a sandwich. The cafe closes at five. His friend arrives at four on Monday.",
	}
	withMockModel(t, s, func(w http.ResponseWriter, r *http.Request) {
		system, input := modelInput(t, r)
		level, _ := input["level"].(string)
		if !strings.Contains(system, "ONE phrase of 2–6 English words") || !strings.Contains(system, "no minimum number of seconds") || strings.Contains(system, "writing20–40") {
			t.Error("beginner free practice lost gradual output constraints")
		}
		task, _ := json.Marshal(map[string]string{"title": "Одно понятное сообщение", "prompt": "Прочитай короткое сообщение. Как зовут человека? Одного имени достаточно.", "passage": passages[level]})
		jsonResponse(w, http.StatusOK, map[string]any{"message": map[string]string{"content": string(task)}})
	})
	for _, level := range []string{"A1", "A2"} {
		w := call(t, s, "POST", "/api/practice/task", map[string]string{"mode": "listening", "level": level})
		if w.Code != http.StatusOK {
			t.Fatalf("short %s passage rejected: %d %s", level, w.Code, w.Body.String())
		}
		var saved map[string]any
		if err := json.Unmarshal([]byte(s.db.snapshot().Drafts["practice-task:listening"].Text), &saved); err != nil || saved["passage"] != passages[level] || saved["level"] != level {
			t.Fatalf("beginner practice was not saved: %v %v", saved, err)
		}
	}
}
