// Normalize only the historical free-book envelope. The exercise version is
// part of the identity; callers handling legacy snapshots may strip it there.
export function practiceIdentity(attempt){
 let lessonId=String(attempt?.lessonId||''),exerciseId=String(attempt?.exerciseId||'');
 if(lessonId==='free'){
  const match=exerciseId.match(/^(book-.+-\d{3})-(.+)$/);
  if(match){lessonId=match[1];exerciseId=match[2];}
 }
 return{lessonId,exerciseId,key:JSON.stringify([lessonId,exerciseId])};
}
