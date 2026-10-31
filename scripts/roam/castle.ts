// Вольный замок автопилотом (ПН-10, docs/gdd/path_of_sword.md, 3.11 и 2.4): штурм с ходу или осада — **сервером войны в памяти**
// (`netlify/lib/war.ts`: поход отряда `marchFree`, НПС-слепок, стена, фазы, голод → последняя вылазка), теми же дверями, что у игрока.
// Своей арифметики боя здесь нет: замок, гарнизон и хлеб — `world/freecastle`, исход — запись войны.
import { advance, applyOrder, emptyWars, type WarRow } from '../../netlify/lib/war';
import { emptyRoster } from '../../netlify/lib/roster';
import type { RosterFile } from '../../netlify/lib/contract';
import { freeId, freePrestige, freeTroopPower, freeTroops, type FreeTier } from '../../src/world/freecastle';
import { troopPower } from '../../src/game/battle/price';
import { roamSeat } from '../../src/world/roam';
import { SICILY } from '../../src/world/spawn';
import { troopTotal, type TroopStack } from '../../src/game/battle/kinds';

/** Где стоит замок прибора: клетка Сицилии (земля места боя — та же дверь `place.groundAt`, что у игрока). */
const AT = SICILY[0];
const FREE = freeId(AT.x, AT.y);
const KEY = 'tg-pilot';
const HOUR = 3_600_000;
/** Дольше осада автопилота не стоит: замок без хлеба выходит раньше (прибор печатает часы). */
const SIEGE_MAX_H = 24 * 14;

export interface CastleTry {
  won: boolean;
  /** Сколько отряд потерял за дело: павшие, истощение лагеря, выбитые башней. */
  lost: TroopStack;
  /** Часов от приказа до конца дела. */
  hours: number;
}

/**
 * Одно дело у стен вольного замка ступени `tier`: штурм с ходу (`storm`) или осада (`siege`). Отряд стоит у стен; минута приказа —
 * от `seed` (номер войны и кость фаз — от неё, как у сервера). Победа — замок взят (штурмом или отбитой последней вылазкой).
 */
export function castleTry(band: TroopStack, tier: FreeTier, mode: 'storm' | 'siege', seed: number): CastleTry {
  if (troopTotal(band) <= 0) return { won: false, lost: {}, hours: 0 };
  const { w, troops, t0 } = castleWar(band, tier, mode, seed);
  const lost: TroopStack = {};
  for (const [k, n] of Object.entries(troops)) {
    const d = n - ((w.army.troops as Record<string, number>)[k] ?? 0);
    if (d > 0) lost[k as keyof TroopStack] = d;
  }
  return { won: w.end === 'taken', lost, hours: ((w.endAt ?? t0) - t0) / HOUR };
}

/** Война у стен вольного замка целиком — запись сервера войны в памяти (одна дверь у `castleTry` и разбора карты). */
function castleWar(band: TroopStack, tier: FreeTier, mode: 'storm' | 'siege', seed: number): { w: WarRow; troops: Record<string, number>; t0: number } {
  const t0 = Date.UTC(2026, 9, 30) + (Math.abs(seed) % 46_656) * 60_000;
  const troops = Object.fromEntries(Object.entries(band).filter(([, n]) => (n ?? 0) > 0)) as Record<string, number>;
  const roster: RosterFile = {
    ...emptyRoster(),
    bands: {
      [KEY]: {
        way: roamSeat({ x: AT.x + 1, y: AT.y }, t0).way,
        born: t0,
        name: 'Прибор',
        prestige: freePrestige(tier),
        men: troopTotal(band),
        seenAt: t0,
        book: { troops, join: -1, drill: 0, fights: 0, grant: 0, keys: [] },
      },
    },
    free: { [FREE]: { x: AT.x, y: AT.y, tier, born: t0 } },
  };
  const file = emptyWars();
  const no = applyOrder(file, KEY, { op: 'march', target: FREE, mode, fate: 'occupy', army: { troops, resolve: 0, pips: {} } }, t0, { roster, sheet: () => null, roamOpen: true });
  if (no) throw new Error(`прибор: приказ на вольный замок не принят — ${no}`);
  const w = file.wars[0];
  for (let t = w.arriveAt + 1; w.phase !== 'done' && t <= t0 + SIEGE_MAX_H * HOUR; t += HOUR) advance(file, t, new Map());
  if (w.phase === 'march' || w.phase === 'camp') applyOrder(file, KEY, { op: 'retreat', id: w.id }, t0 + SIEGE_MAX_H * HOUR, { roster, sheet: () => null, roamOpen: true });
  return { w, troops, t0 };
}

