// Шаг партии бродяги (ПН-1, docs/gdd/path_of_sword.md, 6.1 и 3.3; «Решения ПН-1»).
//
// Партия одна: фаза (`GameState.phase`) решает, чем живёт шаг. Лорд — посёлком (`sim/tick.tick`), бродяга — отрядом
// (`roamStep`): посёлка у бродяги ещё нет (его даст взятый замок, ПН-11), и поля посёлка в фазе бродяги спят. Выбирает дверь
// диспетчер — живой шаг и отлучка (`sim/tick.liveStep`, `absence`), с теми же часами, тем же порогом отлучки и тем же потолком
// догона, что у лорда. За выключателем (`roamflag.roamOn`) диспетчер, вход и чтение фазы бродяги не пускают.
//
// Своих правил у шага нет — он зовёт двери ПН-1 по порядку:
//   1. раненые, чей срок прошёл, встают в строй (`sim/infirmary.settleBandWounds`);
//   2. паёк: фураж с земли по сезону (`roamrules.forageShare` ← поле сезона в `SEASON_MODIFIERS`; стоящему под открытым небом — по
//      месту и погоде, ПН-12л, `world/campsite`), остальное — из обоза
//      (`sim/stock.addStock`, ключ `cargo`); не хватило — голодна та доля отряда, которую фураж не закрывает
//      (`roamrules.bandHunger`, как амбар города);
//   3. содержание: кошель, долг, терпение, уход (`sim/upkeep.bandUpkeep`).
// Дух не тикает: он читается из этих полей (`sim/spirit.spiritIn`, входы отряда).
import type { GameState, MarketState, RoamDrill, RoamOrigin, RoamState, RulerTally, TroopId, WoundGroup } from '../types';
import type { BandBookOrder } from '../../../netlify/lib/contract';
import { readBookOrder } from '../../../netlify/lib/bandorder';
import { mergeMarket } from './caravan';
import { OUTBOX_MAX } from './bandranks';
import { DAY_LENGTH, RESOURCE_IDS } from '../constants';
import { TROOP_IDS } from '../data/troops';
import { seasonMods } from '../derived';
import { roamOn } from '../roamflag';
import { bandHunger, bandRationPerDay, campSpirit, forageShare } from '../roamrules';
import { readTally } from '../rulernow';
// Мир — данными (`world/data/*`), формой записи хода (`world/roammove`) и местом лагеря (`world/campsite`, ПН-12л): с ПН-5 шаг отряда
// едет куском пути (`game/roamdoor`), и мир отсюда первую загрузку не двигает (сторож сборки, `vite.config.ts`).
import type { Gait } from '@/world/data/gait';
import { cargoCap } from '../cargocap';
import { readMove, readTrip, standWay, tripOfWay, wayGait, type CampKind, type RoamMove, type RoamTrip } from '@/world/roammove';
import { gameDaysOfMs, realMs } from '../pace';
import { DRILL_MAX, FED_MAX, townStep } from './roamtown';
import { TOWN_MARKETS } from '../townrules';
import { addStock } from './stock';
import { trimCargo } from './cargo';
import { hastenBandWounds, settleBandWounds } from './bandwounds';
import { campRest, openSky, rationWeather, weatherMorale, type BandPlace } from '@/world/campsite';
import { roamStub } from '../roamstubs';
import { bandUpkeep } from './bandkeep';
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

/** Вместимость обоза (ГДД 3.3.5) — своим модулем (`game/cargocap`): её читает и рынок вольного города (ПН-6). */
export { cargoCap };

