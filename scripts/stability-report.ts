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
//   CROWN_SEEDS=1,…,6 CROWN_DAYS=480 — набор вестей державы (СБ-2, раздел «Вести державы»: частота, дрейф, вывод `CROWN_MTTH`)
//   ESTATES_DERIVE=1 npm run stability:report — вывод пользы и цены сословий (РТ-2, раздел «Сословия»; пишет estaterules.ts)
//
// Сословия (РТ-2, docs/stability.md, «РТ-2»):
//  Т1–Т3. Лояльность привилегии и зависть — формулой (`estaterules.ENVY`, `PRIV_LOYALTY`); отчёт сверяет три случая.
//  Ц5. Опора — ровная игра, отдавшая сословию обе привилегии, — получает от его дела +`EST_PLUS` % (плюс долей, в среднем по
//      дням `DAYS` и сидам `SEEDS`), а платит его минусом `EST_MINUS` %. Сила опоры зависит от построек, постройки — от пользы:
//      `ESTATE_PLUS` и `ESTATE_MINUS` выводятся неподвижной точкой.
//
// Вести державы (СБ-2):
//  Ц4. Ровная игра видит около одной вести державы в настоящие сутки (`CROWN_PER_DAY`), и сдвиг стабильности от вестей в ней
//      около нуля: средний сдвиг за настоящие сутки — в пределах ±`CROWN_DRIFT_BAND` % ступени, и при ответах автопилота
//      (первый бесплатный), и при молчании. Срок `CROWN_MTTH` выводится из частоты (`--derive`): на приходе сетки весть
//      державы выпадает с вероятностью `1 − exp(−Δ·S/M)`, где S — сумма весов по редкости в ровной игре, Δ — шаг сетки.
import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import type { GameState, JobId } from '@/game/types';
import { createInitialState } from '@/game/state';
import { DAY_LENGTH, MUTINY_FUSE } from '@/game/constants';
import { TAX_BY_ID } from '@/game/data/policy';
import { MEAN_RULER_SKILL, POINTS_PER_SKILL_PER_DAY } from '@/game/data/realm';
import { stabName, stabSigned } from '@/game/data/stability';
import { PLACED_JOBS, dayOf, moraleBreakdown } from '@/game/derived';
import { autoAssign } from '@/game/sim/workers';
import { stabLevel, stabOf } from '@/game/sim/stability';
import { groupsOf } from '@/game/sim/stabview';
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
import { JOB_BY_ID } from '@/game/data/jobs';
import { pilot, player, stand } from './autopilot';
import { CROWN_MTTH, CROWN_RULES, crownStab } from '@/game/crownrules';
import { CROWN_BY_ID } from '@/game/data/crown';
import { crownOf, crownRates } from '@/game/sim/crown';
import { AWAY_STEP } from '@/game/sim/mail';
import { gameDaysOfMs } from '@/game/pace';
import type { EstateId } from '@/game/types';
import {
  DISLOYAL,
  ENVY,
  ESTATES,
  ESTATE_DOMINANT,
  ESTATE_MINUS,
  ESTATE_PLUS,
  ESTATE_SPECIAL,
  LOYAL,
  LOYALTY_BASE,
  PRIV_LOYALTY,
  loyaltyFactor,
  loyaltyFrom,
  loyaltyParts,
  specialOf,
} from '@/game/estaterules';
import { ESTATE_META } from '@/game/data/estates';
import { estatesNow } from '@/game/derived';

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
  /** Сословия ровной игры (РТ-2): влияние ведущего на конец дня, сколько дней город назван специализацией и в перевесе. */
  lead: number[];
  special: number;
  dominant: number;
  /** Чья специализация и сколько дней. */
  types: Partial<Record<EstateId, number>>;
}

