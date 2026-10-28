// Лестница поражения — что стоит взятый город на этапах партии (docs/DEFEAT_LADDER.md) — и окна защиты после ступеней (docs/time.md,
// раздел 19): одна функция на разделы «лестница» и «окна защиты» `sack:report` и на вывод `BURN_IMMUNE` (`npm run derive -- burn`,
// ПБ-1, п. 6; docs/siege_v2.md, «Решения ПБ-1»). Код перенесён из `sack-report.ts` дословно; отчёт зовёт его отсюда, и его вывод тот
// же.
import { playerProfile } from '@/world/bridge';
import { FATE_DEFAULT, FATE_IDS, fallSeed, fate, homeLoss } from '@/world/spoils';
import type { Fate, HomeEffect } from '@/world/types';
import { createInitialState } from '@/game/state';
import { bondedTotal, netPerDay, taxIncomePerDay, upgradeCost } from '@/game/derived';
import { BUILDINGS } from '@/game/data/buildings';
import { RESOURCE_IDS } from '@/game/constants';
import { seeded, setRandom } from '@/game/sim/random';
import type { GameState, ResourceId } from '@/game/types';
import { dayRealSeconds, gameDaysPerHour } from '@/game/pace';
import { land, pilot, player } from './autopilot';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/**
 * Во что обходится взятый город — тем же способом, каким мерился расчёт
 * docs/DEFEAT_LADDER.md: автопилот `pop:report` ведёт партию, на семи этапах с
 * неё снимается копия, к копии применяется участь, и автопилот ведёт её дальше.
 * Участь применяется настоящим путём — слепок деревни (`playerProfile`), дверь
 * участи (`spoils.fate`), поля последствия (`homeLoss`) и `applyEffects`, — а не
 * своей арифметикой: отчёт, считающий участь сам, мерил бы свою копию правила.
 *
 * Отставание — насколько позже тронутая партия дошла до того, где нетронутая
 * стояла через час (сумма уровней и люди). Сид событий у обеих копий один, поэтому
 * ноль значит «не стоило ничего», а минуты в минус — шум автопилота.
 */
const LADDER_STAGES = [0, 0.5, 1, 2, 3, 4.5, 6.5];
/** Шаг симуляции автопилота, с: как в расчёте документа (у pop:report — 1). */
const LADDER_SIM = 3;
const LADDER_STEP = 15;
export const LADDER_GOAL = 3600;
export const LADDER_HORIZON = 5 * 3600;
/** Соли выбора пяти построек на этап: цена зависит от того, какие попались. */
const LADDER_SEEDS = [1, 2, 3, 4, 5];
/** Мир лестницы — тихий: набегов нет, он называет посёлку веру и больше ничего не делает. */
const LADDER_WORLD = 7;

/**
 * Партия общим автопилотом: живая игра при игроке, ответы на события, вера мира. Решает раз в
 * `LADDER_STEP`, шаг симуляции `LADDER_SIM`, пульс тихого мира — тем же тактом. `until` — цель.
 */
const ladderRun = async (s: GameState, seconds: number, until?: (x: GameState) => boolean): Promise<void> => {
  if (seconds <= 0) return;
  await pilot({
    g: s,
    seconds,
    player: player(null),
    world: { seed: LADDER_WORLD, pulse: LADDER_STEP, raids: false },
    economy: 'live',
    tick: LADDER_SIM,
    decide: LADDER_STEP,
    until,
  });
};
const levelSum = (s: GameState): number => s.buildings.reduce((n, b) => n + b.level, 0);

type Blow = { stock: boolean; levels: boolean; morale: number; sacked?: number; fate?: Fate };

/** Применить к копии участь взятого города — ту, что сейчас в игре, частями или целиком. */
function strike(s: GameState, blow: Blow, seed: number): { fell: number; rebuild: number; narrow: number } {
  const p = playerProfile(s);
  // Чистая выработка до удара — ею и меряется отстройка: сколько минут копить узкий припас.
  const net = netPerDay(s);
  const r = fate({
    fate: blow.fate ?? FATE_DEFAULT,
    stock: blow.stock ? p.stock : {},
    gold: blow.stock ? (p.gold ?? 0) : 0,
    stash: p.stash,
    pop: p.pop,
    bonded: p.bonded ?? 0,
    // Обоз не мешает: отряд, взявший город, уносит всё открытое (docs/sack.md).
    carry: Infinity,
    escort: Infinity,
    levels: blow.levels ? p.levels : undefined,
    seed,
  });
  const before = new Map(s.buildings.map((b) => [b.id, b.level]));
  const effect: HomeEffect = {
    id: 'лестница',
    lost: {},
    prestige: 0,
    morale: blow.morale,
    battle: blow.sacked ? 'lost' : null,
    sacked: blow.sacked,
    text: 'Город взят.',
    good: false,
    ...homeLoss(r),
  };
  land(s, [effect]);
  let fell = 0;
  let rebuild = 0;
  const need: Partial<Record<ResourceId, number>> = {};
  for (const b of s.buildings) {
    const was = before.get(b.id) ?? b.level;
    for (let l = b.level + 1; l <= was; l++) {
      fell++;
      const c = upgradeCost(BUILDINGS.find((d) => d.id === b.type)!, l);
      for (const r of RESOURCE_IDS) {
        need[r] = (need[r] ?? 0) + (c[r] ?? 0);
        rebuild += c[r] ?? 0;
      }
    }
  }
  // Выработка — за игровой день; в настоящих минутах день длится `dayRealSeconds() / 60`.
  const narrow = Math.max(0, ...RESOURCE_IDS.map((r) => (((need[r] ?? 0) / Math.max(1, net[r])) * dayRealSeconds()) / 60));
  return { fell, rebuild, narrow };
}

