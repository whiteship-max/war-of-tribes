// Доля обнаружений по видам лагеря (ГДД 3.5.3, 3.5.4, 3.14; «Решения ПН-4у») — вывод чисел видимости из целей и их следствия.
//
// ЦЕЛИ (ГДД 3.5.4, «Цели обнаружения») — по строке на число: «скрытый лагерь в лесу круг замка видит не дальше 6 клеток» и т. д.
// Каждая цель — положение отряда (местность, лагерь, люди, ночь, сезон) и наблюдатель; мерка — дверь игры (`world/sight`:
// `conspicuity`, `detectRange`) на той таблице, что выводится. Вывод — неподвижной точкой (правило 16): проход правит каждое число
// так, чтобы его цель сошлась, на числах прохода; проходы повторяются, пока выведенное не сойдётся с записанным. Густота руин —
// шагом в клетку за проход от записанной, пока шаг не встанет; качание между двумя решает меньшая (гуще — цель выполнена). Числа идут
// в таблицу игры (`world/data/sight.ts`, `SEASON_MODIFIERS.camouflage`) переносом напечатанного; тест сверяет записанное с выводом
// (`roam.test.ts`).
//
// ДОЛЯ ОБНАРУЖЕНИЙ — следствие чисел на настоящей земле: какую долю клеток суши живого круга наблюдателя отряд не может пройти
// незамеченным — вокруг замков мира выборки (расселение игры, `settle.placeCastle` через `pool.placeAll`), днём и ночью, летом и зимой.
// Мест выхода бродяг выборка нарочно не берёт: их зазор — заглушка ПН-17 (`spawnGap`), и раздел на ней стал бы «НЕ ИЗМЕРЕНО».
import type { Season } from '../../src/game/types';
import type { Terrain } from '../../src/world/types';
import type { CampKind } from '../../src/world/roammove';
import { SEASON_MODIFIERS } from '../../src/game/data/seasons';
import { RUIN_BLOCK, RUIN_CAP, SIGHT, type SightTable } from '../../src/world/data/sight';
import { CASTLE_EYE, conspicuity, detectRange, seasonCamo, type Look, type Stance, type Watcher } from '../../src/world/sight';
import { terrainAt } from '../../src/world/geography';
import { WAR_GROUND_SEED } from '../../src/world/pvp';
import { nearestRuin, ruinAt } from '../../src/world/ruins';
import { inWorldCell, isWaterAt, settleable } from '../../src/world/land';
import { placeAll } from './pool';

/** Цели обнаружения, клеток (кроме `ruinsNear` — доли). Наблюдатель — круг замка, отряд — 20 человек днём летом, если не сказано иное. */
export interface SightGoals {
  /** Ц1. Скрытый лагерь в поле. */
  hiddenField: number;
  /** Ц2. Открытый лагерь в поле. */
  openField: number;
  /** Ц3. Скрытый лагерь в лесу. */
  hiddenForest: number;
  /** Ц4. Скрытый лагерь в холмах (и в горах). */
  hiddenHills: number;
  /** Ц5. Скрытый лагерь в пустыне. */
  hiddenDesert: number;
  /** Ц6. Лагерь в руинах. */
  ruins: number;
  /** Ц7. Колонна обычным маршем по полю. */
  marchField: number;
  /** Ц8. Колонна налегке по полю. */
  marchLight: number;
  /** Ц9. Колонна с обозом по полю. */
  marchTrain: number;
  /** Ц10. Скрытый лагерь в поле ночью. */
  nightField: number;
  /** Ц11. Скрытый лагерь в лесу зимой. */
  winterForest: number;
  /** Ц12. Сотня открытым лагерем в поле. */
  hundredOpen: number;
  /** Ц13. Одиночка скрытым лагерем в лесу. */
  loneForest: number;
  /** Ц14. Стоящий отряд видит колонну обычным маршем по полю. */
  bandSeesMarch: number;
  /** Ц15. Отряд, заполнивший руины до вместимости, — не дальше этого. */
  ruinsFull: number;
  /** Ц16. Доля клеток земли двора, у которых ближайшие руины — в обзоре стоящего отряда. */
  ruinsNear: number;
}

/**
 * Цели обнаружения — решение ПН-4у (ГДД 3.5.4, «Цели обнаружения», строки Ц1–Ц16). Владелец перерешает цель одной строкой ГДД и
 * этой строкой, потом переносит выведенное разделом в таблицу игры; тест сверяет строки ГДД с этими числами (`roam.test.ts`).
 */
export const SIGHT_GOALS: SightGoals = {
  hiddenField: 12,
  openField: 22,
  hiddenForest: 6,
  hiddenHills: 8,
  hiddenDesert: 14,
  ruins: 5,
  marchField: 25,
  marchLight: 20,
  marchTrain: 33,
  nightField: 8,
  winterForest: 8,
  hundredOpen: 50,
  loneForest: 3,
  bandSeesMarch: 12,
  ruinsFull: 6,
  ruinsNear: 0.75,
};

