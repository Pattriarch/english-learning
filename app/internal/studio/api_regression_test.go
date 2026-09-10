package studio

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"path/filepath"
	"reflect"
	"sync"
	"sync/atomic"
	"testing"
	"time"
)

func TestDraftAcknowledgesExactHighResolutionTimestamp(t *testing.T) {
	s := testServer(t)
	const key = "present:e1"
	var last Draft
	hasFractionalSeconds := false
	for i := 0; i < 3; i++ {
		text := fmt.Sprintf("Draft revision %d", i)
		response := call(t, s, "POST", "/api/draft", map[string]string{"key": key, "text": text})
		var result struct {
			OK    bool  `json:"ok"`
			Draft Draft `json:"draft"`
		}
		if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &result) != nil || !result.OK {
			t.Fatal("draft save was not acknowledged", response.Code, response.Body.String())
		}
		last = s.db.snapshot().Drafts[key]
		if result.Draft != last || result.Draft.Text != text {
			t.Fatalf("acknowledged draft differs from saved draft: response=%+v stored=%+v", result.Draft, last)
		}
		at, err := time.Parse(time.RFC3339Nano, result.Draft.At)
		if err != nil {
			t.Fatal("invalid draft timestamp", err)
		}
		hasFractionalSeconds = hasFractionalSeconds || at.Nanosecond() != 0
	}
	if !hasFractionalSeconds {
		t.Fatal("draft timestamps still discard sub-second precision")
	}
	reopened, err := openDatabase(s.db.dir)
	if err != nil {
		t.Fatal(err)
	}
	if reopened.snapshot().Drafts[key] != last {
		t.Fatal("acknowledged draft changed after reopening the progress file")
	}
}

func TestConcurrentCheckRetriesReturnThePersistedAssessment(t *testing.T) {
	s := testServer(t)
	arrived := make(chan struct{}, 2)
	release := make(chan struct{})
	var releaseOnce sync.Once
	defer releaseOnce.Do(func() { close(release) })
	var modelCalls atomic.Int32
	withMockModel(t, s, func(w http.ResponseWriter, r *http.Request) {
		n := modelCalls.Add(1)
		arrived <- struct{}{}
		<-release
		// An LLM may legitimately word two assessments differently. Both clients
		// still need the one saved under their shared idempotency key.
		feedback := Feedback{Verdict: "correct", Summary: fmt.Sprintf("Assessment %d", n), Corrected: "I am working from home today.", Explanation: "A temporary situation."}
		raw, _ := json.Marshal(feedback)
		jsonResponse(w, 200, map[string]any{"message": map[string]string{"content": string(raw)}})
	})
	payload := map[string]string{"id": "concurrent-retry", "lessonId": "present", "exerciseId": "e1", "answer": "I am working from home today.", "mode": "translation"}
	responses := make(chan *httptest.ResponseRecorder, 2)
	for i := 0; i < 2; i++ {
		go func() { responses <- call(t, s, "POST", "/api/check", payload) }()
	}
	for i := 0; i < 2; i++ {
		select {
		case <-arrived:
		case <-time.After(3 * time.Second):
			t.Fatal("both retries must reach the model before either response is saved")
		}
	}
	releaseOnce.Do(func() { close(release) })
	for i := 0; i < 2; i++ {
		response := <-responses
		if response.Code != http.StatusOK {
			t.Fatal(response.Code, response.Body.String())
		}
		var returned Attempt
		if err := json.Unmarshal(response.Body.Bytes(), &returned); err != nil {
			t.Fatal(err)
		}
		persisted := s.db.snapshot().Attempts
		if len(persisted) != 1 || !reflect.DeepEqual(returned, persisted[0]) {
			t.Fatalf("response is not the single saved assessment: returned=%+v persisted=%+v", returned, persisted)
		}
	}
	reopened, err := openDatabase(s.db.dir)
	if err != nil || len(reopened.snapshot().Attempts) != 1 {
		t.Fatal("retry result was not preserved after reopening", err)
	}
}

func TestAddCardRetryReturnsExistingCardAndReviewSchedule(t *testing.T) {
	s := testServer(t)
	card := Card{ID: "card-retry", Front: "Временно работаю дома", Back: "I am working from home."}
	if response := call(t, s, "POST", "/api/cards", card); response.Code != http.StatusOK {
		t.Fatal(response.Body.String())
	}
	if response := call(t, s, "POST", "/api/review", Review{ID: "review-before-retry", CardID: card.ID, Rating: 2}); response.Code != http.StatusOK {
		t.Fatal(response.Body.String())
	}
	persisted := s.db.snapshot().Cards[0]
	response := call(t, s, "POST", "/api/cards", card)
	if response.Code != http.StatusOK {
		t.Fatal(response.Body.String())
	}
	var returned Card
	if err := json.Unmarshal(response.Body.Bytes(), &returned); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(returned, persisted) || returned.Repetitions != 1 || returned.Interval != 1 {
		t.Fatalf("retry returned a reset, unsaved card: returned=%+v persisted=%+v", returned, persisted)
	}
	if cards := s.db.snapshot().Cards; len(cards) != 1 || !reflect.DeepEqual(cards[0], persisted) {
		t.Fatal("card creation retry modified stored progress")
	}
}

func TestBookBuildStatusPreservesAvailabilityDuringVisualUpgrade(t *testing.T) {
	// The application may already serve a text-based lesson while the worker
	// prepares its visual revision. Both dimensions must reach the browser.
	for _, visual := range []bool{false, true} {
		s, id, _ := readyBookFixture(t)
		buildStatus := "running"
		if visual {
			s, id, _ = visualReleaseFixture(t)
			buildStatus = "ready"
		}
		s.web = t.TempDir()
		statusPath := filepath.Join(s.web, "book-content", "status.json")
		writeFixture(t, statusPath, map[string]any{"state": "running", "units": map[string]any{id: map[string]any{"status": "ready", "buildStatus": buildStatus, "visualReady": visual, "error": "PRIVATE DIAGNOSTIC"}}})
		response := call(t, s, "GET", "/api/library/status", nil)
		var result struct {
			Ready       int `json:"ready"`
			VisualReady int `json:"visualReady"`
			Running     int `json:"running"`
			Units       map[string]struct {
				Status      string `json:"status"`
				BuildStatus string `json:"buildStatus"`
				VisualReady bool   `json:"visualReady"`
			} `json:"units"`
			Books map[string]map[string]int `json:"books"`
		}
		if response.Code != http.StatusOK || json.Unmarshal(response.Body.Bytes(), &result) != nil {
			t.Fatal(response.Code, response.Body.String())
		}
		expectedVisual, expectedRunning := 0, 1
		if visual {
			expectedVisual, expectedRunning = 1, 0
		}
		if result.Ready != 1 || result.VisualReady != expectedVisual || result.Running != expectedRunning {
			t.Fatal("availability and build progress were conflated", response.Body.String())
		}
		if unit := result.Units[id]; unit.Status != "ready" || unit.BuildStatus != buildStatus || unit.VisualReady != visual {
			t.Fatal("unit lost its visual build state", unit)
		}
		if book := result.Books["book-c2"]; book["ready"] != 1 || book["visualReady"] != expectedVisual {
			t.Fatal("book lost its visual completion count", book)
		}
	}
}