async function even(seed: number): Promise<Even> {
  const g = createInitialState(seed);
  autoAssign(g);
  const levels: number[] = [];
  const atZero: number[] = [];
  const lead: number[] = [];
  const types: Partial<Record<EstateId, number>> = {};
  let special = 0;
  let dominant = 0;
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
        const n = estatesNow(s);
        const infl = Object.fromEntries(ESTATES.map((e) => [e, n[e].infl])) as Record<EstateId, number>;
        const top = Math.max(...ESTATES.map((e) => infl[e]));
        lead.push(top);
        const sp = specialOf(infl);
        if (sp) {
          special++;
          types[sp] = (types[sp] ?? 0) + 1;
        }
        if (top >= ESTATE_DOMINANT) dominant++;
      },
    },
  });
  return { seed, levels, atZero, revolts: stabOf(g).revolts, bought: stabOf(g).bought, lead, special, dominant, types };
}

// ---------- Ц4: вести державы в ровной игре ----------

/** Ц4: около одной вести державы в настоящие сутки ровной игры. */
const CROWN_PER_DAY = 1;
/** Ц4: средний сдвиг стабильности от вестей за настоящие сутки — в пределах ±этого, % ступени. */
const CROWN_DRIFT_BAND = 5;
/** Настоящие сутки — игровых дней (сутки отлучки). */
const REAL_DAY = 48;
const CROWN_SEEDS = (process.env.CROWN_SEEDS ?? '1,2,3,4,5,6').split(',').map(Number).filter((n) => n > 0);
const CROWN_DAYS = Number(process.env.CROWN_DAYS) > 0 ? Number(process.env.CROWN_DAYS) : 480;

interface CrownRun {
  seed: number;
  /** Ответы: вид, номер ответа и номер молчания. */
  answers: { id: string; opt: number }[];
  /** Сумма весов по редкости (S = Σλ × CROWN_MTTH) на конец каждого игрового дня. */
  s: number[];
}

async function crownRun(seed: number): Promise<CrownRun> {
  const g = createInitialState(seed);
  autoAssign(g);
  const answers: CrownRun['answers'] = [];
  const s: number[] = [];
  let n = 0;
  let day = dayOf(g.time);
  await pilot({
    g,
    seconds: CROWN_DAYS * DAY_LENGTH,
    player: player('means', { tax: 'high' }),
    world: { seed, pulse: 30, raids: true },
    economy: 'live',
    tick: 1,
    decide: 30,
    watch: {
      after: ({ g: x }) => {
        const c = crownOf(x);
        for (const e of c.last) if (e.n > n) answers.push({ id: e.id, opt: e.opt });
        n = c.n;
        const d = dayOf(x.time);
        if (d === day) return;
        day = d;
        s.push(crownRates(x).reduce((t, [, l]) => t + l, 0) * CROWN_MTTH);
      },
    },
  });
  return { seed, answers, s };
}

interface CrownMeasure {
  runs: CrownRun[];
  /** Средняя S ровной игры. */
  sMean: number;
}

async function crownAll(): Promise<CrownMeasure> {
  const runs: CrownRun[] = [];
  for (const seed of CROWN_SEEDS) runs.push(await crownRun(seed));
  const all = runs.flatMap((r) => r.s);
  return { runs, sMean: all.length > 0 ? all.reduce((a, b) => a + b, 0) / all.length : 0 };
}

/** Шаг сетки почты, игровых дней, и сколько приходов в настоящие сутки. */
const SLOT_DAYS = gameDaysOfMs(AWAY_STEP);
const SLOTS_PER_DAY = REAL_DAY / SLOT_DAYS;

/** Срок, при котором ровная игра видит `CROWN_PER_DAY` вестей державы в сутки: `1 − exp(−Δ·S/M) = CROWN_PER_DAY / слотов`. */
const mtthFor = (sMean: number): number => Math.round((SLOT_DAYS * sMean) / -Math.log(1 - CROWN_PER_DAY / SLOTS_PER_DAY));