/** Числа, которые выводятся: таблица видимости, зима из таблицы сезонов, вместимость и густота руин. */
export interface SightNumbers {
  table: SightTable;
  winter: number;
  cap: number;
  block: number;
}

/** Записанное в игре — то, с чего вывод начинает и с чем сверяет. */
export const writtenSight = (): SightNumbers => ({ table: SIGHT, winter: SEASON_MODIFIERS.winter.camouflage ?? 1, cap: RUIN_CAP, block: RUIN_BLOCK });

const CASTLE = CASTLE_EYE;
const BAND: Watcher = { kind: 'band', at: { x: 0, y: 0 } };

const base: Look = { terrain: 'plain', ruinCap: null, stance: { camp: 'hidden' }, men: 20, night: false, season: 'summer' };
const look = (over: Partial<Look>): Look => ({ ...base, ...over });
const camoOf =
  (winter: number) =>
  (s: Season): number =>
    s === 'winter' ? winter : seasonCamo(s);

/** На сколько клеток наблюдатель видит отряд в положении `l` при числах `n` — дверью игры. */
export const rangeOf = (n: SightNumbers, l: Look, w: Watcher = CASTLE): number => detectRange(w, conspicuity(l, n.table, camoOf(n.winter)), n.table);

const r2 = (x: number): number => Math.round(x * 100) / 100;
const r1 = (x: number): number => Math.round(x * 10) / 10;

/** Каждая цель: что за положение, кто смотрит и какую величину правит. Порядок — порядок прохода. */
export const GOAL_ROWS: readonly { id: keyof SightGoals; what: string; look?: Look; watcher?: Watcher }[] = [
  { id: 'hiddenField', what: 'скрытый лагерь в поле', look: look({}) },
  { id: 'openField', what: 'открытый лагерь в поле', look: look({ stance: { camp: 'open' } }) },
  { id: 'hiddenForest', what: 'скрытый лагерь в лесу', look: look({ terrain: 'forest' }) },
  { id: 'hiddenHills', what: 'скрытый лагерь в холмах и горах', look: look({ terrain: 'hills' }) },
  { id: 'hiddenDesert', what: 'скрытый лагерь в пустыне', look: look({ terrain: 'desert' }) },
  { id: 'ruins', what: 'лагерь в руинах', look: look({ stance: { camp: 'ruin' }, ruinCap: 1e6 }) },
  { id: 'marchField', what: 'колонна обычным маршем по полю', look: look({ stance: { march: 'normal' } }) },
  { id: 'marchLight', what: 'колонна налегке по полю', look: look({ stance: { march: 'light' } }) },
  { id: 'marchTrain', what: 'колонна с обозом по полю', look: look({ stance: { march: 'train' } }) },
  { id: 'nightField', what: 'скрытый лагерь в поле ночью', look: look({ night: true }) },
  { id: 'winterForest', what: 'скрытый лагерь в лесу зимой', look: look({ terrain: 'forest', season: 'winter' }) },
  { id: 'hundredOpen', what: 'сотня открытым лагерем в поле', look: look({ stance: { camp: 'open' }, men: 100 }) },
  { id: 'loneForest', what: 'одиночка скрытым лагерем в лесу', look: look({ terrain: 'forest', men: 1 }) },
  { id: 'bandSeesMarch', what: 'стоящий отряд видит колонну обычным маршем по полю', look: look({ stance: { march: 'normal' } }), watcher: BAND },
  { id: 'ruinsFull', what: 'руины, заполненные до вместимости, — не дальше', look: undefined },
  { id: 'ruinsNear', what: 'доля земли, где руины в обзоре стоящего отряда', look: undefined },
];

/** Где руины прячут полный отряд: лагерь в руинах ровно на вместимость. */
const fullRuins = (n: SightNumbers): Look => look({ stance: { camp: 'ruin' }, ruinCap: n.cap, men: n.cap });

/** Мир выборки: сколько лордов расселить правилом игры (`settle.placeCastle`). */
export interface RoadWorld {
  lords: number;
}

/** Замки мира выборки — расселением игры, по миру на сид. */
export const sampleCastles = (runs: number, world: RoadWorld): { x: number; y: number }[] =>
  Array.from({ length: runs }, (_, i) => placeAll(i + 1, world.lords, 0, 0).lords).flat();

/**
 * Клетки земли двора (`land.settleable` — где могли стоять дворы, а значит и руины) в рамке замков мира выборки с запасом круга
 * замка, через клетку: земля, по которой ходит бродяга между соседями.
 */
