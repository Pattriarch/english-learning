import {projectProgress} from './projects-model.js';
export function weeklyChallenge(catalog,state,level,now=Date.now()){
 const units=(catalog?.units||[]).filter(u=>u.level===level).map(u=>({unit:u,progress:projectProgress(u,state,now)}));
 const due=units.filter(x=>x.progress.due).sort((a,b)=>a.progress.dueAt-b.progress.dueAt);
 const chosen=due[0]||units.find(x=>x.progress.attempted&&!x.progress.transferred&&!x.progress.revised)||units.find(x=>!x.progress.attempted);
 if(!chosen)return {waiting:units.find(x=>x.progress.revised&&!x.progress.transferred)||null,complete:units.length>0&&units.every(x=>x.progress.transferred)};
 const task=chosen.unit.tasks.find(t=>t.id===chosen.progress.next),labels={reading:'Прочитать и выделить главное',listening:'Прослушать и восстановить смысл',writing:'Написать текст для адресата',speaking:'Ответить вслух и сохранить запись',mediation:'Передать смысл другому человеку',revision:'Доработать свои ответы',transfer:'Применить в новой ситуации'};
 return {...chosen,title:labels[task?.kind||chosen.progress.next]||'Продолжить проект',href:'#/projects/'+chosen.unit.id};
}
