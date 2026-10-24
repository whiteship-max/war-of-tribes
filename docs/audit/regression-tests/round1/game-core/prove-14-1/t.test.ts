import { marketTick } from './src/game/sim/caravan';
import { storageCap } from './src/game/derived';
const s: any = { buildings: [], resources: { wood: 0 }, caravans: [], gold: 0, time: 100, log: [], equipment: {}, market: {} };
const cap = storageCap(s); s.resources.wood = cap * 2;
s.caravans = [{ good: 'wood', count: 10, arriveAt: 0 }];
const before = s.resources.wood;
try { marketTick(s, 0, 0); } catch (e) { console.log('threw', e); }
console.log({ cap, before, after: s.resources.wood });
if (s.resources.wood < before) { console.log('FAIL: stock destroyed'); process.exit(1); }
console.log('PASS');