function printCrown(m: CrownMeasure): void {
  const days = (CROWN_DAYS / REAL_DAY) * m.runs.length;
  const all = m.runs.flatMap((r) => r.answers);
  console.log(`Ц4. Вести державы: ровная игра (как Ц1), ${CROWN_DAYS} игр. дн. (${CROWN_DAYS / REAL_DAY} настоящих суток), сиды ${CROWN_SEEDS.join(', ')}`);
  console.log(`  CROWN_MTTH ${CROWN_MTTH}; сумма весов по редкости S — ${m.sMean.toFixed(2)}; шаг сетки ${SLOT_DAYS.toFixed(0)} игр. дн.`);
  console.log(`  вестей ${all.length} — ${(all.length / days).toFixed(2)} в настоящие сутки (цель ${CROWN_PER_DAY}); выведенный срок ${mtthFor(m.sMean)}`);
  const kinds = ['good', 'bad', 'choice', 'chain'] as const;
  const word = { good: 'добрых', bad: 'дурных', choice: 'выборов', chain: 'следствий' };
  console.log(`  по нраву: ${kinds.map((k) => `${word[k]} ${all.filter((a) => CROWN_RULES[a.id]?.kind === k).length}`).join(', ')}`);
  const drift = all.reduce((t, a) => t + crownStab(a.id, a.opt), 0) / days;
  const quiet = all.reduce((t, a) => t + crownStab(a.id, CROWN_BY_ID[a.id]?.silence ?? 0), 0) / days;
  const ok = (v: number): string => (Math.abs(v) <= CROWN_DRIFT_BAND ? 'в цели' : 'ВНЕ ЦЕЛИ');
  console.log(`  сдвиг стабильности от вестей за настоящие сутки: ответы автопилота ${drift >= 0 ? '+' : '−'}${Math.abs(drift).toFixed(1)} % ступени (${ok(drift)}), молчание ${quiet >= 0 ? '+' : '−'}${Math.abs(quiet).toFixed(1)} % (${ok(quiet)}); цель ±${CROWN_DRIFT_BAND}`);
  const by = new Map<string, number>();
  for (const a of all) by.set(a.id, (by.get(a.id) ?? 0) + 1);
  console.log(`  какие: ${[...by.entries()].sort((a, b) => b[1] - a[1]).map(([id, k]) => `${CROWN_BY_ID[id]?.title ?? id} ${k}`).join('; ')}`);
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
  for (const job of PLACED_JOBS) if (isFood(job)) delete g.workers[job];
  g.freeJobs = {};
  return g;
}

/** Дело, чья работа даёт хлеб — по таблице профессий, а не списком. */
const isFood = (job: JobId): boolean => (JOB_BY_ID[job].yield.food ?? 0) > 0;

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
  /** Вести державы (Ц4); в замере тяги и тихих дней не меряются — им не нужны. */
  crown: CrownMeasure | null;
  /** Сословия (РТ-2, Ц5); в замере тяги и тихих дней не меряются. */
  estates?: EstatesMeasure;
}

async function measureAll(crown = true, estates = false): Promise<Measure> {
  const evens: Even[] = [];
  for (const seed of SEEDS) evens.push(await even(seed));
  const zero = evens.flatMap((e) => e.atZero);
  const g0 = zero.length > 0 ? zero.reduce((n, v) => n + v, 0) / zero.length : 0;
  return { g0, evens, hard: hard(), crown: crown ? await crownAll() : null, ...(estates ? { estates: await estatesAll() } : {}) };
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
  if (m.crown) {
    console.log('');
    printCrown(m.crown);
  }
  if (m.estates) {
    console.log('');
    printEstates(m.estates, m.evens);
  }
}

// ---------- Сословия (РТ-2) ----------

/** Ц5: опора даёт своему делу столько процентов (плюс долей) и платит столько (минус долей) — в среднем за прогон. */
const EST_PLUS = 10;
const EST_MINUS = 5;

