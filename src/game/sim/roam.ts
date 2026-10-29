// Шаг партии бродяги (ПН-1, docs/gdd/path_of_sword.md, 6.1 и 3.3; «Решения ПН-1»).
//
// Партия одна: фаза (`GameState.phase`) решает, чем живёт шаг. Лорд — посёлком (`sim/tick.tick`), бродяга — отрядом
// (`roamStep`): посёлка у бродяги ещё нет (его даст взятый замок, ПН-11), и поля посёлка в фазе бродяги спят. Выбирает дверь
// диспетчер — живой шаг и отлучка (`sim/tick.liveStep`, `absence`), с теми же часами, тем же порогом отлучки и тем же потолком
// догона, что у лорда. За выключателем (`roamflag.ROAM_ON`) диспетчер, вход и чтение фазы бродяги не пускают.
//
// Своих правил у шага нет — он зовёт двери ПН-1 по порядку:
//   1. раненые, чей срок прошёл, встают в строй (`sim/infirmary.settleBandWounds`);
//   2. паёк: фураж с земли по сезону (`roamrules.forageShare` ← поле сезона в `SEASON_MODIFIERS`), остальное — из обоза
//      (`sim/stock.addStock`, ключ `cargo`); не хватило — голодна та доля отряда, которую фураж не закрывает
//      (`roamrules.bandHunger`, как амбар города);
//   3. содержание: кошель, долг, терпение, уход (`sim/upkeep.bandUpkeep`).
// Дух не тикает: он читается из этих полей (`sim/spirit.spiritIn`, входы отряда).
import type { GameState, RoamOrigin, RoamState, RulerTally, TroopId, WoundGroup } from '../types';
import { DAY_LENGTH, RESOURCE_IDS } from '../constants';
import { TROOP_IDS } from '../data/troops';
import { seasonMods } from '../derived';
import { ROAM_ON } from '../roamflag';
import { bandHunger, bandRationPerDay, forageShare } from '../roamrules';
import { readTally } from '../rulertraits';
import { troopTotal } from '../battle/kinds';
// Мир — только данными (`world/data/*`): дверь режима марша (`world/gait`) тянет осаду и землю, и шаг города, который зовёт
// этот модуль диспетчером, сдвинул бы ими первую загрузку.
import { GAITS, GAIT_HAUL, type Gait } from '@/world/data/gait';
import { UNIT_BY_ID } from '@/world/data/units';
import { addStock } from './stock';
import { settleBandWounds } from './infirmary';
import { bandUpkeep } from './upkeep';
import { trimLog } from './log';

/** Происхождения бродяги (ГДД 3.1): что даёт каждое — ПН-17. */
export const ROAM_ORIGINS: readonly RoamOrigin[] = ['warrior', 'merchant', 'craftsman', 'taken'];

/** С чем выходят на дорогу. Числа даёт происхождение (ПН-17); здесь — только их правильность. */
export interface RoamStart {
  origin: RoamOrigin;
  hero: { name: string; war: number };
  band: Partial<Record<TroopId, number>>;
  purse: number;
  /** Хлеб в обозе на старте. */
  food: number;
}

/**
 * Вместимость обоза (ГДД 3.3.5): ноша бойца мира (`units.warrior.carry` — та же, что у обоза полководца) на голову строя, режимом
 * марша (`GAIT_HAUL` — та же поклажа, что у `gait.gaitHaul`: налегке меньше, с обозом больше). Раненых несут — они не везут. Золото не весит. Телеги — с
 * происхождениями (ПН-17), когда прибор выведет их вместимость.
 */
export const cargoCap = (r: Pick<RoamState, 'band' | 'gait'>): number =>
  troopTotal(r.band) * UNIT_BY_ID.warrior.carry * GAIT_HAUL[GAITS.includes(r.gait) ? r.gait : 'normal'];

/** Отказ войти в путь — словами; можно — `null`. */
export function roamBlock(s: GameState): string | null {
  if (!ROAM_ON) return 'Путь меча ещё не открыт.';
  if (s.phase !== undefined) return 'Партия уже идёт своим путём.';
  if (s.time > 0) return 'Путь меча начинают с новой партии.';
  return null;
}

const count = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, Math.floor(v)) : 0);
const amount = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? Math.max(0, v) : 0);

function bandOf(v: unknown): Partial<Record<TroopId, number>> {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const out: Partial<Record<TroopId, number>> = {};
  for (const id of TROOP_IDS) {
    const n = count(r[id]);
    if (n > 0) out[id] = n;
  }
  return out;
}

/**
 * Войти в путь: партия становится бродягой с отрядом, кошелем и хлебом в обозе. Одна дверь входа — её зовёт экран
 * происхождений (ПН-17). Возвращает отказ словами или `null`.
 */