export function sampleLand(castles: readonly { x: number; y: number }[]): { x: number; y: number }[] {
  const pad = Math.ceil(detectRange(CASTLE, 1));
  const out: { x: number; y: number }[] = [];
  const seen = new Set<string>();
  for (const c of castles) {
    for (let y = c.y - pad; y <= c.y + pad; y += 2) {
      for (let x = c.x - pad; x <= c.x + pad; x += 2) {
        const key = `${x}|${y}`;
        if (seen.has(key)) continue;
        seen.add(key);
        if (inWorldCell(x, y) && settleable(x, y)) out.push({ x, y });
      }
    }
  }
  return out;
}

/** Доля клеток выборки, у которых ближайшие руины густоты `block` — не дальше `radius` (обзор стоящего отряда). */
export function ruinsNearShare(block: number, radius: number, cells: readonly { x: number; y: number }[]): number {
  let near = 0;
  for (const c of cells) if (nearestRuin(c, radius, block)) near++;
  return cells.length > 0 ? near / cells.length : 0;
}

export interface Derived {
  numbers: SightNumbers;
  passes: number;
  converged: boolean;
  /** Что не сходится и почему; пусто — всё сошлось. */
  why: string[];
}

/**
 * Вывод неподвижной точкой: проход правит числа по целям на числах самого прохода; проходы — пока выведенное не сойдётся с
 * записанным в начале прохода. Не сошлось за `maxPasses` — `converged: false` и причина.
 */
export function deriveSight(goals: SightGoals, from: SightNumbers, runs: number, world: RoadWorld, maxPasses = 24): Derived {
  const land = sampleLand(sampleCastles(runs, world));
  let n: SightNumbers = structuredClone(from);
  const why: string[] = [];
  const blocks: number[] = [];
  for (let pass = 1; pass <= maxPasses; pass++) {
    const before = JSON.stringify(n);
    const t = structuredClone(n.table) as { -readonly [K in keyof SightTable]: SightTable[K] } & {
      ground: Record<Terrain, number>;
      camp: Record<CampKind, number>;
      gait: Record<'light' | 'normal' | 'train', number>;
      size: { per: number; pow: number; floor: number };
    };
    let next: SightNumbers = { ...n, table: t };
    // Множитель, линейный в мерке: множитель × цель / мерка.
    const scale = (id: keyof SightGoals, get: () => number, set: (v: number) => void, round = r2): void => {
      const row = GOAL_ROWS.find((r) => r.id === id) as (typeof GOAL_ROWS)[number];
      const got = rangeOf(next, row.look as Look, row.watcher);
      if (got > 0) set(round((get() * goals[id]) / got));
    };
    scale('hiddenField', () => t.camp.hidden, (v) => (t.camp.hidden = v));
    scale('openField', () => t.camp.open, (v) => (t.camp.open = v));
    scale('hiddenForest', () => t.ground.forest, (v) => (t.ground.forest = v));
    scale('hiddenHills', () => t.ground.hills, (v) => ((t.ground.hills = v), (t.ground.mountains = v)));
    scale('hiddenDesert', () => t.ground.desert, (v) => (t.ground.desert = v));
    // Степь не прячет — как поле (решение ПН-4у); поле — мерка местности, единица.
    t.ground.steppe = t.ground.plain;
    scale('ruins', () => t.camp.ruin, (v) => (t.camp.ruin = v));
    scale('marchField', () => t.march, (v) => (t.march = v));
    scale('marchLight', () => t.gait.light, (v) => (t.gait.light = v));
    scale('marchTrain', () => t.gait.train, (v) => (t.gait.train = v));
    scale('nightField', () => t.night, (v) => (t.night = v));
    scale('winterForest', () => next.winter, (v) => (next = { ...next, winter: v }));
    // Размер: сотня даёт степень, одиночка — пол (если пол ниже степенной кривой, цель одиночки недостижима — причина).
    {
      const row = GOAL_ROWS.find((r) => r.id === 'hundredOpen') as (typeof GOAL_ROWS)[number];
      const at20 = rangeOf(next, { ...(row.look as Look), men: t.size.per });
      if (at20 > 0) t.size.pow = r2(Math.log(goals.hundredOpen / at20) / Math.log(100 / t.size.per));
      const lone = GOAL_ROWS.find((r) => r.id === 'loneForest') as (typeof GOAL_ROWS)[number];
      const at20f = rangeOf(next, { ...(lone.look as Look), men: t.size.per });
      const need = at20f > 0 ? goals.loneForest / at20f : 0;
      const curve = Math.pow(1 / t.size.per, t.size.pow);
      if (need >= curve) t.size.floor = r2(need);
      else if (pass === 1) why.push(`одиночка: цель ${goals.loneForest} кл. ниже кривой размера (${(curve * at20f).toFixed(1)} кл.) — полом её не достать`);
    }
    scale('bandSeesMarch', () => t.band, (v) => (t.band = v), r1);
    // Вместимость руин: больше всего людей, которых руины прячут не дальше цели.
    {
      let cap = 1;
      while (cap < 1000 && rangeOf(next, fullRuins({ ...next, cap: cap + 1 })) <= goals.ruinsFull) cap++;
      next = { ...next, cap };
    }
    // Густота руин — шаг за проход от записанной: реже, пока цель держится; гуще, если не держится.
    {
      const b = next.block;
      const radius = t.band;
      if (ruinsNearShare(b + 1, radius, land) >= goals.ruinsNear) next = { ...next, block: b + 1 };
      else if (ruinsNearShare(b, radius, land) < goals.ruinsNear && b > 2) next = { ...next, block: b - 1 };
      blocks.push(next.block);
      const k = blocks.length;
      // Качание между двумя (a, b, a, b): берётся меньшая — гуще, цель выполнена.
      if (k >= 4 && blocks[k - 1] === blocks[k - 3] && blocks[k - 2] === blocks[k - 4] && blocks[k - 1] !== blocks[k - 2]) {
        next = { ...next, block: Math.min(blocks[k - 1], blocks[k - 2]) };
      }
    }
    n = next;
    if (JSON.stringify(n) === before) return { numbers: n, passes: pass, converged: true, why };
  }
  why.push(`за ${maxPasses} проходов выведенное не сошлось с записанным`);
  return { numbers: n, passes: maxPasses, converged: false, why };
}

