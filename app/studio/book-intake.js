import {russianCount} from './russian-count.js';

export function bookIntakeSummary(status,publishedTotal=0){
 const intake=status?.intake,total=status?.total??publishedTotal;
 const integer=value=>Number.isInteger(value)&&value>=0;
 if(intake?.state!=='available'||![total,intake.total,intake.ready,intake.pending,intake.cataloged,intake.books].every(integer)||intake.total<1||intake.books<1||intake.ready>intake.cataloged||intake.cataloged>intake.total||intake.cataloged>total||intake.pending!==intake.total-intake.ready)return null;
 return {...intake,plannedTotal:total+intake.total-intake.cataloged};
}

// Chapter availability is separate from the main route and from learner credit.
// Intake chapters already in the catalog must not be added to its total twice.
export function bookIntakeNotice(status,publishedTotal=0){
 const intake=bookIntakeSummary(status,publishedTotal);
 if(!intake)return '<strong>Статус дополнительных учебников пока недоступен.</strong><p>Счётчик книжных уроков относится к текущему каталогу. Готовность новых глав сейчас не подтверждена.</p>';
 const scope=`${russianCount(intake.total,['глава','главы','глав'])} из ${russianCount(intake.books,['новой книги','новых книг','новых книг'])}`;
 return `<strong>Готовые главы новых учебников: ${intake.ready} / ${intake.total}</strong><p>${intake.pending?`${scope}. Пока недоступно: ${intake.pending}. Вместе с текущим каталогом — ${russianCount(intake.plannedTotal,['глава','главы','глав'])} в книжном плане.`:`Дополнение доступно целиком: ${scope}. Главы можно открыть в оглавлении.`} Выбирай главы для нужной практики: они могут пересекаться с темами основного маршрута.</p>`;
}
