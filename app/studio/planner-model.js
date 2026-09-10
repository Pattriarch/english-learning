import {transferQueue,transferTargetEvidence,transferIdentity} from './transfer-model.js';
// The saved plan is a snapshot. These functions never write progress or replace it.
const LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'];
const BUDGETS = [30, 60, 90, 120, 180];
const SKILLS = ['grammar', 'vocabulary', 'reading', 'listening', 'speaking', 'writing', 'pronunciation'];
const LABELS = {grammar:'Грамматика', vocabulary:'Слова и выражения', reading:'Чтение', listening:'Аудирование', speaking:'Устная речь', writing:'Письмо', pronunciation:'Произношение', review:'Повторение'};
const WEAK_ORDER = ['speaking', 'listening', 'writing', 'reading', 'pronunciation', 'vocabulary', 'grammar'];
const DOMAINS = {
 everyday: {label:'повседневная жизнь', situation:'договориться с соседом об общем пространстве', basic:'I share an apartment with Alex. I work at home on Tuesday. Alex wants to invite two friends that afternoon. We have only one table. I need a quiet place for a call at three. Alex suggests meeting the friends in a cafe first. They can come to our apartment at five.', text:'Alex and I share an apartment, but our schedules have recently changed. I now work from home twice a week, while Alex uses the living room to meet friends. Yesterday we realized that we had both made plans for Tuesday afternoon. I need a quiet space for a call; Alex has invited two friends to cook together. Neither of us wants to cancel. Alex suggested using headphones, but that would not stop background noise reaching my microphone. We finally agreed that the friends would meet at a cafe and come to the apartment after my call. We also decided to put shared plans on a calendar.', question:'Почему наушники не решали проблему? Какой компромисс нашли соседи и как они собираются избежать повторения ситуации?'},
 work: {label:'работа', situation:'обсудить сроки проекта и предложить реалистичный компромисс', basic:'Our team is making a small website. The client wants it on Friday. Two pages are ready, but the booking form does not work yet. Sam wants to send the ready pages first. I think we need to explain the problem to the client. We can finish the form on Monday.', text:'Our team promised to deliver a small website on Friday. On Wednesday, the client asked us to add a booking form. The designer thought it would take only a few hours, but the developer explained that the form also needed validation and testing. Sam suggested sending the finished pages on Friday and adding the form on Monday. Another colleague worried that the client would see this as a broken promise. We checked the original agreement: the booking form was not included. We decided to offer two clear options, explain the consequences of each, and ask the client which mattered more: the original date or the complete new feature.', question:'Что изменилось после первоначальной договорённости? Почему команда не смогла просто добавить форму? Сформулируй оба варианта для клиента.'},
 travel: {label:'поездки', situation:'изменить маршрут и объяснить свой выбор спутнику', basic:'Maya and I are visiting a new city. It is raining today. We planned to walk by the river, but Maya does not have a coat. There is a museum near our hotel. It costs more than the walk. We decide to visit the museum now and walk tomorrow if the weather is better.', text:'Maya and I had planned to spend our first day walking along the river. When we woke up, it was raining heavily and the forecast on Maya’s phone had changed. I suggested a museum near the hotel. Maya liked the idea but wanted to keep enough money for a concert that evening. The museum website mentioned a cheaper afternoon ticket, although it did not say whether every exhibition was included. We decided to call before buying anything. If the ticket covered the exhibition we wanted, we would go after lunch; otherwise, we would explore the covered market. The river walk could wait until tomorrow.', question:'Какая информация ещё нужна путешественникам? Как цена влияет на выбор? Перескажи основной и запасной план, не добавляя отсутствующих фактов.'},
 culture: {label:'кино и культура', situation:'обсудить неоднозначное решение героя и защитить своё прочтение сцены', basic:'In a short film, a young woman finds a letter at a station. The letter has a name but no address. She wants to find its owner. Her friend says they should give it to a worker at the station. The woman keeps the letter for one night. The film ends before we see her decision.', text:'In an imaginary short film, a woman finds an unopened letter at a railway station. The envelope carries a name but no address. Her friend tells her to hand it to the station staff. Instead, she takes it home, claiming that she can find its owner online. The next scene shows her sitting beside the letter without opening it. Some viewers might see her silence as respect for the owner’s privacy. Others might interpret it as hesitation before doing something she knows is wrong. The film ends before she makes a decision. This ending leaves us with evidence about her actions, but very little certainty about her motives.', question:'Какие действия героини показаны прямо, а какие мотивы только предполагаются? Предложи две интерпретации финала и подкрепи каждую деталями текста.'},
 science: {label:'наука и технологии', situation:'обсудить проверку идеи и отделить наблюдение от вывода', basic:'A school club wants to test two paper airplanes. One plane is small and one is large. The students fly each plane once. The small plane goes further. Jo says the small design is better. Kim wants to try again because the wind is changing. They decide to fly both planes five more times.', text:'An imaginary school club is comparing two paper airplane designs. On the first attempt, the smaller plane travels further. Jo immediately says that its design is better. Kim points out that a single flight cannot tell them whether the result came from the design, the throw, or a change in the wind. The group agrees to repeat the comparison indoors and to use the same person for every throw. They will record all the distances, including the disappointing ones. They also decide what they mean by “better”: traveling further, landing more consistently, or being easier to build. Their next discussion will compare the observations before making a broader claim.', question:'Почему первый полёт не позволяет уверенно выбрать лучший дизайн? Что группа меняет в проверке? Какие разные значения может иметь слово «лучше»?'},
 society: {label:'общество', situation:'предложить решение для общего пространства и учесть разные интересы', basic:'Our town has an empty room near the library. Some people want a quiet study room. Other people want a place for music lessons. The room is small. At a meeting, Lena suggests quiet study in the morning and music after four. The group wants to ask local people before deciding.', text:'In an imaginary neighborhood, a room beside the library has become available. Students want a quiet study space, while a music group needs somewhere to rehearse. Both groups argue that their activities would benefit local residents. At a public meeting, Lena proposes dividing the timetable: quiet work during the day and rehearsals in the early evening. A resident who lives upstairs worries about noise, and a parent asks whether children would have access after school. Rather than vote immediately, the group agrees to collect information about likely demand and the building’s sound insulation. They will then test a temporary timetable and review complaints before making a permanent decision.', question:'Какие интересы сталкиваются в обсуждении? Почему предложенное расписание ещё не решает все проблемы? Объясни, какую информацию хотят собрать перед окончательным решением.'}
};
// Original fictional situations. Rotate the context as well as the task ID;
// reading and listening use different situations on the same day.
const MORE_SITUATIONS = {
 everyday:[
  {situation:'объяснить проблему с доставкой и договориться о решении',basic:'I ordered a chair. The box arrived today, but one leg is missing. I need the chair on Saturday. The shop can send the leg next week or collect the chair tomorrow. I want to ask if I can collect a leg from another shop.',text:'When the chair arrived, Leo had already invited six friends for dinner. He opened the box and found that one leg was missing. The customer service agent offered either a replacement part next week or a collection and refund tomorrow. Neither option would solve the problem before Saturday. Leo was about to complain when the agent mentioned a nearby branch. It had the same model on display but no boxed stock. Leo asked whether someone could check for spare parts before he traveled there. The agent agreed to call the branch and send a written update by four.'},
  {situation:'предложить другу новый способ поддерживать общую привычку',basic:'We want to walk together every morning. After three days, I am tired. My friend starts work early, but I start later. We can walk together twice a week. On other days, we can choose our own times.',text:'Nadia and her friend decided to walk together before work every day. The first week went well, but Nadia soon began canceling because her shifts changed. Her friend assumed she had lost interest. Instead of making another promise she could not keep, Nadia explained the problem and suggested two fixed mornings a week. On the other days, each of them could walk whenever their schedule allowed. They agreed to try this arrangement for a month without comparing distances. What mattered to them was having a routine they could sustain, rather than proving who was more disciplined.'}
 ],
 work:[
  {situation:'передать работу коллеге так, чтобы важные ограничения не потерялись',basic:'I am going on vacation tomorrow. My colleague will answer client emails. One client has a special price until Friday. I wrote this in a long chat. I need to put the important details in one short message.',text:'Before taking a week off, Priya sent her colleague a long chat history about a client. The colleague thanked her but asked which decisions were final. Some messages described early proposals that the client had later rejected. Priya realized that forwarding everything was not the same as handing over the work. She wrote a short note separating the confirmed price, the unresolved question and the next deadline. She also included a link to the signed agreement. Her colleague noticed that the special price expired on Friday, a detail that had been difficult to find in the original conversation.'},
  {situation:'обсудить неэффективную встречу и предложить проверяемое изменение',basic:'Our meeting lasts one hour. Most people only listen. We want to send updates before the meeting. Then we can use twenty minutes to discuss questions. We will try this next week.',text:'The team’s weekly meeting had gradually become a series of status reports. People listened politely, but difficult decisions were usually postponed because there was no time left. Omar proposed canceling the meeting. His manager worried that quieter colleagues would lose an opportunity to raise problems. They agreed on a smaller experiment: everyone would post a brief update beforehand, and the meeting would focus on questions that required discussion. At the end of two weeks, the team would ask whether decisions were happening faster and whether anyone felt less informed. A shorter meeting alone would not prove that communication had improved.'}
 ],
 travel:[
  {situation:'разобраться с изменением бронирования и вежливо уточнить условия',basic:'The hotel has changed our room. The new room is bigger, but it is next to a busy road. My father sleeps badly when there is noise. We want to ask for a quieter room or a different date.',text:'At the hotel desk, Eva was told that her original room was unavailable. The receptionist described the replacement as an upgrade because it was larger. Eva asked where it was located and learned that it faced a busy road. Her father was a light sleeper, so extra space mattered less than quiet. She explained this without accusing the receptionist of misleading her. There were no quieter rooms that night, but one might become available the following afternoon. Eva asked for the arrangement to be confirmed and for help moving their bags if they changed rooms.'},
  {situation:'выбрать между удобством маршрута и интересами разных путешественников',basic:'We have one free afternoon. I want to visit an old village. My brother wants to stay by the sea. The village is two hours away by bus. We decide to find a place closer to the coast.',text:'Three friends had one free afternoon before their flight home. Daniel wanted to visit a village he had seen in a photograph; his sister preferred a quiet meal by the sea. Their friend checked the bus timetable and discovered that the return service was limited. Nobody wanted the final afternoon to become a race to the airport. They looked for a smaller town closer to the coast instead. It would not offer the exact view Daniel had imagined, but it had an old center, places to eat and a direct connection to the airport. They chose a shared compromise rather than splitting up.'}
 ],
 culture:[
  {situation:'сравнить книгу с экранизацией без пересказа всего сюжета',basic:'In an imaginary book, a boy tells his own story. In the film, we see him through his sister’s eyes. The events are the same, but he seems less confident. I want to explain which version I prefer and why.',text:'In an imaginary novel, a young man describes the summer when he left home. His account makes every choice sound deliberate. A fictional film adaptation follows his younger sister instead. She sees him hesitate, borrow money and change his plans without explaining why. The main events remain similar, yet the character appears less certain of himself. One reviewer calls this a betrayal of the book; another argues that the film reveals what the narrator chose not to admit. Comparing the versions therefore requires more than checking which scenes were removed. The change of viewpoint affects whose explanation the audience is invited to trust.'},
  {situation:'обсудить решение куратора и предложить альтернативное описание экспоната',basic:'A small gallery shows an empty chair. The label gives the artist’s name, but it does not explain the work. Some visitors are confused. Others like making their own meaning. The gallery wants to add an optional longer label.',text:'A fictional gallery places an empty chair in the center of a room. The label gives only a title and the artist’s name. Some visitors enjoy deciding what the chair might represent. Others feel excluded because they suspect that everyone else knows an important background story. The curator proposes an optional longer label, available beside the entrance rather than directly below the work. A colleague worries that even an optional explanation could become the single accepted interpretation. They decide to include the artist’s context alongside two questions instead of presenting one definitive meaning. The label would offer a way in without promising a final answer.'}
 ],
 science:[
  {situation:'объяснить, почему новая информация ещё не доказывает популярное утверждение',basic:'A class asks twenty students about sleep. Students who play sport say they sleep well. One student says sport causes better sleep. Another asks if they should also ask about homework and bedtime. They have not measured these things yet.',text:'In a fictional class project, students ask twenty classmates about exercise and sleep. Those who report exercising more also tend to report better sleep. A draft headline says that exercise has solved the school’s sleep problem. Mina objects that the survey did not measure changes over time or ask about homework, stress or bedtime. She is not claiming that exercise has no effect. She wants the report to distinguish the pattern they observed from the explanation they have not tested. The group changes the headline and adds questions for a future project. A less dramatic claim can still describe an interesting finding.'},
  {situation:'предложить осторожное внедрение новой технологии с понятными критериями',basic:'A library wants a new search tool. The tool gives fast answers, but one answer has the wrong book title. The staff want to test it before using it with visitors. They will check both good and bad answers.',text:'An imaginary library is testing a tool that suggests books in response to readers’ questions. During a demonstration, it produces a convincing recommendation with an incorrect title. One staff member wants to abandon the trial; another says that a single mistake is not enough to judge the system. They agree to test a set of ordinary and difficult questions, record errors and check whether the suggested books actually exist. They also consider who would notice mistakes when the tool was busy. The decision will depend on reliability and the cost of checking, not just how impressive the demonstration looks.'}
 ],
 society:[
  {situation:'обсудить справедливый способ распределить ограниченные места',basic:'A free class has ten places and twenty people want to join. The organiser first suggests choosing the fastest replies. Some people cannot check email at work. The group considers a draw and a waiting list.',text:'A fictional community center receives twenty applications for a free class with ten places. The organiser proposes accepting the first ten replies, calling this the simplest fair rule. A volunteer points out that some applicants cannot check messages during work. Another suggests reserving places for people who have never attended, but nobody has reliable records. The group considers a random draw with a published waiting list. This would not make everyone happy, yet the decision could be explained in advance and applied consistently. They also discuss whether an extra session would address the shortage more effectively than finding a perfect selection rule.'},
  {situation:'представить общественное предложение, не выдавая частное мнение за согласие всех',basic:'A local group wants more bicycle parking. Ten people answer its online question. Eight agree. The group does not know what other residents think. It decides to ask people at the shops too.',text:'A fictional residents’ group posts an online question about replacing two parking spaces with bicycle stands. Eight of the ten replies support the proposal. The group’s draft letter says that the neighborhood is strongly in favour. Before sending it, Alice asks who saw the question and whether people who rarely use the group’s page had a chance to respond. She supports the bicycle stands but does not want to exaggerate the evidence. They revise the letter to report the actual responses, explain their reasons separately and invite wider feedback. Supporting a proposal does not require pretending that disagreement has disappeared.'}
 ]
};
const arr = value => Array.isArray(value) ? value : [];
const obj = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const safeId = value => typeof value === 'string' && /^[A-Za-z0-9_-]{1,180}$/.test(value);
const number = value => Number.isFinite(Number(value)) ? Number(value) : 0;
const validTime = value => typeof value === 'string' && value.trim() ? Date.parse(value) : NaN;
const dayKey = date => `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
const dayAt = value => Number.isFinite(validTime(value)) ? dayKey(new Date(value)) : '';
const nowDate = value => {const d = new Date(value); return Number.isFinite(d.getTime()) ? d : new Date(0);};
const baseExercise = id => String(id || '').replace(/--[a-f0-9]{16}$/i, '');
const contentKey = value => {let hash=2166136261;for(const char of value){hash^=char.codePointAt(0);hash=Math.imul(hash,16777619);}return (hash>>>0).toString(16).padStart(8,'0');};
const isAnswer = a => a && typeof a.answer === 'string' && a.answer.trim() && Number.isFinite(validTime(a.at));
const includesLevel = (value, level) => {const n = (String(value).match(/[ABC][12]/g)||[]).map(v=>LEVELS.indexOf(v)); return n.length > 0 && LEVELS.indexOf(level) >= Math.min(...n) && LEVELS.indexOf(level) <= Math.max(...n);};

function identity(a) {
 let lessonId = String(a?.lessonId || ''), exerciseId = baseExercise(a?.exerciseId);
 // The original server stores book answers through the free-practice endpoint.
 if (lessonId === 'free') {const m = exerciseId.match(/^(book-.+-\d{3})-(.+)$/); if (m) {lessonId=m[1]; exerciseId=m[2];}}
 return {lessonId, exerciseId, key:JSON.stringify([lessonId, exerciseId])};
}
function latestAnswers(attempts, day) {
 const latest = new Map();
 for (const a of arr(attempts)) {
  if (!isAnswer(a) || (day && dayAt(a.at) !== day)) continue;
  const id = identity(a); if (!id.lessonId || !id.exerciseId) continue;
  const old = latest.get(id.key);
  if (!old || validTime(a.at) >= validTime(old.at)) latest.set(id.key, a);
 }
 return latest;
}
function marked(entry, day) {
 return entry === true || (entry?.done === true && (!entry.at || dayAt(entry.at) === day));
}
function exerciseList(lesson) {return arr(lesson?.exercises).filter(e=>safeId(e?.id));}
function lessonWork(lesson, latest) {
 const all = exerciseList(lesson), submitted = all.map(e=>latest.get(JSON.stringify([lesson.id,baseExercise(e.id)]))).filter(Boolean);
 const covered=all.length>0&&submitted.length===all.length;
 return {started:submitted.length>0,covered,done:covered&&submitted.filter(a=>a.feedback?.verdict==='correct').length>=Math.ceil(all.length*.8)};
}
function bookWork(id, latest, data) {
 const submitted = [...latest.values()].filter(a=>identity(a).lessonId === 'book-'+id);
 const saved=Array.isArray(data.bookLessons)?data.bookLessons.find(l=>l?.id==='book-'+id):data.bookLessons?.[id]||data.bookLessons?.['book-'+id];
 const exerciseIds=exerciseList(saved).map(e=>e.id).concat(arr(data.bookStatus?.units?.[id]?.exerciseIds)).filter(safeId);
 const ids=[...new Set(exerciseIds.map(baseExercise))];
 const matching=submitted.filter(a=>ids.includes(identity(a).exerciseId));
 // Metadata alone has no complete exercise list. Never infer completion from a read flag.
 const covered=ids.length>0&&matching.length===ids.length;
 return {started:submitted.length>0,covered,done:covered&&matching.filter(a=>a.feedback?.verdict==='correct').length>=Math.ceil(ids.length*.8),exerciseIds:ids};
}
function topicFor(data, level) {
 const latest = latestAnswers(data.state?.attempts), availableLessons=arr(data.lessons).filter(l=>safeId(l?.id) && exerciseList(l).length);
 const order = arr(data.learningPath?.levels).find(l=>l?.id===level)?.lessonIds || [];
 const byId = new Map(availableLessons.map(l=>[l.id,l]));
 const lessons = [...new Set([...arr(order),...availableLessons.filter(l=>includesLevel(l.level,level)).map(l=>l.id)])].map(id=>byId.get(id)).filter(l=>l && includesLevel(l.level,level) && !/extended-|cinema-|reading|listening|writing|speaking|pronunciation|vocab|narrative|essay|rhetorical|literary|lecture|discourse-listening/.test(l.id));
 const candidates=[], seen=new Set();
 for (const book of arr(data.library?.books)) {
  if(!book)continue;
  if (book.duplicateOf || !includesLevel(book.level,level) || !String(book.id).startsWith('grammar-')) continue;
  for (const unit of arr(book.units)) {
   if(!unit)continue;
   const id=unit.equivalentUnitId||unit.id;
   if (!safeId(id) || seen.has(id) || data.bookStatus?.units?.[id]?.status !== 'ready') continue;
   seen.add(id);const work=bookWork(id,latest,data);if(!work.covered)candidates.push({id:'book-'+id, title:String(unit.title||book.title||'Тема учебника'), href:'#/unit/'+id, book:true, ...work});
  }
 }
 const known = lessons.map(l=>({id:l.id,title:String(l.title||'Занятие'),href:'#/lesson/'+l.id,lesson:l,...lessonWork(l,latest)})).filter(l=>!l.covered);
 // Continue an actual submitted exercise before opening a different topic.
 const chosen = candidates.find(l=>l.started) || known.find(l=>l.started) || candidates[0] || known[0];
 if (!chosen) return null;
 const sourceIds=chosen.book?chosen.exerciseIds:exerciseList(chosen.lesson).map(e=>e.id);
 const ids=sourceIds.filter(id=>!latest.has(JSON.stringify([chosen.id,baseExercise(id)])));
 return {...chosen,exerciseIds:ids.length?ids:sourceIds};
}

function matchingMaterials(lesson,exercise,skill) {
 return arr(lesson?.materials).filter(m=>arr(exercise?.materialIds).includes(m.id)&&(skill==='reading'?m.kind==='reading':['listening','dialogue'].includes(m.kind)||m.inputSkill==='listening'));
}
function inputExercises(lesson,skill) {
 return exerciseList(lesson).filter(e=>['write','speak'].includes(e.kind)&&!/^Открой «Медиатеку»/.test(e.prompt||'')&&(!arr(lesson.materials).length||matchingMaterials(lesson,e,skill).length));
}
function inputLesson(data,level,skill,domain) {
 const candidates=arr(data.lessons).filter(l=>safeId(l?.id)&&includesLevel(l.level,level)&&exerciseList(l).length).filter(l=>{
  if(arr(l.materials).length)return inputExercises(l,skill).length;
  if(l.id.startsWith('cinema-')) return domain==='culture'&&skill==='listening'&&l.id.endsWith('-listen');
  return skill==='reading'?/reading|rhetorical-analysis/.test(l.id):/listening/.test(l.id);
 }).filter(l=>inputExercises(l,skill).length);
 const latest=latestAnswers(data.state?.attempts);
 const records=candidates.map(l=>({lesson:l,...lessonWork({...l,exercises:inputExercises(l,skill)},latest),last:Math.max(0,...[...latest.values()].filter(a=>identity(a).lessonId===l.id).map(a=>validTime(a.at)))}));
 records.sort((a,b)=>Number(a.covered)-Number(b.covered)||Number(b.started)-Number(a.started)||Number(arr(b.lesson.materials).some(m=>m.inputSkill===skill))-Number(arr(a.lesson.materials).some(m=>m.inputSkill===skill))||Number(arr(b.lesson.materials)[0]?.kind===skill)-Number(arr(a.lesson.materials)[0]?.kind===skill)||Number(arr(b.lesson.materials).length>0)-Number(arr(a.lesson.materials).length>0)||(domain==='culture'?Number(b.lesson.id.startsWith('cinema-'))-Number(a.lesson.id.startsWith('cinema-')):0)||a.last-b.last);
 const lesson=records[0]?.lesson;if(!lesson)return null;
 const ids=inputExercises(lesson,skill).filter(e=>!latest.has(JSON.stringify([lesson.id,baseExercise(e.id)]))).map(e=>e.id);
 return {lesson,exerciseIds:ids.length?ids:inputExercises(lesson,skill).map(e=>e.id)};
}

function metadata(data) {
 return {lessons:new Map(arr(data.lessons).filter(l=>l?.id).map(l=>[l.id,l])), topics:new Map(arr(data.research?.topics).filter(t=>t?.id).map(t=>[t.id,t]))};
}
function answerSkills(a, meta) {
 const {lessonId,exerciseId}=identity(a), result=new Set(), l=meta.lessons.get(lessonId), e=exerciseList(l).find(e=>baseExercise(e.id)===exerciseId);
 if(lessonId==='conversation'){if(a.mode==='writing')result.add('writing');}
 else if(lessonId.startsWith('project-')){if(['reading','listening','writing'].includes(exerciseId))result.add(exerciseId);if(exerciseId==='mediation'||exerciseId==='revision'||exerciseId==='transfer')result.add('writing');}
 else if (lessonId.startsWith('book-grammar-')) result.add('grammar');
 else if (/^book-(vocabulary|collocations|phrasal)-/.test(lessonId)) result.add('vocabulary');
 else if (lessonId==='pronunciation') result.add('pronunciation');
 else if (lessonId==='research') {
  const skill=meta.topics.get(exerciseId)?.skill;
  if (SKILLS.includes(skill) && skill!=='speaking') result.add(skill);
  if ((skill==='speaking'||skill==='interaction') && a.mode!=='speaking') result.add('writing');
  } else if (lessonId==='free') {
   const transfer=transferIdentity(a);if(transfer?.stage==='recall'){
    const origin=meta.lessons.get(transfer.lessonId),text=[transfer.lessonId,origin?.group,origin?.title].join(' ').toLowerCase();
    if(/^book-(vocabulary|collocations|phrasal)-/.test(transfer.lessonId)||/vocab|collocation|phrasal|лексик|словар/.test(text))result.add('vocabulary');
    else if(/^book-grammar-/.test(transfer.lessonId)||/grammar|граммат/.test(text))result.add('grammar');
   }
  if(exerciseId.startsWith('lexicon-'))result.add('vocabulary');
  const prefix=exerciseId.match(/^(reading|listening|vocabulary|translation|writing|speaking)-/)?.[1];
  if (prefix==='translation') result.add('grammar');
  else if (prefix==='speaking') {if(a.mode!=='speaking') result.add('writing');}
  else if (prefix) result.add(prefix);
  if (a.mode==='speaking'&&/^speaking-daily-\d{4}-\d{2}-\d{2}-pronunciation(?:-[a-f0-9]{8})?$/.test(exerciseId)) result.add('pronunciation');
 } else if (l) {
  if(matchingMaterials(l,e,'reading').length)result.add('reading');
  if(matchingMaterials(l,e,'listening').length)result.add('listening');
  const text=[l.id,l.group,l.title].join(' ').toLowerCase();
  if (/listening|аудирован|cinema-.+-listen/.test(text)) result.add('listening');
  else if (/reading|чтени/.test(text)) result.add('reading');
  else if (/vocab|collocation|phrasal|лексик|словар|словосочет/.test(text)) result.add('vocabulary');
  else if (/pronunciation|произнош|фонет/.test(text)) result.add('pronunciation');
  else if (!/^(extended|natural|sustained)-/.test(l.id)&&!/cinema-|writing|speaking|письм|устн/.test(text)) result.add('grammar');
  if (e?.kind==='write') result.add('writing');
 }
 if (a.mode==='speaking') result.add('speaking');
 // A typed response to a speaking prompt is written rehearsal, not voice evidence.
 if (a.mode==='writing' && (lessonId==='free'||e?.kind==='speak')) result.add('writing');
 return result;
}

/** Seven local calendar days; counts are practice events, never CEFR mastery. */
export function weeklySummary(data={}, now=new Date(), manualDays={}) {
 data=obj(data); const state=obj(data.state||data), date=nowDate(now), meta=metadata(data);
 const days=Array.from({length:7},(_,i)=>{const d=new Date(date.getFullYear(),date.getMonth(),date.getDate()-6+i);return {day:dayKey(d),minutes:0,attempts:0,reviews:0,cards:0,skills:Object.fromEntries(SKILLS.map(id=>[id,{count:0,manual:0}]))};});
 for (const day of days) {
  const latest=latestAnswers(state.attempts,day.day); day.attempts=latest.size;
  const skillTasks=Object.fromEntries(SKILLS.map(id=>[id,new Set()]));
  for (const a of arr(state.attempts)) if(isAnswer(a)&&dayAt(a.at)===day.day) for(const skill of answerSkills(a,meta)) skillTasks[skill].add(identity(a).key);
  for(const skill of SKILLS) day.skills[skill].count=skillTasks[skill].size;
  day.reviews=new Set(arr(state.reviews).filter(r=>typeof r?.cardId==='string' && r.cardId && dayAt(r.at)===day.day).map(r=>r.cardId)).size;
  day.cards=new Set(arr(state.cards).filter(c=>typeof c?.id==='string' && c.id && dayAt(c.created)===day.day).map(c=>c.id)).size;
  day.skills.vocabulary.count+=day.reviews+day.cards;
  day.minutes=Math.floor(Math.max(0,number(state.activity?.[day.day]))/60);
  const saved=manualDays?.[day.day];
  if (saved?.plan?.day===day.day) for (const block of arr(saved.plan.blocks)) {
   const skill=block.skill==='review'?'vocabulary':block.skill;
   if (day.skills[skill] && marked(saved.manual?.[block.id],day.day)) day.skills[skill].manual++;
  }
 }
 const skills=SKILLS.map(id=>({id,label:LABELS[id],count:days.reduce((sum,d)=>sum+d.skills[id].count,0),days:days.filter(d=>d.skills[id].count>0).length,manualCount:days.reduce((sum,d)=>sum+d.skills[id].manual,0),manualDays:days.filter(d=>d.skills[id].manual>0).length,lastDay:[...days].reverse().find(d=>d.skills[id].count||d.skills[id].manual)?.day||null}));
 const ranked=[...skills].sort((a,b)=>(a.days+a.manualDays*.5)-(b.days+b.manualDays*.5)||(a.count+a.manualCount*.5)-(b.count+b.manualCount*.5)||WEAK_ORDER.indexOf(a.id)-WEAK_ORDER.indexOf(b.id));
 return {from:days[0].day,to:days[6].day,days,skills,totals:{attempts:days.reduce((n,d)=>n+d.attempts,0),reviews:days.reduce((n,d)=>n+d.reviews,0),cards:days.reduce((n,d)=>n+d.cards,0),minutes:days.reduce((n,d)=>n+d.minutes,0),activeDays:days.filter(d=>d.minutes||d.attempts||d.reviews||d.cards||Object.values(d.skills).some(s=>s.manual)).length},weakSkills:ranked.map(s=>s.id),recommendations:ranked.slice(0,3).map((s,i)=>({skill:s.id,title:LABELS[s.id],reason:s.count===0?(s.manualCount?'Есть твои отметки, но пока нет сохранённых ответов за неделю.':'За семь дней нет сохранённой практики этого навыка.'):`Практика сохранена в ${s.days} из 7 дней. Добавь короткое занятие для баланса.`,priority:i+1}))};
}

function recentErrors(state,date) {
 const cutoff=date.getTime()-7*86400000;
 return [...latestAnswers(state.attempts).values()].filter(a=>validTime(a.at)>=cutoff && validTime(a.at)<=date.getTime() && ['incorrect','partial'].includes(a.feedback?.verdict)).sort((a,b)=>validTime(b.at)-validTime(a.at));
}
function durations(skills,minutes,weak) {
 const weights={grammar:4,vocabulary:3,reading:3,listening:4,speaking:4,writing:4,pronunciation:2,review:2};
 const result=Object.fromEntries(skills.map(s=>[s,5])); let left=minutes-skills.length*5;
 while(left>=5) {
  const choice=skills.filter(s=>s!=='review'||result[s]<20).sort((a,b)=>result[a]/(weights[a]+(weak.slice(0,2).includes(a)?1:0))-result[b]/(weights[b]+(weak.slice(0,2).includes(b)?1:0))||skills.indexOf(a)-skills.indexOf(b))[0];
  result[choice]+=5; left-=5;
 }
 return result;
}
function practice(block,day,level,mode,prompt,passage='') {
 const task={id:`daily-${day}-${block.id}-${contentKey(JSON.stringify([mode,level,prompt,passage]))}`,title:block.title,prompt,passage,level,mode};
 return {...block,href:`#/practice/${mode}/${day}/${block.id}`,practiceTask:task,target:{kind:'attempts',count:1,lessonIds:['free'],exerciseIds:[`${mode}-${task.id}`],...(mode==='speaking'?{mode:'speaking'}:{})}};
}

