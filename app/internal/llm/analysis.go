package llm

import (
	"encoding/json"
	"fmt"
	"strings"
)

type Error struct {
	Quote     string `json:"quote"`
	Fix       string `json:"fix"`
	ExplainRU string `json:"explain_ru"`
	TopicID   string `json:"topic_id"`
}

type Upgrade struct {
	Quote  string `json:"quote"`
	Better string `json:"better"`
	WhyRU  string `json:"why_ru"`
}

type RussianInsert struct {
	RU  string `json:"ru"`
	EN  string `json:"en"`
	Alt string `json:"alt"`
}

type SlangBonus struct {
	Phrase    string `json:"phrase"`
	MeaningRU string `json:"meaning_ru"`
	Example   string `json:"example"`
}

type Card struct {
	Front   string `json:"front"`
	Back    string `json:"back"`
	Note    string `json:"note"`
	TopicID string `json:"topic_id"`
}

type Analysis struct {
	Corrected      string          `json:"corrected"`
	Errors         []Error         `json:"errors"`
	Upgrades       []Upgrade       `json:"upgrades"`
	RussianInserts []RussianInsert `json:"russian_inserts"`
	SlangBonus     *SlangBonus     `json:"slang_bonus"`
	Cards          []Card          `json:"cards"`
	// TopicsOK lists topics the letter used correctly; it feeds the letter_ok
	// side of the usage progress.
	TopicsOK []string `json:"topics_ok"`
}

// ParseAnalysis decodes the model reply, tolerating markdown fences and
// leading/trailing chatter around the JSON object.
func ParseAnalysis(raw string) (*Analysis, error) {
	s := stripFence(strings.TrimSpace(raw))
	if s == "" {
		return nil, fmt.Errorf("empty response")
	}
	var a Analysis
	if err := json.Unmarshal([]byte(s), &a); err == nil {
		return &a, nil
	}
	trimmed := betweenBraces(s)
	if trimmed == "" {
		return nil, fmt.Errorf("no JSON object in response")
	}
	if err := json.Unmarshal([]byte(trimmed), &a); err != nil {
		return nil, fmt.Errorf("decode analysis: %w", err)
	}
	return &a, nil
}

func stripFence(s string) string {
	if !strings.HasPrefix(s, "```") {
		return s
	}
	s = strings.TrimPrefix(s, "```")
	if i := strings.IndexByte(s, '\n'); i >= 0 {
		// drop the language tag line ("json", "JSON", or nothing)
		if tag := strings.TrimSpace(s[:i]); tag == "" || !strings.ContainsAny(tag, "{[\"") {
			s = s[i+1:]
		}
	}
	if i := strings.LastIndex(s, "```"); i >= 0 {
		s = s[:i]
	}
	return strings.TrimSpace(s)
}

func betweenBraces(s string) string {
	start := strings.IndexByte(s, '{')
	end := strings.LastIndexByte(s, '}')
	if start < 0 || end <= start {
		return ""
	}
	return s[start : end+1]
}
