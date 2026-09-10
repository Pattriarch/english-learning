export const notebookRegisters={neutral:'Обычный',work:'Рабочая переписка',casual:'Разговор с друзьями',internet:'Интернет и Reddit'};
export const notebookKey=id=>'notebook:entry:'+id;
export const notebookResultKey=id=>'notebook:result:'+id;
export const validNotebookId=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,70}$/.test(id);
export const notebookAudioURL=name=>/^[a-f0-9]{64}\.(webm|wav|ogg|m4a)$/.test(name||'')?'/media/'+name:'';
const text=v=>typeof v==='string'?v:'';
export function newNotebookEntry(id,now=new Date()){
 if(!validNotebookId(id))throw Error('Некорректная запись');
 return{version:1,id,russian:'',context:'',register:'neutral',ownEnglish:'',practice:'',lessonId:'',createdAt:now.toISOString(),savedAt:'',recordings:[]};
}
export function parseNotebookEntry(raw){
 try{const v=typeof raw==='string'?JSON.parse(raw):raw;if(v?.version!==1||!validNotebookId(v.id)||!Number.isFinite(Date.parse(v.createdAt)))return null;
 return{...newNotebookEntry(v.id,new Date(v.createdAt)),russian:text(v.russian),context:text(v.context),register:Object.hasOwn(notebookRegisters,v.register)?v.register:'neutral',ownEnglish:text(v.ownEnglish),practice:text(v.practice),lessonId:validNotebookId(v.lessonId)?v.lessonId:'',savedAt:Number.isFinite(Date.parse(v.savedAt))?v.savedAt:'',recordings:(Array.isArray(v.recordings)?v.recordings:[]).filter(r=>notebookAudioURL(r?.file)&&Number.isFinite(Date.parse(r.at))).map(r=>({file:r.file,at:r.at,text:text(r.text),kind:r.kind==='own'?'own':'model'}))};
 }catch{return null;}
}
export const notebookSource=entry=>JSON.stringify([entry.russian.trim(),entry.context.trim(),entry.register]);
// SHA-256 over the exact canonical UTF-8 source. This synchronous form keeps
// result freshness checks usable while rendering, without a late async redraw.
export function notebookFingerprint(entry){
 const bytes=new TextEncoder().encode(notebookSource(entry)),size=Math.ceil((bytes.length+9)/64)*64,buffer=new Uint8Array(size);buffer.set(bytes);buffer[bytes.length]=128;
 const view=new DataView(buffer.buffer);view.setUint32(size-8,Math.floor(bytes.length/0x20000000));view.setUint32(size-4,(bytes.length*8)>>>0);
 const h=new Uint32Array([0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19]);
 const k=[0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2],w=new Uint32Array(64),rotate=(x,n)=>(x>>>n)|(x<<(32-n));
 for(let block=0;block<size;block+=64){
  for(let i=0;i<16;i++)w[i]=view.getUint32(block+i*4);
  for(let i=16;i<64;i++){const a=w[i-15],b=w[i-2];w[i]=w[i-16]+(rotate(a,7)^rotate(a,18)^(a>>>3))+w[i-7]+(rotate(b,17)^rotate(b,19)^(b>>>10));}
  let [a,b,c,d,e,f,g,z]=h;
  for(let i=0;i<64;i++){const t1=(z+(rotate(e,6)^rotate(e,11)^rotate(e,25))+((e&f)^(~e&g))+k[i]+w[i])>>>0,t2=((rotate(a,2)^rotate(a,13)^rotate(a,22))+((a&b)^(a&c)^(b&c)))>>>0;z=g;g=f;f=e;e=(d+t1)>>>0;d=c;c=b;b=a;a=(t1+t2)>>>0;}
  [a,b,c,d,e,f,g,z].forEach((value,i)=>h[i]=(h[i]+value)>>>0);
 }
 return 'sha256:'+Array.from(h,x=>x.toString(16).padStart(8,'0')).join('');
}
export function parseNotebookResult(raw){
 try{const v=typeof raw==='string'?JSON.parse(raw):raw;if(v?.version!==1||typeof v.source!=='string'||!v.english?.trim()||!v.explanation?.trim()||!Array.isArray(v.phrases))return null;
 return{version:1,source:v.source,at:text(v.at),english:text(v.english),explanation:text(v.explanation),alternative:text(v.alternative),practice:text(v.practice),phrases:v.phrases.filter(p=>p&&typeof p.english==='string'&&typeof p.russian==='string').slice(0,5)};
 }catch{return null;}
}
export function notebookJSON(value){const out=JSON.stringify(value);if(new TextEncoder().encode(out).length>19500)throw Error('Запись получилась слишком длинной. Сохрани часть мысли отдельной записью.');return out;}
export function notebookRecordings(drafts,entry){
 const result=[...(entry.recordings||[])];
 for(const [key,raw] of Object.entries(drafts||{})){if(!key.startsWith('notebook:recording:'))continue;try{const r=JSON.parse(typeof raw==='string'?raw:raw.text);if(r.entryId===entry.id&&notebookAudioURL(r.file)&&Number.isFinite(Date.parse(r.at)))result.push({file:r.file,at:r.at,text:text(r.text),kind:r.kind==='own'?'own':'model'});}catch{}}
 return [...new Map(result.map(r=>[r.file+':'+r.at,r])).values()].sort((a,b)=>a.at.localeCompare(b.at));
}
export function notebookEntries(drafts){return Object.entries(drafts||{}).filter(([key])=>key.startsWith('notebook:entry:')).map(([key,raw])=>{const entry=parseNotebookEntry(typeof raw==='string'?raw:raw?.text);return entry&&key===notebookKey(entry.id)?{...entry,recordings:notebookRecordings(drafts,entry)}:null;}).filter(Boolean).filter(e=>e.russian.trim()||e.ownEnglish.trim()||e.recordings.length).sort((a,b)=>(b.savedAt||b.createdAt).localeCompare(a.savedAt||a.createdAt));}
export function notebookResultCurrent(entry,result){return!!result&&(result.source===notebookSource(entry)||result.source===notebookFingerprint(entry));}
