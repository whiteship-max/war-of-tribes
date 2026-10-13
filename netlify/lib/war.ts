/**
 * Правила войны между игроками — отдельно от разговора по сети (docs/pvp.md). Обработчик
 * (`routes/war.ts`) читает записи и пишет итог; всё, что можно проверить без хранилища, — здесь.
 *
 * **Бой считает сервер, и только он.** Тем же ядром и той же дверью, что мир на клиенте
 * (`src/world/fights.ts`: сторона обороны у ворот, бой у лагеря; `world/battle.resolveField`), в минуту
 * прихода войска, по слепкам обороны обоих игроков (`WarSheet` из их записей партии). В приказах поля
 * исхода нет вовсе (`contract.readWarOrder` собирает новый объект), поэтому прислать свой исход нечем.
 *
 * **Тика нет**, как у осады логова: всё назначено временем — приходом, ударом, часом голода, возвратом, —
 * и разбирается при первом обращении любой из сторон после этой минуты (`advance`). Тот же вход и то же
 * прошедшее время дают то же состояние, кто бы и когда ни спросил.
 *
 * **Добыча переходит, а не начисляется.** Участь взятого города считает одна дверь `spoils.fate`: что
 * увёз победитель, взято из того, что потерял город, — и это тест (`war.test.ts`). Алмазов здесь нет
 * ни в каком виде.
 */
import { castleIdOf } from './roster.js';
import {
  cityName,
  plainName,
  RESULT_KEEP,
  type NoticeItem,
  readSheet,
  warFallId,
  warTributeId,
  warRepairId,
  cityOr,
  type Counts,
  type WarPact,
  type WarRelief,
  type RosterFile,
  type WarArmy,
  type WarBattle,
  type WarCamp,
  type WarEnd,
  type WarFall,
  type WarOrder,
  type WarSheet,
  type WarView,
  RIVAL_DEEDS,
  spySeenId,
  type RivalDeed,
  type SpyMenu,
  type SpyOption,
  type SpyView,
} from './contract.js';
import { stackTotal, type Pips, type Stack } from '../../src/battle/index.js';
import { TROOPS_OF_KIND, troopTotal, type TroopStack } from '../../src/game/battle/kinds.js';
import { kindsOf, troopLosses, troopPower } from '../../src/game/battle/price.js';
import { wallRepairCost } from '../../src/game/build.js';
import { statAt } from '../../src/game/train.js';
import { ENGINES } from '../../src/game/data/engines.js';
import { campFight, guardKinds, homeLosses, machineFight, wallFight } from '../../src/world/fights.js';
import { SCALING, wallFront } from '../../src/world/wall.js';
import {
  GUARD_SHARE,
  assaultOf,
  burnBlock,
  machineAfter,
  machineBlock,
  machinesBurned,
  machinesSpent,
  stormMachines,
  type MachineId,
} from '../../src/world/machines.js';
import { aimOf, firePlan, reaim, thinAt, thinKinds, type Aim, type Fire, type TowerGun } from '../../src/world/bombard.js';
import { foodLeft, spyWalkMs, warAt, warWalkMs } from '../../src/world/pvp.js';
import { distance } from '../../src/world/geo.js';
import {
  homePowerOf,
  rivalChance,
  rivalFate,
  rivalGuard,
  rivalHarm,
  rivalHostile,
  rivalPeril,
  rivalPerilCase,
  rivalRolls,
} from '../../src/world/rivalspy.js';
import { gameDaysOfMs, gameSecondsOfMs } from '../../src/game/pace.js';
import { FATE_SAME, openSiege, SIEGE_BLOCK, siegeSince, starvesAt, type SiegeWindow } from '../../src/world/siege.js';
import { craftAfter, craftAt, craftBlock, craftCount, fortFaces, garrisonWear, type Craft } from '../../src/world/siegecraft.js';
import {
  breachesOf,
  breadLeft,
  cleanDefend,
  cleanOrders,
  nextRollAt,
  orderRations,
  orderRepairs,
  orderStorms,
  orderVolleys,
  repairAfter,
  repairBlock,
  repairsOf,
  rollPhase,
  rowsOf,
  softerFate,
  type PhaseRow,
} from '../../src/world/siegeroll.js';
import { burnImmuneUntil, fate, fateBlock, fallSeed, homeLoss, winnerGain } from '../../src/world/spoils.js';
import type { Loot } from '../../src/world/types.js';
import {
  answerAfter,
  bountyOf,
  fairTribute,
  liveOffer,
  offerAfter,
  offerBlock,
  siegeShare,
  softerThan,
  termsBlock,
  tributeGoods,
  type OfferKind,
} from '../../src/world/parley.js';
import { restAfter, restAt } from '../../src/world/rest.js';
import { energyAt, energyBlock, onRoad, priceOf, remark, spend } from '../../src/world/energy.js';
import { ENERGY_MAX } from '../../src/world/data/energy.js';
import { weakCity } from '../../src/world/lairs.js';
import { inHomeTheatre } from '../../src/world/theatre/theatre.js';
import { machineShare, gateBusyText, playerWood, rebaseWood } from '../../src/world/works.js';
import { stackCarry, stackEscort } from '../../src/world/data/units.js';
import { PERIL_MEMORY, SIEGE_IMMUNE, SIEGE_ROUT, SPY_HELD } from '../../src/world/data/tuning.js';
import { bookLive, least, over, rulePips, ruleResolve, type ArmyBook } from './book.js';
import { floorAt, townSheet, type TownBook } from './town.js';

/** Война в хранилище: вид для игроков плюс ключи сторон. Ключи наружу не уходят никогда (`viewOf`). */
export interface WarRow extends Omit<WarView, 'role'> {
  atk: string;
  def: string;
  /**
   * Ключи союзников, ходивших на выручку, по их замкам (docs/siege_v2.md, 19.2): по ним весть о бое выручки и о выручке, не
   * пробившейся через рогатки, уходит союзнику (`newsOf`). Пишет приказ `relief`; наружу не уходит (`viewOf`).
   */
  allies?: Record<string, { key: string; city: string }>;
}

/** Все войны одной записью — как реестр: читают целиком и целиком переписывают с условием по ETag. */
export interface WarFile {
  v: 1;
  seq: number;
  wars: WarRow[];
  /**
   * Итоги войн, уже убранных из записи (`pruneWars`), по ключу игрока: рейтинг считает победы и взятые города по всем
   * войнам эпохи, а не только по лежащим (docs/rating.md). Нет поля — ничего ещё не убирали.
   */
  past?: Record<string, WarTally>;
  /** Дела лазутчиков против соседей (docs/spy_pvp.md). Нет поля — ни одного ещё не было. */
  spies?: SpyRow[];
  /**
   * Пакты между игроками (docs/siege_v2.md, раздел 5: выручку ведёт сосед с пактом) — пары ключей и имена городов на минуту
   * пакта. Нет поля — ни одного.
   */
  pacts?: PactRow[];
  /** Предложения пакта, ещё не принятые: кто, кому, когда. */
  offers?: PactOffer[];
}

/** Пакт двух игроков: ключи по порядку, имена городов на минуту пакта. Ключи наружу не уходят (`pactsOf`). */
export interface PactRow {
  a: string;
  b: string;
  at: number;
  cities: Record<string, string>;
  /** Кто принял предложение (ключ): весть «пакт заключён» уходит другому — предложившему (19.2). Нет — пакт старше поля. */
  by?: string;
}

/** Предложение пакта. */
export interface PactOffer {
  from: string;
  to: string;
  at: number;
  cities: Record<string, string>;
}

/**
 * Дело лазутчика в хранилище: вид для игроков плюс ключи сторон и то, что заморожено при приказе (скрытность и срок
 * плена нападающего). Ключи и замороженное наружу не уходят (`spyViewOf`).
 */
export interface SpyRow extends Omit<SpyView, 'role'> {
  atk: string;
  def: string;
  /** Скрытность нападающего долей (`agents.slipped`) — на минуту приказа. */
  stealth: number;
  /** Сколько держат в плену, мс мира с темпом войны — на минуту приказа. */
  heldMs: number;
}

/** Победы игрока в боях войны и взятые им города. */
export interface WarTally {
  won: number;
  taken: number;
}

/** Ключ записи войн в хранилище мира — рядом с реестром (`roster`). */
export const WARS_KEY = 'wars';

/** Сколько кончившаяся война лежит, чтобы обе стороны успели прочесть итог, и потолок записи. */
export const WAR_KEEP_MS = 7 * 24 * 3600_000;
export const WAR_MAX = 400;

export const emptyWars = (): WarFile => ({ v: 1, seq: 0, wars: [] });

/** Записи из хранилища. Испорченное читается пустым: войны начинаются заново, партии целы. */
export function readWars(raw: unknown): WarFile {
  if (!raw || typeof raw !== 'object') return emptyWars();
  const r = raw as Partial<WarFile>;
  if (r.v !== 1 || !Array.isArray(r.wars)) return emptyWars();
  const wars = r.wars.filter(
    (w): w is WarRow =>
      Boolean(w) && typeof w.id === 'string' && typeof w.atk === 'string' && typeof w.def === 'string' && typeof w.phase === 'string',
  );
  const past: Record<string, WarTally> = {};
  if (r.past && typeof r.past === 'object') {
    for (const [k, t] of Object.entries(r.past as Record<string, unknown>)) {
      const x = (t ?? {}) as Record<string, unknown>;
      const n = (v: unknown): number => Math.max(0, Math.floor(Number(v) || 0));
      if (n(x.won) + n(x.taken) > 0) past[k] = { won: n(x.won), taken: n(x.taken) };
    }
  }
  const spies = Array.isArray(r.spies)
    ? r.spies.filter(
        (x): x is SpyRow =>
          Boolean(x) &&
          typeof x.id === 'string' &&
          typeof x.atk === 'string' &&
          typeof x.def === 'string' &&
          typeof x.phase === 'string' &&
          RIVAL_DEEDS.includes(x.deed),
      )
    : [];
  const names = (v: unknown): Record<string, string> => {
    const out: Record<string, string> = {};
    if (v && typeof v === 'object') for (const [k, c] of Object.entries(v as Record<string, unknown>)) if (typeof c === 'string') out[k] = c;
    return out;
  };
  const pacts = Array.isArray(r.pacts)
    ? r.pacts
        .filter((x): x is PactRow => Boolean(x) && typeof x.a === 'string' && typeof x.b === 'string')
        .map((x) => ({ a: x.a, b: x.b, at: Number(x.at) || 0, cities: names(x.cities), ...(typeof x.by === 'string' ? { by: x.by } : {}) }))
    : [];
  const offers = Array.isArray(r.offers)
    ? r.offers
        .filter((x): x is PactOffer => Boolean(x) && typeof x.from === 'string' && typeof x.to === 'string')
        .map((x) => ({ from: x.from, to: x.to, at: Number(x.at) || 0, cities: names(x.cities) }))
    : [];
  return {
    v: 1,
    seq: Math.max(0, Math.floor(Number(r.seq) || 0)),
    wars,
    ...(Object.keys(past).length ? { past } : {}),
    ...(spies.length ? { spies } : {}),
    ...(pacts.length ? { pacts } : {}),
    ...(offers.length ? { offers } : {}),
  };
}

/**
 * Кто выиграл бой войны. `won` — победил ли тот, кто в этом бою нападал: при штурме это поход (`atk`), при вылазке и
 * ударе по лагерю — город (`def`).
 */
export const battleWinner = (w: WarRow, b: WarBattle): string => ((b.by === 'atk') === b.won ? w.atk : w.def);

/** Прибавить к счёту итоги одной войны: победы в её боях и взятый город. */
function tallyWar(out: Record<string, WarTally>, w: WarRow): void {
  const add = (key: string, won: number, taken: number): void => {
    const t = (out[key] ??= { won: 0, taken: 0 });
    t.won += won;
    t.taken += taken;
  };
  for (const b of w.battles ?? []) add(battleWinner(w, b), 1, 0);
  if (w.fall) add(w.atk, 0, 1);
}

/** Победы и взятые города каждого игрока за эпоху: убранные войны (`past`) плюс лежащие. */
export function warTally(file: WarFile): Record<string, WarTally> {
  const out: Record<string, WarTally> = {};
  for (const [k, t] of Object.entries(file.past ?? {})) out[k] = { ...t };
  for (const w of file.wars) tallyWar(out, w);
  return out;
}

/**
 * Слепок обороны из лежащей записи партии (`SaveRecord.war`) с отметкой, когда запись легла. Нет записи
 * или слепка — `null`. Больше из чужой партии не читается ничего: сама партия остаётся непрозрачной.
 */
export function readStoredSheet(raw: unknown): SheetAt | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as { war?: unknown; updatedAt?: unknown };
  const sheet = readSheet(r.war);
  return sheet ? { sheet, at: typeof r.updatedAt === 'number' ? r.updatedAt : 0 } : null;
}

/** Война глазами одной из сторон или союзника осаждённого: без ключей. */
export function viewOf(row: WarRow, key: string): WarView {
  const { atk, def, allies, ...rest } = row;
  void allies;
  if (atk === key || def === key) return { ...rest, role: atk === key ? 'atk' : 'def' };
  return { ...rest, role: 'ally', me: castleIdOf(key) };
}

/**
 * Война, которую игрок видит союзником (docs/siege_v2.md, раздел 5): у его союзника по пакту под стенами лагерь — он может
 * прийти на выручку; или его выручка уже идёт, дралась либо не пробилась через рогатки — итог её он применяет сам.
 */
function allyOf(file: WarFile, w: WarRow, key: string): boolean {
  if (w.atk === key || w.def === key) return false;
  const me = castleIdOf(key);
  if (w.reliefs?.some((r) => r.castle === me) || w.battles.some((b) => b.ally === me) || w.turned?.some((t) => t.ally === me)) return true;
  return w.phase === 'camp' && pacted(file, key, w.def);
}

/** Свои войны и осады союзников — свежие сверху. */
export const warsOf = (file: WarFile, key: string): WarView[] =>
  file.wars.filter((w) => w.atk === key || w.def === key || allyOf(file, w, key)).map((w) => viewOf(w, key)).reverse();

