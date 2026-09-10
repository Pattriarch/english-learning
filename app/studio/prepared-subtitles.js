const ROOT='/cinema-subtitles/';
const HASH=/^[a-f0-9]{64}$/;
export function preparedSubtitleEntries(manifest){
 if(manifest?.version!==1||manifest.seriesId!=='better-call-saul'||manifest.season!==1||manifest.language!=='en'||!Array.isArray(manifest.episodes))return [];
 const seen=new Set();
 return manifest.episodes.filter(e=>{
  if(!e||typeof e.episodeId!=='string'||!/^bcs-s01e(?:0[1-9]|10)$/.test(e.episodeId)||e.filename!==e.episodeId+'.en.srt'||!HASH.test(e.sha256)||!Number.isInteger(e.cueCount)||e.cueCount<100||typeof e.originalFilename!=='string'||typeof e.title!=='string'||seen.has(e.episodeId))return false;
  seen.add(e.episodeId);return true;
 });
}
export async function loadPreparedSubtitleCatalog({signal}={}){
 const response=await fetch(ROOT+'manifest.json',{signal,cache:'no-store'});
 if(!response.ok)return [];
 return preparedSubtitleEntries(await response.json());
}
export async function readPreparedSubtitle(episodeId,{signal}={}){
 if(!/^bcs-s01e(?:0[1-9]|10)$/.test(episodeId))throw Error('Неизвестный эпизод.');
 const entries=await loadPreparedSubtitleCatalog({signal}),entry=entries.find(e=>e.episodeId===episodeId);
 if(!entry)throw Error('Готового локального файла нет. Выбери свой SRT/VTT или открой источник ниже.');
 const response=await fetch(ROOT+entry.filename,{signal,cache:'no-store'});
 if(!response.ok)throw Error('Локальный файл субтитров недоступен.');
 const bytes=new Uint8Array(await response.arrayBuffer());
 if(bytes.length>5*1024*1024)throw Error('Слишком большой файл субтитров.');
 const digest=Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',bytes)),b=>b.toString(16).padStart(2,'0')).join('');
 if(digest!==entry.sha256)throw Error('Файл субтитров изменился. Открой свою версию через выбор файла.');
 return {entry,raw:new TextDecoder('utf-8',{fatal:true}).decode(bytes),digest};
}
