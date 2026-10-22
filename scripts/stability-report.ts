// Стабильность державы — числами (docs/stability.md, раздел 3).
//
// У стабильности два своих числа — `STAB_DRAG` (сколько ступени за день снимает группа, недовольная целиком) и `STAB_CALM`
// (сколько прибавляют тихие дни), — и оба выводятся из целей владельца, а не выбираются:
//
//  Ц1. Ровная игра держит 0…+1: автопилот отчётов (новая партия, высокий налог, найм по средствам, мир с набегами)
//      поднимается из 0 в +1 за сутки отлучки (`DAYS_TO_LAD` игр. дн.) и держит 0…+1 не меньше 90 % дней.
//  Ц2. Тяжёлый налог с голодом доводит из 0 до −2 за `DAYS_TO_MINUS2` игр. дн.: тот же город, высокий налог, скудный паёк,
//      пустые закрома, на полях никого.
//  Ц3. Мятеж на −3 редок, но реален: при высоком налоге на −3 податные доходят до мятежа, на −2 — нет. Шаг ступени
//      выводится из этой цели формулой (`stabrules.STAB_STEP`), отчёт проверяет её.
//
// Ступень двигает выработку, выработка — хлеб, хлеб — голодных, голодные — давление: числа входят в свою же выборку,
// поэтому вывод — неподвижной точкой (правило 16): `--derive` повторяет замер с записанными числами, пока выведенное не
// сойдётся с записанным; качается между двумя — полусумма.
//
//   npm run stability:report                 — цели на записанных числах
//   npm run stability:report -- --derive     — вывод `STAB_DRAG` и `STAB_CALM` (пишет в src/game/stabrules.ts)
//   SEEDS=1,2,3 DAYS=96 npm run stability:report — набор Ц1 (по умолчанию сиды 1…3, 96 игр. дн.)
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { GameState } from '@/game/types';
import { createInitialState } from '@/game/state';
import { DAY_LENGTH, MUTINY_FUSE } from '@/game/constants';
import { TAX_BY_ID } from '@/game/data/policy';
import { MEAN_RULER_SKILL, POINTS_PER_SKILL_PER_DAY } from '@/game/data/realm';
import { stabName, stabSigned } from '@/game/data/stability';
import { dayOf, moraleBreakdown } from '@/game/derived';
import { autoAssign } from '@/game/sim/workers';
import { groupsOf, stabLevel, stabOf } from '@/game/sim/stability';
import {
  STAB_BAND,
  STAB_CALM,
  STAB_DRAG,
  STAB_MAX,
  STAB_MIN,
  STAB_STEP,
  discontentOf,
  stabOutputMult,
  stabPrice,
} from '@/game/stabrules';
import { BUILDING_BY_ID } from '@/game/data/buildings';
import { JOB_BY_ID } from '@/game/data/jobs';
import { pilot, player, stand } from './autopilot';

/** Ц1: за сколько игровых дней ровная игра поднимается из 0 в +1 — сутки отлучки (`MAX_OFFLINE_DAYS`). */
const DAYS_TO_LAD = 48;
/** Ц2: за сколько игровых дней тяжёлый налог с голодом доводит из 0 до −2 — шесть настоящих часов. */
const DAYS_TO_MINUS2 = 12;

const SEEDS = (process.env.SEEDS ?? '1,2,3').split(',').map(Number).filter((n) => n > 0);
const DAYS = Number(process.env.DAYS) > 0 ? Number(process.env.DAYS) : 96;

const pct = (v: number, d = 1): string => `${v.toFixed(d)} %`;
const sum = (s: GameState): number => groupsOf(s).reduce((n, g) => n + g.value, 0) / 100;

// ---------- Ц1: ровная игра ----------

interface Even {
  seed: number;
  /** Ступень на конец каждого игрового дня. */
  levels: number[];
  /** Сумма полос (в долях) на конец дня, пока ступень 0 — со второго дня: полосы растут от нуля первые полтора. */
  atZero: number[];
  revolts: number;
  bought: number;
}

async function even(seed: number): Promise<Even> {
  const g = createInitialState(seed);
  autoAssign(g);
  const levels: number[] = [];
  const atZero: number[] = [];
  let day = dayOf(g.time);
  await pilot({
    g,
    seconds: DAYS * DAY_LENGTH,
    player: player('means', { tax: 'high' }),
    world: { seed, pulse: 30, raids: true },
    economy: 'live',
    tick: 1,
    decide: 30,
    watch: {
      after: ({ g: s }) => {
        const d = dayOf(s.time);
        if (d === day) return;
        day = d;
        levels.push(stabLevel(s));
        if (d >= 3 && stabLevel(s) === 0) atZero.push(sum(s));
      },
    },
  });
  return { seed, levels, atZero, revolts: stabOf(g).revolts, bought: stabOf(g).bought };
}

