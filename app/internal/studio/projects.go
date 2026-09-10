package studio

import (
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"time"
)

type projectTask struct {
	ID          string   `json:"id"`
	Kind        string   `json:"kind"`
	Prompt      string   `json:"prompt"`
	MaterialIDs []string `json:"materialIds"`
	Model       string   `json:"model"`
	Explanation string   `json:"explanation"`
}
type projectTransfer struct {
	DelayDays   int    `json:"delayDays"`
	Prompt      string `json:"prompt"`
	Model       string `json:"model"`
	Explanation string `json:"explanation"`
}
type projectUnit struct {
	ID               string           `json:"id"`
	Kind             string           `json:"kind"`
	Level            string           `json:"level"`
	Title            string           `json:"title"`
	Why              string           `json:"why"`
	Minutes          int              `json:"minutes"`
	Materials        []LessonMaterial `json:"materials"`
	Rubric           []string         `json:"rubric"`
	Tasks            []projectTask    `json:"tasks"`
	Transfer         projectTransfer  `json:"transfer"`
	ReflectionPrompt string           `json:"reflectionPrompt"`
}
type projectCatalog struct {
	Version  int           `json:"version"`
	Boundary string        `json:"boundary"`
	Units    []projectUnit `json:"units"`
}
type projectReceipt struct {
	Answer     string   `json:"answer"`
	File       string   `json:"file"`
	AttemptIDs []string `json:"attemptIds"`
}

func (s *Server) readProjects() (projectCatalog, error) {
	var c projectCatalog
	b, err := os.ReadFile(filepath.Join(s.content, "projects-checkpoints.json"))
	if err != nil {
		return c, err
	}
	err = json.Unmarshal(b, &c)
	if err == nil && (c.Version != 1 || len(c.Units) != 24) {
		err = errors.New("Неполная программа проектов и проверок")
	}
	return c, err
}
func (s *Server) projects(w http.ResponseWriter, r *http.Request) {
	c, err := s.readProjects()
	if err != nil {
		problem(w, 500, err)
		return
	}
	jsonResponse(w, 200, c)
}
func (s *Server) projectUnit(id string) (projectUnit, bool) {
	c, err := s.readProjects()
	if err == nil {
		for _, u := range c.Units {
			if "project-"+u.ID == id {
				return u, true
			}
		}
	}
	return projectUnit{}, false
}
func projectLatest(p Progress, u projectUnit, id string) *Attempt {
	var latest *Attempt
	var latestAt time.Time
	now := time.Now()
	for i := 0; i < len(p.Attempts); i++ {
		a := p.Attempts[i]
		at, err := time.Parse(time.RFC3339, a.At)
		if a.LessonID == "project-"+u.ID && a.ExerciseID == id && len(strings.Fields(a.Answer)) >= 4 && err == nil && !at.After(now) && (latest == nil || !at.Before(latestAt)) {
			latest, latestAt = &a, at
		}
	}
	return latest
}
func projectGetReceipt(p Progress, kind, id, attempt string) projectReceipt {
	var out projectReceipt
	_ = json.Unmarshal([]byte(p.Drafts["project:"+kind+":"+id+":"+attempt].Text), &out)
	return out
}

var projectAudioName = regexp.MustCompile(`^[a-f0-9]{64}\.(webm|wav|ogg|m4a)$`)

func (s *Server) projectAudioValid(r projectReceipt, answer string) bool {
	if r.Answer != strings.TrimSpace(answer) || !projectAudioName.MatchString(r.File) {
		return false
	}
	f, e := os.Stat(filepath.Join(s.db.dir, "media", r.File))
	return e == nil && !f.IsDir() && f.Size() > 0
}
func (s *Server) projectMainEvidence(p Progress, u projectUnit) ([]string, bool) {
	ids := []string{}
	for _, t := range u.Tasks {
		a := projectLatest(p, u, t.ID)
		if a == nil {
			return nil, false
		}
		if t.Kind == "speaking" && (a.Mode != "speaking" || !s.projectAudioValid(projectGetReceipt(p, "recording", u.ID, a.ID), a.Answer)) {
			return nil, false
		}
		ids = append(ids, a.ID)
	}
	return ids, true
}
func (s *Server) projectRevision(p Progress, u projectUnit) *Attempt {
	ids, ok := s.projectMainEvidence(p, u)
	a := projectLatest(p, u, "revision")
	if !ok || a == nil {
		return nil
	}
	at, _ := time.Parse(time.RFC3339, a.At)
	for _, task := range u.Tasks {
		original := projectLatest(p, u, task.ID)
		originalAt, _ := time.Parse(time.RFC3339, original.At)
		if at.Before(originalAt) {
			return nil
		}
	}
	r := projectGetReceipt(p, "revision", u.ID, a.ID)
	if r.Answer != a.Answer || strings.Join(ids, "|") != strings.Join(r.AttemptIDs, "|") {
		return nil
	}
	return a
}

