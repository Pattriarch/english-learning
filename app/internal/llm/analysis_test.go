package llm

import "testing"

const sample = `{
  "corrected": "I have lived in Chicago since 2019.",
  "errors": [{"quote": "I live here since 2019", "fix": "I have lived here since 2019", "explain_ru": "since тянет present perfect", "topic_id": "egiu-007"}],
  "upgrades": [{"quote": "It is very good", "better": "It's solid", "why_ru": "живее"}],
  "russian_inserts": [{"ru": "по-любому", "en": "for sure", "alt": "bet"}],
  "slang_bonus": {"phrase": "no cap", "meaning_ru": "без преувеличений", "example": "That test was brutal, no cap."},
  "cards": [{"front": "по-любому", "back": "for sure", "note": "разг.", "topic_id": ""}],
  "topics_ok": ["egiu-013"]
}`

func check(t *testing.T, a *Analysis) {
	t.Helper()
	if a.Corrected != "I have lived in Chicago since 2019." {
		t.Errorf("corrected = %q", a.Corrected)
	}
	if len(a.Errors) != 1 || a.Errors[0].TopicID != "egiu-007" {
		t.Errorf("errors = %+v", a.Errors)
	}
	if len(a.Upgrades) != 1 || a.Upgrades[0].Better != "It's solid" {
		t.Errorf("upgrades = %+v", a.Upgrades)
	}
	if len(a.RussianInserts) != 1 || a.RussianInserts[0].Alt != "bet" {
		t.Errorf("russian_inserts = %+v", a.RussianInserts)
	}
	if a.SlangBonus == nil || a.SlangBonus.Phrase != "no cap" {
		t.Errorf("slang_bonus = %+v", a.SlangBonus)
	}
	if len(a.Cards) != 1 || a.Cards[0].Back != "for sure" {
		t.Errorf("cards = %+v", a.Cards)
	}
	if len(a.TopicsOK) != 1 || a.TopicsOK[0] != "egiu-013" {
		t.Errorf("topics_ok = %+v", a.TopicsOK)
	}
}

func TestParseAnalysisPlain(t *testing.T) {
	a, err := ParseAnalysis(sample)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	check(t, a)
}

func TestParseAnalysisJSONFence(t *testing.T) {
	a, err := ParseAnalysis("```json\n" + sample + "\n```")
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	check(t, a)
}

func TestParseAnalysisBareFence(t *testing.T) {
	a, err := ParseAnalysis("```\n" + sample + "\n```\n")
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	check(t, a)
}

func TestParseAnalysisWithChatter(t *testing.T) {
	a, err := ParseAnalysis("Sure, here is the breakdown:\n" + sample + "\nLet me know if you want more.")
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	check(t, a)
}

func TestParseAnalysisNullSlang(t *testing.T) {
	a, err := ParseAnalysis(`{"corrected":"ok","slang_bonus":null,"errors":[]}`)
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if a.SlangBonus != nil {
		t.Fatalf("slang_bonus = %+v, want nil", a.SlangBonus)
	}
}

func TestParseAnalysisErrors(t *testing.T) {
	for _, in := range []string{"", "   ", "not json at all", "```json\nnope\n```"} {
		if _, err := ParseAnalysis(in); err == nil {
			t.Errorf("ParseAnalysis(%q): want error", in)
		}
	}
}