/** Опора одного сословия на одном сиде: средние по дням — сила × лояльность/50 (плюс), сила (минус), влияние, лояльность. */
interface PillarRun {
  e: EstateId;
  seed: number;
  plus: number;
  minus: number;
  infl: number;
  loyalty: number;
  /** Сколько дней город назван специализацией своей опоры. */
  special: number;
  days: number;
}

async function pillar(e: EstateId, seed: number): Promise<PillarRun> {
  const g = createInitialState(seed);
  autoAssign(g);
  const acc = { plus: 0, minus: 0, infl: 0, loyalty: 0, special: 0, days: 0 };
  let day = dayOf(g.time);
  await pilot({
    g,
    seconds: DAYS * DAY_LENGTH,
    player: player('means', { tax: 'high', estates: [e] }),
    world: { seed, pulse: 30, raids: true },
    economy: 'live',
    tick: 1,
    decide: 30,
    watch: {
      after: ({ g: s }) => {
        const d = dayOf(s.time);
        if (d === day) return;
        day = d;
        const n = estatesNow(s);
        acc.plus += n[e].strength * loyaltyFactor(n[e].loyalty);
        acc.minus += n[e].strength;
        acc.infl += n[e].infl;
        acc.loyalty += n[e].loyalty;
        if (specialOf(Object.fromEntries(ESTATES.map((x) => [x, n[x].infl])) as Record<EstateId, number>) === e) acc.special++;
        acc.days++;
      },
    },
  });
  const k = Math.max(1, acc.days);
  return { e, seed, plus: acc.plus / k, minus: acc.minus / k, infl: acc.infl / k, loyalty: acc.loyalty / k, special: acc.special, days: acc.days };
}

/** Две опоры и трое пренебрежённых: пренебрежённые ропщут, ропот ведёт податных к мятежу СБ-1 — за сколько и сколько раз. */
interface Neglect {
  seed: number;
  /** Средняя лояльность пренебрежённых и средняя полоса податных по дням. */
  loyalty: number;
  folk: number;
  revolts: number;
  firstRevolt: number | null;
  minLevel: number;
}

const NEGLECT_PILLARS: readonly EstateId[] = ['merchants', 'knights'];

async function neglect(seed: number): Promise<Neglect> {
  const g = createInitialState(seed);
  autoAssign(g);
  const rest = ESTATES.filter((e) => !NEGLECT_PILLARS.includes(e));
  let loyalty = 0;
  let folk = 0;
  let days = 0;
  let firstRevolt: number | null = null;
  let minLevel = 0;
  let day = dayOf(g.time);
  await pilot({
    g,
    seconds: DAYS * DAY_LENGTH,
    player: player('means', { tax: 'high', estates: NEGLECT_PILLARS }),
    world: { seed, pulse: 30, raids: true },
    economy: 'live',
    tick: 1,
    decide: 30,
    watch: {
      after: ({ g: s }) => {
        const d = dayOf(s.time);
        if (d === day) return;
        day = d;
        const n = estatesNow(s);
        loyalty += rest.reduce((t, e) => t + n[e].loyalty, 0) / rest.length;
        folk += stabOf(s).folk;
        days++;
        if (firstRevolt === null && stabOf(s).revolts > 0) firstRevolt = d;
        minLevel = Math.min(minLevel, stabLevel(s));
      },
    },
  });
  const k = Math.max(1, days);
  return { seed, loyalty: loyalty / k, folk: folk / k, revolts: stabOf(g).revolts, firstRevolt, minLevel };
}

interface EstatesMeasure {
  pillars: PillarRun[];
  neglect: Neglect[];
}

async function estatesAll(withNeglect = true): Promise<EstatesMeasure> {
  const pillars: PillarRun[] = [];
  for (const e of ESTATES) for (const seed of SEEDS) pillars.push(await pillar(e, seed));
  const ng: Neglect[] = [];
  if (withNeglect) for (const seed of SEEDS) ng.push(await neglect(seed));
  return { pillars, neglect: ng };
}

