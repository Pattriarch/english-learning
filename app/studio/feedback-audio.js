// Kept independent of core.js: feedback is rendered in many course surfaces.
const escape=value=>String(value??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
export function spokenAnswer(value){
  const text=typeof value==='string'?value.trim():'';
  // A mixed-language explanation or IPA is not an English pronunciation model.
  return text&&text.length<=6000&&/[A-Za-z]/.test(text)&&!/[\p{Script=Cyrillic}\u0250-\u02ff]/u.test(text)&&!/^\/.+\/$/.test(text)?text:'';
}
export function answerAudioHTML(value,label='Послушать ответ'){
  const text=spokenAnswer(value);if(!text)return '';
  return `<button type="button" class="btn small answer-audio" data-answer-audio="${escape(text)}" aria-label="${escape(label)}">▶ ${escape(label)}</button>`;
}
export function primaryAnswerAudio(attempt){
  const f=attempt?.feedback||{};
  return spokenAnswer(f.corrected)||(f.verdict==='correct'?spokenAnswer(attempt.answer):'');
}
export function bindAnswerAudio(root=document,loadAudio=()=>import('./audio.js')){
  for(const button of root.querySelectorAll('[data-answer-audio]')){
    let request=0;
    button.onclick=async()=>{
      const text=spokenAnswer(button.dataset.answerAudio),current=++request;
      if(!text||!button.isConnected)return;
      const {speak}=await loadAudio();
      if(!button.isConnected||current!==request)return;
      return speak(text,.9,'en-US',{button,isCurrent:()=>button.isConnected&&current===request});
    };
  }
}