/** Мерка каждой цели при числах `n`: сколько вышло. */
export function goalCheck(goals: SightGoals, n: SightNumbers, runs: number, world: RoadWorld): { id: keyof SightGoals; what: string; goal: number; got: number }[] {
  return GOAL_ROWS.map((row) => {
    const got =
      row.id === 'ruinsFull' ? rangeOf(n, fullRuins(n)) : row.id === 'ruinsNear' ? ruinsNearShare(n.block, n.table.band, sampleLand(sampleCastles(runs, world))) : rangeOf(n, row.look as Look, row.watcher);
    return { id: row.id, what: row.what, goal: goals[row.id], got };
  });
}

// ---------- Доля обнаружений ----------

/** Положения отряда в таблице доли: лагерь трёх видов, в поле без лагеря, колонна трёх режимов. */
export const STANCES: readonly [string, Stance][] = [
  ['открытый лагерь', { camp: 'open' }],
  ['скрытый лагерь', { camp: 'hidden' }],
  ['лагерь в руинах', { camp: 'ruin' }],
  ['в поле без лагеря', { field: true }],
  ['в пути налегке', { march: 'light' }],
  ['в пути обычным', { march: 'normal' }],
  ['в пути с обозом', { march: 'train' }],
];

/** Клетки суши живого круга вокруг точки: местность и есть ли руины. */
function landDisc(at: { x: number; y: number }, r: number): { x: number; y: number; terrain: Terrain; ruin: boolean }[] {
  const out: { x: number; y: number; terrain: Terrain; ruin: boolean }[] = [];
  const R = Math.floor(r);
  for (let dy = -R; dy <= R; dy++) {
    for (let dx = -R; dx <= R; dx++) {
      if (dx * dx + dy * dy > r * r) continue;
      const x = at.x + dx;
      const y = at.y + dy;
      if (!inWorldCell(x, y) || isWaterAt(x, y)) continue;
      out.push({ x, y, terrain: terrainAt(WAR_GROUND_SEED, x, y), ruin: ruinAt(x, y) !== null });
    }
  }
  return out;
}

/**
 * Доля клеток суши в живом круге наблюдателя, где отряд в положении `stance` виден: вокруг замков лордов мира дороги автопилота.
 * Лагерь в руинах — только на клетках руин. `w` — наблюдатель (круг замка или стоящий отряд) на месте каждого замка.
 */
export function detectShare(stance: Stance, men: number, night: boolean, season: Season, kind: 'castle' | 'band', runs: number, world: RoadWorld): number {
  let seen = 0;
  let all = 0;
  {
    for (const c of sampleCastles(runs, world)) {
      const w: Watcher = { kind, at: c };
      const live = detectRange(w, 1);
      for (const cell of landDisc(c, live)) {
        if ('camp' in stance && stance.camp === 'ruin' && !cell.ruin) continue;
        all++;
        const l: Look = { terrain: cell.terrain, ruinCap: cell.ruin ? RUIN_CAP : null, stance, men, night, season };
        if (Math.hypot(cell.x - c.x, cell.y - c.y) <= detectRange(w, conspicuity(l))) seen++;
      }
    }
  }
  return all > 0 ? seen / all : NaN;
}