// ---------- Ц2: тяжёлый налог с голодом ----------

/** Город с тяжёлым налогом и голодом: высокий налог, скудный паёк, пустые закрома, на полях и в лесу никого. */
function hungryTown(): GameState {
  const g = createInitialState(1);
  g.tutorialDone = true;
  autoAssign(g);
  g.tax = 'high';
  g.ration = 'lean';
  g.resources.food = 0;
  for (const b of g.buildings) if (isFood(b.type)) g.workers[b.id] = 0;
  g.freeJobs = {};
  return g;
}

/** Постройка, чья работа даёт хлеб — по таблице профессий, а не списком. */
const isFood = (type: keyof typeof BUILDING_BY_ID): boolean => {
  const job = BUILDING_BY_ID[type].job;
  return !!job && (JOB_BY_ID[job].yield.food ?? 0) > 0;
};

interface Hard {
  /** День, когда ступень впервые стала −1, −2, −3; null — не стала. */
  at: Record<string, number | null>;
  revolts: number;
  folk: number;
  hungry: number;
}

function hard(maxDays = 40): Hard {
  const g = hungryTown();
  const at: Record<string, number | null> = { '-1': null, '-2': null, '-3': null };
  stand(g, {
    dt: 1,
    steps: maxDays * DAY_LENGTH,
    after: (s, i) => {
      const l = String(stabLevel(s));
      if (l in at && at[l] === null) at[l] = (i + 1) / DAY_LENGTH;
      return at['-3'] !== null;
    },
  });
  return { at, revolts: stabOf(g).revolts, folk: stabOf(g).folk, hungry: stabOf(g).hungry };
}

// ---------- Ц3: мятеж на −3 ----------

function folkTargetAt(level: number): number {
  const g = createInitialState(1);
  g.tutorialDone = true;
  autoAssign(g);
  g.tax = 'high';
  g.stab = { level, drift: 0, folk: 0, hungry: 0, past: [], bought: 0, spent: 0, revolts: 0, held: 0 };
  return groupsOf(g, moraleBreakdown(g)).find((x) => x.id === 'folk')!.target!;
}

// ---------- Замер ----------

interface Measure {
  /** Средняя сумма полос на нуле — по всем сидам. */
  g0: number;
  evens: Even[];
  hard: Hard;
}

async function measureAll(): Promise<Measure> {
  const evens: Even[] = [];
  for (const seed of SEEDS) evens.push(await even(seed));
  const zero = evens.flatMap((e) => e.atZero);
  const g0 = zero.length > 0 ? zero.reduce((n, v) => n + v, 0) / zero.length : 0;
  return { g0, evens, hard: hard() };
}

function print(m: Measure): void {
  console.log(`Стабильность державы — STAB_DRAG ${STAB_DRAG}, STAB_CALM ${STAB_CALM}, шаг ступени ${STAB_STEP.toFixed(2)} морали`);
  console.log('');
  console.log(`Ц1. Ровная игра: автопилот по умолчанию (высокий налог, найм по средствам, мир с набегами), ${DAYS} игр. дн., сиды ${SEEDS.join(', ')}`);
  for (const e of m.evens) {
    const inBand = e.levels.filter((l) => l >= 0 && l <= 1).length;
    const lad = e.levels.findIndex((l) => l >= 1);
    const min = Math.min(...e.levels);
    console.log(
      `  сид ${e.seed}: 0…+1 — ${inBand} из ${e.levels.length} дней (${pct((100 * inBand) / Math.max(1, e.levels.length), 0)}); ` +
        `+1 — ${lad < 0 ? 'не дошла' : `на ${lad + 1}-й день`}; ниже всего ${stabSigned(min)}; мятежей ${e.revolts}; куплено ступеней ${e.bought}`,
    );
  }
  console.log(`  сумма полос на нуле (со 3-го дня, по всем сидам): ${m.g0.toFixed(4)} — цель Ц1 даёт CALM = DRAG × ${m.g0.toFixed(4)} + 100/${DAYS_TO_LAD}`);
  console.log('');
  const h = m.hard;
  const when = (l: string): string => (h.at[l] === null ? 'не дошла' : `${h.at[l]!.toFixed(1)} игр. дн.`);
  console.log('Ц2. Тяжёлый налог с голодом: высокий налог, скудный паёк, пустые закрома, на полях никого, с 0');
  console.log(`  −1: ${when('-1')}; −2: ${when('-2')} (цель ${DAYS_TO_MINUS2}); −3: ${when('-3')}; мятежей ${h.revolts}`);
  console.log('');
  const t2 = folkTargetAt(-2);
  const t3 = folkTargetAt(-3);
  console.log(`Ц3. Мятеж на −3 редок, но реален: цель податных при высоком налоге (${TAX_BY_ID.high.moralePenalty} морали → ${pct(discontentOf(TAX_BY_ID.high.moralePenalty))})`);
  console.log(`  на −2: ${pct(t2)} — ${t2 < 100 ? 'мятежа нет' : 'МЯТЕЖ — цель нарушена'}; на −3: ${pct(t3)} — ${t3 >= 100 ? `мятеж за ${((100 / ((100 * DAY_LENGTH) / MUTINY_FUSE))).toFixed(0)} игр. дн. от нуля` : 'мятежа нет — цель нарушена'}`);
  console.log(`  шаг ступени ${STAB_STEP.toFixed(2)} морали = ${pct(discontentOf(STAB_STEP))} недовольства — середина между (${STAB_BAND} − ${TAX_BY_ID.high.moralePenalty}) / 3 и / 2`);
  console.log('');
  console.log(`Цена ступени (каждого из трёх видов очков) и что ступень даёт; приток среднего правителя — ${MEAN_RULER_SKILL * POINTS_PER_SKILL_PER_DAY} в игр. день`);
  for (let l = STAB_MIN; l <= STAB_MAX; l++) {
    const price = stabPrice(l);
    const days = price / (MEAN_RULER_SKILL * POINTS_PER_SKILL_PER_DAY);
    console.log(
      `  ${stabSigned(l).padStart(2)} ${stabName(l).padEnd(13)} подъём ${price > 0 ? `${price} (${days.toFixed(0)} игр. дн.)` : '—'}; выработка ×${stabOutputMult(l).toFixed(4)}`,
    );
  }
}

