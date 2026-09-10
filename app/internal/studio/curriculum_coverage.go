package studio

import (
	"encoding/json"
	"errors"
	"net/http"
	"path/filepath"
)

// Coverage is editorial metadata. Publication is determined by the actual
// lessons in bootstrap, never by a plan row or the learner's progress.
func (s *Server) curriculumCoverage(w http.ResponseWriter, r *http.Request) {
	planRaw, err := optionalJSON(filepath.Join(s.content, "extended-course-plan.json"))
	if err != nil {
		problem(w, http.StatusInternalServerError, errors.New("Не удалось прочитать план расширения курса"))
		return
	}
	auditRaw, err := optionalJSON(filepath.Join(s.content, "curriculum-gap-audit.json"))
	if err != nil {
		problem(w, http.StatusInternalServerError, errors.New("Не удалось прочитать сверку программы"))
		return
	}
	if len(planRaw) == 0 || len(auditRaw) == 0 {
		problem(w, http.StatusNotFound, errors.New("Сверка программы пока недоступна"))
		return
	}
	var plan struct {
		Version int             `json:"version"`
		Sources json.RawMessage `json:"sources"`
		Modules []struct {
			ID               string   `json:"id"`
			Level            string   `json:"level"`
			Title            string   `json:"title"`
			Skills           []string `json:"skills"`
			Outcomes         []string `json:"outcomes"`
			SourceIDs        []string `json:"sourceIds"`
			RelatedLessonIDs []string `json:"relatedLessonIds"`
			Materials        []struct {
				ID string `json:"id"`
			} `json:"materials"`
			ExercisePlan []json.RawMessage `json:"exercisePlan"`
		} `json:"modules"`
	}
	var audit struct {
		AuditDate   string          `json:"auditDate"`
		Sources     json.RawMessage `json:"sources"`
		Gaps        json.RawMessage `json:"gaps"`
		Supplements json.RawMessage `json:"supplements"`
	}
	if json.Unmarshal(planRaw, &plan) != nil || json.Unmarshal(auditRaw, &audit) != nil || plan.Version < 1 || len(plan.Modules) == 0 {
		problem(w, http.StatusInternalServerError, errors.New("Некорректная структура сверки программы"))
		return
	}
	modules := make([]map[string]any, 0, len(plan.Modules))
	for _, module := range plan.Modules {
		materialIDs := make([]string, 0, len(module.Materials))
		for _, material := range module.Materials {
			materialIDs = append(materialIDs, material.ID)
		}
		modules = append(modules, map[string]any{
			"id": module.ID, "level": module.Level, "title": module.Title,
			"skills": module.Skills, "outcomes": module.Outcomes,
			"sourceIds": module.SourceIDs, "relatedLessonIds": module.RelatedLessonIDs,
			"expectedExerciseCount": len(module.ExercisePlan), "expectedMaterialIds": materialIDs,
		})
	}
	supplements, err := optionalJSON(filepath.Join(s.content, "book-supplements.json"))
	if err != nil {
		problem(w, http.StatusInternalServerError, errors.New("Не удалось прочитать справочники учебников"))
		return
	}
	w.Header().Set("Cache-Control", "no-store")
	sources := plan.Sources
	if len(sources) == 0 || string(sources) == "null" {
		sources = audit.Sources
	}
	jsonResponse(w, http.StatusOK, map[string]any{
		"version": plan.Version, "auditDate": audit.AuditDate,
		"modules": modules, "sources": sources, "gaps": audit.Gaps,
		"supplements": audit.Supplements, "bookSupplements": supplements,
	})
}
