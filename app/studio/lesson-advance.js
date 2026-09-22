// Navigation never outlives the answer, the route, or the learner's decision
// to stop and inspect the feedback. Saved feedback does not schedule a timer.
export function scheduleLessonAdvance({isCurrent,advance,onCancel=()=>{},delay=1100}){
 let active=true;
 const cancel=()=>{if(!active)return;active=false;clearTimeout(timer);window.removeEventListener('hashchange',cancel);onCancel();};
 const timer=setTimeout(()=>{if(!active)return;active=false;window.removeEventListener('hashchange',cancel);if(isCurrent())advance();},delay);
 window.addEventListener('hashchange',cancel,{once:true});
 return cancel;
}
