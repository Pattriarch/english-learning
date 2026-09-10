import {icon} from './icons.js';
export {icon};
export const $=(q,root=document)=>root.querySelector(q);
export const $$=(q,root=document)=>[...root.querySelectorAll(q)];
export const esc=v=>String(v??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export const uid=()=>crypto.randomUUID();
export const dateKey=(d=new Date())=>`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
export const formatDate=v=>new Date(v).toLocaleDateString('ru-RU',{day:'numeric',month:'short'});
export const words=t=>(t.trim().match(/\S+/g)||[]).length;
export function clipUTF8(text,maxBytes){const bytes=new TextEncoder().encode(text);if(bytes.length<=maxBytes)return text;let end=Math.max(0,Math.floor(maxBytes));while(end>0&&(bytes[end]&0xc0)===0x80)end--;return new TextDecoder().decode(bytes.subarray(0,end));}
export const mediaURL=name=>/^[a-f0-9]{64}\.(png|jpg)$/.test(name||'')?'/media/'+name:'';
export async function api(path,body,method='POST'){
  let res;try{res=await fetch('/api'+path,{method:body===undefined?'GET':method,headers:body instanceof FormData?{}:{'Content-Type':'application/json'},body:body===undefined?undefined:body instanceof FormData?body:JSON.stringify(body)});}catch{throw Error('Сервер недоступен. Откройте Start-English.cmd. Ваш текст остаётся в черновике браузера.');}
  let out;try{out=await res.json();}catch{throw Error('Сервер вернул неожиданный ответ.');}
  if(!res.ok){const error=Error(out.error||'Не удалось выполнить действие');error.status=res.status;throw error;}return out;
}
let toastTimer;
export function toast(message,error=false){const el=$('#toast');el.textContent=message;el.className='visible'+(error?' error':'');clearTimeout(toastTimer);toastTimer=setTimeout(()=>el.className='',error?10000:5000);}
export async function busy(button,fn,label='Подождите…'){
  if(button.disabled)return;const original=button.innerHTML;button.disabled=true;button.innerHTML=`<span class="spinner"></span> ${esc(label)}`;
  try{return await fn();}catch(e){toast(e.message,true);return null;}finally{button.disabled=false;button.innerHTML=original;}
}
export function saveStatus(ok,text){const el=$('#save-status');if(el){el.className='save-status'+(ok?'':' error');el.innerHTML=icon(ok?'check':'clock')+esc(text||(ok?'Прогресс сохранён':'Не удалось сохранить'));}}
let draftQueue=Promise.resolve();const pending=new Map();
export function localDraft(key){try{return JSON.parse(localStorage.getItem('ew-draft:'+key)||'null');}catch{return null;}}
export function getDraft(key,state){const local=localDraft(key),server=state.drafts[key],localTime=Date.parse(local?.at),serverTime=Date.parse(server?.at);return(local&&Number.isFinite(localTime)&&(local.pending===true||!server||!Number.isFinite(serverTime)||localTime>serverTime)?local:server)?.text||'';}
export function queueDraft(key,text,immediate=false){
  const draft={text,at:new Date().toISOString(),pending:true};try{localStorage.setItem('ew-draft:'+key,JSON.stringify(draft));}catch{toast('Хранилище браузера заполнено. Проверьте сохранение на сервере.',true);}
  clearTimeout(pending.get(key));saveStatus(true,'Сохраняем…');
  const run=()=>{pending.delete(key);draftQueue=draftQueue.catch(()=>{}).then(async()=>{try{const saved=await api('/draft',{key,text}),accepted=saved.draft?.text===text&&Number.isFinite(Date.parse(saved.draft.at))?saved.draft:null;const latest=localDraft(key);if(latest?.at===draft.at&&latest.text===text){try{localStorage.setItem('ew-draft:'+key,JSON.stringify({...draft,at:accepted?.at||draft.at,pending:false}));}catch{}}saveStatus(true);}catch(e){saveStatus(false,'Черновик в браузере');}});return draftQueue;};
  if(immediate)return run();pending.set(key,setTimeout(run,600));
}
export function retryPendingDrafts(){
  const saves=[];
  try{for(let i=0;i<localStorage.length;i++){const storageKey=localStorage.key(i);if(!storageKey?.startsWith('ew-draft:'))continue;const key=storageKey.slice(9),draft=localDraft(key);if(draft?.pending===true&&typeof draft.text==='string')saves.push(queueDraft(key,draft.text,true));}}catch{}
  return Promise.all(saves);
}
export function button(text,action,cls='',iconName=''){return `<button class="btn ${cls}" data-action="${action}">${iconName?icon(iconName):''}${text}</button>`;}
export function empty(title,body,action=''){return `<div class="empty">${icon('pen')}<h3>${esc(title)}</h3><p>${esc(body)}</p>${action}</div>`;}
export function progressLesson(l,state){
  const valid=new Set(l.exercises.map(e=>e.id));
  const attempts=state.attempts.filter(a=>a.lessonId===l.id&&valid.has(a.exerciseId)),tried=new Set(attempts.map(a=>a.exerciseId));
  const latest=new Map();for(const a of attempts)latest.set(a.exerciseId,a);
  const correct=[...latest.values()].filter(a=>a.feedback.verdict==='correct').length;
  return{tried:tried.size,correct,total:l.exercises.length,read:!!state.read[l.id],done:correct>=Math.ceil(l.exercises.length*.8)&&tried.size>=l.exercises.length};
}
export function feedbackHTML(a){
  const f=a.feedback;return `<div class="feedback ${esc(f.verdict)}">
    <div class="feedback-title">${icon(f.verdict==='correct'?'check':'pen')}${esc(f.summary)}</div>
    <div class="answer-meta"><span>${f.source==='reference'?'Сравнение с примерами':'Разбор помощника · '+esc(f.source)}</span><span>${f.verdict==='ungraded'?'Без оценки':'Ответ сохранён'}</span></div>
    ${f.scope==='text-reflection'?'<p class="small-note">Разобран текст ответа. Это не оценка звуков, акцента или интонации.</p>':''}
    ${f.corrected?`<div class="eyebrow">${f.verdict==='ungraded'?'Один из примеров':'Возможная формулировка'}</div><div class="correction">${esc(f.corrected)}</div>`:''}
    ${(f.mistakes||[]).map(m=>`<div class="mistake"><del>${esc(m.original)}</del> &nbsp;→&nbsp; <strong>${esc(m.correction)}</strong><p>${esc(m.why)}</p><small>${esc(m.rule)}</small><div class="spacer"></div><button class="btn small" data-mistake="${esc(m.original)}" data-correction="${esc(m.correction)}" data-note="${esc(m.why)}">${icon('cards')} В повторение</button></div>`).join('')}
    <p>${esc(f.explanation)}</p>
    ${f.alternatives?.length?`<details><summary>Другие допустимые варианты</summary><ul>${f.alternatives.map(t=>`<li>${esc(t)}</li>`).join('')}</ul></details>`:''}
  </div>`;
}
export function openModal(title,body){const d=$('#modal');d.innerHTML=`<div class="modal-head"><h2>${esc(title)}</h2><button aria-label="Закрыть" id="modal-close">${icon('close')}</button></div>${body}`;$('#modal-close').onclick=()=>d.close();if(!d.open)d.showModal();return d;}
export async function cardModal(prefill={},onSaved=()=>{}){
  const d=openModal('Сохранить в словарь',`<form id="card-form">
    <div class="field"><label for="card-front">Русский смысл — что нужно вспомнить</label><textarea id="card-front" rows="2" required placeholder="Например: Я пока не разобрался, как это работает.">${esc(prefill.front||'')}</textarea></div>
    <div class="field"><label for="card-back">Английская фраза — ответ</label><textarea id="card-back" rows="2" required>${esc(prefill.back||'')}</textarea></div>
    <div class="field"><label for="card-note">Объяснение или личная ассоциация</label><textarea id="card-note" rows="3">${esc(prefill.note||'')}</textarea></div>
    ${mediaURL(prefill.image)?`<img class="capture-preview" src="${mediaURL(prefill.image)}" alt="Кадр для ассоциации">`:''}
    <button class="btn primary" type="submit">${icon('plus')} Добавить карточку</button>
  </form>`);
  const cardID=uid(),form=$('#card-form');
  form.onsubmit=e=>{e.preventDefault();busy($('#card-form button'),async()=>{await api('/cards',{id:cardID,front:$('#card-front').value,back:$('#card-back').value,note:$('#card-note').value,source:prefill.source||'',image:prefill.image||''});if(form.isConnected)d.close();toast('Карточка добавлена. Она уже доступна для повторения.');window.dispatchEvent(new Event('ew-refresh'));await onSaved();},'Сохраняем…');};
}
export function bindMistakes(root=document){$$('[data-mistake]',root).forEach(b=>b.onclick=()=>cardModal({front:'Исправь и объясни: '+b.dataset.mistake,back:b.dataset.correction,note:b.dataset.note,source:'Моя ошибка'}));}