// ------------------------------------------------ пакты между игроками ---

/** Пакт двух игроков есть. */
export const pacted = (file: WarFile, a: string, b: string): boolean =>
  (file.pacts ?? []).some((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));

/** Сколько предложений пакта игрок держит сразу — потолок записи, не правило игры. */
export const PACT_OFFERS_MAX = 20;

/** Пакты и предложения игрока глазами клиента: замки и имена, без ключей. */
export function pactsOf(file: WarFile, key: string): WarPact[] {
  const out: WarPact[] = [];
  for (const p of file.pacts ?? []) {
    if (p.a !== key && p.b !== key) continue;
    const other = p.a === key ? p.b : p.a;
    out.push({ castle: castleIdOf(other), city: cityOr(p.cities[other]), state: 'pact', at: p.at });
  }
  for (const o of file.offers ?? []) {
    if (o.from === key) out.push({ castle: castleIdOf(o.to), city: cityOr(o.cities[o.to]), state: 'offered', at: o.at });
    else if (o.to === key) out.push({ castle: castleIdOf(o.from), city: cityOr(o.cities[o.from]), state: 'asked', at: o.at });
  }
  return out;
}

/**
 * Предложить пакт или принять предложенный (docs/siege_v2.md, раздел 5): пакт — когда обе стороны сказали «да». Своей
 * дипломатии с наградами и сроками у игроков нет: пакт значит одно — союзник может прийти на выручку, а походом на него
 * не пойти.
 */
function pactOrder(file: WarFile, key: string, target: string, now: number, ctx: OrderCtx): string | null {
  const other = Object.keys(ctx.roster.rows).find((k) => castleIdOf(k) === target) ?? null;
  if (!other) return 'Такого города нет на карте.';
  if (other === key) return 'Пакт с самим собой не заключают.';
  if (pacted(file, key, other)) return 'Пакт уже заключён.';
  if (file.wars.some((w) => active(w) && ((w.atk === key && w.def === other) || (w.atk === other && w.def === key)))) {
    return 'Между нами идёт война. Пакта не будет, пока она не кончится.';
  }
  const cities = { [key]: cityOr(ctx.roster.rows[key]?.city), [other]: cityOr(ctx.roster.rows[other]?.city) };
  const offers = file.offers ?? [];
  if (offers.some((o) => o.from === other && o.to === key)) {
    file.offers = offers.filter((o) => !(o.from === other && o.to === key));
    const [a, b] = key < other ? [key, other] : [other, key];
    file.pacts = [...(file.pacts ?? []), { a, b, at: now, cities, by: key }];
    return null;
  }
  if (offers.some((o) => o.from === key && o.to === other)) return 'Предложение уже у них. Ждём ответа.';
  if (offers.filter((o) => o.from === key).length >= PACT_OFFERS_MAX) return 'Предложений и так много. Подожди ответов.';
  file.offers = [...offers, { from: key, to: other, at: now, cities }];
  return null;
}

/** Разорвать пакт, отозвать своё предложение или отклонить чужое. */
function unpactOrder(file: WarFile, key: string, target: string): string | null {
  const offers = file.offers ?? [];
  const pacts = file.pacts ?? [];
  const mine = (k: string): boolean => castleIdOf(k) === target;
  const keepPacts = pacts.filter((p) => !((p.a === key && mine(p.b)) || (p.b === key && mine(p.a))));
  const keepOffers = offers.filter((o) => !((o.from === key && mine(o.to)) || (o.to === key && mine(o.from))));
  if (keepPacts.length === pacts.length && keepOffers.length === offers.length) return 'Пакта нет.';
  file.pacts = keepPacts;
  file.offers = keepOffers;
  return null;
}

const active = (w: WarRow): boolean => w.phase !== 'done';

/** Слепок с отметкой: когда он лёг на сервер. */
export interface SheetAt {
  sheet: WarSheet;
  at: number;
  /**
   * Книга войска игрока (`book.ts`, docs/pvp.md, раздел 6): сколько бойцов сервер подтверждает. Есть — войско и оборона
   * слепка не больше подтверждённого (`liveSheet`); обработчик войны кладёт её всегда. Нет — слепок как есть (тесты правил).
   */
  book?: ArmyBook;
  /**
   * Книга стройки и жителей (`town.ts`, docs/pvp.md, раздел 7): уровни, жители, ополчение, башня, склад и тайник слепка —
   * не больше подтверждённого (`town.townSheet`), а защита слабого — по «не меньше» (`town.floorAt`). Обработчик войны
   * кладёт её всегда. Нет — слепок как есть (тесты правил).
   */
  town?: TownBook;
}

// ------------------------------------------------ счёт по видам ---

const asTroops = (c: Counts): TroopStack => c as TroopStack;

function minus(a: Counts, b: Counts): Counts {
  const out: Counts = {};
  for (const [k, v] of Object.entries(a)) {
    const left = Math.max(0, (v ?? 0) - Math.max(0, b[k] ?? 0));
    if (left > 0) out[k] = left;
  }
  return out;
}

function plus(a: Counts, b: Counts): Counts {
  const out: Counts = { ...a };
  for (const [k, v] of Object.entries(b)) if ((v ?? 0) > 0) out[k] = (out[k] ?? 0) + (v ?? 0);
  return out;
}

const fits = (want: Counts, have: Counts): boolean => Object.entries(want).every(([k, v]) => (v ?? 0) <= (have[k] ?? 0));

/** Сид боя войны: номер войны и номер боя — одна и та же война даёт один и тот же бой у кого угодно. */
export function warSeed(id: string, n: number): number {
  let h = 0x811c9dc5 ^ n;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  h = Math.imul(h ^ (h >>> 16), 0x85ebca6b);
  return (h ^ (h >>> 13)) >>> 0;
}

/** Отметка падения города в списке принятого (`WarSheet.seen`). */
export const fallId = warFallId;

/**
 * Оборона города в минуту `at`: слепок минус то, что война отняла у него, а клиент ещё не принял на себя
 * (`WarSheet.seen`). Защитник мог не заходить с боя, и второй бой не должен драться с гарнизоном, уже
 * павшим в первом.
 *
 * И свой поход (docs/retinue.md): отряд полководца стоит в гарнизоне, пока полководец дома, уходит с ним и с ним
 * возвращается. Слепок лёг до выхода — ушедшие в нём ещё дома, и сервер их вычитает (не больше отряда, что слепок
 * назвал стоящим дома, `WarSheet.retinue`); лёг, пока войско в походе (`WarSheet.out`), — вернувшихся в нём нет, и
 * сервер их прибавляет. Игрок мог не заходить ни с выхода, ни с возврата, а бой у его стен идёт без него. Отметки
 * полководца у ворот (`pips`) ходят с отрядом так же.
 */
export function liveSheet(file: WarFile, key: string, s: SheetAt, at = Infinity): WarSheet {
  const claim = claimedSheet(file, key, s, at);
  if (!s.book) return s.town ? townSheet(claim, s.town, troopPower(asTroops(claim.home))) : claim;
  // Книга войска (docs/pvp.md, раздел 6): в бой идёт только подтверждённое. Слепок — то, что заявил клиент; книга — что
  // сервер может объяснить обучением, указами и потерями войны. По видам — меньшее; дома — не больше всего войска.
  const army = least(claim.army, bookLive(s.book, file, key));
  const home = least(claim.home, army);
  const live: WarSheet = {
    ...claim,
    army,
    home,
    ...(claim.retinue ? { retinue: least(claim.retinue, home) } : {}),
    power: troopPower(asTroops(army)),
  };
  // Книга стройки (docs/pvp.md, раздел 7): уровни, жители, ополчение, башня, склад и тайник — не больше подтверждённого.
  return s.town ? townSheet(live, s.town, troopPower(asTroops(home))) : live;
}

/**
 * Защита слабого (`lairs.weakCity`) по слепку и книге: жители и мощь — не меньше «наибольшего» книги стройки за вычетом
 * того, что сервер объясняет (`town.floorAt`): город, заявивший себя меньше, чем был, защиты не получает.
 */
export function shielded(file: WarFile, key: string, s: SheetAt, at: number): boolean {
  const power = Math.max(s.sheet.power, liveSheet(file, key, s, at).power);
  if (!s.town) return weakCity(s.sheet.pop, power);
  const floor = floorAt(s.town, at);
  return weakCity(Math.max(s.sheet.pop, floor.pop), Math.max(power, floor.power));
}

/**
 * Слепок, как его заявил клиент, приведённый к минуте `at` (см. `liveSheet`), но без книги войска. Стойкость и отметки —
 * в пределах правил (`book.ruleResolve`, `rulePips`): больше их у игрока не бывает никак.
 */
function claimedSheet(file: WarFile, key: string, s: SheetAt, at: number): WarSheet {
  const seen = new Set(s.sheet.seen);
  let army = s.sheet.army;
  let home = s.sheet.home;
  let stock = s.sheet.stock;
  let gold = s.sheet.gold;
  let bonded = s.sheet.bonded;
  let pop = s.sheet.pop;
  const levels = { ...s.sheet.levels };
  for (const w of file.wars) {
    if (w.atk === key) for (const b of w.battles) if (!seen.has(b.id)) army = minus(army, b.atkLost);
    if (w.def !== key) continue;
    for (const b of w.battles) {
      if (seen.has(b.id)) continue;
      home = minus(home, b.homeLost);
      army = minus(army, plus(b.homeLost, b.genLost ?? {}));
    }
    const f = w.fall;
    if (f && !seen.has(fallId(w.id))) {
      home = minus(home, f.routed);
      army = minus(army, f.routed);
      const { gold: g, ...goods } = f.lost;
      stock = minus(stock, goods);
      gold = Math.max(0, gold - (g ?? 0));
      bonded = Math.max(0, bonded - f.bondedLost);
      pop = Math.max(1, pop - f.popLost);
      for (const x of f.fallen) if (levels[x.id] !== undefined) levels[x.id] = Math.min(levels[x.id], x.to);
    }
    // Дань, ещё не принятая городом (docs/siege_v2.md, 7.3): ушедшее добро вычитается, как добыча падения.
    const t = w.tribute;
    if (t && !seen.has(warTributeId(w.id))) {
      const { gold: g, ...goods } = t.taken;
      stock = minus(stock, goods);
      gold = Math.max(0, gold - (g ?? 0));
    }
  }
  // Дела лазутчиков, ещё не принятые этим городом (docs/spy_pvp.md): у соседа — сгоревшее, унесённое и ушедшие люди; у
  // нападающего — ровно унесённое и пришедшие люди. Переход, а не начисление: одна запись `stolen` на обе стороны.
  for (const sp of file.spies ?? []) {
    const o = sp.out;
    if (!o || seen.has(spySeenId(sp.id))) continue;
    const { gold: took, ...goods } = o.stolen ?? {};
    if (sp.def === key) {
      stock = minus(minus(stock, o.burned ?? {}), goods);
      gold = Math.max(0, gold - (took ?? 0));
      pop = Math.max(1, pop - (o.lured ?? 0));
    }
    if (sp.atk === key) {
      stock = plus(stock, goods);
      gold += took ?? 0;
      pop += o.lured ?? 0;
    }
  }
  let pips = s.sheet.pips;
  const out = new Set(s.sheet.out ?? []);
  for (const w of file.wars) {
    if (w.atk !== key || w.sentAt > at) continue;
    const back = (w.phase === 'back' || w.phase === 'done') && (w.backAt ?? w.endAt ?? Infinity) <= at;
    if (out.has(w.id)) {
      if (!back) continue;
      home = plus(home, w.army.troops);
      pips = w.army.pips;
    } else if (s.at < w.sentAt) {
      const went = w.went ?? w.army.troops;
      home = minus(home, s.sheet.retinue ? atMost(went, s.sheet.retinue) : went);
      pips = back ? w.army.pips : {};
      if (back) home = plus(home, w.army.troops);
    }
  }
  return { ...s.sheet, army, home, stock, gold, bonded, pop, levels, pips: rulePips(pips), resolve: ruleResolve(s.sheet.resolve) };
}

/** По видам — не больше, чем в `cap`. */
function atMost(a: Counts, cap: Counts): Counts {
  const out: Counts = {};
  for (const [k, v] of Object.entries(a)) {
    const n = Math.min(Math.max(0, v ?? 0), Math.max(0, cap[k] ?? 0));
    if (n > 0) out[k] = n;
  }
  return out;
}

// ------------------------------------------------ бои ---

const men = (t: Counts): number => stackTotal(kindsOf(asTroops(t)));

/** Мораль войска похода в минуту `at` (`world/rest`). */
const armyRest = (a: WarArmy, at: number): number => restAt(a.rest, at, men(a.troops));

/** Войско после боя: минус павшие, мораль — с какой вышли; энергия полководца — та же. */
function wear(a: WarArmy, lost: Counts, share: number, at: number): WarArmy {
  const troops = minus(a.troops, lost);
  const rest = restAfter(share, at, men(troops));
  return { troops, resolve: a.resolve, pips: a.pips, ...(rest ? { rest } : {}), ...(a.energy ? { energy: a.energy } : {}) };
}

/**
 * Обратный путь войска: энергия полководца уходит в дороге и копится с минуты возврата — той же функцией дороги, что у
 * мира на клиенте (`world/energy.onRoad`; docs/agent_energy.md, раздел 2).
 */
function homeward(w: WarRow, at: number, backAt: number): void {
  w.army = { ...w.army, energy: onRoad(w.army.energy, at, backAt, true) };
}

/**
 * Мораль гарнизона города в минуту `at`: слепок, и осада, если лагерь стоит, — день за днём, с обстрелом лагеря
 * (`siegecraft.garrisonWear`, та же дверь, что у гарнизона логова под лагерем игрока).
 */
const garrisonRest = (w: WarRow, sheet: WarSheet, at: number): number =>
  sheet.rest * (w.camp ? garrisonWear(w.camp as SiegeWindow, at) : 1);

