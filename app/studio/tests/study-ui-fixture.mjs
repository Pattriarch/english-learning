import {readFile} from 'node:fs/promises';
import {esc,icon,feedbackHTML,progressLesson,formatDate,mediaURL,empty,clipUTF8} from '../core.js';

// Minimal DOM for exercising the real event handlers without a browser or real
// profile. Replacing innerHTML disconnects old controls, as a route redraw does.
class Element {
  constructor(tag='div',attrs={},parent=null){
    this.tag=tag;this.attrs=attrs;this.parent=parent;this.children=[];this.connected=true;this.dataset={};
    for(const [key,value] of Object.entries(attrs))if(key.startsWith('data-'))this.dataset[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase())]=value;
    this.disabled='disabled' in attrs;this.checked='checked' in attrs;this.hidden='hidden' in attrs;this.value=attrs.value||'';this.readOnly=false;
    const classes=new Set((attrs.class||'').split(' '));this.classList={add:v=>classes.add(v),remove:v=>classes.delete(v),contains:v=>classes.has(v),toggle:(v,on)=>on?classes.add(v):classes.delete(v)};
  }
  get isConnected(){return this.connected&&(!this.parent||this.parent.isConnected);}
  set innerHTML(html){this.children.forEach(node=>node.connected=false);this.children=[];this.html=String(html);this.appendHTML(this.html);}
  get innerHTML(){return this.html||'';}
  appendHTML(html){
    for(const match of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)){
      const attrs={};for(const a of match[2].matchAll(/([^\s=]+)(?:="([^"]*)")?/g))attrs[a[1]]=a[2]??'';
      const node=new Element(match[1],attrs,this),tail=html.slice(match.index+match[0].length);this.children.push(node);
      if(node.tag==='textarea')node.value=tail.split('</textarea>')[0].replace(/&lt;/g,'<').replace(/&gt;/g,'>').replace(/&quot;/g,'"').replace(/&#39;/g,"'").replace(/&amp;/g,'&');
      if(node.tag==='select'){const options=tail.split('</select>')[0],selected=options.match(/<option value="([^"]+)" selected/)||options.match(/<option value="([^"]+)"/);node.value=selected?.[1]||'';}
    }
  }
  matches(selector){if(selector[0]==='#')return this.attrs.id===selector.slice(1);if(selector[0]==='.')return(this.attrs.class||'').split(' ').includes(selector.slice(1));if(selector[0]==='['){const m=selector.match(/^\[([^=\]]+)(?:="([^"]*)")?\]$/);return !!m&&m[1] in this.attrs&&(m[2]===undefined||this.attrs[m[1]]===m[2]);}return this.tag===selector;}
  querySelectorAll(selector){return this.children.flatMap(node=>[...(node.matches(selector)?[node]:[]),...node.querySelectorAll(selector)]);}
  querySelector(selector){return this.querySelectorAll(selector)[0]||null;}
  setAttribute(name,value){this.attrs[name]=value;}
  insertAdjacentHTML(_position,html){this.parent.appendHTML(html);}
  scrollIntoView(){}
  focus(){}
  close(){this.connected=false;}
  async play(){this.playCalls=(this.playCalls||0)+1;}
  pause(){}
  click(){if(!this.disabled)return this.onclick?.({currentTarget:this});}
}

export async function studyUI(t,file,moduleMocks={}){
  const root=new Element(),local=new Map(),alerts=[],requests=[];let generation=0,request=0;
  const spoken=[],fixture={root,local,alerts,requests,spoken,api:async()=>({}),fetch:async()=>({ok:false}),speak:async(...args)=>{spoken.push(args);},voice:async()=>{},recordOnly:async()=>{},queueDraft:async()=>{},stopAudio:()=>{generation++;}};
  const core={esc,icon,feedbackHTML,progressLesson,formatDate,mediaURL,empty,clipUTF8,$:(q,node)=>node?node.querySelector(q):root.querySelector(q)||fixture.modal?.querySelector(q),$$:(q,node=root)=>node.querySelectorAll(q),toast:(message)=>alerts.push(message),uid:()=>`request-${++request}`,words:text=>text.trim().split(/\s+/).filter(Boolean).length,bindMistakes(){},cardModal(){},openModal(_title,html){fixture.modal=new Element();fixture.modal.innerHTML=html;return fixture.modal;},
    localDraft:key=>local.has(key)?{text:local.get(key)}:null,getDraft:(key,state)=>local.get(key)??state.drafts[key]?.text??'',
    queueDraft:async(key,text,immediate)=>{local.set(key,text);return fixture.queueDraft(key,text,immediate);},api:async(path,body)=>{requests.push({path,body});return fixture.api(path,body);},
    busy:async(button,fn)=>{if(button.disabled)return;button.disabled=true;try{return await fn();}catch(error){alerts.push(error.message);}finally{button.disabled=false;}}
  };
  const audio={stopAudio:fixture.stopAudio,beginAudio:()=>{fixture.stopAudio();const own=generation;return()=>own===generation;},speechVoiceName:id=>id,speak:(...args)=>fixture.speak(...args),voice:(...args)=>fixture.voice(...args),recordOnly:(...args)=>fixture.recordOnly(...args)};
  const key='studyFixture'+crypto.randomUUID(),descriptors=new Map();
  const session=new Map();fixture.session=session;
  for(const[name,value]of Object.entries({[key]:{core,audio,...moduleMocks},document:{addEventListener(){},removeEventListener(){}},sessionStorage:{getItem:k=>session.get(k)||null,setItem:(k,v)=>session.set(k,v)},location:{hash:'#/unit/unit-1'},fetch:(...args)=>fixture.fetch(...args),window:{history:{replaceState:(_s,_t,url)=>location.hash=url},speechSynthesis:{addEventListener(){},removeEventListener(){}}}})){
    descriptors.set(name,Object.getOwnPropertyDescriptor(globalThis,name));Object.defineProperty(globalThis,name,{configurable:true,writable:true,value});
  }
  t.after(()=>{for(const[name,descriptor]of descriptors){if(descriptor)Object.defineProperty(globalThis,name,descriptor);else delete globalThis[name];}});
  const source=(await readFile(new URL('../'+file,import.meta.url),'utf8')).replace(/^import \{([^}]+)\} from '\.\/([^']+)\.js';$/gm,(_,names,kind)=>kind==='core'||kind==='audio'||Object.hasOwn(moduleMocks,kind)?`const {${names}}=globalThis[${JSON.stringify(key)}][${JSON.stringify(kind)}];`:`import {${names}} from ${JSON.stringify(new URL('../'+kind+'.js',import.meta.url).href)};`);
  fixture.module=await import('data:text/javascript;base64,'+Buffer.from(source).toString('base64'));
  return fixture;
}

export const deferred=()=>{let resolve;const promise=new Promise(done=>resolve=done);return{promise,resolve};};

export function bookData(){
  const unit={id:'unit-1',unit:1,title:'Current unit',page:10,endPage:11},lesson={id:'book-unit-1',title:'Current lesson',level:'B1',minutes:45,goal:'Explain a thought',sections:[{title:'Meaning',body:'A paragraph.'}],examples:[{en:'I am working.',ru:'Я работаю.',why:'Current action'}],exercises:[{id:'e1',kind:'speak',prompt:'Explain your day.',context:'Today',answers:['I am working.'],hint:'Describe a process',explanation:'Present continuous'}],provenance:{sourceCoverage:[]}};
  return{data:{library:{books:[{title:'Book',filename:'book.pdf',level:'B1',units:[unit]}]},state:{drafts:{},read:{},attempts:[]},settings:{}},payload:{lesson,lessonStatus:'ready',taskVersions:true,canonicalUnitId:unit.id},lesson};
}
