import { createInitialState } from '../state';
import { RESOURCE_IDS } from '../constants';
import { holdRite } from './faith';
import { resolveEvent } from './mail';
const s = createInitialState();
s.tutorialDone = true;
for (const r of RESOURCE_IDS) s.resources[r] = 20000;
s.gold = 20000; s.pop = 200; s.faith.id = 'orthodox';
s.inbox.push({ defId: 'festival', at: s.time } as any);
if (holdRite(s) !== null) throw new Error('setup');
const until = s.faith.riteUntil, food = s.resources.food;
s.time += 10;
const r = resolveEvent(s, 0);
console.log('resolve', r, 'food', food, '->', s.resources.food, 'riteUntil', until, '->', s.faith.riteUntil);
if (r.error === null) { console.log('FAIL: second rite paid and started in same season'); process.exit(1); }
console.log('PASS');