/** Отказ войти в путь — словами; можно — `null`. */
export function roamBlock(s: GameState): string | null {
  if (!roamOn()) return 'Путь меча ещё не открыт.';
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
    // Хода и лагеря нет, пока место выхода не названо (ПН-3): клетку назовёт сервер (`setMove` с `world/roam.roamSeat`).
    camp: null,
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
  // Ход, лагерь и энергия (ПН-3) — одной формой записи (`world/roammove.readMove`): лагерь без хода не бывает.
  const move = readMove(r);
  return {
    phase,
    roam: {
      origin: r.origin as RoamOrigin,
      hero: {
        name: typeof hero.name === 'string' ? hero.name.slice(0, 40) : '',
        war: Math.min(5, Math.max(1, count(hero.war))),
        ...(typeof hero.since === 'number' && Number.isFinite(hero.since) ? { since: hero.since } : {}),
        ...(typeof hero.hurt === 'number' && Number.isFinite(hero.hurt) ? { hurt: hero.hurt } : {}),
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
      camp: move?.camp ?? null,
      ...(move ? { way: move.way } : {}),
      ...(move?.energy ? { energy: move.energy } : {}),
      // Встреча с НПС (ПН-5) — только та, что принадлежит записанному ходу; побитые точки — целые записи, не больше потолка.
      ...((): { trip?: RoamTrip } => {
        const trip = readTrip(r.trip);
        return trip && move && tripOfWay(trip, move.way) ? { trip } : {};
      })(),
      // ПН-6: рынки вольных городов, хлеб сёл, учения, просящиеся, пленные и очередь книги — целые записи, не больше потолков.
      ...readTown(r),
      ...((): { beaten?: { id: string; until: number }[] } => {
        const list = Array.isArray(r.beaten) ? r.beaten : [];
        const beaten = list
          .map((b) => (b && typeof b === 'object' ? (b as Record<string, unknown>) : {}))
          .filter((b) => typeof b.id === 'string' && typeof b.until === 'number' && Number.isFinite(b.until))
          .slice(0, BEATEN_MAX)
          .map((b) => ({ id: String(b.id).slice(0, 64), until: b.until as number }));
        return beaten.length ? { beaten } : {};
      })(),
    },
  };
}

/** Побитых точек партия помнит не больше стольких — старые уходят первыми (пепелище и так сходит). */
export const BEATEN_MAX = 32;


const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);
const keyOk = (v: unknown): v is string => typeof v === 'string' && /^[\w.:-]{6,64}$/.test(v);

/** Поля отряда ПН-6 из сохранения (`mergeRoam`): только целые записи, каждая проверена; мусор — нет поля. */
function readTown(r: Record<string, unknown>): Pick<RoamState, 'markets' | 'fed' | 'drill' | 'ask' | 'captives' | 'outbox'> {
  const out: Pick<RoamState, 'markets' | 'fed' | 'drill' | 'ask' | 'captives' | 'outbox'> = {};
  if (r.markets && typeof r.markets === 'object') {
    const markets: Record<string, MarketState> = {};
    for (const [k, v] of Object.entries(r.markets as Record<string, unknown>).slice(-TOWN_MARKETS)) if (/^town:-?\d+:-?\d+$/.test(k)) markets[k] = mergeMarket(v);
    if (Object.keys(markets).length) out.markets = markets;
  }
  if (Array.isArray(r.fed)) {
    const fed = (r.fed as Record<string, unknown>[])
      .filter((f) => f && typeof f.id === 'string' && finite(f.took) && finite(f.at))
      .slice(0, FED_MAX)
      .map((f) => ({ id: String(f.id).slice(0, 64), took: Math.max(0, f.took as number), at: f.at as number }));
    if (fed.length) out.fed = fed;
  }
  if (Array.isArray(r.drill)) {
    const drill: RoamDrill[] = [];
    for (const d of (r.drill as Record<string, unknown>[]).slice(0, DRILL_MAX)) {
      if (!d || !TROOP_IDS.includes(d.kind as TroopId) || typeof d.at !== 'string' || !finite(d.work) || !finite(d.n) || !keyOk(d.key)) continue;
      drill.push({ kind: d.kind as TroopId, n: Math.max(1, Math.floor(d.n)), at: d.at.slice(0, 64), work: Math.max(0, d.work), key: d.key });
    }
    if (drill.length) out.drill = drill;
  }
  const ask = r.ask as Record<string, unknown> | undefined;
  if (ask && finite(ask.k) && finite(ask.men) && ask.men >= 1) out.ask = { k: Math.floor(ask.k), men: Math.floor(ask.men) };
  const cap = r.captives as Record<string, unknown> | undefined;
  if (cap && finite(cap.n) && cap.n >= 1 && finite(cap.until) && keyOk(cap.key)) out.captives = { n: Math.floor(cap.n), until: cap.until, key: cap.key };
  if (Array.isArray(r.outbox)) {
    const box = (r.outbox as unknown[])
      .map((o) => (o && typeof o === 'object' ? readBookOrder(o as Record<string, unknown>) : null))
      .filter((o): o is BandBookOrder => o !== null);
    if (box.length) out.outbox = box.slice(-OUTBOX_MAX);
  }
  return out;
}

