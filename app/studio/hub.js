import {esc,icon} from './core.js';

// «Практика» gathers every way to use the language outside a lesson. Speaking
// comes first: it is the skill a lesson alone trains least. Every place is a
// still with one line of English, like a frame from a film.
const lead={href:'#/conversation',title:'Разговор',text:'Кафе, собеседование, звонок другу. Собеседник отвечает на твою мысль, а после шести реплик — разбор.',action:'Начать разговор',image:'/assets/posters/friends-cafe.jpg',alt:'Друзья разговаривают в кафе',subtitle:'Can I get a latte, please?'};
const places=[
 {href:'#/cinema',title:'Кино',text:'Сцена с субтитрами, живые выражения и твой пересказ.',image:'/assets/posters/rainy-street.jpg',subtitle:'…and got completely <b>soaked</b>.'},
 {href:'#/pronunciation',title:'Произношение',text:'Звуки, ударение и чтение по транскрипции.',image:'/assets/posters/reading-aloud.jpg',focus:'50% 30%',subtitle:'/θɪŋk/ — <b>think</b>'},
 {href:'#/notebook',title:'Мои мысли',text:'Напиши по-русски — получи естественную английскую фразу и объяснение.',image:'/assets/posters/online-discussion.jpg',subtitle:'How do I <b>put</b> this?'},
 {href:'#/practice',title:'Свободное письмо',text:'Короткий текст на знакомую тему с разбором ошибок.',image:'/assets/posters/writing-desk.jpg',subtitle:'I <b>think</b> that…'},
 {href:'#/transfer',title:'Закрепление',text:'Пройденные темы возвращаются в новой ситуации через несколько дней.',image:'/assets/posters/courtyard-actions.jpg',subtitle:'She’s <b>watering</b> the plants.'},
 {href:'#/projects',title:'Проекты',text:'Задания уровня: письмо, речь и слушание без подсказок.',image:'/assets/posters/team-planning.jpg',subtitle:'Let’s <b>split</b> the tasks.'}
];

export function mountHub(root){
 root.innerHTML=`<div class="hub-page">
  <header class="page-head"><div><h1>Практика</h1><p>Говори, пиши и слушай за пределами урока.</p></div></header>
  <a class="hub-lead" href="${lead.href}"><img src="${esc(lead.image)}" alt="${esc(lead.alt)}" decoding="async"><span class="hub-lead-subtitle" lang="en">${esc(lead.subtitle)}</span><span class="hub-lead-copy"><strong>${esc(lead.title)}</strong><span>${esc(lead.text)}</span><span class="hub-lead-action">${icon('mic')} ${esc(lead.action)}</span></span></a>
  <div class="hub-grid">${places.map(p=>`<a class="hub-card" href="${p.href}"><span class="hub-poster"><img src="${esc(p.image)}" alt="" loading="lazy" decoding="async"${p.focus?` style="object-position:${p.focus}"`:''}><span class="hub-subtitle" lang="en">${p.subtitle}</span></span><span class="hub-text"><strong>${esc(p.title)}</strong><span>${esc(p.text)}</span></span></a>`).join('')}</div>
 </div>`;
}
