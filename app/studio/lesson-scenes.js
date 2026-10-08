let scenes=null,pending=null;

export function loadLessonScenes(){
 if(!pending)pending=fetch('/assets/course-scenes/manifest.json').then(r=>{if(!r.ok)throw Error('scenes unavailable');return r.json();}).then(value=>{scenes=value.lessons;return value;}).catch(()=>null);
 return pending;
}

export function expandedLessonScene(lesson){
 const scene=scenes?.[lesson.id];
 return scene&&/^[a-z0-9-]+\.png$/.test(scene.file||'')&&typeof scene.en==='string'&&typeof scene.ru==='string'?scene:null;
}
