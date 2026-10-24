import { createInitialState } from './state';
import { storageCap } from './derived';
import { startUpgrade, cancelUpgrade } from './sim/actions';
const s = createInitialState() as any;
for (const r of Object.keys(s.resources)) s.resources[r] = 1e6;
let ok = null as any, id = -1;
for (const b of s.buildings) { if (startUpgrade(s, b.id) === null) { id = b.id; break; } }
const cap = storageCap(s);
s.resources.wood = cap + 500;
const before = s.resources.wood;
cancelUpgrade(s, id);
console.log({ id, cap, before, after: s.resources.wood });
if (s.resources.wood < before) { console.log('FAIL: cancel lowered wood'); process.exit(1); }
console.log('PASS');
