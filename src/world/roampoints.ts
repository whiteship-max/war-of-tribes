// Точки мира бродяги (ПН-5, docs/gdd/path_of_sword.md, 3.5.1 и «Решения ПН-5»): вольные города НПС I–III, сёла и ватаги НПС.
// Логова — те, что уже стоят в мире (`world/gen`, поселения мира бродяги): своей сыпи логов здесь нет.
//
// ОБЩИЕ И СВОИ — как в таблице 3.5.1:
//   — **вольный город — общий**: стоит у всех в одном месте (рынок, наём и договоры у него общие, ПН-6/7), поэтому выводится из земли
//     постоянной солью, как руины (`world/ruins`): один город на квадрат земли, в квадрате — годная клетка с наименьшим хешем. Сид
//     игрока или мира сюда не попадает — у двоих города разъехались бы;
//   — **село и ватага — свои**: фоновая жизнь, которую клиент выдумывает сам, как логова (3.5.1, «Почему»), — соль мешается с сидом
//     мира партии, и у каждого игрока они свои.
// Годная клетка — земля двора (`land.settleable`: суша, не русло, не хребет); на руинах и друг на друге точки не встают.
//
// Числа без вывода (густота, доли ступеней городов) — заглушки игры (`game/roamstubs`, за выключателем). Модуль чистый и без `@/`:
// его собирает сервер (вольные города общие — с ПН-6/ПН-10 их читает реестр).
import { hash2 } from './geography';
import { inWorldCell, settleable } from './land';
import { ruinAt } from './ruins';
import { roamStub } from '../game/roamstubs';
import { TOWN_NAMES, VATAGA_NAMES, VILLAGE_NAMES } from './data/roampoints';

/** Вид точки бродяги: вольный город, село, ватага НПС. */
export type PointKind = 'town' | 'village' | 'vataga';
export const POINT_KINDS: readonly PointKind[] = ['town', 'village', 'vataga'];

export interface RoamPoint {
  /** `town:x:y`, `village:x:y`, `vataga:x:y` — одна клетка, одна точка. */
  id: string;
  kind: PointKind;
  x: number;
  y: number;
  name: string;
  /** Ступень вольного города I–III; у села и ватаги — 0. */
  tier: 0 | 1 | 2 | 3;
}

/** Соль вольных городов — своё постоянное число: города не садятся на клетки руин и бродов. */
export const TOWN_SALT = 0x70a1;
/** Соли сёл и ватаг — мешаются с сидом мира партии: у каждого свои. */
export const VILLAGE_SALT = 0x5e10;
export const VATAGA_SALT = 0x3a7a;

const floorTo = (v: number, block: number): number => Math.floor(v / block) * block;
const mixSeed = (seed: number, salt: number): number => (Math.imul(seed | 0, 0x9e3779b1) ^ salt) >>> 0;

/** Годная клетка квадрата с наименьшим хешем соли `salt`, кроме занятых `taken`; нет — `null`. */
function pickOfBlock(salt: number, bx: number, by: number, block: number, taken: (x: number, y: number) => boolean): { x: number; y: number } | null {
  let best: { x: number; y: number } | null = null;
  let bestH = Infinity;
  for (let y = by; y < by + block; y++) {
    for (let x = bx; x < bx + block; x++) {
      if (!inWorldCell(x, y) || !settleable(x, y) || taken(x, y)) continue;
      const h = hash2(salt, x, y);
      if (h < bestH) {
        bestH = h;
        best = { x, y };
      }
    }
  }
  return best;
}

const nameOf = (list: readonly string[], salt: number, x: number, y: number): string => list[Math.floor(hash2(salt + 11, x, y) * list.length) % list.length];

/** Ступень вольного города по долям `townTier` (I, II, III) — вторым хешем клетки. */
function tierOf(x: number, y: number): 1 | 2 | 3 {
  const share = roamStub('townTier');
  const h = hash2(TOWN_SALT + 3, x, y);
  let acc = 0;
  for (let i = 0; i < share.length; i++) {
    acc += share[i];
    if (h < acc) return (i + 1) as 1 | 2 | 3;
  }
  return 3;
}

/** Кэш квадратов по виду, сиду и размеру. */
const blocks = new Map<string, RoamPoint | null>();

function townOfBlock(bx: number, by: number): RoamPoint | null {
  const block = roamStub('townBlock');
  const key = `t:${block}:${bx}|${by}`;
  const have = blocks.get(key);
  if (have !== undefined) return have;
  const at = pickOfBlock(TOWN_SALT, bx, by, block, (x, y) => ruinAt(x, y) !== null);
  const p: RoamPoint | null = at ? { id: `town:${at.x}:${at.y}`, kind: 'town', x: at.x, y: at.y, name: nameOf(TOWN_NAMES, TOWN_SALT, at.x, at.y), tier: tierOf(at.x, at.y) } : null;
  blocks.set(key, p);
  return p;
}

