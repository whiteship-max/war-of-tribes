import '@/game/pace.minute';
import { LocalWorld } from '@/world/local/LocalWorld';
import { troopTotal } from '@/game/battle/kinds';
const world:any = new LocalWorld({ seed:1, now: () => Date.UTC(2026,0,1), storage: null } as any);
await world.sync({ name:'T', pop: 50, defense:30, units:{warrior:100,scout:4}, army:{clubman:100}, stock:{}, stash:0 });
// Make a generated in-realm settlement belong to the ally tribe (test setup only).
const ally:any = [...world.byId.values()].find((s:any)=>s.id!=='home' && world.inRealm(s));
ally.tribeId = world.save.allyTribe;
const before = troopTotal(world.defenders(world.clock()).all);
const r = await world.send({ target: ally.id, mission:'support', units:{warrior:100}, troops:{clubman:1} });
const after = troopTotal(world.defenders(world.clock()).all);
const m = world.save.marches.at(-1);
console.log('error', r.error, 'garrison', before, '->', after, 'march.units', JSON.stringify(m?.units), 'troops', JSON.stringify(m?.troops), 'view men', r.march?.units?.warrior);
const bad = !r.error && m.units.warrior !== troopTotal(m.troops);
console.log(bad ? 'FAIL: march carries units.warrior=' + m.units.warrior + ' while only ' + (before-after) + ' left home' : 'PASS');
process.exit(bad?1:0);
