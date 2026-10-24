import { createInitialState } from './src/game/state';
import { storageCap } from './src/game/derived';
import { callGate, settleGate } from './src/game/sim/gate';
const s = createInitialState(7);
const cap = storageCap(s);
s.resources.food = cap + 500;
const c = callGate(s, 'wolves' as any, 1, { food: 20 });
settleGate(s, { id: 'x', gate: c.id, battle: 'won' } as never);
const exp = cap + 520;
console.log(`cap=${cap} food=${s.resources.food} expected>=${cap+500}`);
if (s.resources.food < cap + 500) { console.log('FAIL: winning lost', cap+500-s.resources.food); process.exit(1); }
console.log('PASS');
