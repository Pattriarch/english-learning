export const projectLevels=['A1','A2','B1','B2','C1','C2'];
export const projectTaskKinds=['reading','listening','writing','speaking','mediation'];
export const projectKey=(id,task)=>`project:${id}:${task}`;
export const projectReceiptKey=(kind,id,attempt)=>`project:${kind}:${id}:${attempt}`;
export const projectAudioURL=file=>/^[a-f0-9]{64}\.(webm|wav|ogg|m4a)$/.test(file||'')?'/media/'+file:'';
export function projectParse(raw){try{return JSON.parse(raw||'null');}catch{return null;}}
export function projectTimestamp(value,now=Date.now()){
 const match=typeof value==='string'&&value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/);if(!match)return null;
 const [,y,m,d,h,min,s]=match.map(Number);if(m<1||m>12||d<1||d>new Date(Date.UTC(y,m,0)).getUTCDate()||h>23||min>59||s>59)return null;
 const at=Date.parse(value);return Number.isFinite(at)&&at<=now?at:null;
}
export function projectLatest(unit,state,task,now=Date.now()){let latest=null,latestAt=-Infinity;for(const a of state.attempts||[]){const at=projectTimestamp(a.at,now);if(a.lessonId==='project-'+unit.id&&a.exerciseId===task&&a.answer?.trim().split(/\s+/).length>=4&&at!==null&&at>=latestAt){latest=a;latestAt=at;}}return latest;}
function receipt(state,kind,id,attempt){return projectParse(state.drafts?.[projectReceiptKey(kind,id,attempt)]?.text);}
export function projectProgress(unit,state,now=Date.now()){
 const attempts=unit.tasks.map(t=>projectLatest(unit,state,t.id,now));
 const speaking=attempts.find((a,i)=>unit.tasks[i].kind==='speaking'),audio=speaking&&receipt(state,'recording',unit.id,speaking.id);
 const spoken=!!(speaking?.mode==='speaking'&&audio?.answer===speaking.answer&&projectAudioURL(audio.file));
 const evidence=attempts.map((a,i)=>!!a&&(unit.tasks[i].kind!=='speaking'||spoken));
 const revision=projectLatest(unit,state,'revision',now),revisionReceipt=revision&&receipt(state,'revision',unit.id,revision.id);
 const revised=evidence.every(Boolean)&&!!revision&&Date.parse(revision.at)>=Math.max(...attempts.map(a=>Date.parse(a?.at)))&&revisionReceipt?.answer===revision.answer&&JSON.stringify(revisionReceipt.attemptIds)===JSON.stringify(attempts.map(a=>a?.id));
 const dueAt=revised?Date.parse(revision.at)+(unit.transfer.delayDays||7)*86400000:null;
 const transfer=projectLatest(unit,state,'transfer',now),transferred=!!(revised&&transfer&&Date.parse(transfer.at)>=dueAt);
 const reviewed=a=>!!a&&a.feedback?.verdict==='correct'&&['codex','claude','ollama','compatible'].includes(a.feedback?.source);
 const supported=attempts.some((a,i)=>{const c=a&&receipt(state,'conditions',unit.id,a.id);return c?.model||unit.tasks[i].kind==='listening'&&c?.transcript;});
 const passed=transferred&&[...attempts,revision,transfer].every(reviewed);
 return {attempts,evidence,spoken,revision,revised,dueAt,transfer,transferred,passed,supported,independent:passed&&!supported,attempted:evidence.filter(Boolean).length,total:unit.tasks.length,next:evidence.includes(false)?unit.tasks[evidence.indexOf(false)].id:!revised?'revision':!transferred?'transfer':'review',needsWork:[...attempts,revision,transfer].some(a=>a&&['partial','incorrect'].includes(a.feedback?.verdict)),ungraded:[...attempts,revision,transfer].some(a=>a?.feedback?.verdict==='ungraded'),status:passed?'reviewed':transferred?'practice-complete':revised?'transfer-due':evidence.some(Boolean)?'in-progress':'new',due:revised&&!transferred&&now>=dueAt};
}
