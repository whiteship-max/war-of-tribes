import { marketFaults } from './fix/netlify/lib/market.ts';
const card = (seq:number, deals:any[]):any => ({ buildings:{market:1}, stock:{}, lead:0, market:{seq,w:0,deals,press:{},bought:{},sold:{},got:0} });
const d = (gold:number) => ({ seq:6, at:1000, good:'zzz', n:1, gold, q:0 });
const out = marketFaults(card(5,[]),0,card(6,[d(10),d(99)]),1000,{boost:0,prod:{},slack:1});
console.log(out);
if (!out.some(s=>s.includes('двойная'))) { console.log('FAIL: no double-deal flag'); process.exit(1); }
console.log('PASS');
