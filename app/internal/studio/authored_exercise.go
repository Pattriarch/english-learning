package studio

import (
	"strconv"
	"strings"
)

// Authors must bump Revision for every material change to a published prompt,
// attached material, reference answer, explanation, or assessment. Original IDs
// stay stable in content; an unmodified exercise retains its historical identity.
func authoredExerciseID(e Exercise) string {
	if e.Revision > 0 {
		return e.ID + "--revision-" + strconv.Itoa(e.Revision)
	}
	return e.ID
}

func (s *Server) outdatedAuthoredExercise(lessonID, practiceID string) bool {
	for _, lesson := range s.allLessons() {
		if lesson.ID != lessonID {
			continue
		}
		for _, exercise := range lesson.Exercises {
			if (practiceID == exercise.ID || strings.HasPrefix(practiceID, exercise.ID+"--revision-")) && practiceID != authoredExerciseID(exercise) {
				return true
			}
		}
	}
	return false
}
