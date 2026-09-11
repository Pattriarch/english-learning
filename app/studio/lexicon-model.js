import {esc} from './core.js';
export function highlightLexicon(text,spans=[]){
 const boundary=i=>i<=0||i>=text.length||!(text.charCodeAt(i-1)>=0xD800&&text.charCodeAt(i-1)<=0xDBFF&&text.charCodeAt(i)>=0xDC00&&text.charCodeAt(i)<=0xDFFF);
 let end=0,html='';for(const span of spans){if(!Number.isInteger(span.start)||!Number.isInteger(span.end)||span.start<end||span.end<=span.start||span.end>text.length||!boundary(span.start)||!boundary(span.end)||text.slice(span.start,span.end)!==span.text)return esc(text);html+=esc(text.slice(end,span.start))+'<mark>'+esc(span.text)+'</mark>';end=span.end;}return html+esc(text.slice(end));
}
export const lexiconStateKey=id=>'lexicon:state:'+id;
export const lexiconAnswerKey=(id,contextId)=>'lexicon:answer:'+id+':'+contextId;
export const lexicalFeedbackReceiptKey=id=>'lexicon:feedback:'+id;
export function lexicalPracticeSpec(entry,context,ru,level){
 return{lessonId:'free',exerciseId:`lexicon-${entry.id}-${context.id}`,level,
  prompt:context.productionTask||`Use “${entry.word}” in the same sense as the source example in an original message of two or three sentences. Identify the intended recipient and purpose.`,
  context:'Target variety: American English. Target: '+entry.word+'\nSource example: '+context.en+'\nMeaning and explanation: '+ru+'\n'+(context.explanation||'')+lexicalGuideNote(context)};
}
export const lexicalPracticeSignature=spec=>JSON.stringify([1,spec.lessonId,spec.exerciseId,spec.level,spec.prompt,spec.context]);
export async function lexicalPracticeFingerprint(signature){
 const bytes=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(signature));
 return [...new Uint8Array(bytes)].map(byte=>byte.toString(16).padStart(2,'0')).join('');
}
export function lexicalFeedbackMatches(attempt,answer,spec,fingerprint,rawReceipt){
 if(!attempt?.id||attempt.lessonId!==spec.lessonId||attempt.exerciseId!==spec.exerciseId||attempt.prompt!==spec.prompt||attempt.answer!==answer.trim())return false;
 try{const receipt=JSON.parse(rawReceipt);return receipt?.version===1&&receipt.attemptId===attempt.id&&receipt.fingerprint===fingerprint;}catch{return false;}
}
export const lexicalImageURL=image=>/^\/assets\/vocabulary-scenes\/[a-z0-9-]+\.png$/.test(image?.src||'')?image.src:'';
export const lexicalSourceURL=source=>/^https:\/\//.test(source?.url||'')?source.url:'';
export function parseLexicalState(raw){try{const x=JSON.parse(raw);return x?.version===1&&['new','learning','known'].includes(x.status)?x:{version:1,status:'new'};}catch{return{version:1,status:'new'};}}
export function lexicalProgress(drafts){const seen=new Set();let known=0,learning=0;for(const [key,value]of Object.entries(drafts||{})){if(!key.startsWith('lexicon:state:')||seen.has(key))continue;seen.add(key);const x=parseLexicalState(typeof value==='string'?value:value.text);if(x.status==='known')known++;else if(x.status==='learning')learning++;}return{known,learning};}
export function lexicalLinkedSense(entry,context){return typeof context?.senseId==='string'?entry.senses?.find(s=>s.id===context.senseId)||null:null;}
export function lexicalPreparedContext(entry,context){
 const sense=lexicalLinkedSense(entry,context);
 return !context?.excludedFromStudy&&typeof context?.ru==='string'&&!!context.ru.trim()&&['context-reviewed','ai-context-reviewed'].includes(context.quality)&&typeof context.senseId==='string'&&!!context.senseId.trim()&&typeof sense?.definition==='string'&&!!sense.definition.trim();
}
const lexicalText=value=>typeof value==='string'?value.trim():'';
export function lexicalContextGuide(context={}){
 return{
  meaningRu:lexicalText(context.meaningRu),
  explanation:lexicalText(context.explanation),
  usageNotes:Array.isArray(context.usageNotes)?context.usageNotes.map(lexicalText).filter(Boolean):[],
  collocations:Array.isArray(context.collocations)?context.collocations.filter(item=>lexicalText(item?.text)).map(item=>({text:lexicalText(item.text),ru:lexicalText(item.ru)})):[],
  commonMistakes:Array.isArray(context.commonMistakes)?context.commonMistakes.filter(item=>lexicalText(item?.wrong)&&lexicalText(item?.correct)&&lexicalText(item?.why)).map(item=>({wrong:lexicalText(item.wrong),correct:lexicalText(item.correct),why:lexicalText(item.why)})):[],
  productionTask:lexicalText(context.productionTask),
 };
}
export function lexicalFullAnalysis(entry,context){
 const guide=lexicalContextGuide(context);
 return lexicalPreparedContext(entry,context)&&!!guide.meaningRu&&!!guide.explanation&&guide.usageNotes.length>=2&&guide.collocations.filter(item=>item.ru).length>=2&&guide.commonMistakes.length>0&&!!guide.productionTask;
}
// Include new guidance in both feedback provenance and exported review cards.
// Preserve the legacy practice signature when no additional guidance exists.
export function lexicalGuideNote(context){
 const guide=lexicalContextGuide(context);
 const register=lexicalText(context.register)||(Array.isArray(context.registerTags)?context.registerTags.map(lexicalText).filter(Boolean).join(', '):'');
 return [guide.meaningRu?'Смысл в этом контексте: '+guide.meaningRu:'',
  guide.usageNotes.length?'Как построить свою фразу:\n'+guide.usageNotes.join('\n'):'',
  guide.collocations.length?'Сочетания:\n'+guide.collocations.map(item=>item.text+(item.ru?' — '+item.ru:'')).join('\n'):'',
  guide.commonMistakes.length?'На что обратить внимание:\n'+guide.commonMistakes.map(item=>'Не подходит здесь: '+item.wrong+'\nПодходит: '+item.correct+'\nПочему: '+item.why).join('\n'):'',
  register?'Где уместно: '+register:'',
  lexicalText(context.usAlternative)?'Американская / нейтральная альтернатива: '+context.usAlternative:'',
 ].filter(Boolean).map(text=>'\n'+text).join('');
}
export function lexicalStudyContexts(entry){
 const active=(entry.contexts||[]).filter(context=>!context.excludedFromStudy);
 return active.filter(context=>lexicalFullAnalysis(entry,context)).concat(active.filter(context=>lexicalPreparedContext(entry,context)&&!lexicalFullAnalysis(entry,context)),active.filter(context=>!lexicalPreparedContext(entry,context)));
}
export function lexicalImage(entry,context){return (entry.images||[]).find(image=>lexicalImageURL(image)&&(!image.contextId||image.contextId===context.id))||null;}