/** Construct once and persist; progress is always evaluated against this snapshot. */
export function createDailyPlan(data={},options={},now=new Date()) {
 data=obj(data); options=obj(options); const date=nowDate(now),day=dayKey(date),state=obj(data.state),chosenLevel=String(options.level||'B1').toUpperCase();
 const level=LEVELS.includes(chosenLevel)?chosenLevel:'B1',requested=number(options.minutes)||120;
 const minutes=BUDGETS.reduce((best,m)=>Math.abs(m-requested)<Math.abs(best-requested)?m:best,30),domain=Object.hasOwn(DOMAINS,options.domain)?options.domain:'everyday';
 const seed=Math.floor(Date.UTC(date.getFullYear(),date.getMonth(),date.getDate())/86400000),situations=[DOMAINS[domain],...MORE_SITUATIONS[domain]],rotation=((seed%situations.length)+situations.length)%situations.length;
 const context={...DOMAINS[domain],...situations[rotation]},heard={...DOMAINS[domain],...situations[(rotation+1)%situations.length]};
 const weekly=weeklySummary(data,date,options.manualDays),weak=weekly.weakSkills,topic=topicFor(data,level),errors=recentErrors(state,date);
 const due=arr(state.cards).filter(c=>typeof c?.id==='string' && c.id && Number.isFinite(validTime(c.due)) && validTime(c.due)<=date.getTime()).sort((a,b)=>validTime(a.due)-validTime(b.due)||a.id.localeCompare(b.id));
 const input=weak.find(s=>['reading','listening'].includes(s))||'listening',output=weak.find(s=>['speaking','writing'].includes(s))||'speaking';
 let selected;
 if(minutes>=90) selected=['review',...SKILLS];
 else if(minutes===60) {selected=['grammar','vocabulary',input,output];for(const s of [...(due.length||errors.length?['review']:[]),...weak]) if(selected.length<6&&!selected.includes(s)) selected.push(s);}
 else selected=[input,output,due.length||errors.length?'review':weak.find(s=>!['reading','listening','speaking','writing'].includes(s))||'vocabulary'];
 const order=['review','grammar','reading','listening','vocabulary','pronunciation','speaking','writing']; selected.sort((a,b)=>order.indexOf(a)-order.indexOf(b));
 const allocated=durations(selected,minutes,weak),basic=LEVELS.indexOf(level)<2,advanced=LEVELS.indexOf(level)>3;
 const complexity=basic?'Напиши 4–6 простых предложений.':advanced?'Развёрнуто обоснуй позицию, учти альтернативное объяснение и ограничения своих выводов. Используй точный регистр и связность.':'Напиши связный ответ на 80–130 слов; объясни причины и приведи конкретный пример.';
 const blocks=selected.map(skill=>{
  const block={id:skill,skill,title:LABELS[skill],instruction:'',why:'',minutes:allocated[skill],href:'#/review',target:{kind:'manual',count:1}};
  if(skill==='grammar') {
   block.title=topic?topic.title:'Конструкция в собственной мысли';block.instruction=topic?'Разбери одну тему. Закрой примеры, напиши свои полные ответы, затем прочитай проверку и объясни себе исправление. Одно прочтение не завершает практику.':'Переведи свои мысли полными предложениями и объясни выбор времени.';
   block.why=topic?.started?'Продолжаем тему с твоими ответами. Ошибки показывают, что стоит доработать.':'Одна новая тема за день оставляет время применить её в речи и письме.';
   if(topic) return {...block,href:topic.href,target:{kind:'attempts',count:Math.min(3,topic.exerciseIds.length||3),lessonIds:[topic.id],...(topic.exerciseIds.length?{exerciseIds:topic.exerciseIds}:{})}};
   return practice(block,day,level,'translation',`Тема: ${context.label}. Напиши три разные мысли по-русски о том, как ${context.situation}, затем переведи их на английский полными предложениями. Объясни на русском выбор одной конструкции. Не подставляй отдельные слова.`);
  }
  if(skill==='reading'||skill==='listening') {
   const prepared=inputLesson(data,level,skill,domain);
   if(prepared) {
    const first=exerciseList(prepared.lesson).findIndex(e=>e.id===prepared.exerciseIds[0])+1;
    return {...block,title:prepared.lesson.title,instruction:`В практике начни с задания ${first}. `+(skill==='reading'?'Прочитай учебный фрагмент, закрой опору и ответь своими словами. Разделяй прямые утверждения, выводы и то, что остаётся неизвестным.':'Сначала прослушай учебные примеры или текст без расшифровки, затем проверь детали и сохрани собственный ответ. Для живой речи используй свой фрагмент в медиатеке.'),why:'Подготовленная практика твоего уровня включает учебные фрагменты и собственный ответ. Перевод вводных фраз сам по себе этот блок не закрывает.',href:'#/lesson/'+prepared.lesson.id+'/'+(first-1),target:{kind:'attempts',count:Math.min(2,prepared.exerciseIds.length),lessonIds:[prepared.lesson.id],exerciseIds:prepared.exerciseIds}};
   }
   block.title=skill==='reading'?'Прочитать и понять позицию':'Услышать и восстановить смысл';
   block.instruction=skill==='reading'?'Прочитай учебную ситуацию целиком, закрой текст и сформулируй ответ своими словами. Затем проверь детали.':'Дважды прослушай учебный текст: сначала без расшифровки, затем проверь детали. Сохрани пересказ; для живой речи добавь короткую сцену в медиатеке.';
   block.why=skill==='reading'?'Чтение проверяется через собственное объяснение, а не узнавание знакомой фразы.':'Здесь синтез речи. Сохранённый ответ подтверждает практику пересказа, а не качество слуха.';
   const situation=skill==='listening'?heard:context;
   return practice(block,day,level,skill,`Учебная вымышленная ситуация: ${situation.label}. ${basic?'Кто участвует, какая возникла проблема и что герои решили сделать?':'Выдели проблему, сравни рассмотренные варианты и объясни итоговое решение. Что сказано прямо, а что можно только предположить?'} Ответь по-английски своими словами. ${complexity}`,basic?situation.basic:situation.text);
  }
  if(skill==='writing') {
   block.title='Написать с целью и адресатом';block.instruction='Сначала напиши свою версию без подсказки. После проверки сравни формулировки и перепиши самый слабый фрагмент.';
   block.why='Письмо переносит тему в сообщение, где смысл, регистр и связность важнее отдельного правильного слова.';
   return practice(block,day,level,'writing',`Тема: ${context.label}. Твоя задача — ${context.situation}. Напиши сообщение человеку с другой точкой зрения: объясни ситуацию, предложи решение и задай уточняющий вопрос. ${topic?`Попробуй осмысленно применить материал «${topic.title}», если он подходит.`:''} ${complexity}`);
  }
  if(skill==='speaking') {
   block.title='Сказать, возразить, переформулировать';block.instruction='Ответь голосом без готового текста, прослушай запись и повтори неудачную мысль иначе. Для автоматической отметки отправь ответ через микрофон; разговор вне приложения отметь вручную.';
   block.why='Самостоятельная устная речь требует извлекать выражения в момент разговора. Печатный ответ остаётся письменной репетицией.';
   return practice(block,day,level,'speaking',`Тема: ${context.label}. Ролевая ситуация: тебе нужно ${context.situation}. Говори ${basic?'30–60 секунд':'1–2 минуты'}: изложи предложение, представь возражение собеседника и ответь на него. В конце задай открытый вопрос. ${advanced?'Смягчи несогласие и уточни, при каких условиях готов изменить позицию.':'Если забыл слово, объясни его другими словами.'}`);
  }
  if(skill==='vocabulary') {
   block.title='Выражения, которые пригодятся тебе';block.instruction=`Выбери ${Math.min(5,Math.max(3,Math.floor(block.minutes/3)))} полезных выражения из сегодняшнего материала (${context.label}) или контекстного словаря. Разбери значение, скрой английский и сформулируй свою ситуацию. Сохрани карточки: ситуация по-русски → фраза по-английски.`;
   block.why='Фразы с контекстом легче использовать в своих сообщениях и разговорах.';
   return {...block,href:'#/lexicon',target:{kind:'cards',count:Math.min(5,Math.max(3,Math.floor(block.minutes/3)))}};
  }
  if(skill==='pronunciation') {
   const candidates=arr(data.pronunciation?.lessons).filter(l=>safeId(l?.id) && includesLevel(l.level,level)),all=arr(data.pronunciation?.lessons).filter(l=>safeId(l?.id));
   const pool=candidates.length?candidates:all,latest=latestAnswers(state.attempts),lesson=pool.find(l=>!latest.has(JSON.stringify(['pronunciation',l.id])))||pool[Number(day.replaceAll('-',''))%Math.max(1,pool.length)];
   block.title=lesson?`Произношение: ${lesson.title}`:'Ударение и связная речь';block.instruction='Послушай образец, повтори и запиши себя. Сравни один звук, ударение или интонацию. Сохрани письменное наблюдение о том, что изменил.';
   block.why='Автоматическая отметка здесь означает сохранённое наблюдение; она не оценивает точность звучания.';
   return lesson?{...block,href:'#/pronunciation/'+lesson.id,target:{kind:'attempts',count:1,lessonIds:['pronunciation'],exerciseIds:[lesson.id]}}:practice({...block,instruction:'Прослушай синтез речи в учебном тексте, повтори три фразы, запиши себя и сравни ударение. Отметь выполненную работу вручную.'},day,level,'speaking',`Прочитай эти фразы вслух, затем произнеси их по памяти. Выдели смысловые ударения и сравни свой вариант с озвучиванием: ${context.basic}`);
  }
  block.title=due.length?'Вспомнить до подсказки':errors.length?'Вернуться к недавним ошибкам':'Вернуться к материалу после паузы';
  block.why='Повторение ограничено по времени. Закрытая подсказка заставляет самостоятельно восстановить фразу.';
  if(due.length) {const ids=[...new Set(due.map(c=>c.id))].slice(0,Math.min(20,block.minutes));return {...block,instruction:`Повтори карточки, срок которых наступил: ${ids.length}. Ответь до переворота и оцени, что удалось вспомнить. Остальной долг можно оставить на другой день.`,target:{kind:'reviews',count:ids.length,cardIds:ids}};}
  if(errors.length) {
   // Keep one destination: the user can revisit these questions in the same lesson.
   const first=identity(errors[0]),same=errors.filter(a=>identity(a).lessonId===first.lessonId).slice(0,3),bookId=first.lessonId.startsWith('book-')?first.lessonId.slice(5):'';
   const href=bookId&&data.bookStatus?.units?.[bookId]?.status==='ready'&&safeId(bookId)?'#/unit/'+bookId:arr(data.lessons).some(l=>l.id===first.lessonId)&&safeId(first.lessonId)?'#/lesson/'+first.lessonId:null;
   if(href) return {...block,href,instruction:`Вернись к ${same.length} недавним ответам с ошибкой. Снова сформулируй ответ самостоятельно и отправь на проверку. Новая попытка считается практикой, даже если ещё требует исправления.`,target:{kind:'corrections',count:same.length,tasks:same.map(a=>({...identity(a),after:a.at})),lessonIds:[first.lessonId]}};
   return practice({...block,instruction:'Прочитай свою прошлую задачу и ответ. Закрой проверку и заново вырази мысль по-английски. В конце объясни одно исправление.'},day,level,'writing','Перепиши свой предыдущий ответ самостоятельно, исправляя его смысл и форму. Не копируй эталон. Затем кратко объясни, что изменил.',`Предыдущая задача: ${String(errors[0].prompt||'Свободный ответ').slice(0,900)}\nТвой предыдущий ответ: ${String(errors[0].answer).slice(0,1500)}`);
  }
  block.instruction='Срочных карточек нет. После другого блока закрой материал и восстанови три сегодняшние фразы. Сверь их только после своей попытки; завершение отметь вручную.';
  return {...block,href:topic?.href||'#/review'};
 });
 const transfer=transferQueue(data,date,{limit:1}).due[0];
 if(transfer){
  const allowance=Math.max(5,Math.min(15,Math.floor(minutes*.15/5)*5));let remaining=allowance;
  for(const donor of [...blocks].sort((a,b)=>b.minutes-a.minutes)){const take=Math.min(remaining,Math.max(0,donor.minutes-5));donor.minutes-=take;remaining-=take;if(!remaining)break;}
  const budget=allowance-remaining;
  if(budget)blocks.unshift({id:'transfer',skill:transfer.next==='speak'?'speaking':'writing',title:'Вернуть тему в свою речь',instruction:`«${transfer.title}»: ${transfer.next==='recall'?'объясни назначение по памяти и приведи свои примеры':transfer.next==='speak'?'примени в новой устной ситуации':transfer.next==='revise'?'переработай полный ответ после разбора':'напиши своё сообщение'}. Следующие шаги можно пройти за несколько подходов.`,why:'Тема возвращается после паузы в собственные сообщения. Засчитывается конкретный сохранённый ответ; прочтение и время не выполняют перенос.',minutes:budget,href:'#/transfer/'+transfer.lessonId,target:{kind:'transfer',count:1,lessonId:transfer.lessonId,anchorAt:transfer.anchorAt,round:transfer.round,stage:transfer.next}});
 }
 return {version:1,day,createdAt:date.toISOString(),level,minutes,domain,blocks};
}

