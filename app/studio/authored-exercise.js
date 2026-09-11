// Editorial contract: bump revision whenever a published prompt, attached
// material, answer, explanation, or assessment changes. Unchanged tasks retain
// their historical IDs; revisions never migrate or delete a learner's history.
export function authoredExerciseID(exercise) {
 const revision=exercise?.revision??0;
 if(typeof exercise?.id!=='string'||!Number.isInteger(revision)||revision<0||revision>1000000)return null;
 return revision?`${exercise.id}--revision-${revision}`:exercise.id;
}
export function currentAuthoredExercise(lesson,practiceID) {
 return (lesson?.exercises||[]).find(ex=>authoredExerciseID(ex)===practiceID)||null;
}
// Map back through the current lesson, never by stripping an arbitrary suffix.
// Keys remain original content IDs for navigation and curriculum evidence maps.
export function authoredLessonState(lesson,attempts=[]) {
 const latest=new Map();
 for(const attempt of attempts){
  if(attempt?.lessonId!==lesson.id)continue;
  const exercise=currentAuthoredExercise(lesson,attempt.exerciseId);if(!exercise)continue;
  const previous=latest.get(exercise.id),at=Date.parse(attempt.at),before=Date.parse(previous?.at);
  if(!previous||!Number.isFinite(before)||(Number.isFinite(at)&&at>=before))latest.set(exercise.id,attempt);
 }
 return {latest,tried:new Set(latest.keys())};
}