/** Лучники дома — расчёт орудия на башне (`bombard.aimOf`): тот же счёт по видам, что у мира (`LocalWorld.aimTower`). */
const archersOf = (home: Counts): number => TROOPS_OF_KIND.archer.reduce((n, t) => n + Math.max(0, home[t] ?? 0), 0);

/**
 * Орудие башни из слепка обороны (docs/siege_v2.md, раздел 5: башня бьёт и по лагерю игрока) — только такое, какое стоит на
 * башне подтверждённого уровня (`game/data/engines`, книга стройки — `sheet.levels`), и мест не больше, чем на ней есть.
 * Иное — нет орудия: число орудия клиент не назначает.
 */
export function sheetGun(sheet: WarSheet): TowerGun | undefined {
  const g = sheet.tower;
  if (!g) return undefined;
  const level = Math.max(0, Math.floor(sheet.levels.tower ?? 0));
  const e = ENGINES.find((x) => x.level <= level && x.crew === g.crew && x.slow === g.slow && x.thin === g.thin);
  if (!e) return undefined;
  return { slow: e.slow, thin: e.thin, crew: e.crew, seats: Math.min(g.seats, Math.floor(statAt('tower', 'seats', level) + 1e-9)) };
}

/** Сила обстрела по лагерю: орудие башни на долю расчёта, что дома. */
const aimOfSheet = (sheet: WarSheet): Aim => aimOf(sheetGun(sheet), archersOf(sheet.home));

/** Какая доля лагеря выбита обстрелом с башни к минуте `at` (`bombard.thinAt`). Башня не бьёт — ноль. */
const thinOf = (w: WarRow, at: number): number => (w.camp ? thinAt(w.camp.fire as Fire | undefined, at) : 0);

/** Роды лагеря, прорежённые обстрелом, — в бой идут те, кого башня не выбила (`bombard.thinKinds`, как у мира). */
const thinned = (kinds: Stack, thin: number): Stack => thinKinds(kinds, thin);

/** Что сделано в лагере к бою, с проломами — в запись боя, чтобы донесение у обеих сторон сказало это словами. */
const craftOf = (w: WarRow): { craft?: Craft } => {
  if (!w.camp) return {};
  const c = craftAt(w.camp as SiegeWindow);
  return craftCount(c, 'fortify') > 0 || craftCount(c, 'bombard') > 0 || (c.breach ?? 0) > 0 ? { craft: c } : {};
};

/**
 * Штурм города войском похода в минуту `at`. Возвращает бой и победил ли поход. `machines` — машины лагеря, пущенные в этот
 * штурм (`world/machines.stormMachines`): они истрачены, а проёмы их — во фронте.
 */
function storm(w: WarRow, at: number, sheet: WarSheet, machines: readonly MachineId[] = []): { battle: WarBattle; won: boolean } {
  const n = w.battles.length;
  // Стена-проход (`fights.wallFight`, docs/siege_v2.md, 4.1): штурм из лагеря идёт проломами фаз и машинами, штурм с ходу —
  // по лестницам, принесённым на себе. Ополчение стоит на стене всё: пролом открывает долю фронта, а не снимает людей.
  const wall = { militia: sheet.militia, archers: sheet.archers };
  const front = wallFront(w.camp ? assaultOf(breachesOf(w.camp as SiegeWindow), machines) : SCALING);
  if (w.camp && machines.length > 0) w.camp = { ...w.camp, machines: machinesSpent(w.camp as SiegeWindow, at, machines) as WarCamp['machines'] };
  const { input, field } = wallFight({
    seed: warSeed(w.id, n),
    // Башня города бьёт по лагерю (docs/siege_v2.md, раздел 5): на штурм идут те, кого обстрел не выбил.
    attacker: { kinds: thinned(kindsOf(asTroops(w.army.troops)), thinOf(w, at)), resolve: w.army.resolve, pips: w.army.pips as Pips, rest: armyRest(w.army, at) },
    defender: {
      kinds: kindsOf(asTroops(sheet.home)),
      militia: wall.militia,
      archers: wall.archers,
      resolve: sheet.resolve,
      pips: sheet.pips as Pips,
      rest: garrisonRest(w, sheet, at),
    },
    front,
  });
  const atkLost = field.result ? (troopLosses(asTroops(w.army.troops), field.result.sides.attacker.losses) as Counts) : {};
  const homeLost = homeLosses(asTroops(sheet.home), field) as Counts;
  const battle: WarBattle = {
    id: `${w.id}.${n}`,
    at,
    site: 'wall',
    by: 'atk',
    input: input as WarBattle['input'],
    won: field.won,
    atkTroops: { ...w.army.troops },
    atkLost,
    homeTroops: { ...sheet.home },
    homeLost,
    militia: { men: wall.militia, archers: wall.archers },
    ...craftOf(w),
    // Проёмы штурма — только показ: ролик рисует выбранный способ (лестницы, таран, башня, пролом).
    openings: front.openings,
  };
  w.battles.push(battle);
  w.army = wear(w.army, atkLost, field.rest.attacker, at);
  return { battle, won: field.won };
}

/**
 * Участь города `fated` в минуту `at`, если его возьмёт войско похода, — дверь `spoils.fate`. Одна на падение и на цену
 * дани (`fairOf`): справедливая дань считается от той же добычи, что увезёт падение.
 */
function fateOfWar(w: WarRow, at: number, sheet: WarSheet, fated: WarRow['fate']) {
  // Обоз и конвой — уцелевшие похода, той же меркой, что у полководца против логова (`LocalWorld.haul`).
  const survivors = troopTotal(asTroops(w.army.troops));
  return fate({
    fate: fated,
    stock: sheet.stock,
    gold: sheet.gold,
    stash: sheet.stash,
    pop: sheet.pop,
    bonded: sheet.bonded,
    carry: stackCarry({ warrior: survivors }),
    escort: stackEscort({ warrior: survivors }),
    levels: sheet.levels,
    seed: fallSeed(warSeed(w.id, 0xfa11), at),
  });
}

/**
 * Участь взятого города — одна дверь `spoils.fate`, у обеих сторон одними числами. `terms` — сдача на условиях
 * (docs/siege_v2.md, 7.1): участь из принятых условий, гарнизон уходит живым, как при сдаче.
 */
function fall(w: WarRow, at: number, sheet: WarSheet, by: WarFall['by'], terms?: WarRow['fate']): void {
  // Сдача (ворота открыли на фазе осады) — участь на ступень мягче объявленной, гарнизон уходит живым (ответ владельца 5).
  const fated = terms ?? (by === 'gates' ? softerFate(w.fate) : w.fate);
  const r = fateOfWar(w, at, sheet, fated);
  const loss = homeLoss(r);
  const gain = winnerGain(r);
  const routed: Counts = {};
  if (by === 'hunger') {
    for (const [k, v] of Object.entries(sheet.home)) {
      const gone = Math.floor(Math.max(0, v ?? 0) * SIEGE_ROUT);
      if (gone > 0) routed[k] = gone;
    }
  }
  const lost: Counts = {};
  for (const [k, v] of Object.entries(r.lost)) if ((v ?? 0) > 0) lost[k] = v as number;
  const taken: Counts = {};
  for (const [k, v] of Object.entries(gain.resources)) if ((v ?? 0) > 0) taken[k] = v as number;
  w.fall = {
    at,
    fate: fated,
    by,
    taken,
    led: gain.bonded ?? 0,
    lost,
    bondedLost: Math.max(0, -(loss.bonded ?? 0)),
    popLost: loss.popLost ?? 0,
    fallen: loss.fallen ?? [],
    burned: loss.burned ?? false,
    hidden: r.hiddenTotal,
    routed,
    ...(terms ? { terms: true as const } : {}),
  };
}

// ------------------------------------------------ переговоры у стен (docs/siege_v2.md, раздел 7; этап 2е) ---

/** Справедливая дань в минуту `at` (7.2): добыча объявленной участи × доля пути осады — дверью `world/parley`. */
export function fairOf(w: WarRow, at: number, sheet: WarSheet): number {
  return w.camp ? fairTribute(bountyOf(fateOfWar(w, at, sheet, w.fate)), siegeShare(w.camp as SiegeWindow, at)) : 0;
}

/**
 * Ответ на предложение вида `kind`, ждущее в минуту `now` (7.3). Принятая дань — добро переходит от города походу той же
 * дверью дележа, что добыча (`parley.tributeGoods`), лагерь уходит домой, город получает неприкосновенность, как после
 * падения; принятые условия — падение сдачей с участью из условий. Ответа нет — null; предложения уже нет — отказ.
 */
function settleOffer(file: WarFile, w: WarRow, now: number, ctx: OrderCtx, kind: OfferKind, yes: boolean): string | null {
  if (!w.camp) return 'Лагеря уже нет.';
  const live = liveOffer(w.camp as SiegeWindow, kind, now);
  if (!live) return 'Предложение уже не в силе.';
  const s = ctx.sheet(w.def);
  if (yes && !s) return 'Вести о городе ещё не дошли до края. Подожди минуту.';
  w.camp = { ...w.camp, ...answerAfter(w.camp as SiegeWindow, kind, yes ? 'yes' : 'no', now) } as WarCamp;
  if (!yes || !s) return null;
  const sheet = liveSheet(file, w.def, s, now);
  if (kind === 'terms') {
    fall(w, now, sheet, 'gates', live.fate ?? softerFate(w.fate));
    turnBack(w, now, w.to, 'taken');
    return null;
  }
  const paid = tributeGoods(sheet.stock as Loot, sheet.gold, sheet.stash, live.price ?? 0);
  const taken: Counts = {};
  for (const [k, v] of Object.entries(paid.taken)) if ((v ?? 0) > 0) taken[k] = v as number;
  w.tribute = { at: now, taken, hidden: paid.hiddenTotal };
  turnBack(w, now, w.to, 'paid');
  return null;
}

/**
 * Наказы на переговоры (8.3): осаждающий принимает дань не меньше справедливой — цена дани и есть справедливая на минуту
 * предложения; осаждённый принимает сдачу на условиях не хуже названной участи. Срабатывают в минуту, когда предложение
 * пришло или наказ поставлен, — той же дверью, что кнопка.
 */
function autoAnswer(file: WarFile, w: WarRow, now: number, ctx: OrderCtx): void {
  const camp = w.camp as SiegeWindow | undefined;
  if (!camp) return;
  const tribute = liveOffer(camp, 'tribute', now);
  if (tribute && camp.orders?.tribute) {
    settleOffer(file, w, now, ctx, 'tribute', true);
    return;
  }
  const terms = liveOffer(camp, 'terms', now);
  const floor = camp.defend?.terms;
  if (terms?.fate && floor && !softerThan(floor, terms.fate)) settleOffer(file, w, now, ctx, 'terms', true);
}

/** Темп войны (`http.warPace`): во сколько раз быстрее походы и голод. Ставит его обработчик на запрос. */
let pace = 1;

/** Поставить темп войны на этот запрос. Вне обработчика — 1, обычная игра. */
export const setWarPace = (n: number): void => {
  pace = Number.isFinite(n) && n >= 1 ? n : 1;
};

/** Путь войска между двумя клетками с темпом войны. */
const walk = (from: { x: number; y: number }, to: { x: number; y: number }): number => Math.round(warWalkMs(from, to) / pace);

/** Войско уходит домой от минуты `at` с места `from`. Некому уходить — война кончена на месте. */
function turnBack(w: WarRow, at: number, from: { x: number; y: number }, end: WarEnd): void {
  // Журнал фаз переживает лагерь: по нему вести и донесение у обеих сторон (`newsOf`).
  if (w.camp?.phases?.length) w.phases = w.camp.phases;
  // Выбитое башней записывается одним разом, когда лагерь снят, — как у лагеря под логовом (`LocalWorld.liftSiege`).
  const thin = thinOf(w, at);
  if (thin > 0) w.army = { ...w.army, troops: wasted(w.army.troops, thin) };
  delete w.camp;
  delete w.starvesAt;
  delete w.strike;
  // Выручка, не дошедшая до лагеря, бить больше некого: союзник остаётся в поле, где стоит.
  delete w.reliefs;
  w.end = end;
  w.endAt = at;
  if (troopTotal(asTroops(w.army.troops)) <= 0) {
    w.phase = 'done';
    return;
  }
  w.phase = 'back';
  w.backFrom = from;
  w.backAt = at + walk(from, w.from);
  homeward(w, at, w.backAt);
}

/**
 * Окно осады из слепка обороны: те же часы голода, что у осады логова (`siege.openSiege`). `ration` — паёк с этой минуты
 * (приказ осаждённого); нет — как было. Башня города бьёт по лагерю с силой этой минуты (`bombard.reaim`).
 */
function campWindow(w: WarRow, at: number, sheet: WarSheet, prev: WarCamp | null, ration?: boolean): WarCamp {
  const win = openSiege({
    byId: w.atkCastle,
    campId: w.id,
    now: at,
    // Темп войны ускоряет и голод: хлеба в окне во столько же раз меньше.
    food: prev ? foodLeft(prev as SiegeWindow, at) : sheet.food / pace,
    garrison: troopTotal(asTroops(sheet.home)),
    townPerHour: sheet.townPerHour,
    perManPerHour: sheet.perManPerHour,
    since: prev ? siegeSince(prev as SiegeWindow) : at,
    gateAt: prev?.gateAt,
    rearGateAt: prev?.rearGateAt,
    fate: w.fate,
    // Древесина — как у лагеря игрока под логовом: всё во фронт (`works.playerWood`).
    wood: prev?.wood ?? playerWood(1),
    // Рогатки держат те, кто их строил: у нового лагеря — войско в минуту постановки.
    builders: prev?.builders ?? men(w.army.troops),
    // Дела полководца в лагере той же осады (`world/siegecraft`) переносятся, как проходы.
    craft: prev?.craft,
    // Ход осады фазами (`world/siegeroll`): стена города и путь войска от дома — при постановке (путь без темпа войны:
    // истощение считает игровые дни дороги), журнал дел и фаз и наказы той же осады переносятся.
    wall: prev ? prev.wall : (sheet.levels.palisade ?? 0),
    homeDays: prev ? prev.homeDays : gameDaysOfMs(warWalkMs(w.from, w.to)),
    log: prev ? prev.log : [],
    phases: prev?.phases,
    orders: prev?.orders,
    // Ответы осаждённого (раздел 5): паёк и наказы той же осады, очередь машин и обстрел с башни переносятся.
    ration: ration ?? prev?.ration,
    defend: prev?.defend,
    machines: prev?.machines as SiegeWindow['machines'],
    fire: prev?.fire as Fire | undefined,
    // Отметки «осада» полководца похода — при постановке лагеря (в пределах правил, `book.rulePips`); переговоры той же
    // осады переносятся (docs/siege_v2.md, этап 2е).
    lead: prev ? prev.lead : w.army.pips.siege,
    offers: prev?.offers as SiegeWindow['offers'],
  });
  const aimed = reaim(win.fire, win.wood, siegeSince(win), at, aimOfSheet(sheet));
  if (aimed.fire) win.fire = aimed.fire;
  else delete win.fire;
  if (aimed.wood) win.wood = aimed.wood;
  return win as WarCamp;
}

