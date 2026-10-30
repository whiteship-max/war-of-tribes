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
import { castleIdOf, freeHeld, type FreeHold } from './roster.js';
import { FREE_FATE_IDS, OCCUPY_RULE, freeAccess, freeFateBlock, isFreeKey, freeGold, freeLarder, freeLevels, freeName, freePop, freeTroops, type FreeTier } from '../../src/world/freecastle.js';
import { roamCell, roamMoving } from '../../src/world/roam.js';
import {
  cityName,
  plainName,
  RESULT_KEEP,
  type NoticeItem,
  readSheet,
  warFallId,
  warTributeId,
  warRepairId,
  warGunId,
  cityOr,
  type Counts,
  type WarPact,
  type WarRelief,
  type WarMeet,
  type RosterFile,
  type WarArmy,
  type WarBattle,
  type WarCamp,
  type WarEnd,
  type WarFall,
  type WarOrder,
  type WarSheet,
  type WarFlanks,
  type WarSpirit,
  type WarView,
  RIVAL_DEEDS,
  spySeenId,
  type RivalDeed,
  type SpyMenu,
  type SpyOption,
  type SpyView,
  NOTICE_FATES,
  type NoticeFate,
} from './contract.js';
import { stackTotal, type Flanks, type Pips, type Stack } from '../../src/battle/index.js';
import { TROOPS_OF_KIND, troopTotal, type TroopStack } from '../../src/game/battle/kinds.js';
import { kindsOf, shareLosses, troopLosses, troopPower } from '../../src/game/battle/price.js';
import { wallRepairCost } from '../../src/game/build.js';
import { statAt } from '../../src/game/train.js';
import { ENGINES } from '../../src/game/data/engines.js';
import { campFight, guardKinds, homeLosses, machineFight, meetFight, wallFight, type MeetSide } from '../../src/world/fights.js';
import { groundAt, placeAt, scarWhere } from '../../src/world/place.js';
import type { FieldOutcome } from '../../src/world/battle.js';
import { isScarId, type ScarSide, type ScarWhere } from '../../src/game/scarrules.js';
import { scarsAt, type ScarBook } from './scarbook.js';
import { SCALING, wallFront } from '../../src/world/wall.js';
import {
  PROPOSALS,
  answerBlock,
  pactBreakingBlock,
  pactHolds,
  pactWarBlock,
  type ProposalAct,
  type ProposalEnd,
  type ProposalKind,
  type ProposalView,
} from '../../src/world/proposals.js';
import { has, own } from '../../src/game/guard.js';
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
import { fieldReach, fieldWalkFloorMs, foodLeft, reliefCredit, spyWalkMs, WAR_GROUND_SEED, warAt, warWalkMs } from '../../src/world/pvp.js';
import { MEET_CAMP, MEET_FAR, MEET_GONE, MEET_SLACK_CELLS, MEET_SLACK_MS, MEET_STALE, warMeet, warSpotAt } from '../../src/world/pvpmeet.js';
import { positionAt } from '../../src/world/pursuit.js';
import { distance } from '../../src/world/geo.js';
import { goodsSheet, type GoodsBook } from './goods.js';
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
import {
  breadAt,
  breadStock,
  FATE_SAME,
  GENERAL_MARCHES,
  GENERAL_RELIEVES,
  GENERAL_STRIKES,
  GENERAL_INTERCEPTS,
  openSiege,
  SIEGE_BLOCK,
  siegeSince,
  starvesAt,
  type SiegeWindow,
} from '../../src/world/siege.js';
import { siegeCutOf, starves } from '../../src/world/siegefood.js';
import { BREAD_SLACK, BREAD_SLACK_MIN } from '../../src/world/data/siegefood.js';
import { aimBlock as artilleryAimBlock, gunAfter, gunAimBlock, gunBlock, shotsApplied } from '../../src/world/shelling.js';
import { BREAKOUT_SHARE, blockadeAfter, blockadeAt, blockadeBlock, blockadeDeeds, blockadeHolds, type BlockadeBreak } from '../../src/world/blockade.js';
import { SIEGE_PHASE } from '../../src/world/data/siegeroll.js';
import { AIMS as ARTILLERY_AIMS, GUN_AIMS, type Aim as ArtilleryAim, type GunAim } from '../../src/world/data/shelling.js';
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
  rollSeed,
  rowsOf,
  hungerStepAt,
  softerFate,
  wasteLosses,
  type PhaseRow,
} from '../../src/world/siegeroll.js';
import { FATES, burnImmuneUntil, fate, fateBlock, fallSeed, homeLoss, winnerGain } from '../../src/world/spoils.js';
import type { Loot } from '../../src/world/types.js';
import {
  answerAfter,
  bountyOf,
  fairTribute,
  lairRansoms,
  liveOffer,
  offerAfter,
  offerBlock,
  offersOf,
  siegeShare,
  softerThan,
  termsBlock,
  tributeAsk,
  tributeGoods,
  type OfferKind,
} from '../../src/world/parley.js';
import { restAfter, restAt } from '../../src/world/rest.js';
import { energyAt, energyBlock, onRoad, priceOf, remark, spend, type EnergyMark } from '../../src/world/energy.js';
import { gaitField, gaitHaltMs, gaitHaul, gaitName, gaitSpeed, readGait, roadLosses, siegeBlockOf, strikeSeed, strikeWorn, type Gait } from '../../src/world/gait.js';
import { ENERGY_FILL, ENERGY_MAX } from '../../src/world/data/energy.js';
import { weakCity } from '../../src/world/lairs.js';
import { inHomeTheatre } from '../../src/world/theatre/theatre.js';
import { machineShare, gateBusyText, playerWood, rebaseWood } from '../../src/world/works.js';
import { stackCarry, stackEscort } from '../../src/world/data/units.js';
import { BURN_IMMUNE, PACT_BREAK_NOTICE, PERIL_MEMORY, SIEGE_IMMUNE, SIEGE_ROUT, SPY_HELD } from '../../src/world/data/tuning.js';
import { bookLive, least, over, rulePips, ruleResolve, ruleSpirit, type ArmyBook } from './book.js';
import { capPips, type AgentsAt } from './agentbook.js';
import type { CommandAt } from './commandbook.js';
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
  /**
   * Ушедшие налегке на дороге удара и выручки (ДР-5): сколько снял сервер (`roadArmy`, `gait.strikeWorn`), чей замок и номер.
   * Книга войска вычитает их, как павших (`book.warLosses`): держать ушедших живыми — сверх книги, флаг. Наружу не уходит.
   */
  worn?: WarWorn[];
}

/** Уход налегке на дороге удара или выручки одного замка (ДР-5). */
export interface WarWorn {
  id: string;
  castle: string;
  lost: Counts;
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
  /** Предложения, ждущие ответа: кто, кому, что, когда и до какой минуты (ДП-1, `world/proposals`). */
  offers?: PactOffer[];
  /**
   * Закрытые предложения с итогом — принято, отклонено, срок вышел, отозвано — и разрывы союзов (ДП-1): из них «Вести» и
   * летопись обеих сторон и вести в Telegram. Лежат `DEALT_KEEP_MS`. Нет поля — ни одного.
   */
  dealt?: DealtRow[];
  /**
   * Энергия полководца по делам, которые не ведут свою войну, — удару по лагерю у своих стен и выручке союзника (этап 7
   * аудита, п. 9): по ключу игрока, отметка минуты приказа за вычетом цены дела, дальше копится, как дома. Потолок для
   * `generalCap`, а не правда: дорога туда и обратно не копит. Лежит `ENERGY_FILL` — потом запас полон и так. Нет поля —
   * таких дел не было.
   */
  gens?: Record<string, EnergyMark>;
  /**
   * Чьи вольные замки (ПН-10): взятые отрядами и сожжённые — по ключу замка `free:x:y`. Пишет одна дверь — падение вольного замка
   * (`seizeFree`); кто первым победил защитников, тот и взял (записи войн идут условной записью по ETag). Нет поля — ни одного.
   */
  free?: Record<string, FreeHold>;
}

/** Пакт двух игроков: ключи по порядку, имена городов на минуту пакта. Ключи наружу не уходят (`pactsOf`). */
export interface PactRow {
  a: string;
  b: string;
  at: number;
  cities: Record<string, string>;
  /** Кто принял предложение (ключ): весть «пакт заключён» уходит другому — предложившему (19.2). Нет — пакт старше поля. */
  by?: string;
  /**
   * Разрыв объявлен (АУ-8, п. 1; OWNER-DECISIONS п. 11): до этой минуты пакт держит обе стороны, потом уходит из записи
   * (`endPacts`). Нет — разрыва нет; пакт записи старше отсрочки — тоже.
   */
  breakAt?: number;
  /** Кто объявил разрыв (ключ). */
  breakBy?: string;
}

/**
 * Предложение между игроками (ДП-1): кто (`from`), кому (`to`), что (`kind`), когда и до какой минуты ждёт ответа. Запись
 * старше ДП-1 номера, вида и срока не несёт — их выводит `readWars` (союз, номер из замка и минуты, срок — сутки).
 */
export interface PactOffer {
  id: string;
  kind: ProposalKind;
  from: string;
  to: string;
  at: number;
  until: number;
  cities: Record<string, string>;
}

/** Закрытое предложение или разрыв союза: чем кончилось, когда и кто закрыл (ключ; нет — срок вышел). */
export interface DealtRow extends PactOffer {
  end: ProposalEnd;
  endAt: number;
  endBy?: string;
}

/** Сколько итог предложения лежит: обе стороны успевают зайти и прочесть его в «Вестях» и летописи. */
export const DEALT_KEEP_MS = 7 * 24 * 3600_000;

/** Номер предложения: замок предложившего и минута — ключи наружу не уходят. */
export const proposalId = (from: string, at: number): string => `${castleIdOf(from)}.${at.toString(36)}`;

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
  /** Сила диверсии лазутчика (АГ-1) — по книге агентов сервера на минуту приказа. Нет — новичок (единица). */
  power?: number;
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
        .map((x) => ({
          a: x.a,
          b: x.b,
          at: Number(x.at) || 0,
          cities: names(x.cities),
          ...(typeof x.by === 'string' ? { by: x.by } : {}),
          ...(Number.isFinite(x.breakAt) ? { breakAt: Number(x.breakAt) } : {}),
          ...(typeof x.breakBy === 'string' ? { breakBy: x.breakBy } : {}),
        }))
    : [];
  const offer = (x: Partial<PactOffer>): PactOffer => {
    const at = Number(x.at) || 0;
    const kind = x.kind && has(PROPOSALS, x.kind) ? x.kind : 'pact';
    return {
      id: typeof x.id === 'string' && x.id ? x.id : proposalId(x.from as string, at),
      kind,
      from: x.from as string,
      to: x.to as string,
      at,
      until: Number(x.until) || at + PROPOSALS[kind].ttlMs,
      cities: names(x.cities),
    };
  };
  const party = (x: unknown): x is PactOffer => Boolean(x) && typeof (x as PactOffer).from === 'string' && typeof (x as PactOffer).to === 'string';
  const offers = Array.isArray(r.offers) ? r.offers.filter(party).map(offer) : [];
  const ENDS: readonly ProposalEnd[] = ['yes', 'no', 'expired', 'withdrawn', 'broken'];
  const dealt = Array.isArray(r.dealt)
    ? r.dealt
        .filter((x): x is DealtRow => party(x) && ENDS.includes((x as DealtRow).end))
        .map((x) => ({ ...offer(x), end: x.end, endAt: Number(x.endAt) || 0, ...(typeof x.endBy === 'string' ? { endBy: x.endBy } : {}) }))
    : [];
  return {
    v: 1,
    seq: Math.max(0, Math.floor(Number(r.seq) || 0)),
    wars,
    ...(Object.keys(past).length ? { past } : {}),
    ...(spies.length ? { spies } : {}),
    ...(pacts.length ? { pacts } : {}),
    ...(offers.length ? { offers } : {}),
    ...(dealt.length ? { dealt } : {}),
    ...gensOf(r.gens),
    ...freeOf(r.free),
  };
}

const ENERGY_MODES: readonly EnergyMark['mode'][] = ['drain', 'fill', 'camp', 'hold'];

/** Отметки полководцев из хранилища: только целые (`WarFile.gens`). */
/** Чьи вольные замки — из хранилища (ПН-10); испорченная строка выпадает. */
function freeOf(v: unknown): { free?: Record<string, FreeHold> } {
  if (!v || typeof v !== 'object') return {};
  const out: Record<string, FreeHold> = {};
  for (const [id, h] of Object.entries(v as Record<string, unknown>)) {
    const x = (h ?? {}) as Partial<FreeHold>;
    if (typeof x.key !== 'string' || typeof x.war !== 'string' || !Number.isFinite(x.at) || !NOTICE_FATES.includes(x.fate as NoticeFate)) continue;
    out[id] = { key: x.key, at: x.at as number, war: x.war, fate: x.fate as NoticeFate, ...(Number.isFinite(x.burnt) ? { burnt: x.burnt as number } : {}) };
  }
  return Object.keys(out).length ? { free: out } : {};
}

function gensOf(v: unknown): { gens?: Record<string, EnergyMark> } {
  if (!v || typeof v !== 'object') return {};
  const gens: Record<string, EnergyMark> = {};
  for (const [k, m] of Object.entries(v as Record<string, unknown>)) {
    const x = (m ?? {}) as Partial<EnergyMark>;
    if (Number.isFinite(x.value) && Number.isFinite(x.at) && x.mode && ENERGY_MODES.includes(x.mode)) gens[k] = { value: x.value as number, at: x.at as number, mode: x.mode };
  }
  return Object.keys(gens).length ? { gens } : {};
}

/**
 * Дружина полководца в бою удара или выручки в минуту `at` легла вся — как у войска, не вернувшегося из похода, на его месте
 * может стоять новый, свежий: потолка нет.
 */
function unmarkBeaten(file: WarFile, w: WarRow, key: string, at: number): void {
  const b = w.battles[w.battles.length - 1];
  if (!b || b.at !== at || !b.genTroops || !file.gens?.[key]) return;
  if (troopTotal(asTroops(minus(b.genTroops, b.genLost ?? {}))) > 0) return;
  const { [key]: _, ...rest } = file.gens;
  if (Object.keys(rest).length) file.gens = rest;
  else delete file.gens;
}

/** Удар или выручка приняты: полководец заплатил цену в минуту `now` из `have` — потолок до его следующего дела. */
function markGeneral(file: WarFile, key: string, have: number, now: number, deed: 'strike' | 'chase' = 'strike'): void {
  file.gens = { ...(file.gens ?? {}), [key]: spend({ value: have, at: now, mode: 'fill' }, now, priceOf(deed)) };
}

/**
 * Кто выиграл бой войны. `won` — победил ли тот, кто в этом бою нападал: при штурме это поход (`atk`), при вылазке и
 * ударе по лагерю — город (`def`). Выручка (АУ-8, п. 4): лагерь разбил союзник — победа его, а не города, чей гарнизон не
 * выходил (`pvp.reliefCredit`, с версии правил `RELIEF_WIN_RULES`); союзник отбит — победа осаждающего, как прежде.
 */
