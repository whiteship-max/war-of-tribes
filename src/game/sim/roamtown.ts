// Отряд бродяги у вольного города и села (ПН-6, docs/gdd/path_of_sword.md, 3.3.4, 3.4.3, 4.2; «Решения ПН-6»): постой, найм с
// учениями, хлеб села. Своих правил нет: плата постоя, хлеб и запас села — `townrules`; цена найма — та же, что у лорда в Казармах
// (`TroopDef.cost` + `gear`, время учений казарм первого уровня — `askrules.drillWork`, `drillRate`), недостающее — с рынка этого
// города дверью рынка с ключом (`sim/market.marketSpend`); у села — только хлеб по цене села. Своим модулем — в куске пути.
//
// Точку (вольный город или село) называет мир бродяги: сёла свои по сиду мира, и партия их сама не выводит (`world/roampoints`).
import type { BandBookOrder } from '../../../netlify/lib/contract';
import type { EquipmentId, GameState, GoodId, ResourceId, RoamDrill, RoamState, TroopId } from '../types';
import { TROOP_BY_ID } from '../data/troops';
import { GOOD_BY_ID, eqGood } from '../data/market';
import { DAY_LENGTH } from '../constants';
import { troopTotal } from '../battle/kinds';
import { boardDue, villageFoodPrice, villageLeft, villageStock, villageTaken, townKeyOf } from '../townrules';
import { DRILL_AHEAD_MS, drillMs, drillRate, drillWork } from '../askrules';
import { cargoCap } from '../cargocap';
import { roamCell, roamMoving } from '@/world/roam';
import { townAt } from '@/world/roampoints';
import { marketLeft, marketLot, marketSpend, provideTownSide } from './market';
import { TOWN_MARKETS, townMarketLevel } from '../townrules';
import { specMult, townCaravan, townSpecOf } from '@/world/townspec';
import { addStock } from './stock';
import { bandOf, bookKey, sendBook } from './bandranks';
import { log } from './log';

/** Точка найма и хлеба: вольный город (общий) или село (своё), как её видит мир бродяги. */
export interface TownPoint {
  id: string;
  kind: 'town' | 'village';
  x: number;
  y: number;
  name: string;
  tier: 0 | 1 | 2 | 3;
}

// Рынок с ключом (`sim/market`) узнаёт вольный город и обоз отсюда — кусок пути отдаёт их при загрузке.
provideTownSide({
  level: (key) => {
    const c = /^town:(-?\d+):(-?\d+)$/.exec(key);
    const t = c ? townAt(Number(c[1]), Number(c[2])) : null;
    return t && t.tier > 0 ? townMarketLevel(t.tier as 1 | 2 | 3) : 0;
  },
  // Специализация вольного города (ПН-Э1): множитель основы по товару — постоянной солью клетки (`world/townspec`).
  spec: (key, good) => {
    const c = /^town:(-?\d+):(-?\d+)$/.exec(key);
    const t = c ? townAt(Number(c[1]), Number(c[2])) : null;
    return t ? specMult(townSpecOf(t.x, t.y), good) : 1;
  },
  // Караванный кошель вольного города (ПН-Э2в): от уровня рынка ступени и специализации — одна сборка `world/townspec.townCaravan`.
  caravan: (key) => {
    const c = /^town:(-?\d+):(-?\d+)$/.exec(key);
    const t = c ? townAt(Number(c[1]), Number(c[2])) : null;
    return t && t.tier > 0 ? townCaravan(t.x, t.y, townMarketLevel(t.tier as 1 | 2 | 3)) : { cap: 0, refillMs: 0 };
  },
  // Сделка у вольного города — приказ книги торга сервера (ПН-Э2в): сервер выводит цену, кошель и товар сам и сверяет (`roambook`).
  deal: (s, key, good, n, gold, now) => {
    const c = /^town:(-?\d+):(-?\d+)$/.exec(key);
    if (c && bandOf(s)) sendBook(s, { op: 'trade', key: bookKey(s, 'trade'), at: { x: Number(c[1]), y: Number(c[2]) }, good, n, gold, t: now });
  },
  cap: cargoCap,
  keep: TOWN_MARKETS,
});

/** Сёл с покупками партия помнит не больше стольких; старые уходят — их запас давно отошёл. */
export const FED_MAX = 16;
/** Заказов найма на учениях — не больше стольких. */
export const DRILL_MAX = 8;

/** Клетка точки по её номеру (`town:x:y`, `village:x:y`). */
export function pointCell(id: string): { x: number; y: number } | null {
  const m = /^(?:town|village):(-?\d+):(-?\d+)$/.exec(id);
  return m ? { x: Number(m[1]), y: Number(m[2]) } : null;
}

/** Отряд стоит у точки: не в пути, в её клетке или соседней (лагерь у стен). */
export function standsAt(r: RoamState, now: number, at: { x: number; y: number }): boolean {
  if (!r.way || roamMoving(r.way, now)) return false;
  const c = roamCell(r.way, now);
  return Math.max(Math.abs(c.x - at.x), Math.abs(c.y - at.y)) <= 1;
}