/** Через сколько секунд после копии тронутая партия догнала цель; null — не догнала за горизонт. */
async function reach(s: GameState, goalLevels: number, goalPop: number, stageSeed: number): Promise<number | null> {
  setRandom(seeded(stageSeed));
  const t0 = s.time;
  let hit: number | null = null;
  await ladderRun(s, LADDER_HORIZON, (x) => {
    if (levelSum(x) >= goalLevels && x.pop >= goalPop) hit = Math.round(x.time - t0);
    return hit !== null;
  });
  return hit;
}

/** Что город потерял на одной ступени — замером на копии посёлка. */
export type StepLoss = { fate: Fate; goods: number; gold: number; ledPop: number; ledBonded: number; scatter: number; levels: number; works: number };

/**
 * Три ступени на одной копии этапа: слепок, дверь участи, поля последствия, применение —
 * и потеря, замеренная на посёлке. Обоз и конвой не мешают: так документ считал и
 * «уведено горожан», и «ресурсов на отстройку».
 */
function ladderSteps(snap: GameState, seed: number): StepLoss[] {
  return FATE_IDS.map((f) => {
    const s = structuredClone(snap);
    const p = playerProfile(s);
    const r = fate({
      fate: f,
      stock: p.stock,
      gold: p.gold ?? 0,
      stash: p.stash,
      pop: p.pop,
      bonded: p.bonded ?? 0,
      carry: Infinity,
      escort: Infinity,
      levels: p.levels,
      seed,
    });
    const goods0 = RESOURCE_IDS.reduce((n, x) => n + s.resources[x], 0);
    const gold0 = s.gold;
    const pop0 = s.pop;
    const bonded0 = bondedTotal(s);
    const levels0 = s.buildings.reduce((n, b) => n + b.level, 0);
    const works0 = s.buildings.filter((b) => b.workRequired > 0).length;
    land(s, [{ id: 'лестница', lost: {}, prestige: 0, morale: 0, battle: null, text: 'Город взят.', good: false, ...homeLoss(r) }]);
    const popLost = pop0 - s.pop;
    const bondedLost = bonded0 - bondedTotal(s);
    return {
      fate: f,
      goods: Math.round(goods0 - RESOURCE_IDS.reduce((n, x) => n + s.resources[x], 0)),
      gold: gold0 - s.gold,
      ledPop: Math.min(popLost, r.ledPop.taken),
      ledBonded: Math.min(bondedLost, r.ledBonded.taken),
      scatter: popLost - Math.min(popLost, r.ledPop.taken) + bondedLost - Math.min(bondedLost, r.ledBonded.taken),
      levels: levels0 - s.buildings.reduce((n, b) => n + b.level, 0),
      works: works0 - s.buildings.filter((b) => b.workRequired > 0).length,
    };
  });
}

export type LadderRow = {
  stage: number;
  levelAvg: number;
  pop: number;
  open: number;
  stash: number;
  goldHour: number;
  plunderOnly: number | null;
  levelsLag: number[];
  fell: number[];
  rebuild: number[];
  narrow: number[];
  /** Узкий припас на отстройку каждой ступени, минут чистой выработки: 'plunder' | 'captives' | 'burn'. */
  stepNarrow: Record<Fate, number>;
  hunger: number | null;
  raid: number | null;
  steps: StepLoss[];
};
/**
 * Лестница поражения: партия общим автопилотом до каждого этапа `LADDER_STAGES`, на этапе — копия и участь взятого города
 * настоящим путём. Одна функция на раздел «лестница» `sack:report` и на вывод `BURN_IMMUNE` (`npm run derive -- burn`).
 */
