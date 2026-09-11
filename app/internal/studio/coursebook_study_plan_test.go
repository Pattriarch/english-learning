package studio

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"
)

func coursebookStudyPlanFixture() Lesson {
	lesson := contentLesson("extended-study-plan")
	lesson.Exercises = nil
	for i, kind := range []string{"translate", "write", "rewrite", "write", "speak", "rewrite", "write", "write", "speak"} {
		lesson.Exercises = append(lesson.Exercises, Exercise{
			ID: fmt.Sprintf("e%d", i+1), Kind: kind, Prompt: "Complete the task.",
			Answers: []string{"An example answer."}, Explanation: "Preserve the intended meaning.",
		})
	}
	lesson.StudyPlan = &LessonStudyPlan{
		Stages: []LessonStudyStage{
			{ID: "diagnostic", Title: "Diagnostic", Purpose: "Find the starting point.", ExerciseIDs: []string{"e1"}, Minutes: 5},
			{ID: "input", Title: "Input", Purpose: "Examine a model.", ExerciseIDs: []string{"e2"}, Minutes: 10},
			{ID: "practice", Title: "Practice", Purpose: "Practice with support.", ExerciseIDs: []string{"e3"}, Minutes: 15},
			{ID: "production", Title: "Production", Purpose: "Write and speak independently.", ExerciseIDs: []string{"e4", "e5"}, Minutes: 30},
			{ID: "revision", Title: "Revision", Purpose: "Improve the first attempt.", ExerciseIDs: []string{"e6", "e7"}, Minutes: 20},
			{ID: "transfer", Title: "Transfer", Purpose: "Apply the skill in a new context.", ExerciseIDs: []string{"e8", "e9"}, Minutes: 20},
		},
		RevisionExerciseIDs: []string{"e6", "e7"},
		Transfer:            LessonTransferPlan{ExerciseIDs: []string{"e8", "e9"}, DelayDays: 14},
	}
	return lesson
}

func TestCoursebookStudyPlanJSONRoundTripAndLegacyOmission(t *testing.T) {
	lesson := coursebookStudyPlanFixture()
	if err := validateLesson(lesson); err != nil {
		t.Fatal(err)
	}
	raw, err := json.Marshal(lesson)
	if err != nil {
		t.Fatal(err)
	}
	for _, field := range []string{`"studyPlan":`, `"stages":`, `"exerciseIds":`, `"revisionExerciseIds":`, `"transfer":`, `"delayDays":`} {
		if !strings.Contains(string(raw), field) {
			t.Fatalf("missing JSON field %s", field)
		}
	}
	var restored Lesson
	if err := json.Unmarshal(raw, &restored); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(lesson, restored) {
		t.Fatal("lesson study plan changed during JSON round trip")
	}
	if err := validateLesson(restored); err != nil {
		t.Fatal(err)
	}
	legacy := contentLesson("legacy-without-plan")
	if err := validateLesson(legacy); err != nil {
		t.Fatal("legacy lesson rejected:", err)
	}
	raw, err = json.Marshal(legacy)
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(string(raw), `"studyPlan"`) {
		t.Fatal("absent study plan was not omitted")
	}
}