export const battleWinner = (w: WarRow, b: WarBattle): string => {
  const side = (b.by === 'atk') === b.won ? w.atk : w.def;
  if (side !== w.def || !reliefCredit(b)) return side;
  return (w.allies && b.ally ? own(w.allies, b.ally)?.key : undefined) ?? side;
};

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
  const { atk, def, allies, worn, ...rest } = row;
  void allies;
  void worn;
  if (atk === key) {
    // Перехват в поле (ПЛ-1) нападающему не виден: навстречу идут молча, как отряд логова не знает о погоне.
    const { meets, missed, ...seen } = rest;
    void meets;
    void missed;
    return { ...seen, role: 'atk' };
  }
  if (def === key) return { ...rest, role: 'def' };
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
  // Перехват союзником (ПЛ-1): его перехват идёт или сорвался — итог он применяет сам.
  if (w.meets?.some((m) => m.castle === me) || w.missed?.some((m) => m.castle === me)) return true;
  // Поход на союзника в пути и домой — его можно перехватить в поле (ПЛ-1); лагерь — выручить (раздел 5).
  return (w.phase === 'camp' || w.phase === 'march' || w.phase === 'back') && pacted(file, key, w.def);
}

/**
 * Свои войны и осады союзников — свежие сверху. `since` — минута обнуления партии игрока (`partyreset.resetOf`, 30.10.2026): война,
 * начатая раньше неё, шла у прежней партии, и новой не отдаётся — иначе новая партия приняла бы её бои, падение и дань как свои
 * (ПН-5, хвост б). Не обнуляли — ноль, отдаётся всё.
 */
export const warsOf = (file: WarFile, key: string, since = 0): WarView[] =>
  file.wars
    .filter((w) => w.sentAt >= since && (w.atk === key || w.def === key || allyOf(file, w, key)))
    .map((w) => viewOf(w, key))
    .reverse();

// ------------------------------------------------ пакты между игроками ---

/** Пакт двух игроков в записи (и в отсчёте разрыва — тоже). */
const pactRow = (file: WarFile, a: string, b: string): PactRow | undefined =>
  (file.pacts ?? []).find((p) => (p.a === a && p.b === b) || (p.a === b && p.b === a));

/** Пакт двух игроков есть. В отсчёте разрыва — есть: он держит обе стороны до `breakAt` (АУ-8, п. 1). */
export const pacted = (file: WarFile, a: string, b: string, now = -Infinity): boolean => {
  const p = pactRow(file, a, b);
  return Boolean(p) && pactHolds({ state: 'pact', breakAt: p?.breakAt }, now);
};

/** Отсчёт разрыва кончился — пакт уходит из записи (ход записи, `advance`). */
export function endPacts(file: WarFile, now: number): boolean {
  const was = file.pacts ?? [];
  const kept = was.filter((p) => p.breakAt === undefined || p.breakAt > now);
  if (kept.length === was.length) return false;
  file.pacts = kept;
  return true;
}

/** Сколько предложений пакта игрок держит сразу — потолок записи, не правило игры. */
export const PACT_OFFERS_MAX = 20;

/** Пакты и предложения игрока глазами клиента: замки и имена, без ключей. */
export function pactsOf(file: WarFile, key: string): WarPact[] {
  const out: WarPact[] = [];
  for (const p of file.pacts ?? []) {
    if (p.a !== key && p.b !== key) continue;
    const other = p.a === key ? p.b : p.a;
    out.push({ castle: castleIdOf(other), city: cityOr(p.cities[other]), state: 'pact', at: p.at, ...(p.breakAt !== undefined ? { breakAt: p.breakAt } : {}) });
  }
  for (const o of file.offers ?? []) {
    if (o.from === key) out.push({ castle: castleIdOf(o.to), city: cityOr(o.cities[o.to]), state: 'offered', at: o.at });
    else if (o.to === key) out.push({ castle: castleIdOf(o.from), city: cityOr(o.cities[o.from]), state: 'asked', at: o.at });
  }
  return out;
}

/** Предложение глазами стороны `key`: без ключей игроков. */
function proposalView(o: PactOffer | DealtRow, key: string): ProposalView {
  const side = o.to === key ? 'in' : 'out';
  const other = side === 'in' ? o.from : o.to;
  const d = 'end' in o ? o : null;
  return {
    id: o.id,
    kind: o.kind,
    side,
    castle: castleIdOf(other),
    city: cityOr(o.cities[other]),
    at: o.at,
    until: o.until,
    ...(d ? { end: d.end, endAt: d.endAt, ...(d.endBy ? { endBy: d.endBy === key ? ('us' as const) : ('them' as const) } : {}) } : {}),
  };
}

/** Предложения игрока (ДП-1): ждущие ответа и закрытые с итогом — свежие сверху. */
export function proposalsOf(file: WarFile, key: string): ProposalView[] {
  const mine = (o: PactOffer): boolean => o.from === key || o.to === key;
  return [...(file.offers ?? []).filter(mine), ...(file.dealt ?? []).filter(mine)]
    .map((o) => proposalView(o, key))
    .sort((a, b) => (b.endAt ?? b.at) - (a.endAt ?? a.at));
}

/** Закрыть предложение итогом: из ждущих — в закрытые. */
function closeOffer(file: WarFile, o: PactOffer, end: ProposalEnd, at: number, by?: string): void {
  file.offers = (file.offers ?? []).filter((x) => x !== o);
  file.dealt = [...(file.dealt ?? []), { ...o, end, endAt: at, ...(by ? { endBy: by } : {}) }];
}

/** Срок ответа вышел — предложение закрывается итогом «срок вышел» в минуту срока (ход записи, `advance`). */
export function expireOffers(file: WarFile, now: number): boolean {
  const late = (file.offers ?? []).filter((o) => o.until <= now);
  for (const o of late) closeOffer(file, o, 'expired', o.until);
  return late.length > 0;
}

/** Союз заключён: пара ключей по порядку, предложение — в закрытые с «принято». */
function makePact(file: WarFile, o: PactOffer, key: string, now: number, ctx: OrderCtx): void {
  const other = o.from;
  const cities = { [key]: cityOr(ctx.roster.rows[key]?.city ?? o.cities[key]), [other]: cityOr(ctx.roster.rows[other]?.city ?? o.cities[other]) };
  const [a, b] = key < other ? [key, other] : [other, key];
  file.pacts = [...(file.pacts ?? []), { a, b, at: now, cities, by: key }];
  closeOffer(file, o, 'yes', now, key);
}

const warBetween = (file: WarFile, a: string, b: string): boolean =>
  file.wars.some((w) => active(w) && ((w.atk === a && w.def === b) || (w.atk === b && w.def === a)));

/**
 * Ответ на предложение по номеру (ДП-1, ЗЩ-1): принять и отклонить может только тот, кому предложили, отозвать — только
 * предложивший, и только пока срок не вышел (`world/proposals.answerBlock` — та же проверка, что гасит кнопку). Чужое
 * предложение честный клиент не показывает вовсе — такой приказ отказ и флаг в журнале города.
 */
function dealOrder(file: WarFile, key: string, id: string, act: ProposalAct, now: number, ctx: OrderCtx): string | null {
  const o = (file.offers ?? []).find((x) => x.id === id);
  const done = o ? null : (file.dealt ?? []).find((x) => x.id === id);
  const row = o ?? done;
  if (!row) return 'Такого предложения нет.';
  if (row.from !== key && row.to !== key) {
    ctx.forged?.(`Ответ на чужое предложение ${id}: ни предлагал, ни получал.`);
    return 'Это предложение не вам.';
  }
  const block = answerBlock(proposalView(row, key), act, now);
  if (block || !o) return block ?? 'На это предложение уже ответили.';
  if (act === 'withdraw') {
    closeOffer(file, o, 'withdrawn', now, key);
    return null;
  }
  if (act === 'no') {
    closeOffer(file, o, 'no', now, key);
    return null;
  }
  if (pacted(file, key, o.from)) {
    closeOffer(file, o, 'yes', now, key);
    return null;
  }
  if (warBetween(file, key, o.from)) return 'Между нами идёт война. Союза не будет, пока она не кончится.';
  makePact(file, o, key, now, ctx);
  return null;
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
  const held = pactRow(file, key, other);
  if (held) return pactBreakingBlock({ state: 'pact', breakAt: held.breakAt }, now) ?? 'Пакт уже заключён.';
  if (warBetween(file, key, other)) return 'Между нами идёт война. Пакта не будет, пока она не кончится.';
  const cities = { [key]: cityOr(ctx.roster.rows[key]?.city), [other]: cityOr(ctx.roster.rows[other]?.city) };
  const offers = file.offers ?? [];
  // Встречное предложение — согласие: дипломат, приехавший к тому, кто уже зовёт, привёз «да».
  const asked = offers.find((o) => o.from === other && o.to === key && o.until > now);
  if (asked) {
    makePact(file, asked, key, now, ctx);
    return null;
  }
  if (offers.some((o) => o.from === key && o.to === other && o.until > now)) return 'Предложение уже у них. Ждём ответа.';
  if (offers.filter((o) => o.from === key).length >= PACT_OFFERS_MAX) return 'Предложений и так много. Подожди ответов.';
  file.offers = [...offers, { id: proposalId(key, now), kind: 'pact', from: key, to: other, at: now, until: now + PROPOSALS.pact.ttlMs, cities }];
  return null;
}

/**
 * Разорвать пакт, отозвать своё предложение или отклонить чужое. Каждое — итогом в закрытые (ДП-1): разрыв — строкой
 * «разорван» от разорвавшего, отозванное и отклонённое — своим итогом.
 *
 * Разрыв — не сразу (АУ-8, п. 1; OWNER-DECISIONS п. 11): пакт держит обе стороны ещё `PACT_BREAK_NOTICE` (`breakAt`), как
 * у соседей-ботов в мире (`world/diplomacy`), — та сторона, что заходит раз в несколько часов, узнаёт о разрыве до похода.
 * Итог «разорван» ложится в минуту объявления — весть уходит сразу, — и несёт минуту конца союза в `until`.
 */
function unpactOrder(file: WarFile, key: string, target: string, now: number): string | null {
  const pacts = file.pacts ?? [];
  const mine = (k: string): boolean => castleIdOf(k) === target;
  const held = pacts.filter((p) => (p.a === key && mine(p.b)) || (p.b === key && mine(p.a)));
  const offers = (file.offers ?? []).filter((o) => (o.from === key && mine(o.to)) || (o.to === key && mine(o.from)));
  if (held.length === 0 && offers.length === 0) return 'Пакта нет.';
  const breaking = held.map((p) => pactBreakingBlock({ state: 'pact', breakAt: p.breakAt }, now)).find((x) => x);
  if (breaking && offers.length === 0) return breaking;
  const broken = held.filter((p) => p.breakAt === undefined);
  const breakAt = now + PACT_BREAK_NOTICE;
  for (const p of broken) {
    p.breakAt = breakAt;
    p.breakBy = key;
    const other = p.a === key ? p.b : p.a;
    const row: DealtRow = { id: proposalId(key, now), kind: 'pact', from: key, to: other, at: now, until: breakAt, cities: { ...p.cities }, end: 'broken', endAt: now, endBy: key };
    file.dealt = [...(file.dealt ?? []), row];
  }
  for (const o of offers) closeOffer(file, o, o.from === key ? 'withdrawn' : 'no', now, key);
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
  /**
   * Книга запасов (`goods.ts`, docs/security.md, ЗЩ-2): склад, казна, хлеб и невольники слепка — из описи той же записи и
   * не меньше объяснимой убыли (`goods.goodsSheet`). Нет или не той записи — слепок как есть.
   */
  goods?: GoodsBook;
  /**
   * Стойкость Воеводы подтверждённого совета (РТ-1, `watch.councilResolve`): сверх обряда в бой идёт не больше неё. Нет —
   * ноль: советника сервер не подтвердил или запись до совета.
   */
  marshal?: number;
  /**
   * Агенты подтверждённой книги (АГ-1, `watch.agentsOf` → `agentbook.agentsAt`): отметки полководца, скрытность и диверсия
   * лазутчика, красноречие дипломата — числа, которые сервер считает сам. Нет — запись до АГ-1 или сид неизвестен: правила
   * прежние (`rulePips`, слепок лазутчика под потолками `town.ruleWatch`).
   */
  agents?: AgentsAt;
  /**
   * Стойкость рыцарства в силе (РТ-2, `watch.estateCeilOf`): по подтверждённым уровням и привилегиям, лояльность сверху —
   * сверх обряда и Воеводы. Нет — ноль.
   */
  knights?: number;
  /**
   * Потолок валовой добычи хлеба в час (ОС-1, правило «prod», `watch.yieldCapOf`): места дел подтверждённых построек при
   * подтверждённых жителях, работником в лучших множителях. Слепок, назвавший больше, идёт в осаду с потолком. Нет — как есть.
   */
  yieldCap?: number;
  /**
   * Потолок духа дружины (ДР-1, `watch.spiritCeilOf`): книга духа — жалованье по часам сервера — и подтверждённые Воевода,
   * рыцари и казармы. Дух слепка и приказа идёт в бой не выше него (`book.ruleSpirit`). Нет — названный в пределах шкалы.
   */
  spirit?: WarSpirit;
  /**
   * Командиры флангов подтверждённой книги (ДР-3, `watch.commandOf` → `commandbook.commandAt`): тактика флангов в войну — у
   * стен, пока полководец в городе (`liveSheet`), и в походе (`ruleArmy`), — числами сервера, а не клиента. Нет — командиров нет.
   */
  command?: CommandAt;
  /**
   * Книга черт армии и полководец по книге агентов (ДР-4, `watch.scarsOfRec`): из них и из меток нынешней записи войн сервер
   * выводит черты стороны сам (`scarbook.scarsAt`) — у стен в слепке (`liveSheet`) и в походе (`ruleArmy`). Нет — черт нет.
   */
  scars?: { book?: ScarBook; gen?: number };
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

const fits = (want: Counts, have: Counts): boolean => Object.entries(want).every(([k, v]) => (v ?? 0) <= (own(have, k) ?? 0));

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
  return siegeBread(file, key, bookedSheet(file, key, s, at), at);
}

/**
 * Хлеб осаждённого города — хлеб окна осады (Р-5, docs/siege_v2.md, 21.1): пока под его стенами стоит лагерь, слепок держит
 * хлеба не больше остатка окна к минуте `at` (`siege.foodLeft`). Слепок ложится записью партии — у ушедшего из игры до
 * осады, — и без этого падение голодом уносило хлеб, который окно уже съело. Голод — ноль. Двух лагерей — меньший остаток.
 */
function siegeBread(file: WarFile, key: string, sheet: WarSheet, at: number): WarSheet {
  let bread = Infinity;
  for (const w of file.wars) {
    if (w.def !== key || w.phase !== 'camp' || !w.camp || w.camp.startedAt > at) continue;
    bread = Math.min(bread, foodLeft(w.camp as SiegeWindow, at));
  }
  if (!(bread < Infinity)) return sheet;
  return { ...sheet, food: Math.min(sheet.food, Math.max(0, Math.floor(bread))), stock: breadStock(sheet.stock, bread) };
}

