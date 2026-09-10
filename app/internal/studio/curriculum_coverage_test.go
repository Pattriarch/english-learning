package studio

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestCurriculumCoverageProjectsMetadataWithoutAuthoringBriefs(t *testing.T) {
	dir := t.TempDir()
	files := map[string]string{
		"extended-course-plan.json": `{"version":1,"sources":[{"id":"added-source","url":"https://example.org/current"}],"modules":[{"id":"extended-a1","title":"An exchange","level":"A1","skills":["interaction"],"materials":[{"id":"m1","brief":"PRIVATE AUTHORING DETAIL"}],"exercisePlan":[{"kind":"write","brief":"PRIVATE AUTHORING DETAIL"}],"relatedLessonIds":["path-be"]}]}`,
		"curriculum-gap-audit.json": `{"auditDate":"2026-09-10","sources":[{"id":"legacy-snapshot"}],"gaps":[],"supplements":{"groups":[]}}`,
		"book-supplements.json":     `{"entryCount":1,"books":[]}`,
	}
	for name, body := range files {
		if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
	}
	s := &Server{content: dir}
	recorder := httptest.NewRecorder()
	s.curriculumCoverage(recorder, httptest.NewRequest(http.MethodGet, "/api/curriculum/coverage", nil))
	if recorder.Code != http.StatusOK {
		t.Fatalf("status %d: %s", recorder.Code, recorder.Body.String())
	}
	if recorder.Header().Get("Cache-Control") != "no-store" {
		t.Fatal("metadata must not be cached as publication status")
	}
	if strings.Contains(recorder.Body.String(), "PRIVATE AUTHORING DETAIL") {
		t.Fatal("authoring briefs should not be exposed in the UI payload")
	}
	if !strings.Contains(recorder.Body.String(), "added-source") || strings.Contains(recorder.Body.String(), "legacy-snapshot") {
		t.Fatal("new course sources must remain available after the audit snapshot")
	}
	var value struct {
		Modules []struct {
			ID    string   `json:"id"`
			Count int      `json:"expectedExerciseCount"`
			IDs   []string `json:"expectedMaterialIds"`
		} `json:"modules"`
		Supplements json.RawMessage `json:"bookSupplements"`
	}
	if err := json.Unmarshal(recorder.Body.Bytes(), &value); err != nil {
		t.Fatal(err)
	}
	if len(value.Modules) != 1 || value.Modules[0].Count != 1 || len(value.Modules[0].IDs) != 1 || value.Modules[0].IDs[0] != "m1" {
		t.Fatalf("incorrect projection: %+v", value.Modules)
	}
	if !strings.Contains(string(value.Supplements), `"entryCount":1`) {
		t.Fatal("book appendix index missing")
	}
}

func TestCurriculumCoverageMissingOrMalformedMetadata(t *testing.T) {
	dir := t.TempDir()
	s := &Server{content: dir}
	for _, status := range []int{http.StatusNotFound, http.StatusInternalServerError} {
		if status == http.StatusInternalServerError {
			if err := os.WriteFile(filepath.Join(dir, "extended-course-plan.json"), []byte("{"), 0600); err != nil {
				t.Fatal(err)
			}
		}
		recorder := httptest.NewRecorder()
		s.curriculumCoverage(recorder, httptest.NewRequest(http.MethodGet, "/api/curriculum/coverage", nil))
		if recorder.Code != status {
			t.Fatalf("want %d got %d", status, recorder.Code)
		}
		if strings.Contains(recorder.Body.String(), dir) {
			t.Fatal("error disclosed filesystem path")
		}
	}
}
