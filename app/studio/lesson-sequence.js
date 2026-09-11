export const courseLevels=['A1','A2','B1','B2','C1','C2'];
const list=value=>Array.isArray(value)?value:[];
const validID=value=>typeof value==='string'&&/^[A-Za-z0-9_-]{1,180}$/.test(value);

export function lessonRouteInfo(lessonId,route){
 const active=route?.version===1,overview=active&&list(route.overviewLessonIds).includes(lessonId);
 const deepening=active?list(route.deepening).find(item=>item?.lessonId===lessonId&&validID(item.afterLessonId)&&item.afterLessonId!==lessonId&&typeof item.reason==='string'&&item.reason.trim()):null;
 return{introduction:validID(lessonId)&&!overview,overview,relations:active?lessonSourceRelations(lessonId,list(route.relations).filter(item=>item?.lessonId===lessonId)):[],deepening:deepening?{afterLessonId:deepening.afterLessonId,reason:deepening.reason}:null};
}

// A level range describes applicability. A course placement describes where the
// same lesson is introduced once; neither rewrites its ID or saved evidence.
export function lessonSequence(lessons,path){
 const unique=new Map();for(const lesson of list(lessons))if(validID(lesson?.id)&&!unique.has(lesson.id))unique.set(lesson.id,lesson);
 const placement=new Map();let order=0;
 for(const level of courseLevels)for(const section of list(path?.levels).filter(section=>section?.id===level))for(const id of list(section.lessonIds)){
  if(unique.has(id)&&!placement.has(id))placement.set(id,{level,order:order++});
 }
 for(const lesson of unique.values())if(!placement.has(lesson.id)){
  const declared=(String(lesson.level).match(/[ABC][12]/g)||[]).map(value=>courseLevels.indexOf(value));
  placement.set(lesson.id,{level:declared.length?courseLevels[Math.min(...declared)]:null,order:order++});
 }
 const records=[...unique.values()].map(lesson=>({lesson,...placement.get(lesson.id)}));
 // A final workshop follows even newly added lessons whose home level came
 // from metadata rather than the explicit path. It never changes home level.
 const finalPlacement=new Map();let finalOrder=0;
 for(const section of list(path?.levels))for(const id of list(section?.finalLessonIds))if(validID(id)&&placement.get(id)?.level===section.id&&!finalPlacement.has(id))finalPlacement.set(id,finalOrder++);
 records.sort((a,b)=>(a.level?courseLevels.indexOf(a.level):6)-(b.level?courseLevels.indexOf(b.level):6)||Number(finalPlacement.has(a.lesson.id))-Number(finalPlacement.has(b.lesson.id))||(finalPlacement.has(a.lesson.id)?finalPlacement.get(a.lesson.id)-finalPlacement.get(b.lesson.id):a.order-b.order));
 return records;
}

// Relations must come from an explicit reviewed map. This hook only presents
// sources; it does not merge outcomes or create completion for another lesson.
export function lessonSourceRelations(lessonId,relations=[]){
 const seen=new Set();return list(relations).filter(source=>{
  if(!['lesson','book'].includes(source?.kind)||!validID(source.id)||!['alternative','related'].includes(source.relation)||typeof source.title!=='string'||!source.title.trim()||(source.kind==='lesson'&&source.id===lessonId))return false;
  const key=source.kind+':'+source.id;if(seen.has(key))return false;seen.add(key);return true;
 }).map(source=>({kind:source.kind,id:source.id,title:source.title,relation:source.relation,href:source.kind==='book'?'#/unit/'+source.id:'#/lesson/'+source.id}));
}
