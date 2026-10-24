import { letterCost, lootTotal } from './s/world/letters';
const c:any={id:'x',name:'x',pop:1000,lootMix:['food','wood','stone'],standing:'neutral',attitude:0,captives:0};
const r=letterCost('tribute',c,{});
console.log(JSON.stringify(r), lootTotal(r));
if (lootTotal(r)>1) { console.log('FAIL: asked',lootTotal(r),'from empty stock, cap 1'); process.exit(1);} console.log('PASS');