/** Бой войны у стен для разбора карты: где, кто взял верх, лагерь и вышедшие — сколько было и сколько пало, доля отдыха лагеря. */
export interface CastleFight {
  site: string;
  /** Взял ли верх тот, кто начал бой (у вылазки — вышедшие из ворот). */
  won: boolean;
  camp: number;
  campLost: number;
  sortie: number;
  sortieLost: number;
  /** Доля отдыха лагеря в бою (`world/rest`), если бой её несёт. */
  campRest: number | null;
}

/** Разбор осады карты: исход и бои по порядку — тем же сервером войны, что `castleTry`. */
export function castleTrace(band: TroopStack, tier: FreeTier, seed: number): { end: string; fights: CastleFight[] } {
  const { w } = castleWar(band, tier, 'siege', seed);
  const fights = w.battles.map((b) => {
    const input = b.input as { defender?: { rest?: number } } | undefined;
    return {
      site: b.site,
      won: b.won,
      camp: troopTotal(b.atkTroops as TroopStack),
      campLost: troopTotal(b.atkLost as TroopStack),
      sortie: troopTotal(b.homeTroops as TroopStack),
      sortieLost: troopTotal(b.homeLost as TroopStack),
      campRest: typeof input?.defender?.rest === 'number' ? input.defender.rest : null,
    };
  });
  return { end: w.end ?? w.phase, fights };
}

// ---------- карта осады по числу нападающих (ПН-Э2а) ----------
//
// Монотонен ли исход осады вольного замка по числу нападающих: больше людей того же состава — не хуже. Карта нужна окну замка
// (`freecastle.freeNeeds`, находка 23.4 (1)): строка «Сила отряда … против гарнизона» обещает «да» при равной мощи, и окну надо знать,
// с какой силы осада берёт замок и нет ли точек, где лишний человек её роняет. Бой и осада — тем же `castleTry` (сервер войны в памяти).

/** Состав нападающих карты: копейщики (их растит стиль «к замку», ГДД 3.7.0) или состав гарнизона самой ступени. */
export type MapArmy = 'spear' | 'mirror';
export const MAP_ARMIES: readonly MapArmy[] = ['spear', 'mirror'];
export const MAP_ARMY_WORDS: Readonly<Record<MapArmy, string>> = { spear: 'копейщики', mirror: 'состав гарнизона' };

/** Грубая сетка карты — доли мощи гарнизона ступени; 0.6 — предел наёмников ВР3 (ГДД 3.17). */
export const MAP_COARSE: readonly number[] = [0.5, 0.6, 0.75, 1, 1.25, 1.5, 2, 2.5, 3, 3.5, 4, 4.5, 5, 5.5, 6, 7, 8];

/** Гарнизон ступени у замка карты (тот, что встанет на стену у сервера войны в `castleTry`). */
export const mapGarrison = (tier: FreeTier): TroopStack => freeTroops(FREE, tier);

/** Отряд карты в `men` человек: копейщики или доли гарнизона ступени — наибольшими остатками, вид по имени при равных. */
export function mapBand(army: MapArmy, tier: FreeTier, men: number): TroopStack {
  if (army === 'spear') return { spearman: men };
  const g = mapGarrison(tier);
  const all = troopTotal(g);
  const parts = (Object.entries(g) as [keyof TroopStack, number][]).map(([id, n]) => ({ id, exact: (n * men) / all }));
  const out: TroopStack = {};
  for (const p of parts) out[p.id] = Math.floor(p.exact);
  const left = men - troopTotal(out);
  parts.sort((a, b) => b.exact - Math.floor(b.exact) - (a.exact - Math.floor(a.exact)) || (a.id < b.id ? -1 : 1));
  for (let i = 0; i < left; i++) out[parts[i % parts.length].id] = (out[parts[i % parts.length].id] ?? 0) + 1;
  return out;
}

/** Точка карты: людей, мощь (`troopPower`) и исход осады на каждом сиде. */
export interface MapPoint {
  men: number;
  power: number;
  won: boolean[];
}

/** Падение на карте: на сиде `seed` при `won` людях замок взят, при `lost` (больше) — нет. */
export interface MapDrop {
  seed: number;
  won: number;
  lost: number;
}