/** Войско после истощения фазы: доля `share` с каждого рода, как при потерях в бою. */
function wasted(troops: Counts, share: number): Counts {
  const kinds = kindsOf(asTroops(troops));
  const hit = { ...kinds };
  for (const k of Object.keys(hit) as (keyof typeof hit)[]) hit[k] = Math.round(kinds[k] * share);
  return minus(troops, troopLosses(asTroops(troops), hit) as Counts);
}

/**
 * Фаза осады в минуту `at` (docs/siege_v2.md, раздел 2) — той же дверью, что у мира на клиенте (`siegeroll.rollPhase`):
 * строка в журнал лагеря, истощение войска похода (раздел 3), исход. Ворота открыли — падение (`fall`, сдача); лагерь
 * растаял — осада снята. Потом наказы нападающего (8.3) — те же приказы с теми же отказами: штурм при названных проломах,
 * иначе залп этой фазы, пока энергии хватает и на него, и на штурм. `atkHungry` — пуст ли амбар дома у нападающего.
 */
function phaseStep(w: WarRow, at: number, sheet: WarSheet, atkHungry: boolean): void {
  const camp = w.camp as SiegeWindow;
  const k = rowsOf(camp).length + 1;
  const row = rollPhase(camp, k, atkHungry);
  camp.phases = [...rowsOf(camp), row];
  if (row.waste > 0) w.army = { ...w.army, troops: wasted(w.army.troops, row.waste) };
  if (troopTotal(asTroops(w.army.troops)) <= 0) {
    turnBack(w, at, w.to, 'lifted');
    return;
  }
  if (row.out === 'gates') {
    fall(w, at, sheet, 'gates');
    turnBack(w, at, w.to, 'taken');
    return;
  }
  const orders = camp.orders;
  if (orderStorms(orders, breachesOf(camp)) && !energyBlock(energyAt(w.army.energy, at), priceOf('storm'))) {
    row.orders = ['storm'];
    w.army = { ...w.army, energy: spend(w.army.energy, at, priceOf('storm')) };
    // Наказ штурма идёт всем, что готово (`machines.stormMachines` без списка).
    stormCamp(w, at, sheet, stormMachines(camp, at));
  } else if (orderVolleys(orders, energyAt(w.army.energy, at), priceOf('bombard'), priceOf('storm')) && !craftBlock(camp, 'bombard', at)) {
    w.army = { ...w.army, energy: spend(w.army.energy, at, priceOf('bombard')) };
    Object.assign(camp, craftAfter(camp, 'bombard', at));
    row.orders = ['volley'];
  }
  // Наказы осаждённого (8.3, этап 2г) — после наказов лагеря, в ту же минуту и той же дверью, что его кнопки.
  if (w.phase === 'camp' && w.camp) defendStep(w, at, sheet, row);
}

/**
 * Наказы осаждённого в минуту фазы (docs/siege_v2.md, 8.3): починка пролома, пока хватает дерева и камня на складе, и
 * урезанный паёк, когда хлеба меньше половины. Те же дела, что ручные (`repair`, `ration`), с теми же отказами.
 */
function defendStep(w: WarRow, at: number, sheet: WarSheet, row: PhaseRow): void {
  const camp = w.camp as SiegeWindow;
  const d = camp.defend;
  if (!d) return;
  const done: PhaseRow['orders'] = [];
  if (orderRepairs(d, camp, at, repairShort(w, sheet) === null)) {
    w.camp = { ...w.camp, ...repairAfter(camp, at) } as WarCamp;
    done.push('repair');
  }
  const ration = orderRations(d, Boolean(camp.ration), breadLeft(camp, at));
  if (ration) done.push('ration');
  if (!done.length) return;
  row.orders = [...(row.orders ?? []), ...done];
  if (ration) setCamp(w, campWindow(w, at, sheet, w.camp as WarCamp, true));
}

/**
 * Хватает ли защитнику на починку пролома (docs/siege_v2.md, раздел 5): треть цены уровня стен (`build.wallRepairCost`, стена
 * — уровень частокола в минуту, когда встал лагерь) — со склада слепка, за вычетом починок, которые клиент ещё не оплатил
 * (`WarSheet.seen`). Хватает — null; нет — отказ словами.
 */
function repairShort(w: WarRow, sheet: WarSheet): string | null {
  const camp = w.camp;
  if (!camp) return 'Лагеря под стенами уже нет.';
  const cost = wallRepairCost(camp.wall ?? 0);
  if (!Object.keys(cost).length) return 'Стен нет, чинить нечего.';
  const seen = new Set(sheet.seen);
  const unpaid = repairsOf(camp as SiegeWindow).filter((d) => !seen.has(warRepairId(w.id, d.at))).length;
  for (const [r, v] of Object.entries(cost)) if ((sheet.stock[r] ?? 0) < (v ?? 0) * (unpaid + 1)) return 'На починку не хватает дерева и камня.';
  return null;
}

/**
 * Вылазка на машину лагеря (docs/siege_v2.md, раздел 5) — той же дверью, что у мира (`fights.machineFight`): вышедшие из
 * ворот бьются с охраной машины — стороной лагеря у города (`machines.GUARD_SHARE`). Победа сжигает машину вместе с древесиной;
 * лагерь стоит. Часы голода — от нового гарнизона, как после всякой вылазки.
 */
function burnMachine(w: WarRow, at: number, sheet: WarSheet, id: MachineId, troops: Counts): string | null {
  const camp = w.camp;
  if (!camp) return 'Лагеря под стенами уже нет.';
  const n = w.battles.length;
  const side = campSide(w, at);
  const { input, field } = machineFight({
    seed: warSeed(w.id, n),
    guard: { kinds: guardKinds(side.kinds, GUARD_SHARE), resolve: side.resolve, pips: side.pips, rest: side.rest },
    sortie: { kinds: kindsOf(asTroops(troops)), rest: garrisonRest(w, sheet, at) },
    resolve: sheet.resolve,
    pips: sheet.pips as Pips,
  });
  const homeLost = field.result ? (troopLosses(asTroops(troops), field.result.sides.attacker.losses) as Counts) : {};
  const atkLost = field.result ? (troopLosses(asTroops(w.army.troops), field.result.sides.defender.losses) as Counts) : {};
  w.battles.push({
    id: `${w.id}.${n}`,
    at,
    site: 'sortie',
    by: 'def',
    input: input as WarBattle['input'],
    won: field.won,
    atkTroops: { ...w.army.troops },
    atkLost,
    homeTroops: { ...troops },
    homeLost,
    burn: id,
    ...craftOf(w),
  });
  // Дралась охрана, а не весь лагерь: убыль — её потери, мораль лагеря прежняя.
  w.army = { ...w.army, troops: minus(w.army.troops, atkLost) };
  if (field.won) w.camp = { ...camp, machines: machinesBurned(camp as SiegeWindow, id, at) as WarCamp['machines'] };
  if (troopTotal(asTroops(w.army.troops)) <= 0) {
    turnBack(w, at, w.to, 'lifted');
    return null;
  }
  setCamp(w, campWindow(w, at, { ...sheet, home: minus(sheet.home, homeLost) }, w.camp as WarCamp));
  return null;
}

/**
 * Штурм из лагеря и что с лагерем после (docs/siege_v2.md, 4.4): взяли — падение; отбили — **осада идёт дальше** с тем,
 * что осталось: штурм с машинами — дело осады, а не отказ от неё. Лагерь снимается, только если штурмовать стало некому.
 */
function stormCamp(w: WarRow, at: number, sheet: WarSheet, machines: readonly MachineId[]): boolean {
  const { won } = storm(w, at, sheet, machines);
  if (won) {
    fall(w, at, sheet, 'storm');
    turnBack(w, at, w.to, 'taken');
  } else if (troopTotal(asTroops(w.army.troops)) <= 0) turnBack(w, at, w.to, 'beaten');
  return won;
}

function setCamp(w: WarRow, camp: WarCamp): void {
  w.camp = camp;
  w.starvesAt = Math.round(starvesAt(camp as SiegeWindow));
}

/**
 * Гарнизон города сменился — часы голода заново, от остатка хлеба (docs/siege_audit.md, решение 8). Как у осады логова
 * (`LocalWorld.resiege`): один пересчёт на одно событие, тика нет. Событие здесь — новый слепок обороны, в котором
 * гарнизон не тот, по которому открыто окно: вернул дружину домой, вывел полководца в поле, отряд дошёл. Пересчёт — на
 * минуту, когда слепок лёг (`s.at`), и только если она раньше ближайшего события лагеря (`until`): удар и голод,
 * назначенные раньше, разбираются первыми. Слепок не новее окна — его гарнизон окно уже знает.
 */
function regarrison(file: WarFile, w: WarRow, s: SheetAt, until: number): boolean {
  const camp = w.camp;
  if (!camp || s.at <= camp.startedAt || s.at >= until) return false;
  const live = liveSheet(file, w.def, s, s.at);
  if (troopTotal(asTroops(live.home)) === camp.garrisonAtStart) return false;
  setCamp(w, campWindow(w, s.at, live, camp));
  return true;
}

/** Лагерь в родах боя — кто в нём стоит. */
const campSide = (w: WarRow, at: number) => ({
  // Башня города бьёт по лагерю: в бою те, кого обстрел не выбил (`bombard.thinAt`).
  kinds: thinned(kindsOf(asTroops(w.army.troops)), thinOf(w, at)),
  resolve: w.army.resolve,
  pips: w.army.pips as Pips,
  rest: armyRest(w.army, at),
});

const sightOf = (c: WarCamp) => ({
  since: siegeSince(c as SiegeWindow),
  builders: c.builders ?? 0,
  gateAt: c.gateAt,
  rearGateAt: c.rearGateAt,
  // Катапульта башни рубит рогатки со стороны города медленнее (`bombard.firePlan`).
  wood: firePlan(c.fire as Fire | undefined, c.wood),
});

/**
 * Удар по лагерю из города — вылазка (`front`), полководец с тыла (`rear`) или оба сразу (совместный удар).
 * Бой один, дверь та же, что у мира (`fights.campFight`). Победа города снимает осаду, иначе часы голода
 * пересчитываются от нового гарнизона — один раз, в самом событии.
 */
function hitCamp(
  w: WarRow,
  at: number,
  sheet: WarSheet,
  hit: { front?: Counts; rear?: WarArmy; site: WarBattle['site']; ally?: string; city?: string },
): string | null {
  const camp = w.camp;
  if (!camp) return 'Лагеря уже нет.';
  const n = w.battles.length;
  const fight = campFight({
    seed: warSeed(w.id, n),
    at,
    sight: sightOf(camp),
    camp: campSide(w, at),
    front: hit.front ? { kinds: kindsOf(asTroops(hit.front)), rest: garrisonRest(w, sheet, at) } : undefined,
    rear: hit.rear ? { kinds: kindsOf(asTroops(hit.rear.troops)), rest: armyRest(hit.rear, at) } : undefined,
    // Ведёт полководец, если он бьёт с тыла; вылазку — он же, если стоит у ворот (слепок).
    resolve: hit.rear ? hit.rear.resolve : sheet.resolve,
    pips: (hit.rear ? hit.rear.pips : sheet.pips) as Pips,
    // Укрепления лагеря — та же дверь, что у лагеря игрока под логовом (`siegecraft.fortFaces`).
    fort: fortFaces(camp.craft),
  });
  if (fight.refused) {
    const waits = [fight.front, fight.rear].filter((t) => t && t.went > 0).map((t) => t?.waitMs ?? 0);
    const waitMs = Math.min(...waits);
    // Удар из поля — полководца города или выручки союзника — приходит назначенной минутой, и сказать «не пробиться» в ответ
    // на приказ некому: боя нет, дружина цела и стоит в поле. Это запись войны, по ней донесение у того, чья дружина, и
    // весть союзнику (docs/siege_v2.md, 19.2); прежде такой удар пропадал молча.
    if (hit.rear) {
      const men = troopTotal(asTroops(hit.rear.troops));
      w.turned = [...(w.turned ?? []), { at, waitMs, men, ...(hit.ally ? { ally: hit.ally, city: cityOr(hit.city) } : {}) }];
    }
    return gateBusyText(waitMs);
  }
  const { field, front, rear, lost } = fight;
  const homeLost = hit.front ? (troopLosses(asTroops(hit.front), lost.front) as Counts) : {};
  const genLost = hit.rear ? (troopLosses(asTroops(hit.rear.troops), lost.rear) as Counts) : undefined;
  const atkLost = field.result ? (troopLosses(asTroops(w.army.troops), field.result.sides.defender.losses) as Counts) : {};
  const battle: WarBattle = {
    id: `${w.id}.${n}`,
    at,
    site: hit.site,
    by: 'def',
    input: fight.input as WarBattle['input'],
    won: field.won,
    atkTroops: { ...w.army.troops },
    atkLost,
    homeTroops: { ...(hit.front ?? {}) },
    homeLost,
    ...(hit.rear ? { genTroops: { ...hit.rear.troops }, genLost } : {}),
    ...(front ? { through: { went: front.went, passed: front.passed } } : {}),
    ...(rear ? { rearThrough: { went: rear.went, passed: rear.passed } } : {}),
    ...craftOf(w),
    // Выручка союзника: его дружина в `genTroops`, списывает её он, а не город.
    ...(hit.ally ? { ally: hit.ally } : {}),
  };
  w.battles.push(battle);
  w.army = wear(w.army, atkLost, field.rest.defender, at);
  // Проходы сторон заняты прошедшими — отметки в окне осады, как у лагеря логова.
  if (front) camp.gateAt = front.gateAt;
  if (rear) camp.rearGateAt = rear.gateAt;
  if (field.won || troopTotal(asTroops(w.army.troops)) <= 0) {
    turnBack(w, at, w.to, 'lifted');
    return null;
  }
  // Гарнизон убавился — часы голода заново, от остатка хлеба.
  setCamp(w, campWindow(w, at, { ...sheet, home: minus(sheet.home, homeLost) }, camp));
  return null;
}

