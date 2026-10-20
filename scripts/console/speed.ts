// `npm run speed` — замер скорости прогонов на постоянном наборе (docs/handbook/console.md, «Где было время»): по прогону
// каждого рода, из которого состоят тяжёлые отчёты и вывод, — время и отпечаток итога. Отпечаток — sha256 итогов: одинаковый
// на двух деревьях — прогоны дали то же; время — живое число (`measure`). Модуль нарочно берёт только то, что было в отчётах
// до УС-1, — его копия на старом дереве меряет «до» на той же машине.
import { createHash } from 'node:crypto';
import { simulateBattle, FRONT_WIDTH } from '@/battle';
import { compositionLattice, scaleArmy } from '@/battle/bench';
import { deploySetup } from '@/battle/setup';
import { DAY_LENGTH } from '@/game/constants';
import { HOME_ID } from '@/world/local/LocalWorld';
import { measure } from '../lib/measured';
import { holdMachine } from '../lib/budget';
import { ladderRun } from '../raid-hiring';
import { typicalTowns } from '../pop-gold';
import { gateEven } from '../raid-defense-mix';
import { openSky, townAt, type Inside } from '../autopilot';

const repeat = Math.max(1, Math.floor(Number(process.argv[process.argv.indexOf('--repeat') + 1]) || 1));
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`npm run speed [-- --repeat N]
Замер скорости прогонов на постоянном наборе: лестница «Найма» (автопилот и мир, 4 ч), партия мерки силы у ворот
(pop-gold.typicalTowns, до 10-го уровня), ровный бой у ворот (gateEven, 5-й уровень), решётка ядра боя (1318 боёв),
осада в мире (набег 3000 на посёлок 8-го уровня до конца). Время — лучшее из N повторов; отпечаток — sha256 итогов: на
двух деревьях одинаков — прогоны дали то же. Под замком машины, один процесс (бюджет железа).`);
  process.exit(0);
}

const hash = (x: unknown): string => createHash('sha256').update(JSON.stringify(x).replace(/"lastSaved":\d+/g, '"lastSaved":0')).digest('hex').slice(0, 12);

/** Решётка ядра боя: разные составы, размеры, ширина, отметки, стена — полные итоги, с наблюдением и без. */
function lattice(): unknown {
  const armies = compositionLattice(150, 600);
  const h = createHash('sha256');
  let k = 0;
  let n = 0;
  for (const total of [600, 140, 1700]) {
    for (let i = 0; i < armies.length; i++) {
      for (let j = 0; j < armies.length; j++) {
        if (k++ % 11 !== 0 || i === j) continue;
        const a = scaleArmy(armies[i], total);
        const b = scaleArmy(armies[j], total * (1 + ((i + j) % 5) / 10));
        const width = (i + j) % 7 === 0 ? 40 : FRONT_WIDTH;
        const attacker = { ...deploySetup(a, width), ...(i % 4 === 0 ? { pips: { fire: 2, shock: 1, maneuver: 3 }, resolve: 1.1, rest: 0.7 } : {}) };
        const defender = { ...deploySetup(b, width), ...(j % 5 === 0 ? { pips: { fire: 1, shock: 3, maneuver: 1 } } : {}) };
        const wall = (i + j) % 6 === 0 ? { fire: width * 2, widen: { round: 2, width: width * 2, wall: 1 } } : {};
        h.update(JSON.stringify(simulateBattle({ seed: 1 + ((i * 31 + j) % 9), attacker, defender, width, ...wall }, { observe: (i + j) % 3 === 0 })));
        n++;
      }
    }
  }
  return { n, h: h.digest('hex') };
}

/** Осада в мире: набег мощью 3000 на посёлок 8-го уровня выходит сейчас, мир шагает до конца осады. */
async function siege(): Promise<unknown> {
  const g = townAt(8);
  const sky = openSky(g, { seed: 7, pulse: 30, raids: true, ripe: true });
  await sky.pulse();
  const w: Inside = sky.world;
  const before = new Set(w.save.marches.map((m: Inside) => m.id));
  w.save.nextAiAt = sky.now();
  w.scheduleAi(sky.now());
  const m = w.save.marches.find((x: Inside) => !before.has(x.id) && !x.own && x.targetId === HOME_ID);
  m.power = 3000;
  m.units = { warrior: 1000 };
  const titles: string[] = [];
  for (let i = 0; i < 20000; i++) {
    sky.at(sky.now() + 60_000);
    const p = await sky.pulse();
    for (const r of p.reports) titles.push(`${r.id}:${r.title}`);
    if (p.reports.some((r) => r.siege) || (titles.some((t) => t.startsWith(m.id)) && !w.save.sieges[HOME_ID])) break;
  }
  return { titles, g: { army: g.army, resources: g.resources } };
}

const JOBS: { name: string; run: () => Promise<unknown> | unknown }[] = [
  { name: 'лестница «Найма», ур. 7', run: () => ladderRun({ level: 7, style: 'means', seed: 7 }) },
  { name: 'партия мерки у ворот', run: () => typicalTowns({ stream: 1, masters: false, seconds: 720 * DAY_LENGTH }) },
  {
    name: 'ровный бой у ворот, ур. 5',
    run: async () => {
      const e = await gateEven({ level: 5, flight: 0, g: townAt(5) });
      return { army: e.army, defense: e.defense, militia: e.militia, wolves: e.wolves.power, raiders: e.raiders.power };
    },
  },
  { name: 'решётка ядра боя', run: lattice },
  { name: 'осада в мире, ур. 8', run: siege },
];

await holdMachine('замер скорости');
console.log(`=== Скорость прогонов: лучшее из ${repeat} ===`);
console.log(' прогон                          время        отпечаток');
let total = 0;
for (const job of JOBS) {
  let best = Infinity;
  let print = '';
  for (let i = 0; i < repeat; i++) {
    const t = performance.now();
    const out = await job.run();
    best = Math.min(best, (performance.now() - t) / 1000);
    print = hash(out);
  }
  total += best;
  console.log(` ${job.name.padEnd(31)} ${measure(`${best.toFixed(1)} с`).padEnd(12)} ${print}`);
}
console.log(` ${'всего'.padEnd(31)} ${measure(`${total.toFixed(1)} с`)}`);
process.exit(0);