export interface CastleMap {
  tier: FreeTier;
  army: MapArmy;
  /** Мощь гарнизона ступени бойцами (`freeTroopPower`) и сам гарнизон. */
  garrison: number;
  troops: TroopStack;
  /** Шаг у порога, людей. */
  step: number;
  points: MapPoint[];
  /** Первая точка, где взят хоть на одном сиде, и первая, с которой взят на всех до конца карты; `null` — нет такой. */
  first: MapPoint | null;
  full: MapPoint | null;
  drops: MapDrop[];
}

/**
 * Падения карты: на каком сиде при скольких людях замок взят, а при следующей точке (больше людей того же состава) — нет. Точки — по
 * возрастанию людей; сид — номер с единицы.
 */
export function mapDrops(points: readonly MapPoint[]): MapDrop[] {
  const drops: MapDrop[] = [];
  const seeds = points[0]?.won.length ?? 0;
  for (let s = 0; s < seeds; s++) {
    for (let i = 1; i < points.length; i++) if (points[i - 1].won[s] && !points[i].won[s]) drops.push({ seed: s + 1, won: points[i - 1].men, lost: points[i].men });
  }
  return drops;
}

/** Размер карты: сидов на точку, шаг у порога — доля гарнизона, по одному ли человеку в вилке порога, сколько грубых точек после порога. */
export interface MapSize {
  seeds: number;
  fine: number;
  man: boolean;
  tail: number;
}

/**
 * Карта осады ступени `tier` составом `army` (ПН-Э2а), уточнением в три слоя:
 *   1. грубая сетка `MAP_COARSE` — до первой точки, где замок взят на всех сидах, и ещё `tail` точек за ней;
 *   2. у порога — от последней грубой точки без взятий до первой, где взят на всех, — шагом `fine` доли гарнизона;
 *   3. `man` — по одному человеку в вилке, уточнённой шагом 2: от последней точки без взятий до первой, с которой взят на всех.
 * Сиды — `1…seeds` (минута приказа и кость фаз — от сида, как у `castleTry`). Падения — переходы «взят → не взят» с ростом людей на
 * одном сиде по всем точкам карты.
 */
export function castleMap(tier: FreeTier, army: MapArmy, size: MapSize): CastleMap {
  const { seeds } = size;
  const garrison = freeTroopPower(FREE, tier);
  const perMan = troopPower(mapBand(army, tier, 1000)) / 1000;
  const menAt = (k: number): number => Math.max(1, Math.round((k * garrison) / perMan));
  const seen = new Map<number, MapPoint>();
  const at = (men: number): MapPoint => {
    let p = seen.get(men);
    if (!p) {
      const band = mapBand(army, tier, men);
      p = { men, power: troopPower(band), won: Array.from({ length: seeds }, (_, i) => castleTry(band, tier, 'siege', i + 1).won) };
      seen.set(men, p);
    }
    return p;
  };
  const any = (p: MapPoint): boolean => p.won.some(Boolean);
  const all = (p: MapPoint): boolean => p.won.every(Boolean);
  const coarse: MapPoint[] = [];
  let after = -1;
  for (const k of MAP_COARSE) {
    const p = at(menAt(k));
    coarse.push(p);
    if (after < 0 && all(p)) after = 0;
    else if (after >= 0 && ++after >= size.tail) break;
  }
  const sorted = (): MapPoint[] => [...seen.values()].sort((a, b) => a.men - b.men);
  /** Вилка порога по точкам карты: последняя без взятий перед первым взятием и первая, с которой взят на всех до конца. */
  const bracket = (): [number, number] | null => {
    const ps = sorted();
    const i0 = ps.findIndex(any);
    if (i0 < 0) return null;
    let i1 = ps.length - 1;
    while (i1 > 0 && all(ps[i1 - 1]) && all(ps[i1])) i1--;
    return [i0 > 0 ? ps[i0 - 1].men : 1, all(ps[i1]) ? ps[i1].men : ps[ps.length - 1].men];
  };
  const step = Math.max(1, Math.round((size.fine * garrison) / perMan));
  const b1 = bracket();
  if (b1) for (let men = b1[0] + step; men < b1[1]; men += step) at(men);
  const b2 = size.man ? bracket() : null;
  if (b2) for (let men = b2[0] + 1; men < b2[1]; men++) at(men);
  const points = sorted();
  const drops = mapDrops(points);
  const first = points.find(any) ?? null;
  let full: MapPoint | null = null;
  for (let i = points.length - 1; i >= 0 && all(points[i]); i--) full = points[i];
  return { tier, army, garrison, troops: mapGarrison(tier), step: size.man ? 1 : step, points, first, full, drops };
}
