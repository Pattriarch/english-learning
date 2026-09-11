export function russianPlural(value,forms){
 const n=Math.abs(Math.trunc(Number(value)||0)),last=n%10,lastTwo=n%100;
 return forms[last===1&&lastTwo!==11?0:last>=2&&last<=4&&(lastTwo<12||lastTwo>14)?1:2];
}
export const russianCount=(value,forms)=>Number(value||0).toLocaleString('ru-RU')+' '+russianPlural(value,forms);
