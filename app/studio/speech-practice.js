import {esc,icon,toast} from './core.js';
import {voice,speak,stopAudio} from './audio.js';

export function mountSpeechPractice(root,settings,phrases=[]){
 if(!root)return;
 const choices=[...new Set(phrases.filter(s=>typeof s==='string'&&s.trim()&&s.length<=1800).map(s=>s.trim()))].slice(0,12);
 if(!choices.length){root.remove();return;}
 root.innerHTML=`<details class="speech-practice"><summary>Повторить образец и проверить слова</summary><div class="speech-practice-body"><p class="small-note">Это тренировка чтения вслух. В своём ответе можно выразить ту же мысль иначе.</p>${choices.length>1?`<label>Фраза для повторения<select data-repeat-choice>${choices.map((s,i)=>`<option value="${i}">${esc(s)}</option>`).join('')}</select></label>`:''}<p data-repeat-phrase lang="en">${esc(choices[0])}</p><div class="actions"><button type="button" class="btn small ghost" data-repeat-listen>${icon('sound')} Послушать</button><button type="button" class="btn" data-repeat-record>${icon('mic')} Повторить в микрофон</button></div><label class="small-note">Расшифровка<textarea data-repeat-text rows="2" readonly aria-label="Расшифровка повторения"></textarea></label><audio class="audio-preview" controls hidden></audio></div></details>`;
 const text=root.querySelector('[data-repeat-text]'),preview=root.querySelector('audio'),select=root.querySelector('select'),button=root.querySelector('[data-repeat-record]');
 const selected=()=>choices[Number(select?.value)||0];
 root.querySelector('[data-repeat-listen]').onclick=()=>speak(selected());
 if(select)select.onchange=()=>{stopAudio();text.value='';preview.hidden=true;root.querySelector('.speech-feedback-host')?.remove();root.querySelector('[data-repeat-phrase]').textContent=selected();};
 button.onclick=()=>{
  if(!settings?.whisperUrl){toast('Для разбора по словам подключи Whisper в настройках.',true);return;}
  if(!button.classList.contains('recording')){text.value='';root.querySelector('.speech-feedback-host')?.remove();}
  return voice(button,text,settings,()=>{},{preview,expected:selected(),check:null,replace:true});
 };
}
