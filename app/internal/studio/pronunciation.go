package studio

import (
	"encoding/json"
	"fmt"
	"strings"
)

type pronunciationPractice struct {
	Prompt    string   `json:"prompt"`
	Reference string   `json:"reference"`
	Criteria  []string `json:"criteria"`
}

type pronunciationLesson struct {
	ID       string                `json:"id"`
	Title    string                `json:"title"`
	Level    string                `json:"level"`
	Goal     string                `json:"goal"`
	Practice pronunciationPractice `json:"practice"`
}

const pronunciationAssessmentNote = "Проверен только текст ответа и описание вашей практики. Произношение, отдельные звуки, ударение и интонация по тексту не оценивались."

const pronunciationTutorBoundary = `This is a pronunciation learning journal, but the only submitted evidence is TEXT (typed reflection or a speech transcript). Evaluate the written reflection, understanding of phonetic notation and task completion only. NEVER evaluate or score actual pronunciation, articulation, sound accuracy, rhythm, intonation or accent. A transcript and a self-report do not prove any acoustic performance. Do not interpret a matching transcript as evidence of correct pronunciation. Acknowledge user-reported observations as self-reports, not verified facts. Explain phonetic concepts when relevant and suggest a concrete listening/recording comparison. The verdict describes the text/reflection only.`

func (s *Server) loadPronunciation() error {
	s.pronunciationLessons = map[string]pronunciationLesson{}
	if len(s.pronunciation) == 0 {
		return nil
	}
	var catalog struct {
		Lessons []pronunciationLesson `json:"lessons"`
	}
	if err := json.Unmarshal(s.pronunciation, &catalog); err != nil {
		return fmt.Errorf("pronunciation.json: %w", err)
	}
	if len(catalog.Lessons) == 0 {
		return fmt.Errorf("pronunciation.json: no lessons")
	}
	for _, lesson := range catalog.Lessons {
		level, valid := practiceLevel(lesson.Level)
		_, duplicate := s.pronunciationLessons[lesson.ID]
		practice := lesson.Practice
		if !safeID.MatchString(lesson.ID) || duplicate || !valid || level != lesson.Level || strings.TrimSpace(lesson.Title) == "" || strings.TrimSpace(practice.Prompt) == "" || strings.TrimSpace(practice.Reference) == "" || len(practice.Criteria) == 0 {
			return fmt.Errorf("pronunciation.json: incomplete or duplicate lesson %q", lesson.ID)
		}
		for _, criterion := range practice.Criteria {
			if strings.TrimSpace(criterion) == "" {
				return fmt.Errorf("pronunciation.json: empty criterion in lesson %q", lesson.ID)
			}
		}
		s.pronunciationLessons[lesson.ID] = lesson
	}
	return nil
}

func (s *Server) pronunciationExercise(id string) (Lesson, Exercise, bool) {
	l, ok := s.pronunciationLessons[id]
	if !ok {
		return Lesson{}, Exercise{}, false
	}
	criteria := strings.Join(l.Practice.Criteria, "\n")
	return Lesson{ID: "pronunciation", Title: l.Title, Level: l.Level}, Exercise{
		ID: l.ID, Kind: "write", Prompt: l.Practice.Prompt,
		Answers:     []string{l.Practice.Reference},
		Context:     "Learning goal: " + l.Goal + "\nReflection criteria:\n" + criteria + "\n" + pronunciationTutorBoundary,
		Explanation: "Сравните свою заметку с примером и критериями:\n" + criteria + "\n\n" + pronunciationAssessmentNote,
	}, true
}