// ------------------------------------------------ ход времени ---

/** Ключи защитников, чьи слепки нужны, чтобы разобрать всё назначенное к минуте `now`. */
export function dueKeys(file: WarFile, now: number): string[] {
  const keys = new Set<string>();
  for (const w of file.wars) {
    if (w.phase === 'march' && w.arriveAt <= now) keys.add(w.def);
    if (w.phase === 'camp' && ((w.starvesAt ?? Infinity) <= now || (w.strike && w.strike.at <= now))) keys.add(w.def);
    // Выручка союзника дошла: бой у лагеря с гарнизоном слепка защитника.
    if (w.phase === 'camp' && w.reliefs?.some((r) => r.at <= now)) keys.add(w.def);
    // Фаза осады: слепок защитника — для штурма по наказу и падения сдачей, нападающего — пуст ли его амбар.
    if (w.phase === 'camp' && w.camp && nextRollAt(w.camp as SiegeWindow) <= now) {
      keys.add(w.def);
      keys.add(w.atk);
    }
  }
  for (const sp of file.spies ?? []) if (sp.phase === 'go' && sp.arriveAt <= now) keys.add(sp.def);
  return [...keys];
}

/**
 * Разобрать всё, что назначено к минуте `now`, в том порядке, в каком оно случилось бы. Слепки — те, что
 * лежали к этой минуте (`sheets`); нет слепка у защитника — его замок ушёл из игры, и войско идёт домой.
 * Возвращает, изменилось ли что-нибудь.
 */
export function advance(file: WarFile, now: number, sheets: ReadonlyMap<string, SheetAt | null>): boolean {
  let changed = false;
  const sheetOf = (w: WarRow, at: number): WarSheet | null => {
    const s = sheets.get(w.def);
    return s ? liveSheet(file, w.def, s, at) : null;
  };
  for (const w of file.wars) {
    // Фаз за долгий простой бывает много: каждая — одно событие очереди.
    for (let guard = 0; guard < 64; guard++) {
      if (w.phase === 'march' && w.arriveAt <= now) {
        changed = true;
        const sheet = sheetOf(w, w.arriveAt);
        if (!sheet) {
          turnBack(w, w.arriveAt, w.to, 'gone');
          continue;
        }
        if (w.mode === 'storm') {
          const { won } = storm(w, w.arriveAt, sheet);
          if (won) fall(w, w.arriveAt, sheet, 'storm');
          turnBack(w, w.arriveAt, w.to, won ? 'taken' : 'beaten');
        } else {
          w.phase = 'camp';
          setCamp(w, campWindow(w, w.arriveAt, sheet, null));
          // Лагерь — полудом: энергия полководца копится залпом за фазу (ответ владельца 3, docs/siege_v2.md, 8.4).
          w.army = { ...w.army, energy: remark(w.army.energy, w.arriveAt, 'camp') };
        }
        continue;
      }
      if (w.phase === 'camp') {
        const hungerAt = w.starvesAt ?? Infinity;
        // Выручка союзника — тот же удар с тыла, что у полководца города, в минуту своего прихода (раздел 5).
        let relief: WarRelief | null = null;
        for (const r of w.reliefs ?? []) if (!relief || r.at < relief.at) relief = r;
        const strikeAt = Math.min(w.strike?.at ?? Infinity, relief?.at ?? Infinity);
        const rollAt = w.camp ? nextRollAt(w.camp as SiegeWindow) : Infinity;
        const phaseAt = rollAt < hungerAt ? rollAt : Infinity;
        const fresh = sheets.get(w.def);
        if (fresh && regarrison(file, w, fresh, Math.min(hungerAt, strikeAt, phaseAt, now + 1))) {
          changed = true;
          continue;
        }
        const next = Math.min(hungerAt, strikeAt, phaseAt);
        if (next > now) break;
        changed = true;
        const sheet = sheetOf(w, next);
        if (!sheet) {
          turnBack(w, next, w.to, 'gone');
          continue;
        }
        if (strikeAt <= hungerAt && strikeAt <= phaseAt && w.strike && w.strike.at === strikeAt) {
          const s = w.strike;
          delete w.strike;
          hitCamp(w, s.at, sheet, { rear: s.army, front: s.joint ? sheet.home : undefined, site: s.joint ? 'joint' : 'camp' });
          continue;
        }
        if (strikeAt <= hungerAt && strikeAt <= phaseAt && relief) {
          w.reliefs = (w.reliefs ?? []).filter((r) => r !== relief);
          if (!w.reliefs.length) delete w.reliefs;
          hitCamp(w, relief.at, sheet, { rear: relief.army, site: 'camp', ally: relief.castle, city: cityOr(relief.city) });
          continue;
        }
        if (phaseAt < hungerAt) {
          const atk = sheets.get(w.atk);
          phaseStep(w, phaseAt, sheet, atk ? atk.sheet.food <= 0 : false);
          continue;
        }
        fall(w, hungerAt, sheet, 'hunger');
        turnBack(w, hungerAt, w.to, 'taken');
        continue;
      }
      if (w.phase === 'back' && (w.backAt ?? 0) <= now) {
        changed = true;
        w.phase = 'done';
        continue;
      }
      break;
    }
  }
  if (advanceSpies(file, now, sheets)) changed = true;
  return changed;
}

/** Убрать давно кончившиеся и лишние сверх потолка — самые старые первыми. */
export function pruneWars(file: WarFile, now: number): void {
  const was = file.wars;
  file.wars = file.wars.filter((w) => active(w) || now - (w.endAt ?? w.sentAt) <= WAR_KEEP_MS);
  if (file.wars.length > WAR_MAX) {
    const keep = file.wars.filter(active);
    const done = file.wars.filter((w) => !active(w)).slice(-(Math.max(0, WAR_MAX - keep.length)));
    file.wars = file.wars.filter((w) => keep.includes(w) || done.includes(w));
  }
  if (file.spies) {
    const keep = file.spies.filter((x) => x.phase !== 'done' || now - (x.endAt ?? x.sentAt) <= WAR_KEEP_MS).slice(-WAR_MAX);
    if (keep.length !== file.spies.length) file.spies = keep;
  }
  // Убранная война уходит в итоги эпохи: рейтинг её побед не теряет (docs/rating.md).
  if (file.wars.length === was.length) return;
  const past = { ...(file.past ?? {}) };
  for (const w of was) if (!file.wars.includes(w)) tallyWar(past, w);
  file.past = past;
}

// ------------------------------------------------ приказы ---

/** Что нужно приказу кроме записи войн: реестр и слепки сторон. */
export interface OrderCtx {
  roster: RosterFile;
  /** Слепок по ключу игрока; нет — `null`. */
  sheet: (key: string) => SheetAt | null;
  /**
   * Защита слабого выключена: тест с игроками на Сицилии (`http.spawnMode`, docs/test_world.md) — новички на острове
   * воюют с первой минуты. Нет поля — защита есть, обычная игра.
   */
  noShield?: boolean;
  /**
   * Приказ просил больше войска, чем подтверждает книга (docs/pvp.md, раздел 6): отказ уже сказан словами, а это —
   * для флага в описи наблюдения. Слова — для админа.
   */
  forged?: (text: string) => void;
}

/**
 * Хватает ли войска на приказ: сначала заявленного клиентом, потом подтверждённого книгой. Не хватает заявленного —
 * обычный отказ; заявленного хватает, а подтверждённого нет — отказ словами книги и флаг (`OrderCtx.forged`).
 */
function enough(want: Counts, claimed: Counts, confirmed: Counts, where: string, ctx: OrderCtx): string | null {
  if (!fits(want, claimed)) return `Столько бойцов ${where} нет.`;
  if (fits(want, confirmed)) return null;
  const asked = troopTotal(asTroops(want));
  const ok = troopTotal(asTroops(least(want, confirmed)));
  ctx.forged?.(`Приказ войны на ${asked} бойцов ${where}, сервер подтверждает из них ${ok} (сверх книги ${over(want, confirmed)}).`);
  return `К войне готовы ${where} только ${ok} из ${asked} бойцов. Новобранцы встают в строй по мере учения, павшие на войне не возвращаются. Подожди немного или возьми меньше.`;
}

/**
 * Город игрока в осаде у соседа: лагерь стоит под его стенами. Из такого города не выходит ни поход, ни лазутчик — то же
 * правило выхода, что у мира на клиенте (`LocalWorld.siegeBlock`, docs/siege_audit.md, решение 4).
 */
const besieged = (file: WarFile, key: string): boolean => file.wars.some((w) => w.def === key && active(w) && w.phase === 'camp');

const theirs = (file: WarFile, id: string, key: string, role: 'atk' | 'def'): WarRow | null =>
  file.wars.find((w) => w.id === id && (role === 'atk' ? w.atk === key : w.def === key)) ?? null;

/**
 * Приказ стороны. Возвращает отказ словами или `null`. Исхода в приказе нет: всё, что в нём есть, —
 * кого и куда вести; бой считается здесь же или в минуту прихода.
 */
