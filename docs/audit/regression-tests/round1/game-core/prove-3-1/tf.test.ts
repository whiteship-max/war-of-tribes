import { addRes } from './fixed/data/eventKit';
const mk=()=>({__cap:100,resources:{wood:150}} as any);
let s=mk(); const r=addRes(s,'wood',-5);
console.log('loss',s.resources.wood,r);
let s2=mk(); const r2=addRes(s2,'wood',10);
console.log('gain',s2.resources.wood,r2);
if(s.resources.wood!==145||r!==-5||s2.resources.wood!==150){console.log('FAIL');process.exit(1)}
console.log('PASS');