function attemptMatches(a,spec) {
 const id=identity(a);
 if(arr(spec.lessonIds).length&&!spec.lessonIds.includes(id.lessonId)) return false;
 if(arr(spec.exerciseIds).length&&!spec.exerciseIds.some(e=>baseExercise(e)===id.exerciseId)) return false;
 if(spec.mode && a.mode!==spec.mode) return false;
 return true;
}
/** Automatic current is evidence only; a self-report can mark done without changing it. */
export function dailyPlanProgress(plan={},state={},manual={}) {
 plan=obj(plan);state=obj(state);const day=plan.day,validDay=typeof day==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(day);
 const answers=validDay?[...latestAnswers(state.attempts,day).values()]:[];
 const blocks=arr(plan.blocks).map(block=>{
  const spec=obj(block.target),target=Math.max(1,Math.floor(number(spec.count)||1));let current=0;
  if(spec.kind==='transfer'&&validDay)current=transferTargetEvidence(spec,state,day);
  else if(spec.kind==='attempts'&&validDay) current=latestAnswers(arr(state.attempts).filter(a=>attemptMatches(a,spec)),day).size;
  else if(spec.kind==='corrections') {
   const matched=new Set();
   for(const task of arr(spec.tasks)) for(const a of answers) {const id=identity(a);if(id.lessonId===task.lessonId&&id.exerciseId===baseExercise(task.exerciseId)&&validTime(a.at)>validTime(task.after)) matched.add(id.key);}
   current=matched.size;
  } else if(spec.kind==='reviews'&&validDay) current=new Set(arr(state.reviews).filter(r=>r?.cardId&&dayAt(r.at)===day&&(!arr(spec.cardIds).length||spec.cardIds.includes(r.cardId))).map(r=>r.cardId)).size;
  else if(spec.kind==='cards'&&validDay) current=new Set(arr(state.cards).filter(c=>c?.id&&dayAt(c.created)===day&&(!arr(spec.cardIds).length||spec.cardIds.includes(c.id))).map(c=>c.id)).size;
  const automatic=current>=target,selfReport=validDay&&marked(manual?.[block.id],day);
  return {...block,targetSpec:spec,current,target,done:automatic||selfReport,automatic,manual:selfReport};
 });
 const done=blocks.filter(b=>b.done).length,total=blocks.length;
 return {blocks,done,total,percent:total?Math.round(done/total*100):0,completedMinutes:blocks.filter(b=>b.done).reduce((n,b)=>n+Math.max(0,number(b.minutes)),0),next:blocks.find(b=>!b.done)||null};
}