export function applyOrder(file: WarFile, key: string, order: WarOrder, now: number, ctx: OrderCtx): string | null {
  switch (order.op) {
    case 'march':
      return march(file, key, order, now, ctx);
    case 'spy':
      return spyOrder(file, key, order, now, ctx);
    case 'recall': {
      const w = theirs(file, order.id, key, 'atk');
      if (!w || w.phase !== 'march') return 'Отряд уже не в пути.';
      // Обратный путь — по уже пройденному: развернулись там, где шли.
      const at = warAt(w.from, w.to, w.sentAt, w.arriveAt, now);
      w.end = 'recalled';
      w.endAt = now;
      w.phase = 'back';
      w.backFrom = at;
      w.backAt = now + Math.max(0, now - w.sentAt);
      homeward(w, now, w.backAt);
      return null;
    }
    case 'retreat': {
      const w = theirs(file, order.id, key, 'atk');
      if (!w || w.phase !== 'camp') return 'Лагеря уже нет.';
      turnBack(w, now, w.to, 'retreat');
      return null;
    }
    case 'storm': {
      const w = theirs(file, order.id, key, 'atk');
      if (!w || w.phase !== 'camp') return 'Лагеря уже нет.';
      const s = ctx.sheet(w.def);
      if (!s) {
        turnBack(w, now, w.to, 'gone');
        return 'Города больше нет в игре. Отряд идёт домой.';
      }
      // Участь штурма — выбранная в лагере, той же проверкой, что при выходе; нет её в приказе — объявленная.
      const why = order.fate && order.fate !== w.fate ? fateWhy(file, key, w.def, order.fate, now, ctx) : null;
      if (why) return why;
      // Штурм — бой: цена в энергии полководца, той же дверью, что у штурма логова (`world/energy`).
      const tired = energyBlock(energyAt(w.army.energy, now), priceOf('storm'));
      if (tired) return tired;
      if (order.fate) declare(w, order.fate);
      w.army = { ...w.army, energy: spend(w.army.energy, now, priceOf('storm')) };
      // Штурм из лагеря машинами, выбранными у кнопки (нет списка — всеми готовыми); отбитый лагерь не снимает
      // (`siege.STORM_HOLDS`, docs/siege_v2.md, 4.4).
      const sheet = liveSheet(file, w.def, s, now);
      stormCamp(w, now, sheet, w.camp ? stormMachines(w.camp as SiegeWindow, now, order.machines) : []);
      return null;
    }
    case 'wood': {
      // Древесина лагеря: доля машинам (docs/siege_v2.md, 4.3); рогатки — к воротам, как прежде (`works.playerWood`).
      const w = theirs(file, order.id, key, 'atk');
      if (!w || w.phase !== 'camp' || !w.camp) return 'Лагеря уже нет.';
      const camp = w.camp as SiegeWindow;
      if (Math.abs(machineShare(camp.wood) - order.machines) < 1e-9) return 'Лагерь и так рубит так.';
      w.camp = { ...w.camp, wood: rebaseWood(siegeSince(camp), now, camp.wood, 1, order.machines) };
      return null;
    }
    case 'machine': {
      // Заказ машины — той же проверкой, что у лагеря под логовом (`world/machines.machineBlock`): у города стена есть.
      const w = theirs(file, order.id, key, 'atk');
      if (!w || w.phase !== 'camp' || !w.camp) return 'Лагеря уже нет.';
      const camp = w.camp as SiegeWindow;
      const why = machineBlock(camp, order.machine, now, true);
      if (why) return why;
      w.camp = { ...w.camp, machines: machineAfter(camp, order.machine, now) as WarCamp['machines'] };
      return null;
    }
    case 'fate': {
      // «Объявить» в лагере — как под логовом (`LocalWorld.besiege` у своего лагеря): окно остаётся, часы голода и проходы
      // не трогаются, осаждённый видит новую участь со следующим опросом.
      const w = theirs(file, order.id, key, 'atk');
      if (!w || w.phase !== 'camp' || !w.camp) return 'Лагеря уже нет.';
      if (w.fate === order.fate) return FATE_SAME;
      const why = fateWhy(file, key, w.def, order.fate, now, ctx);
      if (why) return why;
      declare(w, order.fate);
      return null;
    }
    case 'craft': {
      const w = theirs(file, order.id, key, 'atk');
      if (!w || w.phase !== 'camp' || !w.camp) return 'Лагеря уже нет.';
      // Дело в лагере — предел за осаду и цена в энергии полководца, той же дверью, что у лагеря под логовом
      // (`world/siegecraft`, `world/energy`). Списывается один раз — здесь, вместе со счётчиком.
      const limit = craftBlock(w.camp as SiegeWindow, order.act, now);
      if (limit) return limit;
      const tired = energyBlock(energyAt(w.army.energy, now), priceOf(order.act));
      if (tired) return tired;
      w.army = { ...w.army, energy: spend(w.army.energy, now, priceOf(order.act)) };
      w.camp = { ...w.camp, ...craftAfter(w.camp as SiegeWindow, order.act, now) };
      return null;
    }
    case 'orders': {
      // Наказы на отлучку (docs/siege_v2.md, 8.3): разбирает их сервер в минуту фазы, теми же дверями, что ручные приказы.
      const w = theirs(file, order.id, key, 'atk');
      if (!w || w.phase !== 'camp' || !w.camp) return 'Лагеря уже нет.';
      const clean = cleanOrders(order.orders);
      const camp = { ...w.camp };
      if (clean) camp.orders = clean;
      else delete camp.orders;
      w.camp = camp;
      // Наказ «принять дань» срабатывает и на дань, уже ждущую ответа (8.3).
      autoAnswer(file, w, now, ctx);
      return null;
    }
    case 'sortie': {
      const w = theirs(file, order.id, key, 'def');
      if (!w || w.phase !== 'camp') return 'Лагеря под стенами уже нет.';
      const s = ctx.sheet(key);
      if (!s) return 'Вести о городе ещё не дошли до края. Подожди минуту.';
      const sheet = liveSheet(file, key, s, now);
      if (troopTotal(asTroops(order.troops)) <= 0) return 'Некого вывести на вылазку.';
      const short = enough(order.troops, claimedSheet(file, key, s, now).home, sheet.home, 'в гарнизоне', ctx);
      if (short) return short;
      return hitCamp(w, now, sheet, { front: order.troops, site: 'sortie' });
    }
    case 'repair': {
      // Починка пролома (docs/siege_v2.md, раздел 5): пролом закрыт к концу фазы; платит защитник деревом и камнем — его
      // клиент списывает, увидев починку в журнале лагеря (`contract.warRepairId`), а сервер числит цену за ним до того.
      const w = theirs(file, order.id, key, 'def');
      if (!w || w.phase !== 'camp' || !w.camp) return 'Лагеря под стенами уже нет.';
      const why = repairBlock(w.camp as SiegeWindow, now);
      if (why) return why;
      const s = ctx.sheet(key);
      if (!s) return 'Вести о городе ещё не дошли до края. Подожди минуту.';
      const short = repairShort(w, liveSheet(file, key, s, now));
      if (short) return short;
      w.camp = { ...w.camp, ...repairAfter(w.camp as SiegeWindow, now) } as WarCamp;
      return null;
    }
    case 'ration': {
      // Осадный паёк (раздел 5, ответ владельца 6): ×¾ с этой минуты — часы голода заново от остатка хлеба.
      const w = theirs(file, order.id, key, 'def');
      if (!w || w.phase !== 'camp' || !w.camp) return 'Лагеря под стенами уже нет.';
      if (Boolean(w.camp.ration) === order.on) return order.on ? 'Паёк и так урезан.' : 'Паёк и так обычный.';
      const s = ctx.sheet(key);
      if (!s) return 'Вести о городе ещё не дошли до края. Подожди минуту.';
      setCamp(w, campWindow(w, now, liveSheet(file, key, s, now), w.camp, order.on));
      return null;
    }
    case 'defend': {
      // Наказы осаждённого (8.3): разбирает их сервер в минуту фазы, теми же дверями, что ручные приказы.
      const w = theirs(file, order.id, key, 'def');
      if (!w || w.phase !== 'camp' || !w.camp) return 'Лагеря под стенами уже нет.';
      const clean = cleanDefend(order.defend);
      const camp = { ...w.camp };
      if (clean) camp.defend = clean;
      else delete camp.defend;
      w.camp = camp;
      // Наказ «принять условия» срабатывает и на условия, уже ждущие ответа (8.3).
      autoAnswer(file, w, now, ctx);
      return null;
    }
    case 'sally': {
      const w = theirs(file, order.id, key, 'def');
      if (!w || w.phase !== 'camp' || !w.camp) return 'Лагеря под стенами уже нет.';
      const why = burnBlock(w.camp as SiegeWindow, order.machine, now);
      if (why) return why;
      const s = ctx.sheet(key);
      if (!s) return 'Вести о городе ещё не дошли до края. Подожди минуту.';
      const sheet = liveSheet(file, key, s, now);
      if (troopTotal(asTroops(order.troops)) <= 0) return 'Некого вывести на вылазку.';
      const short = enough(order.troops, claimedSheet(file, key, s, now).home, sheet.home, 'в гарнизоне', ctx);
      if (short) return short;
      return burnMachine(w, now, sheet, order.machine, order.troops);
    }
    case 'surrender': {
      // Сдача (ответ владельца 5): ворота открывает сам город — участь на ступень мягче, гарнизон уходит живым; та же дверь,
      // что «ворота открыли» на фазе осады (`fall` с `gates`).
      const w = theirs(file, order.id, key, 'def');
      if (!w || w.phase !== 'camp' || !w.camp) return 'Лагеря под стенами уже нет.';
      const s = ctx.sheet(key);
      if (!s) return 'Вести о городе ещё не дошли до края. Подожди минуту.';
      fall(w, now, liveSheet(file, key, s, now), 'gates');
      turnBack(w, now, w.to, 'taken');
      return null;
    }
    case 'offer': {
      // Переговоры у стен (docs/siege_v2.md, раздел 7): условия предлагает осаждающий, дань — осаждённый. Одно предложение на
      // сторону в фазу, стоит до конца следующей; цену дани назначает сервер — справедливую на эту минуту (`world/parley`).
      const role = order.kind === 'terms' ? 'atk' : 'def';
      const w = theirs(file, order.id, key, role);
      if (!w || w.phase !== 'camp' || !w.camp) return role === 'atk' ? 'Лагеря уже нет.' : 'Лагеря под стенами уже нет.';
      const camp = w.camp as SiegeWindow;
      const why = offerBlock(camp, order.kind, now) ?? (order.kind === 'terms' ? termsBlock(w.fate, order.fate) : null);
      if (why) return why;
      const s = ctx.sheet(w.def);
      if (!s) return 'Вести о городе ещё не дошли до края. Подожди минуту.';
      const price = order.kind === 'tribute' ? fairOf(w, now, liveSheet(file, w.def, s, now)) : 0;
      if (order.kind === 'tribute' && price <= 0) return 'На виду ничего не лежит: дани дать нечем.';
      const offer = order.kind === 'terms' ? { kind: order.kind, at: now, fate: order.fate } : { kind: order.kind, at: now, price };
      w.camp = { ...w.camp, ...offerAfter(camp, offer) } as WarCamp;
      autoAnswer(file, w, now, ctx);
      return null;
    }
    case 'answer': {
      // Ответ на предложение другой стороны: на условия отвечает осаждённый, на дань — осаждающий.
      const w = theirs(file, order.id, key, order.kind === 'terms' ? 'def' : 'atk');
      if (!w || w.phase !== 'camp' || !w.camp) return 'Лагеря уже нет.';
      return settleOffer(file, w, now, ctx, order.kind, order.yes);
    }
    case 'relief': {
      // Выручка (docs/siege_v2.md, раздел 5): союзник осаждённого по пакту бьёт по лагерю с тыла тем же ударом, что
      // полководец города, — его энергия и его люди; бой в минуту прихода считает сервер.
      const w = file.wars.find((x) => x.id === order.id) ?? null;
      if (!w || w.phase !== 'camp' || !w.camp) return 'Лагеря под стенами уже нет.';
      if (w.atk === key) return 'Это наш лагерь.';
      if (w.def === key) return 'По лагерю у своих стен бьют ударом полководца.';
      if (!pacted(file, key, w.def)) return 'На выручку идут только к союзнику по пакту.';
      const me = castleIdOf(key);
      if (w.reliefs?.some((r) => r.castle === me)) return 'Наша дружина уже идёт на выручку.';
      if (file.wars.some((x) => x.atk === key && active(x))) return 'Полководец в походе на соседа.';
      if (file.wars.some((x) => x.reliefs?.some((r) => r.castle === me))) return 'Полководец уже идёт на выручку.';
      const s = ctx.sheet(key);
      if (!s) return 'Вести о твоём городе ещё не дошли до края. Подожди минуту.';
      if (troopTotal(asTroops(order.army.troops)) <= 0) return 'У полководца нет отряда.';
      const short = enough(order.army.troops, claimedSheet(file, key, s, now).army, liveSheet(file, key, s, now).army, 'в отряде', ctx);
      if (short) return short;
      const have = Math.min(energyAt(order.army.energy, now), generalCap(file, key, now));
      const tired = energyBlock(have, priceOf('strike'), order.walkMs);
      if (tired) return tired;
      const at = now + Math.round(order.walkMs / pace);
      if (at >= (w.starvesAt ?? Infinity)) return 'Не успеть: хлеб в городе кончится раньше.';
      w.reliefs = [...(w.reliefs ?? []), { castle: me, city: cityOr(ctx.roster.rows[key]?.city), sent: now, at, army: ruleArmy(order.army) }];
      // Ключ союзника — для вестей ему о его выручке (19.2); наружу не уходит.
      w.allies = { ...(w.allies ?? {}), [me]: { key, city: cityOr(ctx.roster.rows[key]?.city) } };
      return null;
    }
    case 'pact':
      return pactOrder(file, key, order.target, now, ctx);
    case 'unpact':
      return unpactOrder(file, key, order.target);
    case 'strike': {
      const w = theirs(file, order.id, key, 'def');
      if (!w || w.phase !== 'camp') return 'Лагеря под стенами уже нет.';
      if (w.strike) return 'Полководец уже идёт на лагерь.';
      // Полководец один: ведёт свой поход — по лагерю у своих стен он не ударит (у клиента — `WAR_BUSY`).
      if (file.wars.some((x) => x.atk === key && active(x))) return 'Полководец в походе на соседа.';
      const s = ctx.sheet(key);
      if (!s) return 'Вести о городе ещё не дошли до края. Подожди минуту.';
      if (troopTotal(asTroops(order.army.troops)) <= 0) return 'У полководца нет отряда.';
      const short = enough(order.army.troops, claimedSheet(file, key, s, now).army, liveSheet(file, key, s, now).army, 'в отряде', ctx);
      if (short) return short;
      // Удар — бой: энергии на него должно хватить к минуте прихода, с дорогой по карте (`world/energy`). Отметка — из
      // приказа, но не выше того, что сервер знает о полководце сам (`generalCap`). Срок пути — по-прежнему со слов
      // клиента: где полководец в поле, знает только мир на клиенте (docs/siege_audit.md, решение 11).
      const have = Math.min(energyAt(order.army.energy, now), generalCap(file, key, now));
      const tired = energyBlock(have, priceOf('strike'), order.walkMs);
      if (tired) return tired;
      w.strike = { at: now + Math.round(order.walkMs / pace), army: ruleArmy(order.army), joint: order.joint };
      return null;
    }
  }
}

/** Войско приказа в пределах правил: стойкость и отметки полководца не выше, чем бывает у игрока (`book.ts`). */
const ruleArmy = (a: WarArmy): WarArmy => ({ ...a, resolve: ruleResolve(a.resolve), pips: rulePips(a.pips) });

/**
 * Когда город в последний раз пал или дал дань — от этой минуты он неприкосновенен (`SIEGE_IMMUNE`): дань за снятие осады
 * закрывает город так же, как падение (docs/siege_v2.md, 7.1). 0 — ни разу.
 */
const fellAt = (file: WarFile, def: string): number =>
  file.wars.filter((w) => w.def === def && (w.fall || w.tribute)).reduce((t, w) => Math.max(t, w.fall?.at ?? 0, w.tribute?.at ?? 0), 0);

/** Когда в последний раз жгли этот город — для неприкосновенности от огня (`spoils.burnImmuneUntil`). 0 — не жгли. */
const burnedAt = (file: WarFile, def: string): number =>
  file.wars.filter((w) => w.def === def && w.fall?.burned).reduce((t, w) => Math.max(t, w.fall?.at ?? 0), 0);

/**
 * Почему участь `fate` против города `def` объявить нельзя — одна проверка на выход (`march`), «Объявить» в лагере и
 * штурм с участью (`spoils.fateBlock`): замки гейта объявляющего и неприкосновенность недавно сожжённого города.
 */
function fateWhy(file: WarFile, key: string, def: string, fateId: WarRow['fate'], now: number, ctx: OrderCtx): string | null {
  const mine = ctx.sheet(key);
  if (!mine) return 'Вести о твоём городе ещё не дошли до края. Подожди минуту.';
  const burned = burnedAt(file, def);
  return fateBlock(fateId, 'player', burned > 0 ? burnImmuneUntil(burned) : undefined, now, mine.sheet.locks);
}

/** Объявить участь войны: её читают падение голодом, штурм и окно у обеих сторон. */
function declare(w: WarRow, fateId: WarRow['fate']): void {
  w.fate = fateId;
  if (w.camp) w.camp = { ...w.camp, fate: fateId };
}

/**
 * Сколько энергии может быть у полководца игрока `key` в минуту `now` по тому, что сервер знает сам (docs/siege_audit.md,
 * решение 11): последняя его война — отметка обратного пути той же дверью (`world/energy.onRoad`), дома копится с минуты
 * возврата. Это потолок, а не правда: походов на логова сервер не видит, и у полководца может быть меньше, но не больше.
 * Войны не было, или войско не вернулось (полководец разбит — на его месте может стоять новый, свежий) — потолка нет.
 */