/** Средние опоры сословия по сидам. */
const pillarMean = (m: EstatesMeasure, e: EstateId): { plus: number; minus: number; infl: number; loyalty: number; special: number; days: number } => {
  const runs = m.pillars.filter((p) => p.e === e);
  const k = Math.max(1, runs.length);
  const avg = (f: (p: PillarRun) => number): number => runs.reduce((t, p) => t + f(p), 0) / k;
  return { plus: avg((p) => p.plus), minus: avg((p) => p.minus), infl: avg((p) => p.infl), loyalty: avg((p) => p.loyalty), special: avg((p) => p.special), days: avg((p) => p.days) };
};

/** Выведенные польза и цена: цель Ц5, делённая на среднюю силу опоры (с лояльностью — для пользы). */
const estatesFrom = (m: EstatesMeasure): { plus: Record<EstateId, number>; minus: Record<EstateId, number> } => ({
  plus: Object.fromEntries(ESTATES.map((e) => [e, round(EST_PLUS / 100 / Math.max(1e-9, pillarMean(m, e).plus), 3)])) as Record<EstateId, number>,
  minus: Object.fromEntries(ESTATES.map((e) => [e, round(EST_MINUS / 100 / Math.max(1e-9, pillarMean(m, e).minus), 3)])) as Record<EstateId, number>,
});

/** Лояльность сословия при привилегиях — той же формулой, что игра (без даров и перевеса). */
const loyaltyAt = (e: EstateId, priv: Partial<Record<EstateId, number>>): number => loyaltyFrom(loyaltyParts(e, priv, 20, 0));