func TestCoursebookStudyPlanRejectsInvalidSemantics(t *testing.T) {
	cases := map[string]func(*Lesson){
		"missing stage":   func(l *Lesson) { l.StudyPlan.Stages = l.StudyPlan.Stages[:5] },
		"extra stage":     func(l *Lesson) { l.StudyPlan.Stages = append(l.StudyPlan.Stages, l.StudyPlan.Stages[0]) },
		"unknown stage":   func(l *Lesson) { l.StudyPlan.Stages[0].ID = "warmup" },
		"duplicate stage": func(l *Lesson) { l.StudyPlan.Stages[0].ID = "input" },
		"stage order": func(l *Lesson) {
			l.StudyPlan.Stages[0], l.StudyPlan.Stages[1] = l.StudyPlan.Stages[1], l.StudyPlan.Stages[0]
		},
		"blank title":   func(l *Lesson) { l.StudyPlan.Stages[0].Title = " \t" },
		"blank purpose": func(l *Lesson) { l.StudyPlan.Stages[0].Purpose = " \n" },
		"zero minutes":  func(l *Lesson) { l.StudyPlan.Stages[0].Minutes = 0 },
		"excess minutes": func(l *Lesson) {
			l.StudyPlan.Stages[0].Minutes = 181
		},
		"empty stage": func(l *Lesson) { l.StudyPlan.Stages[0].ExerciseIDs = nil },
		"oversized stage": func(l *Lesson) {
			l.StudyPlan.Stages[0].ExerciseIDs = make([]string, 31)
		},
		"unknown exercise": func(l *Lesson) { l.StudyPlan.Stages[0].ExerciseIDs[0] = "missing" },
		"duplicate within stage": func(l *Lesson) {
			l.StudyPlan.Stages[0].ExerciseIDs = []string{"e1", "e1"}
		},
		"duplicate across stages": func(l *Lesson) { l.StudyPlan.Stages[1].ExerciseIDs[0] = "e1" },
		"unassigned exercise": func(l *Lesson) {
			l.Exercises = append(l.Exercises, Exercise{ID: "unassigned", Kind: "write", Prompt: "Write.", Explanation: "Explain."})
		},
		"production lacks writing":  func(l *Lesson) { l.Exercises[3].Kind = "rewrite" },
		"production lacks speaking": func(l *Lesson) { l.Exercises[4].Kind = "write" },
		"revision includes speaking": func(l *Lesson) {
			l.Exercises[5].Kind = "speak"
		},
		"revision includes translation": func(l *Lesson) { l.Exercises[6].Kind = "translate" },
		"revision mapping differs": func(l *Lesson) {
			l.StudyPlan.RevisionExerciseIDs = []string{"e4", "e7"}
		},
		"revision mapping empty": func(l *Lesson) { l.StudyPlan.RevisionExerciseIDs = nil },
		"revision mapping order": func(l *Lesson) {
			l.StudyPlan.RevisionExerciseIDs = []string{"e7", "e6"}
		},
		"revision mapping duplicate": func(l *Lesson) {
			l.StudyPlan.RevisionExerciseIDs = []string{"e6", "e6"}
		},
		"transfer includes rewriting": func(l *Lesson) { l.Exercises[7].Kind = "rewrite" },
		"transfer includes translation": func(l *Lesson) {
			l.Exercises[8].Kind = "translate"
		},
		"transfer mapping differs": func(l *Lesson) {
			l.StudyPlan.Transfer.ExerciseIDs = []string{"e4", "e9"}
		},
		"transfer mapping empty": func(l *Lesson) { l.StudyPlan.Transfer.ExerciseIDs = nil },
		"transfer mapping order": func(l *Lesson) {
			l.StudyPlan.Transfer.ExerciseIDs = []string{"e9", "e8"}
		},
		"transfer mapping duplicate": func(l *Lesson) {
			l.StudyPlan.Transfer.ExerciseIDs = []string{"e8", "e8"}
		},
		"transfer too soon": func(l *Lesson) { l.StudyPlan.Transfer.DelayDays = 6 },
		"transfer too late": func(l *Lesson) { l.StudyPlan.Transfer.DelayDays = 61 },
	}
	for name, mutate := range cases {
		t.Run(name, func(t *testing.T) {
			lesson := coursebookStudyPlanFixture()
			mutate(&lesson)
			if err := validateLesson(lesson); err == nil {
				t.Fatal("invalid study plan accepted")
			}
		})
	}
}

func TestCoursebookStudyPlanAcceptsTimingBoundariesAndSingleTransfer(t *testing.T) {
	for _, minutes := range []int{1, 180} {
		for _, days := range []int{7, 60} {
			for _, kind := range []string{"write", "speak"} {
				t.Run(fmt.Sprintf("minutes-%d-days-%d-%s", minutes, days, kind), func(t *testing.T) {
					lesson := coursebookStudyPlanFixture()
					lesson.StudyPlan.Stages[0].Minutes = minutes
					lesson.StudyPlan.Transfer.DelayDays = days
					lesson.Exercises = lesson.Exercises[:8]
					lesson.Exercises[7].Kind = kind
					lesson.StudyPlan.Stages[5].ExerciseIDs = []string{"e8"}
					lesson.StudyPlan.Transfer.ExerciseIDs = []string{"e8"}
					if err := validateLesson(lesson); err != nil {
						t.Fatal(err)
					}
				})
			}
		}
	}
}

func TestCoursebookLessonExerciseLimit(t *testing.T) {
	for _, withPlan := range []bool{false, true} {
		for _, count := range []int{30, 31} {
			t.Run(fmt.Sprintf("plan-%t-count-%d", withPlan, count), func(t *testing.T) {
				lesson := coursebookStudyPlanFixture()
				for len(lesson.Exercises) < count {
					id := fmt.Sprintf("e%d", len(lesson.Exercises)+1)
					lesson.Exercises = append(lesson.Exercises, Exercise{ID: id, Kind: "write", Prompt: "Write.", Explanation: "Explain."})
					lesson.StudyPlan.Stages[2].ExerciseIDs = append(lesson.StudyPlan.Stages[2].ExerciseIDs, id)
				}
				if !withPlan {
					lesson.StudyPlan = nil
				}
				err := validateLesson(lesson)
				if (err == nil) != (count == 30) {
					t.Fatalf("%d exercises: %v", count, err)
				}
			})
		}
	}
}

func TestCoursebookStudyPlanCopyIsolation(t *testing.T) {
	lesson := coursebookStudyPlanFixture()
	want := coursebookStudyPlanFixture()
	copied := copyExtendedLessons([]Lesson{lesson})
	if !reflect.DeepEqual(copied[0].StudyPlan, lesson.StudyPlan) {
		t.Fatal("study plan changed during copy")
	}
	plan := copied[0].StudyPlan
	plan.Transfer.DelayDays = 7
	plan.RevisionExerciseIDs[0] = "changed-revision"
	plan.Transfer.ExerciseIDs[0] = "changed-transfer"
	for i := range plan.Stages {
		plan.Stages[i].Title = "Changed title"
		plan.Stages[i].ExerciseIDs[0] = "changed-stage"
	}
	if !reflect.DeepEqual(lesson.StudyPlan, want.StudyPlan) {
		t.Fatal("mutating a returned study plan changed the cached lesson")
	}
}