/** Слепок с книгами войска, стройки и запасов, без хлеба осады (`liveSheet`). */
function bookedSheet(file: WarFile, key: string, s: SheetAt, at: number): WarSheet {
  const claimed = claimedSheet(file, key, s, at);
  // Добыча хлеба для осады (ОС-1) — не выше потолка подтверждённых построек: поля, которых нет, город не кормят.
  const claim = s.yieldCap !== undefined && claimed.yieldPerHour !== undefined ? { ...claimed, yieldPerHour: Math.min(claimed.yieldPerHour, s.yieldCap) } : claimed;
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
  // Склад, казна, хлеб и невольники — книги запасов той же записи, а не слова слепка (docs/security.md, ЗЩ-2). Тактика флангов
  // слепка не читается вовсе (ДР-3): её ставит книга командиров ниже.
  const { flanks: told, ...sheet } = goodsSheet(s.sheet, s.at, s.goods);
  void told;
  const seen = new Set(sheet.seen);
  let army = sheet.army;
  let home = sheet.home;
  let stock = sheet.stock;
  let gold = sheet.gold;
  let bonded = sheet.bonded;
  let pop = sheet.pop;
  const levels = { ...sheet.levels };
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
  let pips = sheet.pips;
  // Полководец в городе — с ним у стен и командиры флангов (ДР-3); ушёл в поход — ушли и они, вернулся — вернулись.
  let led = sheet.led === true;
  const out = new Set(sheet.out ?? []);
  for (const w of file.wars) {
    if (w.atk !== key || w.sentAt > at) continue;
    const back = (w.phase === 'back' || w.phase === 'done') && (w.backAt ?? w.endAt ?? Infinity) <= at;
    if (out.has(w.id)) {
      if (!back) continue;
      home = plus(home, w.army.troops);
      pips = w.army.pips;
      led = true;
    } else if (s.at < w.sentAt) {
      const went = w.went ?? w.army.troops;
      home = minus(home, sheet.retinue ? atMost(went, sheet.retinue) : went);
      pips = back ? w.army.pips : {};
      led = back;
      if (back) home = plus(home, w.army.troops);
    }
  }
  // Черты армии и полководец (ДР-4) — только числами сервера: названное слепком снимается, даже если разбор его пропустил.
  const { scars: toldScars, scarGen: toldGen, ...given } = sheet;
  void toldScars;
  void toldGen;
  return {
    ...given,
    army,
    home,
    stock,
    gold,
    bonded,
    pop,
    levels,
    // Отметки — под потолком правил и подтверждённого полководца (АГ-1): у стен — его отметки, а не названные слепком.
    pips: capPips(rulePips(pips), s.agents?.pips),
    // Командиры флангов — числами книги командиров сервера (ДР-3, `commandbook.commandAt`), пока полководец в городе; слепок
    // клиента их не несёт (`contract.readSheet`).
    ...(led ? flanksField(s.command?.flanks) : {}),
    resolve: ruleResolve(sheet.resolve, s.marshal ?? 0, s.knights ?? 0),
    ...spiritField(ruleSpirit(sheet.spirit, s.spirit)),
    // Черты армии обороны (ДР-4) — книгой черт сервера и метками записи войн; слепок клиента их не несёт (`contract.readSheet`).
    ...scarsField(file, key, s),
  };
}

/**
 * Черты армии игрока `key` в войну (ДР-4, Ш6): книга черт и метки записи войн, полководец — книгой агентов; и номер полководца
 * для метки боя. Ни книги, ни полководца — пусто.
 */
export function scarsField(file: WarFile, key: string, s: SheetAt | null | undefined): { scars?: string[]; scarGen?: number } {
  const gen = s?.scars?.gen;
  const held = scarsAt(s?.scars?.book, file, key, gen);
  return { ...(held.length > 0 ? { scars: held } : {}), ...(gen !== undefined ? { scarGen: gen } : {}) };
}

/** Черты стороны в бой (ДР-4): имена, поставленные сервером; голода в бою войны нет (Ш6). Нет черт — поля нет. */
const scarSide = (held: readonly string[] | undefined): { scars?: ScarSide } => {
  const ids = (held ?? []).filter(isScarId);
  return ids.length > 0 ? { scars: { held: ids } } : {};
};

/** Место боя войны для черт (ДР-4): клетка города — лес, река, холмы; часа нет; бой войны всегда осадный. */
const warWhere = (w: WarRow): ScarWhere => scarWhere(placeAt(0, w.to.x, w.to.y), true);

/**
 * Метки боя для журналов армий (ДР-4): у каждой дравшейся стороны — её роль в войне и полководец, при котором она дралась
 * (`scarGen`). Боя не было — поля нет.
 */
function marksOf(field: FieldOutcome, roles: Partial<Record<'attacker' | 'defender', { role: 'atk' | 'def' | 'ally'; gen?: number }>>): { marks?: WarBattle['marks'] } {
  if (!field.marks) return {};
  const out: NonNullable<WarBattle['marks']> = {};
  for (const side of ['attacker', 'defender'] as const) {
    const r = roles[side];
    if (!r) continue;
    out[r.role] = { ...field.marks[side], ...(r.gen !== undefined ? { gen: r.gen } : {}) };
  }
  return Object.keys(out).length > 0 ? { marks: out } : {};
}

/** Командиры флангов — полем, когда они есть (ДР-3): бой без них идёт байт в байт прежним. */
const flanksField = (f: WarFlanks | undefined): { flanks?: Flanks } => (f && (f.A || f.C) ? { flanks: { ...f } } : {});

/** Дух — полем, когда он есть: бой без духа (клиент до ДР-1) идёт по прежним правилам. */
const spiritField = (v: WarSpirit | undefined): { spirit?: WarSpirit } => (v ? { spirit: v } : {});

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
  return { troops, resolve: a.resolve, pips: a.pips, ...flanksField(a.flanks), ...spiritField(a.spirit), ...(rest ? { rest } : {}), ...(a.energy ? { energy: a.energy } : {}) };
}

/**
 * Обратный путь войска: энергия полководца уходит в дороге и копится с минуты возврата — той же функцией дороги, что у
 * мира на клиенте (`world/energy.onRoad`; docs/agent_energy.md, раздел 2).
 */