export async function defeatLadder(): Promise<LadderRow[]> {
const ladder: LadderRow[] = [];
{
  setRandom(seeded(1));
  // Сид партии закреплён: с пачки 3 приход вестей — функция сида (`sim/mail.awayArrival`), а
  // `createInitialState()` без довода берёт его у устройства. Два прогона на одном коде
  // расходились рядами лестницы, и «СДВИНУЛСЯ» в приёмке частью был этим шумом — та же
  // находка, что у `pop:report` (docs/time.md, раздел 16.10), только `sack` тогда не поправили.
  const base = createInitialState(7);
  base.tutorialDone = true;
  let clock = 0;
  for (const h of LADDER_STAGES) {
    const stage = h * 3600;
    setRandom(seeded(7 + stage));
    await ladderRun(base, stage - clock);
    clock = stage;
    const snap = structuredClone(base);
    const stageSeed = 1000 + stage;
    const free = structuredClone(snap);
    setRandom(seeded(stageSeed));
    await ladderRun(free, LADDER_GOAL);
    const goalL = levelSum(free);
    const goalP = free.pop;
    const p = playerProfile(snap);
    const tryBlow = async (blow: Blow, seed: number) => {
      const c = structuredClone(snap);
      const hit = strike(c, blow, seed);
      return { ...hit, lag: await reach(c, goalL, goalP, stageSeed) };
    };
    const levels = [];
    for (const k of LADDER_SEEDS) levels.push(await tryBlow({ stock: false, levels: true, morale: 0 }, fallSeed(k, stage * 1000)));
    const moderate = { ...snap, tax: 'moderate' } as GameState;
    ladder.push({
      stage: h,
      levelAvg: levelSum(snap) / snap.buildings.length,
      pop: snap.pop,
      open: fate({ fate: FATE_DEFAULT, stock: p.stock, gold: 0, stash: p.stash, pop: 0, bonded: 0, carry: Infinity, escort: 0, seed: 0 }).takenTotal,
      steps: ladderSteps(snap, fallSeed(1, stage * 1000)),
      stash: p.stash,
      goldHour: taxIncomePerDay(moderate) * gameDaysPerHour(),
      plunderOnly: (await tryBlow({ stock: true, levels: false, morale: 0 }, 0)).lag,
      levelsLag: levels.map((x) => (x.lag === null ? Infinity : x.lag)),
      fell: levels.map((x) => x.fell),
      rebuild: levels.map((x) => x.rebuild),
      narrow: levels.map((x) => x.narrow),
      hunger: (await tryBlow({ stock: true, levels: true, morale: -12 }, fallSeed(1, stage * 1000))).lag,
      raid: (await tryBlow({ stock: true, levels: true, morale: -10, sacked: 1 }, fallSeed(1, stage * 1000))).lag,
      // Последним полем нарочно: `strike` тратит общую кость, и замер, вставленный раньше,
      // сдвинул бы числа лестницы, которые считаются до него. Следующий этап кость пересевает.
      stepNarrow: Object.fromEntries(
        FATE_IDS.map((f) => [f, strike(structuredClone(snap), { stock: false, levels: true, morale: 0, fate: f }, fallSeed(1, stage * 1000)).narrow]),
      ) as Record<Fate, number>,
    });
  }
}
return ladder;
}

export const median = (xs: number[]): number => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];

/** Окно по правилу: наибольшая отстройка по этапам, округлённая вверх до суток игрока. */
export const windowOf = (mins: number[]): { hours: number; days: number } => {
  const worst = mins.length > 0 ? Math.max(...mins) : 0;
  const hours = worst / 60;
  return { hours, days: Math.max(1, Math.ceil((hours * HOUR) / DAY)) };
};

export interface ProtectWindows {
  /** По этапам: отстройка после грабежа (медиана солей) и после сожжения, минут чистой выработки. */
  rows: { stage: number; plunder: number; burn: number }[];
  plunder: { hours: number; days: number };
  burn: { hours: number; days: number };
}

/**
 * Окна защиты по правилу (docs/time.md, раздел 19): окно — наибольшая по этапам отстройка снятого, округлённая вверх до суток
 * игрока; этап, где грабить нечего (отстройка ноль), в окно не входит.
 */
export function protectWindows(ladder: readonly LadderRow[]): ProtectWindows {
  const rebuildMin: Record<'plunder' | 'burn', number[]> = { plunder: [], burn: [] };
  const rows = ladder.map((r) => {
    const base = median(r.narrow);
    const burn = r.stepNarrow.burn;
    if (base > 0) {
      rebuildMin.plunder.push(base);
      rebuildMin.burn.push(burn);
    }
    return { stage: r.stage, plunder: base, burn };
  });
  return { rows, plunder: windowOf(rebuildMin.plunder), burn: windowOf(rebuildMin.burn) };
}
