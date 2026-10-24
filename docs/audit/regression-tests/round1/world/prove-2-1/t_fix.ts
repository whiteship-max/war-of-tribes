import { breachesOf, outOf, repairAfter } from './f/src/world/siegeroll';
import { craftAfter } from './f/src/world/siegecraft';
const T0=1_000_000;
const old:any={campId:'c',startedAt:T0,craft:{shots:3},phases:[]};
const b0=breachesOf(old);
const v={...old,...craftAfter(old,'fortify' as any,T0+1), log:[{at:T0+1,act:'aim',aim:'wall'}]};
const b1=breachesOf(v);
console.log('before',b0,'after aim',b1);
if(b0!==1||b1!==1){console.log('FAIL: legacy breach dropped');process.exit(1)}