// ---------- Вывод неподвижной точкой ----------

const RULES = fileURLToPath(new URL('../src/game/stabrules.ts', import.meta.url));

function writeRules(drag: number, calm: number): void {
  let src = readFileSync(RULES, 'utf8');
  src = src.replace(/export const STAB_DRAG = [\d.]+;/, `export const STAB_DRAG = ${drag};`);
  src = src.replace(/export const STAB_CALM = [\d.]+;/, `export const STAB_CALM = ${calm};`);
  writeFileSync(RULES, src);
}

/** Один замер в дочернем процессе: модули игры читают записанные числа заново. */
function child(): Measure {
  const r = spawnSync('npx', ['vite-node', fileURLToPath(import.meta.url), '--', '--measure'], { encoding: 'utf8', env: process.env });
  const line = r.stdout.split('\n').find((x) => x.startsWith('MEASURE '));
  if (!line) throw new Error(`замер не вернул числа:\n${r.stdout}\n${r.stderr}`);
  return JSON.parse(line.slice('MEASURE '.length)) as Measure;
}

const round = (v: number, d: number): number => Number(v.toFixed(d));

/**
 * Вывод: тихие дни всегда считаются от той же тяги по Ц1 (`CALM = DRAG × сумма полос на нуле + 100 / DAYS_TO_LAD`) — иначе
 * две ручки подталкивают друг друга и качание растёт; тяга подбирается по Ц2 делением отрезка: чем она больше, тем быстрее
 * город с тяжёлым налогом и голодом падает до −2. Сумма полос на нуле сама зависит от записанного (ступень двигает выработку)
 * — она берётся из того же замера, поэтому повтор идёт до неподвижной точки: выведенное сходится с записанным.
 */
async function derive(): Promise<void> {
  let g0 = child().g0;
  const calmOf = (d: number): number => round(d * g0 + 100 / DAYS_TO_LAD, 2);
  let lo: number | null = null;
  let hi: number | null = null;
  let drag = STAB_DRAG;
  for (let step = 1; step <= 14; step++) {
    const calm = calmOf(drag);
    writeRules(drag, calm);
    const m = child();
    g0 = m.g0;
    const t2 = m.hard.at['-2'] ?? Infinity;
    console.log(`  шаг ${step}: DRAG ${drag} CALM ${calm} → сумма полос на нуле ${g0.toFixed(4)}, −2 за ${Number.isFinite(t2) ? t2.toFixed(2) : '—'} игр. дн.`);
    if (Math.abs(t2 - DAYS_TO_MINUS2) <= 0.1 && Math.abs(calmOf(drag) - calm) <= 0.01) break;
    if (t2 > DAYS_TO_MINUS2) lo = drag;
    else hi = drag;
    const next = lo !== null && hi !== null ? round((lo + hi) / 2, 2) : round(lo !== null ? drag * 1.25 : drag / 1.25, 2);
    if (next === drag || (lo !== null && hi !== null && hi - lo <= 0.02)) break;
    drag = next;
  }
  writeRules(drag, calmOf(drag));
  console.log(`DERIVE ${JSON.stringify({ drag, calm: calmOf(drag) })}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--measure')) {
    console.log(`MEASURE ${JSON.stringify(await measureAll())}`);
    return;
  }
  if (args.includes('--derive')) {
    await derive();
    return;
  }
  print(await measureAll());
}

void main();
