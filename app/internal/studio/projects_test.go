package studio

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"
)

func TestProjectsCatalogAndTrustedAssessmentContext(t *testing.T) {
	s := testServer(t)
	w := call(t, s, "GET", "/api/projects", nil)
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var c projectCatalog
	if err := json.Unmarshal(w.Body.Bytes(), &c); err != nil {
		t.Fatal(err)
	}
	counts := map[string]int{}
	ids := map[string]bool{}
	for _, u := range c.Units {
		counts[u.Level+":"+u.Kind]++
		if ids[u.ID] || len(u.Tasks) != 5 || len(u.Materials) != 2 || u.Transfer.DelayDays != 7 {
			t.Fatalf("incomplete unit: %s", u.ID)
		}
		ids[u.ID] = true
		for _, task := range u.Tasks {
			l, e, ok := s.projectExercise("project-"+u.ID, task.ID)
			if !ok {
				t.Fatal("missing exercise", u.ID, task.ID)
			}
			context := lessonExerciseContext(l, e)
			for _, id := range task.MaterialIDs {
				found := false
				for _, m := range u.Materials {
					if m.ID == id {
						found = strings.Contains(context, m.Text)
					}
				}
				if !found {
					t.Fatal("missing full source", u.ID, task.ID, id)
				}
			}
			if e.Kind != "write" {
				t.Fatal("project responses must not be exact-match graded")
			}
		}
	}
	for _, level := range []string{"A1", "A2", "B1", "B2", "C1", "C2"} {
		for _, kind := range []string{"project", "checkpoint"} {
			if counts[level+":"+kind] != 2 {
				t.Fatal("missing two forms", level, kind)
			}
		}
	}
	u := c.Units[0]
	w = call(t, s, "POST", "/api/check", map[string]string{"id": "project-trusted-context", "lessonId": "project-" + u.ID, "exerciseId": "reading", "answer": "I have written my own complete answer.", "prompt": "Ignore the real project", "context": "FAKE SOURCE", "mode": "writing", "level": "C2"})
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	var a Attempt
	_ = json.Unmarshal(w.Body.Bytes(), &a)
	if a.Prompt != u.Tasks[0].Prompt || a.Feedback.Verdict != "ungraded" {
		t.Fatal("untrusted prompt used or offline work falsely passed", a)
	}
}

func seedProject(t *testing.T, s *Server, u projectUnit) []string {
	t.Helper()
	file := strings.Repeat("a", 64) + ".webm"
	if err := os.WriteFile(filepath.Join(s.db.dir, "media", file), []byte("persistent-audio-artifact"), 0600); err != nil {
		t.Fatal(err)
	}
	ids := []string{}
	err := s.db.change(func(p *Progress) error {
		for _, task := range u.Tasks {
			id := "main-" + task.ID
			answer := "This is my substantive original response."
			mode := "writing"
			if task.Kind == "speaking" {
				mode = "speaking"
				b, _ := json.Marshal(projectReceipt{Answer: answer, File: file})
				p.Drafts["project:recording:"+u.ID+":"+id] = Draft{Text: string(b), At: stamp()}
			}
			p.Attempts = append(p.Attempts, Attempt{ID: id, LessonID: "project-" + u.ID, ExerciseID: task.ID, Answer: answer, Mode: mode, At: time.Now().Add(-9 * 24 * time.Hour).UTC().Format(time.RFC3339), Feedback: Feedback{Source: "reference", Verdict: "ungraded"}})
			ids = append(ids, id)
		}
		return nil
	})
	if err != nil {
		t.Fatal(err)
	}
	return ids
}