/**
 * Хлеб в обозе сейчас и через `ms` мс мира хода в режиме `g` — для окна хода («провиант к приходу», ГДД 5.4): паёк сезона (`roamrules
 * .bandRationPerDay`) за вычетом фуража в пути этим режимом (`forageShare`) — те же двери, что шаг отряда. Прогноз: сезон — нынешний.
 */
export function foodAfter(s: GameState, ms: number, g: Gait): { now: number; at: number } {
  const r = s.roam;
  if (!r) return { now: 0, at: 0 };
  const mods = seasonMods(s);
  const eat = bandRationPerDay(r, mods.food) * gameDaysOfMs(Math.max(0, ms)) * (1 - forageShare(mods, { camp: null, way: standWay(g) }));
  const now = r.cargo.food ?? 0;
  return { now, at: Math.max(0, now - eat) };
}

/** Что даёт стоянка — для окна «Встать лагерем» и шага: фураж, строки духа «Лагерь» и «Непогода», отдых раненых, множитель пайка. */
export interface CampGain {
  forage: number;
  morale: number;
  weather: number;
  heal: number;
  ration: number;
}

/**
 * Что даёт лагерь вида `kind` (`null` — стоять в поле) в месте и погоде `open` (`campsite.openSky`; нет — под крышей или в пути:
 * место не в счёт): фураж (`roamrules.forageShare`), строка духа «Лагерь» (`campSpirit`) и «Непогода» (`campsite.weatherMorale`), во сколько
 * быстрее встают раненые (`campsite.campRest`), паёк под снегопадом (`rationWeather`) — те же двери, что шаг отряда.
 */
export function campGain(s: GameState, kind: CampKind | null, open: BandPlace | null): CampGain {
  const r = s.roam;
  const mods = seasonMods(s);
  const camp = kind ? { kind, since: 0, builders: 0 } : null;
  const way = kind ? r?.way : standWay(r?.way ? wayGait(r.way) : 'normal');
  return {
    forage: forageShare(mods, { camp, way }, open),
    morale: campSpirit(camp, mods, open?.sky),
    weather: open ? weatherMorale(open.sky) : 0,
    heal: open ? campRest(kind, open.site, open.sky) : kind === 'open' ? roamStub('healOpen') : 1,
    ration: open ? rationWeather(open.sky) : 1,
  };
}

/** Ход отряда из партии — запись целиком (`world/roammove.RoamMove`); места выхода нет — `null`. */
export const moveOf = (r: Pick<RoamState, 'way' | 'camp' | 'energy'>): RoamMove | null =>
  r.way ? { way: r.way, camp: r.camp, ...(r.energy ? { energy: r.energy } : {}) } : null;

/**
 * Записать ход отряда (ПН-3) — **единственная дверь записи** `way`, `camp` и `energy` партии: её зовут мир бродяги (приказы
 * «Идти сюда» и «Встать лагерем», `world/local/RoamWorld`) и встреча с реестром (`world/store` — запись, которую принял сервер).
 * Сам ход считает дверь хода `world/roam`; здесь — только запись и её следствие: сменился режим марша — сменилась вместимость
 * обоза, и что сверх неё, брошено строкой летописи (`stock.trimCargo`). Возвращает эту строку или `null`.
 */