function printEstates(m: EstatesMeasure, evens: Even[]): void {
  console.log(`Сословия (РТ-2): P = ${PRIV_LOYALTY} лояльности своей привилегии, J = ${ENVY} зависти за чужую; пороги — верны от ${LOYAL}, ропщут ниже ${DISLOYAL}`);
  const one2 = { merchants: 1, knights: 1 };
  const two2 = { merchants: 2, knights: 2 };
  const all1 = Object.fromEntries(ESTATES.map((e) => [e, 1])) as Partial<Record<EstateId, number>>;
  const t1a = loyaltyAt('merchants', one2);
  const t1b = loyaltyAt('guilds', one2);
  const t3 = loyaltyAt('guilds', two2);
  const t2 = loyaltyAt('merchants', all1);
  console.log(`  Т1: по привилегии двум опорам — опоры ${t1a.toFixed(2)} (${t1a >= LOYAL ? 'верны' : 'НЕ ВЕРНЫ — цель нарушена'}), прочие ${t1b.toFixed(2)} (${t1b >= DISLOYAL ? 'не ропщут' : 'РОПЩУТ — цель нарушена'})`);
  console.log(`  Т2: по привилегии всем пятерым — каждое ${t2.toFixed(2)} (${t2 < LOYALTY_BASE ? 'ниже ровной' : 'НЕ НИЖЕ — цель нарушена'})`);
  console.log(`  Т3: по две двум опорам — пренебрежённые ${t3.toFixed(2)} (${t3 < DISLOYAL ? 'ропщут' : 'НЕ РОПЩУТ — цель нарушена'})`);
  console.log('');
  console.log(`  Ровная игра без привилегий (Ц1, ${DAYS} игр. дн.): влияние ведущего сословия и специализация (от ${ESTATE_SPECIAL} %), перевес (от ${ESTATE_DOMINANT} %)`);
  for (const e of evens) {
    const mean = e.lead.reduce((t, v) => t + v, 0) / Math.max(1, e.lead.length);
    const types = Object.entries(e.types).map(([k, v]) => `${ESTATE_META[k as EstateId].kind} ${v}`).join(', ') || '—';
    console.log(`    сид ${e.seed}: ведущее в среднем ${pct(mean)}, наибольшее ${pct(Math.max(...e.lead))}; специализация ${e.special} из ${e.lead.length} дней (${types}); перевес ${e.dominant} дней`);
  }
  console.log('');
  console.log(`  Ц5. Опора — обе привилегии одному сословию, автопилот Ц1, сиды ${SEEDS.join(', ')}: плюс +${EST_PLUS} %, минус −${EST_MINUS} %`);
  const d = estatesFrom(m);
  for (const e of ESTATES) {
    const p = pillarMean(m, e);
    const plus = 100 * ESTATE_PLUS[e] * p.plus;
    const minus = 100 * ESTATE_MINUS[e] * p.minus;
    console.log(
      `    ${ESTATE_META[e].name.padEnd(13)} влияние ${pct(p.infl)}, лояльность ${p.loyalty.toFixed(1)}, сила×лояльность ${p.plus.toFixed(4)}, сила ${p.minus.toFixed(4)}; ` +
        `плюс +${plus.toFixed(2)} %, минус −${minus.toFixed(2)} % при записанных ${ESTATE_PLUS[e]} / ${ESTATE_MINUS[e]}; выведено ${d.plus[e]} / ${d.minus[e]}; «${ESTATE_META[e].kind}» ${p.special.toFixed(0)} из ${p.days.toFixed(0)} дней`,
    );
  }
  if (m.neglect.length > 0) {
    console.log('');
    console.log(`  Две опоры (${NEGLECT_PILLARS.map((e) => ESTATE_META[e].name).join(' и ')}, по две привилегии), высокий налог: пренебрежённые и ропот у податных`);
    for (const n of m.neglect) {
      console.log(
        `    сид ${n.seed}: лояльность пренебрежённых ${n.loyalty.toFixed(1)}, полоса податных ${pct(n.folk)} в среднем; мятежей ${n.revolts}` +
          `${n.firstRevolt === null ? '' : `, первый на ${n.firstRevolt}-й день`}; ниже всего ${stabSigned(n.minLevel)}`,
      );
    }
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

const CROWN_FILE = fileURLToPath(new URL('../src/game/crownrules.ts', import.meta.url));

function writeMtth(m: number): void {
  writeFileSync(CROWN_FILE, readFileSync(CROWN_FILE, 'utf8').replace(/export const CROWN_MTTH = \d+;/, `export const CROWN_MTTH = ${m};`));
}

/** Один замер в дочернем процессе: модули игры читают записанные числа заново. */
function child(crown = false): Measure {
  const args = ['vite-node', fileURLToPath(import.meta.url), '--', '--measure', ...(crown ? ['--crown'] : [])];
  const r = spawnSync('npx', args, { encoding: 'utf8', env: process.env });
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
  // Срок вестей державы (Ц4) — после тяги и тихих дней: частота считается на ровной игре с ними. S от срока зависит слабо
  // (пришедшая весть ждёт срок повтора), поэтому повтор — до неподвижной точки; качается между двумя — полусумма.
  let mtth = CROWN_MTTH;
  const tried: number[] = [];
  for (let step = 1; step <= 6; step++) {
    const m = child(true).crown!;
    const next = mtthFor(m.sMean);
    console.log(`  вести, шаг ${step}: CROWN_MTTH ${mtth} → S ${m.sMean.toFixed(3)}, выведено ${next}`);
    if (Math.abs(next - mtth) <= Math.max(2, mtth * 0.01)) break;
    if (tried.includes(next)) {
      mtth = Math.round((mtth + next) / 2);
      writeMtth(mtth);
      break;
    }
    tried.push(mtth);
    mtth = next;
    writeMtth(mtth);
  }
  console.log(`DERIVE ${JSON.stringify({ drag, calm: calmOf(drag), mtth })}`);
}

const ESTATES_FILE = fileURLToPath(new URL('../src/game/estaterules.ts', import.meta.url));

/** Записать пользу и цену сословий в `estaterules.ts`. */
function writeEstates(plus: Record<EstateId, number>, minus: Record<EstateId, number>): void {
  const row = (r: Record<EstateId, number>): string => `{ ${ESTATES.map((e) => `${e}: ${r[e]}`).join(', ')} }`;
  let src = readFileSync(ESTATES_FILE, 'utf8');
  src = src.replace(/export const ESTATE_PLUS: Readonly<Record<EstateId, number>> = \{[^}]*\};/, `export const ESTATE_PLUS: Readonly<Record<EstateId, number>> = ${row(plus)};`);
  src = src.replace(/export const ESTATE_MINUS: Readonly<Record<EstateId, number>> = \{[^}]*\};/, `export const ESTATE_MINUS: Readonly<Record<EstateId, number>> = ${row(minus)};`);
  writeFileSync(ESTATES_FILE, src);
}

