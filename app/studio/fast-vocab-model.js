import {lexicalPreparedContext,lexicalGuideNote,lexicalImage,lexicalImageURL} from './lexicon-model.js';

export function fastVocabOptions(value={}){
 const source=value instanceof URLSearchParams?Object.fromEntries(value):value;
 return {deck:source.deck==='saved'?'saved':'dictionary',direction:source.direction==='produce'?'produce':'recognize',q:String(source.q||'').slice(0,100),list:String(source.list||''),kind:['word','phrase'].includes(source.kind)?source.kind:'',topic:String(source.topic||'')};
}
export function fastVocabURL(options={}){return '#/lexicon/quick?'+new URLSearchParams(fastVocabOptions(options));}
export function fastDueCards(cards=[],now=Date.now()){
 const seen=new Set();return cards.filter(c=>c?.id&&c.front&&c.back&&Number.isFinite(Date.parse(c.due))&&Date.parse(c.due)<=now&&!seen.has(c.id)&&seen.add(c.id)).sort((a,b)=>Date.parse(a.due)-Date.parse(b.due));
}
export function fastExistingCard(cards,front,back){return cards.find(c=>c.front.trim()===front.trim()&&c.back.trim()===back.trim());}
export function fastCardEntryID(card){const match=String(card.source||'').match(/#\/lexicon\/([a-zA-Z0-9_-]{1,100})(?:\s|$)/);return match?.[1]||'';}
export function fastSavedTarget(card){
 const word=String(card.source||'').match(/^Контекстный словарь · (.+?)(?: · #\/lexicon\/|$)/)?.[1];
 const selected=String(card.note||'').match(/^Целевая форма в примере: (.+)$/m)?.[1];
 const forms=selected?selected.split(' · '):word?[word]:[],spans=[],text=card.back;
 for(const form of forms){if(!form)continue;const needle=form.toLowerCase();let index=0;
  while((index=text.toLowerCase().indexOf(needle,index))>=0){const end=index+form.length;
   if(!/[a-z]/i.test(text[index-1]||'')&&!/[a-z]/i.test(text[end]||''))spans.push({start:index,end,text:text.slice(index,end)});
   index=end;
  }
 }return spans.sort((a,b)=>a.start-b.start||b.end-a.end).filter((span,index,all)=>!all.slice(0,index).some(other=>other.end>span.start));
}
export async function fastLexicalCard(entry,context){
 if(!lexicalPreparedContext(entry,context))return null;
 // The same source and wording identify one saved card across batches and reloads.
 const identity=JSON.stringify([entry.id,context.id,context.en,context.ru]);
 const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(identity));
 const id='lexq-'+Array.from(new Uint8Array(digest),x=>x.toString(16).padStart(2,'0')).join('');
 const sources=[context.source,context.translationSource].filter(Boolean).map(s=>[s.attribution||s.author||'',s.url||'',s.license||''].filter(Boolean).join(' · '));
 const image=lexicalImage(entry,context);
 const forms=[...new Set((context.targetSpans||[]).map(span=>span.text))];
 return {card:{id,front:context.ru,back:context.en,note:[entry.word,forms.length?'Целевая форма в примере: '+forms.join(' · '):'',context.explanation,lexicalGuideNote(context),...sources].filter(Boolean).join('\n').slice(0,9000),source:`Контекстный словарь · ${entry.word} · #/lexicon/${entry.id}`,image:''},entryId:entry.id,contextId:context.id,targetSpans:context.targetSpans||[],imageURL:image?lexicalImageURL(image):'',imageAlt:image?.alt||'Иллюстрация ситуации',meaning:context.meaningRu||'',isNew:true};
}
export function fastSwipeRating(dx,dy,revealed){
 if(!revealed||!Number.isFinite(dx)||!Number.isFinite(dy)||Math.abs(dx)<72||Math.abs(dx)<Math.abs(dy)*1.5)return null;
 return dx<0?0:2;
}
export function fastKeyAction(key,revealed){
 if(key===' '||key==='Enter')return revealed?null:'reveal';
 if(!revealed)return null;
 return ({'1':0,'2':2,'3':3,ArrowLeft:0,ArrowRight:2})[key]??null;
}