export function setMove(s: GameState, m: RoamMove): string | null {
  const r = s.roam;
  if (!roamOn() || s.phase !== 'roam' || !r) return null;
  r.way = m.way;
  r.camp = m.camp;
  if (m.energy) r.energy = m.energy;
  else delete r.energy;
  // Встреча прежнего хода (ПН-5) с ним и уходит: новый ход — новая встреча (`setTrip`), тот же ход от сервера — та же.
  if (r.trip && !tripOfWay(r.trip, m.way)) delete r.trip;
  return trimCargo(s, cargoCap(r));
}

/**
 * Записать встречу хода с НПС (ПН-5, ГДД 3.6.3) — **единственная дверь записи** `RoamState.trip`: её зовёт мир бродяги в минуту
 * приказа (заморозка — `world/encounter.tripOf`) и при разборе встречи (отметка `done`). Встреча чужого хода не ложится.
 */
export function setTrip(s: GameState, t: RoamTrip | null): void {
  const r = s.roam;
  if (!roamOn() || s.phase !== 'roam' || !r) return;
  if (t && r.way && tripOfWay(t, r.way)) r.trip = t;
  else delete r.trip;
}

/**
 * Шаг отряда длиной `dt` игровых секунд — одной дверью при игроке и в догоне: правил отлучки у отряда нет, он живёт по часам.
 */
export function roamStep(s: GameState, dt: number, now?: number): void {
  const r = s.roam;
  if (!r || !(dt > 0)) return;
  const dayBefore = Math.floor(s.time / DAY_LENGTH);
  s.time += dt;
  // Место и погода (ПН-12л): стоит под открытым небом — земля клетки и погода над ней (`campsite.openSky`); идёт или на постое — нет.
  const open = now !== undefined && r.way ? openSky(r.way, now, s.time) : null;
  // Отдых (ГДД 3.5.3): огонь, вода рядом и укрытие — раненые встают быстрее (`campsite.campRest`); их срок подходит быстрее часов
  // той же дверью раненых. Без минуты мира — как ПН-3: открытый лагерь — костры.
  const rest = open ? campRest(r.camp?.kind ?? null, open.site, open.sky) : r.camp?.kind === 'open' ? roamStub('healOpen') : 1;
  if (rest > 1) hastenBandWounds(s, dt * (rest - 1));
  settleBandWounds(s);
  const mods = seasonMods(s);
  // Паёк: фураж с земли, остальное — из обоза; под снегопадом паёк дороже (`rationWeather`). Голодна та доля, которую обоз не
  // закрыл (как амбар города: «пуст, только если еды на этом шаге не хватило»).
  const need = (bandRationPerDay(r, mods.food * (open ? rationWeather(open.sky) : 1)) * dt) / DAY_LENGTH;
  const fromCargo = need * (1 - forageShare(mods, r, open));
  const had = r.cargo.food ?? 0;
  if (fromCargo > 0) addStock(s, 'food', -fromCargo, cargoCap(r), 'cargo');
  const unfed = fromCargo > had ? bandHunger(r, mods, open) : 0;
  bandUpkeep(s, dt, unfed);
  // Город (ПН-6): постой и учения найма идут, пока отряд стоит у вольного города или села — по настоящей минуте куска.
  if (now !== undefined) townStep(s, dt, now);
  if (Math.floor(s.time / DAY_LENGTH) > dayBefore) trimLog(s);
}

/**
 * Прожить `dt` игровых секунд кусками не длиннее `step` (шаг догона — `sim/tick.CATCHUP_STEP`, его передаёт диспетчер). `now` — настоящая
 * минута конца окна: конец каждого куска — назад от неё на остаток окна (постой и учения у города знают, где стоял отряд).
 */
export function roamFor(s: GameState, dt: number, step: number, now?: number): void {
  for (let left = dt; left > 0; left -= step) {
    const d = Math.min(step, left);
    roamStep(s, d, now === undefined ? undefined : now - realMs(left - d));
  }
}
