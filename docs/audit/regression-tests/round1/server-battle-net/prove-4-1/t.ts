import { seedTown, buildStep } from './netlify/lib/town.ts';
const s = seedTown(0);
const b = { ...s, levels: { ...s.levels, farm: 8 }, letters: 1, credit: 0 };
const r = buildStep(b, 0, { buildings: { ...b.levels, farm: 9 } } as any);
console.log('farm', r.book.levels.farm, 'letters', r.book.letters, 'short', r.short);
if (r.book.levels.farm === 8 && r.book.letters < 1) { console.log('FAIL: 1 letter spent, farm:9 not confirmed'); process.exit(1); }
console.log('PASS');