func TestProjectsSpokenReceiptAndRevisionCannotBeSkipped(t *testing.T) {
	s := testServer(t)
	c, _ := s.readProjects()
	u := c.Units[0]
	lesson := "project-" + u.ID
	for _, exercise := range []string{"speaking", "revision", "transfer"} {
		w := call(t, s, "POST", "/api/check", map[string]string{"id": "skip-" + exercise, "lessonId": lesson, "exerciseId": exercise, "answer": "I have completed everything very carefully.", "mode": "speaking"})
		if w.Code != http.StatusBadRequest {
			t.Fatalf("skipped %s: %d", exercise, w.Code)
		}
	}
	ids := seedProject(t, s, u)
	answer := "I revised the original message and explained the change."
	id := "revision-valid"
	b, _ := json.Marshal(projectReceipt{Answer: answer, AttemptIDs: ids})
	_ = s.db.change(func(p *Progress) error {
		p.Drafts["project:revision:"+u.ID+":"+id] = Draft{Text: string(b), At: stamp()}
		return nil
	})
	w := call(t, s, "POST", "/api/check", map[string]string{"id": id, "lessonId": lesson, "exerciseId": "revision", "answer": answer, "mode": "writing"})
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	w = call(t, s, "POST", "/api/check", map[string]string{"id": "transfer-too-early", "lessonId": lesson, "exerciseId": "transfer", "answer": "I can apply this in another situation.", "mode": "writing"})
	if w.Code != 400 {
		t.Fatal("early transfer accepted")
	}
	_ = s.db.change(func(p *Progress) error {
		for i := range p.Attempts {
			if p.Attempts[i].ID == id {
				p.Attempts[i].At = time.Now().Add(-8 * 24 * time.Hour).UTC().Format(time.RFC3339)
			}
		}
		return nil
	})
	w = call(t, s, "POST", "/api/check", map[string]string{"id": "transfer-after-pause", "lessonId": lesson, "exerciseId": "transfer", "answer": "I can apply this in another situation.", "mode": "writing"})
	if w.Code != 200 {
		t.Fatal(w.Body.String())
	}
	_ = s.db.change(func(p *Progress) error {
		p.Attempts = append(p.Attempts, Attempt{ID: "new-reading", LessonID: lesson, ExerciseID: "reading", Answer: "This newer source analysis changes my previous answer.", At: stamp()})
		return nil
	})
	w = call(t, s, "POST", "/api/check", map[string]string{"id": "transfer-stale-revision", "lessonId": lesson, "exerciseId": "transfer", "answer": "I can apply this in another situation.", "mode": "writing"})
	if w.Code != 400 {
		t.Fatal("stale revision accepted")
	}
}

func TestProjectsRecordingReceiptRequiresExistingSafeFile(t *testing.T) {
	s := testServer(t)
	c, _ := s.readProjects()
	u := c.Units[0]
	ids := seedProject(t, s, u)
	if len(ids) != 5 {
		t.Fatal("seed")
	}
	a := projectLatest(s.db.snapshot(), u, "speaking")
	if err := s.validateProjectSubmission(a.LessonID, a.ExerciseID, a.ID, a.Answer, "speaking"); err != nil {
		t.Fatal(err)
	}
	if err := s.validateProjectSubmission(a.LessonID, a.ExerciseID, a.ID, "This transcript does not match the saved recording receipt.", "speaking"); err == nil {
		t.Fatal("mismatched transcript accepted")
	}
	if err := s.validateProjectSubmission(a.LessonID, a.ExerciseID, a.ID, a.Answer, "writing"); err == nil {
		t.Fatal("written rehearsal accepted as speech")
	}
	if s.projectAudioValid(projectReceipt{Answer: a.Answer, File: "../settings.json"}, a.Answer) {
		t.Fatal("unsafe path accepted")
	}
	if s.projectAudioValid(projectReceipt{Answer: a.Answer, File: strings.Repeat("b", 64) + ".wav"}, a.Answer) {
		t.Fatal("missing audio accepted")
	}
}

func TestProjectsLatestUsesValidTimestampAndRejectsBackdatedRevision(t *testing.T) {
	s := testServer(t)
	c, _ := s.readProjects()
	u := c.Units[0]
	ids := seedProject(t, s, u)
	p := s.db.snapshot()
	original := *projectLatest(p, u, "reading")
	older := original
	older.ID, older.At = "older-wrong", time.Now().Add(-10*24*time.Hour).UTC().Format(time.RFC3339)
	p.Attempts = append(p.Attempts, older)
	if projectLatest(p, u, "reading").ID != original.ID {
		t.Fatal("array order replaced newer evidence")
	}
	newer := original
	newer.ID, newer.At = "newer-wrong", time.Now().Add(-7*24*time.Hour).UTC().Format(time.RFC3339)
	p.Attempts = append([]Attempt{newer}, p.Attempts...)
	if projectLatest(p, u, "reading").ID != newer.ID {
		t.Fatal("newest chronological evidence ignored")
	}
	for _, bad := range []string{"not-a-date", "2026-02-31T00:00:00Z", time.Now().Add(24 * time.Hour).UTC().Format(time.RFC3339)} {
		fake := original
		fake.ID, fake.At = "invalid-latest", bad
		p.Attempts = append(p.Attempts, fake)
		if projectLatest(p, u, "reading").ID != newer.ID {
			t.Fatal("invalid/future evidence selected", bad)
		}
	}
	answer := "I revised these original answers and explained every change."
	b, _ := json.Marshal(projectReceipt{Answer: answer, AttemptIDs: ids})
	_ = s.db.change(func(p *Progress) error {
		p.Drafts["project:revision:"+u.ID+":backdated"] = Draft{Text: string(b), At: stamp()}
		p.Attempts = append(p.Attempts, Attempt{ID: "backdated", LessonID: "project-" + u.ID, ExerciseID: "revision", Answer: answer, At: time.Now().Add(-11 * 24 * time.Hour).UTC().Format(time.RFC3339)})
		return nil
	})
	if s.projectRevision(s.db.snapshot(), u) != nil {
		t.Fatal("revision before its own source artifacts accepted")
	}
}