function homeward(w: WarRow, at: number, backAt: number): void {
  w.army = { ...w.army, energy: onRoad(w.army.energy, at, backAt, true, gaitSpeed(w.gait)) };
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

// ------------------------------------------------ вольные замки (ПН-10, docs/gdd/path_of_sword.md, 3.11) ---

// Строка «Занять» таблицы участи — здесь, у сервера: падение вольного замка считает дверь `spoils.fate` этой строкой.
FATES.occupy = OCCUPY_RULE;
//
// Осада вольного замка — та же война: стена, фазы, машины, обстрел, блокада, вылазка — двери войны игроков без второй копии. Своё
// у неё четыре вещи: защитник — НПС-слепок ступени (`npcSheet`), голод и «ворота» фазы не сдают замок, а выводят гарнизон в последнюю
// вылазку (`lastSortie`, решение Н5: только мечом), сдачи на условиях нет (В6), и замок — тому, чей бой победил защитников первым
// (`advanceFree` по времени событий, `seizeFree` — одна дверь записи `WarFile.free`).

/** Слепок защитника войны в минуту `at`: у игрока — опись и книги (`liveSheet`), у вольного замка — НПС-слепок ступени. */
function defSheet(file: WarFile, w: WarRow, at: number, s: SheetAt | null | undefined): WarSheet | null {
  if (w.npc) return npcSheet(file, w.def, w.npc.tier, at);
  return s ? liveSheet(file, w.def, s, at) : null;
}

/**
 * НПС-слепок вольного замка `def` ступени `tier` в минуту `at` (`world/freecastle`): гарнизон строя замка бойцами племени, казна по
 * мощи, кладовая НПС, уровни ступени. Убыль — бои и дань войн на этот замок, кончившихся меньше `BURN_IMMUNE` назад или идущих:
 * кастелян набирает гарнизон за тот же срок, за который сожжённый замок отстраивается. Хлеб двух лагерей — меньший остаток
 * (`siegeBread`).
 */
function npcSheet(file: WarFile, def: string, tier: FreeTier, at: number): WarSheet {
  let home = freeTroops(def, tier) as Counts;
  let gold = freeGold(tier);
  const larder = freeLarder(tier);
  let stock: Counts = { food: Math.floor(larder.food) };
  for (const w of file.wars) {
    if (w.def !== def || (w.endAt !== undefined && w.endAt + BURN_IMMUNE <= at)) continue;
    for (const b of w.battles) if (b.at <= at) home = minus(home, b.homeLost);
    const t = w.tribute;
    if (t && t.at <= at) {
      const { gold: g, ...goods } = t.taken;
      stock = minus(stock, goods);
      gold = Math.max(0, gold - (g ?? 0));
    }
  }
  const sheet: WarSheet = {
    army: home,
    home,
    militia: 0,
    archers: 0,
    resolve: 0,
    pips: {},
    rest: 1,
    food: stock.food ?? 0,
    townPerHour: larder.townPerHour,
    perManPerHour: larder.perManPerHour,
    yieldPerHour: 0,
    stock,
    stash: 0,
    gold,
    pop: freePop(tier),
    bonded: 0,
    levels: freeLevels(tier),
    power: troopPower(asTroops(home)),
    locks: {},
    seen: [],
  };
  return siegeBread(file, def, sheet, at);
}

/** Волн последней вылазки не больше стольких: гарнизон кончается раньше (проход лагеря — не меньше бойца за волну). */
const SORTIE_WAVES = 256;

/**
 * Последняя вылазка вольного замка (решение Н5): хлеб кончился или ворота фазы — гарнизон выходит **всем, кто остался**, истощённым
 * осадой (`garrisonRest`), ударом по лагерю той же дверью, что вылазка города (`hitCamp` → `fights.campFight`). Рогатки пропускают за
 * раз столько, сколько держит фронт лагеря (`works.throughWorks`), — гарнизон идёт волнами в ту же минуту, не дожидаясь, пока проход
 * освободится: отчаянная вылазка не возвращается за стены. Прорвала волна лагерь — осада снята; волн больше некому — замок взят
 * (`fall` «вылазка»), последним боем, который выиграл лагерь. Выходить некому с самого начала — гарнизон уже выбит в боях этой войны:
 * замок взят ими. Ни одна волна не прошла рогатки — боя нет: false, осада идёт дальше.
 */
function lastSortie(w: WarRow, at: number, sheet: WarSheet): boolean {
  let home = sheet.home;
  for (let wave = 0; wave < SORTIE_WAVES && troopTotal(asTroops(home)) > 0 && w.phase === 'camp' && w.camp; wave++) {
    const before = w.battles.length;
    // Проход — заново на каждую волну: вылазка всем, в одну минуту.
    w.camp = { ...w.camp, gateAt: undefined } as WarCamp;
    hitCamp(w, at, { ...sheet, home }, { front: home, site: 'sortie' });
    const b = w.battles[w.battles.length - 1];
    if (w.battles.length === before || !b) break;
    const left = minus(home, b.homeLost);
    // Волна не потеряла ни бойца и лагерь стоит — дальше биться нечем: гарнизон не прошёл.
    if (troopTotal(asTroops(left)) === troopTotal(asTroops(home)) && w.phase === 'camp') break;
    home = left;
  }
  if (w.phase !== 'camp') return true;
  // Гарнизон остался (волна не прошла или не потеряла ни бойца): замок стоит, кость фазы идёт — вылазка повторится следующей фазой.
  if (troopTotal(asTroops(home)) > 0) return false;
  fall(w, at, { ...sheet, home }, 'sortie');
  turnBack(w, at, w.to, 'taken');
  return true;
}

/**
 * Замок взят или сожжён — запись `WarFile.free`, одна дверь (ПН-10). Пишется, когда у войны на вольный замок есть падение, а замок
 * ещё ничей: так он достаётся тому, чей бой победил первым. Взят — держится за отрядом до перехода (ПН-11); сожжён — отстраивается
 * `BURN_IMMUNE`, потом снова свободен.
 */
function seizeFree(file: WarFile, w: WarRow): boolean {
  const f = w.fall;
  if (!w.npc || !f) return false;
  const had = file.free?.[w.def];
  if (had?.war === w.id || (had && freeHeld(had, f.at))) return false;
  file.free = { ...(file.free ?? {}), [w.def]: { key: w.atk, at: f.at, war: w.id, fate: f.fate, ...(f.fate === 'burn' ? { burnt: f.at + BURN_IMMUNE } : {}) } };
  return true;
}

/** Минута ближайшего события осады вольного замка; нет — бесконечность. */
function freeNextAt(w: WarRow): number {
  if (w.phase === 'march') return w.arriveAt;
  if (w.phase === 'camp') return Math.min(w.strike?.at ?? Infinity, w.camp ? nextRollAt(w.camp as SiegeWindow) : Infinity);
  if (w.phase === 'back') return w.backAt ?? 0;
  return Infinity;
}

/**
 * Осады вольных замков (ПН-10) — по времени событий через все войны: из двух осад одного замка раньше считается то событие, что
 * раньше случилось, а не та война, что раньше легла в запись. Замок уже взят другим (или сожжён) — лагерь снимается без потерь в
 * минуту взятия (`gone`); весть — у бродяги на столе.
 */
function advanceFree(file: WarFile, now: number, step: (w: WarRow) => boolean): boolean {
  let changed = false;
  const wars = file.wars.filter((w) => w.npc && w.phase !== 'done');
  for (let guard = 0; guard < 64 * Math.max(1, wars.length); guard++) {
    let next: WarRow | null = null;
    let at = Infinity;
    for (const w of wars) {
      const t = freeNextAt(w);
      if (t <= now && t < at) {
        next = w;
        at = t;
      }
    }
    if (!next) break;
    const h = file.free?.[next.def];
    if (h && h.war !== next.id && (next.phase === 'march' || next.phase === 'camp') && h.at <= at && freeHeld(h, h.at)) {
      turnBack(next, Math.max(h.at, next.sentAt), next.to, 'gone');
      changed = true;
      continue;
    }
    if (!step(next)) {
      wars.splice(wars.indexOf(next), 1);
      continue;
    }
    changed = true;
    seizeFree(file, next);
  }
  return changed;
}

/**
 * Поход отряда бродяги на вольный замок (ПН-10): штурм с ходу или осада. Путь открыт игроку, замок в пуле реестра и ничей, престиж
 * не ниже порога ступени (слово описи — `BandRow.prestige`, docs/trust-boundary.md), отряд стоит у стен (клетка замка или соседняя,
 * ходом реестра), одна война отряда за раз, войско — не больше книги отряда сервера (ВП4: сверх — подделка), участь — из участей
 * вольного замка (`FREE_FATE_IDS`, «Занять» — только ему). Две осады одного замка допустимы (3.11.3). Полководца, энергии и режима
 * марша у отряда нет: он уже у стен.
 */
function marchFree(file: WarFile, key: string, order: Extract<WarOrder, { op: 'march' }>, now: number, ctx: OrderCtx): string | null {
  if (!ctx.roamOpen) return 'Путь меча закрыт.';
  const band = ctx.roster.bands?.[key];
  if (!band) {
    ctx.forged?.('Поход на вольный замок не от отряда бродяги: у города вольных замков нет.');
    return 'На вольный замок ходит только отряд бродяги.';
  }
  const row = ctx.roster.free?.[order.target];
  if (!row) return 'Этого замка больше нет.';
  const held = file.free?.[order.target];
  if (held && freeHeld(held, now)) {
    if (held.fate === 'burn') return `Замок сожжён и отстраивается ещё ${Math.max(1, Math.ceil(((held.burnt ?? now) - now) / 3_600_000))} ч.`;
    if (held.key === key) return 'Замок уже наш.';
    // Чужой замок: карта показывает его взятым, и кнопки похода на него нет — приказ мимо интерфейса.
    ctx.forged?.(`Поход на вольный замок ${order.target}, который держит другой отряд.`);
    return 'Замок уже взял другой отряд.';
  }
  const no = freeAccess(band.prestige, row.tier);
  if (no) return no;
  if (roamMoving(band.way, now)) return 'Отряд в пути: сперва дойти до стен.';
  const at = roamCell(band.way, now);
  if (Math.max(Math.abs(at.x - row.x), Math.abs(at.y - row.y)) > 1) return 'Отряд не у стен замка: подойти к нему вплотную.';
  if (file.wars.some((w) => w.atk === key && active(w))) return 'Отряд уже ведёт осаду.';
  if (!(FREE_FATE_IDS as readonly string[]).includes(order.fate)) return 'Такой участи у вольного замка нет.';
  const troops = order.army.troops;
  if (troopTotal(asTroops(troops)) <= 0) return 'В отряде нет бойцов.';
  const book = band.book?.troops ?? {};
  for (const [k, n] of Object.entries(troops)) {
    if ((n ?? 0) > ((book as Counts)[k] ?? 0)) {
      ctx.forged?.(`Поход на вольный замок: ${k} — ${n}, книга отряда подтверждает ${(book as Counts)[k] ?? 0}.`);
      return 'Столько людей в отряде нет.';
    }
  }
  const gait = readGait(order.gait);
  const noCamp = order.mode === 'siege' ? siegeBlockOf(gait) : null;
  if (noCamp) {
    ctx.forged?.('Осада вольного замка налегке: лагерь налегке не ставят, интерфейс такой приказ не шлёт.');
    return noCamp;
  }
  const to = { x: row.x, y: row.y };
  file.seq += 1;
  file.wars.push({
    id: `w${file.seq.toString(36)}${(now % 46656).toString(36)}`,
    atk: key,
    def: order.target,
    atkCastle: castleIdOf(`band:${key}`),
    defCastle: order.target,
    atkCity: band.name,
    defCity: freeName(row.x, row.y),
    from: { x: at.x, y: at.y },
    to,
    mode: order.mode,
    fate: order.fate,
    sentAt: now,
    arriveAt: now + walk(at, to, gait),
    phase: 'march',
    army: { troops: { ...troops }, resolve: 0, pips: {} },
    went: { ...troops },
    ...(order.blockade && order.mode === 'siege' ? { ring: true as const } : {}),
    npc: { tier: row.tier },
    battles: [],
  });
  return null;
}


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
    attacker: {
      kinds: thinned(kindsOf(asTroops(w.army.troops)), thinOf(w, at)),
      resolve: w.army.resolve,
      pips: w.army.pips as Pips,
      ...flanksField(w.army.flanks),
      rest: armyRest(w.army, at),
      ...spiritField(w.army.spirit),
      ...scarSide(w.army.scars),
    },
    defender: {
      kinds: kindsOf(asTroops(sheet.home)),
      militia: wall.militia,
      archers: wall.archers,
      resolve: sheet.resolve,
      ...spiritField(sheet.spirit),
      pips: sheet.pips as Pips,
      ...flanksField(sheet.flanks),
      rest: garrisonRest(w, sheet, at),
      ...scarSide(sheet.scars),
    },
    front,
    // Место для черт (ДР-4): клетка города, бой у стены.
    where: warWhere(w),
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
    // Метки боя для журналов армий (ДР-4): поход и город.
    ...marksOf(field, { attacker: { role: 'atk', gen: w.army.scarGen }, defender: { role: 'def', gen: sheet.scarGen } }),
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
  // Обоз и конвой — уцелевшие похода, той же меркой, что у полководца против логова (`LocalWorld.haul`). Выбитые башней
  // списываются с войска, когда лагерь снят (`turnBack`), — позже падения; добычу они не несут (у мира — `homeFalls` после
  // `liftSiege`).
  const thin = thinOf(w, at);
  const survivors = troopTotal(asTroops(thin > 0 ? wasted(w.army.troops, thin) : w.army.troops));
  return fate({
    fate: fated,
    stock: sheet.stock,
    gold: sheet.gold,
    stash: sheet.stash,
    pop: sheet.pop,
    bonded: sheet.bonded,
    // Вывоз — по режиму марша похода (ДР-5): налегке без обоза меньше, с обозом больше — той же дверью, что у мира. «Занять» (ПН-10)
    // берёт сам замок, а не добро: обоза ноль.
    carry: stackCarry({ warrior: survivors }) * gaitHaul(w.gait) * (FATES[fated]?.castleOnly ? 0 : 1),
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
  // Вольный замок (ПН-10): дань кастеляна — да, сдачи на условиях — нет (решение В6).
  if (w.npc && kind === 'terms') return 'Вольный замок не сдаётся на условиях: его берут только мечом.';
  const sheet = defSheet(file, w, now, w.npc ? null : ctx.sheet(w.def));
  if (yes && !sheet) return 'Вести о городе ещё не дошли до края. Подожди минуту.';
  w.camp = { ...w.camp, ...answerAfter(w.camp as SiegeWindow, kind, yes ? 'yes' : 'no', now) } as WarCamp;
  if (!yes || !sheet) return null;
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

/** Путь войска между двумя клетками с темпом войны, в режиме марша `g` (ДР-2). */
const walk = (from: { x: number; y: number }, to: { x: number; y: number }, g?: Gait): number => Math.round(warWalkMs(from, to, g) / pace);

/** Где войско похода в минуту `at`: после смены режима — от начала нового отрезка, в стоянку — на месте (ДР-2, М6). */
const marchSpot = (w: WarRow, at: number): { x: number; y: number } => warAt(w.legFrom ?? w.from, w.to, w.legAt ?? w.sentAt, w.arriveAt, at);

/** Где войско на обратном пути в минуту `at`. */
const backSpot = (w: WarRow, at: number): { x: number; y: number } =>
  warAt(w.backFrom ?? w.to, w.from, w.legAt ?? w.endAt ?? at, w.backAt ?? at, at);

/**
 * Истощение налегке с `wornAt` до минуты `at` (ДР-2, М4): доля вида той же дверью, что у мира (`gait.roadLosses`), сид —
 * поход и начало отрезка. Списывается в минуты событий — приход, поворот домой, возврат, смена режима, — поэтому шаг
 * очереди сервера, частый или редкий, даёт тех же ушедших. Не налегке — ничего.
 */
function wearLight(w: WarRow, at: number): void {
  if (w.gait !== 'light' || w.wornAt === undefined || !(at > w.wornAt)) return;
  const lost = roadLosses(w.army.troops, 'light', at - w.wornAt, `${w.id}:${w.wornAt}`);
  w.army = { ...w.army, troops: minus(w.army.troops, lost) };
  w.wornAt = at;
}

/** Войско уходит домой от минуты `at` с места `from`. Некому уходить — война кончена на месте. */
function turnBack(w: WarRow, at: number, from: { x: number; y: number }, end: WarEnd): void {
  // Налегке — истощение до этой минуты (ДР-2): поворот домой — событие отрезка.
  wearLight(w, at);
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
    rechase(w, at);
    return;
  }
  w.phase = 'back';
  w.backFrom = from;
  delete w.legFrom;
  delete w.legAt;
  w.backAt = at + walk(from, w.from, readGait(w.gait));
  homeward(w, at, w.backAt);
  // Поход повернул домой — перехват идёт за ним обратным путём, если догонит (ПЛ-1).
  rechase(w, at);
}

/**
 * Окно осады из слепка обороны: те же часы голода, что у осады логова (`siege.openSiege`). `ration` — паёк с этой минуты
 * (приказ осаждённого); нет — как было. Башня города бьёт по лагерю с силой этой минуты (`bombard.reaim`).
 */
function campWindow(w: WarRow, at: number, sheet: WarSheet, prev: WarCamp | null, ration?: boolean, food?: number): WarCamp {
  const win = openSiege({
    byId: w.atkCastle,
    campId: w.id,
    now: at,
    // Темп войны ускоряет и голод: хлеба в окне во столько же раз меньше. Хлеб — склад (ОС-1): у той же осады — остаток окна,
    // а свежая опись склада (`regarrison`) ставит его заново: хлеб, пришедший в город, окно видит.
    food: food !== undefined ? food / pace : prev ? foodLeft(prev as SiegeWindow, at) : sheet.food / pace,
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
    // Лагерь с обозом (ДР-2, М5) — без подвоза из дома; записан при постановке, у той же осады переносится.
    gait: prev ? prev.gait : w.gait === 'train' ? 'train' : undefined,
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
    // Требушет на стене той же осады переносится; постройки под обстрелом — подтверждённые уровни при постановке (Р-5).
    guns: prev?.guns as SiegeWindow['guns'],
    targets: prev ? prev.targets : sheetTargets(sheet.levels),
    // Поля за стеной (ОС-1): валовая добыча слепка (не выше потолка подтверждённых построек, `bookedSheet`) и штраф к ней по
    // соотношению сил этой минуты — мерка кольца (`siegefood.siegeCutOf`); хлеб, когда встал лагерь, — мера доли хлеба кости.
    yieldPerHour: sheet.yieldPerHour,
    cut: siegeCutOf(campPower(w, at), garrisonPower(sheet)),
    breadAtSince: prev ? (prev.breadAtSince ?? prev.foodAtStart) : sheet.food / pace,
  });
  const aimed = reaim(win.fire, win.wood, siegeSince(win), at, aimOfSheet(sheet));
  if (aimed.fire) win.fire = aimed.fire;
  else delete win.fire;
  if (aimed.wood) win.wood = aimed.wood;
  return win as WarCamp;
}

/**
 * Постройки города, по которым бьёт артиллерия лагеря с целью «город» (Р-5, `world/shelling`): подтверждённые уровни слепка
 * обороны (`town.townSheet`), всё, что стоит, кроме стены; по имени — тот же порядок, что у мира (`LocalWorld.homeTargets`).
 */
function sheetTargets(levels: Record<string, number> | undefined): string[] | undefined {
  const out = Object.entries(levels ?? {})
    .filter(([k, v]) => k !== 'palisade' && (v ?? 0) >= 1)
    .map(([k]) => k)
    .sort();
  return out.length ? out : undefined;
}

/** Мощь лагеря — без выбитых башней (`bombard.thinAt`) — и гарнизона слепка: с ними меряется кольцо (`world/blockade`). */
const campPower = (w: WarRow, at: number): number => troopPower(asTroops(w.army.troops)) * (1 - thinOf(w, at));
const garrisonPower = (sheet: WarSheet): number => troopPower(asTroops(sheet.home));

/**
 * Кольцо блокады в минуту события (Р-5, docs/siege_v2.md, 21.1) — той же дверью, что у мира (`LocalWorld.ringCheck`): удар
 * с поля его размыкает (`why`), мощь ниже порога — тоже. Замыкает кольцо только приказ осаждающего: у игрока решения свои.
 */
function ringCheck(w: WarRow, at: number, sheet: WarSheet, why?: BlockadeBreak): void {
  const camp = w.camp as SiegeWindow | undefined;
  if (!camp || !blockadeAt(camp, at)) return;
  if (why) w.camp = { ...w.camp, ...blockadeAfter(camp, at, false, why) } as WarCamp;
  else if (!blockadeHolds(campPower(w, at), garrisonPower(sheet))) w.camp = { ...w.camp, ...blockadeAfter(camp, at, false, 'ratio') } as WarCamp;
}

/**
 * Выстрелы фазы по машинам (Р-5, `world/shelling`): требушет на стене разбивает машины лагеря, артиллерия лагеря — требушет
 * на стене. Сами выстрелы бросила кость фазы (`rollPhase`, строка журнала) — здесь только то, что они сделали с окном.
 */
function shotsStep(w: WarRow, row: PhaseRow, at: number): void {
  // На месте: фаза дальше пишет в тот же объект лагеря (наказы, журнал дел).
  const camp = w.camp as SiegeWindow;
  const after = shotsApplied(camp, row, at);
  if (after.machines !== camp.machines) camp.machines = after.machines;
  if (after.guns !== camp.guns) camp.guns = after.guns;
}

/**
 * Войско после доли `share` (выбитое башней): доля с каждого рода, остаток рода — к ближнему (`price.shareLosses`, BTL-1).
 * Истощение фазы — не здесь, а костью сида осады (`siegeroll.wasteLosses`, АУ-8, п. 3).
 */
function wasted(troops: Counts, share: number): Counts {
  return minus(troops, shareLosses(asTroops(troops), share) as Counts);
}

/**
 * Фаза осады в минуту `at` (docs/siege_v2.md, раздел 2) — той же дверью, что у мира на клиенте (`siegeroll.rollPhase`):
 * строка в журнал лагеря, истощение войска похода (раздел 3), исход. Ворота открыли — падение (`fall`, сдача); лагерь
 * растаял — осада снята. Потом наказы нападающего (8.3) — те же приказы с теми же отказами: штурм при названных проломах,
 * иначе залп этой фазы, пока энергии хватает и на него, и на штурм. `atkHungry` — пуст ли амбар дома у нападающего.
 */
function phaseStep(w: WarRow, at: number, sheet: WarSheet, atkHungry: boolean): void {
  let camp = w.camp as SiegeWindow;
  // Шаг осады (ОС-1): добыча → прокорм → проверка — склад окна, вставший на последнюю опись. Не оплатил прокорм — город сдан
  // голодом, и кость этой фазы не бросается. Ровно ноль — оплачен.
  if (starves(breadAt(camp, at))) {
    // Вольный замок голодом не сдаётся (решение Н5): гарнизон выходит в последнюю вылазку. Прохода нет — боя нет, кость фазы идёт.
    if (w.npc) {
      if (lastSortie(w, at, sheet)) return;
    } else {
      fall(w, at, sheet, 'hunger');
      turnBack(w, at, w.to, 'taken');
      return;
    }
  }
  const k = rowsOf(camp).length + 1;
  const row = rollPhase(camp, k, atkHungry);
  camp.phases = [...rowsOf(camp), row];
  shotsStep(w, row, at);
  // Истощение фазы — доля вида, дробь костью сида осады (АУ-8, п. 3): та же дверь, что у мира.
  if (row.waste > 0) w.army = { ...w.army, troops: minus(w.army.troops, wasteLosses(w.army.troops, row.waste, rollSeed(camp), k)) };
  if (troopTotal(asTroops(w.army.troops)) <= 0) {
    turnBack(w, at, w.to, 'lifted');
    return;
  }
  // Кольцо блокады после броска и истощения: держит ли его мощь лагеря (Р-5). Разомкнув, оно кладёт новое окно лагеря —
  // наказы и залп дальше пишут в него, а не в прежнее (BTL-4).
  ringCheck(w, at, sheet);
  camp = w.camp as SiegeWindow;
  if (row.out === 'gates') {
    // Сдачи у вольного замка нет (решение В6): сломленный гарнизон выходит в последнюю вылазку — той же дверью, что голод.
    if (w.npc) {
      if (lastSortie(w, at, sheet)) return;
    } else {
      fall(w, at, sheet, 'gates');
      turnBack(w, at, w.to, 'taken');
      return;
    }
  }
  // Кастелян откупается от лагеря, которого замок не потянет (3.11.2): дань за снятие осады — правилом логова (`parley.lairRansoms`),
  // цена — справедливая на эту минуту. Говорун бродяге не нужен: ответ — приказ `answer`.
  if (w.npc && lairRansoms(siegeShare(camp, at)) && !offersOf(camp).some((o) => o.kind === 'tribute') && offerBlock(camp, 'tribute', at) === null) {
    const price = fairOf(w, at, sheet);
    if (price > 0) w.camp = { ...w.camp, ...offerAfter(camp, { kind: 'tribute', at, price }) } as WarCamp;
    camp = w.camp as SiegeWindow;
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
  // Истощение и бой фазы сдвинули соотношение сил — штраф к добыче заново (ОС-1): одно событие, один пересчёт окна.
  if (w.phase === 'camp' && w.camp && siegeCutOf(campPower(w, at), garrisonPower(sheet)) !== w.camp.cut) setCamp(w, campWindow(w, at, sheet, w.camp));
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
  const unpaid = unpaidWork(w, sheet);
  for (const [r, v] of Object.entries(cost)) if ((sheet.stock[r] ?? 0) < (v ?? 0) * (unpaid + 1)) return 'На починку не хватает дерева и камня.';
  return null;
}

/**
 * Работы на стене, за которые защитник ещё не заплатил (`WarSheet.seen`): починки пролома и требушеты (Р-5) — у них одна цена,
 * треть уровня стен (`build.wallRepairCost`), и сервер числит её за городом, пока клиент не отметит оплату.
 */
function unpaidWork(w: WarRow, sheet: WarSheet): number {
  const camp = w.camp;
  if (!camp) return 0;
  const seen = new Set(sheet.seen);
  const repairs = repairsOf(camp as SiegeWindow).filter((d) => !seen.has(warRepairId(w.id, d.at))).length;
  const guns = (camp.guns ?? []).filter((g) => !seen.has(warGunId(w.id, g.at))).length;
  return repairs + guns;
}

/** Хватает ли защитнику на требушет на стене (Р-5): та же цена и та же мерка, что у починки пролома (`repairShort`). */
function gunShort(w: WarRow, sheet: WarSheet): string | null {
  const camp = w.camp;
  if (!camp) return 'Лагеря под стенами уже нет.';
  const cost = wallRepairCost(camp.wall ?? 0);
  if (!Object.keys(cost).length) return 'Стены нет — требушет ставить некуда.';
  const unpaid = unpaidWork(w, sheet);
  for (const [r, v] of Object.entries(cost)) if ((sheet.stock[r] ?? 0) < (v ?? 0) * (unpaid + 1)) return 'На требушет не хватает дерева и камня.';
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
    guard: { kinds: guardKinds(side.kinds, GUARD_SHARE), resolve: side.resolve, pips: side.pips, flanks: side.flanks, rest: side.rest, scars: side.scars },
    sortie: { kinds: kindsOf(asTroops(troops)), rest: garrisonRest(w, sheet, at) },
    resolve: sheet.resolve,
    pips: sheet.pips as Pips,
    ...flanksField(sheet.flanks),
    ...spiritField(sheet.spirit),
    ...scarSide(sheet.scars),
    where: warWhere(w),
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

    // Метки боя (ДР-4): вышли из ворот — город, охрана — поход.
    ...marksOf(field, { attacker: { role: 'def', gen: sheet.scarGen }, defender: { role: 'atk', gen: w.army.scarGen } }),
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
 * Требушет на стене осаждённого (Р-5, `world/shelling`): та же проверка, что у мира (`gunBlock`), и склад — книгой запасов
 * слепка с неоплаченными работами на стене (`gunShort`). Платит клиент, увидев требушет в окне (`contract.warGunId`).
 */
function defendGun(file: WarFile, w: WarRow, key: string, machine: MachineId, now: number, ctx: OrderCtx): string | null {
  if (!w.camp || w.phase !== 'camp') return 'Лагеря под стенами уже нет.';
  if (machine !== 'trebuchet') return 'На стену ставят только требушет.';
  const why = gunBlock(w.camp as SiegeWindow, now);
  if (why) return why;
  const s = ctx.sheet(key);
  if (!s) return 'Вести о городе ещё не дошли до края. Подожди минуту.';
  const short = gunShort(w, liveSheet(file, key, s, now));
  if (short) return short;
  w.camp = { ...w.camp, guns: gunAfter(w.camp as SiegeWindow, now) as WarCamp['guns'] };
  return null;
}

/**
 * Вылазка на пост кольца блокады (Р-5): вышедшие из ворот бьются с постом — четвертью лагеря (`blockade.BREAKOUT_SHARE`) — в
 * поле, той же дверью, что вылазка на машину (`fights.machineFight`). Победа размыкает кольцо; лагерь стоит.
 */
function breakout(w: WarRow, at: number, sheet: WarSheet, troops: Counts): string | null {
  const camp = w.camp;
  if (!camp) return 'Лагеря уже нет.';
  const n = w.battles.length;
  const side = campSide(w, at);
  const { input, field } = machineFight({
    seed: warSeed(w.id, n),
    guard: { kinds: guardKinds(side.kinds, BREAKOUT_SHARE), resolve: side.resolve, pips: side.pips, flanks: side.flanks, rest: side.rest, scars: side.scars },
    sortie: { kinds: kindsOf(asTroops(troops)), rest: garrisonRest(w, sheet, at) },
    resolve: sheet.resolve,
    pips: sheet.pips as Pips,
    ...flanksField(sheet.flanks),
    ...spiritField(sheet.spirit),
    ...scarSide(sheet.scars),
    where: warWhere(w),
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
    breakout: true,
    ...craftOf(w),

    // Метки боя (ДР-4): вышли из ворот — город, охрана — поход.
    ...marksOf(field, { attacker: { role: 'def', gen: sheet.scarGen }, defender: { role: 'atk', gen: w.army.scarGen } }),
  });
  // Дрался пост, а не весь лагерь: убыль — его потери, мораль лагеря прежняя.
  w.army = { ...w.army, troops: minus(w.army.troops, atkLost) };
  if (troopTotal(asTroops(w.army.troops)) <= 0) {
    turnBack(w, at, w.to, 'lifted');
    return null;
  }
  const after = { ...sheet, home: minus(sheet.home, homeLost) };
  setCamp(w, campWindow(w, at, after, w.camp as WarCamp));
  ringCheck(w, at, after, field.won ? 'sortie' : undefined);
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
  // Минута голода — прогноз для сведения и сроков (ОС-1): шаг осады, в котором склад окна не оплатит прокорм. Город сдаёт
  // голодом только сам шаг (`phaseStep`), а не эта отметка. Склад не опустеет — отметки нет.
  const step = hungerStepAt(siegeSince(camp as SiegeWindow), starvesAt(camp as SiegeWindow));
  if (Number.isFinite(step)) w.starvesAt = Math.round(step);
  else delete w.starvesAt;
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
  // Хлеб — склад (ОС-1): опись новее окна называет подтверждённый хлеб (книга запасов), и окно встаёт на него — хлеб,
  // пришедший в город (караван, весть, промысел), прокорм оплачивает. Допуск — тот же, что у шага: ровно ноль не голод.
  const fresh = bookedSheet(file, w.def, s, s.at).food;
  const ledger = breadAt(camp as SiegeWindow, s.at) * pace;
  const moved = Math.abs(fresh - Math.max(0, ledger)) > Math.max(BREAD_SLACK_MIN, BREAD_SLACK * Math.max(0, ledger));
  if (troopTotal(asTroops(live.home)) === camp.garrisonAtStart && !moved) return false;
  setCamp(w, campWindow(w, s.at, live, camp, undefined, moved ? fresh : undefined));
  // Гарнизон сменился — держит ли кольцо мощь лагеря (Р-5).
  ringCheck(w, s.at, live);
  return true;
}

/** Лагерь в родах боя — кто в нём стоит. */
const campSide = (w: WarRow, at: number) => ({
  // Башня города бьёт по лагерю: в бою те, кого обстрел не выбил (`bombard.thinAt`).
  kinds: thinned(kindsOf(asTroops(w.army.troops)), thinOf(w, at)),
  resolve: w.army.resolve,
  pips: w.army.pips as Pips,
  flanks: flanksField(w.army.flanks).flanks,
  rest: armyRest(w.army, at),
  ...spiritField(w.army.spirit),
  // Черты армии похода (ДР-4) — поставленные сервером в минуту приказа (`ruleArmy`).
  ...scarSide(w.army.scars),
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
    ...flanksField(hit.rear ? hit.rear.flanks : sheet.flanks),
    // Дух — чьё войско бьёт: гарнизон и дружина одного города, дух у них один.
    ...spiritField(hit.rear ? hit.rear.spirit : sheet.spirit),
    // Черты армии (ДР-4) — того же войска: у дружины с поля — поставленные в минуту приказа, у вылазки — книги в слепке.
    ...scarSide(hit.rear ? hit.rear.scars : sheet.scars),
    where: warWhere(w),
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
    // Метки боя (ДР-4): бил город — его метка, выручка — союзника; лагерь — похода.
    ...marksOf(field, {
      attacker: { role: hit.ally ? 'ally' : 'def', gen: hit.rear ? hit.rear.scarGen : sheet.scarGen },
      defender: { role: 'atk', gen: w.army.scarGen },
    }),
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
  const after = { ...sheet, home: minus(sheet.home, homeLost) };
  setCamp(w, campWindow(w, at, after, camp));
  // Кольцо блокады после боя (Р-5): удар с поля (полководец города, выручка) его размыкает, вылазка — если мощи не хватает.
  ringCheck(w, at, after, hit.rear ? 'relief' : undefined);
  return null;
}

// ------------------------------------------------ перехват в поле (ПЛ-1) ---

/** Где перехватчик в минуту `at` на своём отрезке к точке встречи. */
const chaserAt = (m: WarMeet, at: number): { x: number; y: number } => positionAt({ from: m.from, to: m.spot, departAt: m.go, arriveAt: m.at }, at);

const cell = (p: { x: number; y: number }): { x: number; y: number } => ({ x: Math.round(p.x), y: Math.round(p.y) });

/**
 * Поход сменил путь — повернул домой, сменил режим, встал лагерем, кончился (ПЛ-1): встреча каждого перехвата считается
 * заново той же функцией (`pvpmeet.warMeet`) с того места, где перехватчик в эту минуту. Не догнать — перехват сорвался: дружина
 * цела и стоит в поле (`WarMissed`), донесение и путь домой — у её мира.
 */
function rechase(w: WarRow, at: number): void {
  if (!w.meets?.length) return;
  const keep: WarMeet[] = [];
  for (const m of w.meets) {
    const here = chaserAt(m, at);
    const next = warMeet(here, readGait(m.gait), w, at, pace);
    if (!next) {
      w.missed = [...(w.missed ?? []), { castle: m.castle, ...(m.ally ? { ally: true as const } : {}), at, spot: cell(here), men: men(m.army.troops) }];
      continue;
    }
    keep.push({ ...m, go: at, from: here, spot: next.at, at: Math.max(at, Math.round(next.time)) });
  }
  if (keep.length) w.meets = keep;
  else delete w.meets;
}

/** Войско перехватчика в родах боя: всё, что сервер поставил ему в минуту приказа (`ruleArmy`). */
const meetSide = (a: WarArmy, at: number): MeetSide => ({
  kinds: kindsOf(asTroops(a.troops)),
  resolve: a.resolve,
  pips: a.pips as Pips,
  ...flanksField(a.flanks),
  rest: armyRest(a, at),
  ...spiritField(a.spirit),
  ...scarSide(a.scars),
});

/**
 * Бой в поле в минуту встречи (ПЛ-1): нападает перехватчик, поход обороняется — ядром боя дверью `fights.meetFight`, с
 * составом обеих сторон по книгам сервера (дух, дисциплина, черты, командиры, отметки — как в войне). Разбит поход по пути
 * к цели — отходит домой с остатком от клетки встречи (`turnBack`, конец «отбит»); по пути домой — добычу его падения
 * отбивает победитель (`WarBattle.regain`), поход идёт домой дальше. Перехватчик отбит — поход идёт дальше с потерями и
 * усталостью; остаток дружины стоит в поле, домой его ведёт его мир.
 */
function meetBattle(file: WarFile, w: WarRow, m: WarMeet): void {
  const left = (w.meets ?? []).filter((x) => x !== m);
  if (left.length) w.meets = left;
  else delete w.meets;
  // Налегке — истощение пути до минуты встречи (ДР-2): в бой идут дошедшие.
  wearLight(w, m.at);
  const back = w.phase === 'back';
  const n = w.battles.length;
  const spot = cell(m.spot);
  const { input, field } = meetFight({
    seed: warSeed(w.id, n),
    chaser: meetSide(m.army, m.at),
    march: { ...campSide(w, m.at), kinds: kindsOf(asTroops(w.army.troops)) },
    // Земля клетки встречи — та, на которую шагнул перехватчик (бой на воде — переправа), по земле пути войны.
    ground: groundAt(WAR_GROUND_SEED, spot, cell(m.from)),
    where: scarWhere(placeAt(WAR_GROUND_SEED, spot.x, spot.y)),
  });
  const genLost = field.result ? (troopLosses(asTroops(m.army.troops), field.result.sides.attacker.losses) as Counts) : {};
  const atkLost = field.result ? (troopLosses(asTroops(w.army.troops), field.result.sides.defender.losses) as Counts) : {};
  // Добыча падения — в обозе похода, идущего домой: победитель боя её отбивает целиком (MAP-9, как у набега логова). Отбить
  // её можно один раз: дважды одной добычи в обозе нет.
  const regain = field.won && back && w.fall && !w.battles.some((b) => b.regain) ? goodsOf(w.fall.taken) : null;
  const battle: WarBattle = {
    id: `${w.id}.${n}`,
    at: m.at,
    site: 'field',
    by: 'def',
    input: input as WarBattle['input'],
    won: field.won,
    atkTroops: { ...w.army.troops },
    atkLost,
    homeTroops: {},
    homeLost: {},
    genTroops: { ...m.army.troops },
    genLost,
    spot,
    ...(m.ally ? { ally: m.castle } : {}),
    ...(regain ? { regain } : {}),
    ...marksOf(field, {
      attacker: { role: m.ally ? 'ally' : 'def', gen: m.army.scarGen },
      defender: { role: 'atk', gen: w.army.scarGen },
    }),
  };
  w.battles.push(battle);
  w.army = wear(w.army, atkLost, field.rest.defender, m.at);
  // Дружина перехватчика легла вся — потолка энергии нет: на его месте может стоять новый полководец (как у удара).
  const key = m.ally ? w.allies?.[m.castle]?.key : w.def;
  if (key) unmarkBeaten(file, w, key, m.at);
  const here = warSpotAt(w, m.at);
  const gone = troopTotal(asTroops(w.army.troops)) <= 0;
  if (back && gone) {
    // Обоз, идущий домой, лёг весь: война кончена на месте, а чем она кончилась у стен (взят, отбит, отозван) — остаётся.
    wearLight(w, m.at);
    w.phase = 'done';
    rechase(w, m.at);
  } else if (gone || (field.won && !back)) turnBack(w, m.at, here, 'beaten');
  else rechase(w, m.at);
}

/** Припасы и казна добычи, без нулей. */
function goodsOf(c: Counts): Counts | null {
  const out: Counts = {};
  for (const [k, v] of Object.entries(c)) if ((v ?? 0) > 0) out[k] = Math.floor(v ?? 0);
  return Object.keys(out).length ? out : null;
}

/** Ближайший перехват похода, до которого дошло время и который случится не позже конца нынешнего пути. */
function dueMeet(w: WarRow, now: number): WarMeet | null {
  if (!w.meets?.length || (w.phase !== 'march' && w.phase !== 'back')) return null;
  const end = w.phase === 'march' ? w.arriveAt : (w.backAt ?? Infinity);
  let first: WarMeet | null = null;
  for (const m of w.meets) if (!first || m.at < first.at) first = m;
  return first && first.at <= now && first.at <= end ? first : null;
}

/** Отрезок от точки до прямой пути войны: точка встречи, названная приказом, лежит на пути похода (тот же отрезок туда и домой). */
function offPath(w: WarRow, p: { x: number; y: number }): number {
  const ax = w.from.x;
  const ay = w.from.y;
  const dx = w.to.x - ax;
  const dy = w.to.y - ay;
  const l2 = dx * dx + dy * dy;
  const k = l2 > 0 ? Math.min(1, Math.max(0, ((p.x - ax) * dx + (p.y - ay) * dy) / l2)) : 0;
  return Math.hypot(p.x - (ax + dx * k), p.y - (ay + dy * k));
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
  const sheetOf = (w: WarRow, at: number): WarSheet | null => defSheet(file, w, at, sheets.get(w.def));
  /** Одно событие войны `w` не позже `now`: было — true. */
  const step = (w: WarRow): boolean => {
    // Перехват в поле (ПЛ-1) — раньше прихода и возврата: встреча в ту же минуту, что приход, — сперва бой в поле.
    const met = dueMeet(w, now);
    if (met) {
      changed = true;
      meetBattle(file, w, met);
      return true;
    }
    if (w.phase === 'march' && w.arriveAt <= now) {
      changed = true;
      // Налегке — истощение пути до минуты прихода (ДР-2): к стене подходят те, кто дошёл.
      wearLight(w, w.arriveAt);
      const sheet = sheetOf(w, w.arriveAt);
      if (!sheet) {
        turnBack(w, w.arriveAt, w.to, 'gone');
        return true;
      }
      if (w.mode === 'storm') {
        const { won } = storm(w, w.arriveAt, sheet);
        if (won) fall(w, w.arriveAt, sheet, 'storm');
        turnBack(w, w.arriveAt, w.to, won ? 'taken' : 'beaten');
      } else {
        w.phase = 'camp';
        setCamp(w, campWindow(w, w.arriveAt, sheet, null));
        // Поход «Блокада» (Р-5): кольцо — в минуту постановки, если мощи вчетверо; нет — обычная осада.
        if (w.ring && w.camp && blockadeBlock(w.camp as SiegeWindow, w.arriveAt, campPower(w, w.arriveAt), garrisonPower(sheet)) === null) {
          w.camp = { ...w.camp, ...blockadeAfter(w.camp as SiegeWindow, w.arriveAt, true) } as WarCamp;
        }
        // Лагерь — полудом: энергия полководца копится залпом за фазу (ответ владельца 3, docs/siege_v2.md, 8.4).
        w.army = { ...w.army, energy: remark(w.army.energy, w.arriveAt, 'camp') };
        // Поход встал лагерем раньше встречи (ПЛ-1): в поле его уже не перехватить — по лагерю бьют ударом.
        rechase(w, w.arriveAt);
      }
      return true;
    }
    if (w.phase === 'camp') {
      // Голодом город сдаёт шаг осады (ОС-1, `phaseStep`), а не отметка прогноза: событий у лагеря три — удар, выручка, фаза.
      // Выручка союзника — тот же удар с тыла, что у полководца города, в минуту своего прихода (раздел 5).
      let relief: WarRelief | null = null;
      for (const r of w.reliefs ?? []) if (!relief || r.at < relief.at) relief = r;
      const strikeAt = Math.min(w.strike?.at ?? Infinity, relief?.at ?? Infinity);
      const phaseAt = w.camp ? nextRollAt(w.camp as SiegeWindow) : Infinity;
      const fresh = sheets.get(w.def);
      if (fresh && regarrison(file, w, fresh, Math.min(strikeAt, phaseAt, now + 1))) {
        changed = true;
        return true;
      }
      const next = Math.min(strikeAt, phaseAt);
      if (next > now) return false;
      changed = true;
      const sheet = sheetOf(w, next);
      if (!sheet) {
        turnBack(w, next, w.to, 'gone');
        return true;
      }
      if (strikeAt <= phaseAt && w.strike && w.strike.at === strikeAt) {
        const s = w.strike;
        delete w.strike;
        hitCamp(w, s.at, sheet, { rear: s.army, front: s.joint ? sheet.home : undefined, site: s.joint ? 'joint' : 'camp' });
        unmarkBeaten(file, w, w.def, s.at);
        return true;
      }
      if (strikeAt <= phaseAt && relief) {
        w.reliefs = (w.reliefs ?? []).filter((r) => r !== relief);
        if (!w.reliefs.length) delete w.reliefs;
        hitCamp(w, relief.at, sheet, { rear: relief.army, site: 'camp', ally: relief.castle, city: cityOr(relief.city) });
        const ally = w.allies?.[relief.castle]?.key;
        if (ally) unmarkBeaten(file, w, ally, relief.at);
        return true;
      }
      const atk = sheets.get(w.atk);
      phaseStep(w, phaseAt, sheet, atk ? atk.sheet.food <= 0 : false);
      return true;
    }
    if (w.phase === 'back' && (w.backAt ?? 0) <= now) {
      changed = true;
      // Налегке — истощение обратного пути до минуты возврата (ДР-2): домой входят те, кто дошёл.
      wearLight(w, w.backAt ?? now);
      delete w.wornAt;
      w.phase = 'done';
      rechase(w, w.backAt ?? now);
      return true;
    }
    return false;
  };
  for (const w of file.wars) {
    // Осады вольных замков (ПН-10) — ниже, по времени событий через все войны одного замка.
    if (w.npc) continue;
    // Фаз за долгий простой бывает много: каждая — одно событие очереди.
    for (let guard = 0; guard < 64; guard++) if (!step(w)) break;
  }
  if (advanceFree(file, now, step)) changed = true;
  if (advanceSpies(file, now, sheets)) changed = true;
  if (expireOffers(file, now)) changed = true;
  if (endPacts(file, now)) changed = true;
  return changed;
}

/** Убрать давно кончившиеся и лишние сверх потолка — самые старые первыми. */
export function pruneWars(file: WarFile, now: number): void {
  const was = file.wars;
  file.wars = file.wars.filter((w) => active(w) || now - (w.endAt ?? w.sentAt) <= WAR_KEEP_MS);
  if (file.wars.length > WAR_MAX) {
    const keep = file.wars.filter(active);
    // Мест под закончившиеся нет — не остаётся ни одной: `slice(-0)` — это весь список (BTL-8).
    const room = Math.max(0, WAR_MAX - keep.length);
    const done = room > 0 ? file.wars.filter((w) => !active(w)).slice(-room) : [];
    file.wars = file.wars.filter((w) => keep.includes(w) || done.includes(w));
  }
  if (file.spies) {
    const keep = file.spies.filter((x) => x.phase !== 'done' || now - (x.endAt ?? x.sentAt) <= WAR_KEEP_MS).slice(-WAR_MAX);
    if (keep.length !== file.spies.length) file.spies = keep;
  }
  if (file.gens) {
    const gens = Object.fromEntries(Object.entries(file.gens).filter(([, m]) => now - m.at <= ENERGY_FILL));
    if (Object.keys(gens).length) file.gens = gens;
    else delete file.gens;
  }
  if (file.dealt) {
    const keep = file.dealt.filter((x) => now - x.endAt <= DEALT_KEEP_MS).slice(-WAR_MAX);
    if (keep.length === 0) delete file.dealt;
    else if (keep.length !== file.dealt.length) file.dealt = keep;
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
  forged?: (text: string, kind?: 'forged' | 'walk') => void;
  /** Путь меча открыт игроку (`roamflag.roamOpenFor`): только тогда отряд ходит на вольный замок (ПН-10). Нет поля — закрыт. */
  roamOpen?: boolean;
}

/**
 * Срок пути удара и выручки (docs/security.md, ЗЩ-2): клиент называет, откуда идёт полководец (`from`) и сколько идти
 * (`walkMs`); сервер берёт срок не короче пути по самой быстрой клетке земли (`pvp.fieldWalkFloorMs`), а место — не
 * дальше, чем полководец мог уйти со своего места в последнем слепке обороны (`WarSheet.gen`, `pvp.fieldReach`).
 * Невозможное — отказ словами и флаг «срок пути» (`OrderCtx.forged`). Честный срок — по ландшафту личной карты, и он
 * не короче пола: ландшафт не бывает быстрее самой быстрой клетки. Возвращает отказ или срок, мс мира.
 */
function walkOf(order: { from: { x: number; y: number }; walkMs: number; gait?: Gait }, to: { x: number; y: number }, s: SheetAt, now: number, ctx: OrderCtx): string | number {
  const far = fromWhy(order.from, s, now, ctx, 'Удар');
  if (far) return far;
  // Пол — в режиме марша, названном приказом (ДР-2, М9): налегке быстрее, и пол у него свой; назвать «налегке» — значит и
  // идти с его истощением (его считает сервер сам, `roadArmy`, ДР-5).
  const floor = fieldWalkFloorMs(order.from, to, order.gait);
  // Миллисекунда — округление: клиент и сервер переводят одну и ту же дорогу в мс одной формулой.
  if (order.walkMs + 1 < floor) {
    ctx.forged?.(`Срок пути удара полководца ${Math.round(order.walkMs / 1000)} с (${gaitName(order.gait).toLowerCase()}), а от клетки ${spot(order.from)} до цели ${distance(order.from, to).toFixed(1)} кл. — не меньше ${Math.round(floor / 1000)} с.`, 'walk');
    return 'Так быстро полководцу не дойти. Обнови игру и попробуй снова.';
  }
  return Math.max(order.walkMs, floor);
}

const spot = (p: { x: number; y: number }): string => `${Math.round(p.x)}:${Math.round(p.y)}`;

/**
 * Откуда выходит полководец из поля — не дальше, чем он мог уйти со своего места в последнем слепке обороны (`WarSheet.gen`,
 * `pvp.fieldReach`; docs/security.md, ЗЩ-2). Одна проверка у удара, выручки и перехвата (ПЛ-1).
 */
function fromWhy(from: { x: number; y: number }, s: SheetAt, now: number, ctx: OrderCtx, deed: string): string | null {
  const gen = s.sheet.gen;
  if (!gen) return null;
  const went = distance(gen, from);
  const reach = fieldReach(now - s.at);
  if (went <= reach) return null;
  ctx.forged?.(`${deed} полководца из клетки ${spot(from)}, а в слепке обороны он стоял в ${spot(gen)}: ${went.toFixed(1)} кл. за ${Math.round((now - s.at) / 1000)} с, дойти мог не дальше ${reach.toFixed(1)} кл.`, 'walk');
  return 'Полководец не мог оказаться там так быстро. Обнови игру и попробуй снова.';
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
      // Обратный путь — по уже пройденному: развернулись там, где шли. После смены режима (ДР-2) пройденное — не время с
      // выхода, а путь от места поворота нынешним режимом.
      const at = marchSpot(w, now);
      wearLight(w, now);
      w.end = 'recalled';
      w.endAt = now;
      w.phase = 'back';
      w.backFrom = at;
      w.backAt = now + (w.legAt !== undefined ? walk(at, w.from, readGait(w.gait)) : Math.max(0, now - w.sentAt));
      delete w.legFrom;
      delete w.legAt;
      homeward(w, now, w.backAt);
      // Отозванный поход идёт домой — перехват за ним, если догонит (ПЛ-1).
      rechase(w, now);
      return null;
    }
    case 'gait':
      return gaitOrder(file, key, order.id, order.gait, now);
    case 'retreat': {
      const w = theirs(file, order.id, key, 'atk');
      if (!w || w.phase !== 'camp') return 'Лагеря уже нет.';
      turnBack(w, now, w.to, 'retreat');
      return null;
    }
    case 'storm': {
      const w = theirs(file, order.id, key, 'atk');
      if (!w || w.phase !== 'camp') return 'Лагеря уже нет.';
      const s = w.npc ? null : ctx.sheet(w.def);
      if (!s && !w.npc) {
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
      const sheet = defSheet(file, w, now, s) as WarSheet;
      stormCamp(w, now, sheet, w.camp ? stormMachines(w.camp as SiegeWindow, now, order.machines) : []);
      seizeFree(file, w);
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
      // Требушет на стене (Р-5): тот же приказ у осаждённого — машина строится в городе, со склада, ценой починки пролома.
      const def = theirs(file, order.id, key, 'def');
      if (def) return defendGun(file, def, key, order.machine, now, ctx);
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
    case 'aim': {
      // Цель артиллерии (Р-5): у осаждающего — его машины лагеря, у осаждённого — требушет на стене; сторону решает ключ.
      const atk = theirs(file, order.id, key, 'atk');
      const def = atk ? null : theirs(file, order.id, key, 'def');
      const w = atk ?? def;
      if (!w || w.phase !== 'camp' || !w.camp) return 'Лагеря уже нет.';
      const camp = w.camp as SiegeWindow;
      if (atk) {
        if (!ARTILLERY_AIMS.includes(order.aim as ArtilleryAim)) return 'Такой цели нет.';
        const why = artilleryAimBlock(camp, order.aim as ArtilleryAim, now);
        if (why) return why;
      } else {
        if (!GUN_AIMS.includes(order.aim as GunAim)) return 'Такой цели нет.';
        const why = gunAimBlock(camp, order.aim as GunAim, now);
        if (why) return why;
      }
      w.camp = { ...w.camp, log: [...(w.camp.log ?? []), { at: now, act: atk ? 'aim' : 'gunAim', aim: order.aim }] };
      return null;
    }
    case 'blockade': {
      // Кольцо блокады (Р-5, `world/blockade`): замкнуть — лагерь вчетверо мощнее гарнизона слепка, кольцо не прорвано в этой
      // фазе; разомкнуть — когда угодно. Мощь — книгой войска (`liveSheet`), лагерь — без выбитых башней.
      const w = theirs(file, order.id, key, 'atk');
      if (!w || w.phase !== 'camp' || !w.camp) return 'Лагеря уже нет.';
      const camp = w.camp as SiegeWindow;
      if (!order.on) {
        if (!blockadeAt(camp, now)) return 'Кольцо и так разомкнуто.';
        w.camp = { ...w.camp, ...blockadeAfter(camp, now, false, 'order') } as WarCamp;
        return null;
      }
      const sheet = defSheet(file, w, now, w.npc ? null : ctx.sheet(w.def));
      if (!sheet) return 'Вести о городе ещё не дошли до края. Подожди минуту.';
      const why = blockadeBlock(camp, now, campPower(w, now), garrisonPower(sheet));
      if (why) return why;
      w.camp = { ...w.camp, ...blockadeAfter(camp, now, true) } as WarCamp;
      return null;
    }
    case 'breakout': {
      const w = theirs(file, order.id, key, 'def');
      if (!w || w.phase !== 'camp' || !w.camp) return 'Лагеря под стенами уже нет.';
      if (!blockadeAt(w.camp as SiegeWindow, now)) return 'Кольца нет — прорывать нечего.';
      const s = ctx.sheet(key);
      if (!s) return 'Вести о городе ещё не дошли до края. Подожди минуту.';
      const sheet = liveSheet(file, key, s, now);
      if (troopTotal(asTroops(order.troops)) <= 0) return 'Некого вывести на вылазку.';
      const short = enough(order.troops, claimedSheet(file, key, s, now).home, sheet.home, 'в гарнизоне', ctx);
      if (short) return short;
      return breakout(w, now, sheet, order.troops);
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
      // Вольный замок берут только мечом (решение В6): сдачи на условиях нет — интерфейс бродяги такой кнопки не показывает.
      if (w.npc) {
        ctx.forged?.('Условия сдачи вольному замку: его берут только мечом, интерфейс такого приказа не шлёт.');
        return 'Вольный замок не сдаётся на условиях: его берут только мечом.';
      }
      const camp = w.camp as SiegeWindow;
      const why = offerBlock(camp, order.kind, now) ?? (order.kind === 'terms' ? termsBlock(w.fate, order.fate) : null);
      if (why) return why;
      const s = ctx.sheet(w.def);
      if (!s) return 'Вести о городе ещё не дошли до края. Подожди минуту.';
      // Дань — справедливая, сбавленная красноречием дипломата осаждённого по книге агентов сервера (АГ-1, `parley.tributeAsk`).
      const price = order.kind === 'tribute' ? tributeAsk(fairOf(w, now, liveSheet(file, w.def, s, now)), s.agents?.eloquence ?? 0) : 0;
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
      if (!pacted(file, key, w.def, now)) return 'На выручку идут только к союзнику по пакту.';
      const me = castleIdOf(key);
      if (w.reliefs?.some((r) => r.castle === me)) return 'Наша дружина уже идёт на выручку.';
      const busy = generalBusy(file, key);
      if (busy) return busy;
      const s = ctx.sheet(key);
      if (!s) return 'Вести о твоём городе ещё не дошли до края. Подожди минуту.';
      if (troopTotal(asTroops(order.army.troops)) <= 0) return 'У полководца нет отряда.';
      const short = enough(order.army.troops, claimedSheet(file, key, s, now).army, liveSheet(file, key, s, now).army, 'в отряде', ctx);
      if (short) return short;
      const walkMs = walkOf(order, w.to, s, now, ctx);
      if (typeof walkMs === 'string') return walkMs;
      const have = Math.min(energyAt(order.army.energy, now), generalCap(file, key, now));
      const tired = energyBlock(have, priceOf('strike'), walkMs, gaitSpeed(order.gait));
      if (tired) return tired;
      const at = now + Math.round(walkMs / pace);
      if (at >= (w.starvesAt ?? Infinity)) return 'Не успеть: хлеб в городе кончится раньше.';
      const came = roadArmy(w, me, 'relief', order, walkMs, now);
      if (typeof came === 'string') return came;
      w.reliefs = [...(w.reliefs ?? []), { castle: me, city: cityOr(ctx.roster.rows[key]?.city), sent: now, at, army: ruleArmy(came, s, file, key), ...gaitField(order.gait) }];
      markGeneral(file, key, have, now);
      // Ключ союзника — для вестей ему о его выручке (19.2); наружу не уходит.
      w.allies = { ...(w.allies ?? {}), [me]: { key, city: cityOr(ctx.roster.rows[key]?.city) } };
      return null;
    }
    case 'intercept':
      return interceptOrder(file, key, order, now, ctx);
    case 'pact':
      return pactOrder(file, key, order.target, now, ctx);
    case 'unpact':
      return unpactOrder(file, key, order.target, now);
    case 'deal':
      return dealOrder(file, key, order.id, order.act, now, ctx);
    case 'strike': {
      const w = theirs(file, order.id, key, 'def');
      if (!w || w.phase !== 'camp') return 'Лагеря под стенами уже нет.';
      // Полководец один: ведёт свой поход, идёт на выручку или уже бьёт этот лагерь — второго дела нет (BTL-2).
      const busy = generalBusy(file, key);
      if (busy) return busy;
      const s = ctx.sheet(key);
      if (!s) return 'Вести о городе ещё не дошли до края. Подожди минуту.';
      if (troopTotal(asTroops(order.army.troops)) <= 0) return 'У полководца нет отряда.';
      const short = enough(order.army.troops, claimedSheet(file, key, s, now).army, liveSheet(file, key, s, now).army, 'в отряде', ctx);
      if (short) return short;
      // Удар — бой: энергии на него должно хватить к минуте прихода, с дорогой по карте (`world/energy`). Отметка — из
      // приказа, но не выше того, что сервер знает о полководце сам (`generalCap`). Срок пути — не короче расстояния при
      // скорости полководца, место — не дальше, чем он мог уйти со слепка (`walkOf`, docs/security.md, ЗЩ-2).
      const walkMs = walkOf(order, w.to, s, now, ctx);
      if (typeof walkMs === 'string') return walkMs;
      const have = Math.min(energyAt(order.army.energy, now), generalCap(file, key, now));
      const tired = energyBlock(have, priceOf('strike'), walkMs, gaitSpeed(order.gait));
      if (tired) return tired;
      const came = roadArmy(w, castleIdOf(key), 'strike', order, walkMs, now);
      if (typeof came === 'string') return came;
      w.strike = { at: now + Math.round(walkMs / pace), army: ruleArmy(came, s, file, key), joint: order.joint, ...gaitField(order.gait) };
      markGeneral(file, key, have, now);
      return null;
    }
  }
}

/**
 * Перехват похода в поле (ПЛ-1, docs/siege_v2.md, «Решения ПЛ-1»). Перехватывает защитник или его союзник по пакту — поход
 * на город и обратный путь; точку и минуту встречи считает сервер (`pvpmeet.warMeet`, земля пути войны), а не клиент. Отряд — не
 * больше книги войска, место выхода — не дальше слепка (`fromWhy`), энергия — к минуте встречи с дорогой. Встреча, которую
 * видел игрок (`meet`), сверяется: точка не на пути похода или срок раньше возможного — отказ и флаг; разошлась иначе
 * (поход сменил путь после меню) — отказ без флага.
 */
function interceptOrder(file: WarFile, key: string, order: Extract<WarOrder, { op: 'intercept' }>, now: number, ctx: OrderCtx): string | null {
  const w = file.wars.find((x) => x.id === order.id) ?? null;
  if (!w || !active(w)) return MEET_GONE;
  if (w.atk === key) return 'Это наш отряд.';
  const ally = w.def !== key;
  if (ally && !pacted(file, key, w.def, now)) return 'Перехватывают поход на свой город или на союзника по пакту.';
  if (w.phase === 'camp') return MEET_CAMP;
  if (w.phase !== 'march' && w.phase !== 'back') return MEET_GONE;
  const busy = generalBusy(file, key);
  if (busy) return busy;
  if (besieged(file, key)) return SIEGE_BLOCK;
  const s = ctx.sheet(key);
  if (!s) return 'Вести о твоём городе ещё не дошли до края. Подожди минуту.';
  if (troopTotal(asTroops(order.army.troops)) <= 0) return 'У полководца нет отряда.';
  const short = enough(order.army.troops, claimedSheet(file, key, s, now).army, liveSheet(file, key, s, now).army, 'в отряде', ctx);
  if (short) return short;
  const far = fromWhy(order.from, s, now, ctx, 'Перехват');
  if (far) return far;
  const gait = readGait(order.gait);
  const meet = warMeet(order.from, gait, w, now, pace);
  if (!meet) return MEET_FAR;
  const at = Math.max(now, Math.round(meet.time));
  if (order.meet) {
    // Встреча, показанная игроку: та же функция у мира. Точка не на пути похода — подделка; срок раньше, чем полководец
    // дошёл бы до неё по самой быстрой земле самым быстрым режимом, — тоже. Остальное расхождение — поход сменил путь.
    const off = offPath(w, order.meet);
    const floor = now + Math.round(fieldWalkFloorMs(order.from, order.meet, 'light') / pace);
    if (off > MEET_SLACK_CELLS || order.meet.at + MEET_SLACK_MS < floor) {
      ctx.forged?.(
        `Перехват с точкой ${spot(order.meet)} к ${new Date(order.meet.at).toISOString()}: от пути похода ${off.toFixed(1)} кл., дойти от ${spot(order.from)} можно не раньше ${new Date(floor).toISOString()}.`,
        'walk',
      );
      return 'Такой встречи быть не может. Обнови игру и попробуй снова.';
    }
    if (Math.abs(order.meet.at - at) > MEET_SLACK_MS || distance(order.meet, meet.at) > MEET_SLACK_CELLS) return MEET_STALE;
  }
  // Энергия перехвата — бой в поле: к минуте встречи с дорогой (как у мира, `LocalWorld.planChase`); дорога — настоящими мс.
  const road = Math.round((at - now) * pace);
  const have = Math.min(energyAt(order.army.energy, now), generalCap(file, key, now));
  const tired = energyBlock(have, priceOf('chase'), road, gaitSpeed(gait));
  if (tired) return tired;
  const me = castleIdOf(key);
  const came = roadArmy(w, me, 'intercept', { army: order.army, from: order.from, walkMs: road, gait }, road, now);
  if (typeof came === 'string') return came;
  const city = cityOr(ctx.roster.rows[key]?.city);
  w.meets = [
    ...(w.meets ?? []),
    {
      castle: me,
      city,
      ...(ally ? { ally: true as const } : {}),
      sent: now,
      go: now,
      from: { x: order.from.x, y: order.from.y },
      spot: meet.at,
      at,
      army: ruleArmy(came, s, file, key),
      ...gaitField(gait),
    },
  ];
  markGeneral(file, key, have, now, 'chase');
  // Ключ союзника — для вестей и счёта его боя (`battleWinner`); наружу не уходит.
  if (ally) w.allies = { ...(w.allies ?? {}), [me]: { key, city } };
  return null;
}

/**
 * Дорога удара и выручки налегке (ДР-5): уход за неё сервер считает сам той же `gait.strikeWorn`, что мир (`LocalWorld.strikeLeg`),
 * — от состава на выходе (приказ, не выше книги войска) за срок пути, сидом из приказа (`gait.strikeSeed`). В бой идут дошедшие;
 * ушедшие ложатся в запись войны (`WarRow.worn`), и книга войска их вычитает. Не налегке — все дошли. Возвращает войско или
 * отказ, если налегке не дойдёт никто.
 */
function roadArmy(w: WarRow, castle: string, op: 'strike' | 'relief' | 'intercept', order: { army: WarArmy; from: { x: number; y: number }; walkMs: number; gait?: Gait }, walkMs: number, now: number): WarArmy | string {
  const { came, lost } = strikeWorn(order.army.troops, order.gait, Math.round(walkMs / pace), strikeSeed(op, w.id, order.from, order.walkMs));
  if (troopTotal(asTroops(lost)) === 0) return order.army;
  if (troopTotal(asTroops(came)) === 0) return 'Налегке отряд растает в пути: до лагеря не дойдёт никто. Возьми обоз или подойди ближе.';
  w.worn = [...(w.worn ?? []), { id: `${w.id}:worn:${op}:${castle}:${now}`, castle, lost }];
  return { ...order.army, troops: came };
}

/**
 * Войско приказа в пределах правил: стойкость и отметки полководца не выше, чем бывает у игрока (`book.ts`); стойкость —
 * сверх обряда ещё Воеводой подтверждённого совета (РТ-1, `SheetAt.marshal`).
 */
const ruleArmy = (a: WarArmy, s: SheetAt | null, file: WarFile, key: string): WarArmy => {
  // Командиры флангов — числами книги командиров сервера (ДР-3): названное приказом не читается, ставит сервер. Черты армии
  // (ДР-4) — так же: книгой черт и метками записи войн в минуту приказа.
  const { flanks: told, scars: claimed, scarGen: claimedGen, ...army } = a;
  void told;
  void claimed;
  void claimedGen;
  return {
    ...army,
    ...scarsField(file, key, s),
    resolve: ruleResolve(a.resolve, s?.marshal ?? 0, s?.knights ?? 0),
    // Дух — не выше потолка книги духа сервера (ДР-1, `book.ruleSpirit`); приказ без духа — без духа.
    ...spiritField(ruleSpirit(a.spirit, s?.spirit)),
    // Отметки полководца — не выше подтверждённого книгой агентов (АГ-1, `agentbook.agentsAt`).
    pips: capPips(rulePips(a.pips), s?.agents?.pips),
    ...flanksField(s?.command?.flanks),
  };
};

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
  // Вольный замок (ПН-10): участи вольного замка, замков гейта у отряда нет; «Занять» — только ему.
  if (isFreeKey(def)) return freeFateBlock(fateId, 'castle');
  const only = freeFateBlock(fateId, 'player');
  if (only) return only;
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
  // Удар и выручка своей войны не ведут — их отметка в `gens`; позже похода — она и есть последнее дело (этап 7, п. 9).
  const field = file.gens?.[key];
  if (field && (!last || field.at >= last.sentAt)) return energyAt(field, now);
  if (!last || !mark || (last.phase === 'done' && last.backAt === undefined)) return ENERGY_MAX;
  return energyAt(mark, now);
}

/**
 * Занят ли полководец (BTL-2, OWNER-DECISIONS п. 9: один полководец — одно действие): ведёт свой поход, его выручка союзнику в
 * пути или его удар по лагерю у своих стен ждёт минуты прихода. Одна проверка у похода, выручки и удара; у мира — та же,
 * `LocalWorld.warGeneralBusy`. Выручка и удар снимаются с записи боем или уходом лагеря — с ними полководец и свободен.
 */
export function generalBusy(file: WarFile, key: string): string | null {
  if (file.wars.some((w) => w.atk === key && active(w))) return GENERAL_MARCHES;
  const me = castleIdOf(key);
  if (file.wars.some((w) => w.reliefs?.some((r) => r.castle === me))) return GENERAL_RELIEVES;
  if (file.wars.some((w) => w.def === key && w.strike)) return GENERAL_STRIKES;
  // Перехват похода в поле (ПЛ-1): свой город или союзник — полководец идёт навстречу, пока не сошлись или след не потерян.
  if (file.wars.some((w) => w.meets?.some((m) => m.castle === me))) return GENERAL_INTERCEPTS;
  return null;
}

function march(file: WarFile, key: string, order: Extract<WarOrder, { op: 'march' }>, now: number, ctx: OrderCtx): string | null {
  // Вольный замок (ПН-10) — поход отряда бродяги, своя дверь: полководца, энергии и защиты слабого у него нет.
  if (isFreeKey(order.target)) return marchFree(file, key, order, now, ctx);
  const own = ctx.roster.rows[key];
  if (!own) return 'Твой город ещё не стоит на карте.';
  const entry = Object.entries(ctx.roster.rows).find(([k]) => castleIdOf(k) === order.target);
  if (!entry) return 'Этого города больше нет в игре.';
  const [def, row] = entry;
  if (def === key) return 'Это твой город.';
  // Пакт (docs/siege_v2.md, раздел 5): на союзника походом не ходят — сначала разорвать; разрыв держит пакт ещё
  // `PACT_BREAK_NOTICE` (АУ-8, п. 1) — одна проверка с кнопкой похода (`proposals.pactWarBlock`).
  const pact = pactRow(file, key, def);
  const pactNo = pact ? pactWarBlock({ state: 'pact', breakAt: pact.breakAt }, now) : null;
  if (pactNo) return pactNo;
  // Регион игрока — правило мира (`theatre.inHomeTheatre`): походы за край не уходят.
  if (!inHomeTheatre(own, row)) return 'Город за пределами твоего края. Походы туда не ходят.';
  const busy = generalBusy(file, key);
  if (busy) return busy;
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
  // Режим марша (ДР-2, М7, М9): налегке лагерь не встаёт — интерфейс такой осады не шлёт, значит это подделка.
  const gait = readGait(order.gait);
  const noCamp = order.mode === 'siege' ? siegeBlockOf(gait) : null;
  if (noCamp) {
    ctx.forged?.(`Поход на осаду налегке: лагерь налегке не ставят, интерфейс такой приказ не шлёт.`);
    return noCamp;
  }
  const from = { x: own.x, y: own.y };
  const to = { x: row.x, y: row.y };
  const walkMs = walk(from, to, gait);
  // Отметка — из приказа, но не выше того, что сервер знает о полководце сам (`generalCap`): вернувшийся из похода
  // не выходит в новый с полным запасом, пока не отдохнёт дома (docs/siege_audit.md, решение 11).
  const have = Math.min(energyAt(order.army.energy, now), generalCap(file, key, now));
  const tired = energyBlock(have, priceOf(order.mode), walkMs, gaitSpeed(gait));
  if (tired) return tired;
  const energy = onRoad(spend({ value: have, at: now, mode: 'hold' }, now, priceOf(order.mode)), now, now + walkMs, false, gaitSpeed(gait));
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
    army: { ...ruleArmy(order.army, mine, file, key), energy },
    went: { ...order.army.troops },
    ...(order.blockade && order.mode === 'siege' ? { ring: true as const } : {}),
    ...gaitField(gait),
    ...(gait === 'light' ? { wornAt: now } : {}),
    battles: [],
  });
  return null;
}

/**
 * Смена режима марша в пути (ДР-2, М6) — та же стоянка и цена, что у мира (`gait.gaitHaltMs`, `ENERGY_PRICE.gait`): войско
 * встаёт на месте, после стоянки идёт дальше новой скоростью. Нельзя в лагере; налегке — у похода на осаду (лагерь налегке не
 * встаёт). Налегке до этой минуты — истощение списано; налегке с неё — отрезок с минуты смены (стоянка в поле — тоже поле).
 */
function gaitOrder(file: WarFile, key: string, id: string, next: Gait, now: number): string | null {
  const w = theirs(file, id, key, 'atk');
  if (!w || (w.phase !== 'march' && w.phase !== 'back')) return w?.phase === 'camp' ? 'В лагере режим марша не меняют.' : 'Отряд уже не в пути.';
  const was = readGait(w.gait);
  if (was === next) return 'Отряд и так идёт этим режимом.';
  if (w.phase === 'march' && w.mode === 'siege') {
    const noCamp = siegeBlockOf(next);
    if (noCamp) return `${noCamp} Поход идёт на осаду.`;
  }
  if ((w.legAt ?? 0) > now) return 'Отряд ещё стоит: обоз не собран.';
  const have = energyAt(w.army.energy, now);
  const tired = energyBlock(have, priceOf('gait'));
  if (tired) return tired;
  const march = w.phase === 'march';
  const spot = march ? marchSpot(w, now) : backSpot(w, now);
  wearLight(w, now);
  const legAt = now + Math.round(gaitHaltMs() / pace);
  const arrive = legAt + walk(spot, march ? w.to : w.from, next);
  w.gait = next === 'normal' ? undefined : next;
  if (w.gait === undefined) delete w.gait;
  if (next === 'light') w.wornAt = now;
  else delete w.wornAt;
  w.legAt = legAt;
  if (march) {
    w.legFrom = spot;
    w.arriveAt = arrive;
  } else {
    w.backFrom = spot;
    w.backAt = arrive;
  }
  w.army = { ...w.army, energy: onRoad(spend(w.army.energy, now, priceOf('gait')), now, arrive, !march, gaitSpeed(next)) };
  // Новый темп и стоянка — новая встреча у каждого перехвата (ПЛ-1).
  rechase(w, now);
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
  // Осада вольного замка (ПН-10): защитник — НПС, вестей ему нет; бродяге — стол в игре (вести пути в Telegram — ПН-18).
  if (w.npc) return [];
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
            // Вылазка на машину — бой за машину, а не за лагерь: слова другие (19.2). На пост кольца — тоже (Р-5).
            ...(b.burn ? { machine: b.burn } : {}),
            ...(b.breakout ? { ring: 'off' as const } : {}),
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
          p: { from: plainName(w.defCity), fate: w.fate, about: b.at, relief: 'fight', won: b.won, ...(b.site === 'field' ? { site: 'field' as const } : {}) },
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
    // Обстрел за фазу (Р-5): осаждённому — постройки, потерявшие уровень, и разбитый требушет на стене; осаждающему — машины,
    // разбитые со стены. Промахи и простой построек молчат: их видно в журнале фаз.
    const lost = (r.shots ?? []).filter((s) => s.hit && s.lost).length;
    const gunBroke = (r.shots ?? []).some((s) => s.hit && s.gun) ? 1 : 0;
    const machinesBroke = (r.gun ?? []).filter((s) => s.hit && s.machine).length;
    for (const role of ['atk', 'def'] as const) {
      const shot = role === 'def' ? { ...(lost ? { lost } : {}), ...(gunBroke ? { broke: gunBroke } : {}) } : machinesBroke ? { broke: machinesBroke } : {};
      const loud = r.out === 'breach' || r.out === 'plague' || Object.keys(shot).length > 0;
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
            ...shot,
          },
        },
      });
    }
  });
  // Кольцо блокады (Р-5): замкнули — осаждённому (город отрезан); разомкнул приказом сам лагерь — осаждённому; мощи мало
  // или ударили с поля — обоим. Прорыв вылазкой — весть боя обоим (`ring` у `war-fight`), второй вести нет. Приказ
  // осаждающего ему самому не пишется.
  const camp = w.camp as SiegeWindow | undefined;
  for (const d of camp ? blockadeDeeds(camp) : []) {
    const at = d.at;
    const k = Math.floor(Math.max(0, at - siegeSince(camp as SiegeWindow)) / SIEGE_PHASE) + 1;
    const to: ('atk' | 'def')[] = d.on || d.why === 'order' ? ['def'] : d.why === 'sortie' ? [] : ['atk', 'def'];
    for (const role of to) {
      out.push({
        player: role === 'atk' ? w.atk : w.def,
        item: {
          key: `war-phase:${w.id}:ring:${at}`,
          kind: 'war-phase',
          fireAt: at,
          until: at + RESULT_KEEP,
          p: { from: from(role), fate: w.fate, about: at, role, phase: 'calm', k, ring: d.on ? 'on' : 'off' },
        },
      });
    }
  }
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
 * Вести о пакте (docs/siege_v2.md, 19.2; ДП-1): предложение — тому, кому предложили, пока оно лежит, с номером: кнопка под
 * вестью ведёт к нему; принятый пакт — тому, кто предлагал. Итоги (ДП-1) — той стороне, которая не действовала сама:
 * отклонённое — предложившему, отозванное — адресату, разорванный союз — другой стороне, вышедший срок — обеим. Выводятся
 * из записи, как вести войны: «один раз» держит разница до и после хода (`newsDiff`). Участи у пакта нет — поле `fate` у
 * вести обязательно, и здесь оно формы ради.
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
        until: Math.min(o.until, o.at + RESULT_KEEP),
        p: { from: plainName(cityOr(o.cities[o.from])), fate: 'plunder', about: o.at, pact: 'offer', deal: o.id },
      },
    });
  }
  for (const d of file.dealt ?? []) {
    const end = d.end;
    if (end === 'yes') continue;
    const to = (player: string, role?: 'atk' | 'def'): void => {
      const other = player === d.from ? d.to : d.from;
      out.push({
        player,
        item: {
          key: `war-pact:${castleIdOf(other)}:${d.endAt}:${end}${role ? `:${role}` : ''}`,
          kind: 'war-pact',
          fireAt: d.endAt,
          until: d.endAt + RESULT_KEEP,
          // Разрыв с отсрочкой (АУ-8, п. 1): `about` — минута конца союза, «держится до 14:40».
          p: { from: plainName(cityOr(d.cities[other])), fate: 'plunder', about: end === 'broken' ? Math.max(d.endAt, d.until) : d.endAt, pact: end, ...(role ? { role } : {}) },
        },
      });
    };
    if (d.end === 'no') to(d.from);
    else if (d.end === 'withdrawn') to(d.to);
    else if (d.end === 'broken') to(d.to);
    else if (d.end === 'expired') {
      to(d.from, 'atk');
      to(d.to, 'def');
    }
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

/** Путь лазутчика между двумя клетками с темпом войны. */
const spyWalk = (from: { x: number; y: number }, to: { x: number; y: number }): number => Math.round(spyWalkMs(from, to) / pace);

const spyActive = (x: SpyRow): boolean => x.phase !== 'done';

/**
 * Лазутчик города дома в минуту `at`: слепок говорит, а свои дела, которых слепок ещё не знал, — поправляют. Гибель раньше
 * слепка в нём уже учтена — на месте павшего новый (BTL-8): прежде павший держал город «без лазутчика дома» всю неделю записи.
 */
function spyHomeAt(file: WarFile, key: string, s: SheetAt, at: number): boolean {
  let home = s.sheet.watch?.home ?? false;
  for (const x of file.spies ?? []) {
    if (x.atk !== key || x.sentAt > at) continue;
    const back = x.phase === 'done' && !x.out?.dead ? (x.endAt ?? x.backAt ?? Infinity) : Infinity;
    if (back <= at) {
      if (back > s.at) home = true;
    } else if (x.out?.dead) {
      if ((x.out.at ?? x.arriveAt) > s.at) home = false;
    } else if (x.phase !== 'done') {
      home = false;
    }
  }
  return home;
}

/** Игровое время в городе в минуту `at` — от слепка (`WarSheet.time`). */
const villageTimeAt = (s: SheetAt, at: number): number => (s.sheet.time ?? 0) + gameSecondsOfMs(Math.max(0, at - s.at));

/**
 * Скрытность своего лазутчика в гибели (множитель): названная слепком, но не ниже, чем у подтверждённого книгой агентов (АГ-1).
 * Книги нет — как назвал слепок (прежнее правило).
 */
const ownVeil = (mine: SheetAt): number => Math.max(mine.sheet.watch?.veil ?? 1, mine.agents?.veil ?? 0);

/** Скрытность своего лазутчика (доля провалов без поимки): названная слепком, но не выше подтверждённой книгой агентов (АГ-1). */
const ownStealth = (mine: SheetAt): number => Math.min(mine.sheet.watch?.stealth ?? 0, mine.agents?.stealth ?? Infinity);

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
  const risk = rivalPeril(rivalPerilCase(ownVeil(mine), villageTimeAt(theirs, at), spyVisits(file, key, def, at), away));
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

/**
 * Приказ лазутчику: числа — на минуту сервера; не те, что видел игрок, — отказ, а не другое дело. Минуту меню (`order.at`)
 * сервер не берёт (BTL-8): прежде приказ шёл по ней, если ей не больше 10 с, и подделанный клиент выбирал в этом окне
 * минуту, когда охрана соседа была слабее. Числа меню меняются только на границах (часть суток, лазутчик соседа ушёл или
 * вернулся, гарнизон), и честный приказ проходит как прежде.
 */
function spyOrder(file: WarFile, key: string, order: Extract<WarOrder, { op: 'spy' }>, now: number, ctx: OrderCtx): string | null {
  const plan = spyPlan(file, key, order.target, now, ctx);
  if (typeof plan === 'string') return plan;
  const opt = plan.options.find((o) => o.deed === order.deed);
  if (!opt) return 'Такого дела нет.';
  if (!opt.can) return opt.reason ?? 'Сейчас нельзя.';
  if (opt.chance !== order.shown.chance || opt.peril !== order.shown.peril) return 'Обстановка у города сменилась. Посмотри дела заново.';
  // Энергия лазутчика — той же дверью, что у похода (`world/energy`): цена дела при выходе, и её должно хватить к
  // минуте прихода, с дорогой; дорога уходит по дням пути, у города — стоит.
  const price = priceOf(order.deed);
  // Отметка — из приказа, но не выше того, что сервер знает о лазутчике сам (`spyCap`, docs/security.md, ЗЩ-2).
  const have = Math.min(energyAt(order.energy, now), spyCap(file, key, now));
  const tired = energyBlock(have, price, plan.walkMs);
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
    energy: onRoad(spend({ value: have, at: now, mode: 'hold' }, now, price), now, now + plan.walkMs, false),
    stealth: ownStealth(plan.mine),
    heldMs: Math.round((SPY_HELD * watch.held) / pace),
    // Сила диверсии — по книге агентов сервера (АГ-1): клиент её не присылает.
    ...((plan.mine.agents?.sabotage ?? 1) > 1 ? { power: plan.mine.agents?.sabotage } : {}),
  };
  file.spies = [...(file.spies ?? []), row];
  return null;
}

