package studio

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func intakeFixture(ids ...string) map[string]any {
	units := []map[string]string{}
	for _, id := range ids {
		units = append(units, map[string]string{"id": id})
	}
	return map[string]any{"schemaVersion": 1, "totalUnits": len(ids), "sourceDirectory": "/private/source", "books": []map[string]any{{"id": "book-c2", "unitCount": len(ids), "units": units}}}
}

func TestBookIntakeCountsOnlyReadyCanonicalIntersections(t *testing.T) {
	s, id, _ := readyBookFixture(t)
	path := filepath.Join(s.content, "new-coursebooks-intake.json")
	writeFixture(t, path, intakeFixture(id, "book-c2-002"))
	status := s.bookBuildStatus()
	intake := status["intake"].(map[string]any)
	if status["total"] != 1 || status["ready"] != 1 || intake["total"] != 2 || intake["ready"] != 1 || intake["pending"] != 1 || intake["cataloged"] != 1 || intake["complete"] != false {
		t.Fatal("intake changed the published count or counted a missing chapter", status)
	}
	available := map[string]map[string]any{id: {"status": "ready"}, "book-c2-002": {"status": "ready"}, "unrelated-001": {"status": "ready"}}
	complete := s.bookIntakeStatus(available)
	if complete["ready"] != 2 || complete["cataloged"] != 2 || complete["pending"] != 0 || complete["complete"] != true {
		t.Fatal("completed publication not reflected", complete)
	}
	// Read each current manifest; an older count is not cached across changes.
	writeFixture(t, path, intakeFixture("book-c2-002"))
	if current := s.bookIntakeStatus(available); current["total"] != 1 || current["ready"] != 1 {
		t.Fatal("stale intake counts", current)
	}
	available["book-c2-002"]["status"] = "pending"
	if current := s.bookIntakeStatus(available); current["ready"] != 0 || current["pending"] != 1 || current["complete"] != false {
		t.Fatal("catalog presence became readiness", current)
	}
}

func TestBookIntakeMissingAndInvalidNeverAnnounceCompletion(t *testing.T) {
	s, _, _ := readyBookFixture(t)
	path := filepath.Join(s.content, "new-coursebooks-intake.json")
	if got := s.bookIntakeStatus(nil); got["state"] != "missing" || got["complete"] != false || got["ready"] != nil {
		t.Fatal("missing manifest became zero-of-zero completion", got)
	}
	for name, manifest := range map[string]any{
		"bad-json":        "not a manifest",
		"empty":           map[string]any{"schemaVersion": 1, "totalUnits": 0, "books": []any{}},
		"duplicate-units": intakeFixture("book-c2-001", "book-c2-001"),
		"unsafe-unit":     intakeFixture("../private"),
		"wrong-book":      intakeFixture("another-001"),
	} {
		t.Run(name, func(t *testing.T) {
			writeFixture(t, path, manifest)
			if got := s.bookIntakeStatus(nil); got["state"] != "invalid" || got["complete"] != false || got["total"] != nil {
				t.Fatal(got)
			}
		})
	}
	for _, field := range []string{"schemaVersion", "totalUnits"} {
		manifest := intakeFixture("book-c2-001")
		manifest[field] = 99
		writeFixture(t, path, manifest)
		if got := s.bookIntakeStatus(nil); got["state"] != "invalid" {
			t.Fatal("unvalidated declared count/schema", got)
		}
	}
}

func TestLibraryStatusExposesOnlyIntakeCountsAndRechecksLostLesson(t *testing.T) {
	s, id, _ := readyBookFixture(t)
	writeFixture(t, filepath.Join(s.content, "new-coursebooks-intake.json"), intakeFixture(id))
	for _, endpoint := range []string{"/api/library/status", "/book-content/status.json"} {
		response := call(t, s, "GET", endpoint, nil)
		if response.Code != http.StatusOK || strings.Contains(response.Body.String(), "/private/source") {
			t.Fatal(response.Body.String())
		}
		var status struct {
			Intake struct {
				Ready    int
				Complete bool
			}
		}
		if err := json.Unmarshal(response.Body.Bytes(), &status); err != nil || status.Intake.Ready != 1 || !status.Intake.Complete {
			t.Fatal("missing validated intake status", response.Body.String(), err)
		}
	}
	if err := os.Remove(filepath.Join(s.content, "book-lessons", id+".json")); err != nil {
		t.Fatal(err)
	}
	intake := s.bookBuildStatus()["intake"].(map[string]any)
	if intake["ready"] != 0 || intake["pending"] != 1 || intake["complete"] != false {
		t.Fatal("deleted lesson still counted ready", intake)
	}
}
