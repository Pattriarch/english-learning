import {esc,icon} from './core.js';
import {courseGuideHTML,bindCourseGuide} from './course-guide.js';
import {beginnerBookNotes} from './book-beginner-notes.js';
import {speak} from './audio.js';

// These are language supports, not claims that a short lesson replaces an
// entire book chapter. Category membership comes from the verified contents.
const elementary={
 'Present':['path-be','path-present-simple','path-present-continuous'],
 'Past':['path-past-simple','path-past-continuous'],
 'Present perfect':['path-present-perfect'], 'Passive':['path-passive-basic'],
 'Verb forms':['path-past-simple','path-present-perfect'], 'Future':['path-future-simple','path-future-plans'],
 'Modals, imperative etc.':['path-requests-can','path-obligation','path-instructions'],
 'There and it':['path-there-is','path-be'], 'Auxiliary verbs':['path-be','path-questions-basic'],
 'Questions':['path-questions-basic'], 'Reported speech':['path-reported-speech'],
 'Go, get, do, make and have':['path-possession','path-everyday-phrasal'],
 '-ing and to …':['path-gerund-infinitive'], 'Pronouns and possessives':['path-pronouns','path-possession'],
 'A and the':['path-articles-basic','path-countability'], 'Determiners and pronouns':['path-pronouns','path-countability'],
 'Adjectives and adverbs':['path-adjectives-frequency','path-comparatives'], 'Word order':['path-be','path-questions-basic'],
 'Conjunctions and clauses':['path-connectors-basic','path-relative-basic'], 'Prepositions':['path-place-time'],
 'Phrasal verbs':['path-everyday-phrasal']
};
const intermediate={
 'Present and past':['path-present-simple','path-present-continuous','path-past-simple'],
 'Present perfect and past':['path-present-perfect','path-past-perfect'], 'Future':['path-future-plans','path-future-continuous'],
 'Modals':['path-obligation','path-deduction'], 'If and wish':['path-zero-first','path-second-conditional','path-third-conditional'],
 'Passive':['path-passive-basic','path-passive-advanced'], 'Reported speech':['path-reported-speech'],
 'Questions and auxiliary verbs':['path-questions-basic','path-polite-questions'], '-ing and to ...':['path-gerund-infinitive','path-verb-patterns-advanced'],
 'Articles and nouns':['path-articles-basic','path-articles-advanced'], 'Pronouns and determiners':['path-pronouns','path-countability'],
 'Relative clauses':['path-relative-basic','path-relative-advanced'], 'Adjectives and adverbs':['path-adjectives-frequency','path-comparatives'],
 'Conjunctions and prepositions':['path-connectors-basic','path-place-time'], 'Prepositions':['path-place-time'], 'Phrasal verbs':['path-everyday-phrasal']
};
const advanced={
 'Tenses':['path-present-perfect-continuous','path-past-perfect-continuous'], 'The future':['path-future-perfect','path-future-perfect-continuous'],
 'Modals and semi-modals':['path-deduction','path-modal-perfect'], 'Linking verbs, passives, questions':['path-passive-advanced','path-polite-questions'],
 'Verb complementation: what follows verbs':['path-verb-patterns-advanced'], 'Reporting':['path-reported-speech','path-reporting-verbs'],
 'Nouns':['path-word-formation','path-nominalisation'], 'Articles, determiners and quantifiers':['path-articles-advanced','path-quantifiers-nuance'],
 'Relative clauses and other types of clause':['path-relative-advanced','path-participle-clauses'],
 'Pronouns, substitution and leaving out words':['path-pronouns','path-substitution','path-ellipsis'],
 'Adjectives and adverbs':['path-comparatives','path-lexical-precision'], 'Adverbial clauses and conjunctions':['path-connectors-basic','path-discourse-markers'],
 'Prepositions':['path-place-time','path-preposition-patterns'], 'Organising information':['path-fronting','path-clefts','path-inversion']
};
const familySupports={
 'vocabulary-elementary':['path-be','path-articles-basic','path-present-simple'],
 'vocabulary-upper-intermediate':['path-word-formation','path-collocations-b1'],
 'vocabulary-advanced':['path-lexical-precision','path-word-formation'],
 'collocations-intermediate':['path-collocations-b1'], 'collocations-advanced':['path-collocations-b1','path-academic-collocations'],
 'phrasal-intermediate':['path-everyday-phrasal'], 'phrasal-advanced':['path-everyday-phrasal','path-phrasal-nuance']
};
// Unit numbers belong to the verified editions in library.json. A category such
// as "Tenses" is too broad to select the first explanation: a lesson on present
// simple must not open with past perfect continuous merely because both share it.
function unitSupports(groups){
 const result={};
 for(const [range,ids] of Object.entries(groups)){
  for(const segment of range.split(',')){
   const [start,end=start]=segment.split('-').map(Number);
   for(let n=start;n<=end;n++)result[n]=ids;
  }
 }
 return result;
}
const grammarUnits={
 'grammar-elementary':unitSupports({
  '1':['path-be'],'2':['path-be','path-questions-basic'],
  '3':['path-present-continuous'],'4':['path-present-continuous','path-questions-basic'],
  '5-6':['path-present-simple'],'7':['path-present-simple','path-questions-basic'],
  '8':['path-present-continuous','path-present-simple'],'9':['path-possession'],
  '10-12':['path-past-simple'],'13':['path-past-continuous'],
  '14':['path-past-continuous','path-past-simple'],'15-19':['path-present-perfect'],
  '20':['path-present-perfect','path-past-simple'],'21':['path-passive-basic'],
  '22':['path-passive-advanced','path-passive-basic'],
  '23':['path-be','path-present-simple','path-present-perfect'],
  '24':['path-past-simple','path-present-perfect'],'25-26':['path-future-plans'],
  '27-28':['path-future-simple'],'29':['path-deduction'],'30':['path-requests-can'],
  '31-33':['path-obligation'],'34':['path-requests-can'],'35':['path-instructions'],
  '36':['path-past-habits'],'37':['path-there-is'],
  '38':['path-there-is','path-past-simple','path-present-perfect'],'39':['path-be'],
  '40-41':['path-questions-basic','path-be'],'42':['path-be','path-present-simple'],
  '43':['path-be','path-present-simple'],'44-48':['path-questions-basic'],
  '49':['path-polite-questions'],'50':['path-reported-speech'],
  '51':['path-present-continuous','path-gerund-infinitive'],'52-54':['path-gerund-infinitive'],
  '55':['path-place-time','path-gerund-infinitive'],'56':['path-everyday-phrasal'],
  '57':['path-collocations-b1'],'58':['path-possession'],
  '59-63':['path-pronouns'],'64':['path-possession'],'65':['path-articles-basic'],
  '66':['path-plurals'],'67-68':['path-countability'],'69-70':['path-articles-basic'],
  '71':['path-place-time','path-articles-basic'],'72':['path-articles-basic','path-countability'],
  '73':['path-articles-advanced'],'74-75':['path-pronouns'],
  '76-79':['path-countability'],'80-82':['path-quantifiers-nuance'],
  '83':['path-countability'],'84':['path-quantifiers-nuance'],
  '85-86':['path-adjectives-frequency'],'87-90':['path-comparatives'],
  '91-92':['comparison'],'93-94':['path-adjectives-frequency'],
  '95':['path-present-perfect'],'96':['path-pronouns','path-instructions'],
  '97':['path-connectors-basic'],'98-99':['path-zero-first'],
  '100':['path-second-conditional'],'101-102':['path-relative-basic'],
  '103':['path-place-time'],'104':['path-place-time','path-present-perfect'],
  '105':['path-connectors-basic','path-place-time'],'106-111':['path-place-time'],
  '112':['prepositions','path-gerund-infinitive'],'113':['prepositions'],
  '114-115':['path-everyday-phrasal']
 }),
 'grammar-intermediate':unitSupports({
  '1':['path-present-continuous'],'2':['path-present-simple'],
  '3-4':['path-present-continuous','path-present-simple'],'5':['path-past-simple'],
  '6':['path-past-continuous'],'7-8':['path-present-perfect'],
  '9-11':['path-present-perfect-continuous','path-present-perfect'],
  '12':['path-present-perfect','path-present-perfect-continuous'],
  '13-14':['path-present-perfect','path-past-simple'],'15':['path-past-perfect'],
  '16':['path-past-perfect-continuous'],'17':['path-possession'],'18':['path-past-habits'],
  '19-20':['path-future-plans'],'21-22':['path-future-simple'],
  '23':['path-future-simple','path-future-plans'],
  '24':['path-future-continuous','path-future-perfect'],'25':['path-zero-first','path-present-perfect'],
  '26':['path-requests-can'],'27':['path-modal-perfect','path-requests-can'],
  '28-30':['path-deduction'],'31-35':['path-obligation'],
  '36':['path-second-conditional','path-past-habits'],'37':['path-requests-can'],
  '38':['path-zero-first','path-second-conditional'],
  '39':['path-second-conditional','path-mixed-conditionals'],
  '40':['path-third-conditional','path-mixed-conditionals'],'41':['path-mixed-conditionals'],
  '42':['path-passive-basic'],'43-44':['path-passive-advanced'],
  '45':['path-passive-advanced','path-reported-speech'],'46':['path-passive-advanced'],
  '47-48':['path-reported-speech'],'49':['path-questions-basic'],
  '50':['path-polite-questions','path-reported-speech'],
  '51':['path-substitution','path-questions-basic'],'52':['path-questions-basic'],
  '53-55':['path-gerund-infinitive'],'56-59':['path-verb-patterns-advanced'],
  '60':['path-gerund-infinitive'],'61':['verb-patterns','path-past-habits'],
  '62':['prepositions','path-gerund-infinitive'],'63-67':['path-gerund-infinitive'],
  '68':['path-participle-clauses'],'69-71':['path-countability'],
  '72':['path-articles-basic'],'73-78':['path-articles-advanced'],'79':['path-plurals'],
  '80':['path-word-formation'],'81':['path-possession'],'82-83':['path-pronouns'],
  '84':['path-there-is','path-be'],'85-86':['path-countability'],
  '87-91':['path-quantifiers-nuance'],'92-93':['path-relative-basic'],
  '94-96':['path-relative-advanced'],'97':['path-participle-clauses'],
  '98-101':['path-adjectives-frequency'],'102':['path-adjectives-frequency','path-countability'],
  '103':['comparison'],'104':['path-adjectives-frequency'],
  '105':['path-comparatives'],'106-107':['comparison'],'108':['path-comparatives'],
  '109-110':['path-adjectives-frequency'],'111':['path-present-perfect'],
  '112':['path-emphasis-restraint'],'113':['linking'],
  '114-115':['path-zero-first'],'116':['path-connectors-basic','path-past-continuous'],
  '117':['comparison','prepositions'],'118':['path-second-conditional','comparison'],
  '119':['path-place-time','path-past-continuous'],'120':['path-future-perfect','path-place-time'],
  '121-127':['path-place-time'],'128':['prepositions','path-passive-basic'],
  '129-136':['prepositions'],'137-145':['path-everyday-phrasal','phrasal']
 }),
 'grammar-advanced':unitSupports({
  '1-2':['path-present-continuous','path-present-simple'],
  '3':['path-present-perfect','path-past-simple'],
  '4':['path-past-continuous','path-past-simple'],'5':['path-past-perfect'],
  '6':['path-present-perfect-continuous','path-present-perfect'],
  '7':['path-past-perfect-continuous','path-past-perfect'],
  '8':['present','past-story'],'9':['path-future-simple','path-future-plans'],
  '10':['path-future-plans'],
  '11':['path-future-continuous','path-future-perfect','path-future-perfect-continuous'],
  '12-13':['path-future-plans','path-future-simple'],
  '14':['path-reported-speech','path-future-plans'],'15':['path-requests-can'],
  '16':['path-past-habits','path-future-simple'],'17':['path-deduction'],
  '18-20':['path-obligation'],'21':['path-be','path-adjectives-frequency'],
  '22':['path-passive-basic'],'23':['path-passive-advanced','path-gerund-infinitive'],
  '24':['path-passive-advanced'],'25':['path-passive-advanced','path-reporting-verbs'],
  '26':['path-questions-basic'],'27':['research-question-response','path-polite-questions'],
  '28':['path-pronouns','path-gerund-infinitive'],'29':['path-pronouns'],
  '30-31':['path-verb-patterns-advanced'],'32-33':['path-reported-speech','path-reporting-verbs'],
  '34':['path-polite-questions','path-reporting-verbs'],'35':['path-reported-speech'],
  '36':['path-reporting-verbs'],'37':['path-reported-speech','path-modal-perfect'],
  '38':['path-reporting-verbs','path-nominalisation'],
  '39':['path-reporting-verbs','path-obligation'],
  '40-42':['path-plurals','path-countability'],'43':['path-word-formation','path-information-density'],
  '44':['path-articles-basic'],'45-47':['path-articles-advanced'],
  '48-49':['path-countability'],'50-52':['path-quantifiers-nuance'],
  '53-55':['path-relative-advanced'],'56-57':['path-relative-advanced','path-information-density'],
  '58-59':['path-participle-clauses'],'60':['path-pronouns'],
  '61-63':['path-substitution'],'64-65':['path-ellipsis'],
  '66':['path-adjectives-frequency'],'67-68':['path-lexical-precision','path-adjectives-frequency'],
  '69':['path-word-formation','path-adjectives-frequency'],
  '70':['path-gerund-infinitive','path-adjectives-frequency'],'71':['path-adjectives-frequency'],
  '72':['path-comparatives'],'73':['comparison'],'74-76':['path-adjectives-frequency'],
  '77':['path-emphasis-restraint'],'78':['path-hedging','path-discourse-markers'],
  '79':['path-connectors-basic','path-zero-first'],'80-81':['path-connectors-basic'],
  '82':['linking'],'83':['path-zero-first','path-second-conditional'],
  '84':['path-third-conditional','path-mixed-conditionals'],
  '85':['path-second-conditional','path-counterfactual-inversion'],
  '86':['path-zero-first','path-polite-questions'],'87':['path-discourse-markers'],
  '88-90':['path-place-time'],'91':['path-advanced-negation','prepositions'],
  '92-93':['path-preposition-patterns'],'94':['phrasal','path-phrasal-nuance'],
  '95':['path-there-is'],'96-97':['path-be','path-fronting'],
  '98':['path-clefts'],'99-100':['path-inversion']
 })
};
function grammarTopic(title){
 const t=title.toLowerCase();
 // Fallback for a chapter without a catalog number; most specific forms first.
 if(/past perfect continuous/.test(t))return ['path-past-perfect-continuous'];
 if(/present perfect continuous/.test(t))return ['path-present-perfect-continuous'];
 if(/future perfect continuous/.test(t))return ['path-future-perfect-continuous'];
 if(/future perfect|will have done/.test(t))return ['path-future-perfect'];
 if(/future continuous|will be doing/.test(t))return ['path-future-continuous'];
 if(/past perfect|i had done/.test(t))return ['path-past-perfect'];
 if(/present perfect|i have done/.test(t))return ['path-present-perfect'];
 if(/present continuous/.test(t))return ['path-present-continuous',...(/present simple/.test(t)?['path-present-simple']:[])];
 if(/present simple/.test(t))return ['path-present-simple'];
 if(/past continuous/.test(t))return ['path-past-continuous'];
 if(/past simple/.test(t))return ['path-past-simple'];
 if(/participle clause/.test(t))return ['path-participle-clauses'];
 if(/inversion/.test(t))return ['path-inversion'];
 if(/relative/.test(t))return ['path-relative-advanced'];
 if(/reported speech|reporting/.test(t))return ['path-reported-speech'];
 if(/have something done/.test(t))return ['path-passive-advanced'];
 if(/passive/.test(t))return ['path-passive-basic'];
 if(/phrasal|two- and three-word verbs/.test(t))return ['path-everyday-phrasal'];
 return null;
}
export function bookPreparation(book,unit,lessons=[]){
 const bid=book.duplicateOf||book.id,title=unit.title||'',category=unit.category||'';
 let ids=(bid==='grammar-elementary'?elementary:bid==='grammar-intermediate'?intermediate:bid==='grammar-advanced'?advanced:null)?.[category];
 let basis=ids?'category':'language-base';ids=[...(ids||familySupports[bid]||[])];
 if(grammarUnits[bid]){
  const exact=grammarUnits[bid][Number(unit.unit)];
  const topic=exact||grammarTopic(title);
  if(topic){ids=topic;basis=exact?'catalog-unit':'title-topic';}
 }
 if(bid==='vocabulary-upper-intermediate'&&category==='Words and pronunciation')ids=['path-sound-basics','path-connected-speech'];
 if(bid==='vocabulary-upper-intermediate'&&category==='Phrasal verbs and verb-based expressions')ids=['path-everyday-phrasal'];
 if(bid==='vocabulary-upper-intermediate'&&category==='Connecting and linking words')ids=['path-connectors-basic'];
 if(bid==='vocabulary-advanced'&&category==='Fixed expressions and figurative language')ids=['path-idioms-context','path-metaphor'];
 const supports=[...new Set(ids)].map(id=>lessons.find(l=>l.id===id)).filter(Boolean);
 return {unitId:unit.equivalentUnitId||unit.id,title,basis,supports,requestedIds:ids};
}
export function bookPreparationHTML(book,unit,lessons,options={}){
 const prep=bookPreparation(book,unit,lessons),first=prep.supports[0];
 const brief=first?.courseGuide?first:first?.beginner?{...first,courseGuide:{purpose:first.goal,explanation:first.sections.slice(0,3),examples:first.examples.slice(0,2)}}:null;
 return `<section class="surface book-preparation"><span class="eyebrow">ВХОД В ГЛАВУ</span><h2>Сначала знакомая опора, затем детали</h2><p>В учебнике тема разобрана шире, чем в коротком уроке. Если конструкция новая, сначала пройди её по шагам в основном курсе. Главы библиотеки — дополнительная практика, их не нужно проходить повторно ради счётчика.</p>${prep.supports.length?`<ul>${prep.supports.map(l=>`<li><a href="#/lesson/${esc(l.id)}">${esc(l.title)}</a><span class="small-note"> · ${esc(l.level)}</span></li>`).join('')}</ul>`:''}<p class="small-note">Это языковые опоры для раздела ${esc(unit.category||book.title)}, а не замена всех нюансов главы. Разбирай по одному пункту ниже: пример → смысл → своя короткая фраза. Потом переходи к заданиям.</p>${options.editorial?'' : bookBeginnerNotesHTML(prep.unitId)}${brief?courseGuideHTML(brief,1):''}</section>`;
}
export function bookBeginnerNotesHTML(unitId){
 const note=beginnerBookNotes[unitId];if(!note)return '';
 return `<details class="book-beginner-notes" open><summary>${esc(note.title)}</summary><p class="book-note-body">${esc(note.body)}</p>${note.examples.map((e,i)=>`<div class="book-note-example"><div class="diagram-english"><p lang="en">${esc(e.en)}</p><button type="button" class="btn small ghost" data-book-note-speak="${i}" aria-label="Послушать опорный пример ${i+1}">${icon('sound')}</button></div><p>${esc(e.ru)}</p></div>`).join('')}<details><summary>Слова для заданий · ${note.vocabulary.length}</summary><dl class="book-note-vocabulary">${note.vocabulary.map(w=>`<div><dt lang="en">${esc(w.en)}</dt><dd>${esc(w.ru)}</dd></div>`).join('')}</dl></details></details>`;
}
export function bindBookPreparation(root,book,unit,lessons){
 const prep=bookPreparation(book,unit,lessons),first=prep.supports[0],note=beginnerBookNotes[prep.unitId];
 if(first)bindCourseGuide(root,first.courseGuide?first:{...first,courseGuide:{examples:first.examples.slice(0,2)}});
 if(note)root.querySelectorAll('[data-book-note-speak]').forEach(button=>button.onclick=()=>{
  const example=note.examples[Number(button.dataset.bookNoteSpeak)];
  if(example)speak(example.en,.9,'en-US',{button,isCurrent:()=>button.isConnected});
 });
}