export function beginRoam(s: GameState, start: RoamStart): string | null {
  const why = roamBlock(s);
  if (why) return why;
  if (!ROAM_ORIGINS.includes(start.origin)) return 'Такого происхождения нет.';
  const roam: RoamState = {
    origin: start.origin,
    // Начало пути — начало счёта дел героя (ПН-2, черты правителя): время на минимальном жалованье меряется от него.
    hero: { name: String(start.hero.name ?? '').slice(0, 40), war: Math.min(5, Math.max(1, count(start.hero.war))), since: s.time },
    band: bandOf(start.band),
    wounded: [],
    purse: amount(start.purse),
    cargo: {},
    gear: {},
    gait: 'normal',
    camp: { since: s.time },
  };
  s.phase = 'roam';
  s.roam = roam;
  addStock(s, 'food', amount(start.food), cargoCap(roam), 'cargo');
  return null;
}

function woundsOf(v: unknown): WoundGroup[] {
  if (!Array.isArray(v)) return [];
  const out: WoundGroup[] = [];
  for (const g of v) {
    const r = (g && typeof g === 'object' ? g : {}) as Record<string, unknown>;
    const troops = bandOf(r.troops);
    const until = r.until === null ? null : typeof r.until === 'number' && Number.isFinite(r.until) ? r.until : undefined;
    if (until === undefined || Object.keys(troops).length === 0) continue;
    out.push({ troops, until });
  }
  return out;
}

/**
 * Фаза и отряд из сохранения: только фаза из списка и только целый отряд при фазе бродяги; иначе — ничего (партия лорда).
 * Зовёт чтение сохранения за выключателем (`save.deserialize`).
 */
export function mergeRoam(saved: unknown): Pick<GameState, 'phase' | 'roam'> {
  const d = (saved && typeof saved === 'object' ? saved : {}) as Record<string, unknown>;
  const phase = d.phase === 'roam' || d.phase === 'lord' || d.phase === 'exile' ? d.phase : undefined;
  if (phase !== 'roam') return phase ? { phase } : {};
  const r = (d.roam && typeof d.roam === 'object' ? d.roam : null) as Record<string, unknown> | null;
  if (!r || !ROAM_ORIGINS.includes(r.origin as RoamOrigin)) return {};
  const hero = (r.hero && typeof r.hero === 'object' ? r.hero : {}) as Record<string, unknown>;
  const cargoIn = (r.cargo && typeof r.cargo === 'object' ? r.cargo : {}) as Record<string, unknown>;
  const cargo: RoamState['cargo'] = {};
  for (const id of RESOURCE_IDS) {
    const n = amount(cargoIn[id]);
    if (n > 0) cargo[id] = n;
  }
  const gearIn = (r.gear && typeof r.gear === 'object' ? r.gear : {}) as Record<string, unknown>;
  const gear: RoamState['gear'] = {};
  for (const [id, v] of Object.entries(gearIn)) {
    const n = count(v);
    if (n > 0) gear[id as keyof RoamState['gear']] = n;
  }
  const camp = r.camp && typeof r.camp === 'object' ? (r.camp as Record<string, unknown>) : null;
  return {
    phase,
    roam: {
      origin: r.origin as RoamOrigin,
      hero: {
        name: typeof hero.name === 'string' ? hero.name.slice(0, 40) : '',
        war: Math.min(5, Math.max(1, count(hero.war))),
        ...(typeof hero.since === 'number' && Number.isFinite(hero.since) ? { since: hero.since } : {}),
        // Счёт дел героя (ПН-2): та же проверка, что у правителя.
        ...((): { deeds?: RulerTally } => {
          const deeds = readTally(hero.deeds);
          return deeds ? { deeds } : {};
        })(),
      },
      band: bandOf(r.band),
      wounded: woundsOf(r.wounded),
      purse: amount(r.purse),
      cargo,
      gear,
      gait: GAITS.includes(r.gait as Gait) ? (r.gait as Gait) : 'normal',
      camp: camp && typeof camp.since === 'number' && Number.isFinite(camp.since) ? { since: camp.since } : null,
    },
  };
}

/**
 * Шаг отряда длиной `dt` игровых секунд — одной дверью при игроке и в догоне: правил отлучки у отряда нет, он живёт по часам.
 */
export function roamStep(s: GameState, dt: number): void {
  const r = s.roam;
  if (!r || !(dt > 0)) return;
  const dayBefore = Math.floor(s.time / DAY_LENGTH);
  s.time += dt;
  settleBandWounds(s);
  const mods = seasonMods(s);
  // Паёк: фураж с земли, остальное — из обоза. Голодна та доля, которую обоз не закрыл (как амбар города: «пуст, только если еды
  // на этом шаге не хватило»).
  const need = (bandRationPerDay(r, mods.food) * dt) / DAY_LENGTH;
  const fromCargo = need * (1 - forageShare(mods, r));
  const had = r.cargo.food ?? 0;
  if (fromCargo > 0) addStock(s, 'food', -fromCargo, cargoCap(r), 'cargo');
  const unfed = fromCargo > had ? bandHunger(r, mods) : 0;
  bandUpkeep(s, dt, unfed);
  if (Math.floor(s.time / DAY_LENGTH) > dayBefore) trimLog(s);
}

/** Прожить `dt` игровых секунд кусками не длиннее `step` (шаг догона — `sim/tick.CATCHUP_STEP`, его передаёт диспетчер). */
export function roamFor(s: GameState, dt: number, step: number): void {
  for (let left = dt; left > 0; left -= step) roamStep(s, Math.min(step, left));
}
