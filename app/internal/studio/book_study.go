package studio

import (
	"encoding/json"
	"errors"
	"regexp"
	"slices"
	"strings"
	"time"
)

var bookAnswerWords = regexp.MustCompile(`[\p{L}\p{N}]+(?:['’][\p{L}\p{N}]+)*`)

type bookStudyEvidence struct {
	Exercise Exercise `json:"exercise"`
	Attempt  Attempt  `json:"attempt"`
}

type bookStudyInput struct {
	Stage        string              `json:"stage"`
	OriginalWork []bookStudyEvidence `json:"originalWork"`
	Revisions    []bookStudyEvidence `json:"revisions,omitempty"`
}

func currentBookExerciseID(l Lesson, e Exercise) string {
	return e.ID + "--" + bookExerciseVersionWithMaterials(e, l.Materials)
}

// The latest response wins even if it is empty, incorrect or in the wrong mode.
// Falling back to an earlier success would conceal the learner's current work.
func latestBookStudyAttempt(l Lesson, e Exercise, p Progress, now time.Time) (Attempt, time.Time, bool) {
	id := currentBookExerciseID(l, e)
	var latest Attempt
	var latestAt time.Time
	found := false
	for _, a := range p.Attempts {
		if !(a.LessonID == l.ID && a.ExerciseID == id) &&
			!(a.LessonID == "free" && a.ExerciseID == l.ID+"-"+id) {
			continue
		}
		at, err := time.Parse(time.RFC3339Nano, a.At)
		if err != nil || at.After(now) || (found && at.Before(latestAt)) {
			continue
		}
		latest, latestAt, found = a, at, true
	}
	valid := found && len(bookAnswerWords.FindAllString(latest.Answer, -1)) >= 3 &&
		(e.Kind != "speak" || latest.Mode == "speaking")
	return latest, latestAt, valid
}

func reviewedBookAttempt(a Attempt) bool {
	return a.Feedback.Verdict == "correct" &&
		slices.Contains([]string{"codex", "claude", "ollama", "compatible"}, a.Feedback.Source)
}

// Uses server time and saved, current-version responses. Client checkboxes,
// reference comparisons, old materials and a prematurely submitted transfer
// cannot satisfy a delayed application task.
func bookStudyDependencies(l Lesson, e Exercise, p Progress, now time.Time) (*bookStudyInput, error) {
	if l.StudyPlan == nil || !strings.HasPrefix(l.ID, "book-") {
		return nil, nil
	}
	if err := validateLessonStudyPlan(l); err != nil {
		return nil, err
	}
	id := e.ID
	if split := strings.LastIndex(id, "--"); split >= 0 {
		id = id[:split]
	}
	phase := ""
	if slices.Contains(l.StudyPlan.RevisionExerciseIDs, id) {
		phase = "revision"
	} else if slices.Contains(l.StudyPlan.Transfer.ExerciseIDs, id) {
		phase = "transfer"
	} else {
		return nil, nil
	}
	byID := make(map[string]Exercise, len(l.Exercises))
	for _, exercise := range l.Exercises {
		byID[exercise.ID] = exercise
	}
	input := &bookStudyInput{Stage: phase}
	var producedAt time.Time
	for _, key := range l.StudyPlan.Stages[3].ExerciseIDs {
		exercise := byID[key]
		a, at, valid := latestBookStudyAttempt(l, exercise, p, now)
		if !valid {
			return nil, errors.New("Сначала сохраните собственные письменный и устный ответы на этапе самостоятельной работы")
		}
		input.OriginalWork = append(input.OriginalWork, bookStudyEvidence{Exercise: exercise, Attempt: a})
		if at.After(producedAt) {
			producedAt = at
		}
	}
	if phase == "revision" {
		return input, nil
	}
	var revisedAt time.Time
	for _, key := range l.StudyPlan.RevisionExerciseIDs {
		exercise := byID[key]
		a, at, valid := latestBookStudyAttempt(l, exercise, p, now)
		if !valid || !reviewedBookAttempt(a) || !at.After(producedAt) {
			return nil, errors.New("Сначала исправьте собственные ответы и получите проверку всех заданий этапа переработки")
		}
		input.Revisions = append(input.Revisions, bookStudyEvidence{Exercise: exercise, Attempt: a})
		if at.After(revisedAt) {
			revisedAt = at
		}
	}
	due := revisedAt.Add(time.Duration(l.StudyPlan.Transfer.DelayDays) * 24 * time.Hour)
	if now.Before(due) {
		return nil, errors.New("Отложенное применение откроется " + due.Local().Format("02.01.2006 15:04") + ". Вернитесь к нему без подсказок, чтобы проверить сохранение навыка")
	}
	return input, nil
}

func sameBookStudyInput(a, b *bookStudyInput) bool {
	x, _ := json.Marshal(a)
	y, _ := json.Marshal(b)
	return string(x) == string(y)
}
