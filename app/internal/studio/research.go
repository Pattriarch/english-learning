package studio

import (
	"encoding/json"
	"fmt"
	"strings"
)

type researchTopic struct {
	ID              string   `json:"id"`
	Title           string   `json:"title"`
	Level           string   `json:"level"`
	Skill           string   `json:"skill"`
	Why             string   `json:"why"`
	PracticePrompt  string   `json:"practicePrompt"`
	SuccessCriteria []string `json:"successCriteria"`
}

func (s *Server) loadResearch() error {
	s.researchTopics = map[string]researchTopic{}
	if len(s.research) == 0 {
		return nil
	}
	var catalog struct {
		Topics []researchTopic `json:"topics"`
	}
	if err := json.Unmarshal(s.research, &catalog); err != nil {
		return fmt.Errorf("research-topics.json: %w", err)
	}
	for _, t := range catalog.Topics {
		level, valid := practiceLevel(t.Level)
		_, duplicate := s.researchTopics[t.ID]
		if !safeID.MatchString(t.ID) || duplicate || !valid || level != t.Level || strings.TrimSpace(t.Title) == "" || strings.TrimSpace(t.PracticePrompt) == "" || len(t.SuccessCriteria) == 0 {
			return fmt.Errorf("research-topics.json: incomplete or duplicate topic %q", t.ID)
		}
		s.researchTopics[t.ID] = t
	}
	return nil
}

func (s *Server) researchExercise(id string) (Lesson, Exercise, bool) {
	t, ok := s.researchTopics[id]
	if !ok {
		return Lesson{}, Exercise{}, false
	}
	criteria := strings.Join(t.SuccessCriteria, "\n")
	return Lesson{ID: "research", Title: t.Title, Level: t.Level}, Exercise{
		ID: t.ID, Kind: "write", Prompt: t.PracticePrompt,
		Context:     "Purpose: " + t.Why + "\nSuccess criteria:\n" + criteria + "\nJudge only evidence present in the submitted answer. A transcript cannot demonstrate pronunciation, listening accuracy or live interaction. Do not claim to have assessed audio, unseen source material or CEFR certification.",
		Explanation: "Проверь результат по критериям:\n" + criteria + "\nЗатем перепиши ответ с учётом замечаний. Устные навыки дополнительно проверяй по записи и в живом разговоре.",
	}, true
}