/** На постое: отряд стоит в самой клетке вольного города (ГДД 3.7.1, 4.2). Нет — `null`. */
export function boardedAt(r: RoamState, now: number): { x: number; y: number; name: string } | null {
  if (!r.way || roamMoving(r.way, now)) return null;
  const c = roamCell(r.way, now);
  const t = townAt(c.x, c.y);
  return t ? { x: t.x, y: t.y, name: t.name } : null;
}

const add = (rec: Partial<Record<string, number>>, k: string, d: number): void => {
  const n = (rec[k] ?? 0) + d;
  if (n > 0) rec[k] = n;
  else delete rec[k];
};

/**
 * Шаг отряда у города (`sim/roam.roamStep`, настоящая минута куска `now`): плата постоя за головы отряда и игровые секунды; учения
 * найма — первый заказ у точки, где отряд стоит, работой казарм первого уровня; остаток куска идёт следующему заказу той же точки.
 */
export function townStep(s: GameState, dt: number, now: number): void {
  const r = s.roam;
  if (!r || !(dt > 0)) return;
  const board = boardedAt(r, now);
  if (board) {
    const due = boardDue(troopTotal(r.band), dt);
    r.purse = Math.max(0, r.purse - due);
  }
  let left = dt;
  while (left > 0 && r.drill?.length) {
    const d = r.drill.find((x) => {
      const c = pointCell(x.at);
      return c !== null && standsAt(r, now, c);
    });
    if (!d) return;
    const rate = drillRate(d.kind);
    const need = d.work / rate;
    if (need > left) {
      d.work -= rate * left;
      return;
    }
    left -= need;
    add(r.band, d.kind, d.n);
    r.drill = r.drill.filter((x) => x !== d);
    if (!r.drill.length) delete r.drill;
    log(s, `Учения окончены: ${TROOP_BY_ID[d.kind].name.toLowerCase()}, ${d.n} — в строю.`, 'good');
  }
}

// ---------- найм ----------

/** Что найм `n` бойцов вида у точки стоит: золото рынка (или села), что возьмут из обоза и что докупят. */
export interface HireBill {
  gold: number;
  fromCargo: Partial<Record<ResourceId, number>>;
  fromGear: Partial<Record<EquipmentId, number>>;
  /** Что докупить у точки: товар рынка (`GoodId`) — сколько. */
  buy: Record<string, number>;
  /** Сколько настоящих мс учений — подряд за прежними заказами. */
  ms: number;
  block: string | null;
}

/** Сколько учений уже заказано вперёд — настоящих мс (работа, что осталась, при скорости казарм первого уровня). */
const queuedMs = (r: RoamState): number => (r.drill ?? []).reduce((t, d) => t + drillMs(d.kind, d.work / drillWork(d.kind)), 0);

/**
 * Найм `n` бойцов вида у точки по ценам лорда (ГДД 3.4.3): припас найма и снаряжение — из обоза, недостающее — у точки: в вольном
 * городе — рынком этого города по его цене (нажим как у всех), в селе — только хлеб по цене села. Время — учения казарм первого уровня.
 */
export function hireBill(s: GameState, p: TownPoint, kind: TroopId, n: number, now: number): HireBill {
  const r = bandOf(s);
  const empty: HireBill = { gold: 0, fromCargo: {}, fromGear: {}, buy: {}, ms: 0, block: null };
  if (!r) return { ...empty, block: 'Отряда нет.' };
  if (!(n > 0) || !Number.isInteger(n)) return { ...empty, block: 'Сколько нанять?' };
  const t = TROOP_BY_ID[kind];
  const out: HireBill = { ...empty, ms: drillMs(kind, n) };
  const key = townKeyOf(p.x, p.y);
  const lack: string[] = [];
  const need = (good: string, have: number, want: number): number => {
    const take = Math.min(Math.max(0, Math.floor(have)), want);
    const miss = want - take;
    if (miss <= 0) return take;
    if (p.kind === 'town') {
      const def = GOOD_BY_ID[good];
      if (miss > marketLeft(s, def, now, key)) lack.push(`${def.name.toLowerCase()} — на рынке только ${marketLeft(s, def, now, key)}`);
      else {
        out.buy[good] = miss;
        out.gold += marketLot(s, def, miss, now, key).gold;
      }
    } else if (good === 'food') {
      const left = villageLeftAt(r, p.id, now);
      if (miss > left) lack.push(`хлеб — у села только ${Math.floor(left)}`);
      else {
        out.buy.food = miss;
        out.gold += villageCost(miss);
      }
    } else lack.push(`${GOOD_BY_ID[good].name.toLowerCase()} — в селе не купить`);
    return take;
  };
  for (const [res, k] of Object.entries(t.cost) as [ResourceId, number][]) {
    const take = need(res, r.cargo[res] ?? 0, k * n);
    if (take > 0) out.fromCargo[res] = take;
  }
  for (const [e, k] of Object.entries(t.gear) as [EquipmentId, number][]) {
    const take = need(eqGood(e), r.gear[e] ?? 0, k * n);
    if (take > 0) out.fromGear[e] = take;
  }
  if (!standsAt(r, now, p)) out.block = p.kind === 'town' ? 'Нанимают, стоя в городе или у его стен.' : 'Нанимают, стоя у села.';
  else if (lack.length) out.block = `Не хватает: ${lack.join('; ')}.`;
  else if (r.purse < out.gold) out.block = `Не хватает золота: нужно ${out.gold}, в кошеле ${Math.floor(r.purse)}.`;
  else if ((r.drill?.length ?? 0) >= DRILL_MAX) out.block = 'Казармы заняты: заказов слишком много.';
  else if (queuedMs(r) + out.ms > DRILL_AHEAD_MS) out.block = 'Казармы заняты: учений больше чем на сутки.';
  return out;
}