export function generalCap(file: WarFile, key: string, now: number): number {
  let last: WarRow | null = null;
  for (const w of file.wars) if (w.atk === key && (!last || w.sentAt >= last.sentAt)) last = w;
  const mark = last?.army.energy;
  if (!last || !mark || (last.phase === 'done' && last.backAt === undefined)) return ENERGY_MAX;
  return energyAt(mark, now);
}

function march(file: WarFile, key: string, order: Extract<WarOrder, { op: 'march' }>, now: number, ctx: OrderCtx): string | null {
  const own = ctx.roster.rows[key];
  if (!own) return 'Твой город ещё не стоит на карте.';
  const entry = Object.entries(ctx.roster.rows).find(([k]) => castleIdOf(k) === order.target);
  if (!entry) return 'Этого города больше нет в игре.';
  const [def, row] = entry;
  if (def === key) return 'Это твой город.';
  // Пакт (docs/siege_v2.md, раздел 5): на союзника походом не ходят — сначала разорвать.
  if (pacted(file, key, def)) return 'С этим городом у нас пакт. Сначала разорви его.';
  // Регион игрока — правило мира (`theatre.inHomeTheatre`): походы за край не уходят.
  if (!inHomeTheatre(own, row)) return 'Город за пределами твоего края. Походы туда не ходят.';
  if (file.wars.some((w) => w.atk === key && active(w))) return 'Полководец уже в походе.';
  if (besieged(file, key)) return SIEGE_BLOCK;
  if (file.wars.some((w) => w.def === def && active(w))) return 'На этот город уже идёт другой отряд.';
  // Павший город неприкосновенен, как и у логова (`siege.SIEGE_IMMUNE`): цепочки падений нет.
  const fell = fellAt(file, def);
  if (fell > 0 && now < fell + SIEGE_IMMUNE) return 'Город недавно пал. Пока его не трогают.';
  const theirSheet = ctx.sheet(def);
  if (!theirSheet) return 'Город ещё не готов к войне. Его правитель не заходил с тех пор, как она началась.';
  // Защита слабого — та же мерка, что у логова (`lairs.weakCity`): жители или войско, что выше.
  if (!ctx.noShield && shielded(file, def, theirSheet, now)) return 'Город ещё мал и стоит под защитой слабого. Нападать на него нельзя.';
  const mine = ctx.sheet(key);
  if (!mine) return 'Вести о твоём городе ещё не дошли до края. Подожди минуту.';
  // Участь — та же проверка, что у приказа против логова (`spoils.fateBlock`): замки гейта объявляющего и
  // неприкосновенность от огня у недавно сожжённого города.
  const why = fateWhy(file, key, def, order.fate, now, ctx);
  if (why) return why;
  if (troopTotal(asTroops(order.army.troops)) <= 0) return 'У полководца нет отряда. Дай ему бойцов у ворот.';
  const short = enough(order.army.troops, claimedSheet(file, key, mine, now).army, liveSheet(file, key, mine, now).army, 'в отряде', ctx);
  if (short) return short;
  // Энергия полководца — той же дверью, что у мира (`world/energy`): дело у стен — ценой при выходе, и её должно хватить
  // к минуте прихода, с дорогой; дорога уходит по дням пути, у стен — стоит (docs/agent_energy.md, раздел 2).
  const from = { x: own.x, y: own.y };
  const to = { x: row.x, y: row.y };
  const walkMs = walk(from, to);
  // Отметка — из приказа, но не выше того, что сервер знает о полководце сам (`generalCap`): вернувшийся из похода
  // не выходит в новый с полным запасом, пока не отдохнёт дома (docs/siege_audit.md, решение 11).
  const have = Math.min(energyAt(order.army.energy, now), generalCap(file, key, now));
  const tired = energyBlock(have, priceOf(order.mode), walkMs);
  if (tired) return tired;
  const energy = onRoad(spend({ value: have, at: now, mode: 'hold' }, now, priceOf(order.mode)), now, now + walkMs, false);
  file.seq += 1;
  file.wars.push({
    id: `w${file.seq.toString(36)}${(now % 46656).toString(36)}`,
    atk: key,
    def,
    atkCastle: castleIdOf(key),
    defCastle: order.target,
    atkCity: cityName(own.city) ?? '',
    defCity: cityName(row.city) ?? '',
    from,
    to,
    mode: order.mode,
    fate: order.fate,
    sentAt: now,
    arriveAt: now + walkMs,
    phase: 'march',
    army: { ...ruleArmy(order.army), energy },
    went: { ...order.army.troops },
    battles: [],
  });
  return null;
}

/** Мощь войска по видам — для слов, не для боя. */
export const armyPower = (t: Counts): number => troopPower(asTroops(t));

/** Сумма двух наборов по видам — для проверки сохранения добычи. */
export const addCounts = plus;

/** Роды боя из видов племени. */
export const kindsOfCounts = (t: Counts): Stack => kindsOf(asTroops(t));

// ------------------------------------------------ новости для бота ---

/** Новость войны для одного игрока: кому и что (`contract.NoticeItem`). */
export interface WarNews {
  player: string;
  item: NoticeItem;
}

/**
 * Новости одной войны — **выводятся из записи, а не копятся**: что бот скажет сторонам, есть функция того, что с
 * войной уже случилось (docs/NOTIFY.md, раздел 12). Решение владельца — о двух вещах: на город идут (защитнику, с
 * минуты выхода и до прихода; отозванный поход новостью не остаётся) и бой был (обеим сторонам — каждый бой и
 * падение голодом). Падение штурмом — тот же бой у стены, второй новостью не идёт.
 */
export function newsOf(w: WarRow): WarNews[] {
  const out: WarNews[] = [];
  const from = (role: 'atk' | 'def'): string => plainName(role === 'atk' ? w.defCity : w.atkCity);
  if (w.end !== 'recalled' && w.sentAt < w.arriveAt) {
    out.push({
      player: w.def,
      item: {
        key: `war:${w.id}`,
        kind: 'war',
        fireAt: w.sentAt,
        until: w.arriveAt,
        p: { from: from('def'), fate: w.fate, about: w.arriveAt, role: 'def', mode: w.mode },
      },
    });
  }
  for (const b of w.battles) {
    const taken = b.site === 'wall' && w.fall?.by === 'storm' && w.fall.at === b.at;
    // Выручка союзника (docs/siege_v2.md, 19.2): осаждённому — чья она, союзнику — своя весть о своём бое.
    const ally = b.ally ? w.allies?.[b.ally] : undefined;
    for (const role of ['atk', 'def'] as const) {
      out.push({
        player: role === 'atk' ? w.atk : w.def,
        item: {
          key: `war-fight:${b.id}`,
          kind: 'war-fight',
          fireAt: b.at,
          until: b.at + RESULT_KEEP,
          p: {
            from: from(role),
            fate: w.fate,
            about: b.at,
            role,
            site: b.site,
            by: b.by,
            // `won` боя — у того, кто в нём нападал; у получателя — своя сторона.
            won: b.by === role ? b.won : !b.won,
            ...(taken ? { taken: true as const } : {}),
            // Вылазка на машину — бой за машину, а не за лагерь: слова другие (19.2).
            ...(b.burn ? { machine: b.burn } : {}),
            ...(ally && role === 'def' ? { ally: plainName(cityOr(ally.city)) } : {}),
          },
        },
      });
    }
    if (ally) {
      out.push({
        player: ally.key,
        item: {
          key: `war-relief:${b.id}`,
          kind: 'war-relief',
          fireAt: b.at,
          until: b.at + RESULT_KEEP,
          p: { from: plainName(w.defCity), fate: w.fate, about: b.at, relief: 'fight', won: b.won },
        },
      });
    }
  }
  // Выручка идёт — осаждённому, пока она в пути: с минуты выхода до минуты удара (19.2).
  for (const r of w.reliefs ?? []) {
    if (r.sent === undefined || r.sent >= r.at) continue;
    out.push({
      player: w.def,
      item: {
        key: `war-relief:${w.id}:go:${r.castle}:${r.at}`,
        kind: 'war-relief',
        fireAt: r.sent,
        until: r.at,
        p: { from: from('def'), fate: w.fate, about: r.at, role: 'def', relief: 'going', ally: plainName(cityOr(r.city)) },
      },
    });
  }
  // Выручка не пробилась через рогатки (`WarTurned`): союзнику — его дружина стоит в поле; осаждённому — что её не будет.
  for (const t of w.turned ?? []) {
    const ally = t.ally ? w.allies?.[t.ally] : undefined;
    if (!ally) continue;
    const item = (p: NoticeItem['p']): NoticeItem => ({
      key: `war-relief:${w.id}:turned:${t.at}`,
      kind: 'war-relief',
      fireAt: t.at,
      until: t.at + RESULT_KEEP,
      p,
    });
    out.push({ player: ally.key, item: item({ from: plainName(w.defCity), fate: w.fate, about: t.at, relief: 'turned' }) });
    out.push({ player: w.def, item: item({ from: from('def'), fate: w.fate, about: t.at, role: 'def', relief: 'turned', ally: plainName(cityOr(ally.city)) }) });
  }
  // Фазы осады (docs/siege_v2.md, 8.3): весть — только о значимом. Пролом и мор — обеим сторонам; наказ, сработавший в
  // минуту фазы, — той стороне, чей он. «Без перемен» и «нехватка в городе» без наказа молчат.
  const rows = w.camp ? rowsOf(w.camp as SiegeWindow) : (w.phases ?? []);
  let breaches = 0;
  rows.forEach((r, i) => {
    if (r.out === 'breach') breaches = Math.min(3, breaches + 1);
    if (r.out === 'gates') return;
    // Наказ — тому, чей он: залп и штурм — нападающему, починка и паёк — осаждённому (этап 2г).
    const orderOf = (role: 'atk' | 'def') =>
      r.orders?.find((o) => (role === 'atk' ? o === 'volley' || o === 'storm' : o === 'repair' || o === 'ration'));
    for (const role of ['atk', 'def'] as const) {
      const loud = r.out === 'breach' || r.out === 'plague';
      const order = orderOf(role);
      if (!loud && !order) continue;
      out.push({
        player: role === 'atk' ? w.atk : w.def,
        item: {
          key: `war-phase:${w.id}:${i + 1}`,
          kind: 'war-phase',
          fireAt: r.at,
          until: r.at + RESULT_KEEP,
          p: {
            from: from(role),
            fate: w.fate,
            about: r.at,
            role,
            phase: r.out,
            k: i + 1,
            ...(r.out === 'breach' ? { breaches } : {}),
            ...(order ? { order } : {}),
          },
        },
      });
    }
  });
  // Переговоры у стен (docs/siege_v2.md, 7.3): предложение — тому, кому отвечать, пока оно стоит; отказ — тому, кто
  // предлагал; принятая дань — осаждённому (принятые условия — падение сдачей, его весть ниже).
  for (const o of w.camp?.offers ?? []) {
    const by = o.kind === 'terms' ? 'atk' : 'def';
    const to = by === 'atk' ? 'def' : 'atk';
    const fate = o.fate ?? w.fate;
    // Наказ ответил в ту же минуту — спрашивать уже не о чем: весть скажет итог (дань или сдача).
    if (o.answeredAt !== o.at) {
      out.push({
        player: to === 'atk' ? w.atk : w.def,
        item: { key: `war-parley:${w.id}:${o.kind}:${o.at}`, kind: 'war-parley', fireAt: o.at, until: o.until, p: { from: from(to), fate, about: o.until, role: to, offer: o.kind } },
      });
    }
    if (o.answer === 'no' && o.answeredAt !== undefined) {
      out.push({
        player: by === 'atk' ? w.atk : w.def,
        item: {
          key: `war-parley:${w.id}:${o.kind}:${o.at}:no`,
          kind: 'war-parley',
          fireAt: o.answeredAt,
          until: o.answeredAt + RESULT_KEEP,
          p: { from: from(by), fate, about: o.answeredAt, role: by, offer: o.kind, answer: 'no' },
        },
      });
    }
  }
  if (w.tribute) {
    const at = w.tribute.at;
    out.push({
      player: w.def,
      item: {
        key: `war-parley:${w.id}:tribute:paid`,
        kind: 'war-parley',
        fireAt: at,
        until: at + RESULT_KEEP,
        p: { from: from('def'), fate: w.fate, about: at, role: 'def', offer: 'tribute', answer: 'yes' },
      },
    });
  }
  if (w.fall?.by === 'hunger' || w.fall?.by === 'gates') {
    const at = w.fall.at;
    const gates = w.fall.by === 'gates';
    for (const role of ['atk', 'def'] as const) {
      out.push({
        player: role === 'atk' ? w.atk : w.def,
        item: {
          key: `war-fall:${w.id}`,
          kind: 'war-fall',
          fireAt: at,
          until: at + RESULT_KEEP,
          p: { from: from(role), fate: w.fall.fate, about: at, role, taken: true, ...(gates ? { gates: true as const } : {}) },
        },
      });
    }
  }
  return out;
}

/**
 * Вести о пакте (docs/siege_v2.md, 19.2): предложение — тому, кому предложили, пока оно лежит; принятый пакт — тому, кто
 * предлагал. Выводятся из записи, как вести войны: «один раз» держит разница до и после хода (`newsDiff`). Участи у пакта
 * нет — поле `fate` у вести обязательно, и здесь оно формы ради.
 */
export function pactNewsOf(file: WarFile): WarNews[] {
  const out: WarNews[] = [];
  for (const o of file.offers ?? []) {
    out.push({
      player: o.to,
      item: {
        key: `war-pact:${castleIdOf(o.from)}:${o.at}`,
        kind: 'war-pact',
        fireAt: o.at,
        until: o.at + RESULT_KEEP,
        p: { from: plainName(cityOr(o.cities[o.from])), fate: 'plunder', about: o.at, pact: 'offer' },
      },
    });
  }
  for (const p of file.pacts ?? []) {
    if (!p.by) continue;
    out.push({
      player: p.by === p.a ? p.b : p.a,
      item: {
        key: `war-pact:${castleIdOf(p.by)}:${p.at}:made`,
        kind: 'war-pact',
        fireAt: p.at,
        until: p.at + RESULT_KEEP,
        p: { from: plainName(cityOr(p.cities[p.by])), fate: 'plunder', about: p.at, pact: 'made' },
      },
    });
  }
  return out;
}

