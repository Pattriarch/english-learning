package studio

import (
	"encoding/json"
	"net/http"
	"os"
	"path/filepath"
)

func (s *Server) curriculumMastery(w http.ResponseWriter, r *http.Request) {
	b, err := os.ReadFile(filepath.Join(s.content, "curriculum-mastery-map.json"))
	if err != nil {
		problem(w, 500, err)
		return
	}
	var value map[string]any
	if err = json.Unmarshal(b, &value); err != nil {
		problem(w, 500, err)
		return
	}
	var refs struct {
		Levels []struct {
			Indicators []struct {
				Evidence []struct {
					UnitID string `json:"unitId"`
				} `json:"evidence"`
			} `json:"indicators"`
		} `json:"levels"`
	}
	if err = json.Unmarshal(b, &refs); err != nil {
		problem(w, 500, err)
		return
	}
	versions := map[string][]string{}
	for _, level := range refs.Levels {
		for _, indicator := range level.Indicators {
			for _, e := range indicator.Evidence {
				if e.UnitID == "" {
					continue
				}
				if _, ok := versions[e.UnitID]; ok {
					continue
				}
				versions[e.UnitID] = []string{}
				if lesson, err := s.loadBookLesson(e.UnitID); err == nil {
					for _, exercise := range lesson.Exercises {
						versions[e.UnitID] = append(versions[e.UnitID], exercise.ID+"--"+bookExerciseVersion(exercise))
					}
				}
			}
		}
	}
	value["currentBookExercises"] = versions
	jsonResponse(w, 200, value)
}
