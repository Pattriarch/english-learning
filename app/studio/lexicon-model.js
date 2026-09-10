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
  context:'Target variety: American English. Target: '+entry.word+'\nSource example: '+context.en+'\nMeaning and explanation: '+ru+'\n'+(context.explanation||'')};
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
export function lexicalImage(entry,context){return (entry.images||[]).find(image=>lexicalImageURL(image)&&(!image.contextId||image.contextId===context.id))||null;}