// Called by /api/check before model invocation. Reopening a route or changing a
// checkbox cannot create artifact evidence or bring a delayed task forward.
func (s *Server) validateProjectSubmission(lesson, exercise, id, answer, mode string) error {
	if !strings.HasPrefix(lesson, "project-") {
		return nil
	}
	u, ok := s.projectUnit(lesson)
	if !ok {
		return errors.New("Проект не найден")
	}
	if len(strings.Fields(answer)) < 4 {
		return errors.New("Нужен содержательный ответ: хотя бы четыре слова")
	}
	p := s.db.snapshot()
	if exercise == "revision" {
		ids, ready := s.projectMainEvidence(p, u)
		r := projectGetReceipt(p, "revision", u.ID, id)
		if !ready || r.Answer != strings.TrimSpace(answer) || strings.Join(ids, "|") != strings.Join(r.AttemptIDs, "|") {
			return errors.New("Сначала сохрани пять ответов и голосовую запись. Доработка должна относиться к текущим ответам")
		}
		return nil
	}
	if exercise == "transfer" {
		a := s.projectRevision(p, u)
		if a == nil {
			return errors.New("Сначала доработай текущую версию проекта")
		}
		at, e := time.Parse(time.RFC3339, a.At)
		if e != nil || time.Now().Before(at.Add(time.Duration(u.Transfer.DelayDays)*24*time.Hour)) {
			return errors.New("Новая ситуация откроется через семь дней после доработки")
		}
		return nil
	}
	for _, t := range u.Tasks {
		if t.ID == exercise {
			if t.Kind == "speaking" && (mode != "speaking" || !s.projectAudioValid(projectGetReceipt(p, "recording", u.ID, id), answer)) {
				return errors.New("Для устного шага сохрани запись и её расшифровку")
			}
			return nil
		}
	}
	return errors.New("Задание проекта не найдено")
}
func (s *Server) projectExercise(lesson, exercise string) (Lesson, Exercise, bool) {
	u, ok := s.projectUnit(lesson)
	if !ok {
		return Lesson{}, Exercise{}, false
	}
	l := Lesson{ID: lesson, Title: u.Title, Level: u.Level, Materials: u.Materials}
	context := "Назначение: " + u.Why + "\nКритерии:\n" + strings.Join(u.Rubric, "\n") + "\nОцени выполнение каждой части и уместность для аудитории. Содержание и достаточность аргументации важнее формального числа слов. Пример не является единственным ответом. Это учебная работа, не экзамен CEFR. В расшифровке оценивается язык, а не акустическая точность произношения."
	for _, t := range u.Tasks {
		if t.ID == exercise {
			return l, Exercise{ID: t.ID, Kind: "write", Prompt: t.Prompt, Context: context, Answers: []string{t.Model}, Explanation: t.Explanation, MaterialIDs: t.MaterialIDs}, true
		}
	}
	if exercise == "revision" {
		p := s.db.snapshot()
		for _, t := range u.Tasks {
			if a := projectLatest(p, u, t.ID); a != nil {
				context += fmt.Sprintf("\n\nТекущий ответ %s:\n%s\nРазбор: %s\n%s", t.ID, a.Answer, a.Feedback.Summary, a.Feedback.Explanation)
			}
		}
		return l, Exercise{ID: exercise, Kind: "write", Prompt: u.ReflectionPrompt, Context: context, Explanation: "Сопоставь исходный текст с доработкой. Назови конкретное изменение и объясни, как оно помогает адресату; затем покажи исправленную формулировку. Не достаточно сообщить, что всё проверено.", MaterialIDs: []string{"reading", "listening"}}, true
	}
	if exercise == "transfer" {
		return l, Exercise{ID: exercise, Kind: "write", Prompt: u.Transfer.Prompt, Context: context, Answers: []string{u.Transfer.Model}, Explanation: u.Transfer.Explanation}, true
	}
	return Lesson{}, Exercise{}, false
}