/** Замер опор в дочернем процессе: модули игры читают записанные числа заново. */
function childEstates(): EstatesMeasure {
  const r = spawnSync('npx', ['vite-node', fileURLToPath(import.meta.url), '--', '--measure-estates'], { encoding: 'utf8', env: process.env });
  const line = r.stdout.split('\n').find((x) => x.startsWith('ESTATES '));
  if (!line) throw new Error(`замер сословий не вернул числа:\n${r.stdout}\n${r.stderr}`);
  return JSON.parse(line.slice('ESTATES '.length)) as EstatesMeasure;
}

/**
 * Вывод Ц5 неподвижной точкой: польза и цена сословия — цель, делённая на среднюю силу опоры (с лояльностью — для пользы), а
 * сила опоры зависит от построек, которые подняла ровная игра с этой пользой. Повтор — пока выведенное не сойдётся с
 * записанным (до тысячной); качается между двумя — полусумма.
 */
async function deriveEstates(): Promise<void> {
  let plus = { ...ESTATE_PLUS } as Record<EstateId, number>;
  let minus = { ...ESTATE_MINUS } as Record<EstateId, number>;
  const seen: string[] = [];
  for (let step = 1; step <= 8; step++) {
    const d = estatesFrom(childEstates());
    const same = ESTATES.every((e) => Math.abs(d.plus[e] - plus[e]) <= 0.001 && Math.abs(d.minus[e] - minus[e]) <= 0.001);
    console.log(`  сословия, шаг ${step}: записано ${JSON.stringify({ plus, minus })} → выведено ${JSON.stringify(d)}`);
    if (same) break;
    const key = JSON.stringify(d);
    if (seen.includes(key)) {
      plus = Object.fromEntries(ESTATES.map((e) => [e, round((plus[e] + d.plus[e]) / 2, 3)])) as Record<EstateId, number>;
      minus = Object.fromEntries(ESTATES.map((e) => [e, round((minus[e] + d.minus[e]) / 2, 3)])) as Record<EstateId, number>;
      writeEstates(plus, minus);
      break;
    }
    seen.push(JSON.stringify({ plus, minus }));
    plus = d.plus;
    minus = d.minus;
    writeEstates(plus, minus);
  }
  console.log(`DERIVE_ESTATES ${JSON.stringify({ plus, minus })}`);
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  if (args.includes('--measure')) {
    console.log(`MEASURE ${JSON.stringify(await measureAll(args.includes('--crown')))}`);
    return;
  }
  if (args.includes('--measure-estates')) {
    console.log(`ESTATES ${JSON.stringify(await estatesAll(false))}`);
    return;
  }
  if (process.env.ESTATES_DERIVE === '1') {
    await deriveEstates();
    return;
  }
  if (args.includes('--derive')) {
    await derive();
    return;
  }
  print(await measureAll(true, true));
}

void main();
