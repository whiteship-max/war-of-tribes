// `npm run speed` — замер скорости прогонов на постоянном наборе (docs/handbook/console.md, «Где было время»): по прогону
// каждого рода, из которого состоят тяжёлые отчёты и вывод, — время и отпечаток итога. Отпечаток — sha256 итогов: одинаковый
// на двух деревьях — прогоны дали то же; время — живое число (`measure`). Модуль нарочно берёт только то, что было в отчётах
// до УС-1, — его копия на старом дереве меряет «до» на той же машине.
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulateBattle, FRONT_WIDTH } from '@/battle';
import { compositionLattice, scaleArmy } from '@/battle/bench';
import { deploySetup } from '@/battle/setup';
import { DAY_LENGTH } from '@/game/constants';
import { HOME_ID } from '@/world/local/LocalWorld';
import { measure } from '../lib/measured';
import { holdMachine } from '../lib/budget';
import { viteNode } from '../lib/fan';
import { ladderRun } from '../raid-hiring';
import { typicalTowns } from '../pop-gold';
import { gateEven } from '../raid-defense-mix';
import { openSky, townAt, type Inside } from '../autopilot';

/** Значение ключа `--name` из доводов (vite-node отдаёт их без пути скрипта). */
const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
};
const repeat = Math.max(1, Math.floor(Number(arg('repeat')) || 1));
if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log(`npm run speed [-- --repeat N] [--only ИМЯ] [--profile ИМЯ]
Замер скорости прогонов на постоянном наборе: лестница «Найма» (ladder: автопилот и мир, 4 ч), партия мерки силы у ворот
(towns: pop-gold.typicalTowns до 10-го уровня), ровный бой у ворот (gate: gateEven, 5-й уровень), решётка ядра боя
(lattice: 1318 боёв), осада в мире (siege: набег 3000 на посёлок 8-го уровня до конца). Время — лучшее из N повторов;
отпечаток — sha256 итогов: на двух деревьях одинаков — прогоны дали то же. Под замком машины, один процесс.
  --only ИМЯ      только этот прогон (ladder, towns, gate, lattice, siege)
  --profile ИМЯ   профиль этого прогона (node --cpu-prof): где время — собственное и с вызванными, по функциям`);
  process.exit(0);
}

interface CpuProfile {
  nodes: { id: number; callFrame: { functionName: string; url: string; lineNumber: number }; children?: number[] }[];
  samples: number[];
  timeDeltas: number[];
}

/**
 * Сводка профиля: собственное время функции и время с вызванными, доли от всего. Строки в `‹…›` — живые замеры; имя функции
 * и файл — из профиля (номер строки — преобразованного vite-node кода, а не исходника).
 */
function profileSummary(p: CpuProfile, top: number): string[] {
  const byId = new Map(p.nodes.map((n) => [n.id, n]));
  const parent = new Map<number, number>();
  for (const n of p.nodes) for (const c of n.children ?? []) parent.set(c, n.id);
  const hits = new Map<number, number>();
  let total = 0;
  p.samples.forEach((id, i) => {
    hits.set(id, (hits.get(id) ?? 0) + (p.timeDeltas[i] ?? 0));
    total += p.timeDeltas[i] ?? 0;
  });
  const key = (id: number): string => {
    const f = byId.get(id)!.callFrame;
    return `${f.functionName || '(без имени)'} ${f.url.split('/').slice(-2).join('/')}`;
  };
  const own = new Map<string, number>();
  const incl = new Map<string, number>();
  for (const [id, t] of hits) {
    own.set(key(id), (own.get(key(id)) ?? 0) + t);
    const seen = new Set<string>();
    for (let cur: number | undefined = id; cur !== undefined; cur = parent.get(cur)) {
      const k = key(cur);
      if (seen.has(k)) continue;
      seen.add(k);
      incl.set(k, (incl.get(k) ?? 0) + t);
    }
  }
  const rows = (m: Map<string, number>): string[] =>
    [...m]
      .filter(([k]) => !k.startsWith('(root)'))
      .sort((a, b) => b[1] - a[1])
      .slice(0, top)
      .map(([k, t]) => `  ${measure(`${(t / 1e6).toFixed(2)} с`).padEnd(10)} ${measure(`${((100 * t) / total).toFixed(1)} %`).padEnd(9)} ${k}`);
  return [`=== Профиль: всего ${measure(`${(total / 1e6).toFixed(1)} с`)} ===`, 'собственное время функции:', ...rows(own), 'с вызванными:', ...rows(incl)];
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

const JOBS: { id: string; name: string; run: () => Promise<unknown> | unknown }[] = [
  { id: 'ladder', name: 'лестница «Найма», ур. 7', run: () => ladderRun({ level: 7, style: 'means', seed: 7 }) },
  { id: 'towns', name: 'партия мерки у ворот', run: () => typicalTowns({ stream: 1, masters: false, seconds: 720 * DAY_LENGTH }) },
  {
    id: 'gate',
    name: 'ровный бой у ворот, ур. 5',
    run: async () => {
      const e = await gateEven({ level: 5, flight: 0, g: townAt(5) });
      return { army: e.army, defense: e.defense, militia: e.militia, wolves: e.wolves.power, raiders: e.raiders.power };
    },
  },
  { id: 'lattice', name: 'решётка ядра боя', run: lattice },
  { id: 'siege', name: 'осада в мире, ур. 8', run: siege },
];

const only = arg('only');
const profiled = arg('profile');
for (const id of [only, profiled]) if (id !== undefined && !JOBS.some((j) => j.id === id)) {
  console.error(`ошибка: прогона «${id}» нет — ${JOBS.map((j) => j.id).join(', ')}`);
  process.exit(2);
}
await holdMachine('замер скорости');

if (profiled) {
  // Профиль — дочерним процессом под node --cpu-prof (флаг узла не включить изнутри), сводка — здесь.
  const dir = mkdtempSync(path.join(tmpdir(), 'tribe-speed-'));
  const here = fileURLToPath(import.meta.url);
  const kid = spawnSync(process.execPath, ['--cpu-prof', `--cpu-prof-dir=${dir}`, viteNode(), here, '--', '--only', profiled], { stdio: 'inherit' });
  if (kid.status !== 0) process.exit(kid.status ?? 1);
  const file = readdirSync(dir).find((f) => f.endsWith('.cpuprofile'));
  if (!file) throw new Error('профиль не записался');
  for (const line of profileSummary(JSON.parse(readFileSync(path.join(dir, file), 'utf8')) as CpuProfile, 25)) console.log(line);
  rmSync(dir, { recursive: true, force: true });
  process.exit(0);
}

console.log(`=== Скорость прогонов: лучшее из ${repeat} ===`);
console.log(' прогон                          время        отпечаток');
let total = 0;
for (const job of JOBS.filter((j) => !only || j.id === only)) {
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
