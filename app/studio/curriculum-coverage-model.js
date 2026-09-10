const arr=value=>Array.isArray(value)?value:[];
const text=value=>typeof value==='string'&&value.trim().length>0;

export function preparedCoverageModule(module,lesson){
 if(!lesson||lesson.id!==module.id||!text(lesson.title))return false;
 const expected=module.expectedExerciseCount??arr(module.exercisePlan).length;
 const required=arr(module.expectedMaterialIds??module.materials?.map(m=>m.id));
 const exercises=arr(lesson.exercises),materials=arr(lesson.materials);
 const materialIds=new Set(materials.filter(m=>text(m?.id)&&text(m?.text)).map(m=>m.id));
 return expected>0&&exercises.length>=expected&&required.length>0&&required.every(id=>materialIds.has(id))
  &&arr(lesson.sections).some(s=>text(s?.body))
  &&new Set(exercises.map(e=>e?.id)).size===exercises.length
  &&exercises.every(e=>text(e?.id)&&text(e?.prompt)&&arr(e.materialIds).length>0&&e.materialIds.every(id=>materialIds.has(id)));
}

export function coverageSummary(metadata,lessons,level=null){
 const published=new Map(arr(lessons).map(l=>[l.id,l]));
 const gaps=new Map(arr(metadata?.gaps).map(g=>[g.plannedModuleId,g]));
 const seen=new Set();
 const modules=arr(metadata?.modules).filter(m=>text(m?.id)&&!seen.has(m.id)&&seen.add(m.id)).map(m=>{
  const lesson=published.get(m.id),available=preparedCoverageModule(m,lesson);
  return {...m,available,lesson:available?lesson:null,gap:gaps.get(m.id)||null,
   relatedLessons:arr(m.relatedLessonIds).map(id=>published.get(id)).filter(Boolean)};
 });
 const selected=level?modules.filter(m=>m.level===level):modules;
 return {modules:selected,total:selected.length,available:selected.filter(m=>m.available).length,
  planned:selected.filter(m=>!m.available).length,allTotal:modules.length,allAvailable:modules.filter(m=>m.available).length};
}

export function sourceURL(value){
 try{const url=new URL(value);return url.protocol==='https:'||url.protocol==='http:'?url.href:'';}catch{return '';}
}

export function coverageSupplementGroups(metadata){
 const entries=new Map();
 for(const book of arr(metadata?.bookSupplements?.books))for(const entry of arr(book.entries)){
  const filename=book.filename,page=entry.page;
  const valid=text(filename)&&!/[/\\]/.test(filename)&&/\.pdf$/i.test(filename)&&Number.isInteger(page)&&page>0;
  entries.set(entry.id,{...entry,href:valid?`/books/${encodeURIComponent(filename)}#page=${page}`:''});
 }
 return arr(metadata?.supplements?.groups).map(g=>({...g,entries:arr(g.entryIds).map(id=>entries.get(id)).filter(Boolean)}));
}