/** Нанять `n` бойцов вида у точки: заплатить, взять из обоза, поставить на учения, приказ книги. Отказ — словами. */
export function hireAt(s: GameState, p: TownPoint, kind: TroopId, n: number, now: number): string | null {
  const bill = hireBill(s, p, kind, n, now);
  if (bill.block) return bill.block;
  const r = s.roam as RoamState;
  const key = townKeyOf(p.x, p.y);
  for (const [good, k] of Object.entries(bill.buy)) {
    if (p.kind === 'town') {
      const why = marketSpend(s, good as GoodId, k, now, key);
      if (why) return why;
    } else takeVillage(r, p.id, k, now);
  }
  for (const [res, k] of Object.entries(bill.fromCargo) as [ResourceId, number][]) addStock(s, res, -k, cargoCap(r), 'cargo');
  for (const [e, k] of Object.entries(bill.fromGear) as [EquipmentId, number][]) add(r.gear, e, -k);
  const drill: RoamDrill = { kind, n, at: p.id, work: drillWork(kind) * n, key: bookKey(s, 'hire') };
  r.drill = [...(r.drill ?? []), drill];
  const order: BandBookOrder = { op: 'hire', key: drill.key, kind, n, at: { x: p.x, y: p.y } };
  sendBook(s, order);
  log(s, `Наняты у ${p.kind === 'town' ? 'города' : 'села'} ${p.name}: ${TROOP_BY_ID[kind].name.toLowerCase()}, ${n} — на учения.`, 'info');
  return null;
}

// ---------- хлеб села ----------

/** Сколько хлеба село продаст сейчас (`townrules.villageLeft` от записи покупок). */
export function villageLeftAt(r: RoamState, id: string, now: number): number {
  const f = r.fed?.find((x) => x.id === id);
  return f ? villageLeft(f.took, f.at, now) : villageStock();
}

/** Взять у села `n` хлеба: золото по цене села и запись покупок (отход запаса — от неё); в обоз кладёт вызывающий. */
function takeVillage(r: RoamState, id: string, n: number, now: number): void {
  const f = r.fed?.find((x) => x.id === id);
  const took = (f ? villageTaken(f.took, f.at, now) : 0) + n;
  r.purse -= villageCost(n);
  r.fed = [{ id, took, at: now }, ...(r.fed ?? []).filter((x) => x.id !== id)].slice(0, FED_MAX);
}

/** Цена `n` хлеба у села — золотом, вверх до целого. */
export const villageCost = (n: number): number => Math.ceil(Math.max(0, n) * villageFoodPrice());

/** Почему нельзя купить `n` хлеба у села сейчас; `null` — можно. */
export function villageBlock(s: GameState, p: TownPoint, n: number, now: number): string | null {
  const r = bandOf(s);
  if (!r) return 'Отряда нет.';
  if (!standsAt(r, now, p)) return 'Хлеб продают, стоя у села.';
  if (!(n > 0)) return 'Сколько купить?';
  const left = villageLeftAt(r, p.id, now);
  if (n > left) return `У села только ${Math.floor(left)}: запас дня разобран.`;
  const load = Object.values(r.cargo).reduce((t: number, k) => t + Math.max(0, k ?? 0), 0);
  const room = Math.floor(cargoCap(r) - load);
  if (n > room) return room > 0 ? `В обоз влезет только ${room}.` : 'Обоз полон.';
  if (r.purse < villageCost(n)) return `Не хватает золота: нужно ${villageCost(n)}.`;
  return null;
}

/** Купить хлеб у села (ГДД 3.3.4): цена села, запас дня с отходом, в обоз. */
export function buyVillageFood(s: GameState, p: TownPoint, n: number, now: number): string | null {
  const why = villageBlock(s, p, n, now);
  if (why) return why;
  const r = s.roam as RoamState;
  const gold = villageCost(n);
  takeVillage(r, p.id, n, now);
  addStock(s, 'food', n, cargoCap(r), 'cargo');
  log(s, `Хлеб у села ${p.name}: ${n} за ${gold} золота.`, 'info', `village:${p.id}`, 'trade');
  return null;
}

/** Плата постоя отряда за игровой день — для окна города (правило 18: та же функция, что шаг). */
export const boardPerDay = (r: RoamState): number => boardDue(troopTotal(r.band), DAY_LENGTH);