/**
 * Потолок энергии лазутчика по тому, что сервер знает о нём сам (docs/security.md, ЗЩ-2) — тем же приёмом, что у
 * полководца (`generalCap`): последнее его дело против соседа — отметка обратного пути (`world/energy.onRoad`), дома
 * копится с минуты возврата. Дел не было, или лазутчик не вернулся (погиб — на его месте новый, свежий) — потолка нет.
 * Дела против логов сервер не видит: у лазутчика может быть меньше, но не больше.
 */
export function spyCap(file: WarFile, key: string, now: number): number {
  let last: SpyRow | null = null;
  for (const x of file.spies ?? []) if (x.atk === key && (!last || x.sentAt >= last.sentAt)) last = x;
  const mark = last?.energy;
  if (!last || !mark || (last.phase === 'done' && last.backAt === undefined)) return ENERGY_MAX;
  return energyAt(mark, now);
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
  const harm = f.ok ? rivalHarm(x.deed, { stock: sheet.stock, gold: sheet.gold, stash: sheet.stash, pop: sheet.pop }, x.power ?? 1) : {};
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
export const spiesOf = (file: WarFile, key: string, since = 0): SpyView[] =>
  (file.spies ?? [])
    // Дело, начатое раньше обнуления партии игрока, — дело прежней партии (`warsOf`, `since`).
    .filter((x) => x.sentAt >= since)
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
