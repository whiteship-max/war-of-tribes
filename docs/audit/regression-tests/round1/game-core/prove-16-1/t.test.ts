import { createInitialState } from './src/game/state';
import { applyExpedition } from './src/game/sim/expedition';
import { storageCap } from './src/game/derived';
const mk=(w:number)=>({warriorsLost:0,scoutsLost:0,morale:0,resources:{wood:w}} as any);
let s=createInitialState(1); const cap=storageCap(s);
s.resources.wood=cap+300; applyExpedition(s,mk(10));
console.log('loot +10: cap',cap,'wood',s.resources.wood-cap,'over cap (expected 300: loot must not lower stock)');
let t=createInitialState(1); t.resources.wood=cap+300; applyExpedition(t,mk(-5));
console.log('raid -5: wood',t.resources.wood-cap,'over cap (expected 295)');
if(s.resources.wood!==cap+300||t.resources.wood!==cap+295){console.log('FAIL');process.exit(1)}
console.log('PASS');
