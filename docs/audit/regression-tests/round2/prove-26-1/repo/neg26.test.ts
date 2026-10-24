import '@/game/pace.minute';
import { LocalWorld } from '@/world/local/LocalWorld';
import { shieldVillagers } from '@/world/lairs';
import { distance } from '@/world/geo';
let now = 1_700_000_000_000;
const p = { name: 'T', pop: shieldVillagers(0.1), defense: 30, units: { warrior: 10, scout: 4 }, stock: { food: 5000, wood: 5000, stone: 5000, gold: 5000 }, stash: 0 } as any;
for (const seed of [11, 7, 3, 5, 13, 17]) {
  const w = new LocalWorld({ seed, now: () => now, storage: null });
  await w.sync(p);
  const info = await w.info();
  const t: any = (w as any).gen.settlements.filter((s: any) => s.tribeId && (w as any).inRealm(s)).sort((a: any, b: any) => distance(info.home, a) - distance(info.home, b))[0];
  console.log("seed",seed,"tribe",t?.id); if (!t) continue;
  await w.moveFigure('diplomat', { x: t.x, y: t.y });
  const f = (await w.figures()).find((x: any) => x.id === 'diplomat') as any;
  now = f.arriveAt; await w.sync(p);
  const r = await w.order('gift' as any, t.id);
  const busy = (w as any).save.figures.diplomat.busyUntil;
  console.log('seed', seed, 'order gift ->', JSON.stringify(r).slice(0, 160), 'busyUntil-now(ms)=', busy - now);
  const neg = await w.negotiate('truce' as any);
  console.log('negotiate while busy ->', neg);
  if (busy > now) { if (neg === null) { console.log('FAIL: deal signed by busy diplomat'); process.exit(1); } else { console.log('PASS'); process.exit(0); } }
}
console.log('no busy scenario'); process.exit(2);
