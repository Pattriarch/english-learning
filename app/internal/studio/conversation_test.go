package studio

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"
)

func TestConversationRespondsToHistoryAndSavesWithoutClaimingAssessment(t *testing.T) {
	s := testServer(t)
	calls := 0
	provider := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls++
		var b struct{ Messages []struct{ Content string } }
		_ = json.NewDecoder(r.Body).Decode(&b)
		if len(b.Messages) != 2 || !strings.Contains(b.Messages[0].Content, "American English") || !strings.Contains(b.Messages[1].Content, "I can come at six") {
			t.Error("missing actual user content or role")
		}
		_ = json.NewEncoder(w).Encode(map[string]any{"choices": []any{map[string]any{"message": map[string]string{"content": `{"reply":"Six works. Can you come to room four?"}`}}}})
	}))
	defer provider.Close()
	s.db.settings.Provider, s.db.settings.Endpoint, s.db.settings.Model = "compatible", provider.URL, "test"
	b := map[string]any{"id": "session-one", "requestID": "reply-one", "scenarioID": "arrival", "answer": "I can come at six.", "mode": "writing", "expectedTurns": 0}
	for i := 0; i < 2; i++ {
		w := call(t, s, "POST", "/api/conversation/turn", b)
		if w.Code != 200 {
			t.Fatalf("%d %s", w.Code, w.Body.String())
		}
	}
	if calls != 1 {
		t.Fatal("retry repeated provider call")
	}
	p := s.db.snapshot()
	session, err := conversationSaved(p, "session-one")
	if err != nil || len(session.Turns) != 1 {
		t.Fatal("dialogue not saved")
	}
	if len(p.Attempts) != 0 {
		t.Fatal("conversation falsely became an assessed task")
	}
	b["requestID"] = "reply-two"
	if w := call(t, s, "POST", "/api/conversation/turn", b); w.Code != 409 {
		t.Fatal("stale turn accepted")
	}
	if calls != 1 {
		t.Fatal("stale request reached provider")
	}
	b["requestID"] = "reply-one"
	b["answer"] = "A different answer."
	if w := call(t, s, "POST", "/api/conversation/turn", b); w.Code != 409 {
		t.Fatal("changed idempotent answer accepted")
	}
}
func TestConversationValidationAndCatalog(t *testing.T) {
	s := testServer(t)
	if w := call(t, s, "GET", "/api/conversation/scenarios", nil); w.Code != 200 || !strings.Contains(w.Body.String(), `"C2"`) {
		t.Fatal("missing complete level scenarios")
	}
	for _, b := range []map[string]any{{"id": "../profile", "requestID": "valid", "scenarioID": "arrival", "answer": "Hello there", "mode": "writing"}, {"id": "valid", "requestID": "valid", "scenarioID": "unknown", "answer": "Hello there", "mode": "writing"}, {"id": "valid", "requestID": "valid", "scenarioID": "arrival", "answer": "Hello there", "mode": "forged"}} {
		if w := call(t, s, "POST", "/api/conversation/turn", b); w.Code != 400 {
			t.Fatalf("invalid request got %d", w.Code)
		}
	}
}

func TestConversationReviewUsesCompleteSavedVersion(t *testing.T) {
	s := testServer(t)
	session := conversationSession{Version: 1, ID: "long-conversation", ScenarioID: "hearing", Turns: []conversationTurn{}}
	for i := 0; i < 6; i++ {
		session.Turns = append(session.Turns, conversationTurn{ID: string(rune('a'+i)) + "-turn", Answer: strings.Repeat("My original argument. ", 80), Reply: strings.Repeat("A relevant partner reply. ", 42), Mode: "writing", At: stamp()})
	}
	raw, _ := json.Marshal(session)
	if len(raw) > 19500 {
		t.Fatal("fixture exceeds session limit")
	}
	_ = s.db.change(func(p *Progress) error {
		p.Drafts["conversation:v1:"+session.ID] = Draft{Text: string(raw), At: stamp()}
		return nil
	})
	l, e, ok := s.conversationExercise(session.ID + "-6")
	if !ok || l.Level != "C2" || !strings.Contains(e.Context, session.Turns[5].Reply) || strings.Count(e.Context, "Learner:") != 6 || len(e.Context) < 16000 {
		t.Fatal("long dialogue was truncated or version missing")
	}
	_, short, ok := s.conversationExercise(session.ID + "-2")
	if !ok || strings.Count(short.Context, "Learner:") != 2 {
		t.Fatal("earlier review version leaked later turns")
	}
	if _, _, ok = s.conversationExercise(session.ID + "-7"); ok {
		t.Fatal("unavailable version accepted")
	}
	w := call(t, s, "POST", "/api/check", map[string]string{"id": "review-whole-conversation", "lessonId": "conversation", "exerciseId": session.ID + "-6", "answer": "I developed my own complete argument and responded to every challenge.", "context": "forged context", "prompt": "forged prompt", "mode": "writing"})
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var attempt Attempt
	_ = json.Unmarshal(w.Body.Bytes(), &attempt)
	if attempt.Prompt != e.Prompt || attempt.Feedback.Verdict != "ungraded" {
		t.Fatal("trusted context or offline boundary lost")
	}
}

func TestConversationRejectsMalformedImportedSessions(t *testing.T) {
	s := testServer(t)
	for _, raw := range []string{`{"version":1,"id":"bad-session","scenarioId":"arrival","turns":[{}]}`, `{"version":1,"id":"bad-session","scenarioId":"unknown","turns":[]}`, `{"version":1,"id":"bad-session","scenarioId":"arrival","turns":"wrong"}`} {
		p := initial()
		p.Drafts["conversation:v1:bad-session"] = Draft{Text: raw, At: stamp()}
		if _, err := conversationSaved(p, "bad-session"); err == nil {
			t.Fatal("malformed session accepted", raw)
		}
	}
	valid := conversationSession{Version: 1, ID: "future-session", ScenarioID: "arrival", Turns: []conversationTurn{{ID: "future-turn", Answer: "Hello, I am Alex.", Reply: "Hello Alex. What time works?", Mode: "writing", At: time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339)}}}
	raw, _ := json.Marshal(valid)
	_ = s.db.change(func(p *Progress) error {
		p.Drafts["conversation:v1:"+valid.ID] = Draft{Text: string(raw), At: stamp()}
		return nil
	})
	if _, _, ok := s.conversationExercise(valid.ID + "-1"); ok {
		t.Fatal("future imported dialogue assessed")
	}
}
func TestLexiconExcludedContextIsPreservedButNeverPreviewed(t *testing.T) {
	entry := lexicalFixture("mi", "mi", "Sámi is a language.", "Исходник", 2, 4)
	contexts := entry["contexts"].([]any)
	contexts[0].(map[string]any)["excludedFromStudy"] = true
	entry["contexts"] = append(contexts, map[string]any{"id": "valid-mi", "en": "Sing do, re, mi.", "ru": "Спой до, ре, ми.", "targetSpans": []any{map[string]any{"start": 13, "end": 15, "text": "mi"}}})
	// Correct the literal fixture offsets: mi begins at UTF-16 index 13.
	raw, _ := json.Marshal(entry)
	item, err := readLexiconItem(raw)
	if err != nil {
		t.Fatal(err)
	}
	preview := item.Summary["preview"].(map[string]any)
	if preview["en"] != "Sing do, re, mi." || item.Summary["contextCount"] != 1 {
		t.Fatal("excluded source leaked into practice")
	}
	if !strings.Contains(string(item.Raw), "Sámi") {
		t.Fatal("source history was discarded")
	}
}
