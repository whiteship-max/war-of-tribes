import { refund } from './game/sim/pay';
const s:any={cap:1000,resources:{wood:1200,stone:0},stats:{}};
refund(s,{wood:10},0.5);
console.log('wood',s.resources.wood);
if(s.resources.wood<1200){console.log('FAIL: refund reduced wood 1200 ->',s.resources.wood);process.exit(1)}
console.log('PASS');
