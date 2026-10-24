import { booked, blankWatch } from './repo/netlify/lib/watch.ts';
import { readWatch } from './repo/netlify/lib/contract.ts';
import { storageOf } from './repo/src/game/build.ts';
const at = Date.now();
const levels = {};
const conf = storageOf(levels);
const mk = (cap: number) => readWatch({ cap, stock: { wood: conf * 10 + 1000 }, buildings: {} , clock: at});
const rec = { ...blankWatch(), first: at };
for (const cap of [conf * 20, 0]) {
  const c = mk(cap);
  console.log('card ok', !!c, 'cap', c?.cap, 'wood', c?.stock.wood, 'confirmed', conf);
  const out = booked(rec, at, c!, [], [], null, 'k', [], { at: 0 });
  const caps = out.flags?.filter((f: any) => f.kind === 'cap') ?? [];
  console.log('forged cap', cap, '-> cap flags', caps.length);
  if (cap === 0 && caps.length === 0) { console.log('FAIL: no cap flag with cap=0'); process.exitCode = 1; }
}