/** Вольный город в клетке или `null` (общий: сида нет). */
export function townAt(x: number, y: number): RoamPoint | null {
  const block = roamStub('townBlock');
  const t = townOfBlock(floorTo(x, block), floorTo(y, block));
  return t && t.x === Math.round(x) && t.y === Math.round(y) ? t : null;
}

function ownOfBlock(kind: 'village' | 'vataga', seed: number, bx: number, by: number): RoamPoint | null {
  const block = roamStub(kind === 'village' ? 'villageBlock' : 'vatagaBlock');
  const key = `${kind}:${seed}:${block}:${bx}|${by}`;
  const have = blocks.get(key);
  if (have !== undefined) return have;
  const salt = mixSeed(seed, kind === 'village' ? VILLAGE_SALT : VATAGA_SALT);
  // Ватага не встаёт на село: у села своё ополчение, а не стан разбойников.
  const taken = (x: number, y: number): boolean => ruinAt(x, y) !== null || townAt(x, y) !== null || (kind === 'vataga' && villageAt(seed, x, y) !== null);
  const at = pickOfBlock(salt, bx, by, block, taken);
  const p: RoamPoint | null = at
    ? { id: `${kind}:${at.x}:${at.y}`, kind, x: at.x, y: at.y, name: nameOf(kind === 'village' ? VILLAGE_NAMES : VATAGA_NAMES, salt, at.x, at.y), tier: 0 }
    : null;
  blocks.set(key, p);
  return p;
}

/** Село мира `seed` в клетке или `null`. */
export function villageAt(seed: number, x: number, y: number): RoamPoint | null {
  const block = roamStub('villageBlock');
  const v = ownOfBlock('village', seed, floorTo(x, block), floorTo(y, block));
  return v && v.x === Math.round(x) && v.y === Math.round(y) ? v : null;
}

/** Ватага НПС мира `seed` в клетке или `null`. */
export function vatagaAt(seed: number, x: number, y: number): RoamPoint | null {
  const block = roamStub('vatagaBlock');
  const v = ownOfBlock('vataga', seed, floorTo(x, block), floorTo(y, block));
  return v && v.x === Math.round(x) && v.y === Math.round(y) ? v : null;
}

/** Точка мира `seed` в клетке: город, село или ватага; ничего — `null`. */
export const pointAt = (seed: number, x: number, y: number): RoamPoint | null => townAt(x, y) ?? villageAt(seed, x, y) ?? vatagaAt(seed, x, y);

/** Точки в прямоугольнике `[x0, x1) × [y0, y1)` — для карты и прибора. */
export function pointsIn(seed: number, x0: number, y0: number, x1: number, y1: number): RoamPoint[] {
  const out: RoamPoint[] = [];
  const scan = (block: number, of: (bx: number, by: number) => RoamPoint | null): void => {
    for (let by = floorTo(y0, block); by < y1; by += block) {
      for (let bx = floorTo(x0, block); bx < x1; bx += block) {
        const p = of(bx, by);
        if (p && p.x >= x0 && p.x < x1 && p.y >= y0 && p.y < y1) out.push(p);
      }
    }
  };
  scan(roamStub('townBlock'), townOfBlock);
  scan(roamStub('villageBlock'), (bx, by) => ownOfBlock('village', seed, bx, by));
  scan(roamStub('vatagaBlock'), (bx, by) => ownOfBlock('vataga', seed, bx, by));
  return out;
}

const TIER_WORD = ['', 'I', 'II', 'III'] as const;

/** Вид точки словами — для карты и окна хода. */
export function pointKindWords(p: Pick<RoamPoint, 'kind' | 'tier'>): string {
  if (p.kind === 'town') return `вольный город ${TIER_WORD[p.tier]}`;
  return p.kind === 'village' ? 'село' : 'ватага НПС';
}

/**
 * Что даёт точка — словами (ГДД 3.5.1). В Срезе 1 у города — место и вход (рынок, наём и договоры откроются позже, ПН-6/7), у села —
 * хлеб и люди позже (ПН-6), у ватаги — бой (охота); разбоя сёл нет (Р10).
 */
export function pointWords(p: RoamPoint): string {
  if (p.kind === 'town') return `${p.name} — ${pointKindWords(p)}: войти и встать на постой; рынок, наём и договоры откроются позже.`;
  if (p.kind === 'village') return `${p.name} — село: хлеб и люди откроются позже. Разбоя нет.`;
  return `${p.name} — стан разбойников: можно напасть.`;
}

/** Забыть посчитанное (тесты, подмена заглушек). */
export function dropPoints(): void {
  blocks.clear();
}
