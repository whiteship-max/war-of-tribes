import { reaim } from './src/world/bombard';
import { playerWood, machineWood } from './src/world/works';
import { CAMP_WORKS_RIPE } from './src/world/data/tuning';
const S=0, at=CAMP_WORKS_RIPE;
const wood=playerWood(0.5,0.5);
const before=machineWood(S,at,wood);
const r=reaim(undefined,wood,S,at,{slow:0.3,thin:0.1});
const after=machineWood(S,at,r.wood), later=machineWood(S,2*at,r.wood);
console.log({before,after,later,share:r.wood?.machines});
if(Math.abs(after-before)>1e-9||!(later>after)){console.log('FAIL');process.exit(1)}
console.log('PASS');