/** Все новости записи по ключу «игрок/пункт» — для сравнения до и после хода. */
export function newsMap(file: WarFile): Map<string, WarNews> {
  const out = new Map<string, WarNews>();
  for (const w of file.wars) for (const n of newsOf(w)) out.set(`${n.player}/${n.item.key}`, n);
  for (const sp of file.spies ?? []) for (const n of spyNewsOf(sp)) out.set(`${n.player}/${n.item.key}`, n);
  for (const n of pactNewsOf(file)) out.set(`${n.player}/${n.item.key}`, n);
  return out;
}

/** Что изменилось у каждого игрока: новые новости и снятые (отозванный поход). */
export function newsDiff(before: Map<string, WarNews>, after: Map<string, WarNews>): Map<string, { add: NoticeItem[]; drop: string[] }> {
  const out = new Map<string, { add: NoticeItem[]; drop: string[] }>();
  const at = (player: string) => {
    let x = out.get(player);
    if (!x) out.set(player, (x = { add: [], drop: [] }));
    return x;
  };
  for (const [k, n] of after) if (!before.has(k)) at(n.player).add.push(n.item);
  for (const [k, n] of before) if (!after.has(k)) at(n.player).drop.push(n.item.key);
  return out;
}

// ------------------------------------------------ лазутчик против соседа (docs/spy_pvp.md) ---
//
// Дело лазутчика — как поход: приказ при выходе (какое дело, к какому городу), приход назначен временем, исход — в
// минуту прихода, при первом обращении любой из сторон (`advanceSpies`). Шанс и гибель замораживаются при приказе —
// игрок видел их в меню (`spyMenuOf`), и применяются ровно они; что дело сделало с городом, считается по слепку обороны
// в минуту прихода (`rivalHarm`). Кости — из номера дела (`rivalRolls`): тот же номер даёт тот же исход у кого угодно.

/** Свежесть меню: приказ исполняется по минуте меню, если ей не больше стольких мс (как `OrderOption.at` у логова). */
export const SPY_SHOWN_FRESH = 10_000;

/** Путь лазутчика между двумя клетками с темпом войны. */
const spyWalk = (from: { x: number; y: number }, to: { x: number; y: number }): number => Math.round(spyWalkMs(from, to) / pace);

const spyActive = (x: SpyRow): boolean => x.phase !== 'done';

/** Лазутчик города дома в минуту `at`: слепок говорит, а свои дела, которых слепок ещё не знал, — поправляют. */
function spyHomeAt(file: WarFile, key: string, s: SheetAt, at: number): boolean {
  let home = s.sheet.watch?.home ?? false;
  for (const x of file.spies ?? []) {
    if (x.atk !== key || x.sentAt > at) continue;
    const back = x.phase === 'done' && !x.out?.dead ? (x.endAt ?? x.backAt ?? Infinity) : Infinity;
    if (back <= at) {
      if (back > s.at) home = true;
    } else if (x.phase !== 'done' || x.out?.dead) {
      home = false;
    }
  }
  return home;
}

/** Игровое время в городе в минуту `at` — от слепка (`WarSheet.time`). */
const villageTimeAt = (s: SheetAt, at: number): number => (s.sheet.time ?? 0) + gameSecondsOfMs(Math.max(0, at - s.at));

/** Сколько раз лазутчики этого игрока заходили к этому городу за окно памяти — любым исходом (`peril.recentVisits`). */
const spyVisits = (file: WarFile, atk: string, def: string, at: number): number =>
  (file.spies ?? []).filter((x) => x.atk === atk && x.def === def && x.arriveAt <= at && at - x.arriveAt < PERIL_MEMORY).length;

interface SpyPlan {
  def: string;
  own: { x: number; y: number; city?: string };
  row: { x: number; y: number; city?: string };
  mine: SheetAt;
  walkMs: number;
  options: SpyOption[];
}

/**
 * Меню дел против города — одна проверка на меню (`spyMenuOf`) и на приказ (`spyOrder`): что можно, с какими шансом и
 * гибелью, а чего нельзя — словами. Энергию проверяет приказ (отметку несёт он); меню её не знает.
 */
function spyPlan(file: WarFile, key: string, target: string, at: number, ctx: OrderCtx): SpyPlan | string {
  const own = ctx.roster.rows[key];
  if (!own) return 'Твой город ещё не стоит на карте.';
  const entry = Object.entries(ctx.roster.rows).find(([k]) => castleIdOf(k) === target);
  if (!entry) return 'Этого города больше нет в игре.';
  const [def, row] = entry;
  if (def === key) return 'Это твой город.';
  // Регион игрока — то же правило мира, что у похода (`theatre.inHomeTheatre`).
  if (!inHomeTheatre(own, row)) return 'Город за пределами твоего края. Лазутчик туда не ходит.';
  if ((file.spies ?? []).some((x) => x.atk === key && spyActive(x))) return 'Лазутчик уже на деле у соседа.';
  // Из осаждённого города не выходит и лазутчик — то же правило выхода, что у похода.
  if (besieged(file, key)) return SIEGE_BLOCK;
  const mine = ctx.sheet(key);
  if (!mine?.sheet.watch) return 'Вести о твоём городе ещё не дошли до края. Подожди минуту.';
  const theirs = ctx.sheet(def);
  if (!theirs) return 'Город ещё не готов. Его правитель не заходил с тех пор, как появились лазутчики.';
  const sheet = liveSheet(file, def, theirs, at);
  const guard = rivalGuard({ homePower: homePowerOf(sheet.home), keen: theirs.sheet.watch?.keen ?? 1, spyHome: spyHomeAt(file, def, theirs, at) });
  const away = distance(own, row);
  const risk = rivalPeril(rivalPerilCase(mine.sheet.watch.veil, villageTimeAt(theirs, at), spyVisits(file, key, def, at), away));
  // Нападение на слабого и на недавно павший — те же запреты, что у похода; разведка — не нападение.
  const shield = !ctx.noShield && shielded(file, def, theirs, at);
  const fell = fellAt(file, def);
  const options = RIVAL_DEEDS.map((deed): SpyOption => {
    const hostile = rivalHostile(deed);
    const reason =
      hostile && shield
        ? 'Город ещё мал и стоит под защитой слабого. Вредить ему нельзя.'
        : hostile && fell > 0 && at < fell + SIEGE_IMMUNE
          ? 'Город недавно пал. Пока его не трогают.'
          : null;
    return { deed, can: reason === null, reason, chance: rivalChance(deed, mine.sheet.watch?.keen ?? 1, guard, away), peril: risk.peril, why: risk.why };
  });
  return { def, own, row, mine, walkMs: spyWalk(own, row), options };
}

/** Меню дел против города на минуту `now`. Отказ всему меню — строкой. */
export function spyMenuOf(file: WarFile, key: string, target: string, now: number, ctx: OrderCtx): SpyMenu | string {
  const plan = spyPlan(file, key, target, now, ctx);
  if (typeof plan === 'string') return plan;
  return { target, at: now, walkMs: plan.walkMs, options: plan.options };
}

/** Приказ лазутчику: числа — на минуту меню, если она свежая; не те, что видел игрок, — отказ, а не другое дело. */
function spyOrder(file: WarFile, key: string, order: Extract<WarOrder, { op: 'spy' }>, now: number, ctx: OrderCtx): string | null {
  const at = order.at <= now && now - order.at <= SPY_SHOWN_FRESH ? order.at : now;
  const plan = spyPlan(file, key, order.target, at, ctx);
  if (typeof plan === 'string') return plan;
  const opt = plan.options.find((o) => o.deed === order.deed);
  if (!opt) return 'Такого дела нет.';
  if (!opt.can) return opt.reason ?? 'Сейчас нельзя.';
  if (opt.chance !== order.shown.chance || opt.peril !== order.shown.peril) return 'Обстановка у города сменилась. Посмотри дела заново.';
  // Энергия лазутчика — той же дверью, что у похода (`world/energy`): цена дела при выходе, и её должно хватить к
  // минуте прихода, с дорогой; дорога уходит по дням пути, у города — стоит.
  const price = priceOf(order.deed);
  const tired = energyBlock(energyAt(order.energy, now), price, plan.walkMs);
  if (tired) return tired;
  const watch = plan.mine.sheet.watch;
  if (!watch) return 'Вести о твоём городе ещё не дошли до края. Подожди минуту.';
  file.seq += 1;
  const row: SpyRow = {
    id: `s${file.seq.toString(36)}${(now % 46656).toString(36)}`,
    atk: key,
    def: plan.def,
    atkCastle: castleIdOf(key),
    defCastle: order.target,
    atkCity: cityName(plan.own.city) ?? '',
    defCity: cityName(plan.row.city) ?? '',
    from: { x: plan.own.x, y: plan.own.y },
    to: { x: plan.row.x, y: plan.row.y },
    deed: order.deed,
    sentAt: now,
    arriveAt: now + plan.walkMs,
    chance: opt.chance,
    peril: opt.peril,
    phase: 'go',
    energy: onRoad(spend(order.energy, now, price), now, now + plan.walkMs, false),
    stealth: watch.stealth,
    heldMs: Math.round((SPY_HELD * watch.held) / pace),
  };
  file.spies = [...(file.spies ?? []), row];
  return null;
}

/** Исход дела в минуту прихода — по слепку обороны соседа на эту минуту. Нет слепка — города нет, дела не было. */
function resolveSpy(file: WarFile, x: SpyRow, s: SheetAt | null): void {
  const at = x.arriveAt;
  const home = (from: number): void => {
    x.phase = 'back';
    x.backAt = from + spyWalk(x.to, x.from);
    x.energy = onRoad(x.energy, from, x.backAt, true);
  };
  if (!s) {
    x.out = { at, ok: false, slipped: false, held: false, dead: false, gone: true };
    home(at);
    return;
  }
  const sheet = liveSheet(file, x.def, s, at);
  const f = rivalFate(x.chance, x.peril, x.stealth, rivalRolls(x.id));
  const harm = f.ok ? rivalHarm(x.deed, { stock: sheet.stock, gold: sheet.gold, stash: sheet.stash, pop: sheet.pop }) : {};
  x.out = {
    at,
    ...f,
    ...harm,
    ...(f.ok && x.deed === 'look'
      ? { intel: { home: { ...sheet.home }, army: { ...sheet.army }, militia: sheet.militia, archers: sheet.archers, pop: sheet.pop, power: sheet.power } }
      : {}),
  };
  if (f.dead) {
    x.phase = 'done';
    x.endAt = at;
  } else if (f.held) {
    x.phase = 'held';
    x.releaseAt = at + x.heldMs;
  } else {
    home(at);
  }
}

/** Разобрать дела лазутчиков к минуте `now`: приход, отпуск из плена, возврат. */
function advanceSpies(file: WarFile, now: number, sheets: ReadonlyMap<string, SheetAt | null>): boolean {
  let changed = false;
  for (const x of file.spies ?? []) {
    for (let guard = 0; guard < 4; guard++) {
      if (x.phase === 'go' && x.arriveAt <= now) {
        resolveSpy(file, x, sheets.get(x.def) ?? null);
      } else if (x.phase === 'held' && (x.releaseAt ?? 0) <= now) {
        const from = x.releaseAt ?? now;
        x.phase = 'back';
        x.backAt = from + spyWalk(x.to, x.from);
        x.energy = onRoad(x.energy, from, x.backAt, true);
      } else if (x.phase === 'back' && (x.backAt ?? 0) <= now) {
        x.phase = 'done';
        x.endAt = x.backAt;
      } else {
        break;
      }
      changed = true;
    }
  }
  return changed;
}

/**
 * Дело глазами стороны. Нападающему — всё, кроме ключей и замороженного. Защитнику — только дело, которое его задело
 * (удавшийся поджог, кража, смута) или в котором лазутчика поймали; имя нападающего — только у пойманного (плен или
 * гибель). Удача и тихий провал имени не оставляют, разведка — следа.
 */
export function spyViewOf(row: SpyRow, key: string): SpyView | null {
  const { atk, def, stealth: _s, heldMs: _h, ...rest } = row;
  if (atk === key) return { ...rest, role: 'atk' };
  if (def !== key || !row.out) return null;
  const caught = row.out.held || row.out.dead;
  if (!caught && !(row.out.ok && rivalHostile(row.deed))) return null;
  const { energy: _e, ...seen } = rest;
  const { intel: _i, ...out } = row.out;
  return {
    ...seen,
    role: 'def',
    chance: 0,
    peril: 0,
    out,
    ...(caught ? {} : { atkCastle: '', atkCity: '', from: { ...row.to } }),
  };
}

/** Свои дела лазутчиков и чужие у нас, которые мы видим, — свежие сверху. */
export const spiesOf = (file: WarFile, key: string): SpyView[] =>
  (file.spies ?? [])
    .map((x) => spyViewOf(x, key))
    .filter((x): x is SpyView => x !== null)
    .reverse();

/** Участь, которой бот называет тайное нападение: огонь — сожжение, кража — грабёж, смута — люди уходят. */
export const spyFate = (deed: RivalDeed): NoticeItem['p']['fate'] => (deed === 'fire' ? 'burn' : deed === 'theft' ? 'plunder' : 'captives');

/**
 * Новость тайного дела — выводится из записи, как у войны. Нападение — только удавшийся поджог, кража или смута: город
 * что-то потерял. Разведка и пойманный лазутчик — не нападение (город цел), и бот о них молчит; нападающему бот не
 * пишет вовсе — на него не нападали (правило владельца: бот пишет о нападении и о бое, docs/NOTIFY.md).
 */
export function spyNewsOf(x: SpyRow): WarNews[] {
  const o = x.out;
  if (!o || !o.ok || !rivalHostile(x.deed)) return [];
  return [
    {
      player: x.def,
      item: {
        key: `war-spy:${x.id}`,
        kind: 'war-spy',
        fireAt: o.at,
        until: o.at + RESULT_KEEP,
        p: { from: 'чужой лазутчик', fate: spyFate(x.deed), about: o.at, role: 'def' },
      },
    },
  ];
}
