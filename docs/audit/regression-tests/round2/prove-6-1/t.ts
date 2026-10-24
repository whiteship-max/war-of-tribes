import { applyGemOrder } from '/tmp/src/netlify/lib/gems.ts';
import { fullWork } from '/tmp/src/src/game/gemrules.ts';
const ledger:any={list:[],rushed:{},balance:1000,gems:1000};
for (const b of ['constructor','toString']) {
 try{console.log(b, fullWork(b as any,2));}catch(e){console.log('fullWork throws',String(e))}
 try{const r=applyGemOrder(ledger,{op:'rush',key:'k1',building:b,level:2,work:0,price:0},Date.now(),undefined);console.log(JSON.stringify(r).slice(0,300));}catch(e){console.log('apply throws',String(e))}
}
