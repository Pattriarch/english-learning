package studio

import (
	"encoding/json"
	"os"
	"path/filepath"
	"strings"
)

// Intake describes planned chapters, not published lessons. Count only exact
// canonical IDs whose availability was independently checked for this request.
// No source paths, source pages, model receipts or learner data are returned.
func (s *Server) bookIntakeStatus(available map[string]map[string]any) map[string]any {
	unknown := func(state string) map[string]any { return map[string]any{"state": state, "complete": false} }
	raw, err := os.ReadFile(filepath.Join(s.content, "new-coursebooks-intake.json"))
	if os.IsNotExist(err) {
		return unknown("missing")
	}
	if err != nil {
		return unknown("unavailable")
	}
	var manifest struct {
		Version int `json:"schemaVersion"`
		Total   int `json:"totalUnits"`
		Books   []struct {
			ID    string `json:"id"`
			Count int    `json:"unitCount"`
			Units []struct {
				ID string `json:"id"`
			} `json:"units"`
		} `json:"books"`
	}
	if json.Unmarshal(raw, &manifest) != nil || manifest.Version != 1 || manifest.Total < 1 || len(manifest.Books) == 0 {
		return unknown("invalid")
	}
	books, units := map[string]bool{}, map[string]bool{}
	for _, book := range manifest.Books {
		if !safeID.MatchString(book.ID) || books[book.ID] || book.Count < 1 || book.Count != len(book.Units) {
			return unknown("invalid")
		}
		books[book.ID] = true
		for _, unit := range book.Units {
			if !safeID.MatchString(unit.ID) || !strings.HasPrefix(unit.ID, book.ID+"-") || units[unit.ID] {
				return unknown("invalid")
			}
			units[unit.ID] = true
		}
	}
	if len(units) != manifest.Total {
		return unknown("invalid")
	}
	ready, cataloged := 0, 0
	for id := range units {
		status, exists := available[id]
		if exists {
			cataloged++
		}
		if status["status"] == "ready" {
			ready++
		}
	}
	return map[string]any{"state": "available", "total": len(units), "ready": ready, "pending": len(units) - ready, "cataloged": cataloged, "books": len(books), "complete": ready == len(units)}
}
