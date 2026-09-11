import {parseLexicalState,lexiconStateKey} from './lexicon-model.js';

export function lexicalCollectionMembers(members,fallback){
 const seen=new Set(),safe=item=>typeof item?.id==='string'&&/^[A-Za-z0-9_-]{1,180}$/.test(item.id);
 const values=Array.isArray(members)?members:[];
 const result=values.filter(item=>{if(!safe(item)||seen.has(item.id))return false;seen.add(item.id);return true;});
 return result.length?result:safe(fallback)?[fallback]:[];
}
export const lexicalCollectionLabel=member=>member.kind==='phrase'?'Фразы из жизни':'Словарные контексты';
export function lexicalGroupProgress(members,readDraft){
 const states=members.map(member=>({...parseLexicalState(readDraft(lexiconStateKey(member.id))),id:member.id}));
 return{total:states.length,known:states.filter(state=>state.status==='known').length,learning:states.filter(state=>state.status==='learning').length,states};
}
