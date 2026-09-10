import {icon,esc} from './core.js';
export async function mountMethod(root){
 const route=location.hash;
 root.innerHTML='<p role="status">Открываем руководство по занятиям…</p>';
 const response=await fetch('/learning-method.html');
 if(!response.ok)throw Error('Не удалось открыть руководство.');
 const html=await response.text();
 if(!root.isConnected||location.hash!==route)return;
 root.innerHTML=`<div class="method-actions"><a class="btn" href="#/today">${icon('back')} План дня</a><a class="btn" href="#/transfer">Применить изученное</a><a class="btn" href="#/notebook">Мои мысли</a></div><details class="method-contents"><summary>Перейти к разделу</summary><nav aria-label="Разделы руководства"></nav></details><article class="learning-method">${html}</article>`;
 const headings=[...root.querySelectorAll('.learning-method h2')];
 root.querySelector('.method-contents nav').innerHTML=headings.map((heading,index)=>`<button type="button" data-method-section="${index}">${esc(heading.textContent)}</button>`).join('');
 root.querySelectorAll('[data-method-section]').forEach(button=>button.onclick=()=>{const heading=headings[Number(button.dataset.methodSection)];heading.tabIndex=-1;heading.scrollIntoView({block:'start'});heading.focus({preventScroll:true});});
}
