// Мир целиком на клиенте: генерация по сиду плюс своя маленькая симуляция соседей.
// Реализует WorldApi — тот же интерфейс, что потом реализует HttpWorld. Всё, что
// считается здесь (время пути, бой, старение разведки), считается детерминированно,
// чтобы сервер мог повторить расчёт один в один.
import { freshSeed, mixSeed, seeded } from '@/game/sim/random';
import { asGame, gameDaysOfMs, gameSecondsOfMs, realMs, type GameSec } from '@/game/pace';
import { partyNow } from '@/net/clock';
import {
  emptyStack,
  stackTotal,
  type Flanks,
  type Side,
  type Pips,
  type Spirit,
  type Stack,
  type UnitKind,
} from '@/battle';
import { TROOPS_OF_KIND, troopTotal, troopsAfter, type TroopStack } from '@/game/battle/kinds';
import { kindsOf, shareOfKinds, troopLosses, troopPower } from '@/game/battle/price';
import { TROOP_IDS } from '@/game/data/troops';
import { has, own, wholeNonNeg } from '@/game/guard';
import { troopsOfKinds } from '@/game/battle/faces';
import type { BattlePlace } from '@/game/battle/ground';
import type { WorldApi } from '../api';
import type {
  AssaultMode,
  AssaultPlan,
  FlankBattle,
  GaitRow,
  GaitView,
  AttackOrder,
  EnergyCost,
  AttackResult,
  BattleRecord,
  BattleSite,
  AimView,
  BlockadeView,
  CampMelt,
  CampView,
  GunView,
  MachinesView,
  StormMethod,
  CraftOption,
  CardWar,
  CardSack,
  CardSpy,
  RivalDeedId,
  RivalMail,
  RivalMenu,
  CardSiege,
  Coord,
  DealId,
  DealView,
  ErrandId,
  ErrandOption,
  ErrandOrder,
  ErrandTarget,
  DiploActionId,
  DiploRecord,
  DiploView,
  Estimate,
  FallForecast,
  Fate,
  FateOption,
  FellMark,
  FigureId,
  OrderActionId,
  FigureView,
  GateCall,
  HomeEffect,
  Intel,
  IntelReading,
  InterceptPlan,
  LeadPlan,
  Letter,
  LetterAnswerId,
  LetterFrom,
  LetterView,
  Loot,
  MapSiege,
  MarchOrder,
  MarchView,
  OrderOption,
  OrderResult,
  ParleyOrder,
  ParleyView,
  PlayerCastle,
  PlayerProfile,
  Rect,
  RegionChunk,
  Relation,
  Report,
  SendResult,
  SettlementCard,
  SettlementId,
  RevoltView,
  SettlementView,
  SiegeView,
  RestView,
  Regroup,
  StrikePlan,
  Standing,
  TemperId,
  TribeInfo,
  UnitStack,
  WorldInfo,
  WorldPulse,
  DefendOrder,
  ReliefPlan,
  SiegeAnswers,
} from '../types';
import {
  generateWorld,
  isLair,
  lairAnchor,
  makeLair,
  popOf,
  powerOf,
  type GenSettlement,
  type WorldGen,
} from '../gen';
import {
  lairArms,
  lairArmsBase,
  lairGold,
  lairLoot,
  lairPhase,
  lairPop,
  lairRipeness,
  lairPower,
  lairRaid,
  lairRaidWeight,
  lairShield,
  ruinLeft,
  type LairPhase,
  type LairRec,
} from '../lairs';
import {
  clampToWorld,
  coordKey,
  distance,
  formatCoord,
  formatLeft,
  marchPosition,
  secondsLeft,
  marchSeconds,
  rhumbOf,
  terrainAt,
  terrainFactor,
  terrainIndex,
  travelTime,
} from '../geo';
import { FogMap, inSight, type FogData, type SightDisc } from '../fog';
import {
  cityName,
  cityOr,
  spySeenId,
  warFallId,
  warTributeId,
  warRepairId,
  warGunId,
  warShotId,
  warRingId,
  warTurnedId,
  WAR_SEEN_MAX,
  type Counts,
  type SpyMenu,
  type SpyOut,
  type SpyView,
  type WarBattle,
  type WarFall,
  type WarTribute,
  type WarTurned,
  type WarOrder,
  type WarPact,
  type WarSheet,
  type WarView,
} from '../../../netlify/lib/contract';
import { fieldWalkSeconds, foodLeft, reliefCredit, spyWalkMs, warWalkMs } from '../pvp';
import { figureSpeed } from '../data/gait';
import {
  GAITS,
  campFed,
  fedOnRoad,
  gaitHaltMs,
  gaitSpeed,
  gaitHaul,
  lightShare,
  readGait,
  roadLosses,
  siegeBlockOf,
  strikeSeed,
  LIGHT_NO_CAMP,
  type Gait,
} from '../gait';
import { endWords, pactWarBlock, type ProposalAct, type ProposalView } from '../proposals';
import { takingWords } from '../raidwords';
import { realSpan } from '@/game/span';
import { WATCHER, homeSight, liveSight, standing } from '../sight';
import { islandNeighbours } from '../spawn';
import { canShelter, placeOf } from '../shelter';
import { ownGearOf, revealSight, slipped } from '../agents';
import { diesAt, perilOf, perilShare, perilText, perilWhy, routPeril, recentVisits, type PerilCase } from '../peril';
import { buildable, featuresAt } from '../geography';
import { claimsNear, claimsOf, ownerAt, type Claim } from '../territory';
import { DEAL_BY_ID, FIGURE_BY_ID, FIGURE_IDS } from '../data/figures';
import { errandDef, errandsOf, type ErrandDef } from '../data/errands';
import { DIPLO_ACTIONS, DIPLO_ACTION_BY_ID, TEMPER_BY_ID } from '../data/diplomacy';
import { ORDER_AGENT, RIVAL_DEED_BY_ID, SPY_ACTIONS, SPY_ACTION_BY_ID } from '../data/spy';
import {
  guardOf,
  revoltActive,
  revoltPower,
  revoltWindow,
  spyChance,
  spyOutcome,
  spyDeathRoll,
  spySeed,
  SPY_SLIP_TEXT,
} from '../spy';
import { haltElapsed, sackActive, sackLook, sackPower, sackWindow } from '../sack';
import {
  CAMP_BUSY,
  CAMP_LEAVE,
  CHASE_FROM_CAMP,
  FATE_SAME,
  PLAYER_CAMP,
  SIEGE_BLOCK,
  STRIKE_FROM_TOWN,
  GENERAL_RELIEVES,
  GENERAL_STRIKES,
  WOOD_FIXED,
  breadAt,
  breadStock,
  immuneUntil,
  openSiege,
  ourCamp,
  siegeActive,
  siegeImmune,
  siegeSince,
  starvesAt,
  starvesIfRation,
  townEatPerHour,
  townLarder,
  wearSpan,
  type SiegeWindow,
} from '../siege';
import {
  breachesOf,
  breadLeft,
  cleanDefend,
  cleanOrders,
  journalOf,
  nextModsText,
  nextRollAt,
  OUT_NAMES,
  orderRations,
  orderRepairs,
  orderStorms,
  orderVolleys,
  progressOf,
  repairAfter,
  repairBlock,
  repairPending,
  repairsOf,
  rollPhase,
  rollSeed,
  rowsOf,
  hungerStepAt,
  phaseAt,
  softerFate,
  wasteLosses,
  wasteOf,
  type PhaseRow,
  type SiegeOrders,
} from '../siegeroll';
import {
  chanceOf,
  clampAttitude,
  freshRecord,
  moodOf,
  orderSeed,
  raidWeight,
  respond,
  standingAt,
  temperOf,
} from '../diplomacy';
import {
  crowdedOut,
  letterExpired,
  letterOrder,
  letterPause,
  letterUntil,
  pickLetter,
  resolveLetter,
  splitLoot,
  type LetterCandidate,
} from '../letters';
import { LETTER_KIND_BY_ID, goodsText } from '../data/letters';
import { BARBARIAN_NAMES, RELATION_META, stageOf } from '../data/meta';
import { UNIT_IDS, stackCarry, stackEscort, stackSize } from '../data/units';
import {
  FATES,
  FATE_DEFAULT,
  FATE_IDS,
  burnImmuneUntil,
  fallSeed,
  fate,
  fateAt,
  fateBlock,
  asLoss,
  homeLoss,
  plunder,
  winnerGain,
  type FateLocks,
  type FateResult,
} from '../spoils';
import {
  answerAfter,
  botTakesTerms,
  botTakesTribute,
  bountyOf,
  fairTribute,
  tributeAsk,
  lairRansoms,
  liveOffer,
  offerAfter,
  offerBlock,
  offerBy,
  offerUntil,
  offersOf,
  siegeShare,
  termsBlock,
  termsChoices,
  tributeGoods,
  type SiegeOffer,
} from '../parley';
import { FATE_META, gainText, lossText } from '../data/fates';
import { marchSeed, stackAfter, stackLosses, stackPower } from '../combat';
import { aimOf, fireView, firePlan, reaim, thinAt, thinKinds } from '../bombard';
import { CRAFT_ACTS, craftAfter, craftAt, craftBlock, craftCount, craftDone, craftGain, craftMax, craftNote, fortFaces, garrisonWear, type CraftAct } from '../siegecraft';
import { garrisonOf, menOfPower, raidingParty, GARRISON_STYLES } from '../garrison';
import { MIRROR_ON, mirrorPower } from '../mirror';
import type { FaithId, ResourceId } from '@/game/types';
import { RESOURCE_META } from '@/game/constants';
import { recordedField, resolveField, type FieldInput, type FieldOutcome, type FieldSide } from '../battle';
import { FLANKS, FLANK_SECTOR } from '@/game/commandrules';
import { campFight, campHolds, guardKinds, holdMinute, homeLosses, machineFight, wallFight, type CampPartIn, type HoldIn } from '../fights';
import { AIM_NAME, GUN_AIM_NAME, aimBlock, artilleryAimOf as artilleryAim, aimWords, artilleryAt, gunAfter, gunAimBlock, gunAimOf, gunAimWords, gunBlock, gunsAt, idleBuildings, lostLevel, shotsApplied, shotsText } from '../shelling';
import { BUILDING_BY_ID } from '@/game/data/buildings';
import { keptType } from '@/game/merged';
import { BLOCKADE_BREAKS, BLOCKADE_GIVES, BREAKOUT_GIVES, BREAKOUT_SHARE, BREAK_WORDS, blockadeAfter, blockadeAt, blockadeBlock, blockadeBusy, blockadeDeeds, blockadeHolds, blockadeRatio, blockadeSince, ratioWords, ringOdds, type BlockadeBreak } from '../blockade';
import { BLOCKADE_RATIO } from '../data/blockade';
import { phasesToEven, ratioRangeOfCut, ratioWithin, siegeCut, siegeCutOf, starves, type RatioRange } from '../siegefood';
import { CUT_MAX } from '../data/siegefood';
import { SIEGE_PHASE as PHASE_MS } from '../data/siegeroll';
import { AIMS, GUN_AIMS, GUN_SPAN, type Aim } from '../data/shelling';
import { SCALING, openingWords, wallFront, type WallFront } from '../wall';
import {
  GUARD_SHARE,
  MACHINE_NAME,
  MACHINE_USE,
  assaultOf,
  burnBlock,
  burnTargets,
  machineAfter,
  machineBlock,
  machineReady,
  machinesAt,
  machinesNote,
  stormMachines,
} from '../machines';
import { wallRepairCost } from '@/game/build';
import { ARTILLERY_WEIGHT, MACHINE_IDS, MACHINE_SHARES, MACHINE_WOOD, type MachineId } from '../data/machines';
import { carryRest, mixRest, rejoin, restAfter, restAt, restFullAt, restView, type RestPair } from '../rest';
import { emptyAt, energyAt, energyBlock, energyView, freshMark, idleBlock, leftAfter, outOf, priceOf, remark, roadCost, shownEnergy, spend, type EnergyMark, type EnergyMode, type MarkEnds } from '../energy';
import { ENERGY_PRICE, type EnergyAction } from '../data/energy';
import { GATE_FOES, gateReportId } from '../data/gate';
import {
  awayOf,
  fieldTroops,
  postureOf,
  homeOf,
  inTown,
  musterMs,
  BAND_AS_IS,
  NO_BAND_HOME,
  ownOf,
  pickTroops,
  plus,
  roomOf,
  standingShare,
  standingTroops,
  warningMsOf,
  weakest,
} from '../muster';
import {
  WOOD_SHARES,
  machineShare,
  gateBusyFor,
  gateBusyText,
  playerWood,
  rebaseWood,
  refusedAtGate,
  strikeForecast,
  throughText,
  woodShare,
  type Through,
  type WoodPlan,
} from '../works';
import { faithAt, faithAttitude, faithPressure } from '../faith';
import { beyondNote, inHomeTheatre } from '../theatre/theatre';
import { groundAt, placeAt, scarWhere } from '../place';
import { readMark, type FightMark, type ScarSide, type ScarWhere } from '@/game/scarrules';
import { dayPartAt, seasonOf } from '@/game/derived';
import { siegeRecordOf, type SiegeEnd, type SiegeFight, type SiegeRecord } from '../siegerecord';
import { intercept as meetingOf, type Meeting } from '../pursuit';
import { UNKNOWN, estimate, precisionOf, readIntel } from '../intel';
import {
  CASTLE_GOLD_PER_POWER,
  AI_RANGE,
  AI_ATTACK_MAX,
  AI_ATTACK_MIN,
  DAMAGE_RECOVER,
  DEAL_DURATION,
  DEAL_PAYOUT,
  AGENT_DEATH_MORALE,
  AGENT_HELD_MORALE,
  FIGURE_DOWN,
  GENERAL_ROUT_MORALE,
  FIGURE_SCOUT_CATCH,
  FIGURE_SCOUT_COVER,
  PERIL_MEMORY,
  FIGURE_TOUCH,
  FAITH_AROUND,
  MARCH_SIGHT,
  HOSTILITY_ALLY_BREAK,
  HOSTILITY_ENEMY,
  ATTACK_ATTITUDE,
  ATTACK_ATTITUDE_TRIBE,
  AI_BARBARIAN_WEIGHT,
  AI_NEUTRAL_QUIET,
  LAIR_HOME_GAP,
  LAIR_NEAR_CAP,
  LAIR_SETTLE_GAP,
  LAIR_SPAWN_MAX,
  LAIR_SPAWN_MIN,
  AI_WAR_PACE,
  AI_WAR_WEIGHT,
  GIFT_PER_POP,
  PEACE_PER_POP,
  REVENGE_ATTITUDE,
  REVENGE_WARS_MAX,
  REVOLT_POWER_LOSS,
  SPY_BUSY,
  SPY_CAUGHT_ATTITUDE,
  SPY_SLIP_ATTITUDE,
  SPY_HELD,
  SUPPORT_ATTITUDE,
  AI_BONDED_SHARE,
  AI_STASH_SHARE,
  LOOT_PER_POP,
  LOOT_REFILL,
  POWER_GROWTH_CAP,
  RANSOM_SHARE,
  REPORTS_KEPT,
  SCOUT_COVER,
  AI_WAR_MAX,
  AI_WAR_MIN,
  AI_WAR_RANGE,
  AI_WAR_SHARE,
  SIEGE_CHANCE,
  SIEGE_COOLDOWN,
  SIEGE_RELIEF_AT,
  SIEGE_RELIEF_ATTITUDE,
  SIEGE_RELIEF_RANGE,
  SIEGE_RELIEF_SHARE,
  SIEGE_ROUT,
  SIEGE_SORTIE_AT,
  SIEGE_SORTIE_RATIO,
  SIEGE_TOWN_EAT_MAN,
  SUPPORT_STAY,
  FALL_MARK,
  GATE_MORALE_LOST,
  GATE_MORALE_WON,
  TRADE_GOLD_PER_SETTLEMENT,
  TRIBUTE_PER_SETTLEMENT,
  INTEL_ROUGH_SPREAD,
  INTEL_VAGUE_SPREAD,
  WORLD_ORIGIN,
  WORLD_SIZE,
} from '../data/tuning';
import {
  browserStorage,
  createWorldSave,
  parseWorldSave,
  worldSaveJson,
  type SpawnedLair,
  type StoredFigure,
  type StoredMarch,
  type WorldSave,
  type WorldStorage,
} from './state';

export const HOME_ID: SettlementId = 'home';

export interface LocalWorldOptions {
  /** Сид мира. По умолчанию берётся из сохранения, иначе случайный. */
  seed?: number;
  /** Часы мира. По умолчанию — часы партии (`net/clock.partyNow`), те же, что у племени. В тестах подменяются. */
  now?: () => number;
  /** null — не сохранять (тесты). */
  storage?: WorldStorage | null;
  /**
   * Клетка замка игрока, названная общим реестром. Она главнее и сохранения, и
   * сида: на общей карте замок стоит там, где о нём знают соседи. Не названа —
   * играют без сервера, и место ищет то же правило расселения само.
   */
  home?: Coord;
  /**
   * Эпоха мира устройства (`net/era.knownEra`, docs/test_world.md). Сохранение мира другой эпохи не читается — мир
   * собирается заново. Нет — эпоху не сверяют (стенды, отчёты, тесты).
   */
  era?: number;
  /**
   * Замки живых игроков из реестра. Отдаётся функцией, а не списком: реестр
   * приезжает по своему сроку, а мир спрашивает его на каждом пульсе. Про сеть
   * мир при этом по-прежнему не знает ничего — ему приносят строки.
   */
  castles?: () => PlayerCastle[];
  /**
   * Свои войны с сервера (docs/pvp.md) — как реестр: мир про сеть не знает, ему приносят список. Нет —
   * войны между игроками в этой сессии нет (тесты, вне Telegram).
   */
  wars?: () => WarView[];
  /** Был ли ответ сервера о войнах: без него «войны нет» и «ещё не знаем» не различить. */
  warsKnown?: () => boolean;
  /** Пакты с соседями-игроками с сервера (docs/siege_v2.md, раздел 5). Нет — пактов в этой сессии нет. */
  pacts?: () => WarPact[];
  /** Предложения соседей-игроков с сервера (ДП-1): ждущие ответа и итоги. Нет — предложений в этой сессии нет. */
  proposals?: () => ProposalView[];
  /** Дверь приказа войны: null — принят, иначе причина словами. */
  warOrder?: (order: WarOrder) => Promise<string | null>;
  /** Темп войны с сервера (`TRIBE_WAR_PACE`): во сколько раз быстрее походы. Нет — 1. */
  warPace?: () => number;
  /** Дела лазутчиков с сервера (docs/spy_pvp.md): свои и чужие у нас, которые мы видим. Нет — тайной войны нет. */
  spies?: () => SpyView[];
  /** Меню дел против города: шанс и гибель считает сервер. Отказ — строкой. */
  spyLook?: (target: string) => Promise<SpyMenu | string>;
  /**
   * Отдавать всю землю разведанной. Только отладочный обзор мира (`?worldview=open`):
   * в обычной партии мир не отдаёт клиенту того, чего игрок не видел, — иначе
   * туман войны существовал бы только на картинке.
   */
  reveal?: boolean;
}

/** Соль кости гибели разбитого полководца: своё число из сида того же боя. */
/** Дух нашей стороны в приказ и слепок сервера (ДР-1, `WarArmy.spirit`, `WarSheet.spirit`): нет духа — нет поля. */
const spiritField = (v: Spirit | undefined): { spirit?: Spirit } => (v ? { spirit: { morale: v.morale, discipline: v.discipline } } : {});

/** Метка боя нашей стороны `us` в последствие (ДР-4): её кладёт племя в журнал армии (`sim/scars`). Боя не было — поля нет. */
const scarOf = (field: FieldOutcome, us: Side): { scar?: FightMark } => (field.marks ? { scar: field.marks[us] } : {});

/**
 * Метка боя войны нашей роли в последствие (ДР-4, Ш6): её записал сервер (`WarBattle.marks`), племя кладёт как есть, с номером и
 * минутой боя — по ним сервер сверяет журнал. Боя до ДР-4 или нашей армии в бою не было — поля нет.
 */
const warScarOf = (b: WarBattle, role: 'atk' | 'def' | 'ally'): { scar?: FightMark } => {
  const m = b.marks?.[role];
  const read = m ? readMark({ ...m, war: { id: b.id, at: b.at } }) : null;
  return read ? { scar: read } : {};
};

const ROUT_SALT = 0x726f7574;

/** Схватили ли часовые разведчика: первая кость прихода легла ниже доли поимки. */
export const caughtAt = (roll: number, caught: number): boolean => roll < caught;

/**
 * Сколько живут числа, показанные в меню приказа: приказ, отданный позже, считается
 * заново. Меню перечитывается каждым пульсом, так что десяти секунд хватает с запасом.
 */
const SHOWN_FRESH = 10_000;

/** Как часто дипломата хватают во враждебном дворе в минуту прихода. Гибели у него нет — только задержание. */
const ENVOY_SEIZE = 0.3;

/**
 * Как считать строку меню дипломата и лазутчика: у ворот (нет), делом из «Походов» с дорогой до цели (`road`, мс) или в
 * минуту прихода с делом, уже оплаченным приказом (`'paid'`).
 */
type OptionMode = { road: number } | 'paid';

/** Дорога до цели для цены дела: у ворот и на приходе — ноль. */
const roadOf = (mode: OptionMode | undefined): number => (typeof mode === 'object' ? mode.road : 0);

/** Договор с державой, а не приказ двору. */
const isDeal = (id: ErrandId): id is DealId => id === 'truce' || id === 'trade' || id === 'tribute' || id === 'alliance';

/**
 * Цена дела из «Походов» строкой `ENERGY_PRICE`: та же, что у дела у ворот. Удар, осаду, перехват и удар по лагерю платят
 * их двери, наблюдение даром (стоянка даром), дела против соседа-игрока — сервер войны. Разрыв союза — «слово сказать»,
 * ценой объявления войны.
 */
function errandPrice(id: ErrandId): EnergyAction | null {
  if (id === 'recon' || id === 'shadow' || id === 'probe' || id === 'revolt') return id;
  if (id === 'gift' || id === 'insult' || id === 'pact' || id === 'peace' || id === 'war') return id;
  if (isDeal(id)) return 'deal';
  if (id === 'unpact') return 'war';
  return null;
}

/** Цель дела, найденная в мире. */
type ErrandSpot =
  | { kind: 'home'; at: Coord }
  | { kind: 'place'; at: Coord; s: GenSettlement }
  | { kind: 'rival'; at: Coord; c: PlayerCastle }
  | { kind: 'march'; at: Coord; m: StoredMarch };

/**
 * Идёт ли чужой отряд на наш лагерь осады: выручка того города, под которым стоит наш полководец (`camp` —
 * `LocalWorld.ourSiege`). Одно правило на двух читателей — видна ли выручка по донесению и что говорит вид похода.
 */
const onCamp = (m: StoredMarch, camp: SettlementId | null): boolean =>
  camp !== null && !m.own && m.phase === 'out' && m.relief === camp;

/** Скольких наших ведёт чужой отряд домой после прорыва (АУ-8, п. 5): пленные под выкуп и уведённые. */
const takingOf = (m: StoredMarch): number => (!m.own && m.phase === 'back' ? Math.max(0, m.held ?? 0) + Math.max(0, m.led ?? 0) : 0);

/**
 * Воины отряда мира заданной мощи — одна мерка на набег логова, войну дворов, выручку и разбойников у ворот: по ним мир
 * считает, сколько отряд унесёт (`haul`) и сколько его ляжет в бою (`stackLosses`).
 */
const warriorsOf = (power: number): UnitStack => ({ warrior: Math.max(1, Math.round(power / 3)) });

/**
 * Имя места со словом перед ним: «у логова Волчья Падь», «в городе Белая Гора». Имя места не склоняется —
 * склоняется слово перед ним (docs/ui_audit.md, 17.1, 14), и род его — по тому, логово это или город.
 */
const placeWord = (s: GenSettlement, form: 'of' | 'in'): string =>
  `${isLair(s) ? (form === 'of' ? 'логова' : 'логове') : form === 'of' ? 'города' : 'городе'} ${s.name}`;

/** Кто лезет через рогатки одной стороны лагеря: свои поимённо или чужие родами. */
/** Часть нападающих на лагерь: своё войско по видам или чужое по родам; `rest` — её мораль между боями (`world/rest`). */
type CampPart = ({ own: TroopStack } | { kinds: Stack }) & { rest?: number };

/** Полководец ведёт войну с игроком: других дел у него нет, а увести его — отозвать поход (docs/pvp.md). */
const WAR_BUSY = 'Полководец ведёт поход на соседа. Вернуть его можно, только отозвав поход или сняв осаду.';

/** Сумма двух составов по видам. */
/** Мерная дорога темпа погони, клеток (`LocalWorld.paceOf`): длиннее пола самого короткого похода в любом режиме. */
const PACE_SPAN = 1000;

const plusTroops = (a: TroopStack, b: TroopStack): TroopStack => {
  const out: TroopStack = { ...a };
  for (const [k, v] of Object.entries(b) as [keyof TroopStack, number | undefined][]) {
    if ((v ?? 0) > 0) out[k] = (out[k] ?? 0) + (v ?? 0);
  }
  return out;
};

export class LocalWorld implements WorldApi {
  private gen: WorldGen;
  protected save: WorldSave;
  protected byId = new Map<SettlementId, GenSettlement>();
  protected clock: () => number;
  private storage: WorldStorage | null;
  /**
   * Отчёты, появившиеся с прошлого пульса. Копятся и между вызовами `sync`:
   * бой полководца случается в момент нажатия, а не на тике, и очищать список
   * в начале пульса значило бы терять именно эти отчёты.
   */
  private fresh: Report[] = [];
  /**
   * Осада, снятая последней (`liftSiege`), и её запись для показа (`world/siegerecord`, ролик осады): донесение о том же
   * городе той же минуты несёт её (`addReport`) — падение, дань, выкуп, вылазка и удар, разбившие лагерь. Донесение штурма
   * пишется до снятия лагеря, и запись ложится в него после (`siegeToReport`). Не хранится: живёт до следующего снятия.
   */
  private lifted: { id: SettlementId; at: number; rec: SiegeRecord } | null = null;
  /**
   * Последний виденный лагерь каждой войны (`WarView.camp`), по номеру войны. Сервер снимает лагерь вместе с концом осады
   * (`war.turnBack`) и оставляет только журнал фаз; машины, дела и древесина для ролика осады берутся отсюда. Не хранится:
   * после перезапуска война, кончившаяся без захода, показывает журнал фаз без машин — то, что видел сервер в конце.
   */
  private warCamps = new Map<string, NonNullable<WarView['camp']>>();
  /** Разведанная местность: открывается навсегда, обратно не затягивается. */
  private fog: FogMap;
  /** Притязания поселений на землю. Считаются один раз: поселения не переезжают. */
  private claims: Claim[];
  /** Отладочный обзор: вся земля считается разведанной. */
  private reveal: boolean;
  /**
   * Опора логова: мощь чужих дворов вокруг него. Считается один раз на логово —
   * дворы не переезжают, а базовая мощь не меняется, — и на ней держится
   * потолок роста (`world/lairs.ts`).
   */
  private anchors = new Map<SettlementId, number>();
  /**
   * Замки живых игроков. Отдельная карта, а не строки в `gen.settlements`, и
   * это главное решение всей пачки: по сгенерированным поселениям ходит вся
   * фоновая жизнь мира — набеги соседей, войны дворов между собой, выручка
   * осаждённым, письма, приказы лазутчика и дипломата. Всё это выдумывает
   * клиент, и приписать выдуманное живому человеку нельзя. Здесь до них не
   * дотягивается ничто, кроме чтения карты, — не потому, что стоит проверка, а
   * потому что их нет там, где перебирают поселения.
   */
  private castles = new Map<SettlementId, PlayerCastle>();
  /** Откуда берутся строки реестра. null — реестра в этой сессии нет. */
  private provide: (() => PlayerCastle[]) | null;
  /** Свои войны с сервера и дверь приказа (docs/pvp.md). null — войны между игроками в этой сессии нет. */
  private warsFrom: (() => WarView[]) | null;
  private warsKnown: (() => boolean) | null;
  private pactsFrom: (() => WarPact[]) | null;
  private proposalsFrom: (() => ProposalView[]) | null;
  private warOrderTo: ((order: WarOrder) => Promise<string | null>) | null;
  private warPaceOf: () => number;
  /** Павшие наших походов в боях этого пульса, по войнам (`warAttrition`): кладёт `warBattle`, чистит `stepWars`. */
  private warFought = new Map<string, TroopStack>();
  /** Дела лазутчиков с сервера и меню дел (docs/spy_pvp.md). null — тайной войны в этой сессии нет. */
  private spiesFrom: (() => SpyView[]) | null;
  private spyLookTo: ((target: string) => Promise<SpyMenu | string>) | null;
  /** Последнее меню дел против города — приказ идёт ровно по его числам. */
  private spyShown: { target: string; menu: SpyMenu } | null = null;
  /**
   * Мир собран заново оттого, что реестр назвал другую клетку. Читается один
   * раз, сразу после постройки: сказать об этом игроку должен тот, у кого есть
   * летопись.
   */
  readonly movedByRoster: boolean;

  constructor(opts: LocalWorldOptions = {}) {
    this.clock = opts.now ?? partyNow;
    this.reveal = opts.reveal ?? false;
    this.storage = opts.storage === undefined ? browserStorage : opts.storage;
    this.provide = opts.castles ?? null;
    this.warsFrom = opts.wars ?? null;
    this.warsKnown = opts.warsKnown ?? null;
    this.pactsFrom = opts.pacts ?? null;
    this.proposalsFrom = opts.proposals ?? null;
    this.warOrderTo = opts.warOrder ?? null;
    this.warPaceOf = opts.warPace ?? (() => 1);
    this.spiesFrom = opts.spies ?? null;
    this.spyLookTo = opts.spyLook ?? null;
    const parsed = parseWorldSave(this.storage?.read() ?? null);
    // Мир прошлой эпохи (сервер стёрт `/wipeworld ДА`) не читается: новая партия — новый мир (docs/test_world.md).
    const stored = parsed && opts.era !== undefined && (parsed.era ?? 0) !== opts.era ? null : parsed;
    const seed = opts.seed ?? stored?.seed ?? freshSeed();
    // Дом решается раньше всего остального: от него зависят и логова у порога,
    // и то, годится ли вообще сохранение. Порядок — реестр, потом сохранение,
    // потом сид; спорить с реестром сохранение не может.
    const named = opts.home ?? null;
    const home = named ?? stored?.home ?? undefined;
    const sameHome = Boolean(stored && home && stored.home.x === home.x && stored.home.y === home.y);
    const keep = Boolean(stored && stored.seed === seed && (!home || sameHome));
    // Мир собран заново потому, что реестр назвал другую клетку, — а не потому,
    // что сохранения не было вовсе. Разница видна только здесь, и сказать о ней
    // игроку должен тот, у кого есть летопись (`world/store`).
    this.movedByRoster = Boolean(stored && named && !sameHome);
    this.gen = generateWorld(seed, home);
    this.save = keep
      ? (stored as WorldSave)
      : createWorldSave(seed, this.gen.home, this.gen.allyTribe, this.clock(), named !== null);
    if (keep && named) this.save.homeFromRoster = true;
    // Мир собран заново поверх прежнего той же эпохи («Начать заново», дом сменён реестром): итоги войн и тайных дел,
    // уже принятые партией, принятыми и остаются. Сервер отдаёт их ещё семь суток (`WAR_KEEP_MS`), и новый мир без
    // этого списка применял бы их второй раз — добыча взятого города, украденное и потери приходили снова
    // (docs/bughunt.md, «Начать заново»).
    if (!keep && stored?.warSeen?.length) this.save.warSeen = [...stored.warSeen];
    if (opts.era !== undefined) this.save.era = opts.era;
    for (const s of this.gen.settlements) this.byId.set(s.id, s);
    // Логова, заведённые по ходу партии, подмешиваются к сгенерированному: для
    // всех, кто спросит мир, они такие же поселения, как остальные. Иначе о
    // логове пришлось бы помнить в каждом месте, где перебираются дворы.
    this.adoptSpawned();
    this.adoptCastles();
    this.claims = claimsOf(this.gen);
    this.expandLegacyHostility();
    this.fog = new FogMap(this.save.fog);
    // Первая партия обязана начинаться с открытой округи: чёрный экран на входе
    // читается как сломанная карта, а не как туман войны.
    this.fog.revealDisc(this.save.home, homeSight(this.save.home));
    this.revealNeighbours();
    this.stepSightings(this.clock(), this.sightDiscs(this.clock()));
    // Переход ДР-6: отряд, собранный дома по прежней раскладке, — снова гарнизон, без потерь (`homecoming`); в поле — не трогают.
    if (keep) this.homecoming(this.clock());
  }

  // ---------- Служебное ----------

  private write(): void {
    this.save.fog = this.fog.toJSON();
    this.forgetVisits(this.clock());
    this.storage?.write(worldSaveJson(this.save));
  }

  /** Разведанная местность наружу — карте и тестам размера сохранения. */
  fogData(): FogData {
    return this.fog.toJSON();
  }

  /** Сколько клеток открыто. Нужен отчёту о размере сохранения. */
  exploredCells(): number {
    return this.fog.count();
  }

  /**
   * Собственные часы поселения. Их останавливают две беды, и обе — окна времени:
   * бунт лазутчика и разорение после набега, который двор не отбил. Пока часы
   * стоят, поселение не растёт, запасы не копятся, гарнизон не отстраивается —
   * это и означает «хозяйство встало». Отсюда же и обещание «второй набег
   * приносит крохи»: склад наполняется по этим же часам (`lootAvailable`).
   *
   * Тормозов два, поэтому потерянное время считается по **объединению** окон
   * (`sack.haltElapsed`), а не складывается: сложи их — и поселение, разорённое
   * во время бунта, поехало бы во времени назад, чиня задним числом гарнизон.
   *
   * Считается при чтении, а не отмечается тиком, поэтому офлайн даёт ровно то
   * же, что непрерывная игра. Отметки на записях (`damage.at`, `looted`)
   * ставятся в этих же часах.
   */
  private liveAt = (id: SettlementId, now: number): number =>
    now - haltElapsed([this.save.revolts[id], this.save.sacks[id]], now);

  /** Сколько поселение прожило своей жизнью: возраст мира минус время бунтов. */
  private lived = (s: GenSettlement, now: number): number =>
    Math.max(0, this.liveAt(s.id, now) - this.save.createdAt);

  // ---------- Замки живых игроков ----------

  /**
   * Берёт из реестра то, что приехало, и складывает с тем, что помнит
   * сохранение.
   *
   * Складывает, а не заменяет, и это правило: **открытое не закрывается
   * никогда.** Пропала строка из реестра — игрок ушёл, реестр прополол давние,
   * сеть не ответила — клетка, в которой игрок своими глазами видел замок, не
   * имеет права снова стать пустой землёй. Свежесть при этом не выдумывается:
   * живые данные показывает снимок, и у него своя отметка времени.
   *
   * Своей строки здесь нет: свой замок — это `HOME_ID`, у него другой вид и
   * другие права.
   */
  private adoptCastles(): void {
    for (const c of this.provide?.() ?? []) {
      if (c.x === this.save.home.x && c.y === this.save.home.y) continue;
      this.save.castles[c.id] = { ...c };
    }
    for (const c of Object.values(this.save.castles)) this.castles.set(c.id, c);
  }

  /**
   * Где стоят соседи по своему краю, знает каждый (docs/pvp.md, решение 6): клетка замка в своём регионе
   * открыта сразу — иначе цель войны пришлось бы сперва искать разведчиком сутками пути. Открывается
   * **место**, а не сведения: кто там, насколько велик и как называется, по-прежнему даёт только живой
   * обзор, и снимка за так нет. Замки за краем своего региона — как прежде, разведкой.
   */
  private revealNeighbours(): void {
    if (this.reveal || !this.fog) return;
    for (const c of this.castles.values()) if (this.inRealm(c)) this.fog.revealDisc(c, 1);
  }

  /** Замок живого игрока по номеру. null — такого нет, и это обычный случай. */
  private castleOf = (id: SettlementId): PlayerCastle | null => this.castles.get(id) ?? null;

  /**
   * Замок живого игрока глазами карты.
   *
   * Слоёв два, ровно как у всего остального. Первый — местность: то, что в этой
   * клетке стоит замок, открывается вместе с землёй и не забывается. Второй —
   * живые данные: чьё это, насколько велико и как называется. Их даёт только
   * живой обзор (круг у деревни и стоящий лазутчик), вне его остаётся снимок с
   * датой, а если снимка не было — не остаётся ничего, и это честнее «стадии
   * по последним данным реестра»: реестр приезжает сам, а смотреть на соседа
   * надо было.
   */
  private castleView(c: PlayerCastle, now: number, discs: SightDisc[]): SettlementView {
    const visible = inSight(discs, c.x, c.y);
    const seen = this.save.sightings[c.id] ?? null;
    return {
      id: c.id,
      x: c.x,
      y: c.y,
      // Имя тоже живые данные. Владелец волен переименоваться, и показывать
      // новое имя поверх снимка недельной давности значило бы врать о том,
      // когда мы туда смотрели.
      // Город называет владелец (`PlayerCastle.city`, очищено на входе в мир); не назвал —
      // у него, как у всех, «Безымянный город». Вне обзора — имя из снимка, а у снимка из
      // старого сохранения его нет: тогда имя вождя, как было.
      name: visible ? cityOr(c.city) : (cityName(seen?.name) ?? seen?.owner ?? 'Город соседа'),
      stage: visible ? stageOf(c.power, c.pop) : (seen?.stage ?? 'camp'),
      relation: 'neutral',
      owner: visible ? c.name : (seen?.owner ?? null),
      tribeId: null,
      tribeName: null,
      color: RELATION_META.neutral.color,
      mine: false,
      castle: true,
      ...(c.arms ? { arms: c.arms } : {}),
      visible,
      seenAt: visible ? now : (seen?.at ?? null),
      stale: !visible && seen !== null,
      seenPop: visible ? c.pop : (seen?.pop ?? null),
      // Выходит ли оттуда войско, не знает никто: походов между игроками в игре
      // нет вовсе, и рисовать их неоткуда.
      marching: false,
      ruin: false,
      sacked: false,
      // Между игроками не происходит ничего: ни осад, ни взятых городов.
      besieged: null,
      fell: null,
    };
  }

  /**
   * Карточка чужого замка.
   *
   * Действий тут нет ни одного — ни набега, ни осады, ни разведки, ни приказа
   * агенту, — и это не «пока не сделано», а устройство пачки: между игроками в
   * игре не происходит ничего. Поэтому и мощь берётся не из разведки: разведать
   * замок нечем. Её даёт тот же живой обзор, что даёт число людей в чужом
   * отряде, — и стареет она теми же ступенями, что и всякий снимок.
   */
  private castleCard(c: PlayerCastle, now: number, discs: SightDisc[]): SettlementCard {
    const view = this.castleView(c, now, discs);
    const seen = this.save.sightings[c.id] ?? null;
    const age = view.visible ? 0 : seen ? Math.max(0, now - seen.at) : Infinity;
    const grade = view.visible ? 'exact' : precisionOf(age);
    // Смотрим сами — числа настоящие; не смотрим — числа из снимка и с его
    // возрастом; снимка не было — не знаем ничего, и так и сказано.
    const power = view.visible ? c.power : (seen?.power ?? null);
    const pop = view.visible ? c.pop : (seen?.pop ?? null);
    return {
      ...view,
      terrain: terrainAt(this.save.seed, c.x, c.y),
      distance: distance(this.save.home, c),
      terrainFactor: terrainFactor(this.save.seed, this.save.home, c),
      power: power !== null ? estimate(power, grade) : { ...UNKNOWN },
      pop: pop !== null ? estimate(pop, grade) : { ...UNKNOWN },
      // Участь объявляет поход (docs/pvp.md): что получит победитель — той же дверью, что взятие.
      fates: this.warFates(c.id, now),
      // Что у соседа на складе, не видно ниоткуда: разведать его нечем.
      loot: { ...UNKNOWN },
      intel: null,
      figuresHere: this.figuresAt(c.id, now),
      deals: [],
      diplomacy: null,
      revolt: null,
      can: { raid: false, scout: false, support: false, besiege: false, open: false },
      siege: null,
      ruinLeft: 0,
      sack: null,
      note: 'Город соседа. Им правит живой человек.',
      // «Дойти и ударить» — та же строка, что у логова: поход со штурмом с ходу (`assault`).
      ...((): { war?: CardWar; assault?: AssaultPlan } => {
        const war = this.warCard(c, now);
        const assault = war ? this.assaultOf(c.id, now) : undefined;
        return war ? { war, ...(assault ? { assault } : {}) } : {};
      })(),
      ...((): { spy?: CardSpy } => {
        const spy = this.spyCard(c, now);
        return spy ? { spy } : {};
      })(),
    };
  }

  // ---------- Логова ----------

  /**
   * Подмешивает заведённые по ходу партии логова к сгенерированному миру.
   * Мутировать результат генерации можно ровно здесь и ровно один раз, при
   * подключении: `WorldGen` живёт внутри этого объекта, наружу не отдаётся, а
   * все, кто перебирает поселения, обязаны видеть один список, а не два.
   */
  private adoptSpawned(): void {
    for (const l of this.save.spawned) {
      // Логово за краем региона (его могло завести сохранение до правила о регионах) в мир не встаёт: логова живут
      // только в регионе игрока, как и у генерации. Строка сохранения остаётся как есть — читать её больше некому.
      if (this.byId.has(l.id) || !this.inRealm(l)) continue;
      const s = makeLair(l.id, l.x, l.y, l.name);
      this.gen.settlements.push(s);
      this.gen.byKey.set(coordKey(s.x, s.y), s);
      this.byId.set(s.id, s);
    }
  }

  /**
   * Запись логова. Заводится лениво: у логова из генерации всё выводится из
   * возраста мира, и держать для него строку в сохранении не за чем — она
   * появится в тот день, когда логово сожгут.
   */
  private lairRec(id: SettlementId): LairRec {
    return this.save.lairs[id] ?? { bornAt: this.save.createdAt, burnedAt: 0 };
  }

  /**
   * Клетка в регионе игрока? Логова, цели походов и приказов — только там (docs/map_tw.md, 0.−2): карта показывает
   * один регион, и правило держит мир, а не честное слово интерфейса. Мерка та же, что у карты (`world/theatre`).
   */
  private inRealm(at: Coord): boolean {
    return inHomeTheatre(this.save.home, at);
  }

  /** Отказ цели за краем региона — теми же словами, что у карты. */
  private beyond(): string {
    return beyondNote(this.save.home);
  }

  /** Опора логова: расстояние до замка игрока. Считается один раз на логово. */
  private anchorOf(s: GenSettlement): number {
    const have = this.anchors.get(s.id);
    if (have !== undefined) return have;
    const value = lairAnchor(this.save.home, s);
    this.anchors.set(s.id, value);
    return value;
  }

  /**
   * Что сейчас на месте поселения. У обычного двора состояние одно и другого
   * быть не может: сжечь можно только логово.
   */
  private phaseOf(s: GenSettlement, now: number): LairPhase {
    return isLair(s) ? lairPhase(this.lairRec(s.id), now) : 'alive';
  }

  /** Живая цель: по ней ходят набеги, её видно на карте, её можно бить. */
  private alive(s: GenSettlement, now: number): boolean {
    return this.phaseOf(s, now) === 'alive';
  }

  /**
   * Логово сожжено. Не «побит гарнизон», а убрано: с карты оно пропадает, набеги
   * оттуда прекращаются немедленно — включая уже вышедшие. Это и есть то самое
   * видимое последствие победы, ради которого всё затевалось: игрок вернётся на
   * карту и увидит, что с той стороны больше никто не идёт.
   */
  private burnLair(s: GenSettlement, at: number): void {
    this.save.lairs[s.id] = { bornAt: this.lairRec(s.id).bornAt, burnedAt: at };
    for (const m of [...this.save.marches]) {
      if (m.own || m.fromId !== s.id) continue;
      this.remove(m);
    }
    // Разведданные о сожжённом никому не нужны и врали бы: гарнизона больше нет. Как и его морали.
    delete this.save.intel[s.id];
    delete this.save.sightings[s.id];
    this.setLairRest(s.id, undefined);
  }

  /** Сколько живых логов стоит в округе игрока. */
  private lairsNear(now: number): number {
    let n = 0;
    for (const s of this.gen.settlements) {
      if (!isLair(s) || !this.alive(s, now)) continue;
      if (distance(s, this.save.home) <= AI_RANGE) n++;
    }
    return n;
  }

  /**
   * Под чужой стеной: ближе `LAIR_SETTLE_GAP` к чужому месту острова (даже пустому — туда сервер поставит соседа,
   * docs/test_world.md) или к замку живого игрока из реестра. Генерация мира спрашивает только места острова
   * (`gen.ts`): реестр меняется, а мир пересобирается из сида; новое логово заводится раз и лежит в сохранении,
   * поэтому ему можно спросить и реестр.
   */
  private underForeignWalls(p: Coord): boolean {
    if (islandNeighbours(this.save.home).some((w) => distance(w, p) < LAIR_SETTLE_GAP)) return true;
    for (const c of this.castles.values()) if (distance(c, p) < LAIR_SETTLE_GAP) return true;
    return false;
  }

  /**
   * Заводит логово в стороне от дома. Место выбирается по зерну, как всё
   * остальное в этом мире: тот же сид и то же время дают то же логово.
   */
  private spawnLair(at: number, rng: () => number): boolean {
    const home = this.save.home;
    const seed = this.save.seed;
    for (let attempt = 0; attempt < 60; attempt++) {
      const a = rng() * Math.PI * 2;
      const r = LAIR_HOME_GAP + rng() * (AI_RANGE - LAIR_HOME_GAP);
      const spot = clampToWorld({ x: Math.round(home.x + Math.cos(a) * r), y: Math.round(home.y + Math.sin(a) * r) });
      if (!buildable(seed, spot.x, spot.y)) continue;
      if (this.gen.byKey.has(coordKey(spot.x, spot.y))) continue;
      // Только в регионе игрока: набег из логова за краем шёл бы из места, которого нет на карте.
      if (!this.inRealm(spot)) continue;
      if (distance(spot, home) < LAIR_HOME_GAP) continue;
      // Под чужой стеной разбойники не селятся — и под своим же пепелищем тоже:
      // новое логово обязано читаться как новое место, а не как воскресшее.
      if (this.gen.settlements.some((o) => distance(o, spot) < LAIR_SETTLE_GAP)) continue;
      if (this.underForeignWalls(spot)) continue;
      const l: SpawnedLair = {
        id: `l${this.save.nextLair}`,
        x: spot.x,
        y: spot.y,
        name: BARBARIAN_NAMES[Math.floor(rng() * BARBARIAN_NAMES.length) % BARBARIAN_NAMES.length],
      };
      const born = makeLair(l.id, l.x, l.y, l.name);
      this.save.spawned.push(l);
      this.save.lairs[l.id] = { bornAt: at, burnedAt: 0 };
      this.gen.settlements.push(born);
      this.gen.byKey.set(coordKey(born.x, born.y), born);
      this.byId.set(born.id, born);
      return true;
    }
    return false;
  }

  /**
   * Новые логова. Мир не должен ни пустеть, ни зарастать: слот расписания
   * приходит по времени, но занимается только если живых логов в округе меньше
   * потолка. Пропущенный слот не копится — он просто пропущен, поэтому вернуться
   * после ночи офлайна к шести новым логовам разом нельзя.
   */
  private stepLairs(now: number): void {
    const save = this.save;
    if (save.nextLairAt === 0) {
      save.nextLairAt = now + LAIR_SPAWN_MIN + seeded(marchSeed(save.seed, 700_000))() * (LAIR_SPAWN_MAX - LAIR_SPAWN_MIN);
      return;
    }
    // Предел щедрый нарочно: слот проходит раз в `LAIR_SPAWN_MIN`…`LAIR_SPAWN_MAX`, и
    // месяц офлайна набирает их много. Обрежь их скупым пределом — и догон разошёлся бы с
    // непрерывной игрой ровно на длину перерыва: у одного расписание уехало
    // вперёд, у другого нет. Каждый шаг стоит одного зерна и одного прохода по
    // логовам, так что цена этой щедрости — доли миллисекунды.
    for (let guard = 0; guard < 5000 && now >= save.nextLairAt; guard++) {
      const at = save.nextLairAt;
      const rng = seeded(marchSeed(save.seed, 700_000 + save.nextLair++));
      save.nextLairAt = at + LAIR_SPAWN_MIN + rng() * (LAIR_SPAWN_MAX - LAIR_SPAWN_MIN);
      if (this.lairsNear(at) >= LAIR_NEAR_CAP) continue;
      this.spawnLair(at, rng);
    }
  }

  /** Бунт идёт прямо сейчас? */
  private inRevolt = (id: SettlementId, now: number): boolean =>
    revoltActive(this.save.revolts[id], now);

  private revoltView(id: SettlementId, now: number): RevoltView | null {
    const w = this.save.revolts[id];
    if (!w || !revoltActive(w, now)) return null;
    return { since: w.since, until: w.until, power: REVOLT_POWER_LOSS };
  }

  // ---------- Разорение ----------
  //
  // Одна реализация на обе стороны, как у осады. Разорённый набегом чужой двор и
  // разорённая прорвавшимся набегом наша деревня — это одно и то же окно
  // (`world/sack.ts`), тот же срок и та же просадка; расходятся они только в
  // том, кто читает последствие: у чужого двора его читает сам мир (мощь,
  // население, склад), а у нашей деревни — племя, потому что производство
  // считает оно (`derived.sackYield`). Второй ветки кода под «наше» разорение
  // быть не должно: одностороннее правило игрок раскусит за день.

  /** Разорение держится прямо сейчас? Считается при чтении, а не тиком. */
  private isSacked = (id: SettlementId, now: number): boolean =>
    sackActive(this.save.sacks[id], now);

  /**
   * Ставит разорение. Единственная дверь — и она же дверь для нашей деревни:
   * `id` здесь бывает и `HOME_ID`. Повторный набег не складывает сроки, а
   * заводит окно заново (`sackWindow`): разоряют то, что успели отстроить.
   */
  private sackSettlement(id: SettlementId, at: number, byName: string): void {
    this.save.sacks[id] = sackWindow(at, byName);
  }

  /**
   * Разорение глазами карточки. Срока здесь нет: сколько соседу чинить стену,
   * ему никто не докладывал — видно только по виду двора. Развилка стоит одна и
   * здесь, а не в разметке, — иначе панель однажды покажет часы чужого двора.
   */
  private cardSack(id: SettlementId, now: number): CardSack | null {
    const w = this.save.sacks[id];
    if (!sackActive(w, now)) return null;
    return { look: sackLook(w, now) };
  }

  // ---------- Осада ----------
  //
  // Одна реализация на обе стороны. Осада игрока под чужим городом и осада
  // чужаков под нашим — это одно и то же окно (`world/siege.ts`), те же часы
  // голода, тот же срезанный приток и тот же порядок падения. Разница ровно в
  // двух местах: откуда берутся амбар и рты (у себя — из слепка деревни, у
  // чужого города — из его населения) и кто стоит лагерем (`campId`). Заводить
  // вторую ветку кода под «нашу» осаду нельзя: она разойдётся с первой ровно
  // тогда, когда кто-нибудь поправит числа в одной из них.

  /** Осада этого поселения, если она идёт прямо сейчас. Считается при чтении. */
  private siegeOf(id: SettlementId, now: number): SiegeWindow | null {
    const w = this.save.sieges[id];
    // Наш город — склад племени, не окно (ОС-1): прогноз хлеба окна осаду не кончает, её кончает событие (голод шага, уход).
    return w && (id === HOME_ID || siegeActive(w, now)) ? w : null;
  }

  /**
   * Осада деревни, если она идёт прямо сейчас. Считается при чтении из одного
   * окна: ни флага «осаждён», ни тика, который его снимет, в мире нет.
   */
  protected homeSiege(now: number): SiegeWindow | null {
    return this.siegeOf(HOME_ID, now);
  }

  /**
   * Хлеб нашего города в минуту `at`, пока он в осаде, — остаток окна (`siege.foodLeft`; docs/siege_v2.md, 21.1): лагерь
   * логова у наших стен или лагерь игрока (окно посчитал сервер войны). Осады нет — бесконечность: хлеб — склад.
   */
  private homeBread(at: number): number {
    let bread = Infinity;
    const w = this.save.sieges[HOME_ID];
    // Под логовом хлеб — склад (ОС-1): слепок и есть он; окно судит только до того, как племя узнало об осаде.
    if (w && at >= w.startedAt && !this.homeBesieged()) bread = Math.min(bread, foodLeft(w, at));
    const war = this.warOnUs();
    const c = war ? this.warWindow(war) : null;
    if (c && at >= c.startedAt) bread = Math.min(bread, foodLeft(c, at));
    return bread;
  }

  /**
   * Постройки нашего города, по которым бьёт артиллерия лагеря с целью «город» (Р-5, `world/shelling`): всё, что стоит, кроме
   * стены — по стене бьют своей целью. Заморожено в окне при постановке (`SiegeWindow.targets`); порядок — по имени, чтобы
   * у мира и сервера один список.
   */
  private homeTargets(): string[] | undefined {
    const levels = this.save.profile?.levels ?? {};
    const out = Object.entries(levels)
      .filter(([k, v]) => k !== 'palisade' && (v ?? 0) >= 1)
      .map(([k]) => k)
      .sort();
    return out.length ? out : undefined;
  }

  /**
   * Мощь гарнизона осаждённого — бойцов строя, без ополчения (оно стоит на стене и за ворота не выходит): с ней меряется кольцо
   * блокады (`world/blockade`, вчетверо). У нашего города — оборона в эту минуту, у двора мира — его мощь.
   */
  private garrisonPower(id: SettlementId, at: number): number {
    if (id === HOME_ID) return troopPower(this.defenders(at).all);
    const s = this.byId.get(id);
    return s ? this.powerNow(s, at) : 0;
  }

  /**
   * Кольцо блокады в минуту события (Р-5, docs/siege_v2.md, 21.1): размыкается ударом с поля (`why` = `relief`) или мощью
   * ниже порога; лагерь логова (бот, без решений) замыкает его сам, как только может, — правилом той же двери. Тика нет:
   * зовут фаза, бой у лагеря и постановка.
   */
  private ringCheck(id: SettlementId, w: SiegeWindow, at: number, why?: BlockadeBreak): void {
    const camp = this.campArmy(w, at);
    if (!camp) return;
    const on = blockadeAt(w, at);
    if (on && why) {
      Object.assign(w, blockadeAfter(w, at, false, why));
      this.ringNote(id, w, at, false, why);
      return;
    }
    const garrison = this.garrisonPower(id, at);
    if (on && !blockadeHolds(camp.power, garrison)) {
      Object.assign(w, blockadeAfter(w, at, false, 'ratio'));
      this.ringNote(id, w, at, false, 'ratio');
      return;
    }
    if (!on && !ourCamp(w) && blockadeBlock(w, at, camp.power, garrison) === null) {
      Object.assign(w, blockadeAfter(w, at, true));
      this.ringNote(id, w, at, true);
    }
  }

  /** Строка летописи о кольце — тому, чья осада: наш город под лагерем или наш лагерь. */
  private ringNote(id: SettlementId, w: SiegeWindow, at: number, on: boolean, why?: BlockadeBreak): void {
    const ours = ourCamp(w);
    if (!ours && id !== HOME_ID) return;
    const town = id === HOME_ID ? this.homeName() : (this.byId.get(id)?.name ?? 'город');
    const by = this.campArmy(w, at)?.name ?? 'лагерь';
    const text = on
      ? ours
        ? `Кольцо вокруг ${town} замкнуто. ${BLOCKADE_GIVES}`
        : `${by} замкнули кольцо вокруг города. ${BLOCKADE_GIVES}`
      : `Кольцо вокруг ${town} разомкнуто: ${BREAK_WORDS[why ?? 'order']}.`;
    // Своему лагерю кольцо — удача, своему городу — беда; разомкнутое — наоборот.
    this.phaseNote(text, at, on === ours, 'ring');
  }

  /** Какое поселение держит в осаде наш полководец. null — лагеря нет. */
  private ourSiege(now: number): SettlementId | null {
    for (const [id, w] of Object.entries(this.save.sieges)) {
      if (ourCamp(w) && siegeActive(w, now)) return id;
    }
    return null;
  }

  /**
   * Отказ на выход из осаждённого города — в точке отдачи приказа, а не
   * проверкой потом. Приказ, который молча станет чем-то другим (или не станет
   * ничем), хуже отказа: игрок обязан узнать, что войско не вышло, в тот же миг,
   * когда он велел ему выйти.
   */
  private siegeBlock(now: number): string | null {
    // Одно правило выхода на любую осаду своего города — логова и игрока (docs/siege_audit.md, решение 4): ворота
    // закрыты, наружу только вылазка и совместный удар; полководец, стоявший в поле, бьёт с тыла. Сервер войны держит
    // то же правило для похода и лазутчика (`netlify/lib/war.ts`, `besieged`).
    return this.homeSiege(now) || this.warOnUs() ? SIEGE_BLOCK : null;
  }

  /**
   * Амбар и рты осаждаемого. У своей деревни оба числа приезжают слепком — их
   * считает племя тем же `foodConsumptionPerDay`, которым живёт всегда. У чужого
   * города своих чисел о еде у мира нет, и они выводятся из населения и
   * гарнизона (`townLarder`/`townEatPerHour`) — но выводятся **в ту же форму**,
   * чтобы дальше считала одна и та же `starvesAt`.
   */
  private larderOf(
    id: SettlementId,
    now: number,
    extraMen: number,
  ): { food: number; garrison: number; townPerHour: number; perManPerHour: number; yieldPerHour?: number } {
    if (id === HOME_ID) {
      const p = this.save.profile;
      return {
        food: p?.food ?? 0,
        // Рты за стеной — оборона в эту минуту, а не войско из слепка: гарнизон и
        // дружина, собранная дома. Дружина в поле ест у полководца, а та, что
        // идёт сбором, — ни у кого из осаждённых.
        garrison: troopTotal(this.defenders(now).all) + extraMen,
        townPerHour: p?.foodPerHour ?? 0,
        perManPerHour: p?.soldierFoodPerHour ?? 0,
        // Поля за стеной (ОС-1): валовая добыча хлеба, штраф по соотношению сил кладёт окно (`siegeWindowAt`).
        yieldPerHour: p?.yieldPerHour ?? 0,
      };
    }
    const s = this.byId.get(id);
    const pop = s ? this.popNow(s, now) : 0;
    const men = s ? menOfPower(this.powerNow(s, now)) : 0;
    return {
      food: townLarder(pop),
      garrison: Math.max(0, men + extraMen),
      townPerHour: townEatPerHour(pop),
      perManPerHour: SIEGE_TOWN_EAT_MAN,
    };
  }

  /**
   * Открыть окно осады по нынешнему слепку. Это же и единственный способ его
   * пересчитать: пересчёт — то же открытие, только с новой отметкой времени и
   * от остатка еды на неё.
   *
   * `extraMen` — поправка к гарнизону чужого города: его люди выводятся из мощи,
   * и вышедшие на вылазку и не вернувшиеся в ней ещё не учтены (число
   * отрицательное). У своей деревни поправки не бывает: её оборону мир считает
   * в эту самую минуту (`defenders`) — отряд, дошедший до ворот, дружина,
   * вставшая дома или ушедшая в сбор, полёгшие на вылазке в ней уже есть или уже
   * нет.
   *
   * Начало осады и её одноразовые события при пересчёте не двигаются: осада
   * идёт та же, меняются только часы. Объявленная участь и доли древесины — тоже:
   * у новой осады они приходят приказом (`fresh`), у той же переносятся.
   */
  private openSiegeAt(
    id: SettlementId,
    byId: SettlementId,
    campId: string,
    at: number,
    extraMen = 0,
    fresh: Pick<SiegeWindow, 'fate' | 'wood'> = {},
    food?: number,
  ): SiegeWindow {
    const w = this.siegeWindowAt(id, byId, campId, at, extraMen, fresh, food);
    this.save.sieges[id] = w;
    // Срок стоянки лагеря и есть час голода: падение разбирает та же очередь
    // событий по времени, что и приход любого другого отряда.
    const camp = this.save.marches.find((m) => m.id === campId);
    if (camp) camp.stayUntil = this.stayOf(id, w);
    return w;
  }

  /**
   * Срок стоянки лагеря: у чужого города — час голода окна (его склад — само окно), у нашего — никакой (ОС-1): голод нашего
   * города решает склад в шаге осады, и стоянка кончается событием фазы, а не сроком. Число конечное: бесконечность в
   * сохранении стала бы `null`, а `null` — стоянкой, кончившейся сразу.
   */
  private stayOf(id: SettlementId, w: SiegeWindow): number {
    return id === HOME_ID ? Number.MAX_SAFE_INTEGER : starvesAt(w);
  }

  /**
   * Окно осады, каким его заведёт `openSiegeAt`, — без записи в сохранение. Им же спрашивает и сухой прогон «садиться
   * ли» (`campHolds`): лагерь, который он судит, — тот самый, что встал бы.
   */
  private siegeWindowAt(
    id: SettlementId,
    byId: SettlementId,
    campId: string,
    at: number,
    extraMen = 0,
    fresh: Pick<SiegeWindow, 'fate' | 'wood'> = {},
    food?: number,
  ): SiegeWindow {
    const prev = this.save.sieges[id];
    const same = prev && prev.campId === campId ? prev : null;
    const larder = this.larderOf(id, at, extraMen);
    const w = openSiege({
      byId,
      campId,
      now: at,
      ...larder,
      // Остаток хлеба по окну, а не по слепку (паёк, офлайн-фаза): слепок деревни мог лечь раньше этой минуты.
      ...(food !== undefined ? { food } : {}),
      since: same ? siegeSince(same) : at,
      sortied: same?.sortied,
      relieved: same?.relieved,
      // Проходы той же осады остаются занятыми и после пересчёта часов голода; у
      // новой осады (`same` пусто) они свободны.
      gateAt: same?.gateAt,
      rearGateAt: same?.rearGateAt,
      fate: same ? same.fate : fresh.fate,
      wood: same ? same.wood : fresh.wood,
      builders: same ? same.builders : undefined,
      fire: same?.fire,
      // Дела полководца в лагере той же осады (`world/siegecraft`) переносятся; у новой их нет.
      craft: same?.craft,
      // Ход осады фазами (`world/siegeroll`): стена и путь от дома заморожены при постановке, журнал дел и фаз и наказы
      // той же осады переносятся. У новой осады журнал пустой — по нему окно знает, что оно уже фазовое.
      wall: same ? same.wall : id === HOME_ID ? (this.save.profile?.levels?.palisade ?? 0) : undefined,
      homeDays: same ? same.homeDays : this.campHomeDays(id, campId),
      // Лагерь с обозом (ДР-2, М5) — без подвоза из дома: режим записан при постановке, у той же осады переносится.
      gait: same ? same.gait : campId === PLAYER_CAMP && this.save.figures.general.gait === 'train' ? 'train' : undefined,
      log: same ? same.log : [],
      phases: same?.phases,
      orders: same?.orders,
      // Ответы осаждённого той же осады (docs/siege_v2.md, раздел 5) и очередь машин переносятся при пересчёте.
      ration: same?.ration,
      defend: same?.defend,
      machines: same?.machines,
      // Отметки «осада» нашего полководца — при постановке лагеря; переговоры той же осады переносятся (этап 2е).
      lead: same ? same.lead : campId === PLAYER_CAMP ? this.save.profile?.pips?.siege : undefined,
      offers: same?.offers,
      // Требушет на стене той же осады переносится; постройки под обстрелом — наш город при постановке (Р-5).
      guns: same?.guns,
      targets: same ? same.targets : id === HOME_ID ? this.homeTargets() : undefined,
      // Хлеб, когда встал лагерь, — мера доли хлеба кости фаз (ОС-1): у той же осады переносится.
      breadAtSince: same ? (same.breadAtSince ?? same.foodAtStart) : undefined,
    });
    // Штраф к добыче нашего города в минуту окна — по соотношению сил (ОС-1, мерка кольца).
    if (id === HOME_ID) {
      const camp = this.campArmy(w, at);
      if (camp) w.cut = siegeCutOf(camp.power, this.garrisonPower(id, at));
    }
    // Рогатки держат те, кто их строил: у новой осады это лагерь в минуту постановки.
    // Спрашивается у того же `campArmy`, которым лагерь бьётся, — второго счёта людей нет.
    if (!same) w.builders = this.campArmy(w, at)?.men;
    // Окно открылось или пересчиталось — гарнизон мог смениться, а с ним расчёт на башне.
    this.aimTower(id, w, at);
    return w;
  }

  /**
   * Оборона изменилась — часы голода считаются заново. Один раз, в самом
   * событии: пересчёт на каждое изменение и был бы тем самым тиком, которого у
   * осады нет. Поводы — отряд дошёл домой, передача дружины началась или
   * кончилась, полководец с дружиной встал у своих ворот, вылазка или удар
   * полководца по лагерю у своих ворот стоили людей, лагерь потерял людей.
   *
   * Зовётся **после** того, как событие изменило войско: оборона своей деревни
   * читается в эту минуту, и поправка ей не нужна.
   */
  private resiege(id: SettlementId, now: number, extraMen = 0): void {
    const w = this.siegeOf(id, now);
    if (!w) return;
    this.openSiegeAt(id, w.byId, w.campId, now, extraMen);
  }

  /**
   * Дни пути лагеря от своего дома, игровые (`siegeroll.wasteOf`: истощение растёт с дальностью). У отряда логова — его
   * собственный поход до ворот; у нашего лагеря — путь полководца от дома до цели той же формулой, что «Дойти и ударить»
   * (`travelTime`).
   */
  private campHomeDays(id: SettlementId, campId: string): number {
    if (campId === PLAYER_CAMP) {
      const s = this.byId.get(id);
      if (!s) return 0;
      const home = this.save.home;
      return gameDaysOfMs(realMs(travelTime(distance(home, s), terrainFactor(this.save.seed, home, s), FIGURE_BY_ID.general.speed)));
    }
    const m = this.save.marches.find((x) => x.id === campId);
    return m ? gameDaysOfMs(Math.max(0, m.arriveAt - m.departAt)) : 0;
  }

  /**
   * Ход осады фазами глазами окна (`SiegeView.phases`) — обеим сторонам одно; наказы — только тому, кто стоит лагерем.
   * Слова — дверью фаз (`world/siegeroll`, правило 18). Окно из сохранения до фаз (без журнала дел) тоже идёт фазами.
   */
  private phasesView(w: SiegeWindow, now: number, mine: boolean): SiegeView['phases'] {
    const next = nextRollAt(w);
    return {
      journal: journalOf(w, this.buildingName, (id) => MACHINE_NAME[id]),
      next: nextModsText(w, now),
      nextAt: next,
      nextK: rowsOf(w).length + 1,
      breaches: breachesOf(w),
      progress: progressOf(w),
      ...(mine && w.orders ? { orders: { ...w.orders } } : {}),
    };
  }

  /** Осада наружу: факт, срок и то, чем он посчитан. Считать её больше негде. */
  private siegeView(now: number): SiegeView | null {
    const w = this.homeSiege(now);
    // Под стенами лагерь живого игрока — то же окно, посчитанное сервером (docs/pvp.md).
    if (!w) return this.warSiegeView(now);
    const camp = this.campArmy(w, now);
    const wood = camp ? camp.wood : w.wood;
    return {
      byId: w.byId,
      byName: this.byId.get(w.byId)?.name ?? 'Враги',
      since: siegeSince(w),
      starvesAt: this.hunger(w),
      garrison: w.garrisonAtStart,
      foodAtStart: w.breadAtSince ?? w.foodAtStart,
      // Хлеб в городе сейчас — склад племени (ОС-1): голод решает он, в шаге осады.
      bread: Math.floor(this.homeFood(w, now)),
      ...this.breadView(camp?.power ?? 0, this.garrisonPower(HOME_ID, now), this.homeDryAhead(w)),
      campMen: camp?.men ?? 0,
      builders: this.buildersOf(w, now),
      ...(camp && w.fire ? { fire: { thin: camp.thin, cap: Math.max(w.fire.base, w.fire.thin), slow: w.fire.slow } } : {}),
      ...(w.gateAt !== undefined ? { gateAt: w.gateAt } : {}),
      ...(w.rearGateAt !== undefined ? { rearGateAt: w.rearGateAt } : {}),
      ...(wood !== undefined ? { wood } : {}),
      fate: this.fateFor(w.fate, HOME_ID, now),
      fall: this.fallForecast(w, now),
      palisade: this.save.profile?.levels?.palisade ?? 0,
      ...this.restViews(this.campRestView(w, now), this.homeRestView(now)),
      ...this.wearOf(this.homeWear(now)),
      phases: this.phasesView(w, now, false),
      ...(machinesNote(w, now) ? { machineNote: machinesNote(w, now) } : {}),
      ...(w.ration ? { ration: true } : {}),
      answers: this.answersOf(w, now, this.fateFor(w.fate, HOME_ID, now), camp?.kinds ?? null, []),
      parley: this.parleyDef(w, now, true, this.homeFair(w, now)),
      // Кольцо блокады (Р-5): лагерь видно со стены, свой гарнизон — свой: соотношение точное.
      blockade: this.blockadeView(w, now, camp?.power ?? 0, this.garrisonPower(HOME_ID, now), false),
    };
  }

  // ---------- Ответы осаждённого (docs/siege_v2.md, раздел 5; этап 2г) ----------
  //
  // Одна дверь на осаду логовом (окно мира) и на осаду игроком (окно сервера войны): числа — дверями `world/siegeroll`
  // (починка), `world/siege` (паёк), `world/machines` (вылазка на машину), цена починки — `build.wallRepairCost`. Под
  // логовом ответ применяет мир, под игроком — сервер войны тем же правилом.

  /** Ответы осаждённого для окна осады. `campKinds` — лагерь в бою (охрану машины считают от него). */
  private answersOf(
    w: SiegeWindow,
    now: number,
    fate: Fate,
    campKinds: Stack | null,
    reliefs: SiegeAnswers['reliefs'],
  ): SiegeAnswers {
    const cost = wallRepairCost(w.wall ?? 0);
    return {
      repair: { cost, reason: repairBlock(w, now) ?? this.stockShort(cost), doneAt: repairPending(w, now) },
      ration: this.rationAnswer(w, now),
      surrender: softerFate(fate),
      burn: burnTargets(w, now).map((id) => ({
        machine: id,
        name: MACHINE_NAME[id],
        ready: machineReady(w, id, now),
        guard: campKinds ? stackTotal(guardKinds(campKinds, GUARD_SHARE)) : 0,
      })),
      ...(w.defend ? { defend: { ...w.defend } } : {}),
      reliefs,
      // Р-5: требушет на стене и вылазка на пост кольца — в тех же ответах, той же ценой и тем же боем, что приказ.
      ...(this.gunView(w, now) ? { gun: this.gunView(w, now) } : {}),
      ...(blockadeAt(w, now) && campKinds ? { breakout: { guard: stackTotal(guardKinds(campKinds, BREAKOUT_SHARE)), gives: BREAKOUT_GIVES } } : {}),
    };
  }

  /** Хватает ли на складе (слепок деревни) — null; нет — строка отказа. */
  private stockShort(cost: Partial<Record<ResourceId, number>>, what = 'починку'): string | null {
    if (!Object.keys(cost).length) return 'Стен нет, чинить нечего.';
    const stock = this.save.profile?.stock ?? {};
    for (const [r, v] of Object.entries(cost)) if ((stock[r as ResourceId] ?? 0) < (v ?? 0)) return `На ${what} не хватает дерева и камня.`;
    return null;
  }

  /** Имя постройки по ключу — для журнала фаз с выстрелами по городу (Р-5). */
  // Прежняя постройка из записи до объединения дворов (ЗД-1) — именем её двора (`game/merged.keptType`).
  private buildingName = (b: string): string => BUILDING_BY_ID[keptType(b) ?? (b as keyof typeof BUILDING_BY_ID)]?.name ?? b;

  /** Цель артиллерии лагеря глазами окна (Р-5, `world/shelling`): что даст каждая цель — до нажатия. */
  private aimView(w: SiegeWindow, now: number): AimView {
    const ready = artilleryAt(w, now);
    const weight = ready.reduce((n, id) => n + ARTILLERY_WEIGHT[id], 0);
    const current = artilleryAim(w, now);
    return {
      now: current,
      artillery: ready.map((id) => ({ id, name: MACHINE_NAME[id], weight: ARTILLERY_WEIGHT[id] })),
      options: AIMS.map((aim) => {
        const reason = aim === current ? null : aimBlock(w, aim, now);
        return { aim, name: AIM_NAME[aim], gives: aimWords(aim, weight), can: aim !== current && reason === null, reason };
      }),
    };
  }

  /**
   * Кольцо блокады глазами окна (Р-5, `world/blockade`): условие, сейчас да или нет, что даёт и чем размыкают. `atk` —
   * окно осаждающего (может замкнуть). `range` — мощь гарнизона не видна (лагерь под городом игрока, ОС-1в): соотношение —
   * вилкой (`warRatio`), исход кнопки — по ней (`ringOdds`), гарнизон нулём не считается; решает сервер.
   */
  private blockadeView(w: SiegeWindow, now: number, camp: number, garrison: number, atk: boolean, range?: RatioRange): BlockadeView {
    const on = blockadeAt(w, now);
    const reason = on ? null : range ? blockadeBusy(w, now) : blockadeBlock(w, now, camp, garrison);
    const odds = range ? ringOdds(range) : undefined;
    const last = [...blockadeDeeds(w)].reverse().find((d) => d.at <= now && !d.on);
    const since = blockadeSince(w, now);
    return {
      on,
      ...(on && since !== null ? { since } : {}),
      ...(range ? { range, odds } : { ratio: ratioWords(blockadeRatio(camp, garrison)) }),
      need: BLOCKADE_RATIO,
      can: atk && !on && reason === null && odds !== 'no',
      reason: atk ? reason : null,
      gives: BLOCKADE_GIVES,
      breaks: BLOCKADE_BREAKS,
      ...(last?.why ? { broke: BREAK_WORDS[last.why] } : {}),
    };
  }

  /** Требушет на стене глазами окна осаждённого (Р-5): состояние, цена и срок, цель. Стены нет — нет поля. */
  private gunView(w: SiegeWindow, now: number): GunView | undefined {
    if (!(w.wall && w.wall > 0)) return undefined;
    const list = gunsAt(w, now);
    const live = list.find((g) => g.live);
    const state = live ? (live.ready ? 'ready' : 'building') : list.some((g) => g.broke) ? 'broken' : 'none';
    const cost = wallRepairCost(w.wall);
    const reason = gunBlock(w, now) ?? this.stockShort(cost, 'требушет');
    return {
      state,
      ...(live && !live.ready ? { readyAt: live.readyAt } : {}),
      cost,
      span: GUN_SPAN,
      can: reason === null,
      reason,
      aim: gunAimOf(w, now),
      options: GUN_AIMS.map((aim) => ({ aim, name: GUN_AIM_NAME[aim], gives: gunAimWords(aim) })),
    };
  }

  /**
   * Починка пролома под логовом в минуту `at` (docs/siege_v2.md, раздел 5): починка в журнале окна — пролом закроется к
   * концу фазы; дерево и камень уходят со склада сразу — в слепок, чтобы вторая проверка не увидела их снова, и в
   * племя последствием.
   */
  private repairAt(w: SiegeWindow, at: number): void {
    const cost = wallRepairCost(w.wall ?? 0);
    w.log = repairAfter(w, at).log;
    this.payStock(cost, `repair-${at}`, 'Пролом заделывают. К концу фазы стена будет цела.', at);
  }

  /** Списать добро со склада: слепок сразу, племя — последствием. */
  private payStock(cost: Partial<Record<ResourceId, number>>, id: string, text: string, at: number): void {
    const p = this.save.profile;
    if (p) {
      const stock = { ...(p.stock ?? {}) };
      for (const [r, v] of Object.entries(cost)) stock[r as ResourceId] = Math.max(0, (stock[r as ResourceId] ?? 0) - (v ?? 0));
      p.stock = stock;
    }
    const resources: Loot = {};
    for (const [r, v] of Object.entries(cost)) if (v) resources[r as ResourceId] = -v;
    this.addEffect({ id: `${id}-pay`, lost: {}, resources, prestige: 0, morale: 0, battle: null, text, good: true });
    void at;
  }

  /**
   * Паёк под логовом с минуты `at`: часы голода заново от остатка хлеба по окну (`pvp.foodLeft`), с пайком или без —
   * пересчёт, как смена гарнизона. Племя ест по пайку с ближайшего пульса (`bridge.syncSiege`).
   */
  private rationAt(w: SiegeWindow, at: number, on: boolean): void {
    const left = this.homeFood(w, at);
    if (on) w.ration = true;
    else delete w.ration;
    this.openSiegeAt(HOME_ID, w.byId, w.campId, at, 0, {}, left);
  }

  /**
   * Наказы осаждённого под логовом в минуту фазы (8.3): починка, пока хватает дерева и камня; паёк, когда хлеба меньше
   * половины. Те же дела, что кнопки окна.
   */
  private homeDefend(w: SiegeWindow, row: PhaseRow, at: number): void {
    const d = w.defend;
    if (!d) return;
    const done: PhaseRow['orders'] = [];
    const cost = wallRepairCost(w.wall ?? 0);
    if (orderRepairs(d, w, at, this.stockShort(cost) === null)) {
      this.repairAt(w, at);
      done.push('repair');
    }
    const ration = orderRations(d, Boolean(w.ration), this.homeShare(w, at));
    if (ration) done.push('ration');
    if (!done.length) return;
    row.orders = [...(row.orders ?? []), ...done];
    if (ration) this.rationAt(w, at, true);
  }

  /**
   * Ответ осаждённого (docs/siege_v2.md, раздел 5): починка пролома, паёк, наказы, сдача. Под логовом — правилом мира, под
   * лагерем игрока — приказом серверу войны той же дверью. null — сделано, иначе причина.
   */
  async defend(order: DefendOrder): Promise<string | null> {
    const now = this.clock();
    const w = this.homeSiege(now);
    if (!w) {
      const pvp = this.warOnUs();
      if (!pvp) return 'Под стенами никого.';
      switch (order.act) {
        case 'repair':
          return this.warSend({ op: 'repair', id: pvp.id });
        case 'ration':
          return this.warSend({ op: 'ration', id: pvp.id, on: order.on });
        case 'orders':
          return this.warSend({ op: 'defend', id: pvp.id, defend: cleanDefend(order.defend) ?? {} });
        case 'surrender':
          return this.warSend({ op: 'surrender', id: pvp.id });
        // Требушет на стене: приказ серверу войны той же дверью, что машины лагеря (`machine`) и цель (`aim`).
        case 'gun':
          return this.warSend({ op: 'machine', id: pvp.id, machine: 'trebuchet' });
        case 'gunAim':
          return this.warSend({ op: 'aim', id: pvp.id, aim: order.aim });
      }
    }
    switch (order.act) {
      case 'repair': {
        const why = repairBlock(w, now) ?? this.stockShort(wallRepairCost(w.wall ?? 0));
        if (why) return why;
        this.repairAt(w, now);
        break;
      }
      case 'ration':
        if (Boolean(w.ration) === order.on) return order.on ? 'Паёк и так урезан.' : 'Паёк и так обычный.';
        this.rationAt(w, now, order.on);
        break;
      case 'orders': {
        const clean = cleanDefend(order.defend);
        if (clean) w.defend = clean;
        else delete w.defend;
        break;
      }
      case 'surrender':
        // Сдача — та же дверь, что «ворота открыли» на фазе (ответ владельца 5): участь мягче, гарнизон уходит живым.
        this.siegeFalls(HOME_ID, now, 'gates');
        break;
      case 'gun': {
        // Требушет на стене (Р-5): цена — та же, что починка пролома; строится сроком требушета лагеря при всём лесе.
        const cost = wallRepairCost(w.wall ?? 0);
        const why = gunBlock(w, now) ?? this.stockShort(cost, 'требушет');
        if (why) return why;
        w.guns = gunAfter(w, now);
        this.payStock(cost, `siege-gun-${now}`, `На стену ставят требушет. Встанет через ${formatLeft(GUN_SPAN / 1000)}.`, now);
        break;
      }
      case 'gunAim': {
        const why = gunAimBlock(w, order.aim, now);
        if (why) return why;
        w.log = [...(w.log ?? []), { at: now, act: 'gunAim', aim: order.aim }];
        break;
      }
    }
    this.write();
    return null;
  }

  // ---------- Переговоры у стен (docs/siege_v2.md, раздел 7; этап 2е) ----------
  //
  // Цена — одна формула (`world/parley`): справедливая дань = добыча объявленной участи × доля пути осады. С логовом —
  // правилом мира той же формулой: лагерь логова у наших стен берёт дань не меньше справедливой, логово под нашим лагерем
  // сдаётся на условиях, которые обходятся ему не дороже справедливой дани, и само предлагает выкуп, когда доля пути
  // перевалила за половину. С игроком — приказом серверу войны: цену назначает он, добро переходит у него.

  /**
   * Переговоры приказом. Предложить своё: условия — осаждающий, дань — осаждённый; ответить на чужое — наоборот. Под логовом
   * и с логовом — правилом мира, с игроком — серверу войны. null — сделано, иначе причина или отказ логова словами.
   */
  async parley(order: ParleyOrder): Promise<string | null> {
    const now = this.clock();
    const role = order.act === 'offer' ? offerBy(order.kind) : offerBy(order.kind) === 'atk' ? 'def' : 'atk';
    if (role === 'def') {
      const home = this.homeSiege(now);
      if (home) return this.parleyHome(home, order, now);
      const pvp = this.warOnUs();
      if (!pvp || pvp.phase !== 'camp') return 'Под стенами никого.';
      return order.act === 'offer'
        ? this.warSend({ op: 'offer', id: pvp.id, kind: order.kind })
        : this.warSend({ op: 'answer', id: pvp.id, kind: order.kind, yes: order.yes });
    }
    const id = this.ourSiege(now);
    if (id) return this.parleyCamp(id, order, now);
    const pvp = this.warLed();
    if (!pvp || pvp.phase !== 'camp') return 'Лагеря уже нет.';
    return order.act === 'offer'
      ? this.warSend({ op: 'offer', id: pvp.id, kind: order.kind, ...(order.fate ? { fate: order.fate } : {}) })
      : this.warSend({ op: 'answer', id: pvp.id, kind: order.kind, yes: order.yes });
  }

  /** Добыча, которую увезёт лагерь, если доест наш город сейчас: та же дверь участи, что падение (`fallForecast`). */
  private homeBounty(units: UnitStack, at: number, f: Fate): number {
    const haul = this.haul(units, false);
    return bountyOf(this.fateHome(this.save.profile, haul.carry, haul.escort, at, f));
  }

  /**
   * Дань лагерю логова у наших стен в минуту `at`: справедливая (7.2), сбавленная красноречием нашего дипломата (АГ-1,
   * `parley.tributeAsk`) — её и показывает окно, и берёт лагерь.
   */
  private homeFair(w: SiegeWindow, at: number): number {
    const camp = this.save.marches.find((m) => m.id === w.campId);
    const fair = fairTribute(this.homeBounty(camp?.units ?? {}, at, this.fateFor(w.fate, HOME_ID, at)), siegeShare(w, at));
    return tributeAsk(fair, this.save.profile?.eloquence ?? 0);
  }

  /** Почему наш город не может дать дань в минуту `at`; null — может. */
  private tributeBlock(w: SiegeWindow, at: number, fair: number): string | null {
    return offerBlock(w, 'tribute', at) ?? (fair <= 0 ? 'На виду ничего не лежит: дани дать нечем.' : null);
  }

  /** Переговоры осаждённого с лагерем логова: дань по справедливой цене — логово её берёт (`parley.botTakesTribute`). */
  private parleyHome(w: SiegeWindow, order: ParleyOrder, at: number): string | null {
    if (order.act === 'answer') return 'Лагерь логова условий не предлагает.';
    if (order.kind !== 'tribute') return 'Условия предлагает осаждающий.';
    // Цена — та, что просит лагерь: справедливая, сбавленная красноречием (`homeFair`); логово берёт не меньше неё.
    const fair = this.homeFair(w, at);
    const why = this.tributeBlock(w, at, fair);
    if (why) return why;
    if (!botTakesTribute(fair, fair)) return 'Лагерь не взял дань.';
    this.payTribute(w, fair, at);
    this.write();
    return null;
  }

  /**
   * Наш город дал дань лагерю логова (7.1): добро — той же дверью дележа, что добыча (`parley.tributeGoods`, тайник цел),
   * уходит с лагерем обозом; лагерь снят, город неприкосновенен, как после падения.
   */
  private payTribute(w: SiegeWindow, price: number, at: number): void {
    const p = this.save.profile;
    const paid = tributeGoods(breadStock(p?.stock ?? {}, foodLeft(w, at)), p?.gold ?? 0, p?.stash ?? 0, price);
    const camp = this.save.marches.find((m) => m.id === w.campId);
    const from = this.byId.get(w.byId)?.name ?? camp?.fromName ?? 'Враги';
    this.save.siegeImmune[HOME_ID] = immuneUntil(at);
    this.liftSiege(HOME_ID, at, 'paid');
    // Дань едет в логово обозом лагеря (`turnHome` снял добычу — кладём её после).
    if (camp && paid.takenTotal > 0) camp.loot = { ...paid.taken };
    const loss = asLoss(paid.taken);
    this.addReport({
      id: `${w.campId}-tribute`,
      at,
      kind: 'defense',
      title: 'Дань отдана',
      target: { id: HOME_ID, name: this.homeName(), x: this.save.home.x, y: this.save.home.y },
      won: false,
      sent: {},
      lost: {},
      enemyPower: Math.round(camp?.power ?? 0),
      enemyLost: null,
      loot: paid.takenTotal > 0 ? loss : null,
      hidden: paid.hiddenTotal,
      intel: null,
      battle: null,
      text: `Лагерь «${from}» взял дань и ушёл. Город на время под защитой от осады.`,
      read: false,
    });
    this.addEffect({ id: `${w.campId}-tribute`, lost: {}, resources: loss, prestige: 0, morale: 0, battle: null, text: `Дань лагерю «${from}»: осада снята.`, good: false });
  }

  /** Добыча объявленной (или названной) участи чужого двора под нашим лагерем — той же дверью, что взятие (`siegeFalls`). */
  private campBounty(s: GenSettlement, at: number, f: Fate): number {
    const popThere = this.popNow(s, at);
    const haul = this.haul({ warrior: troopTotal(this.save.figures.general.troops ?? {}) }, true);
    return bountyOf(this.fateOf(s, at, haul.carry, this.bondedAt(popThere), haul.escort, f, popThere));
  }

  /** Справедливая дань двора под нашим лагерем в минуту `at` (7.2): по ней он выкупается и по ней судит условия. */
  private campFair(s: GenSettlement, w: SiegeWindow, at: number): number {
    return fairTribute(this.campBounty(s, at, this.fateFor(w.fate, s.id, at)), siegeShare(w, at));
  }

  /**
   * Переговоры нашего лагеря с логовом или двором мира: условия — логово сдаётся, если они обходятся ему не дороже
   * справедливой дани (`parley.botTakesTerms`); выкуп — логово предлагает его само, когда доля пути перевалила за половину
   * (`parley.lairRansoms`), и цена его — справедливая.
   */
  private parleyCamp(id: SettlementId, order: ParleyOrder, at: number): string | null {
    const w = this.save.sieges[id];
    const s = this.byId.get(id);
    if (!w || !s) return 'Лагеря уже нет.';
    if (order.act === 'answer') {
      if (order.kind !== 'tribute') return 'Условия предлагаем мы.';
      if (!lairRansoms(siegeShare(w, at))) return 'Выкупа не предлагают: осада не прошла и половины пути.';
      if (!order.yes) return null;
      this.takeRansom(s, w, at);
      this.write();
      return null;
    }
    if (order.kind !== 'terms') return 'Дань предлагает осаждённый.';
    const declared = this.fateFor(w.fate, id, at);
    const why = termsBlock(declared, order.fate) ?? offerBlock(w, 'terms', at);
    if (why) return why;
    const fate = order.fate as Fate;
    const yes = botTakesTerms(this.campBounty(s, at, fate), this.campFair(s, w, at));
    Object.assign(w, offerAfter(w, { kind: 'terms', at, fate }));
    Object.assign(w, answerAfter(w, 'terms', yes ? 'yes' : 'no', at));
    if (yes) this.siegeFalls(id, at, 'gates', fate);
    this.write();
    return yes ? null : `${s.name} не сдаётся: такие условия им пока дороже дани.`;
  }

  /**
   * Мы взяли выкуп двора под нашим лагерем (7.2): добро — той же дверью, что добыча (`takeLoot` на ступени по умолчанию,
   * людей не уводят), лагерь снят, двор неприкосновенен, как после падения; осада доведена — опыт осад полководца.
   */
  private takeRansom(s: GenSettlement, w: SiegeWindow, at: number): void {
    const price = this.campFair(s, w, at);
    // Выкуп — добро, людей не уводят: ступень по умолчанию (грабёж), конвоя нет.
    const took = this.takeLoot(s, at, price, 0, 0, FATE_DEFAULT, this.popNow(s, at));
    this.save.siegeImmune[s.id] = immuneUntil(at);
    this.liftSiege(s.id, at, 'ransom');
    const spoils: Loot | null = took.takenTotal > 0 ? took.taken : null;
    this.addReport({
      id: `ransom-${s.id}-${at}`,
      at,
      kind: 'raid',
      title: `Выкуп взят: ${s.name}`,
      target: { id: s.id, name: s.name, x: s.x, y: s.y },
      won: true,
      sent: { warrior: troopTotal(this.save.figures.general.troops ?? {}) },
      lost: {},
      enemyPower: Math.round(this.powerNow(s, at)),
      enemyLost: null,
      loot: spoils,
      hidden: took.hiddenTotal,
      intel: this.snapshot(s, at),
      battle: null,
      text: `${s.name} откупился на ${rowsOf(w).length}-й фазе осады.${gainText(took)} Лагерь снят.`,
      read: false,
    });
    this.addEffect({
      id: `ransom-${s.id}-${at}`,
      lost: {},
      prestige: 2,
      morale: 2,
      battle: null,
      resources: spoils ?? {},
      siege: true,
      text: `Осада ${s.name} кончилась выкупом.`,
      good: true,
    });
  }

  /** Переговоры глазами окна осаждённого — с лагерем логова (`bot`) или игрока; цена — по нашему складу. */
  private parleyDef(w: SiegeWindow, at: number, bot: boolean, fair: number): ParleyView {
    const incoming = bot ? null : liveOffer(w, 'terms', at);
    const mine = [...offersOf(w)].reverse().find((o) => o.kind === 'tribute');
    return {
      side: 'def',
      share: siegeShare(w, at),
      fair,
      block: this.tributeBlock(w, at, fair),
      ...(incoming ? { incoming: { kind: 'terms', ...(incoming.fate ? { fate: incoming.fate } : {}), until: incoming.until } } : {}),
      ...(mine ? { mine: offerView(mine) } : {}),
      bot,
    };
  }

  /** Переговоры глазами окна осаждающего: условия на выбор и дань — от логова (его выкуп) или от игрока (его предложение). */
  private parleyAtk(w: SiegeWindow, at: number, declared: Fate, ransom: number | null): ParleyView {
    const bot = ransom !== null;
    const live = bot ? null : liveOffer(w, 'tribute', at);
    const incoming = bot
      ? ransom > 0 && lairRansoms(siegeShare(w, at))
        ? { kind: 'tribute' as const, price: ransom, until: offerUntil(w, at) }
        : undefined
      : live
        ? { kind: 'tribute' as const, ...(live.price !== undefined ? { price: live.price } : {}), until: live.until }
        : undefined;
    const mine = [...offersOf(w)].reverse().find((o) => o.kind === 'terms');
    return {
      side: 'atk',
      share: siegeShare(w, at),
      terms: termsChoices(declared),
      block: termsChoices(declared).length ? offerBlock(w, 'terms', at) : termsBlock(declared, undefined),
      ...(incoming ? { incoming } : {}),
      ...(mine ? { mine: offerView(mine) } : {}),
      bot,
    };
  }

  /** Поле износа осады окна (`SiegeView.wear`): до сотых вниз, как мораль; осада только встала — поля нет. */
  private wearOf(wear: number): { wear?: number } {
    const share = Math.floor(wear * 100) / 100;
    return share < 1 ? { wear: share } : {};
  }

  /** Поля морали окна осады: у свежих их нет. */
  private restViews(camp: RestView | undefined, garrison: RestView | undefined): { campRest?: RestView; garrisonRest?: RestView } {
    return { ...(camp ? { campRest: camp } : {}), ...(garrison ? { garrisonRest: garrison } : {}) };
  }

  /**
   * Какой участью кончится взятие города `id` в минуту `at`: объявленной, если она ещё
   * доступна, иначе умолчанием (`spoils.fateAt`). Одна проверка на все места, где город
   * взят, — и на окно, которое называет участь заранее.
   *
   * `byPlayer` — объявлял ли игрок: тогда спрашиваются и замки его гейта (`playerLocks`).
   * Наш город берут логова, ветвей у них нет; чужой — мы, если не сказано иное (чужой
   * лагерь у чужого двора — `cardSiege`).
   */
  protected fateFor(declared: Fate | undefined, id: SettlementId, at: number, byPlayer = id !== HOME_ID): Fate {
    const locks = byPlayer ? this.playerLocks() : undefined;
    return fateAt(declared, id === HOME_ID ? 'player' : 'world', this.save.burnImmune[id], at, locks);
  }

  /**
   * Замки гейта у игрока: какие участи он объявить не может и почему — строкой, которую
   * считает племя (`sim/tech.fateLocks`) и везёт слепком. Мир их не толкует, а передаёт в
   * одну проверку участи (`spoils.fateBlock`) — на приказе, в строках выбора и на падении.
   */
  private playerLocks(): FateLocks | undefined {
    return this.save.profile?.fateLocks;
  }

  /**
   * Кто из обороны разойдётся, когда город доедят: доля `SIEGE_ROUT` каждого вида. Одно
   * место на само падение (`homeFalls`) и на окно, которое называет это число заранее.
   */
  private routedAt(at: number): { held: ReturnType<LocalWorld['defenders']>; routed: TroopStack } {
    const held = this.defenders(at);
    const routed: TroopStack = {};
    for (const id of TROOP_IDS) {
      const gone = Math.floor(Math.max(0, held.all[id] ?? 0) * SIEGE_ROUT);
      if (gone > 0) routed[id] = gone;
    }
    return { held, routed };
  }

  /**
   * Что потеряет наш город, если этот лагерь доест его в минуту `at`. Считает та же дверь
   * участи на тех же числах, что и падение (`homeFalls`), — окну своей арифметики не
   * положено.
   */
  private fallForecast(w: SiegeWindow, at: number): FallForecast {
    const camp = this.save.marches.find((m) => m.id === w.campId);
    const f = this.fateFor(w.fate, HOME_ID, at);
    const haul = this.haul(camp?.units ?? {}, false);
    // «Кончится хлеб — унесут…»: прогноз падения голодом, и хлеба в нём нет — его съела осада.
    const r = this.fateHome(this.save.profile, haul.carry, haul.escort, at, f, 0);
    const gold = r.lost.gold ?? 0;
    return {
      goods: r.lostTotal - gold,
      gold,
      hidden: r.hiddenTotal,
      ledBonded: r.ledBonded.taken,
      ledPop: r.ledPop.taken,
      scatterPop: r.scattered.pop,
      scatterBonded: r.scattered.bonded,
      buildings: r.fallen.length,
      levels: FATES[f].levels,
      burnsWorks: r.burnsWorks,
      routed: troopTotal(this.routedAt(at).routed),
    };
  }

  /**
   * Лагерь под стенами для карточки поселения — взгляд со стороны: лагерь, его
   * рогатки и объявленная участь видны, амбар — нет. Часы голода видят участники
   * осады — и видят их везде одинаково: в своём окне, в окне лагеря и здесь, в
   * карточке, одним чтением (`hungerOf`). Прежде карточка молчала и у участника, и
   * два места говорили об одной осаде разное.
   */
  private cardSiege(id: SettlementId, now: number): CardSiege | null {
    const w = this.siegeOf(id, now);
    if (!w) return null;
    const hunger = this.hungerOf(id, now);
    const camp = this.campArmy(w, now);
    const wood = camp ? camp.wood : w.wood;
    return {
      mine: ourCamp(w),
      byName: ourCamp(w) ? 'Наш отряд' : (this.byId.get(w.byId)?.name ?? 'Враги'),
      since: siegeSince(w),
      // Заняты ли проходы, видно глазами — как и сам лагерь. Поля нет, пока по
      // этой стороне лагеря не били.
      ...(w.gateAt !== undefined ? { gateAt: w.gateAt } : {}),
      ...(w.rearGateAt !== undefined ? { rearGateAt: w.rearGateAt } : {}),
      ...(wood !== undefined ? { wood } : {}),
      fate: this.fateFor(w.fate, id, now, ourCamp(w)),
      // Часы голода — участникам осады и тем же чтением, что в обоих окнах осады.
      ...(hunger !== null ? { starvesAt: hunger } : {}),
    };
  }

  /**
   * Войско в лагере: чем он бьётся, когда по нему бьют. Хранится оно там же, где
   * жило и раньше, — в марше у чужого лагеря и при полководце у нашего, — и
   * вторым числом в окне осады не дублируется.
   *
   * Лагерь в бою — ровно те, кто в нём стоит. Прибавки людей за готовность у
   * него нет: его крепость — укрепления (`world/works`), и они не добавляют ему
   * бойцов, а не пускают к нему наших.
   */
  private campArmy(w: SiegeWindow, at: number): {
    kinds: Stack;
    /** Чем лагерь одет — для показа (ролик и отчёт одевают им чужой отряд); в бой ступень не идёт. */
    gear: Partial<Record<UnitKind, number>>;
    resolve?: number;
    /** Дух того, чьё войско в лагере (ДР-1): у нашего — дух дружины, у чужого — никакого. */
    spirit?: Spirit;
    /** Отметки того, кто ведёт лагерь: у нашего — полководец, у чужого — никто. */
    pips?: Pips;
    /** Командиры флангов нашего лагеря (ДР-3): там же, где отметки полководца. */
    flanks?: Flanks;
    /** Черты армии нашего лагеря (ДР-4): дружина полководца. У чужого — никаких. */
    scars?: ScarSide;
    /** Сколько бойцов строя стоит в лагере. */
    men: number;
    power: number;
    name: string;
    /** Какая доля мощи лагеря выбита обстрелом с башни к минуте `at` (`world/bombard`). */
    thin: number;
    /** План рогаток под обстрелом: по нему лагерь рубит на самом деле. */
    wood: WoodPlan | undefined;
    /** Мораль лагеря между боями (`world/rest`): у нашего — дружины, у чужого — отряда, что сел лагерем. */
    rest: number;
  } | null {
    // Обстрел прикладывается к лагерю здесь и только здесь: лагерь, которым бьются и
    // который видно со стены, прорежён, а рогатки со стороны города рубятся медленнее.
    // Хранимое войско лагеря не трогается — выбитое записывается одним разом, когда
    // осада снята (`liftSiege`).
    const thin = thinAt(w.fire, at);
    const wood = firePlan(w.fire, w.wood);
    if (ourCamp(w)) {
      const troops = this.save.figures.general.troops ?? {};
      if (troopTotal(troops) <= 0) return null;
      const kinds = thinKinds(kindsOf(troops), thin);
      return {
        kinds,
        gear: this.ownGear(troops),
        // Наш лагерь держит дружина полководца — это его бой, и его отметки в нём есть; с обозом — сытый дух (ДР-2).
        spirit: this.generalSpirit(),
        pips: this.generalPips(),
        ...this.generalFlanks(),
        scars: this.generalScars(),
        men: stackTotal(kinds),
        power: troopPower(troops) * (1 - thin),
        name: 'наш лагерь',
        thin,
        wood,
        rest: this.generalRest(at),
      };
    }
    const m = this.save.marches.find((x) => x.id === w.campId);
    if (!m) return null;
    const power = m.power * (1 - thin);
    const party = raidingParty(this.save.seed, m.id, power);
    return {
      kinds: { ...party.kinds },
      gear: party.gear,
      men: stackTotal(party.kinds),
      power,
      name: m.fromName,
      thin,
      wood,
      rest: restAt(m.rest, at, stackTotal(party.kinds)),
    };
  }

  /**
   * Башня бьёт по лагерю под своим городом с той силой, какую дают готовое орудие и
   * лучники дома в минуту `at` (`bombard.aimOf`). Зовётся там, где сила может смениться:
   * окно открылось или пересчиталось — гарнизон изменился — и на пульсе, где мир узнаёт,
   * что орудие поставили или сняли. Под чужим городом башни нет, и обстрел там нулевой
   * тем же кодом.
   */
  private aimTower(id: SettlementId, w: SiegeWindow, at: number): void {
    const gun = id === HOME_ID && !ourCamp(w) ? this.save.profile?.tower : undefined;
    const home = gun ? this.defenders(at).all : {};
    const archers = TROOPS_OF_KIND.archer.reduce((n, t) => n + Math.max(0, home[t] ?? 0), 0);
    const next = reaim(w.fire, w.wood, siegeSince(w), at, aimOf(gun, archers));
    if (next.fire === undefined) delete w.fire;
    else w.fire = next.fire;
    if (next.wood === undefined) delete w.wood;
    else w.wood = next.wood;
  }

  /**
   * Сколько бойцов строя ставили рогатки этого лагеря — от них считается проход
   * (`world/works.campPass`). Окно из сохранения до этого правила строивших не знает, и
   * у него они — те, кто стоит в лагере сейчас: другого числа у такого окна нет.
   */
  private buildersOf(w: SiegeWindow, at: number): number {
    return w.builders ?? this.campArmy(w, at)?.men ?? 0;
  }

  /**
   * Кто бы ни ударил по лагерю — вылазка осаждённого, выручка соседей или наш
   * полководец, — считается это здесь и одним боем. Разводить их по трём местам
   * значило бы завести три правды о том, насколько лагерь крепок.
   *
   * Укрепления действуют на всех одинаково: в бой входят только те, кто прошёл
   * через рогатки (`world/works`), — доля строя от каждого рода, той же функцией,
   * которой панель вылазки считает «пробьются N из M» до нажатия. Остальные стоят
   * у рогаток: не убивают и не гибнут, и в бою их нет.
   *
   * **У лагеря две стороны, и у каждой свой проход.** Вылазка и выручка лезут во
   * фронт (к городу), полководец из поля — в тыл, а при совместном ударе гарнизон
   * лезет во фронт одновременно с ним. Занятость стороны — своя отметка в окне
   * осады (`gateAt` у фронта, `rearGateAt` у тыла): заход с одной стороны другую не
   * занимает. Пишутся отметки здесь и больше нигде, в самом событии боя; вышли, а
   * пробиться некому ни с одной стороны — боя нет, и отметки не трогаются
   * (`refused`).
   *
   * Бой при этом один: прошедшие с обеих сторон складываются в одного нападающего.
   * Кто с какой стороны вышел, — разные люди (гарнизон в городе, дружина в поле), и
   * потери делятся между сторонами по родам (`splitLosses`), поэтому ни один боец не
   * гибнет дважды и не остаётся жив за другого.
   *
   * `fought` и `all` — сколько бойцов строя дралось и сколько вышло; `share` —
   * их доля. Потери в бою — доля от дравшихся, и переводить её на весь отряд
   * надо через неё, а не прямо.
   */
  private campBattle(
    id: SettlementId,
    at: number,
    seed: number,
    attack: {
      front?: CampPart;
      rear?: CampPart;
      /**
       * В бою дружина полководца — удар из поля, в одиночку или вместе с
       * гарнизоном. Бой один, поэтому отметки ложатся на весь нападающий. Вылазку
       * он ведёт, только если он в городе (`homePips`), с отрядом и без; выручка
       * соседей идёт без него.
       */
      general?: boolean;
      /**
       * Откуда нападающий вышел на лагерь: полководец — из своей отправной точки, выручка — из своего двора. Нет —
       * вышли из ворот (вылазка): переправы нет, штрафует только земля (`world/place.groundAt`).
       */
      from?: Coord;
    },
  ):
    | {
        refused: false;
        field: FieldOutcome;
        camp: NonNullable<ReturnType<LocalWorld['campArmy']>>;
        /** Кто прошёл через рогатки каждой стороны — у любого нападающего, своего и чужого. */
        front: Through | null;
        rear: Through | null;
        /** Потери боя по сторонам, в родах: сколько легло из прошедших с каждой. */
        lost: { front: Stack; rear: Stack };
        fought: number;
        all: number;
        share: number;
      }
    | { refused: true; front: Through | null; rear: Through | null }
    | null {
    const kindsOfPart = (p: CampPart | undefined): Stack | undefined => (p ? ('own' in p ? kindsOf(p.own) : p.kinds) : undefined);
    const w = this.siegeOf(id, at);
    if (!w) return null;
    const camp = this.campArmy(w, at);
    if (!camp) return null;
    const own = [attack.front, attack.rear].some((p) => p && 'own' in p);
    // Лагерь стоит под городом: место боя — клетка города.
    const cell = id === HOME_ID ? this.save.home : this.byId.get(id);
    const partOf = (p: CampPart | undefined): CampPartIn | undefined =>
      p ? { kinds: kindsOfPart(p) as Stack, rest: p.rest } : undefined;
    // Бой у лагеря — одна дверь с войной между игроками (`fights.campFight`): рогатки, проходы сторон, один бой на
    // прошедших и дележ потерь по сторонам считает она, а мир только пишет следствия в своё сохранение.
    const fight = campFight({
      seed,
      at,
      sight: { since: siegeSince(w), builders: this.buildersOf(w, at), gateAt: w.gateAt, rearGateAt: w.rearGateAt, wood: camp.wood },
      // Стойкость и отметки лагеря: у нашего — обряд и отметки полководца, у чужого её нет.
      camp: { kinds: camp.kinds, resolve: camp.resolve, pips: camp.pips, flanks: camp.flanks, rest: camp.rest, spirit: camp.spirit, scars: camp.scars },
      front: partOf(attack.front),
      rear: partOf(attack.rear),
      spirit: own ? (attack.general ? this.generalSpirit() : this.ownSpirit()) : undefined,
      // Черты армии (ДР-4): у наших — по журналу боёв, у дружины в поле — сытые с обозом; место — клетка города, бой осадный.
      scars: own ? (attack.general ? this.generalScars() : this.ownScars()) : undefined,
      ...(cell ? { where: this.whereAt(cell, true) } : {}),
      pips: own ? (attack.general ? this.generalPips() : this.homePips(at)) : undefined,
      ...(own ? (attack.general ? this.generalFlanks() : this.homeFlanks(at)) : {}),
      ground: cell ? groundAt(this.save.seed, cell, attack.from) : undefined,
      // Укрепления лагеря — та же дверь, что у лагеря под городом игрока на сервере (`siegecraft.fortFaces`).
      fort: fortFaces(w.craft),
    });
    if (fight.refused) return { refused: true, front: fight.front, rear: fight.rear };
    const { field, front, rear, lost, fought, all } = fight;
    // Мораль лагеря после боя — в его войско: у нашего — в дружину, у чужого — в отряд, что сел лагерем. Мораль
    // нападающих пишут те, кто их вывел: у каждой части своя армия.
    if (field.result) {
      const pair = restAfter(field.rest.defender, at, camp.men * (1 - field.defenderLoss));
      if (ourCamp(w)) this.save.figures.general.rest = pair;
      else {
        const m = this.save.marches.find((x) => x.id === w.campId);
        if (m) m.rest = pair;
      }
    }
    // Прошедшие заняли свою долю прохода своей стороны. Окно то же, что в
    // сохранении: снимет осаду победа — отметки уйдут вместе с окном; устоит
    // лагерь — пересчёт часов голода перенесёт их в новое окно той же осады.
    if (front) {
      if (front.gateAt === undefined) delete w.gateAt;
      else w.gateAt = front.gateAt;
    }
    if (rear) {
      if (rear.gateAt === undefined) delete w.rearGateAt;
      else w.rearGateAt = rear.gateAt;
    }
    return { refused: false, field, camp, front, rear, lost, fought, all, share: all > 0 ? fought / all : 0 };
  }

  /**
   * Что пройдёт через рогатки каждой стороны лагеря под `id` в минуту `at` — без
   * боя и без записи. Им спрашивают до боя: бот, решая, выходить ли, и игрок,
   * которому отказывают раньше, чем тронут сид похода.
   */
  private campGate(
    id: SettlementId,
    at: number,
    going: { front?: Stack; rear?: Stack },
  ): {
    w: SiegeWindow;
    camp: NonNullable<ReturnType<LocalWorld['campArmy']>>;
    front: Through | null;
    rear: Through | null;
  } | null {
    const w = this.siegeOf(id, at);
    if (!w) return null;
    const camp = this.campArmy(w, at);
    if (!camp) return null;
    const cast = strikeForecast(
      { since: siegeSince(w), builders: this.buildersOf(w, at), gateAt: w.gateAt, rearGateAt: w.rearGateAt, wood: camp.wood },
      at,
      going.rear ?? emptyStack(),
      going.front ?? null,
    );
    return { w, camp, front: cast.front, rear: going.rear ? cast.rear : null };
  }

  /**
   * Лагерь понёс потери (устоял он или разбит — говорит `after`). Убыль ложится туда, где живёт войско
   * лагеря: у чужого — в мощь и состав марша, у нашего — в дружину при
   * полководце. Второго места, где хранится войско лагеря, нет.
   */
  private wearCamp(
    w: SiegeWindow,
    loss: number,
    at: number,
    why: string,
    after = 'Лагерь устоял, но людей поубавилось.',
    /** Бой у рогаток не может не стоить лагерю ни одного человека; истощение фазы — может. */
    atLeastOne = true,
    /** Писать ли строку летописи об убыли (истощение чужого лагеря у чужого города — не наше дело). */
    note = true,
    /** Истощение фазы `k` (АУ-8, п. 3): доля вида, дробь — костью сида осады (`siegeroll.wasteLosses`), как у сервера войны. */
    phase?: number,
  ): number {
    if (ourCamp(w)) {
      const f = this.save.figures.general;
      const troops = f.troops ?? {};
      // Доля потерь ложится на каждый род ровно так же, как её считает бой:
      // «убыло 30%» — это 30% в каждой полосе, а не тридцать первых попавшихся.
      // Бой у рогаток — потери боя, остаток рода одним бойцом (BTL-1); истощение фазы — доля вида, дробь костью (АУ-8, п. 3);
      // прочая доля лагеря — остаток к ближнему.
      const lost =
        phase !== undefined
          ? wasteLosses(troops, loss, rollSeed(w), phase)
          : troopLosses(troops, shareOfKinds(troops, loss), atLeastOne ? 'loss' : 'share');
      const left: TroopStack = {};
      for (const [key, n] of Object.entries(troops) as [keyof TroopStack, number][]) {
        const rest = (n ?? 0) - (lost[key] ?? 0);
        if (rest > 0) left[key] = rest;
      }
      let gone = troopTotal(troops) - troopTotal(left);
      // То же правило и для нашего лагеря: вылазка, дошедшая до рогаток, не
      // может не стоить ему ни одного человека.
      if (atLeastOne && gone === 0 && troopTotal(left) > 1) {
        for (const id of TROOP_IDS) {
          if ((left[id] ?? 0) > 0) {
            left[id] = (left[id] as number) - 1;
            if (left[id] === 0) delete left[id];
            lost[id] = (lost[id] ?? 0) + 1;
            gone = 1;
            break;
          }
        }
      }
      if (troopTotal(left) === 0) {
        f.troops = undefined;
        const besieged = this.ourSiege(at);
        const town = besieged ? this.byId.get(besieged) : undefined;
        this.defeatGeneral(
          at,
          'потерял весь отряд у вражеских стен.',
          town ? `у города ${town.name}` : 'у вражеских стен',
          town ? { id: town.id, name: town.name, x: town.x, y: town.y } : this.homeSpot(),
          mixSeed(this.save.seed, Math.floor(at / 1000)),
        );
      } else {
        f.troops = left;
        if (gone > 0 && note) {
          this.addEffect({
            id: `camp-wear-${at}`,
            lost: { warrior: gone },
            lostTroops: lost,
            // Лагерь — дружина в поле: раненые в бою лежат при полководце (docs/infirmary.md); ушедшие от истощения —
            // больные и беглые, а не раненые: лазарет их не кладёт.
            ...(atLeastOne ? { field: lost } : { routed: true }),
            resources: {},
            prestige: 0,
            morale: atLeastOne ? -3 : 0,
            battle: null,
            text: `${why} ${after}`,
            good: false,
          });
        }
      }
      return gone;
    }
    const m = this.save.marches.find((x) => x.id === w.campId);
    if (!m) return 0;
    const before = stackSize(m.units);
    m.power = Math.max(1, m.power * (1 - loss));
    m.units = stackAfter(m.units, stackLosses(m.units, loss));
    let gone = before - stackSize(m.units);
    // Дошли до рогаток — кто-то в лагере лёг. Условия «если доля потерь больше
    // нуля» здесь нарочно нет: вылазка, не стоившая осаждающему ни одного
    // человека, — чистый минус, и такую кнопку не нажмёт никто ни разу. Один
    // человек лагерю стоит любой бой у его рогаток, даже проигранный вчистую.
    if (atLeastOne && gone === 0 && before > 1) {
      // Воином, как было; воинов нет — первым видом, у которого есть люди: лагерь из одних разведчиков без потерь не
      // остаётся (MAP-8).
      const first = (m.units.warrior ?? 0) > 0 ? 'warrior' : UNIT_IDS.find((u) => (m.units[u] ?? 0) > 0);
      if (first) m.units = stackAfter(m.units, { [first]: 1 });
      gone = before - stackSize(m.units);
    }
    return gone;
  }

  /**
   * Осада снята: лагерь ушёл. Одно место на все поводы — разбитый лагерь,
   * уведённый полководец, павший город. Оно же и единственное, где осада
   * пропадает из сохранения, и единственное, где ставится остывание.
   */
  private liftSiege(id: SettlementId, at: number, how: SiegeEnd): SiegeWindow | null {
    const w = this.save.sieges[id];
    if (!w) return null;
    // Запись осады для ролика — до того, как окно удалено и выбитое башней списано с лагеря: она и есть окно в минуту
    // конца. Война соседей между собой — не наша осада, донесения о ней нет.
    this.lifted = ourCamp(w) || id === HOME_ID ? { id, at, rec: this.siegeRecordAt(id, w, at, how) } : null;
    // Выбитое обстрелом с башни — одно число на лагерь и на запись: ниже оно списывается с войска лагеря.
    const thin = thinAt(w.fire, at);
    if (this.lifted && thin > 0) this.lifted.rec.thinned = thin;
    // Наш лагерь снят — энергия полководца больше не стоит: с этой минуты она уходит, как у всякого в поле.
    const held = ourCamp(w) ? this.energyOf('general', at) : null;
    delete this.save.sieges[id];
    if (held) this.restance('general', at, held);
    this.save.siegeAgainAt[id] = at + SIEGE_COOLDOWN;
    const camp = this.save.marches.find((m) => m.id === w.campId);
    // Выбитое обстрелом с башни записывается в войско лагеря одним разом, здесь: до этой
    // минуты оно выводилось при чтении (`campArmy`), а окна, из которого выводить, больше нет.
    if (camp && thin > 0) {
      camp.power = Math.max(1, camp.power * (1 - thin));
      camp.units = stackAfter(camp.units, stackLosses(camp.units, thin));
    }
    if (camp) this.turnHome(camp, at, null);
    return w;
  }

  /**
   * Запись осады в минуту её конца (`world/siegerecord`): окно как есть, исход, люди лагеря, башня города, бои за осаду и
   * место. Бои — донесения с записью боя о том же городе за время осады: их ролики игрок уже может смотреть, и ролик осады
   * ставит их на свои минуты.
   */
  private siegeRecordAt(id: SettlementId, w: SiegeWindow, at: number, how: SiegeEnd): SiegeRecord {
    const home = id === HOME_ID;
    const since = siegeSince(w);
    const fights: SiegeFight[] = [];
    for (const r of this.save.reports) {
      const site = r.battle?.site;
      if (!site || r.target.id !== id || r.at < since || r.at > at) continue;
      // Вылазка на пост кольца (Р-5) — бой за кольцо: донесение `breakout…` (`LocalWorld.breakout`).
      fights.push({ at: r.at, site, won: r.won, report: r.id, ...(r.id.startsWith('breakout') ? { ring: true as const } : {}) });
    }
    const spot = home ? this.save.home : (this.byId.get(id) ?? this.save.home);
    return siegeRecordOf(
      w,
      ourCamp(w) ? 'atk' : 'def',
      { at, how },
      {
        camp: w.builders ?? this.campArmy(w, since)?.men ?? 0,
        // Башня — только своя: орудие чужого двора мир не знает (`TowerGun` приезжает слепком нашей деревни).
        ...(home && !ourCamp(w) && this.save.profile?.tower ? { tower: this.save.profile.tower.seats } : {}),
        fights,
        place: this.placeOf(spot),
      },
    );
  }

  /** Участь, с которой пал город снятой осады, — в её запись (падение считает её после снятия лагеря). */
  private liftedFate(id: SettlementId, at: number, fate: Fate): void {
    if (this.lifted && this.lifted.id === id && this.lifted.at === at) this.lifted.rec.end.fate = fate;
  }

  /** Донесение, написанное до снятия лагеря (штурм из лагеря), получает запись снятой осады. */
  private siegeToReport(reportId: string | null, id: SettlementId, at: number): void {
    const l = this.lifted;
    if (!reportId || !l || l.id !== id || l.at !== at) return;
    const r = this.save.reports.find((x) => x.id === reportId);
    if (r && !r.siege) {
      r.siege = l.rec;
      this.lifted = null;
    }
  }

  /**
   * Отряд дошёл и увидел, чем его встречают. Лезть на частокол, который заметно
   * сильнее пришедшего, никто не станет: он садится лагерем и берёт город тем,
   * чего у города конечное количество.
   *
   * Решает `sitsDown` — одна дверь на набег и на войну дворов.
   */
  private beginSiege(m: StoredMarch, at: number, field: FieldOutcome): boolean {
    if (!this.save.profile) return false;
    if (!this.sitsDown(HOME_ID, m, at, field)) return false;

    // Участь, которую отряд объявил, переезжает в окно: город падает в минуту голода,
    // и читает её оттуда. Древесины отряд не делит — рубит по правилу бота.
    const w = this.openSiegeAt(HOME_ID, m.fromId, m.id, at, 0, { fate: m.fate });
    this.save.siegeAgainAt[HOME_ID] = at + SIEGE_COOLDOWN;
    // Лагерь логова — бот: замыкает кольцо блокады в минуту постановки, если мощи вчетверо (Р-5, правило той же двери).
    this.ringCheck(HOME_ID, w, at);
    // Марш становится стоянкой у ворот. `from` не трогаем: по нему лагерь потом
    // уйдёт домой, и подменить его точкой стоянки значило бы отправить чужаков
    // восвояси в нашу же деревню.
    m.phase = 'stay';
    m.stayUntil = this.stayOf(HOME_ID, w);
    this.addReport({
      id: `${m.id}-siege`,
      at,
      kind: 'defense',
      title: 'Город в осаде',
      target: { id: HOME_ID, name: this.homeName(), x: this.save.home.x, y: this.save.home.y },
      won: false,
      sent: {},
      lost: {},
      enemyPower: Math.round(m.power),
      enemyLost: null,
      loot: null,
      intel: null,
      battle: null,
      text: `${m.fromName} не пошли на штурм: заслон крепче их отряда. Встали лагерем у ворот и ждут, когда кончится хлеб. Объявили участь «${FATE_META[this.fateFor(m.fate, HOME_ID, at)].name.toLowerCase()}».`,
      read: false,
    });
    return true;
  }

  /**
   * Садится ли пришедший отряд в осаду вместо приступа. **Одна дверь** на набег на нас и на
   * войну дворов между собой: двух правил решения об осаде в мире быть не должно.
   *
   * Смысл решает сам бой, а не порог числом: `field` — тот бой у стены, который случится,
   * если отряд пойдёт на приступ, с тем же сидом. Прорвался бы — идёт на приступ, осады не
   * бывает; отбили бы — лагерь. «Пробьёт ли» числом не выражается: при равной мощи от
   * состава обороны зависит почти всё (docs/raid_ceiling.md, раздел 4).
   *
   * Кость не про смысл, а про частоту: без ограничителя крепкая деревня видела бы лагерь
   * вместо набега почти всегда, то есть вложение в стену наказывалось бы исчезновением
   * набега как события. Поэтому доля (`SIEGE_CHANCE`) и остывание (`SIEGE_COOLDOWN`)
   * крутятся отдельно от боя: он отвечает за «можно», они — за «часто ли».
   *
   * **В осаду становится только отряд, чей лагерь удержится против вылазки гарнизона к дозревшим рогаткам**
   * (`campHolds` → `fights.campHolds`; docs/siege_v2.md, 1.3, шаг 3). Иначе это набег: идёт на приступ, отбит и уходит.
   * Прежде (docs/battle_eu4.md, 14.35, «Осада в одного») вылазку спрашивали в минуту постановки, на пустом поле, и у
   * крепкой деревни не садился почти никто — отсекались ровно те осады, где у защитника был бы ответ.
   */
  private sitsDown(id: SettlementId, m: StoredMarch, at: number, field: FieldOutcome): boolean {
    if (this.save.sieges[id]) return false;
    // Цепочку закрывает окно неприкосновенности: у павшего города пустой амбар, и вторая
    // осада подряд повторила бы исход, не дав ни решения между.
    if (siegeImmune(this.save.siegeImmune[id], at)) return false;
    // Остывание — то же самое, но после любого конца осады, а не только после падения.
    if (at < (this.save.siegeAgainAt[id] ?? 0)) return false;
    if (field.won) return false;
    if (seeded(m.seed)() >= SIEGE_CHANCE) return false;
    return this.campHolds(id, m, at);
  }

  /**
   * Удержит ли лагерь, в который сел бы отряд `m`, вылазку гарнизона **в минуту, когда рогатки со стороны города
   * дозреют** — дверью `fights.campHolds` (docs/siege_v2.md, 1.3, шаг 3), сухим прогоном и ничего не трогая. Окно осады
   * для прогона заводится тем же `siegeWindowAt`, что настоящее, и не ложится в сохранение: из него лагерь читается тем же
   * `campArmy`, которым бьётся (обстрел с башни к той минуте, план рогаток под обстрелом), а строившие — лагерь в минуту
   * постановки, как у настоящего окна. Выходит весь гарнизон — те, кто дома, у нашего города с дружиной у ворот
   * (`defenders`), у двора мира — его гарнизон; ополчение за ворота не выходит; мораль — на ту минуту, износ осады кладёт
   * дверь. Сид — сид похода, тот же, что у сухого боя у стены. Выходить некому — лагерь стоит.
   */
  private campHolds(id: SettlementId, m: StoredMarch, at: number): boolean {
    const cell: Coord | undefined = id === HOME_ID ? this.save.home : this.byId.get(id);
    if (!cell) return true;
    const w = this.siegeWindowAt(id, m.fromId, m.id, at);
    const set = this.campArmy(w, at);
    if (!set) return true;
    const ripe = holdMinute(at, set.wood);
    const camp = this.campArmy(w, ripe);
    if (!camp) return true;
    let sortie: HoldIn['sortie'];
    if (id === HOME_ID) {
      const held = this.defenders(at);
      if (troopTotal(held.all) <= 0) return true;
      const standing = standingShare(held.own, held.standing, held.all);
      sortie = {
        kinds: kindsOf(held.all),
        spirit: this.ownSpirit(),
        pips: this.homePips(at),
        ...this.homeFlanks(at),
        rest: mixRest([
          { rest: this.garrisonRest(held.own, ripe), men: this.menOf(troopsAfter(held.all, standing)) },
          { rest: this.generalRest(ripe), men: this.menOf(standing) },
        ]),
      };
    } else {
      const s = this.byId.get(id) as GenSettlement;
      const g = garrisonOf(this.save.seed, s.id, this.powerNow(s, at), s.castle);
      if (stackTotal(g.kinds) < 1) return true;
      sortie = { kinds: g.kinds, rest: this.lairRestAt(id, ripe, stackTotal(g.kinds)) };
    }
    return campHolds({
      seed: m.seed,
      wearSpan: wearSpan(w),
      sight: { since: at, builders: w.builders ?? set.men, wood: camp.wood },
      camp: { kinds: camp.kinds, rest: camp.rest },
      sortie,
      // Вылазка выходит из ворот: переправы нет, штрафует только земля (`world/place.groundAt`).
      ground: groundAt(this.save.seed, cell),
    });
  }

  /**
   * Голод сделал своё: город пал. Владелец при этом не меняется — такой механики
   * в игре нет и заводить её здесь незачем. Что теряет взятый город, решает одна
   * дверь участи (`spoils.fate`): у нашего города это склад, казна и уровни
   * построек (`FALL_BUILDINGS`), у двора мира — склад и казна (построек у него нет).
   *
   * Одно место на обе стороны: падение своего города и падение чужого идут
   * отсюда, и расходятся они ровно в том, кому достаётся добыча и кто получает
   * отчёт.
   */
  private siegeFalls(id: SettlementId, at: number, by: 'hunger' | 'gates' = 'hunger', terms?: Fate): void {
    const w = this.save.sieges[id];
    if (!w) return;
    this.save.siegeImmune[id] = immuneUntil(at);
    const ours = ourCamp(w);
    this.liftSiege(id, at, by === 'gates' ? (terms ? 'terms' : 'gates') : 'hunger');
    // Пал наш город — это `homeFalls`, и больше ничего. Раньше сюда вёл любой
    // не наш лагерь, и падение чужого двора под чужим же лагерем (война соседей)
    // рассеяло бы наш гарнизон и вычистило наш склад. Проверка стоит на самом
    // городе, а не на лагере.
    if (id === HOME_ID) return this.homeFalls(w, at, by);
    // Сдача (ворота открыли, docs/siege_v2.md, 2.4) — гарнизон уходит живым, участь на ступень мягче (ответ владельца 5).
    const gates = by === 'gates';

    // Чужой город доели — мы или его соседи. Гарнизон разошёлся ровно так же,
    // как расходится наш: та же доля и тот же смысл, — а разница в том, кому
    // достаётся склад.
    const s = this.byId.get(id);
    if (!s) return;
    const prev = this.damageOf(id, at);
    // Людей двора считаем до того, как рассеянный гарнизон убавит их: у логова
    // народ выводится из силы, а сила — из побитого гарнизона.
    const popThere = this.popNow(s, at);
    const bondedThere = this.bondedAt(popThere);
    if (!gates) {
      this.save.damage[id] = {
        loss: Math.min(0.95, prev + SIEGE_ROUT * (1 - prev)),
        at: this.liveAt(id, at),
      };
    }
    // Война соседей между собой: игроку не достаётся ничего, и отчёта ему нет —
    // это не его бой.
    if (!ours) return;
    const f = this.save.figures.general;
    const men = troopTotal(f.troops ?? {});
    // Участь города — та же дверь, что у нашей деревни, и та, что объявлена приказом
    // «Осадить»: склад и казна до тайника, сколько поднимет дружина, а на ступени,
    // уводящей людей, — невольники и горожане, скольких она устережёт.
    const announced = this.fateFor(w.fate, id, at);
    // Сдача на условиях (docs/siege_v2.md, 7.1) — участь из условий; просто сдача — на ступень мягче объявленной.
    const declared = terms ?? (gates ? softerFate(announced) : announced);
    this.liftedFate(id, at, declared);
    this.markFall(id, declared, at);
    const haul = this.haul({ warrior: men }, true);
    const took = this.takeLoot(s, at, haul.carry, bondedThere, haul.escort, declared, popThere);
    this.leadFrom(id, popThere, took, at);
    const gain = winnerGain(took);
    const spoils: Loot | null = took.takenTotal > 0 ? took.taken : null;
    this.addReport({
      id: `siege-${id}-${at}`,
      at,
      kind: 'raid',
      title: gates ? `Ворота открыли: ${s.name}` : `Город взят голодом: ${s.name}`,
      target: { id, name: s.name, x: s.x, y: s.y },
      won: true,
      sent: { warrior: men },
      lost: {},
      enemyPower: Math.round(this.powerNow(s, at)),
      enemyLost: null,
      loot: spoils,
      hidden: took.hiddenTotal,
      led: gain.bonded,
      intel: this.snapshot(s, at),
      battle: null,
      text: `${
        gates
          ? `${s.name} сдался${terms ? ' на наших условиях' : ''} на ${rowsOf(w).length}-й фазе осады: гарнизон ушёл живым, участь «${FATE_META[declared].name.toLowerCase()}».`
          : `В ${s.name} кончился хлеб. Гарнизон разошёлся.`
      }${gainText(took)}${took.hiddenTotal > 0 ? ` В их тайнике осталось ${took.hiddenTotal}.` : ''} Лагерь снят.`,
      read: false,
    });
    this.addEffect({
      id: `siege-${id}-${at}`,
      lost: {},
      prestige: 5,
      morale: 5,
      // Настоящего боя не было ни у нас, ни у них: город взяли голодом, и
      // записывать это в битвы значило бы считать то, чего не случилось.
      battle: null,
      ...gain,
      castle: s.castle || undefined,
      // Осада доведена нашим лагерем — опыт осад полководца (отметка «осада», этап 2е).
      siege: true,
      text: gates ? `Осада ${s.name} кончилась: ворота открыли.` : `Осада ${s.name} кончилась: город сдался голоду.`,
      good: true,
    });
    this.moveAttitude(id, ATTACK_ATTITUDE, at);
  }

  /**
   * Уведённые горожане двора мира. Своих жителей у бота в мире нет — население
   * выводится из часов и силы, — поэтому уведённые ложатся туда же, куда рассеянный
   * гарнизон: в разбитость двора (`damage`), своей долей от населения. У логова это
   * и есть его люди (`lairPop` выводится из силы); у двора мира население из силы не
   * выводится, и уведённые убавят там только тех, кто держит оружие. Двор мира на
   * карте сейчас спит (`waitsForPlayers`), и разрыв назван здесь, а не спрятан.
   */
  private leadFrom(id: SettlementId, popThere: number, took: FateResult, at: number): void {
    if (took.ledPop.taken <= 0 || popThere <= 0) return;
    const share = Math.min(1, took.ledPop.taken / popThere);
    const prev = this.damageOf(id, at);
    this.save.damage[id] = { loss: Math.min(0.95, prev + share * (1 - prev)), at: this.liveAt(id, at) };
  }

  /**
   * Сколько невольников держит чужой двор при таком населении. Своих невольников у
   * бота в мире нет: это доля его населения (`AI_BONDED_SHARE`), выведенная при
   * чтении, ровно как тайник выводится из склада. Уводят их на ступени участи,
   * уводящей людей (`spoils.FATES`).
   */
  private bondedAt(pop: number): number {
    return Math.max(0, Math.round(pop * AI_BONDED_SHARE));
  }

  /** Пал наш город. Всё, что при этом происходит, — здесь и больше нигде. */
  private homeFalls(w: SiegeWindow, at: number, by: 'hunger' | 'gates' = 'hunger'): void {
    const p = this.save.profile;
    // Сдача (ворота открыли) — гарнизон уходит живым, участь на ступень мягче (ответ владельца 5).
    const gates = by === 'gates';
    // Расходится оборона, а не всё войско: гарнизон и дружина, если она собрана
    // и стоит дома, — она голодала за той же стеной. Дружина в поле или в сборе
    // в городе не голодала, и рассеивать её значило бы снять людей, которых
    // полководец по-прежнему держит при себе.
    // Гарнизон рассеян: люди с оружием из взятого голодом города расходятся.
    const fallen = this.routedAt(at);
    const held = fallen.held;
    const routed = gates ? {} : fallen.routed;
    const army = held.all;
    const men = troopTotal(routed);
    if (!gates) this.standingLost(held.own, held.standing, routed);
    const camp = this.save.marches.find((m) => m.id === w.campId);
    // Участь взятого города — одна дверь на оба пути поражения и та, что объявил
    // лагерь: тот же дележ склада и казны, что у прорвавшегося набега, тот же увод,
    // те же постройки. Соль выбора построек — сид мира и минута падения.
    const announced = this.fateFor(w.fate, HOME_ID, at);
    const declared = gates ? softerFate(announced) : announced;
    const softer = declared === announced ? '' : ' на ступень мягче объявленной';
    this.liftedFate(HOME_ID, at, declared);
    this.markFall(HOME_ID, declared, at);
    const haul = this.haul(camp?.units ?? {}, false);
    // Окно к этой минуте уже снято (`siegeFalls` → `liftSiege`): хлеб — склад в минуту падения (ОС-1), у голода — ноль:
    // голодом сдаёт только склад, не оплативший прокорм.
    const spoils = this.fateHome(p ?? null, haul.carry, haul.escort, at, declared, gates ? this.homeFood(w, at) : 0);
    const loss = homeLoss(spoils);
    if (FATES[declared].chain) this.save.burnImmune[HOME_ID] = burnImmuneUntil(at);
    const from = this.byId.get(w.byId)?.name ?? camp?.fromName ?? 'Враги';

    this.addReport({
      id: `${w.campId}-fell`,
      at,
      kind: 'defense',
      title: gates ? 'Ворота открыли' : 'Хлеб кончился',
      target: { id: HOME_ID, name: this.homeName(), x: this.save.home.x, y: this.save.home.y },
      won: false,
      sent: { warrior: Math.round(troopTotal(army)) },
      lost: men > 0 ? { warrior: men } : {},
      enemyPower: Math.round(camp?.power ?? 0),
      enemyLost: null,
      loot: spoils.lostTotal > 0 ? loss.resources : null,
      hidden: spoils.hiddenTotal,
      intel: null,
      battle: null,
      ...(loss.fallen ? { fallen: loss.fallen } : {}),
      text: `${
        gates
          ? `На ${rowsOf(w).length}-й фазе осады город открыл ворота лагерю «${from}», гарнизон ушёл живым. Участь${softer}`
          : `${from} взяли город голодом, гарнизон разошёлся. Участь`
      } «${FATE_META[declared].name.toLowerCase()}». ${lossText(declared, spoils)} Лагерь снят.`,
      read: false,
    });
    this.addEffect({
      id: `${w.campId}-fell`,
      lost: men > 0 ? { warrior: men } : {},
      lostTroops: men > 0 ? routed : undefined,
      // Гарнизон рассеян, а не ранен: лазарет его не кладёт (docs/infirmary.md, решение 7).
      routed: true,
      // Взят голодом — хлеба нет (docs/siege_v2.md, 21.1): остаток склада племени съеден осадой.
      ...(gates ? {} : { starved: true as const }),
      prestige: 0,
      morale: -12,
      // Настоящего боя не было: город взяли голодом, и записывать это в
      // проигранные битвы значило бы считать то, чего не случилось.
      battle: null,
      ...loss,
      text: gates
        ? `Ворота открыли: гарнизон ушёл живым, ${FATES[declared].spoils ? 'склад вычищен' : 'город сожжён'}.`
        : `Осада доела город: гарнизон рассеян, ${FATES[declared].spoils ? 'склад вычищен' : 'город сожжён'}.`,
      good: false,
    });
  }

  /**
   * Ближайшее событие осады: падение города, вылазка осаждённого бота, выручка
   * соседей. Ни одно из них не «тикает» — каждое назначено от начала осады или
   * от отметки голода, поэтому офлайн даёт ровно то же, что непрерывная игра.
   *
   * Отдаётся наружу временем, чтобы очередь в `advance` разбирала осады и походы
   * в одном порядке — том самом, в каком они случились бы при непрерывной игре.
   */
  private nextSiegeAt(now: number): { id: SettlementId; at: number } | null {
    let best: { id: SettlementId; at: number } | null = null;
    for (const [id, w] of Object.entries(this.save.sieges)) {
      const since = siegeSince(w);
      // Наш город голодом сдаёт шаг осады, а не час голода окна (ОС-1): у него события — только фазы.
      const home = id === HOME_ID;
      const times = home ? [] : [starvesAt(w)];
      // Фаза осады (`world/siegeroll`): бросок в свою минуту, пока город не доели.
      const roll = nextRollAt(w);
      if (home || roll < starvesAt(w)) times.push(roll);
      if (!w.sortied) times.push(since + SIEGE_SORTIE_AT);
      if (!w.relieved) times.push(since + SIEGE_RELIEF_AT);
      for (const t of times) {
        if (t > now) continue;
        if (!best || t < best.at) best = { id, at: t };
      }
    }
    return best;
  }

  /** Разобрать одно событие осады — то, что случилось раньше прочих. */
  private stepSiege(id: SettlementId, at: number): void {
    const w = this.save.sieges[id];
    if (!w) return;
    if (id !== HOME_ID && at >= starvesAt(w)) return this.siegeFalls(id, at);
    if (at >= nextRollAt(w)) return this.siegePhase(id, at);
    const since = siegeSince(w);
    if (!w.sortied && at >= since + SIEGE_SORTIE_AT) {
      w.sortied = true;
      this.aiSortie(id, at);
      return;
    }
    if (!w.relieved && at >= since + SIEGE_RELIEF_AT) {
      w.relieved = true;
      this.sendRelief(id, at);
    }
  }

  /**
   * Фаза осады в минуту `at` (docs/siege_v2.md, раздел 2): бросок той же дверью, что у сервера войны
   * (`siegeroll.rollPhase`), строка в журнал окна, истощение лагеря (раздел 3), исход. Ворота открыли — город сдаётся той
   * же дверью, что голод, на ступень мягче (`siegeFalls`, ответ владельца 5). Лагерь растаял — осада снята. Потом — наказы
   * нашего лагеря на следующую фазу (8.3). Тика нет: фаза — событие очереди осады, офлайн разбирается так же.
   */
  private siegePhase(id: SettlementId, at: number): void {
    const w = this.save.sieges[id];
    if (!w) return;
    const k = rowsOf(w).length + 1;
    const ours = ourCamp(w);
    // Шаг осады нашего города (ОС-1): добыча → прокорм → проверка — склад племени; не оплатил прокорм — город сдан голодом,
    // и кость этой фазы не бросается. Лагерь логова у города, который кормится сам, уходит: голодом он его не возьмёт.
    if (id === HOME_ID) {
      if (this.homeStarved(w, at)) return this.siegeFalls(id, at);
      if (!Number.isFinite(this.homeDryAhead(w))) return this.campLeaves(w, k, at);
    }
    // Пустой амбар дома удваивает истощение нашего лагеря (раздел 3.3): второго склада у лагеря нет.
    const row = rollPhase(w, k, ours && (this.save.profile?.food ?? 1) <= 0, id === HOME_ID ? this.homeShare(w, at) : undefined);
    w.phases = [...rowsOf(w), row];
    // Выстрелы фазы (Р-5): разбитые машины и требушет на стене — той же дверью, что у сервера войны.
    const shot = shotsApplied(w, row, at);
    if (shot.machines !== w.machines) w.machines = shot.machines;
    if (shot.guns !== w.guns) w.guns = shot.guns;
    const town = id === HOME_ID ? this.homeName() : (this.byId.get(id)?.name ?? 'город');
    const involved = ours || id === HOME_ID;
    // Строка летописи — только когда что-то попало: промахи видны в журнале фаз окна, а не в «Вестях».
    const theirs = (ours ? row.gun : row.shots) ?? [];
    const hit = [...(row.shots ?? []), ...(row.gun ?? [])].some((x) => x.hit);
    const said = shotsText(row.shots ?? [], row.gun ?? [], this.buildingName, (m) => MACHINE_NAME[m]);
    if (involved && hit && said) this.phaseNote(`Осада ${town}, фаза ${k}: ${said}.`, at, !theirs.some((x) => x.hit), 'shots');
    // Попадание, отнимающее уровень, — по нашему городу: последствие один раз, как у обстрела с сервера войны.
    if (id === HOME_ID) (row.shots ?? []).forEach((x, i) => x.lost && x.building && this.shotLoss(`siege-shot-${at}-${i}`, x.building));
    // Истощение — каждую фазу, а строка летописи — только о море: обычная убыль видна в журнале фаз окна осады.
    if (row.waste > 0) {
      const plague = involved && row.out === 'plague';
      this.wearCamp(w, row.waste, at, `Осада ${town}, фаза ${k}: ${OUT_NAMES[row.out]}.`, 'Лагерь тает: болезни, бегство, фураж.', false, plague && ourCamp(w), k);
    }
    if (this.save.sieges[id] !== w) return;
    // Кольцо блокады в минуту фазы (Р-5): держит ли мощь лагеря; лагерь логова замыкает его сам, когда может.
    this.ringCheck(id, w, at);
    if ((this.campArmy(w, at)?.men ?? 0) <= 0) {
      this.liftSiege(id, at, 'wasted');
      if (involved) this.phaseNote(`Лагерь под ${town} растаял к ${k}-й фазе: осада снята.`, at, id === HOME_ID);
      return;
    }
    if (row.out === 'gates') return this.siegeFalls(id, at, 'gates');
    // Мор в нашем лагере уже сказан строкой убыли (`wearCamp`); здесь — пролом и мор в лагере под нашим городом.
    if (involved && (row.out === 'breach' || (row.out === 'plague' && !ours))) {
      const good = (row.out === 'breach') === ours;
      const what = row.out === 'breach' ? `пролом в стене, проломов ${breachesOf(w)} из 3` : 'мор в лагере';
      this.phaseNote(`Осада ${town}, фаза ${k}: ${what}.`, at, good);
    }
    if (ours) this.campOrders(id, w, row, at);
    // Наказы осаждённого — нашего города под лагерем логова (8.3, этап 2г).
    if (id === HOME_ID && !ours) this.homeDefend(w, row, at);
  }

  /** Строка летописи о фазе осады: без потерь и добычи, только весть. `tag` — вторая весть той же минуты (кольцо, выстрелы). */
  private phaseNote(text: string, at: number, good: boolean, tag?: string): void {
    this.addEffect({ id: `siege-phase-${at}${tag ? `-${tag}` : ''}`, lost: {}, resources: {}, prestige: 0, morale: 0, battle: null, text, good });
  }

  /**
   * Наказы нашего лагеря в минуту фазы (docs/siege_v2.md, 8.3) — той же дверью, что ручные приказы, с теми же отказами:
   * штурм, когда проломов не меньше названного (и энергии хватает), иначе залп этой фазы, пока энергии хватает и на залп,
   * и на штурм после него. Не выбирает состав и не ставит прогноза: делает то, что игрок сделал бы кнопкой.
   */
  private campOrders(id: SettlementId, w: SiegeWindow, row: PhaseRow, at: number): void {
    const o = w.orders;
    const target = this.byId.get(id);
    if (!o || !target) return;
    if (orderStorms(o, breachesOf(w))) {
      const declared = this.fateFor(w.fate, id, at);
      if (!this.stormBlock(target, at, declared) && !this.energyCost('general', 'storm', at).block) {
        row.orders = ['storm'];
        this.payEnergy('general', 'storm', at);
        // Отбитый штурм лагерь не снимает (`STORM_HOLDS`), той же дверью, что ручной (`attack`).
        const res = this.attackAt(target, at, declared, w);
        if (res.won) this.siegeDone(id, at);
        if (res.won || troopTotal(this.save.figures.general.troops ?? {}) === 0) {
          // Штурм взял город — осада кончена штурмом с объявленной участью; отбит и штурмовать некому — лагеря больше нет.
          this.liftSiege(id, at, res.won ? 'storm' : 'broken');
          if (res.won) this.liftedFate(id, at, declared);
          this.siegeToReport(res.reportId, id, at);
        }
        return;
      }
    }
    // Наказ «принять дань не меньше справедливой» (8.3): выкуп логова — по справедливой цене, как только он предложен.
    if (o.tribute && lairRansoms(siegeShare(w, at))) {
      this.takeRansom(target, w, at);
      return;
    }
    if (orderVolleys(o, this.energyNow('general', at), priceOf('bombard'), priceOf('storm')) && !craftBlock(w, 'bombard', at)) {
      this.payEnergy('general', 'bombard', at);
      Object.assign(w, craftAfter(w, 'bombard', at));
      row.orders = ['volley'];
    }
  }

  /**
   * Поставить наказы своему лагерю (docs/siege_v2.md, 8.3). Лагерь под городом игрока — приказом серверу войны: наказы
   * разбирает он, в минуту фазы.
   */
  async setOrders(orders: SiegeOrders): Promise<string | null> {
    const now = this.clock();
    const clean = cleanOrders(orders);
    const id = this.ourSiege(now);
    const w = id ? this.save.sieges[id] : null;
    if (!w) {
      const led = this.warLed();
      return led?.phase === 'camp' ? this.warSend({ op: 'orders', id: led.id, orders: clean ?? {} }) : 'Лагеря нет.';
    }
    if (clean) w.orders = clean;
    else delete w.orders;
    this.write();
    return null;
  }

  /**
   * Осаждённый бот выходит на вылазку — если сил хватает. Порог меряный: при
   * единице он выходит только наверняка, и вылазка перестаёт случаться вовсе;
   * ниже половины он выходит на убой. Событие одно на осаду и назначено от её
   * начала: своего тика у ботов здесь нет.
   *
   * Осаждённая деревня игрока сюда не попадает: за неё решает игрок, и решает
   * он тем же боем (`sortie`).
   */
  private aiSortie(id: SettlementId, at: number): void {
    if (id === HOME_ID) return;
    const w = this.siegeOf(id, at);
    const s = this.byId.get(id);
    if (!w || !s) return;
    const camp = this.campArmy(w, at);
    if (!camp) return;
    const power = this.powerNow(s, at);
    // Сравниваются **бойцы строя**, а не мощь с мощью: у лагеря игрока мощь
    // считается головами найма на среднюю силу бойца, а у поселения — своей
    // меркой, и сравнивать их напрямую значило бы сравнивать разное. И
    // сравниваются те, кто пройдёт через рогатки, а не весь гарнизон: стоящие у
    // рогаток не дерутся.
    const g = garrisonOf(this.save.seed, s.id, power, s.castle);
    const gate = this.campGate(id, at, { front: g.kinds });
    if (!gate?.front || Math.min(menOfPower(power), gate.front.room) < camp.men * SIEGE_SORTIE_RATIO) return;
    const garrisonMen = stackTotal(g.kinds);
    const out = this.campBattle(id, at, this.warSeed().seed, { front: { kinds: g.kinds, rest: this.besiegedRest(id, at, garrisonMen) } });
    if (!out || out.refused) return;
    // Мораль гарнизона логова (14.31): дравшиеся вернулись с долей боя, стоявшие у рогаток — со своей.
    if (out.field.result) {
      this.setLairRest(id, rejoin(this.save.lairRest?.[id], at, garrisonMen, out.fought, out.fought * (1 - out.field.attackerLoss), out.field.rest.attacker));
    }
    this.resolveSortieOn(id, at, out.field, `Из ${s.name} вышли на вылазку.`);
    // Гарнизон вышел и поредел: часы голода города считаются заново — один раз,
    // здесь, в самом событии. Потери — доля от дравшихся, на весь гарнизон она
    // переводится через долю тех, кто прошёл к рогаткам.
    const lossOfAll = out.field.attackerLoss * out.share;
    const gone = Math.round(menOfPower(power) * lossOfAll);
    const prev = this.damageOf(id, at);
    this.save.damage[id] = {
      loss: Math.min(0.95, prev + lossOfAll * (1 - prev)),
      at: this.liveAt(id, at),
    };
    this.resiege(id, at, -gone);
  }

  /**
   * Итог удара по лагерю, кто бы ни ударил. Лагерь разбит — осада снята,
   * лагерь устоял — обе стороны недосчитались людей, и осада идёт дальше.
   *
   * Вылазка без урона противнику была бы чистым минусом, и кнопку никто не
   * нажал бы ни разу: поэтому потери лагеря ставятся **в обоих** исходах.
   */
  private resolveSortieOn(id: SettlementId, at: number, field: FieldOutcome, why: string, ring?: BlockadeBreak): number {
    const w = this.save.sieges[id];
    if (!w) return 0;
    // Разбитый лагерь не «устоял» (находка 2а): строка убыли говорит исход того же боя, что снимает осаду.
    const campLost = this.wearCamp(w, field.defenderLoss, at, why, field.won ? 'Лагерь разбит, осада снята.' : undefined);
    if (field.won) this.liftSiege(id, at, 'broken');
    // Лагерь устоял — кольцо после боя (Р-5): удар с поля его размыкает, вылазка — если мощи больше не хватает.
    else if (this.save.sieges[id] === w) this.ringCheck(id, w, at, ring);
    return campLost;
  }

  /**
   * Соседи осаждённого идут на выручку: бьют по лагерю. Событие одно на осаду и
   * назначено от её начала — позже вылазки нарочно, сперва город пробует сам.
   *
   * Кто пойдёт, решают уже заведённые племена, а не новый ИИ: за осаждённого
   * вступается его же двор, чужой — если относится к нему достаточно хорошо.
   *
   * **За деревню игрока не вступается никто, и это решение, а не пропуск.**
   * Осада — то положение, из которого игрок обязан выйти сам: вылазкой, часами
   * голода или потерями. Сосед, снимающий её даром через `SIEGE_RELIEF_AT`, отнял бы у
   * механики всё, ради чего она заведена, — и отнял бы ровно у того игрока,
   * который вложился в отношения. Наверх это правило не растекается: по чужому
   * лагерю игрок ударить может, и его лагерь ударить могут — не может только
   * случиться так, что за него это сделает кто-то другой.
   */
  private sendRelief(id: SettlementId, at: number): void {
    if (id === HOME_ID) return;
    const w = this.siegeOf(id, at);
    const town = this.byId.get(id);
    if (!w || !town) return;
    // Один отряд на выручку за раз: второй превратил бы фон в толчею.
    if (this.save.marches.some((m) => m.relief === id)) return;
    if (!this.campArmy(w, at)) return;
    const byTribe = this.byId.get(w.byId)?.tribeId ?? null;

    let best: GenSettlement | null = null;
    let bestDist = SIEGE_RELIEF_RANGE;
    for (const s of this.gen.settlements) {
      if (s.id === id || s.id === w.byId) continue;
      // Осаждающий и его племя на выручку, понятно, не ходят.
      if (byTribe && s.tribeId === byTribe) continue;
      const friend = town.tribeId !== null && s.tribeId === town.tribeId;
      // Чужому двору нужна причина: он идёт за того, к кому расположен. Своё
      // племя — это и есть «расположен даром».
      if (!friend && -(this.save.diplomacy[s.id]?.attitude ?? 0) < SIEGE_RELIEF_ATTITUDE) continue;
      const d = distance(s, town);
      if (d > bestDist) continue;
      best = s;
      bestDist = d;
    }
    if (!best) return;

    const power = Math.max(2, this.powerNow(best, at) * SIEGE_RELIEF_SHARE);
    const units = warriorsOf(power);
    const seconds = marchSeconds(distance(best, town), terrainFactor(this.save.seed, best, town), units);
    const war = this.warSeed();
    this.save.marches.push({
      id: war.id,
      seed: war.seed,
      mission: 'raid',
      units,
      own: false,
      fromId: best.id,
      targetId: id,
      from: { x: best.x, y: best.y },
      to: { x: town.x, y: town.y },
      fromName: best.name,
      toName: town.name,
      departAt: at,
      arriveAt: at + Math.round(realMs(seconds)),
      phase: 'out',
      power,
      loot: null,
      relief: id,
    });
  }

  /**
   * Отряд выручки дошёл до лагеря. Бой — тот же, что у вылазки, и сторона та же:
   * соседи идут на выручку города и лезут через рогатки, обращённые к нему, — во
   * фронт, тем же проходом, что и вылазка.
   */
  private resolveRelief(m: StoredMarch, at: number): void {
    const id = m.relief as SettlementId;
    const w = this.siegeOf(id, at);
    // Осаду успели снять без них — отряд разворачивается и уходит домой.
    if (!w) return this.reliefHome(m, at, 0);
    const party = raidingParty(this.save.seed, m.id, m.power);
    const out = this.campBattle(id, at, m.seed, {
      front: { kinds: party.kinds, rest: restAt(m.rest, at, stackTotal(party.kinds)) },
      from: m.from,
    });
    // Проход занят — выручка к рогаткам не пробилась и ушла ни с чем.
    if (!out || out.refused) return this.reliefHome(m, at, 0);
    // Уцелевшие уходят домой (MAP-10): потери — доля дравшихся, а дралась только прошедшая через рогатки часть.
    this.reliefHome(m, at, out.field.attackerLoss * out.share);
    const ours = ourCamp(w);
    const campLost = this.resolveSortieOn(id, at, out.field, `${m.fromName} пришли на выручку осаждённым.`, 'relief');
    if (!ours) return;
    // Бьют по нашему лагерю — значит, это наш бой, и отчёт о нём наш.
    const target = this.byId.get(id);
    if (!target) return;
    this.addReport({
      id: `relief-${m.id}`,
      at,
      kind: 'defense',
      title: out.field.won ? `Лагерь разбит: ${m.fromName}` : `Выручка отбита: ${m.fromName}`,
      target: { id, name: target.name, x: target.x, y: target.y },
      won: !out.field.won,
      sent: { warrior: campLost + troopTotal(this.save.figures.general.troops ?? {}) },
      lost: campLost > 0 ? { warrior: campLost } : {},
      enemyPower: Math.round(m.power),
      // Потери — доля от дравшихся, а дралась только прошедшая через рогатки часть.
      enemyLost: Math.round(m.power * out.field.attackerLoss * out.share),
      loot: null,
      intel: null,
      battle: null,
      text:
        (out.field.won
          ? `${m.fromName} пришли на выручку осаждённым и сбили наш лагерь. Осада снята.`
          : `${m.fromName} пришли на выручку осаждённым и были отбиты. Осада стоит.`) +
        (out.share < 1
          ? ` Рогатки задержали их, к бою прошли ${out.fought} из ${out.all}.`
          : ''),
      read: false,
    });
  }

  /**
   * Выручка кончила дело — уцелевшие уходят домой, как поход соседа на соседа (`resolveWar`); прежде отряд снимался с карты
   * в любом исходе (MAP-10). Цели у них больше нет: по дороге домой они не выручка.
   */
  private reliefHome(m: StoredMarch, at: number, loss: number): void {
    m.relief = undefined;
    if (loss > 0) {
      m.power = Math.max(1, m.power * (1 - loss));
      m.units = stackAfter(m.units, stackLosses(m.units, loss));
    }
    if (stackSize(m.units) > 0) this.turnHome(m, at, null);
    else this.remove(m);
  }

  /**
   * Наш полководец садится в осаду под городом, у которого стоит. Тем же окном,
   * теми же часами голода и тем же порядком падения, что у чужой осады: второй
   * реализации у осады нет.
   */
  async besiege(fateId: Fate = FATE_DEFAULT, ring = false): Promise<string | null> {
    const now = this.clock();
    const f = this.save.figures.general;
    const off = this.offDuty('general', now) ?? this.retiringBlock('general');
    if (off) return off;
    // Лагерь под городом игрока: «Объявить» — приказом серверу, той же проверкой участи (docs/siege_audit.md, решение 2).
    if (f.war) {
      const led = this.warLed();
      return led?.phase === 'camp' ? this.warDeclare(led, fateId, now) : WAR_BUSY;
    }
    if (f.phase === 'moving') return 'Полководец ещё в пути.';
    this.settleHandover(f, now);
    if (f.handover) {
      return `Отряд ещё в сборе: ${formatLeft(Math.max(0, f.handover.until - now) / 1000)}.`;
    }
    if (troopTotal(f.troops ?? {}) === 0) return 'При полководце нет отряда.';
    const near = this.touching(this.figureAt(f, now));
    if (!near || near.home) return 'Рядом нет цели.';
    const target = this.byId.get(near.id);
    if (!target) return 'Цель не найдена.';
    if (!this.inRealm(target)) return this.beyond();
    // Участь объявляется приказом и проверяется им же: недоступную не объявить.
    const blocked = fateBlock(fateId, 'world', this.save.burnImmune[target.id], now, this.playerLocks());
    if (blocked) return blocked;
    // «Осаждать» у своего же лагеря — тот же приказ с новой участью: окно остаётся, часы
    // голода и проходы не трогаются, осаждённый видит новую участь сразу.
    const standingCamp = this.siegeOf(target.id, now);
    if (standingCamp && ourCamp(standingCamp)) {
      if (this.fateFor(standingCamp.fate, target.id, now) === fateId) return FATE_SAME;
      standingCamp.fate = fateId;
      this.addEffect({
        id: `camp-fate-${target.id}-${now}`,
        lost: {},
        resources: {},
        prestige: 0,
        morale: 0,
        battle: null,
        text: `Город ${target.name}: объявлена участь «${FATE_META[fateId].name.toLowerCase()}».`,
        good: true,
      });
      this.write();
      return null;
    }
    const why = this.campBlock(target, now, fateId);
    if (why) return why;
    // Осадный лагерь стоит энергию (слово владельца — десять), и пока он стоит, энергия не тратится.
    const tired = this.energyCost('general', 'siege', now).block;
    if (tired) return tired;
    this.pitchCamp(target, now, fateId, priceOf('siege'), ring);
    this.write();
    return null;
  }

  /**
   * Почему полководцу не обложить этот двор мира; null — можно. Одна проверка на «Осадить» у ворот и на «Дойти и
   * осадить» — при приказе и в минуту прихода. Свою осаду с новой участью разбирает `besiege` раньше неё.
   */
  private campBlock(target: GenSettlement, at: number, declared: Fate): string | null {
    if (!this.inRealm(target)) return this.beyond();
    // Налегке лагерь не встаёт (ДР-2, М7): одна проверка на кнопку, приказ и минуту прихода.
    const noCamp = siegeBlockOf(this.save.figures.general.gait);
    if (noCamp) return noCamp;
    if (!this.alive(target, at)) return 'Здесь только пепелище: брать нечего.';
    if (standingAt(this.diploOf(target.id, at), at) === 'pact') return 'Пакт в силе, осады не будет. Разрыв объявляет дипломат.';
    // Участь объявляется приказом и проверяется им же: недоступную не объявить.
    const blocked = fateBlock(declared, 'world', this.save.burnImmune[target.id], at, this.playerLocks());
    if (blocked) return blocked;
    if (this.save.sieges[target.id]) return 'Под этими стенами уже стоит лагерь.';
    if (siegeImmune(this.save.siegeImmune[target.id], at)) return 'Город недавно доели: в амбаре пусто, осаждать нечего.';
    return null;
  }

  /**
   * Полководец ставит лагерь под `target` в минуту `at` — одна дверь на «Осадить» у ворот и на приход с приказом «Дойти
   * и осадить». `price` — цена лагеря, если она ещё не заплачена (у «Дойти и осадить» её списал приказ): с этой минуты
   * энергия в лагере стоит.
   */
  private pitchCamp(target: GenSettlement, at: number, fateId: Fate, price: number, ring = false): void {
    const f = this.save.figures.general;
    const before = this.energyOf('general', at);
    // Лагерь игрока делит древесину сам, в окне осады; встаёт он со всем во фронт.
    const w = this.openSiegeAt(target.id, HOME_ID, PLAYER_CAMP, at, 0, { fate: fateId, wood: playerWood(WOOD_SHARES[0]) });
    this.restance('general', at, before, price);
    const now = at;
    // «Блокада» (Р-5): кольцо в минуту постановки — той же проверкой, что приказ в окне лагеря; нет мощи — обычная осада.
    let ringText = '';
    if (ring) {
      const camp = this.campArmy(w, at);
      const why = camp ? blockadeBlock(w, at, camp.power, this.garrisonPower(target.id, at)) : 'Лагеря нет.';
      if (why) ringText = ` Кольца не замкнули: ${why[0].toLowerCase()}${why.slice(1)}`;
      else {
        Object.assign(w, blockadeAfter(w, at, true));
        ringText = ` Кольцо замкнуто. ${BLOCKADE_GIVES}`;
      }
    }
    this.addReport({
      id: `siege-set-${target.id}-${now}`,
      at: now,
      kind: 'support',
      title: `Осада: ${target.name}`,
      target: { id: target.id, name: target.name, x: target.x, y: target.y },
      won: true,
      sent: { warrior: troopTotal(f.troops ?? {}) },
      lost: {},
      enemyPower: Math.round(this.powerNow(target, now)),
      enemyLost: null,
      loot: null,
      intel: null,
      battle: null,
      text: `Отряд обложил город ${target.name}. Участь «${FATE_META[fateId].name.toLowerCase()}».${ringText} ${CAMP_LEAVE}`,
      read: false,
    });
    this.moveAttitude(target.id, ATTACK_ATTITUDE, now);
  }

  /**
   * Вылазка. Состав выбирает игрок — не «всё или ничего»: гарнизон, вышедший
   * весь, оставил бы стену пустой, а это уже не решение, а ловушка.
   *
   * Победа снимает осаду. Поражение её не снимает, но лагерь тоже теряет людей,
   * — иначе вылазка была бы чистым минусом и кнопку не нажали бы ни разу. И в
   * том и в другом случае часы голода считаются заново от нового гарнизона:
   * ровно один раз, здесь, в самом событии.
   */
  async sortie(troops: TroopStack): Promise<AttackResult> {
    const now = this.clock();
    const w = this.homeSiege(now);
    if (!w) {
      // Под стенами лагерь игрока: вылазку бьёт сервер (docs/pvp.md).
      const pvp = this.warOnUs();
      return pvp ? this.warSortie(pvp, troops, now) : { error: 'Под стенами никого.', reportId: null, won: false };
    }
    // Выходят из гарнизона — вместе с дружиной, если полководец в городе: дома она
    // и есть гарнизон (`world/muster`), и за ворота выходит этой же вылазкой.
    // Через фронт: вылазка лезет в рогатки, обращённые к городу.
    const held = this.defenders(now);
    const home = held.all;
    const going = pickTroops(troops, home);
    if (!going) return { error: 'Столько бойцов дома нет.', reportId: null, won: false };
    const men = troopTotal(going);
    if (men === 0) return { error: 'Отряд пустой.', reportId: null, won: false };

    // Проход занят — отказ до боя, и сид похода не тратится.
    const gate = this.campGate(HOME_ID, now, { front: kindsOf(going) });
    if (gate?.front && refusedAtGate(gate.front)) {
      return { error: gateBusyText(gate.front.waitMs), reportId: null, won: false };
    }
    const seed = marchSeed(this.save.seed, this.save.nextMarch++);
    // Мораль вышедших (14.31): гарнизон и стоящая дома дружина — каждый своей парой, по тем, кто вышел.
    const goingStanding = standingShare(held.own, held.standing, going);
    const rest = mixRest([
      { rest: this.garrisonRest(held.own, now), men: this.menOf(troopsAfter(going, goingStanding)) },
      { rest: this.generalRest(now), men: this.menOf(goingStanding) },
    ]);
    const out = this.campBattle(HOME_ID, now, seed, { front: { own: going, rest } });
    if (!out || out.refused || !out.front) return { error: 'Лагеря под стенами уже нет.', reportId: null, won: false };
    const { field, camp, front: through } = out;

    // Потери боя — только из дравшихся, и снимаются они с отряда тем же правилом,
    // что у любого боя: по родам, слабые первыми. Дружина, вышедшая с гарнизоном,
    // теряет свою долю тут же — тем же правилом, что у частокола.
    const lostTroops = field.result ? troopLosses(going, out.lost.front) : {};
    const lostMen = troopTotal(lostTroops);
    if (field.result) this.homeBack(held, going, lostTroops, field.rest.attacker, now, out.share);
    const standing = this.standingLost(held.own, held.standing, lostTroops);
    const campLost = this.resolveSortieOn(HOME_ID, now, field, 'Мы вышли на вылазку.');

    const record: BattleRecord | null = field.result
      ? {
          us: 'attacker',
          result: field.result,
          // Состав — пропорция лиц для показа; сколько дралось, говорит сам бой
          // (`result`): прошедшие через рогатки — та же доля от каждого рода.
          troops: { attacker: { ...going }, defender: troopsOfKinds(camp.kinds, camp.gear) },
          // Бой у своих ворот: место снимается там же, где стоит деревня.
          place: this.placeOf(this.save.home),
          site: 'sortie',
        }
      : null;

    const reportId = `sortie${seed}`;
    this.addReport({
      id: reportId,
      at: now,
      kind: 'defense',
      title: field.won ? `Вылазка удалась: ${camp.name}` : `Вылазка отбита: ${camp.name}`,
      target: { id: HOME_ID, name: this.homeName(), x: this.save.home.x, y: this.save.home.y },
      won: field.won,
      sent: { warrior: men },
      lost: lostMen > 0 ? { warrior: lostMen } : {},
      enemyPower: Math.round(camp.power),
      enemyLost: campLost,
      loot: null,
      intel: null,
      battle: record,
      through: { went: through.went, passed: through.passed },
      text:
        (field.won
          ? `Гарнизон вышел из ворот и разметал лагерь. Осада снята, город снова ест.`
          : `Лагерь отбился. Осада стоит, но и они потеряли ${campLost}.`) + throughText(through),
      read: false,
    });
    this.addEffect({
      id: `${reportId}-eff`,
      lost: lostMen > 0 ? { warrior: lostMen } : {},
      lostTroops,
      ...(troopTotal(standing) > 0 ? { standing } : {}),
      resources: {},
      prestige: field.won ? 4 : 0,
      morale: field.won ? 6 : -5,
      battle: field.won ? 'won' : 'lost',
      ...scarOf(field, 'attacker'),
      text: field.won ? 'Вылазка сняла осаду.' : 'Вылазка отбита, лагерь стоит.',
      good: field.won,
    });
    // Осада снята победой — считать часы голода больше не по чему. Не снята —
    // гарнизон стал меньше на потери, и часы идут от него. Потери к этой минуте
    // уже списаны (`addEffect`), поэтому поправки не нужно.
    if (!field.won) this.resiege(HOME_ID, now);
    this.write();
    return { error: null, reportId, won: field.won };
  }


  /**
   * Место боя на клетке: земля, переправа, гребень, тракт плюс игровое время
   * племени из последнего слепка деревни. Мир его не толкует — он ставит его
   * отметкой на записи, а читает уже показ.
   */
  private placeOf(at: Coord): BattlePlace {
    return placeAt(this.save.seed, at.x, at.y, this.save.profile?.time);
  }

  /** Насколько гарнизон ещё не отстроился после последнего разгрома. */
  private damageOf(id: SettlementId, now: number): number {
    const d = this.save.damage[id];
    if (!d) return 0;
    const k = 1 - (this.liveAt(id, now) - d.at) / DAMAGE_RECOVER;
    return k <= 0 ? 0 : d.loss * k;
  }

  /** Свои отряды, стоящие в поселении поддержкой. */
  private supportIn(id: SettlementId): number {
    let p = 0;
    for (const m of this.save.marches) if (m.phase === 'stay' && m.targetId === id) p += m.power;
    return p;
  }

  private powerNow(s: GenSettlement, now: number): number {
    // Логово растёт по своей кривой — от опоры и времени появления, с потолком
    // (`world/lairs.ts`). Общий рост соседей ему не годится: он без потолка по
    // сути (до `POWER_GROWTH_CAP` от базы) и считается от возраста мира, а
    // логово может завестись сегодня. Часы берутся собственные, как у соседей:
    // бунт останавливает и рост логова тоже.
    // Испытательный стенд (`world/mirror.ts`): одно логово у порога зеркалит
    // войско игрока вместо собственной кривой роста. По умолчанию выключен, и
    // тогда сборщик выбрасывает и эту ветку, и весь модуль: ни байта в сборке.
    const mirror = MIRROR_ON
      ? mirrorPower(
          { lairs: this.gen.settlements, home: this.save.home, seed: this.save.seed, profile: this.save.profile ?? null },
          (x, t) => this.alive(x, t),
          s,
          now,
        )
      : null;
    const base =
      mirror ??
      (isLair(s)
        ? lairPower(this.anchorOf(s), this.lairRec(s.id), this.liveAt(s.id, now), this.save.profile?.pop ?? 0)
        : powerOf(s, this.lived(s, now), POWER_GROWTH_CAP));
    // Пока идёт бунт, гарнизон занят своими: он слабее ровно на объявленную долю.
    const revolt = revoltPower(this.inRevolt(s.id, now));
    // Разорение бьёт по той же величине и тем же способом. Это **сверх** того,
    // что снёс сам бой (`damageOf`), и сверх нарочно: разбитый гарнизон при
    // стоящих часах не чинится вовсе, а разорённый двор ещё и не может выставить
    // тех, кто разбежался с пожарища.
    const sack = sackPower(this.isSacked(s.id, now));
    return Math.max(
      1,
      base * revolt * sack * (1 - this.damageOf(s.id, now)) + this.supportIn(s.id),
    );
  }

  private popNow = (s: GenSettlement, now: number): number =>
    isLair(s)
      ? lairPop(this.powerNow(s, now))
      : popOf(s, this.lived(s, now), POWER_GROWTH_CAP);

  /**
   * Враждебность племени. Своим полем в сохранении она больше не живёт: это
   * средняя обида по его дворам, а обида — это отношение с минусом. Одна
   * величина, один источник; порог договоров (`DEALS`) читает то же самое.
   */
  private hostilityOf(tribeId: string | null): number {
    if (!tribeId) return 0;
    let sum = 0;
    let count = 0;
    for (const s of this.gen.settlements) {
      if (s.tribeId !== tribeId) continue;
      count++;
      sum += Math.max(0, -(this.save.diplomacy[s.id]?.attitude ?? 0));
    }
    return count === 0 ? 0 : Math.min(100, sum / count);
  }

  private relationOf(s: GenSettlement): Relation {
    if (!s.tribeId) return 'barbarian';
    // Война с самим этим двором сильнее всего прочего: она объявлена ему, а не
    // племени, и на карте он обязан покраснеть сразу.
    if (this.standingOf(s, this.clock()) === 'war') return 'enemy';
    // Подписанный союз — тоже союз: дипломат для того и ходит, чтобы менять
    // отношения, а не только смотреть на них.
    if (this.pactActive(s.tribeId, 'alliance')) return 'ally';
    const h = this.hostilityOf(s.tribeId);
    if (h >= HOSTILITY_ENEMY) return 'enemy';
    if (s.tribeId === this.save.allyTribe && h < HOSTILITY_ALLY_BREAK) return 'ally';
    return 'neutral';
  }

  // ---------- Отношения с поселениями ----------

  /**
   * Разворачивает племенную враждебность из сохранения версии 4 в отношения
   * поселений. Делается один раз, при подключении мира: в `parseWorldSave` для
   * этого нет самого мира — там неизвестно, какие дворы у какого племени.
   */
  private expandLegacyHostility(): void {
    const old = this.save.legacyHostility;
    if (!old) return;
    const now = this.clock();
    for (const s of this.gen.settlements) {
      const h = s.tribeId ? old[s.tribeId] : 0;
      if (!h) continue;
      const rec = this.save.diplomacy[s.id] ?? freshRecord(now);
      rec.attitude = clampAttitude(rec.attitude - h);
      this.save.diplomacy[s.id] = rec;
    }
    delete this.save.legacyHostility;
  }

  /**
   * Насколько чужая вера портит знакомство с этим двором. Ноль, пока своей веры
   * нет или двора на карте не нашлось.
   *
   * Двор берёт веру там же, где её берёт замок игрока, — у земли под собой.
   * Поселений ботов на общей карте сейчас нет ни одного, так что живого
   * применения у этого пока нет: механика ждёт участников, как дипломатия,
   * письма и осады (`grep -rn waitsForPlayers src`). Заведена она здесь, а не
   * рядом с ними, по одной причине — стартовое отношение заводится ровно в
   * одном месте, и второго такого быть не должно.
   */
  private faithShift(id: SettlementId): number {
    const mine = this.save.profile?.faith;
    if (!mine) return 0;
    const s = this.gen.settlements.find((x) => x.id === id);
    return s ? faithAttitude(mine, faithAt(s.x, s.y)) : 0;
  }

  /** Характер владельца: один на все его дворы, потому что владелец один. */
  private temperOfSettlement = (s: GenSettlement): TemperId =>
    temperOf(this.save.seed, s.owner ?? s.id);

  /**
   * Отношения с двором. Если состояние успело смениться само (пакт истёк,
   * настал срок объявленного разрыва), запись правится тут же — это не тик, а
   * приведение при чтении: считать одно и то же дважды нельзя.
   */
  private diploOf(id: SettlementId, now: number): DiploRecord {
    const rec = this.save.diplomacy[id] ?? freshRecord(now, this.faithShift(id));
    const settled = standingAt(rec, now);
    if (settled !== rec.standing) {
      rec.standing = settled;
      rec.since = rec.breakAt > 0 && settled === 'war' ? rec.breakAt : rec.until || now;
      rec.until = 0;
      rec.breakAt = 0;
      this.save.diplomacy[id] = rec;
    }
    return rec;
  }

  private standingOf = (s: GenSettlement, now: number): Standing =>
    standingAt(this.save.diplomacy[s.id] ?? { attitude: 0, standing: 'neutral', since: 0, until: 0, breakAt: 0 }, now);

  /** Сдвинуть отношение. Единственная дверь: считать его больше негде. */
  private moveAttitude(id: SettlementId, delta: number, now: number): void {
    const rec = this.diploOf(id, now);
    rec.attitude = clampAttitude(rec.attitude + delta);
    this.save.diplomacy[id] = rec;
  }

  /** Сколько дворов воюет с нами прямо сейчас. Из этого и считается потолок мести. */
  private warsOnUs(now: number): number {
    let n = 0;
    for (const s of this.gen.settlements) if (this.standingOf(s, now) === 'war') n++;
    return n;
  }

  /**
   * Ответ соседа на набег. Второй системы отношений здесь не заводится: набег
   * уже уронил отношение обычным `moveAttitude`, а это — единственное, чего
   * прежней системе не хватало, чтобы «отношения портятся» имело последствия.
   * Сосед не отвечал ничем: он копил обиду до самого дна шкалы и оставался в
   * нейтралитете, то есть ходил в набеги не намного чаще ровного.
   *
   * Лестница поэтому такая: первый набег роняет двор в неприязнь, второй — в
   * лютую вражду, третий переводит её в войну, и **отсюда** уже идёт всё
   * остальное — набеги оттуда охотнее в `AI_WAR_WEIGHT` раз и общий темп
   * быстрее (`AI_WAR_PACE`). Ни одного нового числа в набегах для этого не
   * понадобилось.
   *
   * Потолков у мести четыре, и три из них стояли до этой задачи. Новый — только
   * `REVENGE_WARS_MAX`: больше стольких войн разом на голову не свалится. Прежние:
   * шкала отношения снизу заперта (`ATTITUDE_MIN`), то есть охотнее некуда; набег
   * на нас один за раз и не сильнее логова, из которого вышел; чаще, чем
   * `AI_ATTACK_MIN` × `AI_WAR_PACE`, из очереди ничего не выходит. Выход из мести —
   * дипломат: `peace` возвращает нейтралитет, и место в потолке освобождается.
   *
   * Зовётся это **и после проигранного набега**: наживают врагов нападением, а
   * не победой.
   */
  private avenge(target: GenSettlement, at: number): void {
    // У варваров старейшин нет, воевать некому объявлять.
    if (!target.tribeId) return;
    const rec = this.diploOf(target.id, at);
    // Уже воюем — объявлять нечего; под пактом набега не бывает вовсе.
    if (standingAt(rec, at) !== 'neutral') return;
    if (rec.attitude > REVENGE_ATTITUDE) return;
    if (this.warsOnUs(at) >= REVENGE_WARS_MAX) return;
    rec.standing = 'war';
    rec.since = at;
    rec.until = 0;
    rec.breakAt = 0;
    this.save.diplomacy[target.id] = rec;
    this.addReport({
      id: `war${target.id}-${at}`,
      at,
      kind: 'defense',
      title: `Нам объявили войну: ${target.name}`,
      target: { id: target.id, name: target.name, x: target.x, y: target.y },
      won: false,
      sent: {},
      lost: {},
      enemyPower: null,
      enemyLost: null,
      loot: null,
      intel: null,
      battle: null,
      text: `${target.name} объявили нам войну. Набеги оттуда пойдут чаще. Мир заключает дипломат.`,
      read: false,
    });
  }

  private diploView(s: GenSettlement, now: number): DiploView {
    const rec = this.diploOf(s.id, now);
    return { ...rec, standing: standingAt(rec, now), temper: this.temperOfSettlement(s), mood: moodOf(rec.attitude) };
  }

  /** Договор с племенем в силе прямо сейчас? */
  private pactActive(tribeId: string | null, deal: DealId): boolean {
    if (!tribeId) return false;
    const pact = this.save.pacts[tribeId]?.[deal];
    return Boolean(pact && pact.until > this.clock());
  }

  private tribeName = (id: string | null): string | null =>
    this.gen.tribes.find((t) => t.id === id)?.name ?? null;

  /**
   * Поселение на карте. Здесь и живёт второй слой тумана: пока клетка в обзоре,
   * живые данные настоящие; вышла из обзора — показывается последнее увиденное,
   * и об этом сказано полем `stale`, а не умолчанием.
   */
  private view(s: GenSettlement, now: number, discs: SightDisc[]): SettlementView {
    const visible = inSight(discs, s.x, s.y);
    const ruin = this.phaseOf(s, now) === 'ruin';
    // Пепелище показывает само себя, а не последний взгляд на живое логово:
    // помнить сожжённое как стоящее значило бы врать о собственной победе.
    if (ruin) return this.ruinView(s, now, visible);
    const seen = this.save.sightings[s.id] ?? null;
    const relation = visible ? this.relationOf(s) : (seen?.relation ?? 'neutral');
    const stage = visible ? stageOf(this.powerNow(s, now), this.popNow(s, now)) : (seen?.stage ?? 'camp');
    return {
      id: s.id,
      x: s.x,
      y: s.y,
      name: s.name,
      stage,
      relation,
      owner: visible ? s.owner : (seen?.owner ?? null),
      tribeId: visible ? s.tribeId : (seen?.tribeId ?? null),
      tribeName: this.tribeName(visible ? s.tribeId : (seen?.tribeId ?? null)),
      color: RELATION_META[relation].color,
      mine: false,
      castle: s.castle,
      visible,
      seenAt: visible ? now : (seen?.at ?? null),
      stale: !visible && seen !== null,
      seenPop: visible ? Math.round(this.popNow(s, now)) : (seen?.pop ?? null),
      // Выходящее войско видно только пока смотришь: это самая живая из живых
      // величин, и помнить её со вчерашнего дня было бы враньём.
      marching: visible && this.save.marches.some((m) => m.fromId === s.id && m.phase === 'out'),
      ruin: false,
      // Разорение — живые данные, как стадия и численность: в обзоре настоящие,
      // вне его — из последнего снимка. Помнить разорённым отстроившийся двор
      // так же неверно, как помнить его численность, и врёт это одинаково.
      sacked: visible ? this.isSacked(s.id, now) : (seen?.sacked ?? false),
      besieged: this.mapSiege(s.id, now, visible),
      fell: this.fellOf(s.id, now),
    };
  }

  /**
   * Пепелище на месте сожжённого логова. Стадия у него всегда самая мелкая, а
   * отношение остаётся варварским: это след разбойников, а не ничья земля.
   * Живых данных у него нет вовсе — их и не бывает у пепелища.
   */
  private ruinView(s: GenSettlement, now: number, visible: boolean): SettlementView {
    return {
      id: s.id,
      x: s.x,
      y: s.y,
      name: s.name,
      stage: 'camp',
      relation: 'barbarian',
      owner: null,
      tribeId: null,
      tribeName: null,
      color: RELATION_META.barbarian.color,
      mine: false,
      castle: false,
      visible,
      seenAt: this.save.lairs[s.id]?.burnedAt ?? now,
      stale: false,
      seenPop: 0,
      marching: false,
      ruin: true,
      // Пепелище не «разорено»: разорять там больше нечего и некого.
      sacked: false,
      // У пепелища нет ни лагеря, ни участи: след говорит сам за себя.
      besieged: null,
      fell: null,
    };
  }

  private homeView(now: number): SettlementView {
    const p = this.save.profile;
    return {
      id: HOME_ID,
      x: this.save.home.x,
      y: this.save.home.y,
      name: this.homeName(),
      stage: stageOf(p?.defense ?? 0, p?.pop ?? 0),
      relation: 'self',
      owner: p?.name ?? 'Ты',
      tribeId: null,
      tribeName: 'Твоя держава',
      color: RELATION_META.self.color,
      mine: true,
      castle: false,
      // Свой дом виден всегда и целиком: тумана над собой не бывает.
      visible: true,
      seenAt: now,
      stale: false,
      seenPop: Math.round(p?.pop ?? 0),
      marching: this.save.marches.some((m) => m.own && m.phase === 'out'),
      ruin: false,
      sacked: false,
      besieged: this.mapSiege(HOME_ID, now, true),
      fell: this.fellOf(HOME_ID, now),
    };
  }

  /**
   * Имя своего города — одно на карту, отчёты, походы и письма. Слепок везёт его из
   * сохранения племени, и мир читает его только через очистку договора: сохранение мира
   * лежит на диске и на сервере, и строке в нём верить нельзя.
   */
  protected homeName(): string {
    return cityOr(this.save.profile?.city);
  }

  /**
   * Знак павшего города на минуту `now`: запись, если она ещё не сошла (`FALL_MARK`).
   * Чистое чтение — ни тика, ни уборки: запись старше срока просто не показывается.
   */
  private fellOf(id: SettlementId, now: number): FellMark | null {
    const rec = this.save.falls[id];
    return rec && now >= rec.at && now < rec.at + FALL_MARK ? { fate: rec.fate, at: rec.at } : null;
  }

  /** Город взят: запомнить участь для знака на карте. Новое падение перезаписывает старое. */
  private markFall(id: SettlementId, fate: Fate, at: number): void {
    this.save.falls[id] = { fate, at };
  }

  /**
   * Участник ли игрок этой осады: осаждён его город или под стенами стоит его лагерь.
   * Одна проверка на всё, что показывает осаду изнутри, — часы голода в карточке, в окне
   * обороняющегося и в окне лагеря, и конец рогаток на карте.
   */
  private siegeInsider(id: SettlementId, w: SiegeWindow): boolean {
    return id === HOME_ID || ourCamp(w);
  }

  /**
   * Часы голода — **одно** чтение окна на все места, где игрок их видит: окно
   * обороняющегося (`siegeView`), окно лагеря (`camp`) и карточка города (`cardSiege`).
   * null — осады нет или игрок в ней не участвует: со стороны амбар не виден.
   */
  private hungerOf(id: SettlementId, now: number): number | null {
    const w = this.siegeOf(id, now);
    return w && this.siegeInsider(id, w) ? this.hunger(w) : null;
  }

  /**
   * Сама минута голода из окна. Звать напрямую можно только там, где участие уже известно. У нашего города (ОС-1) — конец
   * осады без нашего вмешательства: шаг голода по прогнозу склада, а у сытого — фаза, в которую лагерь логова уйдёт.
   */
  protected hunger(w: SiegeWindow): number {
    if (this.save.sieges[HOME_ID]?.campId !== w.campId) return starvesAt(w);
    const step = this.homeHungerStep(w);
    return Number.isFinite(step) ? step : nextRollAt(w);
  }

  // ---------- Хлеб нашего города в осаде (ОС-1, docs/siege_v2.md, раздел 23) ----------
  //
  // Правда — склад племени: шаг племени судит, оплачен ли прокорм (`sim/siege.siegeHunger`), и слепок везёт засуху (`dryFor`)
  // и прогноз (`dryIn`) в игровых секундах от минуты пульса. Пока племя об осаде не знает (слепок лёг до постановки: догон
  // без мира), мир судит склад окном — тем же правилом шага (`siegefood.starves`), от хлеба и добычи слепка минуты постановки.

  /** Знает ли слепок об осаде: склад судит племя. */
  private homeBesieged(): boolean {
    return Boolean(this.save.profile?.besieged);
  }

  /** Мировая минута по игровым секундам слепка: `ago` секунд назад (меньше нуля — вперёд) от минуты пульса. */
  private profileMinute(ago: number): number {
    return (this.save.profileAt ?? this.clock()) - realMs(ago);
  }

  /** С какой минуты склад нашего города не оплачивает прокорм; кормит — бесконечность. По окну — минута, когда его хлеб ниже нуля. */
  private homeDryAhead(w: SiegeWindow): number {
    const p = this.save.profile;
    if (!this.homeBesieged()) return starvesAt(w);
    if (p?.dryFor !== undefined) return this.profileMinute(p.dryFor);
    return p?.dryIn !== undefined ? this.profileMinute(-p.dryIn) : Infinity;
  }

  /** Шаг осады, в котором склад нашего города, по засухе или прогнозу, не оплатит прокорм; не опустеет — бесконечность. */
  protected homeHungerStep(w: SiegeWindow): number {
    return hungerStepAt(siegeSince(w), this.homeDryAhead(w));
  }

  /**
   * Не оплатил ли склад нашего города прокорм к шагу `at` (ОС-1): засуха склада началась не позже этой минуты; без слепка
   * осады — хлеб окна ниже нуля (`siegefood.starves`). Ровно ноль — оплачен.
   */
  private homeStarved(w: SiegeWindow, at: number): boolean {
    const p = this.save.profile;
    if (!this.homeBesieged()) return starves(breadAt(w, at));
    return p?.dryFor !== undefined && this.profileMinute(p.dryFor) <= at;
  }

  /** Хлеб нашего города в минуту `at`: склад слепка, а без слепка осады — остаток окна. */
  private homeFood(w: SiegeWindow, at: number): number {
    return this.homeBesieged() ? Math.max(0, this.save.profile?.food ?? 0) : foodLeft(w, at);
  }

  /** Доля хлеба нашего города для поправки «голод» кости (ОС-1): склад к хлебу в минуту, когда встал лагерь. */
  private homeShare(w: SiegeWindow, at: number): number {
    if (!this.homeBesieged()) return breadLeft(w, at);
    const ref = w.breadAtSince ?? w.foodAtStart;
    return ref > 0 ? Math.min(1, Math.max(0, this.homeFood(w, at) / ref)) : 0;
  }

  /**
   * Лагерь логова у города, который кормится сам, уходит в шаге осады (ОС-1): голодом он его не возьмёт, а дел у бота нет.
   * Нашему городу — донесение с записью осады.
   */
  private campLeaves(w: SiegeWindow, k: number, at: number): void {
    const camp = this.campArmy(w, at);
    const by = this.byId.get(w.byId)?.name ?? 'Враги';
    this.liftSiege(HOME_ID, at, 'left');
    // Донесение — с записью осады (ролик): снятие лагеря — исход осады, как падение или разбитый лагерь.
    this.addReport({
      id: `${w.campId}-left`,
      at,
      kind: 'defense',
      title: 'Осада снята',
      target: { id: HOME_ID, name: this.homeName(), x: this.save.home.x, y: this.save.home.y },
      won: true,
      sent: {},
      lost: {},
      enemyPower: Math.round(camp?.power ?? 0),
      enemyLost: null,
      loot: null,
      intel: null,
      battle: null,
      text: `${by} сняли осаду на ${k}-й фазе: город кормится сам, голодом его не взять. Лагерь ушёл.`,
      read: false,
    });
  }

  /**
   * Штраф к добыче и прогноз склада окну (ОС-1) — числа, слова о них пишет окно (`siegewords`): соотношение сил мерки кольца,
   * штраф дверью `siegefood` и, для сведения, минута, когда склад не оплатит прокорм (нет поля — не опустеет).
   */
  private breadView(campPower: number, garrisonPower: number, dryAt: number): Pick<SiegeView, 'cut' | 'ratio' | 'dryAt'> {
    const ratio = blockadeRatio(campPower, garrisonPower);
    return { cut: siegeCut(ratio), ratio, ...(Number.isFinite(dryAt) ? { dryAt } : {}) };
  }

  /**
   * Паёк наоборот в окне осаждённого (ОС-1): шаг голода и минута пустого склада — той же мерой, что окно (`hunger`): у нашего
   * города под логовом — прогноз склада племени, под лагерем игрока — окно сервера.
   */
  private rationAnswer(w: SiegeWindow, now: number): SiegeAnswers['ration'] {
    const home = this.save.sieges[HOME_ID]?.campId === w.campId;
    const dry = home ? this.homeDryIfRation(w, now) : starvesIfRation(w, now, !w.ration);
    return { on: Boolean(w.ration), starvesAt: hungerStepAt(siegeSince(w), dry), ...(Number.isFinite(dry) ? { dryAt: dry } : {}) };
  }

  /** Прогноз склада нашего города с пайком наоборот (ОС-1): «урежешь — хватит до…». Без слепка осады — окном. */
  private homeDryIfRation(w: SiegeWindow, now: number): number {
    const p = this.save.profile;
    if (!this.homeBesieged()) return starvesIfRation(w, now, !w.ration);
    if (p?.dryFor !== undefined) return this.profileMinute(p.dryFor);
    return p?.dryInRation !== undefined ? this.profileMinute(-p.dryInRation) : Infinity;
  }

  /**
   * Осада глазами карты: рогатки вокруг города. Видна участнику всегда, остальным — только
   * в живом обзоре, тем же правилом, что численность и разорение. Срок голода едет только
   * участнику (`hungerOf`): по нему рогатки сходят с карты в минуту падения, а со стороны
   * эту минуту знать неоткуда.
   */
  private mapSiege(id: SettlementId, now: number, visible: boolean): MapSiege | null {
    const w = this.siegeOf(id, now);
    if (!w) return null;
    if (!this.siegeInsider(id, w) && !visible) return null;
    const hunger = this.hungerOf(id, now);
    // Рогатки на карте — те, что стоят на самом деле: под обстрелом фронт растёт медленнее.
    const wood = this.campArmy(w, now)?.wood ?? w.wood;
    return {
      since: siegeSince(w),
      ...(wood !== undefined ? { wood } : {}),
      ...(hunger !== null ? { starvesAt: hunger } : {}),
    };
  }

  private addReport(r: Report): void {
    // Донесение о городе в минуту снятия его осады — падение, дань, выкуп, бой, разбивший лагерь, — несёт запись осады
    // (`world/siegerecord`, ролик осады). Одна запись — одно донесение: первое после снятия.
    const l = this.lifted;
    if (l && !r.siege && r.target.id === l.id && r.at === l.at) {
      r.siege = l.rec;
      this.lifted = null;
    }
    this.save.reports.unshift(r);
    if (this.save.reports.length > REPORTS_KEPT) this.save.reports.length = REPORTS_KEPT;
    this.fresh.push(r);
  }

  private addEffect(e: HomeEffect): void {
    this.save.effects.push(e);
    this.bury(e.lostTroops);
  }

  /**
   * Павших мир списывает со своего знания о войске сразу, а не на следующем
   * слепке. Племя узнает о них только на пульсе, а гарнизон — всё войско минус
   * ушедшие — мир читает в ту же минуту: без этого убитых на вылазке можно было
   * бы тут же отдать полководцу, а павших при полководце — ещё раз посчитать
   * дома, потому что из его строя они уже вычеркнуты, а из слепка ещё нет.
   */
  private bury(lost: TroopStack | undefined): void {
    const p = this.save.profile;
    if (!p || !lost || troopTotal(lost) === 0) return;
    this.save.profile = { ...p, army: troopsAfter(p.army ?? {}, lost) };
  }

  private remove(m: StoredMarch): void {
    const i = this.save.marches.indexOf(m);
    if (i >= 0) this.save.marches.splice(i, 1);
    // За этим отрядом могли гнаться: цель исчезла — встреча пересчитывается
    // (а точнее, срывается) прямо здесь, в событии, а не тиком где-то ещё.
    this.rechase(m.id, this.clock());
  }

  /**
   * Снимок гарнизона: численность, состав по родам и построение. Состав выводится
   * из мощи и сида (см. garrison.ts), поэтому разведка и бой видят одно и то же
   * войско, а не два разных. План, приказы и резерв в снимок не попадают — их
   * разведка не даёт, и вся неопределённость держится на этом.
   *
   * Стойкость (`keen`) пишется здесь, в момент разведки, по Дозору из слепка
   * деревни: данные, собранные хорошим дозором, и остаются хорошими, а построенный
   * потом Дозор старый снимок не молодит. Поле было объявлено и читалось
   * (`intel.readIntel`), но записано не было ни разу — улучшение Дозора обещало
   * стойкость разведданных и не давало её. Держит это тест «снимок несёт всё,
   * что читает readIntel» в world.test.ts.
   */
  private snapshot(s: GenSettlement, now: number): Intel {
    const power = this.powerNow(s, now);
    const g = garrisonOf(this.save.seed, s.id, power, s.castle);
    return {
      at: now,
      keen: Math.max(1, this.save.profile?.intelKeen ?? 1),
      power,
      pop: this.popNow(s, now),
      // Разведка видит амбары, а не подпол: в снимок идёт открытая часть склада,
      // и тайника чужого двора игрок не узнаёт ни числом, ни разведкой.
      loot: this.lootOpen(s, now),
      kinds: g.kinds,
      style: GARRISON_STYLES[g.style].name,
    };
  }

  // ---------- Добыча ----------

  /**
   * Оружие сожжённого логова. У предметов своя дверь: они считаются от прежней силы логова
   * (опора и возраст, `lairs.lairArmsBase`), а не от выросшей с городом, — иначе логово
   * десятого уровня раздавало бы тысячу предметов. Разгром и бунт при этом бьют по оружию
   * той же долей, что по силе: `power` — сила в минуту боя.
   */
  private lairArmsAt(s: GenSettlement, at: number, power: number): number {
    const rec = this.lairRec(s.id);
    const t = this.liveAt(s.id, at);
    const anchor = this.anchorOf(s);
    const grown = lairPower(anchor, rec, t, this.save.profile?.pop ?? 0);
    return lairArms((power * lairArmsBase(anchor, rec, t)) / Math.max(1, grown));
  }

  /**
   * Полный склад двора. Не «сколько добра выпадет», а именно склад: столько
   * лежит у него в амбарах, когда он ничем не потревожен, и ровно это забирает
   * победитель за вычетом тайника.
   *
   * Считается от населения (`LOOT_PER_POP`), потому что население — единственная
   * мерка достатка, которая у мира есть. Число меряное, а не выбранное: им
   * задаётся, сколько стоит час войны против часа хозяйства (`npm run sack:report`).
   * У логова свой счёт — от силы, а не от населения: разбойники живут не
   * хозяйством, и добро у них чужое (docs/lairs.md).
   */
  private lootCap = (s: GenSettlement, now: number): number =>
    isLair(s) ? lairLoot(this.powerNow(s, now)) : Math.round(this.popNow(s, now) * LOOT_PER_POP);

  /**
   * Сколько каждого припаса прячет тайник двора. Правило дележа одно на обе
   * стороны (`spoils.plunder`), а **сколько помещается в тайник**, каждая
   * сторона считает своим: у игрока это здание, у двора — доля его же склада.
   * Ровно так же из мощи выводится гарнизон: мир не знает про чужие постройки и
   * знать не должен.
   *
   * Доля выбрана по игроку: столько полного склада прячет его Тайник десятого
   * уровня (`npm run sack:report`, раздел «ТАЙНИК», столбец «доля»; docs/sack.md). Без неё игрок выдоил бы соседей досуха, а
   * его самого прикрывал бы собственный тайник, — то самое одностороннее
   * правило, которое раскусывают за день.
   */
  private lootStash(s: GenSettlement, now: number): number {
    const mix = Math.max(1, s.lootMix.length);
    return Math.floor((this.lootCap(s, now) * AI_STASH_SHARE) / mix);
  }

  /**
   * Сколько добра лежит в поселении сейчас. После набега склад пуст **по
   * факту** — победитель выгреб его до тайника, — и наполняется он заново по
   * собственным часам двора: их останавливает разорение, поэтому вернуться
   * через час к полному амбару нельзя.
   */
  private lootAvailable(s: GenSettlement, now: number): number {
    const last = this.save.looted[s.id] ?? this.save.createdAt - LOOT_REFILL;
    const refill = Math.min(1, Math.max(0, (this.liveAt(s.id, now) - last) / LOOT_REFILL));
    return Math.round(this.lootCap(s, now) * refill);
  }

  /** Склад двора по припасам: тем же раскладом, каким он потом делится. */
  private lootStock(s: GenSettlement, now: number): Loot {
    const total = this.lootAvailable(s, now);
    const mix = s.lootMix;
    const out: Loot = {};
    if (total <= 0 || mix.length === 0) return out;
    const per = Math.floor(total / mix.length);
    let rest = total - per * mix.length;
    for (const r of mix) {
      const extra = rest > 0 ? 1 : 0;
      rest -= extra;
      const n = per + extra;
      if (n > 0) out[r] = (out[r] ?? 0) + n;
    }
    return out;
  }

  /** Что видно разведке: склад и казна двора за вычетом того, что в тайнике. */
  private lootOpen(s: GenSettlement, now: number): number {
    return this.fateOf(s, now, Infinity, 0, 0, FATE_DEFAULT).takenTotal;
  }

  /**
   * Сколько золота лежит в казне двора сейчас: у логова — от его силы
   * (`lairs.lairGold`), у замка — от мощи. Восстанавливается тем же сроком, что и
   * прочая добыча, поэтому дважды подряд одну казну не обчистить.
   */
  private treasury(s: GenSettlement, now: number): number {
    const last = this.save.looted[s.id] ?? this.save.createdAt - LOOT_REFILL;
    const refill = Math.min(1, Math.max(0, (this.liveAt(s.id, now) - last) / LOOT_REFILL));
    if (isLair(s)) return Math.round(lairGold(this.powerNow(s, now)) * refill);
    if (!s.castle) return 0;
    return Math.round(powerOf(s, this.lived(s, now), POWER_GROWTH_CAP) * CASTLE_GOLD_PER_POWER * refill);
  }

  /**
   * Сколько игрок видит чужую армию до её прихода. База обязана быть больше потолка
   * сбора дружины (`HANDOVER_MAX`) — иначе набег появляется уже без холодного ответа:
   * полный сбор не успевал бы ни с какой минуты (docs/battle_eu4.md, 14.26–14.27); Дозор
   * игрока только прибавляет сверху, укоротить предупреждение он не может.
   */
  protected warningMs(): number {
    // `warning` — игровые секунды: вся семья предупреждения идёт со шкалой времени, как ритм набегов,
    // и с миллисекундами мира складывается только через дверь (`game/pace`).
    return warningMsOf(this.save.profile?.warning ?? 0);
  }


  /**
   * Снаряжение своего отряда. Конюшня добавляет коннице ступень: мощь бойца она
   * не трогает (это запрещено — мощь считается из состава), а ступень снаряжения
   * даёт в бою мораль, и именно так сытые кони и добрая сбруя работают.
   */
  /**
   * Дух нашей стороны (ДР-1): мораль и дисциплина дружины. Числа приезжают готовыми в слепке деревни (`PlayerProfile.spirit`)
   * — мир про жалованье, стабильность, совет, веру и храм не знает и знать не должен. Стойкость обряда и Воеводы — строки
   * морали, своей прибавки у нашей стороны больше нет (`resolve` наших боёв — ноль). Слепок до ДР-1 — духа нет.
   *
   * Стоит рядом с `ownGear` нарочно: наша сторона в мире узнаётся ровно по
   * этим двум вызовам, и забыть один из них труднее, когда они рядом.
   */
  private ownSpirit(): Spirit | undefined {
    const v = this.save.profile?.spirit;
    return v ? { morale: v.morale, discipline: v.discipline } : undefined;
  }

  /**
   * Отметки полководца в бою, который **ведёт он**: удар по двору и логову, перехват, удар по лагерю
   * из поля и наш лагерь, по которому бьют. Дух в этих боях — тот же дух дружины (`ownSpirit`), что
   * у всех наших: прежний натиск в неё больше не прибавляется (docs/battle_eu4.md, пачка 1).
   */
  private generalPips(): Pips {
    return this.save.profile?.pips ?? {};
  }

  /**
   * Отметки у своего города — у стены и на вылазке — **пока полководец в городе** (`muster.inTown`): у своих ворот или
   * укрывшись, с отрядом и без него (решение владельца 16.10.2026, docs/ui_v2.md, 6.10: полководец в городе без отряда
   * защищает стены). Прежде мерой было «его отряд стоит в городе» (решение владельца 26.09.2026, docs/battle_eu4.md,
   * вопрос 5), и полководец без отряда оборону не вёл. Правило владельца 15.10.2026 — полководец и его отряд, пока
   * внутри города, в оборонительных боях считаются гарнизоном (docs/ui_v2.md, 5.3) — теперь и без отряда. В пути, в
   * поле или в лагере — полководца у стены нет, и отметок нет: место полководца имеет цену. У стены — все отметки, и
   * манёвр тоже: у EU4 манёвр обороняющегося держит переправу нападающему (14.5, Л9 пересмотрено).
   */
  private homePips(at: number): Pips {
    if (!inTown(this.save.figures.general, at)) return {};
    return this.generalPips();
  }

  /**
   * Командиры флангов в бою, который ведёт полководец (ДР-3, К1): они едут в его отряде и в бою там же, где его отметки
   * (`generalPips`). Полем стороны — только если они есть: бой без них тот же, что до них, байт в байт.
   */
  private generalFlanks(): { flanks?: Flanks } {
    const f = this.save.profile?.flanks;
    return f && Object.keys(f).length > 0 ? { flanks: f } : {};
  }

  /** Командиры флангов у своих стен — пока полководец в городе (`homePips`): нет его — нет и командиров. */
  private homeFlanks(at: number): { flanks?: Flanks } {
    return inTown(this.save.figures.general, at) ? this.generalFlanks() : {};
  }

  /** Чем одет наш отряд — для показа: ролик и отчёт одевают им лагерь; в бой ступень не идёт (путь П2, 14.35). */
  private ownGear(troops: TroopStack): Partial<Record<UnitKind, number>> {
    return ownGearOf(troops);
  }

  /**
   * Участь чужого двора, ничего не трогая: склад, казна и тайник двора — в дверь
   * участи (`spoils.fate`). Построек у двора мира нет, поэтому уровни не падают.
   * `pop` — население, из которого уводят: по умолчанию настоящее, а для строки
   * выбора до приказа — то, что игрок о нём знает (`fateOptions`).
   */
  private fateOf(
    s: GenSettlement,
    now: number,
    carry: number,
    bonded: number,
    escort: number,
    declared: Fate,
    pop = this.popNow(s, now),
  ): FateResult {
    return fate({
      fate: declared,
      stock: this.lootStock(s, now),
      gold: this.treasury(s, now),
      stash: this.lootStash(s, now),
      pop,
      bonded,
      carry,
      escort,
      seed: fallSeed(this.save.seed, now),
    });
  }

  /**
   * Что победитель выносит из чужого двора. Считает это та же дверь участи, что
   * и у нашей деревни (`spoils.fate`): всё, кроме тайника, но не больше, чем
   * поднимет отряд, — склад и казну одним дележом, а людей — той ступенью, что
   * объявлена. Второй арифметики добычи в игре нет.
   */
  private takeLoot(
    s: GenSettlement,
    now: number,
    carry: number,
    bonded: number,
    escort: number,
    declared: Fate,
    pop?: number,
  ): FateResult {
    const avail = this.lootAvailable(s, now);
    const spoils = this.fateOf(s, now, carry, bonded, escort, declared, pop);
    const cap = Math.max(1, this.lootCap(s, now));
    // На складе остаётся тайник и то, что не подняли: отметка ставится так,
    // чтобы наполнение пошло именно с этого места, а не с нуля и не с полного.
    // Казна складом не считается и отметку не сдвигает.
    const left = Math.max(0, avail - (spoils.takenTotal - (spoils.taken.gold ?? 0)));
    this.save.looted[s.id] = this.liveAt(s.id, now) - Math.min(1, left / cap) * LOOT_REFILL;
    return spoils;
  }

  /**
   * Участь нашего взятого города. Считает её та же дверь (`spoils.fate`), что
   * и участь чужого двора; отличаются стороны только тем, откуда берутся склад,
   * казна, тайник и постройки — у игрока всё это в слепке. Соль выбора построек —
   * сид мира и минута падения: одно событие, один список.
   */
  private fateHome(profile: PlayerProfile | null, carry: number, escort: number, at: number, declared: Fate, bread = this.homeBread(at)): FateResult {
    return fate({
      fate: declared,
      // Хлеб осаждённого города — хлеб окна осады (docs/siege_v2.md, 21.1): съеденного за осаду в обозе нет.
      stock: breadStock(profile?.stock ?? {}, bread),
      gold: Math.max(0, Math.floor(profile?.gold ?? 0)),
      stash: profile?.stash ?? 0,
      pop: profile?.pop ?? 0,
      bonded: profile?.bonded ?? 0,
      carry,
      escort,
      levels: profile?.levels ?? {},
      seed: fallSeed(this.save.seed, at),
    });
  }

  // ---------- Туман войны ----------

  /** Где фигура находится в момент t. В пути — доля пройденного, иначе цель. */
  private figureAt(f: StoredFigure, t: number): Coord {
    if (f.phase !== 'moving') return { ...f.to };
    return marchPosition(f, t);
  }

  /**
   * Докуда деревня открывает местность вокруг себя: свой круг обзора или, если
   * Дозор изучил округу, изученный радиус. Это **только первый слой тумана** —
   * земля. Живой обзор у деревни остаётся прежним кругом (`homeSight`), и
   * растягивать его вслед за изучением нельзя: тогда высшая ступень отдала бы
   * игроку живое наблюдение за всей изученной округой даром.
   */
  private homeReveal(): number {
    return Math.max(homeSight(this.save.home), Math.round(this.save.profile?.survey ?? 0));
  }

  // ---------- Черты агентов: пять дверей ----------
  //
  // Черты приезжают из слепка готовыми множителями (`PlayerProfile.traits`), и у
  // каждого числа, которое они двигают, в мире ровно одна дверь. Мир не знает, чья
  // это черта и как её заслужили — только во сколько раз.

  private traitOf(key: keyof NonNullable<PlayerProfile['traits']>): number {
    const v = this.save.profile?.traits?.[key];
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : 1;
  }

  /**
   * Сколько поднимет и скольких устережёт отряд победителя — одна дверь на все
   * пять мест, где город взят. Обоз полководца (`ours`) множит черта «Добычливый»;
   * чужой отряд, взявший наш город, — никогда. Прежде `stackCarry` звали пять мест
   * порознь, и черта, дошедшая до двух из них, разошлась бы с тремя молча. Режим марша (ДР-5) множит поклажу своего
   * отряда той же дверью, что у сервера войны (`gait.gaitHaul`): налегке без обоза везут меньше, с обозом — больше.
   */
  private haul(units: UnitStack, ours: boolean, gait: Gait | undefined = this.save.figures.general.gait): { carry: number; escort: number } {
    const carry = stackCarry(units);
    return { carry: ours ? carry * this.traitOf('carry') * gaitHaul(gait) : carry, escort: stackEscort(units) };
  }

  /**
   * Бой полководца для командиров его флангов (ДР-5): доля гибели фланга — гибель разбитого у этой клетки (`peril.routPeril`, та же,
   * что у полководца, чью дружину перебили) × доля выбитых его фланга (`FieldOutcome.flankLoss`): фланг перебит до последнего —
   * командир гибнет так же часто, как полководец. Опыт и кость гибели кладёт племя (`sim/command.commandBattle`). Командиров в бою
   * не было — поля нет.
   */
  private flankDeed(field: FieldOutcome, us: Side, ok: boolean, at: number, spot: Coord): { flanks?: FlankBattle } {
    const loss = field.flankLoss?.[us];
    if (!loss || !field.result) return {};
    const peril = routPeril(distance(this.save.home, spot));
    const out: FlankBattle['peril'] = {};
    for (const f of FLANKS) {
      const share = loss[FLANK_SECTOR[f]];
      if (share !== undefined) out[f] = peril * share;
    }
    return Object.keys(out).length > 0 ? { flanks: { at, ok, seed: field.result.seed, peril: out } } : {};
  }

  /** Доля приходов, в которые часовые берут разведчика: «Неприметный» реже, «Приметный» чаще. */
  private scoutCatch(): number {
    return Math.min(1, FIGURE_SCOUT_CATCH * this.traitOf('catch'));
  }

  /**
   * Срок сбора и роспуска дружины: прежний потолок, умноженный на черту. Множится
   * после потолка — «Мясника» ждут дольше и у дружины, которая и так упиралась в него.
   *
   * Окна ответа на набег сбор больше не держит: в городе перевод мгновенный (`regroupInstant`, решения владельца
   * 06.10.2026 и 16.10.2026 — и в осаде), и ответить на набег можно до самого его прихода — это окно показывают
   * тревога, донесение и стена (`MarchView.arriveAt`), до него же годен черновик уведомления (docs/NOTIFY.md, 12.11).
   * Срок сбора остался только сбору в поле у своих ворот.
   */
  private musterWait(moved: number): number {
    return musterMs(moved, this.traitOf('muster'));
  }

  /** Сколько лазутчик занят после удачи или тихого провала и сколько его держат пойманного. */
  private spyTimes(): { busy: number; held: number } {
    return { busy: Math.round(SPY_BUSY * this.traitOf('busy')), held: Math.round(SPY_HELD * this.traitOf('held')) };
  }

  /**
   * Живой обзор прямо сейчас: круг у своей деревни и стоящий лазутчик — больше
   * никто (см. world/sight.ts). Отряды и остальные фигуры открывают местность,
   * но за происходящим не следят: живые данные — отдельный слой, и держать его
   * всем, у кого есть кто-нибудь в поле, значит не иметь тумана вовсе.
   *
   * Круг деревни здесь **не растягивается** изучением округи: изученный радиус
   * открывает землю, и только.
   */
  protected sightDiscs(now: number): SightDisc[] {
    const out: SightDisc[] = [{ x: this.save.home.x, y: this.save.home.y, r: homeSight(this.save.home) }];
    for (const id of FIGURE_IDS) {
      const f = this.save.figures[id];
      if (!f) continue;
      const r = liveSight(id, f);
      if (r <= 0) continue;
      const at = this.figureAt(f, now);
      out.push({ x: at.x, y: at.y, r });
    }
    return out;
  }

  /**
   * Открывает местность за прошедшее время. Считается не «где кто стоит», а
   * «где кто прошёл»: фигура, пересёкшая пол-карты, пока игрока не было, обязана
   * оставить за собой такой же коридор, как если бы он смотрел на неё всё это
   * время. Отметка `fogAt` — единственное, что для этого хранится.
   */
  private stepFog(now: number): void {
    const save = this.save;
    const from = Math.min(save.fogAt, now);
    this.fog.revealDisc(save.home, this.homeReveal());
    for (const id of FIGURE_IDS) {
      const f = save.figures[id];
      // Укрывшийся в городе на местность не смотрит: его нет на карте. Круг
      // деревни при этом открывает его клетку и так.
      if (!f || placeOf(f) !== 'map') continue;
      this.fog.revealPath(this.figureAt(f, from), this.figureAt(f, now), this.revealOf(id));
    }
    for (const m of save.marches) {
      if (!m.own) continue;
      const a = marchPosition(m, Math.max(m.departAt, from));
      this.fog.revealPath(a, marchPosition(m, now), MARCH_SIGHT);
    }
    save.fogAt = now;
  }

  /**
   * Снимает живые данные с того, что сейчас в обзоре. Клетка, открытая мимоходом
   * и ни разу не рассмотренная, тоже получает снимок — иначе на карте оказалось
   * бы поселение вообще без данных, и игрок решил бы, что оно пустое.
   */
  private stepSightings(now: number, discs: SightDisc[]): void {
    for (const s of this.gen.settlements) {
      if (!this.fog.has(s.x, s.y)) continue;
      // У сожжённого логова живых данных нет: снимок с пепелища был бы записью
      // о войске, которого не существует.
      if (!this.alive(s, now)) continue;
      const known = this.save.sightings[s.id];
      if (known && !inSight(discs, s.x, s.y)) continue;
      this.save.sightings[s.id] = {
        at: now,
        stage: stageOf(this.powerNow(s, now), this.popNow(s, now)),
        relation: this.relationOf(s),
        owner: s.owner,
        tribeId: s.tribeId,
        pop: Math.round(this.popNow(s, now)),
        castle: s.castle,
        sacked: this.isSacked(s.id, now),
      };
    }
    // Замок живого игрока снимается **только из живого обзора**, и поблажки
    // «первый раз бесплатно» у него нет. У сгенерированного поселения она есть
    // не зря: клетку открыл разведчик, который мимо неё прошёл. Здесь открывать
    // нечего — строка приезжает из реестра сама, в давно разведанную округу, и
    // бесплатный снимок означал бы, что мощь и население соседа достаются
    // игроку за то, что тот просто зашёл в игру.
    for (const c of this.castles.values()) {
      if (!inSight(discs, c.x, c.y)) continue;
      this.save.sightings[c.id] = {
        at: now,
        stage: stageOf(c.power, c.pop),
        relation: 'neutral',
        owner: c.name,
        name: cityOr(c.city),
        tribeId: null,
        pop: c.pop,
        power: c.power,
        castle: true,
      };
    }
  }

  // ---------- Фигуры ----------

  /** Поселение, у которого фигура стоит вплотную. HOME_ID — своё. */
  protected touching(at: Coord): { id: SettlementId; name: string; home: boolean } | null {
    if (distance(at, this.save.home) <= FIGURE_TOUCH) {
      return { id: HOME_ID, name: this.homeName(), home: true };
    }
    let best: GenSettlement | null = null;
    let bestDist = FIGURE_TOUCH;
    for (const s of this.gen.settlements) {
      const d = distance(at, s);
      if (d <= bestDist) {
        best = s;
        bestDist = d;
      }
    }
    return best ? { id: best.id, name: best.name, home: false } : null;
  }

  /**
   * Радиус, которым фигура открывает землю: свой обзор плюс зоркость у
   * разведчика (`world/agents.revealSight`). Только земля: живой обзор считает
   * `sight.liveSight`, и зоркости он не знает.
   */
  private revealOf(id: FigureId): number {
    return revealSight(id, this.save.profile?.sightBonus ?? 0);
  }

  /**
   * Уводит фигуру с карты домой на `FIGURE_DOWN` — общая часть гибели, задержания и
   * разгрома. Что это стоило, решают двери ниже, и цена у них разная.
   */
  private offMap(id: FigureId, at: number): TroopStack {
    const f = this.save.figures[id];
    // Стойка меняется — энергия сверяется до перемены (`energyOf`).
    this.energyOf(id, at);
    f.spent = undefined;
    f.phase = 'down';
    f.from = { ...this.save.home };
    f.to = { ...this.save.home };
    f.departAt = at;
    f.arriveAt = at;
    f.downUntil = at + FIGURE_DOWN;
    f.watching = false;
    f.strike = undefined;
    f.chase = undefined;
    f.peril = undefined;
    const lost = f.troops ?? {};
    f.troops = undefined;
    f.handover = undefined;
    return lost;
  }

  /**
   * Гибель агента: человек погиб, место пустует, пока племя не наймёт нового. Это
   * **единственное место**, где последствие несёт `fell`: задержание идёт своей дверью
   * (`holdFigure`), разгром уцелевшего полководца — своей (`routFigure`), и свести их
   * обратно в один вызов не даёт тест (`world/agents.test.ts`).
   *
   * В последствии — номер человека: весть о гибели придёт в племя поздно и убить
   * обязана погибшего, а не нанятого после. И тот риск, что был показан до приказа, —
   * тем же числом, чтобы отчёт о гибели говорил правду о том, чем рисковали.
   */
  private downFigure(id: FigureId, at: number, death: { peril: number; where: string; why: string[]; spot: Report['target'] }): void {
    const f = this.save.figures[id];
    const person = f.person ?? 0;
    const lost = this.offMap(id, at);
    f.held = false;
    f.busyUntil = 0;
    f.gone = { person, at, why: 'died' };
    const def = FIGURE_BY_ID[id];
    const why = death.why.length > 0 ? ` ${death.why.join(', ')}.` : '';
    this.addReport({
      id: `fig-${id}-died-${at}`,
      at,
      kind: id === 'general' ? 'raid' : 'scout',
      title: `${def.name} погиб`,
      target: { ...death.spot },
      won: false,
      sent: {},
      lost: {},
      enemyPower: null,
      enemyLost: null,
      loot: null,
      intel: null,
      battle: null,
      text: `${def.name} погиб ${death.where}.${why} Риск гибели был ${perilText(death.peril)}. Место пустует.`,
      read: false,
    });
    this.addEffect({
      id: `fig-${id}-${at}`,
      lost: {},
      lostTroops: troopTotal(lost) > 0 ? lost : undefined,
      // Дружина погибшего полководца рассеяна, а не ранена.
      routed: true,
      resources: {},
      prestige: 0,
      morale: AGENT_DEATH_MORALE,
      battle: null,
      fell: { agent: id, person, peril: death.peril, where: death.where, why: death.why },
      // Строку летописи пишет племя: только оно знает, как звали погибшего.
      text: '',
      good: false,
    });
  }

  /**
   * Задержание — не гибель: пойманного держат и отпускают домой, опыт при нём.
   * Цена — дело-неудача (`deed`), лицо, которое цель запомнила (отношение
   * `SPY_CAUGHT_ATTITUDE`, как у замеченного лазутчика), и прежний срок вне строя
   * (`FIGURE_DOWN`). Мораль дома — цена задержания `AGENT_HELD_MORALE`, та же, что у замеченного
   * лазутчика, и дешевле гибели.
   */
  private holdFigure(id: FigureId, target: GenSettlement, at: number, text: string, deed: NonNullable<HomeEffect['deed']>): void {
    const f = this.save.figures[id];
    this.offMap(id, at);
    f.held = true;
    this.moveAttitude(target.id, SPY_CAUGHT_ATTITUDE, at);
    this.addEffect({
      id: `fig-${id}-${at}`,
      lost: {},
      resources: {},
      prestige: 0,
      morale: AGENT_HELD_MORALE,
      battle: null,
      deed,
      text: `${FIGURE_BY_ID[id].name} ${text} Отпустят не скоро.`,
      good: false,
    });
  }

  /**
   * Разбит, но жив: полководца, чью дружину перебили, выхаживают дома `FIGURE_DOWN`.
   * Опыт при нём, место не пустует. Гибели здесь нет — её решает `defeatGeneral`.
   */
  private routFigure(id: FigureId, at: number, text: string): void {
    const lost = this.offMap(id, at);
    this.save.figures[id].held = false;
    this.addEffect({
      id: `fig-${id}-${at}`,
      lost: {},
      lostTroops: troopTotal(lost) > 0 ? lost : undefined,
      // Дружина разбитого полководца рассеяна, а не ранена.
      routed: true,
      resources: {},
      prestige: 0,
      morale: GENERAL_ROUT_MORALE,
      battle: null,
      text: `${FIGURE_BY_ID[id].name} ${text} Уцелел — вернётся не скоро.`,
      good: false,
    });
  }

  /**
   * Дружину полководца перебили до последнего бойца: гибнет ли он сам. Кость — своё
   * число из сида того же боя, после ядра, и ядро боя про неё не знает. Риск — тот же
   * `routPeril` от дали места боя, что стоит в меню до приказа («если дружину
   * перебьют»): одна функция на показ и на исход.
   */
  private defeatGeneral(at: number, text: string, where: string, spot: Report['target'], seed: number): void {
    const peril = perilShare(routPeril(distance(this.save.home, spot)));
    if (diesAt(seeded(mixSeed(seed, ROUT_SALT))(), peril)) {
      this.downFigure('general', at, { peril, where, why: ['дружину перебили до последнего'], spot });
      return;
    }
    this.routFigure('general', at, text);
  }

  /** Наш агент побывал у цели по делу: отметка в памяти для гибели следующего. */
  private markVisit(id: SettlementId, at: number): void {
    const book = (this.save.visited ??= {});
    book[id] = [...(book[id] ?? []), at];
  }

  /** Память цели короткая: отметки старше окна выбрасываются при записи. */
  private forgetVisits(now: number): void {
    const book = this.save.visited;
    if (!book) return;
    for (const [id, marks] of Object.entries(book)) {
      const kept = marks.filter((at) => now - at < PERIL_MEMORY);
      if (kept.length > 0) book[id] = kept;
      else delete book[id];
    }
  }

  /**
   * Игровое время деревни в эту мировую минуту. Мир часов деревни не ведёт: он берёт
   * последний слепок (`profile.time`) и прибавляет, сколько прошло с его прихода, — настоящие
   * миллисекунды мира переводит в игровые секунды дверь времени (`game/pace`). Этим
   * и считаются час и время года тайного дела.
   */
  private villageTime(at: number): number {
    const p = this.save.profile;
    if (!p || typeof p.time !== 'number') return 0;
    return p.time + gameSecondsOfMs(Math.max(0, at - (this.save.profileAt ?? at)));
  }

  /** Спелость цели для гибели: логово — по своему возрасту, замок — всегда настороже. */
  private ripenessOf(s: GenSettlement, at: number): number {
    if (isLair(s)) return lairRipeness(this.lairRec(s.id), at);
    return s.castle ? 1 : 0.5;
  }

  /**
   * Обстановка тайного дела у цели в эту минуту — всё, из чего гибель считается.
   * Скрытность — только у лазутчика: у разведчика своего рычага против гибели нет,
   * кроме выбора цели. Дозора здесь нет ни одним числом.
   */
  private perilCase(id: FigureId, s: GenSettlement, at: number): PerilCase {
    return {
      veil: id === 'spy' ? Math.max(0, Math.min(1, this.save.profile?.veil ?? 1)) : 1,
      ripeness: this.ripenessOf(s, at),
      villageTime: this.villageTime(at),
      visits: recentVisits(this.save.visited?.[s.id], at),
      distance: distance(this.save.home, s),
    };
  }

  /**
   * Что ждёт разведчика у ворот, если отправить его сейчас к клетке `to` с приходом в
   * `arriveAt`: схватят ли и погибнет ли. Считается на минуту прихода — её мир знает в
   * минуту отправки, — и этой же функцией риск замораживается на фигуре
   * (`StoredFigure.peril`): показанное до приказа и применённое на приходе — одно и то же.
   */
  private scoutPlan(to: Coord, arriveAt: number): { target: GenSettlement | null; caught: number; peril: number; why: string[] } {
    const near = this.touching(to);
    const target = near && !near.home ? (this.byId.get(near.id) ?? null) : null;
    if (!target || !this.alive(target, arriveAt)) return { target, caught: 0, peril: 0, why: [] };
    // Часовые есть только у поселения, которое сильнее разведчика, — в минуту прихода.
    if (this.powerNow(target, arriveAt) <= FIGURE_SCOUT_COVER) return { target, caught: 0, peril: 0, why: [] };
    const c = this.perilCase('scout', target, arriveAt);
    return { target, caught: this.scoutCatch(), peril: perilShare(perilOf(c)), why: perilWhy(c) };
  }

  /**
   * Шаг фигур: прибытие, возвращение павших и то, что фигура делает, стоя на
   * месте. Положение здесь не двигается — оно выведено из времени, и двигать
   * его тиком значило бы получить два разных ответа онлайн и офлайн.
   */
  private stepFigures(now: number): void {
    for (const id of FIGURE_IDS) {
      const f = this.save.figures[id];
      if (!f) continue;
      // Лазутчик на деле у соседа идёт и стоит по словам сервера (`stepSpies`): своего прихода у него нет.
      if (id === 'spy' && f.rival) continue;
      if (f.phase === 'down') {
        // Пустое место не возвращается само: вернётся нанятый, когда его назовёт слепок.
        if (f.gone || now < f.downUntil) continue;
        const held = Boolean(f.held);
        this.energyOf(id, now);
        f.phase = 'home';
        f.downUntil = 0;
        f.held = false;
        f.from = { ...this.save.home };
        f.to = { ...this.save.home };
        f.departAt = now;
        f.arriveAt = now;
        if (id === 'general') this.homecoming(now);
        this.addEffect({
          id: `fig-${id}-back-${now}`,
          lost: {},
          resources: {},
          prestige: 0,
          morale: 2,
          battle: null,
          text: held ? `${FIGURE_BY_ID[id].name}а отпустили, он снова в строю.` : `${FIGURE_BY_ID[id].name} снова в строю.`,
          good: true,
        });
        continue;
      }
      // Энергия кончилась в пути раньше прихода — до цели он не дойдёт, домой с той минуты.
      this.tire(id, now);
      if (f.phase === 'moving' && now >= f.arriveAt) {
        const at = f.arriveAt;
        this.energyOf(id, at);
        // Налегке — истощение пути до минуты прихода (ДР-2): дело у цели делают те, кто дошёл.
        if (id === 'general') this.wearGeneral(at);
        // Удар по лагерю — в минуту прихода и **пока полководец ещё в пути**: встань
        // он сначала у своих ворот, его дружина стала бы гарнизоном, и выйти ей из
        // поля было бы уже нечем.
        if (id === 'general' && f.strike) {
          const strike = f.strike;
          f.strike = undefined;
          const res = this.resolveStrike(strike.id, at, strike.garrison);
          if (res.error) {
            this.addEffect({
              id: `strike-miss-${at}`,
              lost: {},
              resources: {},
              prestige: 0,
              morale: 0,
              battle: null,
              text: `Полководец дошёл до лагеря, но боя не было: ${res.error}`,
              good: false,
            });
          }
          if (this.save.figures[id].phase === 'down') continue;
        }
        // Откуда шёл — до того, как приход поставит его на клетку цели: штурм по прибытии берёт переправу по последнему
        // шагу пути (MAP-10, `place.groundAt`).
        const came = { ...f.from };
        f.from = { ...f.to };
        f.departAt = at;
        f.phase = this.touching(f.to)?.home ? 'home' : 'field';
        // Дошёл до своих ворот — выбившийся из сил снова человек на месте: энергия копится, дела он берёт.
        if (f.phase === 'home') f.spent = undefined;
        this.onFigureArrived(id, at);
        // Дело из «Походов» без своей двери прихода — в минуту прихода, ценой, списанной приказом (Р-4).
        if (f.errand) this.errandArrived(id, at);
        // «Дойти и ударить»: бой в минуту прихода, не дожидаясь игрока, — онлайн и офлайн одинаково.
        if (id === 'general' && f.assault) this.assaultArrived(at, came);
        if (this.save.figures[id].phase === 'down') continue;
        // Полководец с дружиной встал у своих ворот — дружина вошла в оборону гарнизоном (ДР-6, `homecoming`), и
        // за стеной прибавилось ртов. Путь из осаждённого города заперт, а домой
        // открыт, поэтому этот повод под осадой случается, а обратный — нет.
        if (id === 'general' && f.phase === 'home') {
          this.homecoming(at);
          this.resiege(HOME_ID, at);
        }
      }
      // Налегке дома — отрезок кончился строкой летописи; в пути и в поле — тает до этой минуты (ДР-2).
      if (id === 'general') {
        const g = this.save.figures.general;
        if (g.phase === 'home') this.endWear(g.departAt);
        else this.wearGeneral(now);
      }
      // Стоит в поле — энергия кончится и там (наблюдает, держат, на переговорах).
      if (this.save.figures[id].phase !== 'down') this.tire(id, now);
      // Разведчик, стоящий у чужого поселения, считает войско заново, пока стоит:
      // это и есть его умение, и на нём держится ценность фигуры.
      if (id === 'scout' && f.phase === 'field') {
        const near = this.touching(f.to);
        const target = near && !near.home ? this.byId.get(near.id) : null;
        if (target) this.save.intel[target.id] = this.snapshot(target, now);
      }
      // Дело кончилось — домой, как освободится (Р-4).
      this.errandBack(id, now);
    }
  }

  /**
   * Что случается в момент прибытия. Бросок один и посеян отметкой фигуры, а не
   * порядком разбора событий: иначе онлайн и офлайн дали бы разные исходы. К этой
   * минуте `stepFigures` уже переписал `departAt` приходом, так что сеет бросок
   * **минута прихода**, а не выхода.
   */
  private onFigureArrived(id: FigureId, at: number): void {
    const f = this.save.figures[id];
    // Погоня разбирается раньше всего прочего: полководец пришёл не к воротам,
    // а в точку встречи, и там его ждёт (или не ждёт) чужой отряд.
    if (f.chase) {
      this.resolveChase(f, at);
      return;
    }
    const near = this.touching(f.to);
    const target = near && !near.home ? this.byId.get(near.id) : null;
    if (!target) return;
    const rng = seeded(marchSeed(this.save.seed, Math.floor(f.departAt / 1000)));
    const person = f.person ?? 0;
    if (id === 'scout') {
      // Риск заморожен в минуту отправки — на эту же минуту прихода и у этой же цели.
      // Фигура, отправленная до смертных агентов, приходит без него: прежний бросок
      // часовых по мощи в минуту прихода, гибели нет.
      const frozen = f.peril && f.peril.target === target.id && f.peril.at === at ? f.peril : null;
      f.peril = undefined;
      const caught = frozen ? frozen.caught : this.powerNow(target, at) > FIGURE_SCOUT_COVER ? this.scoutCatch() : 0;
      const peril = frozen?.peril ?? 0;
      // Две кости одного броска: первая — часовые, вторая — гибель. Они независимы, и
      // потому на кнопке стоят двумя числами.
      const isCaught = caughtAt(rng(), caught);
      const dies = diesAt(rng(), peril);
      // Заход засчитан в память цели — любым исходом, и после того, как его риск решён.
      this.markVisit(target.id, at);
      if (dies) {
        // Погиб. Схватили его перед этим или он успел пересчитать войско — видно по
        // первой кости: лицо запомнили, или донесение дошло.
        if (isCaught) this.moveAttitude(target.id, SPY_CAUGHT_ATTITUDE, at);
        else this.save.intel[target.id] = this.snapshot(target, at);
        this.downFigure(id, at, { peril, where: `у ${placeWord(target, 'of')}`, why: frozen?.why ?? [], spot: { id: target.id, name: target.name, x: target.x, y: target.y } });
        return;
      }
      if (isCaught) {
        this.holdFigure(id, target, at, `попался часовым у ${placeWord(target, 'of')}.`, { agent: 'scout', ok: false, at, person });
        return;
      }
      this.save.intel[target.id] = this.snapshot(target, at);
      // Дошёл и пересчитал — дело разведчика. Строки в летописи оно не стоит: ходка к
      // логову не событие для деревни, а опыт племя запишет и без неё.
      this.addEffect({
        id: `fig-scout-deed-${target.id}-${at}`,
        lost: {},
        resources: {},
        prestige: 0,
        morale: 0,
        battle: null,
        deed: { agent: 'scout', ok: true, at, person },
        text: '',
        good: true,
      });
      return;
    }
    // Дипломата во враждебном дворе хватают, а не убивают: гибели у него нет, он уходит
    // только на покой. Спит — враждебных дворов на карте нет.
    if (id === 'diplomat' && this.relationOf(target) === 'enemy' && rng() < ENVOY_SEIZE) {
      this.holdFigure(id, target, at, `схвачен во враждебном ${target.name}.`, { agent: 'diplomat', ok: false, at, person });
    }
  }

  // ---------- Договоры ----------

  private tribeSettlements = (tribeId: string): number =>
    this.gen.settlements.filter((s) => s.tribeId === tribeId).length;

  /** Выплаты по дани и торговле и истечение договоров. */
  private stepPacts(now: number): void {
    for (const [tribeId, deals] of Object.entries(this.save.pacts)) {
      for (const key of Object.keys(deals) as DealId[]) {
        const pact = deals[key];
        if (!pact) continue;
        if (key === 'tribute' || key === 'trade') {
          // Догон офлайна платит за каждый пропущенный срок, а не один раз: иначе
          // выгоднее было бы не отходить от экрана. Сроки — до конца договора: истёк он,
          // пока игрока не было, — сперва выплата, потом снятие (MAP-1).
          const upTo = Math.min(now, pact.until);
          for (let guard = 0; guard < 200 && upTo - pact.paidAt >= DEAL_PAYOUT; guard++) {
            pact.paidAt += DEAL_PAYOUT;
            this.payPact(tribeId, key, pact.paidAt);
          }
        }
        if (now >= pact.until) {
          delete deals[key];
          this.addEffect({
            id: `pact-${tribeId}-${key}-end`,
            lost: {},
            resources: {},
            prestige: 0,
            morale: -2,
            battle: null,
            text: `Договор «${DEAL_BY_ID[key].name}» с державой ${this.tribeName(tribeId)} истёк.`,
            good: false,
          });
        }
      }
    }
  }

  private payPact(tribeId: string, deal: DealId, at: number): void {
    const count = Math.max(1, this.tribeSettlements(tribeId));
    const name = this.tribeName(tribeId) ?? 'соседи';
    if (deal === 'trade') {
      const gold = Math.round(TRADE_GOLD_PER_SETTLEMENT * count);
      this.addEffect({
        id: `pact-${tribeId}-trade-${at}`,
        lost: {},
        resources: { gold },
        prestige: 0,
        morale: 0,
        battle: null,
        text: `Торговля с державой ${name} принесла ${gold} золота.`,
        good: true,
      });
      return;
    }
    const total = Math.round(TRIBUTE_PER_SETTLEMENT * count);
    // Платят тем же, чем богаты сами: список берётся у их поселения.
    const mix = this.gen.settlements.find((s) => s.tribeId === tribeId)?.lootMix ?? ['food'];
    // Виды складываются ровно в итог (`letters.splitLoot`, ECO-7).
    const resources = splitLoot(total, mix);
    this.addEffect({
      id: `pact-${tribeId}-tribute-${at}`,
      lost: {},
      resources,
      prestige: 1,
      morale: 1,
      battle: null,
      text: `Дань от державы ${name} доставлена.`,
      good: true,
    });
  }

  // ---------- Ход мира ----------

  private dueAt = (m: StoredMarch): number => (m.phase === 'stay' ? m.stayUntil ?? m.arriveAt : m.arriveAt);

  /**
   * Номер и зерно для чужого дела: войны соседей, выручки, вылазки бота. Счёт у
   * фона свой (`nextWar`), и это не мелочь: возьми он общий `nextMarch` — и
   * номер набега на игрока зависел бы от того, повздорили ли два двора на краю
   * карты, а офлайн перестал бы совпадать с непрерывной игрой.
   */
  private warSeed(): { id: string; seed: number } {
    const n = this.save.nextWar++;
    return { id: `w${n}`, seed: marchSeed(this.save.seed, 900_000 + n) };
  }

  private advance(now: number): void {
    const save = this.save;

    // Самозатухания у отношений нет: их выправляет дар, то есть приказ, а не
    // ожидание. Раньше здесь спадала племенная враждебность — вместе с ней
    // спадала бы и цена набега, и переждать было бы выгоднее, чем договориться.

    // Туман раскрывается до разбора походов: отряд, дошедший и повернувший
    // домой за время офлайна, обязан оставить след по дороге туда, а не только
    // обратно. Фигуры — там же и по тем же правилам.
    this.stepFog(now);
    this.stepFigures(now);
    this.stepPacts(now);
    this.stepSightings(now, this.sightDiscs(now));

    // События походов и осад — строго по времени, в одной очереди: догон офлайна
    // должен дать тот же порядок, в каком они случились бы при непрерывной игре.
    // Осада попадает сюда не потому, что она «тикает», а потому, что её события
    // назначены заранее — отметкой голода и временем начала окна.
    for (let guard = 0; guard < 500; guard++) {
      let next: StoredMarch | null = null;
      for (const m of save.marches) {
        if (this.dueAt(m) > now) continue;
        if (!next || this.dueAt(m) < this.dueAt(next)) next = m;
      }
      // Война соседей — такое же событие по времени: заведи её после очереди,
      // и её поход остался бы неразобранным до следующего пульса, а офлайн
      // разошёлся бы с непрерывной игрой.
      if (now >= save.nextWarAt && (!next || save.nextWarAt <= this.dueAt(next))) {
        this.scheduleWar(save.nextWarAt);
        continue;
      }
      const siege = this.nextSiegeAt(now);
      // На равном времени первой идёт осада: падение города само разворачивает
      // лагерь домой, и тот перестаёт быть событием.
      if (siege && (!next || siege.at <= this.dueAt(next))) {
        this.stepSiege(siege.id, siege.at);
        continue;
      }
      if (!next) break;
      this.resolve(next, this.dueAt(next));
    }

    // Новые логова — до очереди набегов: заведённое этим же пульсом логово
    // обязано попасть в неё сразу, а не ждать следующего.
    this.stepLairs(now);
    this.scheduleAi(now);
    // Письма — последними: набег, назначенный этим же пульсом, обязан получить
    // своё предупреждение в тот же миг, когда становится виден.
    this.stepLetters(now);
  }

  /** Разворачивает отряд домой. Обратный путь занимает столько же, сколько дорога туда. */
  private turnHome(m: StoredMarch, at: number, loot: Loot | null): void {
    const duration = Math.max(0, m.arriveAt - m.departAt);
    const chased = this.save.figures.general.chase?.marchId === m.id;
    const backTo = { ...m.from };
    const backToName = m.fromName;
    m.from = { ...m.to };
    m.fromName = m.toName;
    m.to = backTo;
    m.toName = backToName;
    m.phase = 'back';
    m.departAt = at;
    m.arriveAt = at + duration;
    m.stayUntil = undefined;
    m.loot = loot;
    // Смена курса — новое событие выхода: встреча считается заново тем же
    // уравнением, а не подправляется на глазок.
    if (chased) this.rechase(m.id, at);
  }

  private resolve(m: StoredMarch, at: number): void {
    if (m.phase === 'back') return this.arriveHome(m, at);
    if (m.phase === 'stay') {
      // Стоянка у ворот — это осадный лагерь, и кончается она не уходом, а
      // голодом. Разбирает её очередь осад (`stepSiege`), и обычно она успевает
      // раньше: сюда лагерь доходит только если окно уже снято.
      const camp = Object.entries(this.save.sieges).find(([, w]) => w.campId === m.id);
      // Лагерь у нашего города из сохранения до ОС-1 стоял до часа голода окна: этот срок город больше не сдаёт.
      if (camp && camp[0] === HOME_ID) {
        m.stayUntil = this.stayOf(HOME_ID, camp[1]);
        return;
      }
      if (camp) return this.siegeFalls(camp[0], at);
      return this.turnHome(m, at, null);
    }
    // Выручка идёт не на город, а на лагерь под ним: цель у неё та же клетка,
    // а дело — другое.
    if (m.relief) return this.resolveRelief(m, at);
    if (!m.own) {
      // Чужой отряд идёт либо на нас, либо на такого же чужого. Порядок при
      // этом один: заслон заведомо крепче — лагерь, иначе бой.
      return m.targetId === HOME_ID
        ? this.resolveIncoming(m, at)
        : this.resolveWar(m, at);
    }

    const target = this.byId.get(m.targetId) ?? null;
    // Логово могли сжечь, пока отряд шёл: разведывать и поддерживать там некого.
    if (!target || !this.alive(target, at)) return this.turnHome(m, at, null);
    // Набегов в этом списке не бывает: армия ходит только с полководцем, и бой
    // считается там, где он стоит (см. attack). Отряд без него — разведка или
    // поддержка, больше отправить нечего.
    if (m.mission === 'support') return this.resolveSupport(m, target, at);
    return this.resolveScout(m, target, at);
  }

  private arriveHome(m: StoredMarch, at: number): void {
    this.remove(m);
    if (!m.own) {
      // Дошедший с прорыва отряд сажает уведённых в плен у своего двора (MAP-9): дальше — выкуп письмом.
      if (m.held) this.save.captives[m.fromId] = (this.save.captives[m.fromId] ?? 0) + m.held;
      return;
    }
    // Отряд, вышедший до осады, доходит как ни в чём не бывало и вливается в
    // гарнизон — а это меняет число едоков за стеной, и часы голода считаются
    // заново. Один раз, здесь, в самом событии: отряд уже снят со списка, и
    // гарнизон его считает.
    this.resiege(HOME_ID, at);
    const loot = m.loot && Object.keys(m.loot).length > 0 ? m.loot : null;
    this.addEffect({
      id: `${m.id}-home`,
      lost: {},
      resources: loot ?? {},
      prestige: 0,
      morale: 0,
      battle: null,
      text: loot ? 'Отряд вернулся с добычей.' : 'Отряд вернулся домой.',
      good: true,
    });
  }

  /**
   * Бой полководца по поселению, у которого он стоит.
   *
   * Считается сразу и здесь, а не «при прибытии отряда»: полководец уже дошёл, и
   * защитнику было отпущено всё время, пока фигура шла через карту, — это та же
   * фора, ради которой бой считался на приходе. Уцелевшие остаются при
   * полководце: в поле состав войска не меняется. Добыча уходит домой обозом
   * сразу — везти её обратно фигурой значило бы завести у неё второй груз и
   * второй маршрут, а этого шага здесь нет.
   */
  private attackAt(
    target: GenSettlement,
    at: number,
    declared: Fate,
    camp: SiegeWindow | null = null,
    /** Откуда полководец вышел на клетку цели; нет — стоял у неё (`from` фигуры). */
    came?: Coord,
  ): AttackResult {
    const f = this.save.figures.general;
    // Налегке — истощение до минуты боя (ДР-2): в бой идут те, кто дошёл.
    this.wearGeneral(at);
    const troops = f.troops ?? {};
    const men = troopTotal(troops);
    const seed = marchSeed(this.save.seed, this.save.nextMarch++);
    const defense = this.powerNow(target, at);
    // Людей двора — до боя: у логова народ выводится из силы, а бой её убавит.
    const popThere = this.popNow(target, at);
    const garrison = garrisonOf(this.save.seed, target.id, defense, target.castle);
    const garrisonMen = stackTotal(garrison.kinds);
    const field = resolveField({
      seed,
      // Место боя — клетка цели; переправа — если полководец вышел на неё через русло.
      ground: groundAt(this.save.seed, target, came ?? this.save.figures.general.from),
      // Мораль между боями — у обеих сторон одним правилом (14.31): дружина и гарнизон логова своими парами.
      attacker: {
        kinds: kindsOf(troops),
        spirit: this.generalSpirit(),
        pips: this.generalPips(),
        ...this.generalFlanks(),
        rest: this.generalRest(at),
        scars: this.generalScars(),
      },
      // Штурм из своего лагеря: гарнизон дерётся с духом осады и обстрела (`besiegedRest`); стен у двора мира нет — штурм
      // идёт в поле, во всю ширину (стена-проход, `world/wall`, — только у города игрока).
      defender: { kinds: garrison.kinds, rest: this.besiegedRest(target.id, at, garrisonMen, camp) },
      // Место и час для черт (ДР-4): клетка цели; штурм из своего лагеря — осадный бой.
      where: this.whereAt(target, camp !== null),
    });
    if (field.result) {
      f.rest = restAfter(field.rest.attacker, at, this.menOf(troopsAfter(troops, troopLosses(troops, field.result.sides.attacker.losses))));
      this.setLairRest(target.id, restAfter(field.rest.defender, at, garrisonMen * (1 - field.defenderLoss)));
    }
    const lostTroops = field.result ? troopLosses(troops, field.result.sides.attacker.losses) : {};
    const left: TroopStack = {};
    for (const [id, n] of Object.entries(troops) as [keyof TroopStack, number][]) {
      const rest = (n ?? 0) - (lostTroops[id] ?? 0);
      if (rest > 0) left[id] = rest;
    }
    const survivors = troopTotal(left);
    const lostMen = men - survivors;
    const enemyLost = Math.round(defense * field.defenderLoss);

    const prev = this.damageOf(target.id, at);
    this.save.damage[target.id] = {
      loss: Math.min(0.95, prev + field.defenderLoss * (1 - prev)),
      at: this.liveAt(target.id, at),
    };
    // Набег роняет отношение с самим двором и, слабее, с остальными дворами
    // того же племени: обида племени и есть среднее по его дворам.
    this.moveAttitude(target.id, ATTACK_ATTITUDE, at);
    if (target.tribeId) {
      for (const other of this.gen.settlements) {
        if (other.id === target.id || other.tribeId !== target.tribeId) continue;
        this.moveAttitude(other.id, ATTACK_ATTITUDE_TRIBE, at);
      }
    }

    // Ответ соседа считается здесь же и **до** исхода: врагов наживают
    // нападением, а не победой (см. `avenge`).
    this.avenge(target, at);

    // Бой — та же разведка, и лучшая: гарнизон посчитан своими глазами.
    const intel = this.snapshot(target, at);
    this.save.intel[target.id] = intel;

    // Логово не «побито», а сожжено: победа убирает его с карты вместе со всеми
    // набегами, которые оттуда шли. Разбирается это до добычи — брать её потом
    // будет уже не у кого, и запас логова поэтому не восстанавливается.
    const burned = isLair(target) && field.won;
    const arms = burned ? this.lairArmsAt(target, at, defense) : 0;
    // Победитель выгребает склад и казну дочиста — всё, кроме тайника, и не
    // больше, чем отряд поднимет. Дверь та же, что у набега на нашу деревню:
    // одностороннего дележа в игре нет.
    const haul = this.haul({ warrior: survivors }, true);
    const took = field.won
      ? this.takeLoot(
          target,
          at,
          haul.carry,
          this.bondedAt(popThere),
          haul.escort,
          this.fateFor(declared, target.id, at),
          popThere,
        )
      : null;
    if (took) this.leadFrom(target.id, popThere, took, at);
    const gain = took ? winnerGain(took) : null;
    const spoils: Loot | null = took && took.takenTotal > 0 ? took.taken : null;
    // Сжигается логово после того, как из него всё вынесли: сожжённое уже не
    // отдаёт ни добра, ни разведданных — их брать не у кого.
    if (burned) this.burnLair(target, at);
    // Взятый, но не сожжённый город получает знак участи. Сожжённое логово знака не
    // получает: вместо него на карте пепелище, и оно говорит само за себя.
    else if (took) this.markFall(target.id, this.fateFor(declared, target.id, at), at);
    // Выигранный набег на поселение оставляет разорение: сжечь чужой двор нельзя
    // (он чужой, а позже будет человеческий), но и стоять нетронутым после
    // победы он не должен. Ставится это **после** добычи: разоряют то, что не
    // унесли, а склад разорённого двора не наполняется, пока стоят его часы.
    if (field.won && !burned) {
      this.sackSettlement(target.id, at, this.save.profile?.name ?? 'Мы');
    }
    const lootText =
      (took ? gainText(took) : '') +
      (took && took.hiddenTotal > 0 ? ` В тайнике у них осталось ${took.hiddenTotal}.` : '') +
      (arms > 0 ? ` Снаряжения ${arms}.` : '');
    const record: BattleRecord | null = field.result
      ? {
          us: 'attacker',
          result: field.result,
          // Наш состав известен поимённо, чужой выводится из его же ступени
          // снаряжения: замок выходит латниками, малое поселение — дубинщиками.
          troops: { attacker: { ...troops }, defender: troopsOfKinds(garrison.kinds, garrison.gear) },
          // Бой идёт на клетке цели: у брода, на гребне, у опушки — как там и есть.
          place: this.placeOf(target),
          // Логово — лагерь в лесу (ролик TW); прочие цели — поле.
          ...(isLair(target) ? { site: 'lair' as const } : {}),
          // Обстрел из своего лагеря перед штурмом — ролик начнётся с него (только показ: дух ядро уже посчитало).
          ...(isLair(target) && craftCount(camp?.craft, 'bombard') > 0 ? { shots: craftCount(camp?.craft, 'bombard') } : {}),
        }
      : null;

    const reportId = `atk${seed}`;
    this.addReport({
      id: reportId,
      at,
      kind: 'raid',
      title: burned
        ? `Логово сожжено: ${target.name}`
        : field.won
          ? `Набег удался: ${target.name}`
          : `Набег отбит: ${target.name}`,
      target: { id: target.id, name: target.name, x: target.x, y: target.y },
      won: field.won,
      sent: { warrior: men },
      lost: lostMen > 0 ? { warrior: lostMen } : {},
      enemyPower: Math.round(defense),
      enemyLost,
      loot: spoils,
      hidden: took?.hiddenTotal ?? 0,
      led: gain?.bonded,
      intel,
      battle: record,
      text:
        (burned
          ? `Логово ${target.name} выжжено дотла. Набегов оттуда больше не будет.${lootText}`
          : field.won
            ? `Гарнизон ${target.name} разбит, двор разорён.${lootText}`
            : `Не прорвались, их оборона крепче.${survivors === 0 ? ' Полководец пал.' : ' Уцелевшие отходят с полководцем.'}`) +
        // У двора мира стены нет: строка дел — без пролома, как меню лагеря (`craftGain(…, walls: false)`).
        (camp?.craft ? ` ${craftNote(camp.craft, false)}` : ''),
      read: false,
    });

    this.addEffect({
      id: `${reportId}-battle`,
      lost: lostMen > 0 ? { warrior: lostMen } : {},
      lostTroops,
      // Удар из поля: раненые лежат при полководце, пока дружина не вернётся.
      field: lostTroops,
      // Обоз идёт домой сам: полководец остаётся в поле, а добыча ему не нужна.
      // Уведённые идут тем же обозом — невольниками.
      resources: spoils ?? {},
      ...(gain?.bonded ? { bonded: gain.bonded } : {}),
      // Оружие едет числом: во что оно превратится, решает племя — про кузницу
      // и её список мир не знает.
      arms: arms > 0 ? arms : undefined,
      lair: burned || undefined,
      // Взятый замок считается отметкой, а не золотом: золото теперь везут и из логова.
      castle: (field.won && target.castle) || undefined,
      prestige: field.won ? 4 : 0,
      morale: field.won ? 4 : -6,
      battle: field.won ? 'won' : 'lost',
      ...scarOf(field, 'attacker'),
      // Бой полководца — его дело. Пустой бой (некому было драться) делом не считается.
      ...(field.result ? { deed: { agent: 'general' as const, ok: field.won, at } } : {}),
      ...this.flankDeed(field, 'attacker', field.won, at, target),
      text: burned
        ? `Логово ${target.name} сожжено.`
        : field.won
          ? `Набег на ${isLair(target) ? 'логово' : 'город'} ${target.name} удался.`
          : `Набег на ${isLair(target) ? 'логово' : 'город'} ${target.name} отбит.`,
      good: field.won,
    });

    if (survivors === 0) {
      f.troops = undefined;
      this.defeatGeneral(at, `разбит у ${placeWord(target, 'of')}.`, `у ${placeWord(target, 'of')}`, { id: target.id, name: target.name, x: target.x, y: target.y }, seed);
    } else {
      f.troops = left;
    }
    this.write();
    return { error: null, reportId, won: field.won };
  }

  // ---------- Перехват в поле ----------

  /**
   * Скорость фигуры на этом отрезке, клеток в миллисекунду. Считается той же
   * формулой, что и обычный переход (`travelTime`), по тому же ландшафту:
   * своей арифметики у погони нет, иначе она разошлась бы с ходьбой.
   */
  private paceOf(id: FigureId, from: Coord, to: Coord): number {
    // Мерная дорога, а не одна клетка (ДР-2): срок одной клетки упирается в пол самого короткого похода
    // (`MARCH_MIN_SECONDS`), и погоня всех фигур шла одним темпом, какой бы ни была их скорость, — режим марша на неё не
    // влиял бы вовсе. Путь линеен по длине, мерная дорога пола не касается — та же мерка, что у дальности сервера
    // (`pvp.fieldReach`).
    const seconds = travelTime(PACE_SPAN, terrainFactor(this.save.seed, from, to), this.speedOf(id));
    return seconds > 0 ? PACE_SPAN / realMs(seconds) : 0;
  }

  /**
   * Скорость фигуры по равнине: у полководца — в его режиме марша (ДР-2, `pvp.generalSpeed`), одна мерка на ход, план,
   * перехват и погоню (MAP-9). `gait` — режим для плана «а если так» (окно выбора); нет — нынешний.
   */
  private speedOf(id: FigureId, gait?: Gait): number {
    return figureSpeed(id, gait ?? this.save.figures.general.gait);
  }

  // ---------- Режим марша полководца (ДР-2, docs/siege_v2.md, 25.1) ----------
  //
  // Режим — свойство полководца (`StoredFigure.gait`); что он даёт и отнимает, решает дверь `world/gait`. Здесь — где он
  // живёт в мире: истощение налегке отрезком вне своих стен (`wear`), смена дома и в пути (`setGait`, стоянка `halt`),
  // строки выбора до приказа (`gaitRows`) и дух отряда с обозом (`generalSpirit`).

  /** Сид истощения отрезка: мир и минута начала — тот же отрезок даёт тех же ушедших онлайн и в догоне. */
  private wearSeed(since: number): string {
    return `${this.save.seed}:${since}`;
  }

  /**
   * Налегке вне своих стен — начать отрезок истощения с минуты `now`, если его нет (М4). Не налегке, в походе на город игрока
   * (войском владеет сервер) и без отряда — отрезка нет.
   */
  private startWear(now: number): void {
    const f = this.save.figures.general;
    if (f.gait !== 'light' || f.war || f.wear || f.phase === 'down') return;
    const troops = f.troops ?? {};
    if (troopTotal(troops) === 0) return;
    f.wear = { since: now, at: now, base: { ...troops }, gone: {}, lost: 0 };
  }

  /**
   * Состав сменили не истощением (бой, вставшие раненые) — новый отрезок с минуты прошлой сверки: уход — от нового состава.
   * Бой всегда идёт после сверки в свою минуту (`attackAt`, `resolveChase`, `resolveStrike`, приход), поэтому эта минута и
   * есть минута боя.
   */
  private wearRebase(): void {
    const f = this.save.figures.general;
    const w = f.wear;
    if (!w) return;
    const expect = troopsAfter(w.base, w.gone);
    const troops = f.troops ?? {};
    if (TROOP_IDS.every((id) => (expect[id] ?? 0) === (troops[id] ?? 0))) return;
    f.wear = { since: w.at, at: w.at, base: { ...troops }, gone: {}, lost: w.lost };
  }

  /**
   * Сколько отрезок налегке уносит к минуте `t` сверх уже списанного, по видам (`gait.roadLosses`). Дорога удара и выручки
   * (ДР-5) — своим сидом и не дальше своего срока: за неё уходят ровно те, кого снял сервер (`gait.strikeWorn`).
   */
  private wearDue(t: number): TroopStack {
    const w = this.save.figures.general.wear;
    if (!w || !(t > w.at)) return {};
    const ms = Math.min(t - w.since, w.span ?? Infinity);
    return troopsAfter(roadLosses(w.base, 'light', ms, w.seed ?? this.wearSeed(w.since)), w.gone);
  }

  /**
   * Списать истощение налегке к минуте `t` (М4): ушедшие — последствием в племя (больные и отставшие, не раненые), без строки
   * летописи — её пишет конец отрезка (`endWear`). Зовут её приход, бой, приказ и пульс: уход отрезка — функция минуты, и
   * сверка в любой пульс даёт тех же ушедших.
   */
  private wearGeneral(t: number): void {
    const f = this.save.figures.general;
    if (!f.wear) return;
    if (f.gait !== 'light' || f.war || f.phase === 'down' || f.gone) {
      f.wear = undefined;
      return;
    }
    this.wearRebase();
    // Дорога удара кончилась раньше `t` (ДР-5): сначала она целиком, дальше — обычный отрезок от её конца.
    const leg = f.wear;
    if (leg?.span !== undefined && t > leg.since + leg.span) this.legDone();
    this.wearTo(t);
  }

  /**
   * Дорога удара или выручки (ДР-5) списана целиком — уход ровно тот, что снял сервер, — и отрезок продолжается обычным от её
   * конца: в поле налегке отряд тает и дальше. Состав сменили посреди дороги — отрезок уже обычный, и дороги нет.
   */
  private legDone(): void {
    const f = this.save.figures.general;
    this.wearRebase();
    const leg = f.wear;
    if (leg?.span === undefined) return;
    const end = leg.since + leg.span;
    this.wearTo(end);
    if (f.wear && f.troops) f.wear = { since: end, at: end, base: { ...f.troops }, gone: {}, lost: f.wear.lost };
  }

  /**
   * Дорога удара начинается (ДР-5): отрезок налегке с минуты выхода от нынешнего состава — сидом и сроком, которые сервер войны
   * выведет из того же приказа (`gait.strikeSeed`). Не налегке, без отряда, в походе войны и без дороги — ничего.
   */
  private strikeLeg(now: number, ms: number, seed: string): void {
    const f = this.save.figures.general;
    if (f.gait !== 'light' || f.war || !f.troops || !(ms > 0)) return;
    this.wearGeneral(now);
    if (!f.troops) return;
    f.wear = { since: now, at: now, base: { ...f.troops }, gone: {}, lost: f.wear?.lost ?? 0, seed, span: ms };
  }

  /** Списать отрезок к минуте `t` — тело `wearGeneral` без проверок и без дороги удара. */
  private wearTo(t: number): void {
    const f = this.save.figures.general;
    const w = f.wear;
    if (!w || !(t > w.at)) return;
    const due = this.wearDue(t);
    w.gone = plusTroops(w.gone, due);
    w.at = t;
    const n = troopTotal(due);
    if (n === 0) return;
    const left = troopsAfter(f.troops ?? {}, due);
    f.troops = troopTotal(left) > 0 ? left : undefined;
    w.lost += n;
    this.addEffect({
      id: `gait-wear-${t}`,
      lost: { warrior: n },
      lostTroops: due,
      // Ушедшие от истощения — больные и отставшие, а не раненые: лазарет их не кладёт (как истощение лагеря).
      routed: true,
      resources: {},
      prestige: 0,
      morale: 0,
      battle: null,
      text: '',
      good: false,
    });
    if (!f.troops) this.endWear(t);
  }

  /** Отрезок налегке кончился в минуту `t` (дома, смена режима, отряд растаял): списать и сказать строкой, сколько ушло. */
  private endWear(t: number): void {
    const f = this.save.figures.general;
    if (!f.wear) return;
    if (f.troops) this.wearGeneral(t);
    const lost = f.wear?.lost ?? 0;
    f.wear = undefined;
    if (lost <= 0) return;
    this.addEffect({
      id: `gait-worn-${t}`,
      lost: {},
      resources: {},
      prestige: 0,
      morale: 0,
      battle: null,
      text: f.troops
        ? `Налегке ушло бойцов: ${lost}. Больные и отставшие — цена быстрого марша без обоза.`
        : `Налегке отряд растаял в пути: ушли все ${lost}. Больные и отставшие — цена марша без обоза.`,
      good: false,
    });
  }

  /** Дух отряда полководца в его боях (М5б): с обозом — без строки голода (`PlayerProfile.spiritFed`), иначе — дух дружины. */
  private generalSpirit(): Spirit | undefined {
    const fed = fedOnRoad(this.save.figures.general.gait) ? this.save.profile?.spiritFed : undefined;
    return fed ? { morale: fed.morale, discipline: fed.discipline } : this.ownSpirit();
  }

  /**
   * Черты нашей стороны (ДР-4): черты армии из слепка (`PlayerProfile.scars`) и голод — дух со строкой голода
   * (`PlayerProfile.spiritFed` есть) и без сытого обоза (`fed`). Сторона несёт их всегда, и без черт: голод нужен метке боя
   * («Голодный ропот»), а черт нет — поправок в бою нет. Стоит рядом с духом: наша сторона узнаётся по обоим.
   */
  private ownScars(fed = false): ScarSide {
    const held = this.save.profile?.scars ?? [];
    const hungry = !fed && this.save.profile?.spiritFed !== undefined;
    return { held: [...held], ...(hungry ? { hungry: true as const } : {}) };
  }

  /** Черты отряда полководца (ДР-4): с обозом в пути — сытые (М5б), как его дух. */
  private generalScars(): ScarSide {
    return this.ownScars(fedOnRoad(this.save.figures.general.gait));
  }

  /**
   * Где и когда бой (ДР-4): место клетки (`place.scarWhere`) и час партии из слепка — ночь и зима той же меркой, что строка
   * состояния (`derived.dayPartAt`, `seasonOf`); `siege` — осадной дверью.
   */
  private whereAt(cell: Coord, siege = false): ScarWhere {
    const place = this.placeOf(cell);
    const w = scarWhere(place, siege);
    if (place.time !== undefined) {
      if (dayPartAt(place.time) === 'night') w.night = true;
      if (seasonOf(place.time) === 'winter') w.winter = true;
    }
    return w;
  }

  /** Дома — у своих ворот, не в пути и не в походе на игрока — режим меняют сразу и даром (М2). */
  private gaitFree(now: number): boolean {
    const f = this.save.figures.general;
    return !f.war && f.phase !== 'moving' && f.phase !== 'down' && Boolean(this.touching(this.figureAt(f, now))?.home);
  }

  /** Почему режим не сменить на `next` сейчас; null — можно. Одна проверка на окно и на приказ. */
  private gaitBlock(next: Gait, now: number): string | null {
    const f = this.save.figures.general;
    const off = this.offDuty('general', now);
    if (off) return off;
    if (this.ourSiege(now) || this.warCampOf()) return 'В лагере режим марша не меняют: лагерь стоит тем обозом, с которым пришёл.';
    if (f.war) {
      const w = this.warLed();
      if (w && w.phase === 'march' && w.mode === 'siege' && next === 'light') return `${LIGHT_NO_CAMP} Поход идёт на осаду.`;
    } else {
      // Удар по лагерю у своих стен и выручка уже названы серверу войны: их дорогу и срок судит он.
      const busy = this.warGeneralBusy();
      if (busy) return busy;
    }
    if (next === 'light' && (f.assault?.siege || f.errand?.deed === 'siege')) return `${LIGHT_NO_CAMP} Отряд идёт осаждать.`;
    if (this.gaitFree(now)) return null;
    const halt = (f.halt ?? 0) - now;
    if (halt > 0) return `Отряд ещё стоит, обоз не собран: ${formatLeft(halt / 1000)}.`;
    return this.energyCost('general', 'gait', now).block;
  }

  /** Режим глазами окна отряда: какой сейчас, сколько ушло налегке, чего стоит сменить. */
  private gaitView(now: number): GaitView {
    const f = this.save.figures.general;
    const gait = readGait(f.gait);
    const block: Partial<Record<Gait, string | null>> = {};
    for (const g of GAITS) if (g !== gait) block[g] = this.gaitBlock(g, now);
    const free = this.gaitFree(now);
    return {
      gait,
      haltUntil: (f.halt ?? 0) > now ? (f.halt as number) : 0,
      worn: f.wear ? f.wear.lost + troopTotal(this.wearDue(now)) : 0,
      change: { free, price: free ? 0 : priceOf('gait'), haltMs: free ? 0 : gaitHaltMs(), block },
    };
  }

  /**
   * Та же дорога в каждом режиме (ДР-2) — для выбора до приказа: срок той же функцией, что исполнит приказ (`walkOf`),
   * ожидание ушедших налегке к приходу, встанет ли лагерь, хватит ли энергии с дорогой в темпе режима.
   */
  private gaitRows(walkOf: (g: Gait) => number, action: 'storm' | 'siege', now: number): GaitRow[] {
    const men = troopTotal(this.save.figures.general.troops ?? {});
    return GAITS.map((g) => {
      const walkMs = walkOf(g);
      return {
        gait: g,
        walkMs,
        lost: Math.round(men * lightShare(g, walkMs)),
        // Вывоз дошедших в этом режиме (ДР-5) — той же дверью, что возьмёт добычу.
        carry: Math.floor(this.haul({ warrior: Math.max(0, men - Math.round(men * lightShare(g, walkMs))) }, true, g).carry),
        siege: siegeBlockOf(g),
        energy: this.energyCost('general', action, now, walkMs, g),
      };
    });
  }

  /**
   * Сменить режим марша (М2, М6). Дома — сразу и даром. В пути и в поле — стоянка (`gaitHaltMs`) и цена: отряд стоит, путь и
   * погоня продолжаются после стоянки новой скоростью, тем же уравнением встречи; не догнать — погоня снимается. Налегке
   * до этой минуты — истощение списано и сказано строкой; налегке с неё — отрезок с этой минуты. Поход на город игрока —
   * приказом серверу войны той же стоянкой и ценой.
   */
  async setGait(next: Gait): Promise<string | null> {
    const now = this.clock();
    const f = this.save.figures.general;
    const was = readGait(f.gait);
    if (next === was) return null;
    const block = this.gaitBlock(next, now);
    if (block) return block;
    if (f.war) {
      const err = await this.warSend({ op: 'gait', id: f.war, gait: next });
      if (err) return err;
      const w = this.warList().find((x) => x.id === f.war);
      if (w) this.warGeneral(w, now);
      this.write();
      return null;
    }
    const setField = (): void => {
      if (next === 'normal') delete f.gait;
      else f.gait = next;
    };
    if (this.gaitFree(now)) {
      setField();
      this.write();
      return null;
    }
    this.energyOf('general', now);
    if (was === 'light') this.endWear(now);
    this.payEnergy('general', 'gait', now);
    setField();
    const halt = now + gaitHaltMs();
    f.halt = halt;
    if (f.phase === 'moving') {
      const from = this.figureAt(f, now);
      const m = f.chase ? this.chaseTarget(f.chase.marchId) : null;
      if (f.chase) {
        const meet = m ? meetingOf(from, this.paceOf('general', from, marchPosition(m, halt)), m, halt) : null;
        if (!meet) {
          this.breakChase(f, now, `После стоянки не догнать${m ? ` отряд из «${this.raider(m)}»` : ''}: дойдёт раньше. Полководец встал в поле.`, 0);
        } else {
          f.from = from;
          f.to = clampToWorld(meet.at);
          f.departAt = halt;
          f.arriveAt = Math.max(halt, Math.round(meet.time));
        }
      } else {
        const seconds = travelTime(distance(from, f.to), terrainFactor(this.save.seed, from, f.to), this.speedOf('general'));
        f.from = from;
        f.departAt = halt;
        f.arriveAt = halt + Math.round(realMs(seconds));
      }
    }
    if (next === 'light') this.startWear(now);
    // Стойка сменилась: путь стал другим — отметка энергии с этой минуты в темпе нового режима.
    this.energyOf('general', now);
    this.write();
    return null;
  }

  /**
   * Чужой отряд, который можно догонять: идущий на цель и идущий домой (MAP-9, OWNER-DECISIONS п. 5 — на обратном пути
   * его догоняют и отбивают добычу). null — такого нет.
   */
  private chaseTarget(marchId: string): StoredMarch | null {
    const m = this.save.marches.find((x) => x.id === marchId);
    if (!m || m.own || (m.phase !== 'out' && m.phase !== 'back')) return null;
    return m;
  }

  /** Чей отряд — имя его двора: у идущего домой имена откуда и куда уже переставлены (`turnHome`). */
  private raider = (m: StoredMarch): string => (m.phase === 'back' ? m.toName : m.fromName);

  /** Сколько из добра не поместится на склад по слепку деревни — для слов донесения (MAP-9); режет склад племя (`addStock`). */
  private overflow(loot: Loot): number {
    const p = this.save.profile;
    const cap = p?.storeCap;
    if (!p || cap === undefined) return 0;
    let over = 0;
    for (const [r, n] of Object.entries(loot) as [keyof Loot, number | undefined][]) {
      if (r === 'gold' || !((n ?? 0) > 0)) continue;
      over += Math.max(0, (n ?? 0) - Math.max(0, cap - (p.stock[r] ?? 0)));
    }
    return Math.floor(over);
  }

  /**
   * Где и когда встретимся, если приказать сейчас. Всё решается уравнением
   * (`pursuit.intercept`) один раз, в момент вопроса: ни фонового счёта, ни
   * шагов по таймеру за этим нет.
   */
  private planChase(m: StoredMarch, now: number): { meet: Meeting | null; reason: string | null } {
    // Приказ откажет — встречи план не показывает: отказ один на план и на приказ (`chaseBlock`).
    const blocked = this.chaseBlock(now);
    if (blocked) return { meet: null, reason: blocked };
    const f = this.save.figures.general;
    this.settleHandover(f, now);
    const off = this.offDuty('general', now) ?? this.retiringBlock('general');
    if (off) {
      return {
        meet: null,
        reason: off,
      };
    }
    if (f.handover) {
      return {
        meet: null,
        reason: `Отряд ещё в сборе: ${formatLeft(Math.max(0, f.handover.until - now) / 1000)}.`,
      };
    }
    if (troopTotal(f.troops ?? {}) === 0) {
      return { meet: null, reason: this.noBand(now, 'При полководце нет отряда. За дружиной надо домой.') };
    }
    const from = this.figureAt(f, now);
    const ahead = marchPosition(m, now);
    // Стоянка смены режима (ДР-2, М6): погоня выходит после неё, тем же уравнением.
    const meet = meetingOf(from, this.paceOf('general', from, ahead), m, Math.max(now, f.halt ?? 0));
    if (!meet) {
      // Отдельная причина, а не общее «нельзя»: игрок должен понимать, что
      // помешало — расстояние или время, которое осталось у цели.
      return {
        meet: null,
        reason: `Не догнать: им идти ${formatLeft(secondsLeft(m.arriveAt, now))}, дойдут раньше.`,
      };
    }
    // Перехват — бой в поле: его цена в энергии — к минуте встречи, с дорогой до неё (docs/agent_energy.md).
    const tired = this.energyCost('general', 'chase', now, Math.max(0, meet.time - now)).block;
    if (tired) return { meet: null, reason: tired };
    return { meet, reason: null };
  }

  async interceptPlan(marchId: string): Promise<InterceptPlan> {
    const now = this.clock();
    const m = this.chaseTarget(marchId);
    if (!m) {
      return {
        can: false,
        reason: 'Этот отряд уже не догнать.',
        at: null,
        seconds: 0,
        targetName: '',
        men: 0,
        targetSeconds: 0,
      };
    }
    const { meet, reason } = this.planChase(m, now);
    return {
      can: meet !== null,
      reason,
      at: meet ? { x: Math.round(meet.at.x), y: Math.round(meet.at.y) } : null,
      seconds: meet ? meet.seconds : 0,
      targetName: this.raider(m),
      men: stackSize(m.units),
      targetSeconds: secondsLeft(m.arriveAt, now),
      ...(meet ? { energy: this.energyCost('general', 'chase', now, Math.max(0, meet.time - now)) } : {}),
    };
  }

  /**
   * Почему перехват невозможен при любой цели — одна дверь на план (`planChase`, кнопка «Перехватить в поле») и на
   * приказ (`intercept`). Прежде план не знал про лагерь, и кнопка показывала встречу, которую приказ отменял
   * отказом.
   *
   * Армия в лагере занята: уйти она может, но только сняв осаду, и это отдельный приказ, а не побочный итог погони.
   * Перехват — выход полководца в поле, и из осаждённого города он такой же невозможный, как любой другой.
   */
  private chaseBlock(now: number): string | null {
    if (this.ourSiege(now)) return CHASE_FROM_CAMP;
    const busy = this.warGeneralBusy();
    if (busy) return busy;
    if (this.touching(this.figureAt(this.save.figures.general, now))?.home) return this.siegeBlock(now);
    return null;
  }

  async intercept(marchId: string): Promise<string | null> {
    const now = this.clock();
    // Отказ здесь, в приказе: принять его и не сдвинуть фигуру было бы хуже отказа.
    const blocked = this.chaseBlock(now);
    if (blocked) return blocked;
    const m = this.chaseTarget(marchId);
    if (!m) return 'Этот отряд уже не догнать.';
    const { meet, reason } = this.planChase(m, now);
    if (!meet) return reason ?? 'Перехват не выходит.';
    this.setChase(this.save.figures.general, meet, now, marchId);
    // Цена — при приказе (`planChase` проверил, что её хватит к встрече).
    this.payEnergy('general', 'chase', now);
    this.write();
    return null;
  }

  /** Курс на точку встречи. Прибытие ставится ровно на её время. */
  private setChase(f: StoredFigure, meet: Meeting, now: number, marchId: string): void {
    this.energyOf('general', now);
    this.wearGeneral(now);
    f.from = this.figureAt(f, now);
    f.to = clampToWorld(meet.at);
    f.departAt = Math.max(now, f.halt ?? 0);
    f.arriveAt = Math.max(now, Math.round(meet.time));
    f.phase = 'moving';
    f.chase = { marchId };
    f.strike = undefined;
    f.assault = undefined;
  }

  /**
   * Цель сменила курс или пропала — встреча считается заново. Это не тик:
   * поворот отряда домой и его исчезновение и так разбираются по времени в
   * `advance`, и пересчёт живёт ровно в этом событии.
   */
  private rechase(marchId: string, now: number): void {
    const f = this.save.figures.general;
    if (f.chase?.marchId !== marchId) return;
    const m = this.chaseTarget(marchId);
    if (!m) {
      this.breakChase(f, now, 'След потерян. Полководец встал в поле.');
      return;
    }
    const plan = this.planChase(m, now);
    if (!plan.meet) {
      // Цель повернула домой, и догнать её уже нельзя — дома раньше встречи (MAP-9, OWNER-DECISIONS п. 5): погоня
      // снимается без штрафа к морали.
      this.breakChase(f, now, `Не догнали: ${this.raider(m)} дойдут домой раньше. Полководец встал в поле.`, 0);
      return;
    }
    this.setChase(f, plan.meet, now, marchId);
  }

  /** Погоня сорвалась: полководец останавливается там, где стоял. */
  private breakChase(f: StoredFigure, now: number, text: string, morale = -1): void {
    this.energyOf('general', now);
    const at = this.figureAt(f, now);
    f.from = { ...at };
    f.to = { ...at };
    f.departAt = now;
    f.arriveAt = now;
    f.phase = this.touching(at)?.home ? 'home' : 'field';
    f.chase = undefined;
    // Встал у своих ворот — дружина в обороне гарнизоном (см. `stepFigures`).
    if (f.phase === 'home') {
      this.homecoming(now);
      this.resiege(HOME_ID, now);
    }
    this.addEffect({
      id: `chase-lost-${now}`,
      lost: {},
      resources: {},
      prestige: 0,
      morale,
      battle: null,
      text,
      good: false,
    });
  }

  /**
   * Встреча состоялась (или не состоялась) — разбираем её в момент прибытия.
   * Бой считает то же ядро, что и всё остальное: своего боя у поля нет.
   */
  private resolveChase(f: StoredFigure, at: number): void {
    this.wearGeneral(at);
    const marchId = f.chase?.marchId ?? '';
    f.chase = undefined;
    const m = this.chaseTarget(marchId);
    if (!m) {
      this.breakChase(f, at, 'Перехват сорвался, отряда на месте нет.');
      return;
    }
    const here = this.figureAt(f, at);
    const them = marchPosition(m, at);
    if (distance(here, them) > FIGURE_TOUCH) {
      this.breakChase(f, at, `Перехват сорвался, ${this.raider(m)} прошли стороной.`);
      return;
    }
    const name = this.raider(m);
    const back = m.phase === 'back';

    const spot = { x: Math.round(here.x), y: Math.round(here.y) };
    const troops = f.troops ?? {};
    const men = troopTotal(troops);
    const seed = marchSeed(this.save.seed, this.save.nextMarch++);
    const party = raidingParty(this.save.seed, m.id, m.power);
    const partyMen = stackTotal(party.kinds);
    const field = resolveField({
      seed,
      // Место боя — клетка встречи; нападает полководец, и переправа — его шаг на неё (бой на воде — переправа).
      ground: groundAt(this.save.seed, spot, f.from),
      // Мораль между боями (14.31): дружина — своей парой, отряд — своей.
      attacker: {
        kinds: kindsOf(troops),
        spirit: this.generalSpirit(),
        pips: this.generalPips(),
        ...this.generalFlanks(),
        rest: this.generalRest(at),
        scars: this.generalScars(),
      },
      defender: { kinds: party.kinds, rest: restAt(m.rest, at, partyMen) },
      // Место и час для черт (ДР-4): клетка встречи.
      where: this.whereAt(spot),
    });
    if (field.result) {
      f.rest = restAfter(field.rest.attacker, at, this.menOf(troopsAfter(troops, troopLosses(troops, field.result.sides.attacker.losses))));
      // Отбившийся отряд идёт к стене уставшим — перехват стоит пробовать и тогда, когда победить нельзя.
      m.rest = restAfter(field.rest.defender, at, partyMen * (1 - field.defenderLoss));
    }
    const lostTroops = field.result ? troopLosses(troops, field.result.sides.attacker.losses) : {};
    const left: TroopStack = {};
    for (const [id, n] of Object.entries(troops) as [keyof TroopStack, number][]) {
      const rest = (n ?? 0) - (lostTroops[id] ?? 0);
      if (rest > 0) left[id] = rest;
    }
    const survivors = troopTotal(left);
    const lostMen = men - survivors;
    const enemyLost = Math.round(m.power * field.defenderLoss);

    const record: BattleRecord | null = field.result
      ? {
          us: 'attacker',
          result: field.result,
          troops: { attacker: { ...troops }, defender: troopsOfKinds(party.kinds, party.gear) },
          // Бой идёт в чистом поле — на той клетке, где сошлись.
          place: this.placeOf(spot),
        }
      : null;

    // Разбили идущих домой — их добыча и уведённые наши у победителя (MAP-9, OWNER-DECISIONS п. 5). Добро кладёт на склад
    // дверь племени (`addStock`, не выше вместимости): окна здесь нет — бой в мире, а не по клику; что не поместится,
    // пропадает, и донесение это называет.
    const loot = field.won && back && m.loot && Object.keys(m.loot).length > 0 ? { ...m.loot } : null;
    const freed = field.won && back ? takingOf(m) : 0;
    // Отбитые невольники — невольниками, пленные и горожане — людьми (АУ-8, п. 5): ни потери, ни двойного счёта.
    const freedBonded = field.won && back ? Math.min(m.led ?? 0, m.ledBonded ?? 0) : 0;
    const over = loot ? this.overflow(loot) : 0;
    const regained = loot !== null || freed > 0;
    const wonText = back
      ? `${name} разбиты в поле на пути домой.${regained ? ' Добычу отбили.' : ''}${freed > 0 ? ` Вернулись свои: ${freed}.` : ''}${over > 0 ? ` Унесли бы ещё ${over}, но склад полон.` : ''}`
      : `${name} разбиты в поле и до города не дошли.`;
    const lostText = back
      ? `${name} отбились и уходят домой${m.loot || m.held || m.led ? ' с добычей' : ''}.`
      : `${name} пробились дальше.`;

    const reportId = `chase${seed}`;
    this.addReport({
      id: reportId,
      at,
      kind: 'raid',
      title: field.won ? `Перехват удался: ${name}` : `Перехват не удался: ${name}`,
      target: { id: m.fromId, name, x: spot.x, y: spot.y },
      won: field.won,
      sent: { warrior: men },
      lost: lostMen > 0 ? { warrior: lostMen } : {},
      enemyPower: Math.round(m.power),
      enemyLost,
      loot,
      intel: null,
      battle: record,
      text: field.won ? wonText : `${lostText}${survivors === 0 ? ' Полководец пал.' : ''}`,
      read: false,
    });
    this.addEffect({
      id: `${reportId}-eff`,
      lost: lostMen > 0 ? { warrior: lostMen } : {},
      lostTroops,
      // Перехват в поле: раненые лежат при полководце, пока дружина не вернётся.
      field: lostTroops,
      resources: loot ?? {},
      ...(freed - freedBonded > 0 ? { pop: freed - freedBonded } : {}),
      ...(freedBonded > 0 ? { bonded: freedBonded } : {}),
      prestige: field.won ? 4 : 0,
      morale: field.won ? 5 : -5,
      battle: field.won ? 'won' : 'lost',
      ...scarOf(field, 'attacker'),
      ...(field.result ? { deed: { agent: 'general' as const, ok: field.won, at } } : {}),
      ...this.flankDeed(field, 'attacker', field.won, at, spot),
      text: field.won
        ? regained
          ? `Добычу отбили: ${name} разбиты в поле, ${formatCoord(spot)}.`
          : back
            ? `Отряд ${name} разбит в поле, ${formatCoord(spot)}.`
            : `Набег ${name} перехвачен в поле, ${formatCoord(spot)}.`
        : `Перехват ${name} не удался.`,
      good: field.won,
    });

    if (field.won && back) {
      // Разбитые на пути домой уходят пустыми: добыча и уведённые — у победителя.
      m.loot = null;
      m.held = undefined;
      m.led = undefined;
      m.ledBonded = undefined;
      m.power = Math.max(1, m.power * (1 - field.defenderLoss));
      m.units = stackAfter(m.units, stackLosses(m.units, field.defenderLoss));
      if (stackSize(m.units) === 0) this.remove(m);
    } else if (field.won) {
      // Разбитые дальше не идут: набега не будет вовсе.
      this.remove(m);
    } else {
      // Отбились, но не даром: до деревни дойдут поредевшими.
      m.power = Math.max(1, m.power * (1 - field.defenderLoss));
      m.units = stackAfter(m.units, stackLosses(m.units, field.defenderLoss));
    }

    if (survivors === 0) {
      f.troops = undefined;
      this.defeatGeneral(at, `разбит в поле у ${formatCoord(spot)}.`, `в поле у ${formatCoord(spot)}`, { id: m.fromId, name, x: spot.x, y: spot.y }, seed);
    } else {
      f.troops = left;
      this.energyOf('general', at);
      const stop = this.figureAt(f, at);
      f.from = { ...stop };
      f.to = { ...stop };
      f.departAt = at;
      f.arriveAt = at;
      f.phase = this.touching(stop)?.home ? 'home' : 'field';
      // Встреча у самых ворот — он дома, и уцелевшие встают гарнизоном (ДР-6).
      if (f.phase === 'home') this.homecoming(at);
    }
  }

  private resolveScout(m: StoredMarch, target: GenSettlement, at: number): void {
    const power = this.powerNow(target, at);
    const scouts = m.units.scout ?? 0;
    const rng = seeded(m.seed);
    // Один разведчик на сильное поселение — риск: часовые заметят.
    const spotted = power > scouts * SCOUT_COVER && rng() < 0.6;
    const lost: UnitStack = spotted && scouts > 0 ? { scout: 1 } : {};
    const left = stackAfter(m.units, lost);
    const seen = stackSize(left) > 0;

    let intel: Intel | null = null;
    if (seen) {
      intel = this.snapshot(target, at);
      this.save.intel[target.id] = intel;
    }

    this.addReport({
      id: `${m.id}-scout`,
      at,
      kind: 'scout',
      title: seen ? `Разведка: ${target.name}` : `Разведка сорвалась: ${target.name}`,
      target: { id: target.id, name: target.name, x: target.x, y: target.y },
      won: seen,
      sent: { ...m.units },
      lost,
      enemyPower: seen ? Math.round(power) : null,
      enemyLost: null,
      loot: null,
      intel,
      battle: null,
      text: seen
        ? `Гарнизон пересчитан, мощь около ${Math.round(power)}.${spotted ? ' Одного из наших заметили.' : ''}`
        : 'Разведчика заметили, и он не вернулся.',
      read: false,
    });

    if (spotted) {
      this.addEffect({
        id: `${m.id}-scout`,
        lost,
        resources: {},
        prestige: 0,
        morale: -2,
        battle: null,
        text: `Разведка ${target.name}: часовые заметили наших.`,
        good: false,
      });
    }

    m.units = left;
    if (!seen) this.remove(m);
    else this.turnHome(m, at, null);
  }

  private resolveSupport(m: StoredMarch, target: GenSettlement, at: number): void {
    m.phase = 'stay';
    m.stayUntil = at + SUPPORT_STAY;
    this.moveAttitude(target.id, SUPPORT_ATTITUDE, at);
    this.addReport({
      id: `${m.id}-support`,
      at,
      kind: 'support',
      title: `Поддержка: ${target.name}`,
      target: { id: target.id, name: target.name, x: target.x, y: target.y },
      won: true,
      sent: { ...m.units },
      lost: {},
      enemyPower: null,
      enemyLost: null,
      loot: null,
      intel: null,
      battle: null,
      text: `Отряд встал в городе ${target.name}. Союз крепче, отряд вернётся сам.`,
      read: false,
    });
    this.addEffect({
      id: `${m.id}-support`,
      lost: {},
      resources: {},
      prestige: 2,
      morale: 2,
      battle: null,
      text: `Наш отряд стоит в ${placeWord(target, 'in')}.`,
      good: true,
    });
  }

  private resolveIncoming(m: StoredMarch, at: number): void {
    // Враг подходит и берёт город, в игре его хозяин или нет: правило отсутствия
    // снято решением владельца (docs/DEFEAT_LADDER.md). Отряд дошёл и увидел заслон.
    // Бой у стены считается сразу: он же решает, пойдут ли на приступ. Отбили бы —
    // марш может стать лагерем, и разбирать его будет уже осада.
    const wall = this.wallField(m, at);
    if (this.beginSiege(m, at, wall.field)) return;
    const { profile, party, field } = wall;
    const outcome = { won: field.won, attackerLoss: field.attackerLoss, defenderLoss: field.defenderLoss };
    // Набег, не севший в осаду, — штурм стены (ролик TW: лестницы и таран).
    const record = this.gateRecord(wall, troopsOfKinds(party.kinds, party.gear), 'wall');
    const attackerLeft = stackAfter(m.units, stackLosses(m.units, outcome.attackerLoss));
    const { warriors, warriorsLost, troopsLost, standing } = this.gateLosses(wall);
    // Пленные: часть тех, кого племя посчитало убитыми, на самом деле уведена (ниже, `captives`). Число — до отчёта:
    // его называет и отчёт, и карточка итога ролика боя (`Report.held`).
    const held = outcome.won && warriorsLost > 0 ? Math.max(1, Math.round(warriorsLost * RANSOM_SHARE)) : 0;
    // Прорвались — город взят, и его участь решает та же дверь, какой мы делим
    // чужие дворы и какой голод делит наш город (`spoils.fate`), — той ступенью,
    // что отряд объявил: склад и казна до тайника, сколько поднимет отряд, люди и
    // постройки.
    const declared = this.fateFor(m.fate, HOME_ID, at);
    const haul = this.haul(attackerLeft, false);
    const spoils = outcome.won
      ? this.fateHome(profile, haul.carry, haul.escort, at, declared)
      : null;
    const loss = spoils ? homeLoss(spoils) : null;
    // Скольких наших увели невольниками — то же число, что достаётся победителю (`winnerGain`).
    const led = spoils ? (winnerGain(spoils).bonded ?? 0) : 0;
    if (spoils && FATES[declared].chain) this.save.burnImmune[HOME_ID] = burnImmuneUntil(at);
    if (spoils) this.markFall(HOME_ID, declared, at);
    // Окно после падения — одно на оба пути: прорыв ставит его так же, как голод
    // (`siegeFalls`), и пока оно стоит, нет ни осады, ни набега (`scheduleAi`).
    if (spoils) this.save.siegeImmune[HOME_ID] = immuneUntil(at);

    // Пленные. Это не новая потеря: часть тех, кого племя уже посчитало
    // убитыми, на самом деле уведена — та же условность, что у лазарета.
    // Поэтому выкуп потом только возвращает и ничего не отнимает, а письмо о
    // нём остаётся тем, чем должно быть: потерянной возможностью, если его не
    // открыть.
    //
    // Прорвавшиеся уходят домой с добычей и уведёнными (MAP-9, OWNER-DECISIONS п. 5): на обратном пути их можно догнать
    // и отбить своё (`resolveChase`). Пленные садятся в плен у их двора, когда отряд дойдёт (`arriveHome`). Отбитые
    // у стен не уходят никуда — их больше нет, как и прежде. Люди уходят из города в минуту прорыва (последствие ниже),
    // а отряд с ними виден на карте до их двора (АУ-8, п. 5).
    const goes = spoils !== null && stackSize(attackerLeft) > 0;
    if (spoils && goes) {
      m.units = attackerLeft;
      m.power = Math.max(1, m.power * (1 - outcome.attackerLoss));
      const carried = winnerGain(spoils).resources;
      this.turnHome(m, at, Object.keys(carried).length > 0 ? { ...carried } : null);
      if (held > 0) m.held = held;
      if (led > 0) m.led = led;
      // Из уведённых — сколько наших невольников: отбитые вернутся невольниками (АУ-8, п. 5).
      if (spoils.ledBonded.taken > 0) m.ledBonded = Math.min(led, spoils.ledBonded.taken);
    } else {
      this.remove(m);
      if (held > 0) this.save.captives[m.fromId] = (this.save.captives[m.fromId] ?? 0) + held;
    }
    const taking = goes ? takingOf(m) : 0;
    const takingText = taking > 0 ? ` ${takingWords(taking)}: дойдут до ${m.toName} через ${realSpan((m.arriveAt - at) / 1000)}, можно догнать.` : '';

    this.addReport({
      id: `${m.id}-defense`,
      at,
      kind: 'defense',
      title: outcome.won ? FATE_META[declared].title : 'Нападение отбито',
      target: { id: HOME_ID, name: this.homeName(), x: this.save.home.x, y: this.save.home.y },
      won: !outcome.won,
      sent: { warrior: warriors },
      lost: warriorsLost > 0 ? { warrior: warriorsLost } : {},
      enemyPower: Math.round(m.power),
      enemyLost: Math.round(m.power * outcome.attackerLoss),
      loot: spoils && loss && spoils.lostTotal > 0 ? loss.resources : null,
      hidden: spoils?.hiddenTotal ?? 0,
      led: led || undefined,
      held: held || undefined,
      intel: null,
      battle: record,
      ...(loss?.fallen ? { fallen: loss.fallen } : {}),
      text: spoils
        ? `${goes ? this.raider(m) : m.fromName} прорвались через заслон. ${lossText(declared, spoils)}${takingText}`
        : `${m.fromName} отбиты у стен.`,
      read: false,
    });

    this.addEffect({
      id: `${m.id}-defense`,
      lost: warriorsLost > 0 ? { warrior: warriorsLost } : {},
      lostTroops: troopsLost,
      ...(troopTotal(standing) > 0 ? { standing } : {}),
      resources: {},
      ...loss,
      prestige: outcome.won ? 0 : 3,
      morale: outcome.won ? -GATE_MORALE_LOST : GATE_MORALE_WON,
      battle: outcome.won ? 'lost' : 'won',
      ...scarOf(field, 'defender'),
      // Прорвались — значит, дошли и до хозяйства за стеной. Насколько плохо,
      // решает то, сколько от заслона осталось; что с этим делать, знает племя.
      sacked: outcome.won ? Math.max(0.35, outcome.defenderLoss) : 0,
      text: outcome.won ? `Набег ${m.fromName} прорвался в город.` : `Набег ${m.fromName} отбит.`,
      good: !outcome.won,
    });
  }

  /**
   * Бой у стены против пришедшего отряда — весь, как он случится, и ничего не трогая. Им
   * решается и сам приступ (`resolveIncoming`), и садится ли отряд в осаду (`sitsDown`):
   * это один и тот же бой с тем же сидом, и второй сборки сторон быть не должно.
   */
  private wallField(m: StoredMarch, at: number) {
    const party = raidingParty(this.save.seed, m.id, m.power);
    // Отряд, отбившийся от перехвата, идёт к стене со своей усталостью (мораль между боями, `world/rest`).
    const rest = restAt(m.rest, at, stackTotal(party.kinds));
    // Набег у стены — штурм с ходу: лестницы, принесённые на себе, на треть стены (стена-проход, `world/wall`).
    return { party, ...this.gateField({ kinds: party.kinds, rest }, m.seed, m.from, at, wallFront(SCALING)) };
  }

  /**
   * Бой у своих ворот против пришедшего — **одна дверь** на набег логова (`wallField`) и на бой события (волки и
   * разбойники, `gateFight`; docs/battle_eu4.md, 14.28): сторона обороны собирается только здесь. Весь, как он
   * случится, и ничего не трогая. `from` — откуда пришли: переправу на шаге к деревне штрафует место боя.
   */
  private gateField(attacker: FieldSide, seed: number, from: Coord, at: number, front: WallFront | null) {
    const profile = this.save.profile;
    // Оборона дома: гарнизон, отряд полководца, если он в городе (у ворот или укрывшись, и во
    // время сбора тоже — `world/muster.inTown`), плюс ополчение — частокол, башня и сами
    // жители. Раскладывает их правило развёртывания, как любой бой: пехота ополчения встаёт со
    // своим родом, стрелки башни — во вторую линию. Своей раскладки у обороны нет — расстановка
    // ушла поставкой 2 (docs/battle_eu4.md, 14.27). Отряда в сборе вне города, в пути, в поле и
    // в лагере здесь нет, даже если полководец в двух шагах от ворот (`world/muster.postureOf`).
    const held = this.defenders(at);
    const home = held.all;
    const militia = Math.max(0, Math.round(profile?.militia ?? 0));
    // Башня ставит часть ополчения стрелками: людей не прибавляется, меняется род. Сторона обороны — одна дверь
    // с войной между игроками (`fights.defenceKinds`): сервер собирает её из слепка тем же кодом.
    const archers = Math.min(militia, Math.max(0, Math.round(profile?.militiaArchers ?? 0)));
    // Стена-проход (`fights.wallFight`, docs/siege_v2.md, 4.1) — у набега; бой события у ворот идёт перед воротами, в
    // поле (`front` пуст): гарнизон выходит к стае и к разбойникам, стены между сторонами нет.
    const { field } = wallFight({
      seed,
      // Место боя — своя деревня; переправа — если пришедший вышел на неё через русло.
      ground: groundAt(this.save.seed, this.save.home, from),
      attacker,
      // Ведёт оборону полководец, если он в городе (`homePips`), с отрядом и без, — со всеми отметками: у EU4 манёвр
      // обороняющегося держит переправу нападающему (docs/battle_eu4.md, 14.5, Л9). Мораль — тех, кто дома: гарнизон и
      // отряд полководца в городе своими парами, ополчение свежее (мораль между боями, 14.31).
      defender: {
        kinds: kindsOf(home),
        militia,
        archers,
        spirit: this.ownSpirit(),
        pips: this.homePips(at),
        ...this.homeFlanks(at),
        rest: this.homeRest(held, at, militia),
        scars: this.ownScars(),
      },
      front,
      // Место и час для черт (ДР-4): своя деревня; приступ к стене — осадный бой, бой события перед воротами — нет.
      where: this.whereAt(this.save.home, front !== null),
    });
    return { profile, held, home, militia, archers, field, at, front };
  }

  /**
   * Кто из обороны пал у ворот — одна дверь на набег и на бой события. Ополчение гибнет наравне со всеми, но
   * списываются только бойцы: жителей бой у ворот не уносит — за них отвечают мораль и склад.
   *
   * Погибают те, кто стоял у частокола. Потери, которые не легли ни на один вид обороны, называются поимённо здесь же
   * — со слабых, — а не числом: числом племя сняло бы их со всей дружины и могло задеть тех, кто при полководце в поле.
   * Дружина у ворот теряет свою долю сразу.
   */
  private gateLosses(gate: ReturnType<LocalWorld['gateField']>): {
    warriors: number;
    warriorsLost: number;
    troopsLost: TroopStack;
    /** Доля отряда полководца в потерях (`HomeEffect.standing`); пусто — не стоял или не пал никто. */
    standing: TroopStack;
  } {
    const { held, home, field } = gate;
    const warriors = troopTotal(home);
    // Поимённо — одна дверь с войной между игроками (`fights.homeLosses`).
    const troopsLost = homeLosses(home, field);
    const warriorsLost = Math.min(warriors, troopTotal(troopsLost));
    // Дрались все, кто дома: уцелевшие несут долю, с которой вышли из боя (мораль между боями, 14.31).
    if (field.result) this.homeBack(held, home, troopsLost, field.rest.defender, gate.at);
    const standing = this.standingLost(held.own, held.standing, troopsLost);
    return { warriors, warriorsLost, troopsLost, standing };
  }

  /**
   * Запись боя у ворот для отчёта: ядро и то, кто стоял с каждой стороны. `attacker` — пришедшие видами племени, чтобы
   * ролик их нарисовал. Ополчение — не бойцы: частокол, башня и жители. В строю они стоят, в казармах их нет, поэтому
   * и записаны они отдельно. Оборону держат у себя дома — там и снимается место боя.
   */
  private gateRecord(gate: ReturnType<LocalWorld['gateField']>, attacker: TroopStack, site: BattleSite): BattleRecord | null {
    const { home, militia, archers, field, front } = gate;
    return field.result
      ? {
          us: 'defender',
          result: field.result,
          troops: { attacker, defender: { ...home } },
          militia: { attacker: { men: 0, archers: 0 }, defender: { men: militia, archers } },
          place: this.placeOf(this.save.home),
          site,
          // Проёмы штурма — ролик рисует, чем лезли (стена-проход, `world/wall`).
          ...(front ? { openings: front.openings } : {}),
        }
      : null;
  }

  /**
   * Вызовы к воротам из слепка (`PlayerProfile.gate`): каждый бьётся ровно один раз. Посчитанный мир помнит, пока
   * племя его везёт, — последствие могло потеряться (партия не записалась после пульса), и второго боя за один вызов
   * быть не должно; вызов, которого в слепке больше нет, мир забывает. Срока у памяти нет. Возвращает посчитанные из
   * слепка — племя снимает их с партии (`WorldPulse.gateDone`).
   */
  private gateFights(calls: readonly GateCall[], at: number): string[] {
    const done = new Set(this.save.gateDone ?? []);
    for (const call of calls) {
      if (done.has(call.id)) continue;
      this.gateFight(call, at);
      done.add(call.id);
    }
    const kept = calls.filter((c) => done.has(c.id)).map((c) => c.id);
    if (kept.length > 0) this.save.gateDone = kept;
    else delete this.save.gateDone;
    return kept;
  }

  /**
   * Кто пришёл к воротам по вызову — одна сборка на бой (`gateFight`) и на замер отчёта (`raid-mix:report`, раздел 4):
   * волки — лёгкая конница без снаряжения, разбойники — отряд тем же генератором, что набег логова (`raidingParty`).
   * Бойцов — мерой отрядов мира (`menOfPower`), ею же племя пишет «Их N».
   */
  private gateParty(call: GateCall): FieldSide & { gear: Partial<Record<UnitKind, number>> } {
    // Сторона боя и ступень снаряжения отряда — только для показа (запись боя одевает им пришедших); у зверей её нет.
    // Звери (ДР-5): для черт армии стая не войско — ни метки «конница», ни черт против её состава (`FieldSide.beasts`).
    if (GATE_FOES[call.foe].beasts) return { kinds: { ...emptyStack(), cavalry: menOfPower(call.power) }, gear: {}, beasts: true };
    // Мятежники — свои горожане: пехота без вещей (docs/stability.md, 2.4).
    if (GATE_FOES[call.foe].townsfolk) return { kinds: { ...emptyStack(), infantry: menOfPower(call.power) }, gear: {} };
    const band = raidingParty(this.save.seed, call.id, call.power);
    return { kinds: band.kinds, gear: band.gear };
  }

  /**
   * Бой события у ворот — волки или разбойники (слово владельца по docs/battle_eu4.md, 14.28): та же дверь, что бой у
   * стены (`gateField`), тот же счёт павших и та же запись. Своих чисел здесь нет.
   *
   * - **Кто пришёл** — `gateParty`. Волки — лёгкая конница без снаряжения: всё, что делает стаю стаей (скорость, обход
   *   на соседнюю полосу, погоня), у рода уже есть; разбойники — люди родами ядра.
   * - **Где.** Клетка дома, пришли из неё же: штраф места нападающему — её земля, переправы нет.
   * - **Поражение.** Разбойники уносят со склада, сколько поднимут уцелевшие (`plunder`, ноша — `haul` их воинов);
   *   волки склада не трогают — поражение от них стоит павших и морали. Жителей бой у ворот не уносит ни у кого
   *   (`gateLosses`).
   */
  private gateFight(call: GateCall, at: number): void {
    const def = GATE_FOES[call.foe];
    const party = this.gateParty(call);
    const gate = this.gateField(party, call.seed, this.save.home, at, null);
    const { field } = gate;
    const { warriors, warriorsLost, troopsLost, standing } = this.gateLosses(gate);
    // Вызов к воротам: разбойники и волки бьются перед воротами (ролик TW).
    const record = this.gateRecord(gate, def.beasts ? {} : troopsOfKinds(party.kinds, party.gear), 'gate');
    // Прорвались люди — уносят со склада, сколько поднимут уцелевшие; тайник не достать.
    const units = warriorsOf(call.power);
    const left = stackAfter(units, stackLosses(units, field.attackerLoss));
    const profile = this.save.profile;
    const taken =
      field.won && !def.beasts ? plunder(profile?.stock ?? {}, profile?.stash ?? 0, this.haul(left, false).carry) : null;
    const loss = taken ? asLoss(taken.taken) : {};
    const text = field.won ? def.lost : def.held;
    this.addReport({
      id: gateReportId(call.id),
      at,
      kind: 'defense',
      title: field.won ? def.broke : def.repelled,
      target: { id: HOME_ID, name: this.homeName(), x: this.save.home.x, y: this.save.home.y },
      won: !field.won,
      sent: { warrior: warriors },
      lost: warriorsLost > 0 ? { warrior: warriorsLost } : {},
      enemyPower: Math.round(call.power),
      enemyLost: Math.round(call.power * field.attackerLoss),
      loot: taken && taken.takenTotal > 0 ? loss : null,
      hidden: taken?.hiddenTotal ?? 0,
      intel: null,
      battle: record && def.beasts ? { ...record, beasts: 'attacker' } : record,
      text,
      read: false,
    });
    this.addEffect({
      id: gateReportId(call.id),
      gate: call.id,
      lost: warriorsLost > 0 ? { warrior: warriorsLost } : {},
      lostTroops: troopsLost,
      ...(troopTotal(standing) > 0 ? { standing } : {}),
      resources: loss,
      // С мятежниками бьются свои: ни славы, ни морали — подавление платит моралью само (`sim/stability.rebelsSettled`).
      prestige: field.won || def.townsfolk ? 0 : 3,
      morale: def.townsfolk ? 0 : field.won ? -GATE_MORALE_LOST : GATE_MORALE_WON,
      battle: field.won ? 'lost' : 'won',
      ...scarOf(field, 'defender'),
      text,
      good: !field.won,
    });
  }

  // ---------- Письма ----------

  /**
   * Дворы, от которых может прийти письмо, и всё, что для этого надо знать.
   * Сам выбор — что и от кого — делает чистый модуль (`pickLetter`); здесь
   * только собираются факты, потому что о них знает мир, а не он.
   *
   * Двор, чьё письмо уже лежит на столе, в список не попадает: два гонца от
   * одного соседа разом — это не переписка, а спам, и первый из них всё равно
   * был бы вытеснен вторым.
   */
  private letterCandidates(now: number): LetterCandidate[] {
    const home = this.save.home;
    const busy = new Set(this.save.letters.map((l) => l.fromId));
    // Логово, держащее наших после прорыва (АУ-8, п. 5), пишет одно письмо — о выкупе: дворов племён в мире может не быть,
    // и без этого уведённые в плен не возвращались бы никогда.
    const held = (s: GenSettlement): boolean => (this.save.captives[s.id] ?? 0) > 0;
    const near = this.gen.settlements.filter(
      (s) => (s.tribeId || held(s)) && distance(s, home) <= AI_RANGE && !busy.has(s.id),
    );
    return near.map((s) => {
      // Против кого зовут вставать: ближний двор другого племени. Выбор
      // детерминирован — при равном расстоянии вперёд идёт меньший номер.
      let rival: GenSettlement | null = null;
      for (const other of this.gen.settlements) {
        if (!other.tribeId || other.tribeId === s.tribeId) continue;
        if (distance(other, home) > AI_RANGE) continue;
        if (
          !rival ||
          distance(other, s) < distance(rival, s) ||
          (distance(other, s) === distance(rival, s) && other.id < rival.id)
        ) {
          rival = other;
        }
      }
      return {
        id: s.id,
        name: s.name,
        pop: Math.round(this.popNow(s, now)),
        lootMix: s.lootMix,
        standing: this.standingOf(s, now),
        attitude: this.save.diplomacy[s.id]?.attitude ?? 0,
        captives: Math.max(0, this.save.captives[s.id] ?? 0),
        ...(s.tribeId ? {} : { lair: true as const }),
        ...(rival ? { rivalId: rival.id, rivalName: rival.name } : {}),
      };
    });
  }

  /**
   * Разрешает письмо и применяет последствия. Одна дверь на все поводы: ответ
   * игрока и разрешение без него ходят здесь, и разницу между ними знает только
   * чистая функция (`resolveLetter`). Поэтому «разрешилось само» не может
   * сделать того, чего не мог бы сделать сам игрок.
   *
   * Строка в летописи ровно одна — та, что вернул исход. Пустой текст означает,
   * что писать нечего: у предупреждения о набеге запись оставит бой, и вторая
   * строка была бы тем самым дублированием письма и летописи.
   */
  private closeLetter(l: Letter, answer: LetterAnswerId, at: number): void {
    const i = this.save.letters.findIndex((x) => x.id === l.id);
    if (i >= 0) this.save.letters.splice(i, 1);
    const out = resolveLetter(l, answer);

    if (out.attitude !== 0) this.moveAttitude(l.fromId, out.attitude, at);
    if (out.standing) {
      const rec = this.diploOf(l.fromId, at);
      rec.standing = out.standing;
      rec.since = at;
      rec.until = out.duration > 0 ? at + out.duration : 0;
      rec.breakAt = 0;
      this.save.diplomacy[l.fromId] = rec;
    }
    if (out.against) {
      this.moveAttitude(out.against.id, out.against.attitude, at);
      const rec = this.diploOf(out.against.id, at);
      rec.standing = out.against.standing;
      rec.since = at;
      rec.until = 0;
      rec.breakAt = 0;
      this.save.diplomacy[out.against.id] = rec;
    }
    // Пленных со двора больше не держат — независимо от того, выкупили их или
    // бросили: второй раз одних и тех же не продают.
    if (l.kind === 'ransom') delete this.save.captives[l.fromId];
    if (!out.text) return;
    this.addEffect({
      id: `letter-${l.id}-${answer}`,
      lost: {},
      resources: out.resources,
      pop: out.pop,
      prestige: out.prestige,
      morale: out.morale,
      battle: null,
      text: out.text,
      good: out.good,
    });
  }

  /**
   * Ход писем: приходы по расписанию и разрешения по сроку, строго по времени.
   *
   * Фоновой работы здесь нет — это разбор того, что случилось между прошлым
   * взглядом и нынешним. Поэтому игрок, вернувшийся через три дня, получает
   * ровно то же, что получил бы, сидя в игре: часть писем протухла и
   * разрешилась плохо, часть ещё жива, и каждое разрешившееся оставило строку.
   */
  private stepLetters(now: number): void {
    const save = this.save;
    let changed = false;
    // Расписание назначается тем же кодом, что и все следующие приходы: второй
    // формулы у него быть не должно.
    if (save.nextLetterAt <= 0) {
      save.nextLetterAt = now + letterPause(save.seed, save.nextLetter);
      changed = true;
    }

    for (let guard = 0; guard < 500; guard++) {
      // Ближайшее событие: приход нового письма или срок лежащего.
      let due: Letter | null = null;
      for (const l of save.letters) {
        if (!due || l.until < due.until) due = l;
      }
      const arriveAt = save.nextLetterAt;
      const expireAt = due ? due.until : Infinity;
      if (Math.min(arriveAt, expireAt) > now) break;

      if (expireAt <= arriveAt && due) {
        this.closeLetter(due, 'lapse', due.until);
        changed = true;
        continue;
      }

      // Номер письма расходуется здесь, до всех проверок: из него выведены и
      // зерно письма, и пауза до следующего, и повторно пускать его в дело —
      // значит получить два письма из одного зерна.
      const n = save.nextLetter;
      save.nextLetter += 1;
      save.nextLetterAt = arriveAt + letterPause(save.seed, save.nextLetter);
      changed = true;
      // Пока игрок ни разу не выходил на связь, мир не знает ни его склада, ни
      // его размера: цену дани считать не из чего. Расписание при этом идёт —
      // иначе первое подключение выложило бы на стол всё скопом.
      if (!save.profile) continue;
      // `?? {}` тут не перестраховка: слепок деревни лежит в сохранении мира
      // (`WorldSave.profile`), и из партии, начатой до появления `stock`, он
      // приезжает без него. Живой пульс кладёт свежий слепок раньше `advance`,
      // но полагаться на порядок двух строк в разных методах тут нечего.
      const draft = pickLetter(save.seed, n, this.letterCandidates(arriveAt), save.profile.stock ?? {});
      if (!draft) continue;
      // Стол на `LETTER_SLOTS`, и очереди за ним нет: лишнее письмо сгоняет то, у
      // которого срок ближе всех, и сгоняет его тем же разрешением, что и
      // истёкший срок, — со строкой в летописи (см. world/letters.ts).
      const kick = crowdedOut(save.letters);
      if (kick) this.closeLetter(kick, 'lapse', arriveAt);
      save.letters.push({
        ...draft,
        id: `L${n}`,
        at: arriveAt,
        until: letterUntil(draft, arriveAt),
      });
    }

    if (this.syncRaidLetter(now)) changed = true;
    if (this.syncSiegeLetter(now)) changed = true;
    if (changed) this.write();
  }

  /**
   * Предупреждение о набеге. Оно не приходит по расписанию и не выдумывается:
   * письмо есть ровно тогда, когда игрок и так видит чужой отряд — по кругу у
   * деревни или по донесению Дозора (`visibleMarches`). Второй правды о том,
   * когда становится видно набег, здесь быть не должно: письмо только называет
   * словами то, что уже на карте.
   *
   * Разрешается оно приходом отряда, и своей строки в летописи не пишет — её
   * оставит бой.
   */
  private syncRaidLetter(now: number): boolean {
    const save = this.save;
    const seen = this.visibleMarches(now).filter(
      (m) => !m.own && m.targetId === HOME_ID && m.phase === 'out',
    );
    let changed = false;
    for (const l of [...save.letters]) {
      if (l.kind !== 'raid') continue;
      if (seen.some((m) => m.id === l.marchId)) continue;
      this.closeLetter(l, 'lapse', Math.min(now, l.until));
      changed = true;
    }
    for (const m of seen) {
      if (save.letters.some((l) => l.marchId === m.id)) continue;
      // Ячейка у предупреждения своя: сгонять решения оно не должно —
      // чужой отряд выходит раз в `AI_ATTACK_MIN`…`AI_ATTACK_MAX`, и стол превратился бы в
      // ленту, где ничего не доживает до ответа. Отряд на деревню в мире один
      // (`scheduleAi`), поэтому и писем таких больше одного не бывает.
      save.letters.push({
        id: `L-raid-${m.id}`,
        kind: 'raid',
        at: now,
        until: m.arriveAt,
        fromId: m.fromId,
        fromName: m.fromName,
        cost: {},
        marchId: m.id,
      });
      changed = true;
    }
    return changed;
  }

  /**
   * Письмо об осаде. Как и предупреждение о набеге, оно не приходит по
   * расписанию и не выдумывается: письмо есть ровно тогда, когда лагерь стоит
   * под стенами, и снимается вместе с ним. Второй правды о том, идёт ли осада,
   * между письмом и картой быть не должно — письмо только называет словами то,
   * что уже стоит у ворот.
   *
   * Выбора в нём нет: осаду снимают вылазкой, а не ответом гонцу. Своей строки
   * в летописи оно поэтому не пишет — её оставит отчёт о том, чем всё кончилось.
   */
  private syncSiegeLetter(now: number): boolean {
    const save = this.save;
    const w = this.homeSiege(now);
    let changed = false;
    for (const l of [...save.letters]) {
      if (l.kind !== 'siege') continue;
      if (w && l.marchId === w.campId) {
        // Часы голода могли пересчитаться от подкрепления: срок письма обязан
        // идти за ними, иначе оно разрешится раньше или позже самой осады.
        const until = this.hunger(w);
        if (l.until !== until) {
          l.until = until;
          changed = true;
        }
        continue;
      }
      this.closeLetter(l, 'lapse', Math.min(now, l.until));
      changed = true;
    }
    if (w && !save.letters.some((l) => l.kind === 'siege')) {
      save.letters.push({
        id: `L-siege-${w.campId}`,
        kind: 'siege',
        at: w.startedAt,
        until: this.hunger(w),
        fromId: w.byId,
        fromName: this.byId.get(w.byId)?.name ?? 'Враги',
        cost: {},
        marchId: w.campId,
      });
      changed = true;
    }
    return changed;
  }

  /**
   * Откуда письмо — глазами карты.
   *
   * Правило здесь одно и оно про туман: **лупа показывает место, а не сведения.**
   * Клетка отдаётся только тогда, когда игрок её уже разведал, — иначе кнопка
   * «показать на карте» открывала бы то, чего он не открывал сам, и правило
   * «противник узнаёт только визуально» работало бы в одну сторону.
   * Неразведанный двор при этом не молчит: румб и расстояние знает всякий, к
   * кому приехал гонец, и письмо говорит их словами, ничего не открывая.
   *
   * null означает, что источника на карте нет вовсе: такое бывает у лагеря,
   * чьего поселения мир не знает. Лупы у такого письма не будет — не
   * выключенной, а никакой.
   */
  private letterFrom(l: Letter): LetterFrom | null {
    const s = this.byId.get(l.fromId);
    if (!s) return null;
    const home = this.save.home;
    return {
      cell: this.reveal || this.fog.has(s.x, s.y) ? { x: s.x, y: s.y } : null,
      rhumb: rhumbOf(home, s),
      cells: Math.round(distance(home, s)),
    };
  }

  /** Письмо на столе: к сохранённому добавляется то, что считается при чтении. */
  private letterView(l: Letter, now: number): LetterView {
    const def = LETTER_KIND_BY_ID[l.kind];
    const goods = goodsText(l.cost);
    const short = this.shortOf(l.cost);
    const choices: LetterView['choices'] = [];
    if (def.yes && def.no) {
      choices.push({
        id: 'yes',
        label: def.yes,
        hint: def.yesHint(l, goods),
        can: short === 0,
        reason: short === 0 ? null : `На складе не хватает ${short} запасов.`,
      });
      choices.push({ id: 'no', label: def.no, hint: def.noHint(l), can: true, reason: null });
    }
    return {
      ...l,
      title: def.title,
      body: def.body(l, goods, this.homeName()),
      from: this.letterFrom(l),
      choices,
      seconds: Math.max(0, (l.until - now) / 1000),
      silence: def.silence(l),
    };
  }

  /**
   * Набеги на деревню: редко, из ближних логов и всегда с запасом времени на реакцию.
   * Набег — всё логово (`lairs.lairRaid`), а логово растёт от возраста и жителей города;
   * от обороны игрока его сила не зависит ничем. Слабый город — и жителями, и всем войском —
   * логово не замечает (`lairShield`), павший город не трогает до конца окна (`SIEGE_IMMUNE`).
   */
  private scheduleAi(now: number): void {
    const save = this.save;
    if (now < save.nextAiAt) return;
    // Окно после падения — прорывом или голодом: набег не выходит, очередь сдвигается к
    // концу окна.
    const immune = save.siegeImmune[HOME_ID];
    if (siegeImmune(immune, now)) {
      save.nextAiAt = immune ?? now;
      return;
    }
    // Час, на который набег был назначен (`due`), читает только вес логова по его возрасту. Выход набега и срок
    // следующего считаются от `now` — от минуты, когда мир разобрали, обычно от возвращения игрока: за отлучку
    // набеги не копятся и не выходят задним числом, вернувшийся видит набег с полным запасом времени на ответ. Так
    // мягче для игры урывками — решение владельца (docs/audit/OWNER-DECISIONS.md, п. 6), а не расхождение догона.
    const due = save.nextAiAt;
    const rng = seeded(marchSeed(save.seed, save.nextMarch + 7919));

    const home = save.home;
    // Сожжённое логово набегов не шлёт: в этом и есть видимое последствие
    // победы. Пепелище стоит на карте, но воевать оттуда некому.
    const near = this.gen.settlements.filter((s) => distance(s, home) <= AI_RANGE && this.alive(s, now));
    // Война хоть с одним соседом ускоряет весь темп: воюющий сосед не ждёт
    // своей очереди столько же, сколько ждал бы ровный.
    const atWar = near.some((s) => this.standingOf(s, now) === 'war');
    const pause = AI_ATTACK_MIN + rng() * (AI_ATTACK_MAX - AI_ATTACK_MIN);
    save.nextAiAt = now + pause * (atWar ? AI_WAR_PACE : 1);

    const profile = save.profile;
    // Защита слабого по зрелости — жители или всё войско, что выше: пока логово город не замечает, набега нет вовсе.
    // Войско — всё, а не то, что дома: иначе увести дружину в поле значило бы спрятать город от логов.
    const armyPower = troopPower(profile?.army ?? {});
    if (!profile || lairShield(profile.pop, armyPower) <= 0) return;
    // Чужой отряд на деревню в мире один. Именно **на деревню**: соседи, идущие
    // друг на друга или на выручку осаждённому, к очереди набегов отношения не
    // имеют, и заслонять ими набег значило бы поставить набеги на игрока в
    // зависимость от того, повздорили ли два двора на краю карты. Прорвавшиеся,
    // уходящие домой с добычей (MAP-9), — уже не на деревню: очередь не держат.
    if (save.marches.some((m) => !m.own && m.targetId === HOME_ID && m.phase !== 'back')) return;

    // Откуда выйдет набег, решает отношение: пакт — ноль, война — заметно
    // больше нейтралитета, а характер владельца входит множителем. Племя, с
    // которым подписано ненападение или союз, тоже не ходит: иначе дипломат
    // покупал бы бумагу, а не мир.
    const pool: { s: GenSettlement; w: number }[] = [];
    let total = 0;
    for (const s of near) {
      if (this.pactActive(s.tribeId, 'truce') || this.pactActive(s.tribeId, 'alliance')) continue;
      const w = s.tribeId
        ? raidWeight(this.standingOf(s, now), this.save.diplomacy[s.id]?.attitude ?? 0, this.temperOfSettlement(s), {
            war: AI_WAR_WEIGHT,
            quiet: AI_NEUTRAL_QUIET,
          })
        : // У варваров отношений нет и быть не может: старейшин у них тоже нет.
          // Зато есть возраст: выросшее логово шлёт набеги охотнее свежего, и
          // это единственная цена бездействия, которая у игрока есть.
          lairRaidWeight(AI_BARBARIAN_WEIGHT, this.lairRec(s.id), due);
      if (w <= 0) continue;
      total += w;
      pool.push({ s, w });
    }
    if (pool.length === 0) return;

    let roll = rng() * total;
    let src = pool[pool.length - 1].s;
    for (const item of pool) {
      roll -= item.w;
      if (roll <= 0) {
        src = item.s;
        break;
      }
    }
    const power = Math.max(2, lairRaid(this.powerNow(src, now), profile.pop, armyPower));
    const units = warriorsOf(power);
    const seconds = marchSeconds(distance(src, home), terrainFactor(save.seed, src, home), units);
    const travel = Math.max(realMs(seconds), this.warningMs());
    const id = `m${save.nextMarch}`;
    save.marches.push({
      id,
      seed: marchSeed(save.seed, save.nextMarch++),
      mission: 'raid',
      units,
      own: false,
      fromId: src.id,
      targetId: HOME_ID,
      from: { x: src.x, y: src.y },
      to: { ...home },
      fromName: src.name,
      toName: this.homeName(),
      departAt: now,
      arriveAt: now + travel,
      phase: 'out',
      power,
      loot: null,
    });
  }


  /**
   * Полководца уводят из лагеря. Это и есть снятие осады — не побочный итог, а
   * прямое следствие, о котором сказано **до** приказа (`CAMP_LEAVE` стоит и в
   * меню действий, и в подтверждении). Отказать здесь нельзя: тогда армия
   * оказалась бы заперта под чужими стенами навсегда.
   */
  private leaveCamp(id: SettlementId, at: number): void {
    const w = this.save.sieges[id];
    if (!w || !ourCamp(w)) return;
    this.liftSiege(id, at, 'left');
    const name = this.byId.get(id)?.name ?? 'города';
    this.addEffect({
      id: `camp-left-${id}-${at}`,
      lost: {},
      resources: {},
      prestige: 0,
      morale: -2,
      battle: null,
      text: `Осада снята: отряд ушёл от стен, город ${name} снова ест.`,
      good: false,
    });
  }

  /**
   * Можно ли ударить по лагерю под `id` из поля и что для этого нужно: дружина в
   * поле, чужой лагерь под стенами, дорога до него. Приказ и план спрашивают одно и
   * то же, поэтому и отказ у них один.
   *
   * Полководцу в городе здесь отказывает не проверка «дома ли он», а учёт
   * (`world/muster.fieldTroops`): дома его дружина — гарнизон, и бить из поля
   * некому.
   */
  private strikeCheck(
    id: SettlementId,
    now: number,
    out = false,
  ):
    | { error: string }
    | { error: null; f: StoredFigure; force: TroopStack; to: Coord; seconds: GameSec } {
    const f = this.save.figures.general;
    const off = this.offDuty('general', now) ?? this.retiringBlock('general');
    if (off) return { error: off };
    this.settleHandover(f, now);
    if (f.handover) return { error: `Отряд ещё в сборе: ${formatLeft(Math.max(0, f.handover.until - now) / 1000)}.` };
    const busy = this.warGeneralBusy();
    if (busy) return { error: busy };
    // Лагерь под своим городом из города бьют вылазкой: отказ — этот, а не «отряда нет», который окно дела сняло бы
    // выбором состава (ДР-6).
    if (id === HOME_ID && inTown(f, now)) return { error: STRIKE_FROM_TOWN };
    if (troopTotal(f.troops ?? {}) === 0) return { error: this.noBand(now) };
    // Дело из «Походов» по чужому лагерю (`out`, Р-4): полководец выходит из своих ворот с отрядом — та же дверь выхода,
    // что у похода и «дойти и ударить». Лагерь под своим городом из города бьют вылазкой, а не делом.
    const leaving = out && id !== HOME_ID && postureOf(f, now) === 'stands';
    if (leaving) {
      const blocked = this.siegeBlock(now);
      if (blocked) return { error: blocked };
    }
    const force = leaving ? { ...(f.troops ?? {}) } : fieldTroops(f, now);
    if (troopTotal(force) === 0) return { error: STRIKE_FROM_TOWN };
    if (this.ourSiege(now)) return { error: `${CAMP_BUSY} ${CAMP_LEAVE}` };
    const w = this.siegeOf(id, now);
    const camp = w && !ourCamp(w) ? this.campArmy(w, now) : null;
    if (!w || !camp) return { error: 'Под этими стенами лагеря нет.' };
    const town = id === HOME_ID ? this.save.home : this.byId.get(id);
    if (!town) return { error: 'Цель не найдена.' };
    if (!this.inRealm(town)) return { error: this.beyond() };
    const from = this.figureAt(f, now);
    const to = { x: town.x, y: town.y };
    const seconds = fieldWalkSeconds(from, to, terrainFactor(this.save.seed, from, to), f.gait);
    if (now + realMs(seconds) >= this.hunger(w)) {
      // У нашего сытого города лагерь логова снимется сам в следующую фазу (ОС-1): ударить по нему не успеть по другой причине.
      const fed = id === HOME_ID && !Number.isFinite(this.homeHungerStep(w));
      return { error: fed ? 'Не успеть: лагерь снимется раньше — город кормится сам.' : 'Не успеть: хлеб в городе кончится раньше.' };
    }
    // Удар — бой: цена его в энергии — к минуте прихода, с дорогой до лагеря (docs/agent_energy.md).
    const tired = this.energyCost('general', 'strike', now, realMs(seconds)).block;
    if (tired) return { error: tired };
    return { error: null, f, force, to, seconds };
  }

  async strikePlan(id: SettlementId, garrison: boolean, out = false): Promise<StrikePlan> {
    const now = this.clock();
    // Лагерь игрока под нашими стенами: удар бьёт сервер, план — той же `strikeForecast` (docs/pvp.md).
    const pvp = id === HOME_ID && !this.homeSiege(now) ? this.warOnUs() : null;
    if (pvp) return this.warStrikePlan(pvp, garrison, now);
    const garrisonable = id === HOME_ID;
    const rout = perilShare(routPeril(distance(this.save.home, this.campSpot(id))));
    const check = this.strikeCheck(id, now, out);
    if (check.error !== null) {
      return { can: false, reason: check.error, seconds: asGame(0), rear: { went: 0, passed: 0 }, front: null, garrisonable, rout };
    }
    const { force, seconds } = check;
    const arriveAt = now + realMs(seconds);
    const going = garrison && garrisonable ? this.garrison(now) : null;
    // Проходы — на минуту прихода, по занятости на минуту приказа: до прихода их
    // может занять кто-то ещё, и тогда пройдёт меньше. Это говорится словами в
    // панели, а число — тем же `campGate`, которым считает бой.
    const gate = this.campGate(id, arriveAt, { rear: kindsOf(force), front: going ? kindsOf(going) : undefined });
    if (!gate?.rear) {
      return { can: false, reason: 'Под этими стенами лагеря нет.', seconds, rear: { went: 0, passed: 0 }, front: null, garrisonable, rout };
    }
    const cast = { rear: gate.rear, front: gate.front };
    const refused = refusedAtGate(cast.rear, cast.front);
    return {
      can: !refused,
      reason: refused ? gateBusyText(Math.max(cast.rear.waitMs, cast.front?.waitMs ?? 0) + realMs(seconds)) : null,
      seconds,
      rear: { went: cast.rear.went, passed: cast.rear.passed },
      front: cast.front ? { went: cast.front.went, passed: cast.front.passed } : null,
      garrisonable,
      rout,
      energy: this.energyCost('general', 'strike', now, realMs(seconds)),
    };
  }

  /** Где стоит лагерь под городом — место боя полководца с ним, для дали его гибели. */
  private campSpot(id: SettlementId): Report['target'] {
    const town = this.byId.get(id);
    return town ? { id: town.id, name: town.name, x: town.x, y: town.y } : this.homeSpot();
  }

  /** Свой город местом отчёта. */
  private homeSpot(): Report['target'] {
    return { id: HOME_ID, name: this.homeName(), x: this.save.home.x, y: this.save.home.y };
  }

  async strikeCamp(id: SettlementId, garrison: boolean, out = false): Promise<string | null> {
    const now = this.clock();
    const pvp = id === HOME_ID && !this.homeSiege(now) ? this.warOnUs() : null;
    if (pvp) return this.warStrike(pvp, garrison, now);
    const check = this.strikeCheck(id, now, out);
    if (check.error !== null) return check.error;
    const { f, to, seconds } = check;
    const withGarrison = garrison && id === HOME_ID;
    // Пробиться к приходу некому — отказ тем же планом, которым гасится кнопка:
    // принять приказ, который погашен в меню, значило бы разойтись с ним.
    const plan = await this.strikePlan(id, withGarrison, out);
    if (!plan.can) return plan.reason;
    if (seconds <= 0) {
      // Стоит у самого лагеря — бьёт сразу, без дороги. Цена — за бой, который был.
      const res = this.resolveStrike(id, now, withGarrison);
      if (!res.error) this.payEnergy('general', 'strike', now);
      return res.error;
    }
    this.energyOf('general', now);
    f.from = this.figureAt(f, now);
    f.to = { ...to };
    f.departAt = now;
    f.arriveAt = now + Math.round(realMs(seconds));
    f.phase = 'moving';
    f.chase = undefined;
    f.assault = undefined;
    f.strike = { id, garrison: withGarrison };
    // Цена — при приказе: бой случится в минуту прихода, и энергии на него хватит (`strikeCheck`).
    this.payEnergy('general', 'strike', now);
    this.write();
    return null;
  }

  /**
   * Полководец бьёт по чужому лагерю — с тыла, из поля. Бой — тот же, что у
   * вылазки и у выручки: правда о том, насколько крепок лагерь, одна; сторона —
   * своя, и проход у неё свой.
   *
   * `withGarrison` — к лагерю под своим городом: гарнизон выходит из ворот и лезет
   * со стороны города, дружина — с тыла, бой один. Весь гарнизон, без выбора:
   * выбор состава есть у вылазки. Стен и города в этом бою нет ни у кого — это бой
   * в поле. Полководец в эту минуту ещё в пути, поэтому его дружина в гарнизоне не
   * числится, и выйти дважды ей негде.
   */
  private resolveStrike(id: SettlementId, at: number, withGarrison: boolean): AttackResult {
    const f = this.save.figures.general;
    this.wearGeneral(at);
    const troops = fieldTroops(f, at);
    const men = troopTotal(troops);
    if (men === 0) return { error: STRIKE_FROM_TOWN, reportId: null, won: false };
    const going = withGarrison ? this.garrison(at) : {};
    const joint = troopTotal(going) > 0;
    // Проходы заняты — отказ до боя, и сид похода не тратится.
    const gate = this.campGate(id, at, { rear: kindsOf(troops), front: joint ? kindsOf(going) : undefined });
    if (gate?.rear && refusedAtGate(gate.rear, gate.front)) {
      const wait = Math.max(gate.rear.waitMs, gate.front?.waitMs ?? 0);
      return { error: gateBusyText(wait), reportId: null, won: false };
    }
    const seed = marchSeed(this.save.seed, this.save.nextMarch++);
    const out = this.campBattle(id, at, seed, {
      // Мораль между боями (14.31): дружина — своей парой, гарнизон из ворот — своей (дружина в поле, в гарнизоне её нет).
      rear: { own: troops, rest: this.generalRest(at) },
      front: joint ? { own: going, rest: this.garrisonRest(going, at) } : undefined,
      general: true,
      from: f.from,
    });
    if (!out || out.refused) return { error: 'Лагеря под стенами уже нет.', reportId: null, won: false };
    const { field, camp, front, rear } = out;

    // Потери — из прошедших с каждой стороны, каждой стороне своими людьми: дружине
    // из дружины, гарнизону из гарнизона (`splitLosses`).
    const lostTroops = field.result ? troopLosses(troops, out.lost.rear) : {};
    const townLost = field.result && joint ? troopLosses(going, out.lost.front) : {};
    if (field.result) {
      // Дрались прошедшие через рогатки: вернулись с долей боя, стоявшие у рогаток — со своей.
      const passed = (t: typeof rear): number => (t && t.went > 0 ? t.passed / t.went : 0);
      const band = this.menOf(troops) * passed(rear);
      f.rest = rejoin(f.rest, at, this.menOf(troops), band, Math.max(0, band - this.menOf(lostTroops)), field.rest.attacker);
      if (joint) {
        const town = this.menOf(going) * passed(front);
        this.save.homeRest = rejoin(this.save.homeRest, at, this.menOf(going), town, Math.max(0, town - this.menOf(townLost)), field.rest.attacker);
      }
    }
    const left = troopsAfter(troops, lostTroops);
    const lostMen = men - troopTotal(left);
    const townMen = troopTotal(townLost);
    const campLost = this.resolveSortieOn(
      id,
      at,
      field,
      joint ? 'Полководец ударил по лагерю с тыла, гарнизон вышел из ворот.' : 'Полководец ударил по лагерю.',
      // Удар по лагерю с поля размыкает кольцо блокады при любом исходе (Р-5): кольцо стягивается к бою.
      'relief',
    );
    const target = id === HOME_ID ? null : this.byId.get(id);
    const place = target ? { id, name: target.name, x: target.x, y: target.y } : {
      id: HOME_ID,
      name: this.homeName(),
      x: this.save.home.x,
      y: this.save.home.y,
    };
    const record: BattleRecord | null = field.result
      ? {
          us: 'attacker',
          result: field.result,
          troops: { attacker: plus(troops, going), defender: troopsOfKinds(camp.kinds, camp.gear) },
          place: this.placeOf(target ?? this.save.home),
          // Лагерь под нашими стенами: ролик ставит город за лагерем; совместный удар — ворота открыты (гарнизон вышел).
          ...(joint ? { site: 'joint' as const } : target ? {} : { site: 'camp' as const }),
        }
      : null;

    const allLost = plus(lostTroops, townLost);
    const reportId = `camp${seed}`;
    this.addReport({
      id: reportId,
      at,
      kind: 'raid',
      title: field.won ? `Лагерь разбит: ${camp.name}` : `Лагерь устоял: ${camp.name}`,
      target: place,
      won: field.won,
      sent: { warrior: men + troopTotal(going) },
      lost: lostMen + townMen > 0 ? { warrior: lostMen + townMen } : {},
      enemyPower: Math.round(camp.power),
      enemyLost: campLost,
      loot: null,
      intel: null,
      battle: record,
      ...(front ? { through: { went: front.went, passed: front.passed } } : {}),
      ...(rear ? { rearThrough: { went: rear.went, passed: rear.passed } } : {}),
      text:
        (field.won
          ? `Лагерь ${camp.name} разметан, осада снята.`
          : `Лагерь ${camp.name} отбился. Осада стоит, но и они потеряли ${campLost}.`) +
        (joint && !field.won && townMen > 0 ? ` Гарнизон, вышедший из ворот, потерял ${townMen}.` : '') +
        throughText(rear, front),
      read: false,
    });
    this.addEffect({
      id: `${reportId}-eff`,
      lost: lostMen + townMen > 0 ? { warrior: lostMen + townMen } : {},
      lostTroops: allLost,
      // С тыла била дружина из поля: её раненые лежат при полководце; гарнизон из ворот — дома.
      field: lostTroops,
      resources: {},
      prestige: field.won ? 4 : 0,
      morale: field.won ? 5 : -4,
      battle: field.won ? 'won' : 'lost',
      ...scarOf(field, 'attacker'),
      ...(field.result ? { deed: { agent: 'general' as const, ok: field.won, at } } : {}),
      ...this.flankDeed(field, 'attacker', field.won, at, target ?? this.save.home),
      text: field.won ? `Лагерь ${camp.name} разбит: осада снята.` : `Лагерь ${camp.name} устоял.`,
      good: field.won,
    });

    if (troopTotal(left) === 0) {
      f.troops = undefined;
      f.strike = undefined;
      this.defeatGeneral(at, `положил отряд у лагеря ${camp.name}.`, `у лагеря ${camp.name}`, this.campSpot(id), seed);
    } else {
      f.troops = left;
    }
    // Гарнизон вышел и вернулся поредевшим: осада не снята — рты за стеной стали
    // другими, и часы голода считаются заново, здесь, в самом событии. Дружина в
    // них не входит: полководец ещё в пути, и в город она войдёт своим приходом.
    if (joint && !field.won) this.resiege(HOME_ID, at);
    this.write();
    return { error: null, reportId, won: field.won };
  }

  /**
   * Соседи воюют между собой. Не второй ИИ, а тот же самый: кто с кем сойдётся,
   * решают уже заведённые племена — двор идёт на чужой двор, а на свой не идёт.
   * Один поход на весь мир за раз и редко: это фон, а не вторая игра.
   *
   * Игрок видит его тогда, когда смотрит, — и может им воспользоваться: у
   * осаждённого двора слабый гарнизон, а лагерь под его стенами — цель, до
   * которой можно дойти полководцем.
   */
  private scheduleWar(now: number): void {
    const save = this.save;
    if (now < save.nextWarAt) return;
    const war = this.warSeed();
    const rng = seeded(war.seed);
    save.nextWarAt = now + AI_WAR_MIN + rng() * (AI_WAR_MAX - AI_WAR_MIN);
    // Один чужой поход мимо игрока за раз: иначе фон начнёт спорить с игрой.
    if (save.marches.some((m) => !m.own && m.targetId !== HOME_ID)) return;

    const pairs: { from: GenSettlement; to: GenSettlement }[] = [];
    for (const a of this.gen.settlements) {
      for (const b of this.gen.settlements) {
        if (a.id === b.id) continue;
        // Своих не бьют: племя — это и есть «хорошие отношения» между дворами.
        if (a.tribeId && a.tribeId === b.tribeId) continue;
        // Ни выйти из сожжённого логова, ни прийти в него нельзя: его нет.
        if (!this.alive(a, now) || !this.alive(b, now)) continue;
        if (distance(a, b) > AI_WAR_RANGE) continue;
        if (save.sieges[b.id] || this.inRevolt(a.id, now)) continue;
        pairs.push({ from: a, to: b });
      }
    }
    if (pairs.length === 0) return;
    const pick = pairs[Math.floor(rng() * pairs.length) % pairs.length];
    const power = Math.max(2, this.powerNow(pick.from, now) * AI_WAR_SHARE);
    const units = warriorsOf(power);
    const seconds = marchSeconds(
      distance(pick.from, pick.to),
      terrainFactor(save.seed, pick.from, pick.to),
      units,
    );
    save.marches.push({
      id: war.id,
      seed: war.seed,
      mission: 'raid',
      units,
      own: false,
      fromId: pick.from.id,
      targetId: pick.to.id,
      from: { x: pick.from.x, y: pick.from.y },
      to: { x: pick.to.x, y: pick.to.y },
      fromName: pick.from.name,
      toName: pick.to.name,
      departAt: now,
      arriveAt: now + Math.round(realMs(seconds)),
      phase: 'out',
      power,
      loot: null,
    });
  }

  /**
   * Чужой отряд дошёл до чужого же двора. Дальше всё то же самое, что и у
   * нашего порога: заслон заведомо крепче — садятся лагерем, иначе бьются.
   * Отчёта игроку об этом не пишут: это не его бой, и узнать о нём он может
   * только глазами.
   */
  private resolveWar(m: StoredMarch, at: number): void {
    const target = this.byId.get(m.targetId);
    if (!target) {
      this.remove(m);
      return;
    }
    const power = this.powerNow(target, at);
    const party = raidingParty(this.save.seed, m.id, m.power);
    const g = garrisonOf(this.save.seed, target.id, power, target.castle);
    const partyMen = stackTotal(party.kinds);
    const garrisonMen = stackTotal(g.kinds);
    const field = resolveField({
      seed: m.seed,
      ground: groundAt(this.save.seed, target, m.from),
      // Мораль между боями — то же правило и между чужими (14.31): отряд и гарнизон своими парами.
      attacker: { kinds: party.kinds, rest: restAt(m.rest, at, partyMen) },
      defender: { kinds: g.kinds, rest: this.lairRestAt(target.id, at, garrisonMen) },
    });
    if (this.sitsDown(m.targetId, m, at, field)) {
      const w = this.openSiegeAt(m.targetId, m.fromId, m.id, at);
      this.save.siegeAgainAt[m.targetId] = at + SIEGE_COOLDOWN;
      m.phase = 'stay';
      m.stayUntil = starvesAt(w);
      return;
    }
    if (field.result) {
      m.rest = restAfter(field.rest.attacker, at, partyMen * (1 - field.attackerLoss));
      this.setLairRest(target.id, restAfter(field.rest.defender, at, garrisonMen * (1 - field.defenderLoss)));
    }
    const prev = this.damageOf(target.id, at);
    this.save.damage[target.id] = {
      loss: Math.min(0.95, prev + field.defenderLoss * (1 - prev)),
      at: this.liveAt(target.id, at),
    };
    m.power = Math.max(1, m.power * (1 - field.attackerLoss));
    m.units = stackAfter(m.units, stackLosses(m.units, field.attackerLoss));
    this.turnHome(m, at, null);
  }

  /**
   * Что игрок видит из походов. Свои — всегда: он сам их послал и знает куда.
   * Чужие — по двум причинам, и вторая важнее первой.
   *
   * 1. **Живой обзор.** Отряд в поле — самая живая из живых величин, и
   *    показывать его с чужой земли, где у игрока никого нет, значит отдавать
   *    разведданные даром. Круг у деревни и наблюдающий лазутчик — вот и всё.
   * 2. **Донесение Дозора.** Армию, идущую на твою деревню, видно до её
   *    прихода — это и записано в определении Дозора («чужую армию видно
   *    задолго до того, как она встанет под стеной»), и это же обещание
   *    `AI_WARNING_BASE`: предупреждение обязано быть длиннее потолка сбора
   *    дружины (`HANDOVER_MAX`), иначе набег появляется уже без холодного ответа.
   *
   * Держать только первое было бы ошибкой того же рода, что и держать только
   * второе. Без донесения набег из дальнего двора входил бы в круг уже за
   * сроком полного сбора, и перехват в поле — лучшее, что есть на карте, —
   * превратился бы в кнопку, которая не нажимается. Без живого обзора круг у
   * деревни не значил бы ничего. Поэтому берётся то, что случится раньше.
   */
  private visibleMarches(now: number): StoredMarch[] {
    const discs = this.sightDiscs(now);
    const warn = this.warningMs();
    // Лагерь — это наша армия, стоящая в поле. Отряд, идущий на неё, виден по
    // тому же донесению, что и отряд, идущий на деревню: разницы между «идут на
    // наш дом» и «идут на наше войско» тут нет, а увидеть выручку только тогда,
    // когда она уже бьёт по лагерю, значило бы, что осада — это ставка вслепую.
    const camp = this.ourSiege(now);
    return this.save.marches.filter((m) => {
      if (m.own) return true;
      if (m.targetId === HOME_ID && m.phase === 'out' && m.arriveAt - now <= warn) return true;
      // Уводит наших (АУ-8, п. 5): у пострадавшего отряд на карте до самого их двора — его можно догнать.
      if (takingOf(m) > 0) return true;
      if (onCamp(m, camp) && m.arriveAt - now <= warn) return true;
      const at = m.phase === 'stay' ? m.to : marchPosition(m, now);
      return inSight(discs, at.x, at.y);
    });
  }

  /**
   * Мораль чужого отряда глазами игрока — живые данные: только в живом обзоре (`world/sight`), как численность. Свой
   * отряд и свежий — ничего.
   */
  private marchRestView(m: StoredMarch, now: number, discs: ReturnType<LocalWorld['sightDiscs']>): RestView | undefined {
    if (m.own || !m.rest) return undefined;
    const at = m.phase === 'stay' ? m.to : marchPosition(m, now);
    if (!inSight(discs, at.x, at.y)) return undefined;
    return restView(m.rest, now, stackTotal(raidingParty(this.save.seed, m.id, m.power).kinds));
  }

  /**
   * Когда стоянка у ворот кончится — для карты: у чужого города час голода окна, у нашего (ОС-1) — конец осады без нашего
   * вмешательства (`hunger`), а не срок стоянки: тот у нашего города не кончается.
   */
  private stayView(m: StoredMarch): number {
    const w = this.save.sieges[HOME_ID];
    if (w && w.campId === m.id) return this.hunger(w);
    return m.stayUntil ?? m.arriveAt;
  }

  /** Вид похода для интерфейса. `camp` — поселение под нашим лагерем (`ourSiege`): вид говорит, идёт ли отряд на него. */
  private viewMarch(m: StoredMarch, camp: SettlementId | null, rest?: RestView): MarchView {
    return {
      id: m.id,
      mission: m.mission,
      units: { ...m.units },
      troops: m.troops ? { ...m.troops } : undefined,
      own: m.own,
      hostile: !m.own,
      phase: m.phase,
      from: { ...m.from },
      to: { ...m.to },
      fromName: m.fromName,
      toName: m.toName,
      targetId: m.targetId,
      departAt: m.departAt,
      arriveAt: m.phase === 'stay' ? this.stayView(m) : m.arriveAt,
      loot: m.loot ? { ...m.loot } : null,
      recallable: m.own && m.phase !== 'back',
      // Лагерь под стенами — это стоянка, а не поход, и панели должны звать её
      // своим именем. Своего вида похода у осады нет: игрок такого приказа
      // отдать не может, и заводить его в списке заданий было бы враньём.
      siege: m.phase === 'stay' && this.save.sieges[m.targetId]?.campId === m.id,
      // Чужой отряд, идущий на наш лагерь осады, — тем же правилом, каким мир решает, видна ли выручка по донесению.
      ...(onCamp(m, camp) ? { onCamp: true } : {}),
      ...(rest ? { rest } : {}),
      ...(takingOf(m) > 0 ? { taking: takingOf(m) } : {}),
    };
  }

  // ---------- WorldApi ----------

  async info(): Promise<WorldInfo> {
    return {
      seed: this.save.seed,
      size: WORLD_SIZE,
      origin: { ...WORLD_ORIGIN },
      home: { ...this.save.home },
      homeId: HOME_ID,
      createdAt: this.save.createdAt,
    };
  }

  async region(rect: Rect): Promise<RegionChunk> {
    const now = this.clock();
    const x0 = Math.max(WORLD_ORIGIN.x, Math.floor(rect.x));
    const y0 = Math.max(WORLD_ORIGIN.y, Math.floor(rect.y));
    const x1 = Math.min(WORLD_ORIGIN.x + WORLD_SIZE, Math.floor(rect.x + rect.w));
    const y1 = Math.min(WORLD_ORIGIN.y + WORLD_SIZE, Math.floor(rect.y + rect.h));
    const w = Math.max(0, x1 - x0);
    const h = Math.max(0, y1 - y0);
    const terrain = new Uint8Array(w * h);
    const features = new Uint8Array(w * h);
    const influence = new Uint8Array(w * h);
    const claims = claimsNear(this.claims, x0, y0, x1, y1);
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        const wx = x0 + x;
        const wy = y0 + y;
        const i = y * w + x;
        terrain[i] = terrainIndex(terrainAt(this.save.seed, wx, wy));
        features[i] = featuresAt(this.save.seed, wx, wy);
        // Цвет племени — те же разведданные, что и всё остальное: в тумане его нет.
        if (this.reveal || this.fog.has(wx, wy)) influence[i] = ownerAt(claims, wx, wy);
      }
    }
    const rect0 = { x: x0, y: y0, w, h };
    const discs = this.sightDiscs(now);
    const settlements: SettlementView[] = [];
    for (const s of this.gen.settlements) {
      if (s.x < x0 || s.x >= x1 || s.y < y0 || s.y >= y1) continue;
      // Неразведанная клетка не отдаёт даже того, что в ней кто-то живёт.
      if (!this.reveal && !this.fog.has(s.x, s.y)) continue;
      // Пепелище на карте остаётся — его для того и заводили; остывшего следа
      // нет вовсе, и клетка снова становится обычной землёй.
      if (this.phaseOf(s, now) === 'gone') continue;
      settlements.push(this.view(s, now, discs));
    }
    // Замки живых игроков идут тем же путём и через тот же туман: нет
    // разведанной клетки — нет и точки на карте. Отдельный список нужен не для
    // того, чтобы их показывать иначе, а для того, чтобы до них не дотягивалась
    // фоновая жизнь мира.
    for (const c of this.castles.values()) {
      if (c.x < x0 || c.x >= x1 || c.y < y0 || c.y >= y1) continue;
      if (!this.reveal && !this.fog.has(c.x, c.y)) continue;
      settlements.push(this.castleView(c, now, discs));
    }
    const home = this.save.home;
    if (home.x >= x0 && home.x < x1 && home.y >= y0 && home.y < y1) settlements.push(this.homeView(now));
    const explored = this.reveal ? new Uint8Array(w * h).fill(1) : this.fog.maskFor(rect0);
    return { rect: rect0, terrain, features, influence, explored, settlements };
  }

  async settlement(id: SettlementId): Promise<SettlementCard | null> {
    const now = this.clock();
    const castle = this.castleOf(id);
    if (castle) {
      // Неразведанная клетка не отдаёт даже того, что в ней кто-то живёт, — то
      // же правило, что и у поселений.
      if (!this.reveal && !this.fog.has(castle.x, castle.y)) return null;
      return this.castleCard(castle, now, this.sightDiscs(now));
    }
    if (id === HOME_ID) {
      const p = this.save.profile;
      const siege = this.siegeView(now);
      return {
        ...this.homeView(now),
        terrain: terrainAt(this.save.seed, this.save.home.x, this.save.home.y),
        distance: 0,
        terrainFactor: 1,
        power: estimate(p?.defense ?? 0, 'exact'),
        pop: estimate(p?.pop ?? 0, 'exact'),
        // Свой склад игрок видит целиком, и «можно взять» здесь — то, что
        // унесли бы у него: весь склад и казна за вычетом собственного тайника.
        loot: estimate(this.fateHome(p ?? null, Infinity, 0, now, FATE_DEFAULT).takenTotal, 'exact'),
        fates: [],
        intel: null,
        figuresHere: this.figuresAt(HOME_ID, now),
        deals: [],
        // Сама с собой деревня не воюет и пактов не подписывает.
        diplomacy: null,
        revolt: null,
        can: { raid: false, scout: false, support: false, besiege: false, open: true },
        siege: this.cardSiege(HOME_ID, now),
        ruinLeft: 0,
        // Своя деревня «разорённой» на карте не значится: то, что с ней сделал
        // прорвавшийся набег, игрок видит по пустому складу и пустым дворам за
        // стеной, а не по значку. См. docs/sack.md, раздел про дубли.
        sack: null,
        note: siege
          ? `Город в осаде: «${siege.byName}» стоят у ворот. ${SIEGE_BLOCK}`
          : 'Наш город. Сюда возвращаются походы и приходят набеги.',
      };
    }
    const s = this.byId.get(id);
    // Про неразведанное место карточки нет: игрок о нём ещё не знает.
    if (!s || !this.fog.has(s.x, s.y)) return null;
    const phase = this.phaseOf(s, now);
    // Остывшего следа нет вовсе: карточки у него быть не может, как и значка.
    if (phase === 'gone') return null;
    const view = this.view(s, now, this.sightDiscs(now));
    // Пепелище нельзя ни занять, ни ограбить, ни разведать — его можно только
    // увидеть. Ни одной погасшей кнопки при этом не остаётся: действий у него
    // нет вовсе, и сказано об этом словами.
    if (phase === 'ruin') {
      const rec = this.lairRec(s.id);
      return {
        ...view,
        terrain: terrainAt(this.save.seed, s.x, s.y),
        distance: distance(this.save.home, s),
        terrainFactor: terrainFactor(this.save.seed, this.save.home, s),
        power: { ...UNKNOWN },
        pop: { ...UNKNOWN },
        fates: [],
        loot: { ...UNKNOWN },
        intel: null,
        figuresHere: this.figuresAt(s.id, now),
        deals: [],
        diplomacy: null,
        revolt: null,
        can: { raid: false, scout: false, support: false, besiege: false, open: false },
        siege: null,
        ruinLeft: ruinLeft(rec, now) / 1000,
        sack: null,
        note: `Пепелище. Брать тут нечего, след сойдёт через ${formatLeft(ruinLeft(rec, now) / 1000)}.`,
      };
    }
    const reading = readIntel(this.save.intel[id] ?? null, now);
    const ally = view.relation === 'ally';
    const here = this.figuresAt(id, now);
    const general = this.save.figures.general;
    this.settleHandover(general, now);
    // Набег доступен ровно тогда, когда есть кому вести: полководец стоит здесь,
    // войско при нём и уже собралось. Второго способа назначить цель в игре нет.
    // Под пактом нападать нельзя — и это правило мира, а не подсказка панели.
    const pact = standingAt(this.diploOf(s.id, now), now) === 'pact';
    const gathering = Boolean(general.handover);
    const lead = here.includes('general') && troopTotal(general.troops ?? {}) > 0 && !gathering && !pact;
    // Удар и осада стоят энергию полководца (docs/agent_energy.md): у каждого дела своя цена.
    const energy = here.includes('general')
      ? { raid: this.energyCost('general', 'storm', now), besiege: this.energyCost('general', 'siege', now) }
      : undefined;
    const canRaid = lead && !energy?.raid.block;
    return {
      ...view,
      terrain: terrainAt(this.save.seed, s.x, s.y),
      distance: distance(this.save.home, s),
      terrainFactor: terrainFactor(this.save.seed, this.save.home, s),
      // Численность знают двое: разведка и собственные глаза, пока клетка в обзоре.
      power: reading ? reading.power : { ...UNKNOWN },
      pop: this.popEstimate(s, now),
      // Что получит победитель на каждой ступени — тем же, что игрок знает о дворе.
      fates: this.fateOptions(s, now),
      // Про чужой склад знает только разведка: смотреть на двор в подзорную
      // трубу и считать чужие амбары — разные вещи, и второе требует разведчика
      // у ворот. Поэтому здесь нет запасного пути через `visible`.
      loot: reading?.loot ?? { ...UNKNOWN },
      intel: reading,
      figuresHere: here,
      deals: s.tribeId ? this.dealsOf(s.tribeId, now) : [],
      diplomacy: this.diploView(s, now),
      revolt: this.revoltView(s.id, now),
      // Осада — тот же приказ, что и удар, и доступна она при тех же условиях:
      // полководец здесь, войско при нём, пакта нет. Разница в том, что под
      // этими стенами не должно уже стоять лагеря, а город не должен быть
      // только что доеден.
      can: {
        raid: canRaid,
        scout: true,
        support: ally,
        besiege:
          lead &&
          !energy?.besiege.block &&
          !this.save.sieges[s.id] &&
          !siegeImmune(this.save.siegeImmune[s.id], now) &&
          this.ourSiege(now) === null,
        open: false,
      },
      siege: this.cardSiege(s.id, now),
      ruinLeft: 0,
      sack: this.cardSack(s.id, now),
      ...(energy ? { energy, ...this.campStormOf(now) } : {}),
      ...(() => {
        const assault = this.assaultOf(s.id, now);
        const invest = this.assaultOf(s.id, now, FATE_DEFAULT, 'siege');
        return { ...(assault ? { assault } : {}), ...(invest ? { invest } : {}) };
      })(),
      note: canRaid
        ? null
        : pact
          ? 'Пакт в силе. Разрыв объявляет дипломат, и в силу он вступает не сразу.'
          : lead
            ? (energy?.raid.block ?? null)
            : gathering
            ? `Отряд ещё в сборе: ${formatLeft(Math.max(0, (general.handover?.until ?? 0) - now) / 1000)}.`
            : here.includes('general')
              ? 'Полководец здесь, но отряда при нём нет. За дружиной надо домой.'
              : 'Бьёт только полководец. Доведи его сюда.',
    };
  }

  /**
   * Какие фигуры стоят вплотную к этой цели. Укрывшаяся в городе не стоит нигде:
   * у своих ворот её нет, и приказывать ей оттуда нельзя, пока не выйдет.
   */
  private figuresAt(id: SettlementId, now: number): FigureId[] {
    const out: FigureId[] = [];
    for (const fid of FIGURE_IDS) {
      const f = this.save.figures[fid];
      if (!f || placeOf(f) !== 'map' || f.phase === 'moving') continue;
      if (this.touching(this.figureAt(f, now))?.id === id) out.push(fid);
    }
    return out;
  }

  private dealsOf(tribeId: string, now: number): DealView[] {
    const deals = this.save.pacts[tribeId] ?? {};
    const out: DealView[] = [];
    for (const key of Object.keys(deals) as DealId[]) {
      const pact = deals[key];
      if (!pact || pact.until <= now) continue;
      out.push({ id: key, tribeId, tribeName: this.tribeName(tribeId) ?? '', until: pact.until });
    }
    return out;
  }

  async intel(id: SettlementId): Promise<IntelReading | null> {
    return readIntel(this.save.intel[id] ?? null, this.clock());
  }

  async send(order: MarchOrder): Promise<SendResult> {
    const now = this.clock();
    const profile = this.save.profile;
    if (!profile) return { error: 'Город ещё не готов к походу.', march: null };
    // Из осаждённого города не выходит никто: ни гонец с воинами, ни разведка,
    // ни поддержка союзнику.
    const blocked = this.siegeBlock(now);
    if (blocked) return { error: blocked, march: null };

    const target = this.byId.get(order.target) ?? null;
    if (!target) {
      return {
        error: order.target === HOME_ID ? 'Свой город штурмовать незачем.' : 'Цель не найдена.',
        march: null,
      };
    }
    // За край своего региона походов нет — ни разведки, ни поддержки (docs/map_tw.md, 0.−2).
    if (!this.inRealm(target)) return { error: this.beyond(), march: null };

    const held = this.defenders(now);
    // Названный состав уходит из гарнизона поимённо — тех же видов и не больше,
    // чем их стоит дома, вместе с дружиной, если полководец в городе: она теряет
    // ушедших своей долей (`standingLost`), как у частокола. Без состава отряд
    // уходит числом и снимается со слабых из тех, кто не при полководце
    // (`world/muster.homeOf`), — поэтому и считается он от них.
    const named = order.troops ? pickTroops(order.troops, held.all) : {};
    if (!named) return { error: 'Столько бойцов дома нет.', march: null };
    const troops = troopTotal(named) > 0 ? named : undefined;
    // Разведку ведут разведчики: состав бойцов ушёл бы из гарнизона, а в отряде его не было бы (BTL-7).
    if (troops && order.mission === 'scout') return { error: 'В разведку бойцов не берут: её ведут разведчики.', march: null };
    const units: UnitStack = {};
    let size = 0;
    // По видам отряда, а не по ключам приказа; NaN и бесконечность — не люди (SETUP-3, SETUP-4).
    for (const id of UNIT_IDS) {
      // Названный состав — это и есть воины отряда: из дома уходят они, а не число приказа (BTL-7).
      const count = id === 'warrior' && troops ? troopTotal(troops) : Math.floor(own(order.units ?? {}, id) ?? 0);
      if (!wholeNonNeg(count, Number.MAX_SAFE_INTEGER) || count === 0) continue;
      // Воины уходят из гарнизона — того, что стоит дома в эту минуту. Разведчики —
      // свободные руки деревни, и сколько их, знает только слепок.
      const have = id === 'warrior' ? troopTotal(troops ? held.all : held.own) : (profile.units[id] ?? 0);
      if (count > have) return { error: `Столько ${id === 'scout' ? 'разведчиков' : 'бойцов'} дома нет.`, march: null };
      units[id] = count;
      size += count;
    }
    if (size === 0) return { error: 'Отряд пустой.', march: null };
    if (order.mission === 'raid') {
      // Единственный способ ударить — полководец у цели. Оставлять рядом второй
      // путь значило бы, что правило «армия ходит только с ним» держится на
      // честном слове интерфейса.
      return { error: 'В поход отряд водит полководец.', march: null };
    }
    if (order.mission === 'scout' && (units.scout ?? 0) === 0) {
      return { error: 'Разведку ведут разведчики.', march: null };
    }
    if (order.mission === 'support') {
      if ((units.warrior ?? 0) === 0) return { error: 'Поддержку несут бойцы.', march: null };
      if (this.relationOf(target) !== 'ally') return { error: 'Поддержку принимают только союзники.', march: null };
    }

    const home = this.save.home;
    const seconds = marchSeconds(
      distance(home, target),
      terrainFactor(this.save.seed, home, target),
      units,
    );
    const id = `m${this.save.nextMarch}`;
    // Воины идут своей мощью, а не средней: названный состав — им, без состава —
    // слабыми из гарнизона, тем же правилом, каким их снимает `muster.homeOf`.
    const warriors = units.warrior ?? 0;
    const perWarrior = warriors > 0 ? troopPower(troops ?? weakest(held.own, warriors)) / warriors : 0;
    const march: StoredMarch = {
      id,
      seed: marchSeed(this.save.seed, this.save.nextMarch++),
      mission: order.mission,
      units,
      own: true,
      fromId: HOME_ID,
      targetId: target.id,
      from: { ...home },
      to: { x: target.x, y: target.y },
      fromName: this.homeName(),
      toName: target.name,
      departAt: now,
      arriveAt: now + Math.round(realMs(seconds)),
      phase: 'out',
      power: stackPower(units, perWarrior),
      troops,
      loot: null,
    };
    if (troops) this.standingLost(held.own, held.standing, troops);
    this.save.marches.push(march);
    this.write();
    return { error: null, march: this.viewMarch(march, this.ourSiege(now)) };
  }

  async marches(): Promise<MarchView[]> {
    const now = this.clock();
    const camp = this.ourSiege(now);
    const discs = this.sightDiscs(now);
    return [...this.visibleMarches(now).map((m) => this.viewMarch(m, camp, this.marchRestView(m, now, discs))), ...this.warMarches()];
  }

  async recall(marchId: string): Promise<string | null> {
    const m = this.save.marches.find((x) => x.id === marchId);
    if (!m) return 'Поход не найден.';
    if (!m.own) return 'Чужой отряд тебе не подчиняется.';
    if (m.phase === 'back') return 'Отряд уже возвращается.';
    const now = this.clock();
    if (m.phase === 'stay') {
      // Отряд стоит в чужих стенах — до дома идти всю дорогу.
      this.turnHome(m, now, null);
    } else {
      // Возвращение занимает ровно столько, сколько отряд уже прошёл.
      const walked = Math.max(0, now - m.departAt);
      const back = { ...m.from };
      const backName = m.fromName;
      m.from = marchPosition(m, now);
      m.fromName = 'В пути';
      m.to = back;
      m.toName = backName;
      m.phase = 'back';
      m.departAt = now;
      m.arriveAt = now + walked;
      m.loot = null;
    }
    this.write();
    return null;
  }

  // ---------- Энергия агентов (docs/agent_energy.md) ----------
  //
  // Сколько энергии — считает дверь `world/energy` по отметке на фигуре. Мир пишет отметку в минуту, когда меняется
  // стойка: вышел из ворот, пришёл домой, встал лагерем, снял лагерь, выбыл, вернулся в строй. Стойку выводит одно
  // правило (`energyStance`) из той же фигуры, что и место (`world/shelter`), — второй правды о том, где агент, нет.

  /**
   * Что с энергией фигуры по её стойке и с какой минуты эта стойка. Дома (у своих ворот или за стеной) — копится; в
   * дороге — уходит, а придя, домой — копится, к цели — стоит (`world/energy.onRoad`); стоит в поле, у цели или в
   * осадном лагере — стоит: ожидание даром (решение владельца 06.10.2026); вне строя — стоит до возврата. Лагерь — пока
   * окно лежит: снимает его одна дверь (`liftSiege`), и она же пишет перемену.
   */
  private energyStance(id: FigureId): { mode: EnergyMode; ends: MarkEnds; since: number } {
    const f = this.save.figures[id];
    if (f.phase === 'down') return { mode: 'hold', ends: f.gone ? {} : { homeAt: f.downUntil }, since: f.departAt };
    if (f.phase === 'home') return { mode: 'fill', ends: {}, since: f.departAt };
    if (f.phase === 'moving') {
      // Темп дороги — режим марша полководца (ДР-2, М8): та же дорога — та же энергия.
      const rate = id === 'general' ? gaitSpeed(f.gait) : 1;
      const ends = { ...(this.touching(f.to)?.home ? { homeAt: f.arriveAt } : { stopAt: f.arriveAt }), ...(rate !== 1 ? { rate } : {}) };
      return { mode: 'drain', ends, since: f.departAt };
    }
    // Держит осаду — лагерь полудом: копится залп за фазу (ответ владельца 3, docs/siege_v2.md, 8.4). Окно снимает одна
    // дверь (`liftSiege`), и она же пишет перемену стойки.
    if (id === 'general') {
      const camp = Object.values(this.save.sieges).find(ourCamp);
      if (camp) return { mode: 'camp', ends: {}, since: siegeSince(camp) };
    }
    return { mode: 'hold', ends: {}, since: f.departAt };
  }

  /**
   * Отметка энергии фигуры, сверенная со стойкой. Стойка сменилась с прошлого чтения — новая отметка с минуты, когда
   * она началась (`departAt`): значение по прежней отметке, режим — по новой. Зовут её все, кто читает энергию, и
   * каждый, кто меняет фигуру, — **до** перемены: две перемены без чтения между ними слились бы в одну.
   *
   * Полководец в войне между игроками — отметка войны: энергией похода владеет сервер (`netlify/lib/war.ts`).
   */
  private energyOf(id: FigureId, now: number): EnergyMark {
    const f = this.save.figures[id];
    if (id === 'general' && f.war) {
      const war = this.warList().find((w) => w.id === f.war)?.army.energy;
      if (war) return (f.energy = { ...war });
    }
    // Лазутчик на деле у соседа — отметка сервера: цену и дорогу списал он (docs/spy_pvp.md).
    if (id === 'spy' && f.rival) {
      const op = this.spyList().find((x) => x.id === f.rival)?.energy;
      if (op) return (f.energy = { ...op });
    }
    const st = this.energyStance(id);
    const mark = f.energy;
    if (!mark) return (f.energy = freshMark(now, st.mode, st.ends));
    if (mark.mode === st.mode && mark.homeAt === st.ends.homeAt && mark.stopAt === st.ends.stopAt && (mark.rate ?? 1) === (st.ends.rate ?? 1)) return mark;
    return (f.energy = remark(mark, Math.max(mark.at, Math.min(st.since, now)), st.mode, st.ends));
  }

  /** Сколько энергии у агента сейчас, дробью. */
  private energyNow(id: FigureId, now: number): number {
    return energyAt(this.energyOf(id, now), now);
  }

  /**
   * Стойка сменилась без нового пути — встал лагерем или снял его — в минуту `at`: новая отметка оттуда, и цена дела,
   * если она есть. Прежнюю стойку сверяет `energyOf` до перемены — его зовут до того, как окно лагеря легло или ушло.
   */
  private restance(id: FigureId, at: number, before: EnergyMark, price = 0): void {
    const st = this.energyStance(id);
    const next = remark(before, at, st.mode, st.ends);
    this.save.figures[id].energy = price > 0 ? spend(next, at, price) : next;
  }

  /** Заплатить цену дела в минуту `at`: отметка сверена со стойкой, значение — минус цена. */
  private payEnergy(id: FigureId, action: EnergyAction, at: number): void {
    this.save.figures[id].energy = spend(this.energyOf(id, at), at, priceOf(action));
  }

  /**
   * Цена дела глазами меню: хватит ли энергии к минуте дела — с дорогой до него (`road`, мс пути по карте). Та же
   * проверка стоит в приказе: показанное и есть применённое.
   *
   * Выбился из сил — не по карману ни одно дело, и строка та же, что откажет приказ (`offDuty`): иначе кнопка в карточке
   * гасла бы «Не хватает энергии: 9 из 10», а приказ отказывал бы «выбился из сил».
   */
  private energyCost(id: FigureId, action: EnergyAction, now: number, road = 0, gait?: Gait): EnergyCost {
    const price = priceOf(action);
    const spent = this.isSpent(id, now) ? this.offDuty(id, now) : null;
    // Дорога полководца — в темпе его режима марша (ДР-2, М8); `gait` — для плана «а если так».
    const rate = id === 'general' ? gaitSpeed(gait ?? this.save.figures.general.gait) : 1;
    return { price, block: spent ?? energyBlock(this.energyNow(id, now), price, road, rate) };
  }

  /**
   * Минута, когда агент выбился из сил на карте; null — силы есть, он дома или вне строя. Кончилась в дороге раньше
   * прихода (`emptyAt`) — или стоит в поле без сил (`outOf`: не хватает ни на одно его дело, решение владельца
   * 06.10.2026), с минуты своей отметки: стоянка даром, и без сил он стал в минуту прихода или платы за дело. Свой
   * осадный лагерь держит его и без сил; поход на игрока держит энергию у сервера.
   *
   * В дороге мерка — ноль, а не цена дела: путь к цели несёт оплаченное дело (разведка у ворот, «дойти и ударить», удар,
   * перехват — цена списана при приказе, и хватить её должно к приходу), и повернуть домой раньше прихода значило бы
   * отнять оплаченное. Придя, он стоит — и без сил на дело идёт домой с минуты прихода.
   */
  private outAt(id: FigureId, now: number): number | null {
    const f = this.save.figures[id];
    if (f.phase !== 'moving' && f.phase !== 'field') return null;
    if ((id === 'general' && f.war) || (id === 'spy' && f.rival)) return null;
    const mark = this.energyOf(id, now);
    if (f.phase === 'moving') return emptyAt(mark);
    if (id === 'general' && Object.values(this.save.sieges).some((w) => ourCamp(w))) return null;
    return outOf(energyAt(mark, now), id) ? mark.at : null;
  }

  /**
   * Энергия кончилась на карте: идёт домой и дел не берёт. Отметка лежит с минуты, когда мир это разобрал
   * (`tire`), а до разбора — выводится той же дверью: приказ между пульсами не должен пройти у выбившегося из сил.
   */
  private isSpent(id: FigureId, now: number): boolean {
    const f = this.save.figures[id];
    if (f.phase === 'home' || f.phase === 'down') return false;
    if (f.spent !== undefined) return true;
    const t = this.outAt(id, now);
    return t !== null && t <= now;
  }

  /**
   * Энергия кончилась на карте — агент идёт домой сам, **с той минуты, когда она кончилась**, а не когда мир это
   * заметил: онлайн и офлайн дают одну дорогу. По пути он неуязвим и дел не берёт (`offDuty`), пока не дойдёт до
   * своих ворот. Занятый — на переговорах, отлёживается после дела, задержан на месте — уходит, как освободится. В
   * лагере энергия стоит, и без сил он его не бросает; поход на игрока держит энергию у сервера. Кончилась в пути
   * раньше прихода — до цели он не доходит. Зовётся из `stepFigures` до разбора прихода и после него.
   */
  private tire(id: FigureId, now: number): void {
    const f = this.save.figures[id];
    if (f.phase !== 'moving' && f.phase !== 'field') return;
    if ((id === 'general' && f.war) || (id === 'spy' && f.rival)) return;
    if (f.spent === undefined) {
      const t = this.outAt(id, now);
      if (t === null || t > now) return;
      // Дойдёт раньше, чем кончится: приход разберётся своим чередом, а стоянку проверят после него.
      if (f.phase === 'moving' && t >= f.arriveAt) return;
      // Целой миллисекундой: дорога домой ложится в сохранение, как всякая другая.
      f.spent = Math.ceil(t);
      this.addEffect({
        id: `fig-${id}-spent-${f.spent}`,
        lost: {},
        resources: {},
        prestige: 0,
        morale: 0,
        battle: null,
        text: `${FIGURE_BY_ID[id].name} выбился из сил и идёт домой. Пока не дойдёт, дел не берёт.`,
        good: false,
      });
    }
    // Уже идёт домой — дорога та же.
    if (f.phase === 'moving' && this.touching(f.to)?.home) return;
    const at = Math.max(f.spent, f.busyUntil ?? 0);
    if (at > now) return;
    f.chase = undefined;
    this.walk(id, { ...this.save.home }, at);
  }

  /** Энергия агента для карточки и меню. У пустого места её нет. */
  private energyViewOf(id: FigureId, now: number): FigureView['energy'] {
    if (this.save.figures[id].gone) return undefined;
    return energyView(this.energyOf(id, now), now);
  }

  // ---------- Фигуры и то, что они умеют ----------

  private viewFigure(id: FigureId, now: number): FigureView {
    const f = this.save.figures[id];
    this.settleHandover(f, now);
    const def = FIGURE_BY_ID[id];
    const at = this.figureAt(f, now);
    const near = f.phase === 'down' ? null : this.touching(at);
    const troops = f.troops ?? {};
    return {
      id,
      name: def.name,
      phase: f.phase,
      place: placeOf(f),
      at,
      from: { ...f.from },
      to: { ...f.to },
      departAt: f.departAt,
      arriveAt: f.arriveAt,
      sight: this.revealOf(id),
      atId: near?.id ?? null,
      atName: near?.name ?? null,
      atHome: near?.home ?? false,
      downUntil: f.downUntil,
      // Держат ли его: разведчика — с карты, лазутчика — на месте, пока идёт срок.
      held: Boolean(f.held) && !f.gone && (f.phase === 'down' ? now < f.downUntil : (f.busyUntil ?? 0) > now),
      gone: f.gone?.why ?? null,
      retiring: this.isRetiring(id),
      busyUntil: Math.max(0, f.busyUntil ?? 0),
      // Наблюдение — приказ, а не свойство фигуры: пока лазутчик смотрит, он не
      // работает, и обратное тоже верно. Панель обязана показывать, что сейчас.
      watching: Boolean(f.watching),
      watchSight: liveSight(id, f),
      troops: { ...troops },
      power: troopPower(troops),
      // Лагерь: пока он стоит, других дел у полководца нет, а приказ уйти
      // снимает осаду. Панель обязана сказать это до приказа, а не после.
      besieging: id === 'general' ? (this.ourSiege(now) ?? this.warCampOf()) : null,
      readyAt: f.handover?.until ?? 0,
      regroup: id === 'general' ? this.regroupOf(now) : null,
      // Мораль дружины между боями (14.31) — одной дверью `world/rest`; у свежей и у прочих фигур поля нет.
      ...(() => {
        const rest = id === 'general' ? restView(f.rest, now, this.menOf(troops)) : undefined;
        return rest ? { rest } : {};
      })(),
      // Энергия — одной дверью `world/energy`; у пустого места её нет.
      ...(() => {
        const energy = this.energyViewOf(id, now);
        return energy ? { energy } : {};
      })(),
      spent: this.isSpent(id, now),
      // Режим марша (ДР-2) — у полководца на месте.
      ...(id === 'general' && !f.gone ? { march: this.gaitView(now) } : {}),
    };
  }

  async figures(): Promise<FigureView[]> {
    const now = this.clock();
    return FIGURE_IDS.map((id) => this.viewFigure(id, now));
  }

  async moveFigure(id: FigureId, to: Coord, shownAt?: number): Promise<string | null> {
    const now = this.clock();
    const f = this.save.figures[id];
    const def = FIGURE_BY_ID[id];
    const off = this.offDuty(id, now);
    if (off) return off;
    const warBusy = id === 'general' ? this.warGeneralBusy() : null;
    if (warBusy) return warBusy;
    // Дожившему до покоя дорога одна — домой.
    if (this.isRetiring(id) && !this.touching(clampToWorld(to))?.home) return this.retiringBlock(id);
    // Занятая фигура с места не сходит. Для лазутчика это и есть цена провала:
    // его задержали, и увести его нельзя, пока не отпустят. Для дипломата —
    // то же правило: посреди переговоров он не уходит.
    const busy = Math.max(0, (f.busyUntil ?? 0) - now);
    if (busy > 0) return `${this.busyNote(id)}: ${formatLeft(busy / 1000)}.`;
    const target = clampToWorld(to);
    // За край своего региона агента не отправить: туда не ходит никто (docs/map_tw.md, 0.−2).
    if (!this.inRealm(target)) return this.beyond();
    const from = this.figureAt(f, now);
    const dist = distance(from, target);
    if (dist < 0.5) return `${def.name} уже там.`;
    // Из осаждённого города не выходит и фигура. Дорога домой при этом остаётся
    // открытой всегда: запрет на выход не должен запирать снаружи тех, кто идёт
    // внутрь, — иначе разведчик, застигнутый осадой в поле, не вернулся бы
    // никогда.
    if (this.touching(from)?.home && !this.touching(target)?.home) {
      const blocked = this.siegeBlock(now);
      if (blocked) return blocked;
      // Без сил на своё дело из своих ворот не выходят — та же мерка, что у цели (`outOf`): дома энергия вернётся
      // (docs/agent_energy.md, 6.6).
      const idle = idleBlock(this.energyNow(id, now), id);
      if (idle) return idle;
    }
    // Разведка у чужих ворот — дело разведчика, и цена его — к минуте прихода, с дорогой.
    const recon = this.reconCost(id, from, target, now);
    if (recon?.block) return recon.block;
    // Увести полководца из лагеря можно — но это и есть снятие осады, и
    // сказано об этом должно быть **до** приказа (см. `CAMP_LEAVE` в панели и в
    // меню действий). Отказывать здесь нельзя: тогда армия оказалась бы заперта
    // под чужими стенами навсегда.
    if (id === 'general') {
      const camp = this.ourSiege(now);
      if (camp) this.leaveCamp(camp, now);
    }
    this.walk(id, target, now, shownAt);
    if (recon) this.payEnergy(id, 'recon', now);
    this.write();
    return null;
  }

  /**
   * Цена разведки, если разведчика ведут к чужим воротам: пересчитать гарнизон — его дело (`data/energy`), и энергии
   * на него должно хватить к минуте прихода, с дорогой. Не разведчик или не к воротам — дела нет, цены нет.
   */
  private reconCost(id: FigureId, from: Coord, target: Coord, now: number): EnergyCost | null {
    if (id !== 'scout') return null;
    const near = this.touching(target);
    if (!near || near.home) return null;
    const seconds = travelTime(distance(from, target), terrainFactor(this.save.seed, from, target), FIGURE_BY_ID[id].speed);
    return this.energyCost(id, 'recon', now, realMs(seconds));
  }

  /**
   * Отправить фигуру в путь — без проверок, их сделал приказ. Здесь же разведчику
   * замораживается риск у ворот цели: на минуту прихода, которая решена сейчас, и на
   * ту обстановку, которую игрок видел в меню (`shownAt`, если меню свежее).
   */
  private walk(id: FigureId, target: Coord, now: number, shownAt?: number): void {
    const f = this.save.figures[id];
    // Стойка меняется — энергия сверяется до перемены: прежний путь или стоянка дожили до этой минуты.
    this.energyOf(id, now);
    // Налегке — истощение до этой минуты (ДР-2): новый путь — событие отрезка.
    if (id === 'general') this.wearGeneral(now);
    const from = this.figureAt(f, now);
    const seconds = travelTime(distance(from, target), terrainFactor(this.save.seed, from, target), this.speedOf(id));
    // Стоянка смены режима (ДР-2, М6): путь начнётся после неё.
    const start = id === 'general' ? Math.max(now, f.halt ?? 0) : now;
    f.from = from;
    f.to = target;
    f.departAt = start;
    f.arriveAt = start + Math.round(realMs(seconds));
    f.phase = 'moving';
    // Новый путь — новый приказ: удар по лагерю, «дойти и ударить» и дело из «Походов», отданные раньше, отменены.
    f.strike = undefined;
    f.assault = undefined;
    f.errand = undefined;
    // Пошёл — значит перестал смотреть. Наблюдение, пережившее дорогу, вернулось
    // бы само собой на новом месте и запирало бы приказы там, где игрок его не
    // ставил: приказ, который молча станет чем-то другим, хуже отказа.
    if (id === WATCHER) f.watching = false;
    f.peril = undefined;
    // Налегке вышел из своих ворот — с этой минуты отряд тает (ДР-2, М4).
    if (id === 'general') this.startWear(now);
    if (id !== 'scout') return;
    // Обстановка — на минуту прихода, отсчитанную от той минуты, что игрок видел в
    // меню: иначе ночь, наступившая между показом и нажатием, переписала бы риск.
    const shown = this.shownAt(shownAt, now);
    const plan = this.scoutPlan(target, shown + (f.arriveAt - now));
    if (plan.target) {
      f.peril = { target: plan.target.id, at: f.arriveAt, caught: plan.caught, peril: plan.peril, why: plan.why };
    }
  }

  /** Минута, на которую считать показанное: та, что была в меню, если оно свежее. */
  private shownAt(shownAt: number | undefined, now: number): number {
    return shownAt !== undefined && Number.isFinite(shownAt) && now - shownAt >= 0 && now - shownAt <= SHOWN_FRESH ? shownAt : now;
  }

  /**
   * Что будет, если вести агента к клетке: сколько идти и — у разведчика — чем он
   * рискует у ворот. Той же функцией риск замораживается при отправке (`walk`).
   */
  async leadPlan(id: FigureId, to: Coord): Promise<LeadPlan> {
    const now = this.clock();
    const f = this.save.figures[id];
    const target = clampToWorld(to);
    const from = this.figureAt(f, now);
    const seconds = travelTime(distance(from, target), terrainFactor(this.save.seed, from, target), this.speedOf(id));
    const plan = id === 'scout' ? this.scoutPlan(target, now + Math.round(realMs(seconds))) : null;
    return {
      seconds,
      target: plan?.target?.id ?? null,
      caught: plan?.caught ?? 0,
      peril: plan?.peril ?? 0,
      perilWhy: plan?.why ?? [],
      energy: this.leadEnergy(id, from, target, realMs(seconds), now),
      at: now,
    };
  }

  /**
   * Энергия в пути глазами «Вести сюда»: сколько будет на месте, цена дела у ворот и кончится ли она в дороге — теми
   * же проверками, что примет приказ (`moveFigure`): выход из ворот без энергии и цена разведки.
   */
  private leadEnergy(id: FigureId, from: Coord, target: Coord, road: number, now: number): NonNullable<LeadPlan['energy']> {
    const have = this.energyNow(id, now);
    const homeward = Boolean(this.touching(target)?.home);
    const recon = this.reconCost(id, from, target, now);
    const price = recon?.price ?? 0;
    const left = have - price - roadCost(road, id === 'general' ? gaitSpeed(this.save.figures.general.gait) : 1);
    const idle = this.touching(from)?.home && !homeward ? idleBlock(have, id) : null;
    return {
      price,
      block: idle ?? recon?.block ?? null,
      atArrival: Math.floor(Math.max(0, left) + 1e-9),
      runsOut: !homeward && left < 0,
    };
  }

  /**
   * Почему агента нет в строю — одной фразой на все приказы. null — в строю. Пустое
   * место, задержание и разгром звучат по-разному: это разные вещи, и игрок должен
   * знать, которая из них.
   */
  private offDuty(id: FigureId, now: number): string | null {
    const f = this.save.figures[id];
    const def = FIGURE_BY_ID[id];
    if (f.gone) {
      return f.gone.why === 'died'
        ? `${def.name} погиб. Место пустует.`
        : `${def.name} ушёл на покой. Место пустует.`;
    }
    // Лазутчик на тайном деле у соседа (docs/spy_pvp.md): где он и когда вернётся, говорит сервер.
    if (id === 'spy' && f.rival && f.phase !== 'down') return this.rivalNote(now);
    if (f.phase !== 'down') {
      // Энергия кончилась на карте — идёт домой и дел не берёт, пока не дойдёт (docs/agent_energy.md).
      return this.isSpent(id, now) ? `${def.name} выбился из сил и идёт домой. Пока не дойдёт, дел не берёт.` : null;
    }
    const left = formatLeft(Math.max(0, f.downUntil - now) / 1000);
    return f.held ? `${def.name}а держат под стражей, отпустят через ${left}.` : `${def.name} вне строя, вернётся через ${left}.`;
  }

  /** Человек на месте дожил до возраста покоя (`RETIRE_AGE`) — так говорит слепок деревни: мир возраста не знает. */
  private isRetiring(id: FigureId): boolean {
    return Boolean(this.save.profile?.agents?.[id]?.retiring) && !this.save.figures[id].gone;
  }

  /** Отказ дожившему до покоя. null — не дожил. */
  private retiringBlock(id: FigureId): string | null {
    return this.isRetiring(id) ? `${FIGURE_BY_ID[id].name} дел не берёт, идёт домой на покой.` : null;
  }

  /** Домой — обычный переход, по тем же правилам: своей арифметики у него нет. */
  /**
   * Поставить лазутчика наблюдателем или снять с наблюдения. Наблюдают **стоя**:
   * в пути фигура идёт, а не смотрит, и принимать приказ, который начнёт
   * действовать когда-нибудь потом, нельзя.
   */
  async watch(on: boolean): Promise<string | null> {
    const now = this.clock();
    const id = WATCHER;
    const f = this.save.figures[id];
    const off = this.offDuty(id, now) ?? (on ? this.retiringBlock(id) : null);
    if (off) return off;
    const busy = Math.max(0, (f.busyUntil ?? 0) - now);
    if (busy > 0) return `${this.busyNote(id)}: ${formatLeft(busy / 1000)}.`;
    if (on && placeOf(f) === 'city') return 'Из-за стены не наблюдают. Выведи лазутчика из города.';
    if (on && !standing(f.phase)) return 'Наблюдают стоя. Доведи лазутчика до места.';
    if (Boolean(f.watching) === on) return null;
    f.watching = on;
    this.write();
    return null;
  }

  /**
   * Агент входит в свой город и укрывается — или выходит обратно. Место у него
   * одно (`world/shelter`): клетку вход не меняет, и выходит агент ровно туда, откуда
   * вошёл. Входят стоя у своих ворот; с дороги и из поля — нет.
   *
   * Укрывшийся честно не работает: не смотрит (наблюдение снимается на входе), не
   * открывает местность, не стоит ни у чьих ворот и дружину не собирает. Выйти можно
   * всегда, и под осадой тоже: из города к своим воротам — не выход за стены.
   * Пойти куда-нибудь — тоже выход: любой путь переписывает отметку стоянки сам.
   */
  async shelter(id: FigureId, on: boolean): Promise<string | null> {
    const now = this.clock();
    const f = this.save.figures[id];
    const def = FIGURE_BY_ID[id];
    const place = placeOf(f);
    const off = this.offDuty(id, now);
    if (off) return off;
    if ((place === 'city') === on) return null;
    if (on && !canShelter(f)) {
      return f.phase === 'moving'
        ? `${def.name} ещё в пути. В город входят от своих ворот.`
        : `В город входят от своих ворот. Доведи ${def.one} домой.`;
    }
    f.sheltered = on ? f.departAt : undefined;
    if (on && id === WATCHER) f.watching = false;
    this.write();
    return null;
  }

  async recallFigure(id: FigureId): Promise<string | null> {
    // Полководец в войне с игроком: увести его — отозвать поход или снять осаду, и решает это сервер.
    const led = id === 'general' ? this.warLed() : null;
    if (led) {
      if (led.phase === 'march') return this.warSend({ op: 'recall', id: led.id });
      if (led.phase === 'camp') return this.warSend({ op: 'retreat', id: led.id });
      return 'Отряд уже идёт домой.';
    }
    return this.moveFigure(id, { ...this.save.home });
  }

  /**
   * Почему раскладку полководца сейчас не поменять; null — можно. Одна проверка на приказ (`setGarrison`) и на окно
   * раскладки (`FigureView.regroup`): кнопка гаснет ровно там, где мир откажет, и той же строкой.
   *
   * Меняют её дома — у своих ворот или укрывшись в городе: в городе его отряд стоит с гарнизоном так же, как у ворот, и
   * требовать выйти к воротам значило бы добавить нажатия без выбора (docs/retinue.md, решение 2; тот же довод у
   * `shelter.canRegear`), — и стоя в поле вплотную к своему городу. В пути, в поле, в войне и пока идёт прошлый сбор — нет.
   */
  private regroupBlock(now: number): string | null {
    const f = this.save.figures.general;
    this.settleHandover(f, now);
    const off = this.offDuty('general', now);
    if (off) return off;
    const busy = this.warGeneralBusy();
    if (busy) return busy;
    if (f.phase === 'moving') return 'Полководец в пути, отряд к нему не подойдёт.';
    if (f.handover) return `Отряд ещё в сборе: ${formatLeft(Math.max(0, f.handover.until - now) / 1000)}.`;
    if (!this.touching(this.figureAt(f, now))?.home) return 'Отряд собирают только у своего города.';
    return null;
  }

  /**
   * Почему полководцу сейчас не добавить бойцов: город в осаде — логова или игрока, дверью выхода `siegeBlock`, той же,
   * что у похода и фигуры (docs/pvp.md, решение 8). Вернуть отряд в гарнизон осада не мешает: под запретом выход, а не
   * вход.
   */
  private regroupGrow(now: number): string | null {
    return this.siegeBlock(now);
  }

  /**
   * Перевод мгновенный: полководец в своём городе — у своих ворот или укрывшись (`muster.inTown`), — **и в осаде тоже**
   * (решение владельца 16.10.2026, docs/ui_v2.md, 6.11; прежде в осаде шёл сбор — решение 06.10.2026, docs/retinue.md,
   * раздел 7). В городе его отряд и так стоит с гарнизоном (`muster.postureOf` = `stands`), и перевод обороны не
   * меняет — платить за него сбором не за что. Сбор — только в поле у своих ворот (`regroupBlock`): там его срок и
   * черта «Мясник» (`musterWait`). Осада по-прежнему не даёт добавить бойцов (`regroupGrow`): под запретом выход.
   */
  private regroupInstant(now: number): boolean {
    return inTown(this.save.figures.general, now);
  }

  /** Раскладка полководца глазами окна — те же проверки, что примет `setGarrison`. */
  private regroupOf(now: number): Regroup {
    const block = this.regroupBlock(now);
    return { block, grow: block ?? this.regroupGrow(now), instant: block === null && this.regroupInstant(now) };
  }

  /**
   * Полководец берёт гарнизон себе или возвращает его. Только вплотную к своему
   * поселению: в поле состав войска не меняется, и это правило, а не удобство.
   *
   * `troops` — каким войско должно стать. Разница с нынешним и есть то, что
   * переходит из деревни к полководцу или обратно. Потолок — всё войско, что не
   * ушло отрядами (`world/muster.roomOf`): дома собранная дружина и так в
   * гарнизоне, и считать её поверх гарнизона второй раз нельзя.
   *
   * Сбор — плата временем: пока он идёт, в `troops` числятся все, кого он касается,
   * и другого приказа отряду нет. Сбор бывает только вне города (в поле у своих
   * ворот): там их нет и в обороне — ни как гарнизона, ни как дружины. В городе —
   * и в осаде — платы нет, перевод мгновенный (`regroupInstant`, решение владельца
   * 16.10.2026); сбор в городе из сохранения прежних правил стоит у стен
   * (`world/muster.postureOf`, `inTown`).
   *
   * С ДР-6 окна игры этим приказом не пользуются: состав выбирают в окне дела, и уходит он с делом одним приказом
   * (`ErrandOrder.troops`, `takeBand`); вернувшись в город, отряд снова гарнизон (`homecoming`). Приказ остаётся старому
   * клиенту и консоли и принимается, как раньше.
   */
  async setGarrison(troops: TroopStack | null): Promise<string | null> {
    return this.regroup(troops, this.clock());
  }

  /** Раскладка в минуту `now` — дверь приказа `setGarrison` и состава дела (`takeBand`). */
  private regroup(troops: TroopStack | null, now: number): string | null {
    const f = this.save.figures.general;
    const block = this.regroupBlock(now);
    if (block) return block;
    const room = roomOf(this.save.profile?.army ?? {}, this.save.marches);
    const held = f.troops ?? {};
    const next = pickTroops(troops, room);
    if (!next) return 'Столько бойцов дома нет.';
    // Дружину из осаждённого города не увести: это тот же выход, только другим
    // приказом. Вернуть её в гарнизон осада не мешает — под запретом выход, а не
    // вход, и подкрепление под стенами дело хорошее.
    if (TROOP_IDS.some((id) => (next[id] ?? 0) > (held[id] ?? 0))) {
      const blocked = this.regroupGrow(now);
      if (blocked) return blocked;
    }
    // Сколько людей переходит из рук в руки — в обе стороны: время стоит и
    // сбор, и роспуск. Пока идут, в `troops` числятся и уходящие, и
    // возвращающиеся: вне города они не в строю, в городе — у стен.
    let moved = 0;
    const onRoad: TroopStack = {};
    for (const id of TROOP_IDS) {
      const a = held[id] ?? 0;
      const b = next[id] ?? 0;
      moved += Math.abs(b - a);
      const both = Math.max(a, b);
      if (both > 0) onRoad[id] = both;
    }
    if (moved === 0) return null;
    this.carryHandover(held, next, now);
    // В городе — сразу, и в осаде тоже: отряд и так стоит с гарнизоном, оборона от перевода не меняется.
    if (this.regroupInstant(now)) {
      f.troops = troopTotal(next) > 0 ? { ...next } : undefined;
      f.handover = undefined;
      this.write();
      return null;
    }
    const wait = this.musterWait(moved);
    f.troops = troopTotal(onRoad) > 0 ? onRoad : undefined;
    f.handover = { troops: next, until: now + wait };
    // Сбор вне города увёл бойцов из гарнизона — за стеной их больше не кормят; сбор в городе едоков не меняет.
    this.resiege(HOME_ID, now);
    this.write();
    return null;
  }

  /**
   * Состав отряда на дело полководца (ДР-6, docs/siege_v2.md, «Решения ДР-6»): выбран в окне дела из гарнизона. В своём
   * городе перевод мгновенный (`regroupInstant`), и отряд встаёт тем же переводом, что раскладка (`regroup`), — а дело,
   * которому мир отказал, возвращает всех в гарнизон (отмена): за отказ не платят ни составом, ни усталостью. Вне города —
   * тот отряд, что при нём: в поле состав не меняется, и иной состав в приказе — отказ. Без состава — null, ничего не
   * трогают. Строка — отказ, функция — отмена перевода.
   */
  private takeBand(troops: TroopStack | undefined, now: number): string | (() => void) | null {
    if (troops === undefined) return null;
    const f = this.save.figures.general;
    if (!this.regroupInstant(now)) {
      const held = f.troops ?? {};
      return TROOP_IDS.every((id) => Math.floor(own(troops, id) ?? 0) === (held[id] ?? 0)) ? null : BAND_AS_IS;
    }
    const was = { troops: f.troops, handover: f.handover, rest: f.rest, homeRest: this.save.homeRest };
    const err = this.regroup(troops, now);
    if (err) return err;
    return () => {
      f.troops = was.troops;
      f.handover = was.handover;
      f.rest = was.rest;
      this.save.homeRest = was.homeRest;
      this.write();
    };
  }

  /**
   * Полководец в своём городе — его отряд снова гарнизон (ДР-6): в городе отряда нет, состав выбирают в окне дела. Зовут
   * её все двери прихода домой (шаг фигур, сорванная и кончившаяся погоня, конец войны, возврат в строй) и чтение
   * сохранения — переход: отряд, собранный дома по прежней раскладке, встаёт гарнизоном. Без потерь: люди переходят со
   * своей усталостью (`carryHandover`), а оборона та же — в городе отряд и так стоял с гарнизоном (`muster.postureOf`).
   * Отряд в поле, в пути, в войне и у выбывшего не трогают.
   */
  private homecoming(at: number): void {
    const f = this.save.figures.general;
    if (!f || f.gone || f.war || !inTown(f, at)) return;
    this.settleHandover(f, at);
    // Сбор в городе по прежним правилам — уходящие и возвращающиеся числятся в `troops`: в гарнизон встают все.
    const held = f.troops ?? {};
    if (troopTotal(held) === 0 && !f.handover) return;
    this.carryHandover(held, {}, at);
    f.troops = undefined;
    f.handover = undefined;
  }

  /**
   * Отказ «отряда нет» словами места: в городе отряд дают в окне дела (`NO_BAND_HOME`), вне города — `field`. Мерка
   * «нет отряда» одна (`ui/map/ring.emptyRetinue`).
   */
  private noBand(now: number, field = 'При полководце нет отряда.'): string {
    return inTown(this.save.figures.general, now) ? NO_BAND_HOME : field;
  }

  /**
   * Гарнизон деревни в эту минуту, по видам: всё войско племени, каким его знает
   * мир, минус свои отряды в пути и дружина не дома. Дружина, собранная и стоящая
   * дома, — в нём (`world/muster`). Правило одно с мостом.
   *
   * Считается здесь, а не приезжает слепком: слепок собирается раз в пульс, а
   * дружина уходит к полководцу, гибнет и возвращается между пульсами. Гарнизон,
   * поверенный слепку, отставал бы ровно на то, что случилось с последнего
   * пульса, — и отставал бы в сторону «дома больше, чем есть».
   */
  private garrison(now: number): TroopStack {
    return this.defenders(now).all;
  }

  /**
   * Гарнизон в эту минуту, разложенный на две части ради потерь: `all` — весь,
   * `standing` — дружина в нём, `own` — остальные. Его читают все, кто
   * спрашивает «кто в городе»: бой у частокола, рты за стеной, рассеяние при
   * падении, вылазка, отряд и передача полководцу.
   */
  private defenders(now: number): { all: TroopStack; own: TroopStack; standing: TroopStack } {
    const f = this.save.figures.general;
    this.settleHandover(f, now);
    const army = this.save.profile?.army ?? {};
    const away = awayOf(this.save.marches, [f], now);
    return { all: homeOf(army, away), own: ownOf(army, away), standing: standingTroops(army, away) };
  }

  /**
   * Гарнизон потерял людей — дружина, стоящая в нём, теряет свою долю тут же:
   * у частокола и на вылазке гибнут вместе (`standingShare`). Всё войско племени
   * убудет по последствию, а при полководце вычёркиваются ровно павшие из дружины —
   * иначе он держал бы людей, которых у племени уже нет, до сверки на следующем
   * пульсе.
   */
  private standingLost(own: TroopStack, standing: TroopStack, lost: TroopStack): TroopStack {
    const share = standingShare(own, standing, lost);
    if (troopTotal(share) === 0) return share;
    const f = this.save.figures.general;
    const left = troopsAfter(f.troops ?? {}, share);
    f.troops = troopTotal(left) > 0 ? left : undefined;
    // Доля отряда — в последствие боя: его раненые встанут его бойцами (`HomeEffect.standing`, docs/retinue.md).
    return share;
  }

  // ---------- Мораль армии между боями (docs/battle_eu4.md, 14.31; `world/rest`) ----------

  /** Бойцы строя войска — мерой ядра боя: ею меряется, сколько вышло из боя и сколько пришло после. */
  private menOf(troops: TroopStack): number {
    return stackTotal(kindsOf(troops));
  }

  /** Мораль дружины в минуту `at`: пара дружины на тех, кто при полководце сейчас. */
  private generalRest(at: number): number {
    const f = this.save.figures.general;
    return restAt(f.rest, at, this.menOf(f.troops ?? {}));
  }

  /**
   * Мораль гарнизона дома в минуту `at` — без дружины: у неё своя пара. `siege` — с износом осады логова (`homeWear`):
   * так дерётся гарнизон; без него — усталость после боя, какой её показывает окно (`homeRestView`).
   */
  private garrisonRest(own: TroopStack, at: number, siege = true): number {
    return restAt(this.save.homeRest, at, this.menOf(own)) * (siege ? this.homeWear(at) : 1);
  }

  /**
   * Во сколько раз осада логова ослабила гарнизон своего города в минуту `at` — день за днём (`siegecraft.garrisonWear`,
   * у лагеря логова дел нет, и это `siege.siegeWear`): та же дверь, что у осады игроком на сервере. Осады нет — единица.
   */
  private homeWear(at: number): number {
    const w = this.homeSiege(at);
    return w ? garrisonWear(w, at) : 1;
  }

  /**
   * Мораль тех, кто дома, в минуту `at`: гарнизон и стоящая дома дружина — каждый своей парой, вместе по людям;
   * ополчение — жители у частокола, не армия, всегда свежее. `siege` — с износом осады логова (см. `garrisonRest`).
   */
  private homeRest(held: { own: TroopStack; standing: TroopStack }, at: number, militia = 0, siege = true): number {
    return mixRest([
      { rest: this.garrisonRest(held.own, at, siege), men: this.menOf(held.own) },
      { rest: this.generalRest(at), men: this.menOf(held.standing) },
      { rest: 1, men: militia },
    ]);
  }

  /** Мораль гарнизона чужого поселения в минуту `at` (`lairRest`); `men` — сколько в нём бойцов строя сейчас. */
  private lairRestAt(id: SettlementId, at: number, men: number): number {
    return restAt(this.save.lairRest?.[id], at, men);
  }

  /**
   * Мораль гарнизона чужого поселения в осаде: своя пара и часы осады с обстрелом лагеря (`siegecraft.garrisonWear`) —
   * та же дверь, что у гарнизона города игрока на сервере (`netlify/lib/war.ts`). Окно — то, что стоит сейчас; у штурма из
   * своего лагеря — снятое перед боем (`attack`).
   */
  private besiegedRest(id: SettlementId, at: number, men: number, w: SiegeWindow | null = this.siegeOf(id, at)): number {
    return this.lairRestAt(id, at, men) * (w ? garrisonWear(w, at) : 1);
  }

  /**
   * Мораль тех, кто дома, глазами игрока: гарнизон и стоящая дома дружина, без ополчения (оно свежее всегда). Полной
   * она станет, когда отдохнёт последняя из двух частей.
   */
  private homeRestView(now: number): RestView | undefined {
    const held = this.defenders(now);
    // Усталость после боёв, без износа осады: тот не проходит, пока лагерь стоит, и у окна он своим полем (`wear`).
    // Прежде он входил сюда, и окно без боя писало «Гарнизон дрался недавно… полная через 0 мин» (docs/siege_audit.md, 5).
    const share = this.homeRest(held, now, 0, false);
    if (share >= 1) return undefined;
    const band = troopTotal(held.standing) > 0 ? restFullAt(this.save.figures.general.rest, now) : now;
    return { share: Math.floor(share * 100) / 100, fullAt: Math.max(restFullAt(this.save.homeRest, now), band) };
  }

  /** Мораль лагеря глазами игрока: у нашего — дружины, у чужого — отряда, что сел лагерем. */
  private campRestView(w: SiegeWindow, now: number): RestView | undefined {
    if (ourCamp(w)) {
      const f = this.save.figures.general;
      return restView(f.rest, now, this.menOf(f.troops ?? {}));
    }
    const m = this.save.marches.find((x) => x.id === w.campId);
    return m ? restView(m.rest, now, stackTotal(raidingParty(this.save.seed, m.id, m.power).kinds)) : undefined;
  }

  private setLairRest(id: SettlementId, pair: RestPair | undefined): void {
    const all = { ...(this.save.lairRest ?? {}) };
    if (pair) all[id] = pair;
    else delete all[id];
    if (Object.keys(all).length > 0) this.save.lairRest = all;
    else delete this.save.lairRest;
  }

  /**
   * Те, кто дома, дрались — у стены, у ворот, на вылазке, из ворот с полководцем: вернувшиеся несут долю, с которой
   * вышли из боя (`field.rest`), не дравшиеся — свою. Гарнизон и стоящая дома дружина — каждый своей парой: кто из
   * вышедших и павших чей, делит то же правило, что потери (`standingShare`). `fought` — доля вышедших, что дрались
   * (остальные стояли у рогаток).
   */
  private homeBack(
    held: { own: TroopStack; standing: TroopStack },
    went: TroopStack,
    lost: TroopStack,
    share: number,
    at: number,
    fought = 1,
  ): void {
    const wentStanding = standingShare(held.own, held.standing, went);
    const lostStanding = standingShare(held.own, held.standing, lost);
    const part = (army: TroopStack, w: TroopStack, l: TroopStack, pair: RestPair | undefined): RestPair | undefined => {
      const went_ = this.menOf(w) * fought;
      return rejoin(pair, at, this.menOf(army), went_, Math.max(0, went_ - this.menOf(l)), share);
    };
    this.save.homeRest = part(held.own, troopsAfter(went, wentStanding), troopsAfter(lost, lostStanding), this.save.homeRest);
    if (troopTotal(held.standing) > 0) {
      const f = this.save.figures.general;
      f.rest = part(held.standing, wentStanding, lostStanding, f.rest);
    }
  }

  /**
   * Сбор дружины и роспуск её в гарнизон: люди переходят со своей усталостью (`world/rest.carryRest`). Пришедшие к
   * полководцу несут мораль гарнизона, вернувшиеся в гарнизон — мораль дружины; пары обеих армий — на эту минуту.
   */
  private carryHandover(held: TroopStack, next: TroopStack, now: number): void {
    const f = this.save.figures.general;
    const kept: TroopStack = {};
    const joined: TroopStack = {};
    const back: TroopStack = {};
    for (const id of TROOP_IDS) {
      const a = held[id] ?? 0;
      const b = next[id] ?? 0;
      if (Math.min(a, b) > 0) kept[id] = Math.min(a, b);
      if (b > a) joined[id] = b - a;
      if (a > b) back[id] = a - b;
    }
    const ownMen = this.menOf(this.defenders(now).own);
    const heldMen = this.menOf(held);
    const garrison = this.save.homeRest;
    const band = f.rest;
    f.rest = carryRest({ pair: band, men: this.menOf(kept), of: heldMen }, { pair: garrison, men: this.menOf(joined), of: ownMen }, now);
    this.save.homeRest = carryRest(
      { pair: garrison, men: Math.max(0, ownMen - this.menOf(joined)), of: ownMen },
      { pair: band, men: this.menOf(back), of: heldMen },
      now,
    );
  }

  /**
   * Полководец не держит бойцов, которых у племени нет. Сверка идёт на каждом
   * слепке, и это не проверка приказа, а учёт: откуда бы ни взялся лишний боец в
   * строю — из сохранения, где дружину успели удвоить, из партии, начатой
   * заново при старом мире, или из пути, о котором ещё никто не подумал, — в
   * бой он не пойдёт. Сколько вычеркнули, игрок узнаёт строкой в летописи.
   */
  private muster(at: number): void {
    const f = this.save.figures.general;
    const held = f.troops ?? {};
    if (troopTotal(held) === 0) return;
    // Сколько каждого вида полководец вообще может держать: всё войско минус
    // свои отряды в пути — тем же правилом, каким считается гарнизон.
    const room = roomOf(this.save.profile?.army ?? {}, this.save.marches);
    const cut = (t: TroopStack): TroopStack => {
      const out: TroopStack = {};
      for (const id of TROOP_IDS) {
        const n = Math.min(Math.max(0, t[id] ?? 0), room[id] ?? 0);
        if (n > 0) out[id] = n;
      }
      return out;
    };
    const kept = cut(held);
    const gone = troopTotal(held) - troopTotal(kept);
    if (gone === 0) return;
    f.troops = troopTotal(kept) > 0 ? kept : undefined;
    if (f.handover) f.handover = { ...f.handover, troops: cut(f.handover.troops) };
    this.addEffect({
      id: `muster-${at}`,
      lost: {},
      resources: {},
      prestige: 0,
      morale: 0,
      battle: null,
      text: `Отряд полководца сверили с казармами: ${gone} лишних вычеркнуты.`,
      good: false,
    });
  }

  /**
   * Места агентов по слепку деревни. Мир людей не знает — он знает номер человека на
   * месте, пустует ли оно и пора ли человеку на покой, — и приводит фигуры к этому:
   *
   * - **новый номер** — новый человек встаёт у своих ворот чистым: ни дружины, ни дела,
   *   ни стоянки, ни риска прошлого;
   * - **место пустует**, а фигура жива — её убирает: партия знает о пустом месте раньше
   *   мира (последствие легло, а сохранение мира потеряно);
   * - **пора на покой** — дожил до `RETIRE_AGE`: стоящий в поле идёт домой, дошедший до
   *   своих ворот уходит (`HomeEffect.retired`). В пути и вне строя — ждёт.
   *
   * Весть о гибели, ещё не дошедшая до партии, пустого места не отменяет: номер тот же,
   * и фигура остаётся пустой, пока слепок не назовёт нового.
   */
  private seatAgents(now: number): void {
    const people = this.save.profile?.agents ?? {};
    for (const id of FIGURE_IDS) {
      const f = this.save.figures[id];
      const want = people[id];
      const person = want?.person ?? 0;
      if (person !== (f.person ?? 0)) {
        this.freshFigure(id, now, person, want?.vacant === true);
        continue;
      }
      if (want?.vacant && !f.gone) {
        // Лагерь уходит вместе с полководцем — до того, как он сходит с карты: осада без него не стоит (MAP-3).
        if (id === 'general') this.dropCamp(now);
        this.offMap(id, now);
        f.held = false;
        f.busyUntil = 0;
        f.gone = { person, at: now, why: 'retired' };
        continue;
      }
      if (want?.retiring && !f.gone) this.retireStep(id, now);
    }
    // Сохранение, где лагерь пережил пустое место (до MAP-3), чинится здесь: лагерь без живого полководца снимается.
    if (this.save.figures.general.gone) this.dropCamp(now);
  }

  /** Снять наш лагерь, если он стоит: полководец ушёл с места. */
  private dropCamp(now: number): void {
    const camp = this.ourSiege(now);
    if (camp) this.leaveCamp(camp, now);
  }

  /** Новый человек на месте: у своих ворот и с чистыми руками — или пустое место под его номером. */
  private freshFigure(id: FigureId, now: number, person: number, vacant: boolean): void {
    const home = { ...this.save.home };
    const f: StoredFigure = {
      phase: vacant ? 'down' : 'home',
      from: home,
      to: { ...home },
      departAt: now,
      arriveAt: now,
      downUntil: 0,
      person,
      // Новый человек — с полным запасом (docs/agent_energy.md).
      energy: freshMark(now, vacant ? 'hold' : 'fill'),
    };
    if (vacant) f.gone = { person, at: now, why: 'retired' };
    // Лагерь уходит вместе с прежним полководцем: осада без него не стоит.
    if (id === 'general') {
      const camp = this.ourSiege(now);
      if (camp) this.leaveCamp(camp, now);
    }
    this.save.figures[id] = f;
  }

  /**
   * Дожил до покоя. Дошёл до своих ворот (или стоит в городе) — уходит, и дружина
   * остаётся гарнизоном: она ему не своя, а племени. Стоит в поле и свободен — идёт
   * домой сам: иначе доживший до покоя лазутчик стал бы вечным наблюдателем, а
   * разведчик — вечным даровым донесением у логова. В пути, занятый и вне строя —
   * ждёт.
   */
  private retireStep(id: FigureId, now: number): void {
    const f = this.save.figures[id];
    this.settleHandover(f, now);
    if (f.phase === 'down' || f.phase === 'moving' || f.handover) return;
    if ((f.busyUntil ?? 0) > now) return;
    if (f.phase === 'field') {
      if (id === 'general') {
        const camp = this.ourSiege(now);
        if (camp) this.leaveCamp(camp, now);
      }
      this.walk(id, { ...this.save.home }, now);
      return;
    }
    const person = f.person ?? 0;
    this.offMap(id, now);
    f.held = false;
    f.busyUntil = 0;
    f.gone = { person, at: now, why: 'retired' };
    this.addEffect({
      id: `fig-${id}-retired-${now}`,
      lost: {},
      resources: {},
      prestige: 0,
      morale: 0,
      battle: null,
      retired: { agent: id, person },
      // Строку летописи пишет племя: только оно знает, как звали ушедшего.
      text: '',
      good: true,
    });
  }

  /**
   * Передача дружины кончается сама, по времени: срок наступил — состав стал
   * тем, о котором договорились. Это приведение при чтении, а не тик: офлайн
   * даёт ровно то же, что непрерывная игра.
   */
  private settleHandover(f: StoredFigure, now: number): void {
    if (!f.handover || now < f.handover.until) return;
    const next = f.handover.troops;
    // Сбор кончился: вернувшиеся встали в гарнизон, а собранная дружина — в
    // оборону у своих ворот. Под осадой часы голода пересчитываются, как от
    // любого другого подкрепления, — после того, как состав стал новым: оборона
    // читается в эту минуту и их уже считает.
    f.troops = troopTotal(next) > 0 ? { ...next } : undefined;
    f.handover = undefined;
    this.resiege(HOME_ID, now);
  }

  async attack(order: AttackOrder): Promise<AttackResult> {
    const now = this.clock();
    const f = this.save.figures.general;
    // Полководец ведёт войну с игроком: удар — штурм из лагеря, и считает его сервер (docs/pvp.md).
    const led = this.warLed();
    if (led) {
      if (led.phase !== 'camp') return { error: led.phase === 'march' ? 'Отряд ещё в пути к городу.' : 'Отряд идёт домой.', reportId: null, won: false };
      // Участь штурма — выбранная в окне лагеря, как у штурма логова (`order.fate`); сервер проверит её той же дверью.
      const err = await this.warSend({
        op: 'storm',
        id: led.id,
        ...(order.fate ? { fate: order.fate } : {}),
        ...(order.machines ? { machines: order.machines } : {}),
      });
      return err ? { error: err, reportId: null, won: false } : { error: null, ...this.warReportOf(led.id) };
    }
    const off = this.offDuty('general', now) ?? this.retiringBlock('general');
    if (off) return { error: off, reportId: null, won: false };
    if (f.phase === 'moving') return { error: 'Полководец ещё в пути.', reportId: null, won: false };
    this.settleHandover(f, now);
    if (f.handover) {
      return {
        error: `Отряд ещё в сборе: ${formatLeft(Math.max(0, f.handover.until - now) / 1000)}.`,
        reportId: null,
        won: false,
      };
    }
    // В своём городе отряда нет (ДР-6): лагерь у своих стен из города бьют вылазкой, другой цели у ворот нет.
    if (inTown(f, now)) return { error: this.siegeOf(HOME_ID, now) ? STRIKE_FROM_TOWN : 'Рядом нет цели.', reportId: null, won: false };
    if (troopTotal(f.troops ?? {}) === 0) return { error: 'При полководце нет отряда.', reportId: null, won: false };
    const near = this.touching(this.figureAt(f, now));
    if (!near) return { error: 'Рядом нет цели.', reportId: null, won: false };
    // Ни удара, ни штурма за краем своего региона (docs/map_tw.md, 0.−2): туда полководца и не отправить.
    const place = near.home ? null : this.byId.get(near.id);
    if (place && !this.inRealm(place)) return { error: this.beyond(), reportId: null, won: false };
    // Под стенами стоит чужой лагерь — бьём по нему, а не по городу: это и есть
    // «ударить по лагерю» глазами игрока, и считается оно тем же боем, что и
    // вылазка. Свой лагерь этой проверкой не задет: `ourCamp` отсекает его. Под
    // своим городом полководец дома, и его дружина — гарнизон: отказ говорит учёт.
    const camp = this.siegeOf(near.id, now);
    if (camp && !ourCamp(camp)) {
      const check = this.strikeCheck(near.id, now);
      if (check.error !== null) return { error: check.error, reportId: null, won: false };
      const res = this.resolveStrike(near.id, now, false);
      if (!res.error) this.payEnergy('general', 'strike', now);
      return res;
    }
    if (near.home) return { error: 'Рядом нет цели.', reportId: null, won: false };
    // Держит осаду — ударить можно только по тому городу, который держит: это штурм,
    // и он снимает лагерь. Другого дела у полководца, пока лагерь стоит, нет.
    const besieging = this.ourSiege(now);
    if (besieging && besieging !== near.id) {
      return { error: `${CAMP_BUSY} ${CAMP_LEAVE}`, reportId: null, won: false };
    }
    const target = this.byId.get(near.id);
    if (!target) return { error: 'Цель не найдена.', reportId: null, won: false };
    const declared = order.fate ?? FATE_DEFAULT;
    const blocked = this.stormBlock(target, now, declared);
    if (blocked) return { error: blocked, reportId: null, won: false };
    // Штурм — бой: его цена в энергии полководца (docs/agent_energy.md). В лагере энергия стояла — платит тем, что есть.
    const tired = this.energyCost('general', 'storm', now).block;
    if (tired) return { error: tired, reportId: null, won: false };
    // Штурм из своего лагеря (`STORM_HOLDS`, docs/siege_v2.md, 4.4): отбитый лагерь не снимает — осада идёт дальше с
    // теми, кто уцелел; взяли город или штурмовать стало некому — осада кончена.
    const ours = besieging === target.id ? (this.save.sieges[target.id] ?? null) : null;
    this.payEnergy('general', 'storm', now);
    const res = this.attackAt(target, now, declared, ours);
    if (ours && res.won) this.siegeDone(target.id, now);
    if (ours && (res.won || troopTotal(f.troops ?? {}) === 0)) {
      this.liftSiege(target.id, now, res.won ? 'storm' : 'broken');
      if (res.won) this.liftedFate(target.id, now, declared);
      this.siegeToReport(res.reportId, target.id, now);
    }
    return res;
  }

  /**
   * Наш лагерь довёл осаду до конца штурмом (этап 2е): опыт осад полководцу — последствием без строки летописи, строку
   * несёт сам бой. Падение голодом, сдача и дань засчитывают её своим последствием (`siege: true`).
   */
  private siegeDone(id: SettlementId, at: number): void {
    this.addEffect({ id: `siege-done-${id}-${at}`, lost: {}, resources: {}, prestige: 0, morale: 0, battle: null, siege: true, text: '', good: true });
  }

  /**
   * Почему удар по двору не состоится в минуту `at`; null — состоится. Одна проверка на «Ударить» у ворот, на «Дойти и
   * ударить» — при приказе и в минуту прихода — и на карточку.
   */
  private stormBlock(target: GenSettlement, at: number, declared: Fate): string | null {
    // Ни удара, ни штурма за краем своего региона (docs/map_tw.md, 0.−2).
    if (!this.inRealm(target)) return this.beyond();
    // Второй раз сожжённое логово разграбить нельзя, потому что его нет. Это
    // правило мира, а не подсказка панели: кнопки у пепелища и так не бывает.
    if (!this.alive(target, at)) return 'Здесь только пепелище: брать нечего.';
    // Пакт держит и здесь, а не только в панели: правило игры не может стоять
    // на честном слове интерфейса.
    if (standingAt(this.diploOf(target.id, at), at) === 'pact') return 'Пакт в силе, удара не будет. Разрыв объявляет дипломат.';
    // Участь объявляется приказом и проверяется им же.
    return fateBlock(declared, 'world', this.save.burnImmune[target.id], at, this.playerLocks());
  }

  /**
   * «Дойти и ударить» глазами карточки и приказа (решение владельца 06.10.2026): можно ли, сколько идти и хватит ли
   * энергии на штурм к минуте прихода, с дорогой. Город игрока — поход со штурмом с ходу, той же проверкой, что у
   * похода (`warBlock`, `warEnergy`); двор мира — проверки удара (`stormBlock`) и выхода полководца. Стоит у ворот —
   * дороги нет, удар сразу (`attack`). Undefined — бить тут некому или нечего: свой город, пепелище, места полководца нет.
   */
  private assaultOf(target: SettlementId, now: number, declared: Fate = FATE_DEFAULT, mode: AssaultMode = 'storm'): AssaultPlan | undefined {
    const f = this.save.figures.general;
    if (f.gone) return undefined;
    const men = troopTotal(f.troops ?? {});
    const c = this.castleOf(target);
    if (c) {
      const walkMs = Math.round(warWalkMs(this.save.home, c, f.gait) / this.warPaceOf());
      const energy = this.warEnergy(c, mode, now);
      const noCamp = mode === 'siege' ? siegeBlockOf(f.gait) : null;
      const reason = this.warBlock(c, now) ?? noCamp ?? fateBlock(declared, 'player', undefined, now, this.playerLocks()) ?? energy.block;
      const gaits = this.gaitRows((g) => Math.round(warWalkMs(this.save.home, c, g) / this.warPaceOf()), mode, now);
      return { can: reason === null, reason, walkMs, men, energy, gaits };
    }
    const s = this.byId.get(target);
    if (!s || this.phaseOf(s, now) !== 'alive') return undefined;
    const from = this.figureAt(f, now);
    const here = this.touching(from)?.id === target && f.phase !== 'moving';
    const walkMs = here
      ? 0
      : Math.round(realMs(travelTime(distance(from, s), terrainFactor(this.save.seed, from, s), this.speedOf('general'))));
    const energy = this.energyCost('general', mode, now, walkMs);
    const reason = this.assaultBlock(s, here, now, declared, mode) ?? energy.block;
    // Та же дорога в каждом режиме марша (ДР-2): выбор до приказа — теми же функциями, что исполнят приказ.
    const gaits = here
      ? undefined
      : this.gaitRows((g) => Math.round(realMs(travelTime(distance(from, s), terrainFactor(this.save.seed, from, s), this.speedOf('general', g)))), mode, now);
    return { can: reason === null, reason, walkMs, men, energy, ...(gaits ? { gaits } : {}) };
  }

  /**
   * Почему полководцу не дойти и не ударить (`mode` 'storm') или не обложить (`'siege'`) двор мира; null — можно.
   * Энергию проверяет `assaultOf`.
   */
  private assaultBlock(s: GenSettlement, here: boolean, now: number, declared: Fate, mode: AssaultMode = 'storm'): string | null {
    const f = this.save.figures.general;
    const off = this.offDuty('general', now) ?? this.retiringBlock('general');
    if (off) return off;
    const warBusy = this.warGeneralBusy();
    if (warBusy) return warBusy;
    // Из осаждённого своего города не выходят: та же дверь выхода, что у похода и фигуры.
    if (!here && this.touching(this.figureAt(f, now))?.home) {
      const blocked = this.siegeBlock(now);
      if (blocked) return blocked;
    }
    const busy = Math.max(0, (f.busyUntil ?? 0) - now);
    if (busy > 0) return `${this.busyNote('general')}: ${formatLeft(busy / 1000)}.`;
    this.settleHandover(f, now);
    if (f.handover) return `Отряд ещё в сборе: ${formatLeft(Math.max(0, f.handover.until - now) / 1000)}.`;
    if (troopTotal(f.troops ?? {}) === 0) return this.noBand(now);
    // Держит осаду — ударить можно только по тому городу, который держит: это штурм, и он снимает лагерь.
    const besieging = this.ourSiege(now);
    if (besieging && besieging !== s.id) return `${CAMP_BUSY} ${CAMP_LEAVE}`;
    // Под стенами чужой лагерь — бьют по нему, а не по городу: это «Удар по лагерю», свой приказ.
    const camp = this.siegeOf(s.id, now);
    if (camp && !ourCamp(camp)) return 'Под стенами чужой лагерь. Бить нужно по нему.';
    return mode === 'siege' ? this.campBlock(s, now, declared) : this.stormBlock(s, now, declared);
  }

  /**
   * «Дойти и ударить» — одна дверь на логово и на город игрока (решение владельца 06.10.2026). Город игрока — поход со
   * штурмом с ходу: бой посчитает сервер в минуту прихода (`warMarch`). Двор мира — полководец идёт к воротам, цена
   * штурма списывается при приказе (её хватит к приходу, с дорогой), и бой случается в минуту прихода
   * (`assaultArrived`) — онлайн и офлайн одинаково, игрока не ждёт. Стоит у ворот — бьёт сразу (`attack`).
   */
  async assault(target: SettlementId, fateId: Fate = FATE_DEFAULT, mode: AssaultMode = 'storm', ring = false): Promise<string | null> {
    const now = this.clock();
    if (this.castleOf(target)) return this.warMarch(target, mode, fateId, ring && mode === 'siege');
    const plan = this.assaultOf(target, now, fateId, mode);
    if (!plan) return mode === 'siege' ? 'Осаждать тут некого.' : 'Бить тут некого.';
    if (!plan.can) return plan.reason;
    if (plan.walkMs <= 0) return mode === 'siege' ? this.besiege(fateId, ring) : (await this.attack({ fate: fateId })).error;
    const s = this.byId.get(target);
    if (!s) return 'Цель не найдена.';
    const f = this.save.figures.general;
    f.chase = undefined;
    this.walk('general', { x: s.x, y: s.y }, now);
    f.assault = mode === 'siege' ? { id: target, fate: fateId, siege: true, ...(ring ? { blockade: true as const } : {}) } : { id: target, fate: fateId };
    // Цена — при приказе, как у удара по лагерю: бой (или лагерь) случится в минуту прихода, и энергии на него хватит
    // (`assaultOf`).
    this.payEnergy('general', mode, now);
    this.write();
    return null;
  }

  /**
   * Полководец дошёл с приказом «дойти и ударить»: бой в минуту прихода `at`, теми же проверками удара, что у приказа.
   * Цена уже заплачена при приказе. Не вышло — строкой летописи, почему боя не было.
   */
  private assaultArrived(at: number, came: Coord): void {
    const f = this.save.figures.general;
    const order = f.assault;
    f.assault = undefined;
    if (!order) return;
    const target = this.byId.get(order.id);
    const near = this.touching(f.to);
    const camp = target ? this.siegeOf(target.id, at) : null;
    const why = !target || near?.id !== target.id
      ? 'цели на месте нет.'
      : troopTotal(f.troops ?? {}) === 0
        ? 'при полководце нет отряда.'
        : camp && !ourCamp(camp)
          ? 'под стенами чужой лагерь.'
          : order.siege
            ? this.campBlock(target, at, order.fate)
            : this.stormBlock(target, at, order.fate);
    if (why) {
      this.addEffect({
        id: `assault-miss-${at}`,
        lost: {},
        resources: {},
        prestige: 0,
        morale: 0,
        battle: null,
        text: `Полководец дошёл${target ? ` до «${target.name}»` : ''}, но ${order.siege ? 'лагеря не поставил' : 'боя не было'}: ${why[0].toLowerCase()}${why.slice(1)}`,
        good: false,
      });
      return;
    }
    // «Дойти и осадить»: лагерь в минуту прихода, цена уже списана приказом.
    if (order.siege) return this.pitchCamp(target as GenSettlement, at, order.fate, 0, Boolean(order.blockade));
    this.attackAt(target as GenSettlement, at, order.fate, null, came);
  }

  // ---------- Дело агента у цели (Р-4, docs/AGENTS.md, раздел 16) ----------
  //
  // Свободной ходьбы нет (решение владельца 19.10.2026): агент идёт только к цели, делает там дело и сам возвращается
  // домой. Дверь одна — меню `errands` и приказ `errand`. Сами дела исполняют их прежние двери (удар, осада, перехват,
  // удар по лагерю, выручка, разведка, переговоры, дела лазутчика), и числа меню — их же планы: показанное и есть
  // применённое. Какое дело несёт агент, помнит фигура (`StoredFigure.errand`); домой — `errandBack`, как освободится.

  /** Где цель и какого она вида. null — цели нет: двор пропал, отряд ушёл. */
  private errandSpot(t: ErrandTarget, now: number): ErrandSpot | null {
    if (t.kind === 'home' || (t.kind === 'place' && t.id === HOME_ID)) return { kind: 'home', at: { ...this.save.home } };
    if (t.kind === 'march') {
      const m = this.chaseTarget(t.id);
      return m ? { kind: 'march', at: marchPosition(m, now), m } : null;
    }
    const c = this.castleOf(t.id);
    if (c) return { kind: 'rival', at: { x: c.x, y: c.y }, c };
    const s = this.byId.get(t.id);
    return s ? { kind: 'place', at: { x: s.x, y: s.y }, s } : null;
  }

  /** Дорога агента от того места, где он сейчас, до клетки, мс; ближе полуклетки — ноль. */
  private walkMsTo(id: FigureId, to: Coord, now: number): number {
    const from = this.figureAt(this.save.figures[id], now);
    const d = distance(from, to);
    if (d < 0.5) return 0;
    return Math.round(realMs(travelTime(d, terrainFactor(this.save.seed, from, to), this.speedOf(id))));
  }

  /** Дорога домой от клетки дела, мс. */
  private backMsFrom(id: FigureId, at: Coord): number {
    const home = this.save.home;
    const d = distance(at, home);
    if (d < 0.5) return 0;
    return Math.round(realMs(travelTime(d, terrainFactor(this.save.seed, at, home), this.speedOf(id))));
  }

  /**
   * Почему агент сейчас не выйдет по делу; null — выйдет. Те же проверки, что у всякого выхода: в строю, не на покое,
   * не занят прошлым делом, полководец не в походе на игрока, из осаждённого своего города не выходят, без сил из своих
   * ворот не выходят. `home` — дело «домой»: дорога домой открыта всегда.
   */
  private errandBlock(id: FigureId, now: number, home: boolean): string | null {
    const f = this.save.figures[id];
    const off = this.offDuty(id, now) ?? (home ? null : this.retiringBlock(id));
    if (off) return off;
    const warBusy = id === 'general' ? this.warGeneralBusy() : null;
    if (warBusy) return home ? null : warBusy;
    const busy = Math.max(0, (f.busyUntil ?? 0) - now);
    if (busy > 0) return `${this.busyNote(id)}: ${formatLeft(busy / 1000)}.`;
    if (home) return null;
    if (this.touching(this.figureAt(f, now))?.home) {
      const blocked = this.siegeBlock(now);
      if (blocked) return blocked;
      const idle = idleBlock(this.energyNow(id, now), id);
      if (idle) return idle;
    }
    return null;
  }

  /** Гибель полководца условно — «если отряд перебьют до последнего», той же `routPeril`, что решит исход. */
  private routRisk(at: Coord): string {
    return `Если отряд перебьют до последнего, полководец погибнет с шансом ${perilText(perilShare(routPeril(distance(this.save.home, at))))}.`;
  }

  /** Риск лазутчика строками меню: удастся, гибель, сколько держат при провале. */
  private spyRisk(chance: number | null, peril: number | null, held?: number): string[] {
    return [
      chance !== null ? `Удастся: ${Math.round(chance * 100)} %.` : '',
      peril !== null ? `Гибель: ${perilText(peril)}.` : '',
      held !== undefined ? `При провале задержат на ${formatLeft(held)}.` : '',
    ].filter(Boolean);
  }

  async errands(agent: FigureId, t: ErrandTarget): Promise<ErrandOption[]> {
    const now = this.clock();
    const spot = this.errandSpot(t, now);
    if (!spot) return [];
    const rival = spot.kind === 'rival' && agent === 'spy' ? await this.spyMenu(spot.c.id) : null;
    const out: ErrandOption[] = [];
    for (const def of errandsOf(agent, spot.kind)) {
      const o = await this.errandOption(agent, def, spot, now, rival);
      if (o) out.push(o);
    }
    return out;
  }

  /**
   * Строка меню одного дела — планом той двери, что его исполнит. Undefined — дела при этой цели сейчас нет вовсе:
   * удар по лагерю без лагеря, выручка без осады союзника.
   */
  private async errandOption(agent: FigureId, def: ErrandDef, spot: ErrandSpot, now: number, rival: RivalMenu | null): Promise<ErrandOption | undefined> {
    const f = this.save.figures[agent];
    const walkMs = spot.kind === 'march' ? 0 : this.walkMsTo(agent, spot.at, now);
    const base: ErrandOption = {
      id: def.id,
      agent,
      name: def.name,
      does: def.does,
      can: false,
      reason: null,
      walkMs,
      backMs: spot.kind === 'home' ? 0 : this.backMsFrom(agent, spot.at),
      risk: [],
      chance: null,
      cost: {},
      energy: null,
      at: now,
    };
    const row = (reason: string | null, extra: Partial<ErrandOption> = {}): ErrandOption => ({ ...base, ...extra, can: reason === null, reason });
    const id = def.id;

    if (id === 'home') {
      const atHome = f.phase === 'home' || placeOf(f) === 'city';
      const moving = f.phase === 'moving' && this.touching(f.to)?.home;
      return row(this.errandBlock(agent, now, true) ?? (atHome ? `${FIGURE_BY_ID[agent].name} уже дома.` : moving ? 'Уже идёт домой.' : null));
    }

    if (agent === 'general') {
      if ((id === 'storm' || id === 'siege' || id === 'blockade') && (spot.kind === 'place' || spot.kind === 'rival')) {
        const target = spot.kind === 'place' ? spot.s.id : spot.c.id;
        const plan = this.assaultOf(target, now, FATE_DEFAULT, id === 'storm' ? 'storm' : 'siege');
        if (!plan) return row(spot.kind === 'place' && !this.alive(spot.s, now) ? 'Здесь только пепелище: брать нечего.' : 'Бить тут некого.');
        return row(plan.reason, { walkMs: plan.walkMs, energy: plan.energy, risk: [this.routRisk(spot.at)], fate: true });
      }
      if (id === 'intercept' && spot.kind === 'march') {
        const { meet, reason } = this.planChase(spot.m, now);
        return row(meet ? null : reason, {
          walkMs: meet ? Math.max(0, Math.round(meet.time - now)) : 0,
          backMs: meet ? this.backMsFrom(agent, meet.at) : 0,
          energy: meet ? this.energyCost('general', 'chase', now, Math.max(0, meet.time - now)) : null,
          risk: [this.routRisk(meet?.at ?? spot.at)],
        });
      }
      if (id === 'strike' && (spot.kind === 'place' || spot.kind === 'home')) {
        const town = spot.kind === 'place' ? spot.s.id : HOME_ID;
        const camp = this.siegeOf(town, now);
        if (!camp || ourCamp(camp)) return undefined;
        const plan = await this.strikePlan(town, town === HOME_ID, true);
        return row(plan.can ? null : plan.reason, { walkMs: Math.round(realMs(plan.seconds)), energy: plan.energy ?? null, risk: [this.routRisk(spot.at)] });
      }
      if (id === 'relief' && spot.kind === 'rival') {
        const plan = this.reliefPlan(spot.c, now, true);
        if (!plan) return undefined;
        return row(plan.can ? null : plan.reason, { walkMs: Math.round(realMs(plan.seconds)), energy: plan.energy ?? null, risk: [this.routRisk(spot.at)] });
      }
      return undefined;
    }

    if (agent === 'scout') {
      if (id === 'recon' && spot.kind === 'place') {
        const block = this.errandBlock('scout', now, false) ?? (!this.inRealm(spot.s) ? this.beyond() : null) ?? (!this.alive(spot.s, now) ? 'Здесь только пепелище.' : null);
        const energy = this.energyCost('scout', 'recon', now, walkMs);
        const plan = this.scoutPlan(spot.at, now + walkMs);
        const risk = plan.caught > 0 ? [`Часовые схватят: ${Math.round(plan.caught * 100)} %.`, `Гибель: ${perilText(plan.peril)}.`] : [];
        return row(block ?? energy.block, { energy, risk });
      }
      if (id === 'shadow' && spot.kind === 'march') {
        const meet = this.shadowMeet(spot.m, now);
        const block = this.errandBlock('scout', now, false);
        if (!meet) return row(block ?? `Не догнать: им идти ${formatLeft(secondsLeft(spot.m.arriveAt, now))}, дойдут раньше.`);
        const road = Math.max(0, Math.round(meet.time - now));
        const energy = this.energyCost('scout', 'shadow', now, road);
        return row(block ?? energy.block, { walkMs: road, backMs: this.backMsFrom('scout', meet.at), energy });
      }
      return undefined;
    }

    if (agent === 'diplomat') {
      // Дань за снятие осады — у своего города, пока под стенами лагерь (`parley`, docs/siege_v2.md, раздел 7). Дипломат
      // выходит к лагерю у своих ворот: из дома, без дороги.
      if (id === 'ransom') {
        const w = this.homeSiege(now);
        const pvp = w ? null : this.warOnUs();
        if (!w && pvp?.phase !== 'camp') return undefined;
        const block = this.errandBlock('diplomat', now, true) ?? (f.phase !== 'home' && placeOf(f) !== 'city' ? 'Дипломат не дома. Сначала позови его домой.' : null);
        return row(block ?? (w ? this.tributeBlock(w, now, this.homeFair(w, now)) : null));
      }
      if (spot.kind === 'rival' && (id === 'pact' || id === 'unpact')) {
        const energy = this.energyCost('diplomat', id === 'pact' ? 'pact' : 'war', now, walkMs);
        return row(this.errandBlock('diplomat', now, false) ?? (!this.inRealm(spot.at) ? this.beyond() : null) ?? energy.block, { energy });
      }
      // Говорят с державой: у логова её нет, и строк, которые нечем исполнить, меню не показывает.
      if (spot.kind !== 'place' || !spot.s.tribeId) return undefined;
      if (isDeal(id)) {
        const block = this.optionBlock('diplomat', spot.s, now, { road: walkMs }) ?? this.dealBlock(id, spot.s, now, { road: walkMs });
        return row(block, { energy: this.energyCost('diplomat', 'deal', now, walkMs) });
      }
      const o = this.diploOptions(spot.s, now, { road: walkMs }).find((x) => x.id === id);
      if (!o) return undefined;
      const seize = this.relationOf(spot.s) === 'enemy' ? [`Во враждебном дворе схватят: ${Math.round(ENVOY_SEIZE * 100)} %.`] : [];
      return row(o.reason, { chance: o.chance, cost: o.cost, energy: o.energy, risk: [...(o.chance !== null ? [`Согласятся: ${Math.round(o.chance * 100)} %.`] : []), ...seize] });
    }

    // Лазутчик.
    if (spot.kind === 'rival') {
      const o = rival?.options.find((x) => x.deed === id);
      if (!o || !rival) return undefined;
      return row(rival.error ?? o.reason, {
        walkMs: rival.walkMs,
        chance: o.chance,
        energy: o.energy,
        risk: this.spyRisk(o.chance, o.peril, Math.round(o.held / 1000)),
        at: rival.at,
      });
    }
    if (spot.kind !== 'place') return undefined;
    // Бунт поднимают против державы: в логове не против кого (та же причина у `spyOptions`) — строки нет.
    if (id === 'revolt' && !spot.s.tribeId) return undefined;
    if (id === 'watch') {
      return row(this.optionBlock('spy', spot.s, now, { road: walkMs }));
    }
    const o = this.spyOptions(spot.s, now, now + walkMs, { road: walkMs }).find((x) => x.id === id);
    if (!o) return undefined;
    return row(o.reason, { chance: o.chance, energy: o.energy, risk: this.spyRisk(o.chance, o.peril, o.held) });
  }

  /** Где и когда разведчик встретит отряд, выйдя сейчас: то же уравнение погони, что у перехвата (`pursuit`). */
  private shadowMeet(m: StoredMarch, now: number): Meeting | null {
    const from = this.figureAt(this.save.figures.scout, now);
    return meetingOf(from, this.paceOf('scout', from, marchPosition(m, now)), m, now);
  }

  /**
   * Приказ из «Походов»: агент идёт к цели, делает дело и сам возвращается домой. Дело чужого агента, не к той цели или
   * не по меню — отказ: таблица одна (`data/errands`), и спрашивает её мир, а не кнопка. null — пошёл (или сделал, если
   * уже стоял у цели), иначе причина.
   */
  async errand(o: ErrandOrder): Promise<string | null> {
    const now = this.clock();
    const def = errandDef(o.agent, o.deed);
    if (!def) return 'Такого дела у него нет.';
    const spot = this.errandSpot(o.target, now);
    if (!spot) return 'Цели на месте нет.';
    if (!def.on.includes(spot.kind)) return 'Это дело не к этой цели.';
    if (o.fate !== undefined && !has(FATES, o.fate)) return 'Такой участи нет.';
    const fate = o.fate ?? FATE_DEFAULT;
    const id = o.agent;
    const f = this.save.figures[id];

    if (o.deed === 'home') return this.recallFigure(id);
    if (o.deed === 'ransom') {
      const menu = await this.errandOption(id, def, spot, now, null);
      if (!menu) return 'Под стенами никого.';
      return menu.can ? this.parley({ act: 'offer', kind: 'tribute' }) : (menu.reason ?? 'Сейчас нельзя.');
    }

    if (id === 'general') {
      // Состав из окна дела (ДР-6) — тем же переводом, что раскладка; дело, которому мир отказал, возвращает всех в гарнизон.
      const band = this.takeBand(o.troops, now);
      if (typeof band === 'string') return band;
      const err = await this.generalErrand(o.deed, spot, fate);
      if (err) band?.();
      return err;
    }

    // Остальные трое: меню на эту минуту, той же функцией, что показала его, — и путь к цели с оплаченным делом.
    const menu = await this.errandOption(id, def, spot, now, spot.kind === 'rival' && id === 'spy' ? await this.spyMenu(spot.c.id) : null);
    if (!menu) return 'Сейчас этого дела здесь нет.';
    if (!menu.can) return menu.reason ?? 'Сейчас нельзя.';
    // Дела лазутчика против соседа-игрока ведёт сервер войны: туда, дело и домой (docs/spy_pvp.md).
    if (spot.kind === 'rival' && id === 'spy') return this.spyRival(spot.c.id, o.deed as RivalDeedId, o.shownAt ?? menu.at);

    const to = spot.kind === 'march' ? (this.shadowMeet(spot.m, now) ?? null) : null;
    if (spot.kind === 'march' && !to) return 'Не догнать.';
    // Стоит у самой цели — дело сразу, без дороги.
    const here = spot.kind !== 'march' && menu.walkMs === 0 && f.phase !== 'moving';
    if (!here) {
      // Увёл лазутчика с наблюдения — он перестал смотреть (`walk`).
      this.walk(id, to ? clampToWorld(to.at) : { ...spot.at }, now, o.shownAt);
      if (to) f.arriveAt = Math.max(now, Math.round(to.time));
    }
    this.markErrand(id, o.deed, spot);
    const e = f.errand;
    if (e && id === 'spy' && (o.deed === 'probe' || o.deed === 'revolt') && spot.kind === 'place') {
      // Шанс и гибель — на минуту прихода, какими их видел игрок: применяется ровно показанное.
      const shown = this.shownAt(o.shownAt, now);
      const opt = this.spyOptions(spot.s, now, shown + (here ? 0 : f.arriveAt - now), { road: menu.walkMs }).find((x) => x.id === o.deed);
      e.chance = opt?.chance ?? menu.chance ?? 0;
      e.peril = opt?.peril ?? 0;
      e.why = opt?.perilWhy ?? [];
    }
    const price = errandPrice(o.deed);
    if (price) this.payEnergy(id, price, now);
    if (here && id === 'scout' && spot.kind === 'place') this.save.intel[spot.s.id] = this.snapshot(spot.s, now);
    else if (here) this.errandArrived(id, now);
    this.write();
    return null;
  }

  /** Дело полководца у цели — его дверями; отряд уже при нём (`takeBand`). null — пошёл или ударил, иначе отказ. */
  private async generalErrand(deed: ErrandId, spot: ErrandSpot, fate: Fate): Promise<string | null> {
    if (spot.kind === 'rival') {
      if (deed === 'relief') return this.relief(spot.c.id, true);
      // Город игрока: поход ведёт сервер войны, и домой полководца ведёт он же.
      return this.warMarch(spot.c.id, deed === 'storm' ? 'storm' : 'siege', fate, deed === 'blockade');
    }
    let err: string | null = 'Это дело не к этой цели.';
    if ((deed === 'storm' || deed === 'siege') && spot.kind === 'place') err = await this.assault(spot.s.id, fate, deed);
    // Блокада — та же осада с кольцом в минуту постановки (Р-5).
    else if (deed === 'blockade' && spot.kind === 'place') err = await this.assault(spot.s.id, fate, 'siege', true);
    else if (deed === 'intercept' && spot.kind === 'march') err = await this.intercept(spot.m.id);
    else if (deed === 'strike' && (spot.kind === 'place' || spot.kind === 'home')) {
      const town = spot.kind === 'place' ? spot.s.id : HOME_ID;
      err = await this.strikeCamp(town, town === HOME_ID, true);
    }
    if (err) return err;
    this.markErrand('general', deed, spot);
    this.write();
    return null;
  }

  /** Отметить на фигуре дело, которое она несёт к цели. */
  private markErrand(id: FigureId, deed: ErrandId, spot: ErrandSpot): void {
    const target = spot.kind === 'place' ? spot.s.id : spot.kind === 'rival' ? spot.c.id : spot.kind === 'march' ? spot.m.id : HOME_ID;
    this.save.figures[id].errand = { deed, target, since: this.clock() };
  }

  /**
   * Агент дошёл с делом из «Походов» — дело в минуту прихода `at`, ценой, уже списанной приказом. Удар, осада, перехват
   * и удар по лагерю полководца случаются своими дверями (`assaultArrived`, `resolveChase`, `resolveStrike`), разведка у
   * ворот — приходом разведчика (`onFigureArrived`); здесь — то, у чего своей двери прихода нет.
   */
  private errandArrived(id: FigureId, at: number): void {
    const f = this.save.figures[id];
    const e = f.errand;
    if (!e || f.phase === 'down' || f.gone || id === 'general' || (id === 'scout' && e.deed === 'recon')) return;
    if (id === 'scout' && e.deed === 'shadow') return this.shadowArrived(at);
    if (id === 'spy' && e.deed === 'watch') {
      f.watching = true;
      return;
    }
    if (id === 'diplomat' && this.castleOf(e.target)) {
      // Предложение соседу-игроку передаёт сервер войны: на ближайшем пульсе (`sendEnvoy`), дипломат ждёт у ворот.
      e.send = true;
      return;
    }
    const s = this.byId.get(e.target);
    const near = this.touching(this.figureAt(f, at));
    const why = !s || near?.id !== s.id ? 'цели на месте нет.' : !this.alive(s, at) ? 'здесь только пепелище.' : null;
    if (!s || why) {
      this.errandMiss(id, s?.name ?? null, why ?? 'цели на месте нет.', at);
      return;
    }
    if (id === 'spy' && (e.deed === 'probe' || e.deed === 'revolt')) {
      const opt = this.spyOptions(s, at, at, 'paid').find((x) => x.id === e.deed);
      if (opt && !opt.can) return this.errandMiss(id, s.name, opt.reason ?? 'дела не вышло.', at);
      this.spyOrder(e.deed, s, at, e.chance ?? opt?.chance ?? 0, e.peril ?? 0, e.why ?? []);
      return;
    }
    if (id === 'diplomat' && isDeal(e.deed)) {
      const blocked = this.dealBlock(e.deed, s, at, 'paid');
      if (blocked) return this.errandMiss(id, s.name, blocked, at);
      this.dealAt(e.deed, s, at);
      return;
    }
    if (id === 'diplomat') {
      const opt = this.diploOptions(s, at, 'paid').find((x) => x.id === e.deed);
      if (!opt) return;
      if (!opt.can) return this.errandMiss(id, s.name, opt.reason ?? 'разговора не вышло.', at);
      this.diploOrder(e.deed as DiploActionId, s, at, opt);
    }
  }

  /** Дошёл, но дела не вышло — донесением и строкой летописи, почему; домой он пойдёт и так. */
  private errandMiss(id: FigureId, name: string | null, why: string, at: number): void {
    const text = `${FIGURE_BY_ID[id].name} дошёл${name ? ` до «${name}»` : ''}, но дела не было: ${why[0].toLowerCase()}${why.slice(1)}`;
    const spot = this.figureAt(this.save.figures[id], at);
    this.addReport({
      id: `errand-miss-${id}-${at}`,
      at,
      kind: id === 'diplomat' ? 'support' : 'scout',
      title: `${FIGURE_BY_ID[id].name}: дела не было`,
      target: { id: HOME_ID, name: name ?? this.homeName(), x: Math.round(spot.x), y: Math.round(spot.y) },
      won: false,
      sent: {},
      lost: {},
      enemyPower: null,
      enemyLost: null,
      loot: null,
      intel: null,
      battle: null,
      text,
      read: false,
    });
    this.addEffect({
      id: `errand-miss-${id}-${at}-eff`,
      lost: {},
      resources: {},
      prestige: 0,
      morale: 0,
      battle: null,
      text,
      good: false,
    });
  }

  /** Разведчик встретил отряд в поле (или не встретил): донесение — кто, сколько, куда и когда дойдут. */
  private shadowArrived(at: number): void {
    const f = this.save.figures.scout;
    const e = f.errand;
    const m = e ? this.chaseTarget(e.target) : null;
    const here = this.figureAt(f, at);
    const spot = { x: Math.round(here.x), y: Math.round(here.y) };
    const met = m !== null && distance(here, marchPosition(m, at)) <= FIGURE_TOUCH;
    const men = m ? stackSize(m.units) : 0;
    this.addReport({
      id: `shadow-${e?.target ?? 'lost'}-${at}`,
      at,
      kind: 'scout',
      title: met && m ? `Отряд сочтён: ${m.fromName}` : 'Отряд не встретил',
      target: m ? { id: m.fromId, name: m.fromName, x: spot.x, y: spot.y } : { id: HOME_ID, name: this.homeName(), x: spot.x, y: spot.y },
      won: met,
      sent: {},
      lost: {},
      enemyPower: met && m ? Math.round(m.power) : null,
      enemyLost: null,
      loot: null,
      intel: null,
      battle: null,
      text:
        met && m
          ? `${m.fromName}: бойцов ${men}, идут на ${m.toName}, дойдут через ${formatLeft(secondsLeft(m.arriveAt, at))}.`
          : 'Отряд ушёл раньше или свернул. Разведчик вернётся домой.',
      read: false,
    });
    if (met) {
      this.addEffect({
        id: `shadow-${e?.target ?? 'lost'}-${at}-eff`,
        lost: {},
        resources: {},
        prestige: 0,
        morale: 0,
        battle: null,
        deed: { agent: 'scout', ok: true, at, person: f.person ?? 0 },
        text: '',
        good: true,
      });
    }
  }

  /**
   * Дипломат у замка соседа-игрока передаёт союз или его разрыв серверу войны — на пульсе после прихода: приказ серверу
   * асинхронный, а ход фигур — нет. Ответ сервера — донесением; дальше дипломат идёт домой.
   */
  private async sendEnvoy(now: number): Promise<void> {
    const f = this.save.figures.diplomat;
    const e = f.errand;
    if (!e?.send || f.phase !== 'field') return;
    const c = this.castleOf(e.target);
    const off = e.deed === 'unpact';
    const err = c ? await this.warSend(off ? { op: 'unpact', target: e.target } : { op: 'pact', target: e.target }) : 'Соседа нет на месте.';
    const city = c ? cityOr(c.city) : 'сосед';
    e.send = undefined;
    this.addReport({
      id: `envoy-${e.target}-${e.deed}-${now}`,
      at: now,
      kind: 'support',
      title: `${off ? 'Разрыв союза' : 'Союз'}: ${city}`,
      target: { id: e.target, name: city, x: Math.round(f.to.x), y: Math.round(f.to.y) },
      won: err === null,
      sent: {},
      lost: {},
      enemyPower: null,
      enemyLost: null,
      loot: null,
      intel: null,
      battle: null,
      text: err ?? (off ? 'Дипломат передал разрыв: союза больше нет.' : 'Дипломат передал предложение союза. Согласится ли сосед, решит он сам.'),
      read: false,
    });
    this.write();
  }

  /**
   * Дело кончилось — домой, как освободится: с минуты прихода, а занятый на переговорах, отлёживающийся после дела или
   * задержанный — с минуты, когда отпустят. Наблюдение держится, пока его не снимут («Домой»); осада — пока стоит наш
   * лагерь; выбитый из строя и выбившийся из сил идут домой своими дверями. Онлайн и офлайн — одна дорога: минута
   * выхода выведена из отметок, а не из пульса.
   */
  private errandBack(id: FigureId, now: number): void {
    const f = this.save.figures[id];
    const e = f.errand;
    if (!e) return;
    if (f.gone || f.phase === 'down' || f.phase === 'home' || placeOf(f) === 'city' || f.spent !== undefined) {
      f.errand = undefined;
      return;
    }
    if (f.phase === 'moving' || e.send) return;
    if (id === 'general' && (f.war || f.chase || f.strike || f.assault)) return;
    if (id === 'general' && (e.deed === 'siege' || e.deed === 'blockade') && this.ourSiege(now)) return;
    if (id === 'spy' && e.deed === 'watch' && f.watching) return;
    // Осада и наблюдение кончаются не минутой прихода, а приказом или падением города: домой — с этого пульса.
    const free = e.deed === 'siege' || e.deed === 'blockade' || e.deed === 'watch' ? now : Math.max(e.since ?? 0, f.departAt, f.busyUntil ?? 0, f.energy?.at ?? 0);
    if (free > now) return;
    f.errand = undefined;
    this.walk(id, { ...this.save.home }, free);
  }

  /**
   * Отступить из-под стен: полководец остаётся, где стоял, лагерь снимается. Тот же
   * `leaveCamp`, что у приказа увести полководца, — второго способа снять свою осаду нет.
   */
  async retreat(): Promise<string | null> {
    const now = this.clock();
    const id = this.ourSiege(now);
    if (!id) {
      const led = this.warLed();
      return led?.phase === 'camp' ? this.warSend({ op: 'retreat', id: led.id }) : 'Лагеря нет.';
    }
    this.leaveCamp(id, now);
    this.write();
    return null;
  }

  /**
   * Поделить древесину лагеря между фронтом и тылом: доля фронту — одна из
   * `WOOD_SHARES`. Вложенное к этой минуте остаётся вложенным (`works.rebaseWood`):
   * смена долей меняет только то, как стороны растут дальше.
   */
  async setWood(share: number): Promise<string | null> {
    const now = this.clock();
    const id = this.ourSiege(now);
    const w = id ? this.save.sieges[id] : null;
    if (!w) return this.warLed()?.phase === 'camp' ? WOOD_FIXED : 'Лагеря нет.';
    if (!WOOD_SHARES.includes(share)) return 'Такой доли нет.';
    if (woodShare(w.wood) === share) return 'Лагерь и так рубит так.';
    w.wood = rebaseWood(siegeSince(w), now, w.wood, share);
    this.write();
    return null;
  }

  /**
   * Доля древесины лагеря осадным машинам (docs/siege_v2.md, 4.3): одна из `MACHINE_SHARES`. Вложенное остаётся вложенным
   * (`works.rebaseWood`) — и в рогатках, и в машинах. Лагерь под городом игрока — приказом серверу войны, той же дверью.
   */
  async setMachineWood(share: number): Promise<string | null> {
    const now = this.clock();
    if (!MACHINE_SHARES.includes(share)) return 'Такой доли нет.';
    const id = this.ourSiege(now);
    const w = id ? this.save.sieges[id] : null;
    if (!w) {
      const led = this.warLed();
      return led?.phase === 'camp' ? this.warSend({ op: 'wood', id: led.id, machines: share }) : 'Лагеря нет.';
    }
    if (Math.abs(machineShare(w.wood) - share) < 1e-9) return 'Лагерь и так рубит так.';
    w.wood = rebaseWood(siegeSince(w), now, w.wood, woodShare(w.wood) ?? WOOD_SHARES[0], share);
    this.write();
    return null;
  }

  /**
   * Заказать осадную машину в своём лагере (`world/machines`): строится очередью из древесины машин. У двора мира стены нет —
   * лестницы, таран и башня не к чему, камнемёт бьёт по кости фазы. Лагерь под городом игрока — приказом серверу.
   */
  async orderMachine(id: MachineId): Promise<string | null> {
    const now = this.clock();
    if (!MACHINE_IDS.includes(id)) return 'Такой машины нет.';
    const sid = this.ourSiege(now);
    const w = sid ? this.save.sieges[sid] : null;
    if (!w) {
      const led = this.warLed();
      return led?.phase === 'camp' ? this.warSend({ op: 'machine', id: led.id, machine: id }) : 'Лагеря нет.';
    }
    const why = machineBlock(w, id, now, false);
    if (why) return why;
    w.machines = machineAfter(w, id, now);
    this.write();
    return null;
  }

  /**
   * Цель артиллерии своего лагеря (Р-5, `world/shelling`): стены, город или машины на стене — дело с минутой в журнале окна,
   * и бросок фазы читает его задним числом. Энергии не стоит: машины бьют сами, полководец только указывает. Лагерь под
   * городом игрока — приказом серверу войны той же дверью.
   */
  async aimArtillery(aim: Aim): Promise<string | null> {
    const now = this.clock();
    if (!AIMS.includes(aim)) return 'Такой цели нет.';
    const sid = this.ourSiege(now);
    const w = sid ? this.save.sieges[sid] : null;
    if (!w) {
      const led = this.warLed();
      return led?.phase === 'camp' ? this.warSend({ op: 'aim', id: led.id, aim }) : 'Лагеря нет.';
    }
    const why = aimBlock(w, aim, now);
    if (why) return why;
    w.log = [...(w.log ?? []), { at: now, act: 'aim', aim }];
    this.write();
    return null;
  }

  /**
   * Кольцо блокады своего лагеря (Р-5, `world/blockade`): замкнуть — если лагерь вчетверо мощнее гарнизона и кольцо не
   * прорвали в этой фазе; разомкнуть — когда угодно. Лагерь под городом игрока — приказом серверу войны.
   */
  async blockade(on: boolean): Promise<string | null> {
    const now = this.clock();
    const sid = this.ourSiege(now);
    const w = sid ? this.save.sieges[sid] : null;
    if (!w || !sid) {
      const led = this.warLed();
      return led?.phase === 'camp' ? this.warSend({ op: 'blockade', id: led.id, on }) : 'Лагеря нет.';
    }
    const camp = this.campArmy(w, now);
    if (!camp) return 'Лагеря нет.';
    if (!on) {
      if (!blockadeAt(w, now)) return 'Кольцо и так разомкнуто.';
      Object.assign(w, blockadeAfter(w, now, false, 'order'));
      this.ringNote(sid, w, now, false, 'order');
    } else {
      const why = blockadeBlock(w, now, camp.power, this.garrisonPower(sid, now));
      if (why) return why;
      Object.assign(w, blockadeAfter(w, now, true));
      this.ringNote(sid, w, now, true);
    }
    this.write();
    return null;
  }

  /**
   * Вылазка «прорвать блокаду» (Р-5): вышедшие из ворот бьются с постом кольца — четвертью лагеря (`BREAKOUT_SHARE`) — в
   * поле, без рогаток, той же дверью, что вылазка на машину (`fights.machineFight`). Победа размыкает кольцо; лагерь стоит
   * в любом случае. Под лагерем игрока — приказом серверу войны.
   */
  async breakout(troops: TroopStack): Promise<AttackResult> {
    const now = this.clock();
    const w = this.homeSiege(now);
    const held = this.defenders(now);
    const home = held.all;
    const going = pickTroops(troops, home);
    if (!going) return { error: 'Столько бойцов дома нет.', reportId: null, won: false };
    if (troopTotal(going) === 0) return { error: 'Отряд пустой.', reportId: null, won: false };
    if (!w) {
      const pvp = this.warOnUs();
      if (!pvp?.camp) return { error: 'Под стенами никого.', reportId: null, won: false };
      if (!blockadeAt(pvp.camp as unknown as SiegeWindow, now)) return { error: 'Кольца нет — прорывать нечего.', reportId: null, won: false };
      const err = await this.warSend({ op: 'breakout', id: pvp.id, troops: going as Counts });
      return err ? { error: err, reportId: null, won: false } : { error: null, ...this.warReportOf(pvp.id) };
    }
    if (!blockadeAt(w, now)) return { error: 'Кольца нет — прорывать нечего.', reportId: null, won: false };
    const camp = this.campArmy(w, now);
    if (!camp) return { error: 'Лагеря под стенами уже нет.', reportId: null, won: false };
    const seed = marchSeed(this.save.seed, this.save.nextMarch++);
    const goingStanding = standingShare(held.own, held.standing, going);
    const rest = mixRest([
      { rest: this.garrisonRest(held.own, now), men: this.menOf(troopsAfter(going, goingStanding)) },
      { rest: this.generalRest(now), men: this.menOf(goingStanding) },
    ]);
    const guard = guardKinds(camp.kinds, BREAKOUT_SHARE);
    const { field } = machineFight({
      seed,
      guard: { kinds: guard, resolve: camp.resolve, pips: camp.pips, flanks: camp.flanks, rest: camp.rest, spirit: camp.spirit },
      sortie: { kinds: kindsOf(going), rest },
      spirit: this.ownSpirit(),
      pips: this.homePips(now),
      ...this.homeFlanks(now),
      scars: this.ownScars(),
      ground: groundAt(this.save.seed, this.save.home),
      // Место и час для черт (ДР-4): своя деревня, прорыв кольца — осадный бой.
      where: this.whereAt(this.save.home, true),
    });
    const lostTroops = field.result ? troopLosses(going, field.result.sides.attacker.losses) : {};
    const lostMen = troopTotal(lostTroops);
    if (field.result) this.homeBack(held, going, lostTroops, field.rest.attacker, now, 1);
    const standing = this.standingLost(held.own, held.standing, lostTroops);
    // Дрался пост, а не весь лагерь: убыль лагеря — его потери, доля поста.
    const campLost = this.wearCamp(w, field.defenderLoss * BREAKOUT_SHARE, now, 'Гарнизон вышел на пост кольца.');
    if (this.save.sieges[HOME_ID] === w) {
      if (field.won) {
        Object.assign(w, blockadeAfter(w, now, false, 'sortie'));
        this.ringNote(HOME_ID, w, now, false, 'sortie');
      } else this.ringCheck(HOME_ID, w, now);
    }
    const record: BattleRecord | null = field.result
      ? { us: 'attacker', result: field.result, troops: { attacker: { ...going }, defender: troopsOfKinds(guard, camp.gear) }, place: this.placeOf(this.save.home), site: 'sortie' }
      : null;
    const reportId = `breakout${seed}`;
    this.addReport({
      id: reportId,
      at: now,
      kind: 'defense',
      title: field.won ? `Кольцо прорвано: ${camp.name}` : `Вылазка на кольцо отбита: ${camp.name}`,
      target: { id: HOME_ID, name: this.homeName(), x: this.save.home.x, y: this.save.home.y },
      won: field.won,
      sent: { warrior: troopTotal(going) },
      lost: lostMen > 0 ? { warrior: lostMen } : {},
      enemyPower: Math.round(camp.power * BREAKOUT_SHARE),
      enemyLost: campLost,
      loot: null,
      intel: null,
      battle: record,
      text: field.won
        ? `Гарнизон вышел на пост кольца и сбил его. Кольцо разомкнуто: добыча и караваны снова идут, лагерь стоит. Замкнуть снова он сможет со следующей фазы.`
        : `Пост кольца устоял. Кольцо замкнуто, лагерь потерял ${campLost}.`,
      read: false,
    });
    this.addEffect({
      id: `${reportId}-eff`,
      lost: lostMen > 0 ? { warrior: lostMen } : {},
      lostTroops,
      ...(troopTotal(standing) > 0 ? { standing } : {}),
      resources: {},
      prestige: field.won ? 2 : 0,
      morale: field.won ? 4 : -3,
      battle: field.won ? 'won' : 'lost',
      ...scarOf(field, 'attacker'),
      text: field.won ? 'Вылазка прорвала кольцо.' : 'Вылазка на кольцо отбита.',
      good: field.won,
    });
    if (this.save.sieges[HOME_ID] === w) this.resiege(HOME_ID, now);
    this.write();
    return { error: null, reportId, won: field.won };
  }

  /**
   * Дело полководца в своём лагере (`world/siegecraft`): укрепить лагерь или обстрелять город. Предел за осаду и цена в
   * энергии — те же проверки, что в меню (`craftMenu`); цена списывается один раз, вместе со счётчиком в окне осады. Лагерь
   * под городом игрока — приказом серверу войны: там проверит и спишет он, той же дверью.
   */
  async campCraft(act: CraftAct): Promise<string | null> {
    const now = this.clock();
    if (!CRAFT_ACTS.includes(act)) return 'Такого дела нет.';
    const id = this.ourSiege(now);
    const w = id ? this.save.sieges[id] : null;
    if (!w) {
      const led = this.warLed();
      return led?.phase === 'camp' ? this.warSend({ op: 'craft', id: led.id, act }) : 'Лагеря нет.';
    }
    const block = craftBlock(w, act, now) ?? this.energyCost('general', act, now).block;
    if (block) return block;
    this.payEnergy('general', act, now);
    Object.assign(w, craftAfter(w, act, now));
    this.write();
    return null;
  }

  /** Дела в лагере глазами меню: что даст следующее, предел и цена — теми же проверками, что у приказа. */
  private craftMenu(w: SiegeWindow, now: number, walls: boolean): CraftOption[] {
    return CRAFT_ACTS.map((act) => {
      const energy = this.energyCost('general', act, now);
      const reason = craftBlock(w, act, now) ?? energy.block;
      return {
        act,
        name: ENERGY_PRICE[act].name,
        done: craftDone(w, act, now),
        max: craftMax(act),
        gain: craftGain(w, act, now, walls),
        energy,
        can: reason === null,
        reason,
      };
    });
  }

  /** Строка «что сделано в лагере» для окна осады: нет дел — нет поля. `walls` — есть ли у города стена (у логова нет). */
  private craftNoteOf(w: SiegeWindow, walls: boolean): { craftNote?: string } {
    const note = craftNote(craftAt(w), walls);
    return note ? { craftNote: note } : {};
  }

  /** Окно осаждающего: наш лагерь под чужим городом. null — лагеря нет. */
  async camp(): Promise<CampView | null> {
    const now = this.clock();
    const id = this.ourSiege(now);
    // Лагеря под логовом нет — может стоять лагерь под городом игрока (docs/pvp.md).
    if (!id) return this.warCampView(now);
    const w = this.siegeOf(id, now);
    const s = this.byId.get(id);
    if (!w || !s) return null;
    const reading = readIntel(this.save.intel[id] ?? null, now);
    const power = reading ? reading.power : { ...UNKNOWN };
    // Выручка соседей, идущая на лагерь, — та, что видна по донесению (`visibleMarches`, `onCamp`).
    const relief = this.visibleMarches(now).find((m) => onCamp(m, id));
    return {
      byId: w.byId,
      byName: 'Наша дружина',
      since: siegeSince(w),
      starvesAt: this.hunger(w),
      // Гарнизон — той же точностью, что мощь: точное число знает только разведка (docs/siege_audit.md, решение 10).
      garrison: estimate(w.garrisonAtStart, power.precision),
      foodAtStart: w.foodAtStart,
      campMen: this.campArmy(w, now)?.men ?? 0,
      builders: this.buildersOf(w, now),
      ...(w.gateAt !== undefined ? { gateAt: w.gateAt } : {}),
      ...(w.rearGateAt !== undefined ? { rearGateAt: w.rearGateAt } : {}),
      ...(w.wood !== undefined ? { wood: w.wood } : {}),
      fate: this.fateFor(w.fate, id, now),
      targetId: id,
      targetName: s.name,
      castle: s.castle,
      lair: isLair(s),
      stage: this.view(s, now, this.sightDiscs(now)).stage,
      power,
      fates: this.fateOptions(s, now),
      men: troopTotal(this.save.figures.general.troops ?? {}),
      // Штурм из лагеря — бой: его цена в энергии полководца (docs/agent_energy.md); в лагере энергия стояла.
      storm: this.energyCost('general', 'storm', now),
      // У двора мира стены нет: обстрел бьёт только по духу гарнизона (стена-проход — только у города игрока).
      crafts: this.craftMenu(w, now, false),
      ...this.craftNoteOf(w, false),
      machines: this.machinesView(w, now, false),
      phases: this.phasesView(w, now, true),
      parley: this.parleyAtk(w, now, this.fateFor(w.fate, id, now), this.campFair(s, w, now)),
      // Р-5: цель артиллерии и кольцо блокады. Гарнизон видно со стены лагеря — кольцо меряется им (`garrisonPower`).
      aim: this.aimView(w, now),
      blockade: this.blockadeView(w, now, this.campArmy(w, now)?.power ?? 0, this.garrisonPower(id, now), true),
      ...(relief ? { relief: { from: relief.fromName, men: Math.round(relief.units.warrior ?? 0), at: relief.arriveAt, joint: false } } : {}),
      // Мораль нашего лагеря — дружины. Мораль чужого гарнизона — живые данные, а живого обзора у полководца нет.
      ...this.restViews(this.campRestView(w, now), undefined),
    };
  }

  /**
   * Население чужого двора — сколько о нём знает игрок: разведка, потом собственные
   * глаза, иначе ничего. Одно правило на карточку и на строки выбора участи.
   */
  private popEstimate(s: GenSettlement, now: number): Estimate {
    const reading = readIntel(this.save.intel[s.id] ?? null, now);
    if (reading?.pop) return reading.pop;
    const view = this.view(s, now, this.sightDiscs(now));
    return view.seenPop !== null ? estimate(view.seenPop, view.visible ? 'exact' : 'rough') : { ...UNKNOWN };
  }

  /**
   * Строки выбора участи против чужого двора: что получит победитель. Считает та же
   * дверь, что и взятие (`fateOf`), конвоем дружины, что при полководце, и
   * населением, какое игрок знает: неточно известное — вилкой, неизвестное — до
   * предела конвоя. Добра здесь не называют: чужой склад знает разведка, и строка
   * говорит только, на сколько меньше увезут из-за людей.
   */
  private fateOptions(s: GenSettlement, now: number): FateOption[] {
    const men = troopTotal(this.save.figures.general.troops ?? {});
    // Конвой — той же дверью, что у взятия: строка выбора и сам увод не расходятся.
    const escort = this.haul({ warrior: men }, true).escort;
    const est = this.popEstimate(s, now);
    const [lo, hi] =
      est.precision === 'exact' && est.value !== null
        ? [est.value, est.value]
        : est.precision === 'unknown'
          ? [0, Number.MAX_SAFE_INTEGER]
          : [est.min, est.max];
    return FATE_IDS.map((id) => {
      const at = (pop: number): FateResult => this.fateOf(s, now, Infinity, this.bondedAt(pop), escort, id, pop);
      const min = at(lo);
      const max = at(hi);
      const reason = fateBlock(id, 'world', this.save.burnImmune[s.id], now, this.playerLocks());
      return {
        id,
        can: reason === null,
        reason,
        led: { min: min.ledBonded.taken + min.ledPop.taken, max: max.ledBonded.taken + max.ledPop.taken },
        less: { min: min.lessGoods, max: max.lessGoods },
      };
    });
  }

  async negotiate(deal: DealId): Promise<string | null> {
    const now = this.clock();
    const f = this.save.figures.diplomat;
    const off = this.offDuty('diplomat', now) ?? this.retiringBlock('diplomat');
    if (off) return off;
    if (f.phase === 'moving') return 'Дипломат ещё в пути.';
    const near = this.touching(this.figureAt(f, now));
    const target = near && !near.home ? this.byId.get(near.id) : null;
    if (!target) return 'Рядом нет чужого города.';
    const blocked = this.dealBlock(deal, target, now);
    if (blocked) return blocked;
    // Договор — переговоры: цена в энергии дипломата (docs/agent_energy.md).
    this.payEnergy('diplomat', 'deal', now);
    this.dealAt(deal, target, now);
    this.write();
    return null;
  }

  /**
   * Почему договор с державой двора не подпишут; null — подпишут. `road` — дело из «Походов»: энергии должно хватить к
   * минуте прихода, с дорогой; `'paid'` — в минуту прихода, цену уже списал приказ.
   */
  private dealBlock(deal: DealId, target: GenSettlement, now: number, mode?: OptionMode): string | null {
    if (!target.tribeId) return 'С варварами не договариваются.';
    const def = DEAL_BY_ID[deal];
    const hostility = this.hostilityOf(target.tribeId);
    if (hostility > def.maxHostility) {
      return `Слишком много обид: вражда ${Math.round(hostility)}, нужна не выше ${def.maxHostility}.`;
    }
    return mode === 'paid' ? null : this.energyCost('diplomat', 'deal', now, roadOf(mode)).block;
  }

  /** Договор подписан в минуту `now`: срок, отношения со всеми дворами державы, донесение. Проверки — `dealBlock`. */
  private dealAt(deal: DealId, target: GenSettlement, now: number): void {
    if (!target.tribeId) return;
    const def = DEAL_BY_ID[deal];
    const tribe = this.save.pacts[target.tribeId] ?? (this.save.pacts[target.tribeId] = {});
    tribe[deal] = { until: now + DEAL_DURATION, paidAt: now };
    // Подпись греет отношения со всеми дворами племени: враждебность племени —
    // это среднее по ним, и снижать её отдельным числом больше нечего.
    for (const other of this.gen.settlements) {
      if (other.tribeId === target.tribeId) this.moveAttitude(other.id, def.hostilityDrop, now);
    }
    const name = this.tribeName(target.tribeId) ?? target.name;
    this.addReport({
      id: `deal-${target.tribeId}-${deal}-${now}`,
      at: now,
      kind: 'support',
      title: `${def.name}: ${name}`,
      target: { id: target.id, name: target.name, x: target.x, y: target.y },
      won: true,
      sent: {},
      lost: {},
      enemyPower: null,
      enemyLost: null,
      loot: null,
      intel: null,
      battle: null,
      text: `Дипломат договорился: ${def.name.toLowerCase()}. ${def.description}`,
      read: false,
    });
    this.addEffect({
      id: `deal-${target.tribeId}-${deal}-${now}-eff`,
      lost: {},
      resources: {},
      prestige: 3,
      morale: 3,
      battle: null,
      text: `Договор с державой ${name}: ${def.name.toLowerCase()}.`,
      good: true,
    });
  }

  // ---------- Приказы дипломата ----------

  /**
   * Что придётся отдать за приказ. Считается от размера двора, а не константой:
   * большому поселению мелочь не подаришь, и вира с него больше. Платим тем,
   * что здесь в цене, — тем же списком, каким отсюда берут добычу.
   */
  private orderCost(action: DiploActionId, s: GenSettlement, now: number): Loot {
    const per = action === 'gift' ? GIFT_PER_POP : action === 'peace' ? PEACE_PER_POP : 0;
    if (per <= 0) return {};
    const total = Math.max(1, Math.round(this.popNow(s, now) * per));
    // Виды складываются ровно в итог (`letters.splitLoot`, ECO-7): прежде каждый вид округлялся отдельно.
    return splitLoot(total, s.lootMix);
  }

  /**
   * Сколько добра не хватает на складе. Ноль — хватает.
   *
   * Считается по `stock` — по всему складу, а не по тому, что видно набегу:
   * тайник прячет добро от чужаков, а не от вождя, и платят из него наравне с
   * остальным. Второе, ради чего это важно: ровно это число игрок видит в
   * полоске ресурсов и в строке «нужно / из» под письмом. Считай мы по
   * `resources`, полоска говорила бы «55 еды», а кнопка гасла бы с «не
   * хватает» — и понять это было бы нечем.
   */
  private shortOf(cost: Loot): number {
    const p = this.save.profile;
    const have = p?.stock ?? {};
    let short = 0;
    for (const [r, n] of Object.entries(cost) as [keyof Loot, number][]) {
      short += Math.max(0, (n ?? 0) - (have[r] ?? 0));
    }
    return short;
  }

  /**
   * Общий отказ строки меню: у ворот (`agentBlock`), в пути к цели делом (`errandBlock` — дойти ему ещё предстоит) или в
   * минуту прихода с оплаченным делом (`'paid'`: стоит у ворот, цену списал приказ).
   */
  private optionBlock(id: FigureId, target: GenSettlement, now: number, mode?: OptionMode): string | null {
    if (typeof mode !== 'object') return this.agentBlock(id, target, now);
    return this.errandBlock(id, now, false) ?? (!this.inRealm(target) ? this.beyond() : null) ?? (!this.alive(target, now) ? 'Здесь только пепелище.' : null);
  }

  /**
   * Почему агент сейчас не может приказывать по этой цели. null — может.
   * Одна проверка на всех: дошёл, не выбыл, не занят прошлым делом.
   */
  private agentBlock(id: FigureId, target: GenSettlement, now: number): string | null {
    const f = this.save.figures[id];
    const def = FIGURE_BY_ID[id];
    const off = this.offDuty(id, now) ?? this.retiringBlock(id);
    if (off) return off;
    // Приказ — только у цели в своём регионе (docs/map_tw.md, 0.−2): карточка места за краем приказов не даёт.
    if (!this.inRealm(target)) return this.beyond();
    if (f.phase === 'moving') return `${def.name} ещё в пути.`;
    if (this.touching(this.figureAt(f, now))?.id !== target.id) {
      return `Доведи ${def.one} до ворот.`;
    }
    // На пепелище работать не с кем: ни выведывать, ни дарить, ни бунтовать.
    // Отказ с причиной, а не молчаливо погашенная кнопка.
    if (!this.alive(target, now)) return 'Здесь только пепелище.';
    const busy = Math.max(0, (f.busyUntil ?? 0) - now);
    if (busy > 0) return `${this.busyNote(id)}: ${formatLeft(busy / 1000)}.`;
    // Наблюдатель не работает, и это не подпорка интерфейса, а само правило:
    // живой обзор за пределами круга даёт один лазутчик, и платит он за это
    // тем, что смотрит вместо того, чтобы делать. Отказ — с причиной и с тем,
    // что надо сделать, а не молчаливо погашенная кнопка.
    if (id === WATCHER && f.watching) {
      return 'Лазутчик наблюдает. Сними наблюдение, потом приказывай.';
    }
    return null;
  }

  /** Чем занят агент — словами. Задержание и своё дело — разные вещи. */
  private busyNote(id: FigureId): string {
    if (this.save.figures[id]?.held) return `${FIGURE_BY_ID[id].name}а держат под стражей`;
    if (id === 'spy') return 'Лазутчик отдыхает после дела';
    return `${FIGURE_BY_ID[id].name} ещё ведёт прошлые переговоры`;
  }

  /** Меню приказов для агента. У разведчика и полководца своих приказов нет. */
  private orderOptions(agent: FigureId, target: GenSettlement, now: number, at = now): OrderOption[] {
    if (agent === 'diplomat') return this.diploOptions(target, now);
    if (agent === 'spy') return this.spyOptions(target, now, at);
    return [];
  }

  /**
   * Приказы дипломата. Недоступное действие не выбрасывается, а возвращается с
   * причиной: игрок обязан видеть, чего ему не хватает, а не гадать, куда
   * делась кнопка.
   */
  private diploOptions(target: GenSettlement, now: number, mode?: OptionMode): OrderOption[] {
    const rec = this.diploOf(target.id, now);
    const standing = standingAt(rec, now);
    const temper = this.temperOfSettlement(target);
    const pressure = this.damageOf(target.id, now);
    const common =
      this.optionBlock('diplomat', target, now, mode) ??
      (!target.tribeId ? 'С варварами не договариваются.' : null);

    return DIPLO_ACTIONS.map((def) => {
      const chance = chanceOf({ action: def.id, attitude: rec.attitude, temper, standing, pressure, seed: 0 });
      const cost = this.orderCost(def.id, target, now);
      let reason = common;
      if (!reason) {
        const t = TEMPER_BY_ID[temper];
        if (def.id === 'pact' && standing === 'pact') reason = 'Пакт уже подписан.';
        else if (def.id === 'pact' && standing === 'war') reason = 'Сначала мир.';
        else if (def.id === 'pact' && chance === 0)
          reason = `${t.name} и слушать не станет: отношение ${rec.attitude}, нужно ${t.pactBar}.`;
        else if (def.id === 'peace' && standing !== 'war') reason = 'Войны и так нет.';
        else if (def.id === 'peace' && chance === 0)
          reason = `Мириться не станут: отношение ${rec.attitude}, нужно ${t.peaceBar}.`;
        else if (def.id === 'war' && standing === 'war') reason = 'Война и так идёт.';
        else if (def.id === 'war' && rec.breakAt > 0)
          reason = `Разрыв пакта объявлен, осталось ${formatLeft(Math.max(0, rec.breakAt - now) / 1000)}.`;
        else {
          const short = this.shortOf(cost);
          if (short > 0) reason = `На складе не хватает ${short} запасов.`;
        }
      }
      // Переговоры стоят энергию дипломата — у каждого разговора своя цена (`data/energy`).
      const energy = this.energyCost('diplomat', def.id, now, roadOf(mode));
      if (!reason && mode !== 'paid') reason = energy.block;
      return {
        id: def.id,
        can: reason === null,
        reason,
        chance,
        cost,
        energy,
        seconds: Math.round(def.busy / 1000),
        // Переговоры не губят: дипломат уходит только на покой.
        peril: null,
        perilWhy: [],
        at: now,
      };
    });
  }

  /**
   * Приказы лазутчика. Шанс считается той же чистой функцией, что и в приказе,
   * и от тех же трёх входов: уровень лазутчика (Дозор игрока), стража цели и
   * расстояние. Показанный шанс и есть тот, по которому потом бросается кость.
   */
  private spyOptions(target: GenSettlement, now: number, at = now, mode?: OptionMode): OrderOption[] {
    const common = this.optionBlock('spy', target, now, mode);
    const keen = Math.max(1, this.save.profile?.intelKeen ?? 1);
    const guard = guardOf(this.powerNow(target, at), target.castle);
    const away = distance(this.save.home, target);
    const risk = this.spyPeril(target, at);
    const times = this.spyTimes();
    return SPY_ACTIONS.map((def) => {
      const chance = spyChance({ action: def.id, keen, guard, distance: away });
      let reason = common;
      if (!reason && def.id === 'revolt') {
        if (!target.tribeId) reason = 'В логове бунтовать не против кого.';
        else if (this.inRevolt(target.id, now)) {
          reason = `Там уже бунт, ещё ${formatLeft(Math.max(0, (this.save.revolts[target.id]?.until ?? 0) - now) / 1000)}.`;
        }
      }
      // Дело лазутчика стоит его энергию (`data/energy`): добром он не платит, платит силами и риском.
      const energy = this.energyCost('spy', def.id, now, roadOf(mode));
      if (!reason && mode !== 'paid') reason = energy.block;
      return {
        id: def.id,
        can: reason === null,
        reason,
        chance,
        // Лазутчик не платит добром: он платит риском.
        cost: {},
        energy,
        seconds: Math.round(times.busy / 1000),
        peril: risk.peril,
        perilWhy: risk.why,
        held: Math.round(times.held / 1000),
        at,
      };
    });
  }

  /**
   * Гибель лазутчика на деле у этой цели в эту минуту — замером той двери, что решит
   * исход (`peril.diesAt`). Своей функцией, а не строкой в приказах: у шанса дела один
   * владелец (Дозор), у гибели — другой, и в одном теле им тесно.
   */
  private spyPeril(target: GenSettlement, at: number): { peril: number; why: string[] } {
    const c = this.perilCase('spy', target, at);
    return { peril: perilShare(perilOf(c)), why: perilWhy(c) };
  }

  async orders(agent: FigureId, target: SettlementId): Promise<OrderOption[]> {
    const s = this.byId.get(target);
    if (!s) return [];
    return this.orderOptions(agent, s, this.clock());
  }

  /**
   * Приказ агенту. Кому какой приказ, знает одна таблица (`ORDER_AGENT`), и
   * второго списка «у кого что» быть не должно.
   *
   * Ответ считает чистая функция — `respond` у дипломата, `spyOutcome` у
   * лазутчика, — и зерно у обеих выведено из условий дела, а не из счётчика
   * обращений: второе нажатие при тех же условиях даёт тот же ответ.
   */
  async order(action: OrderActionId, target: SettlementId, shownAt?: number): Promise<OrderResult> {
    const now = this.clock();
    const s = this.byId.get(target);
    const fail = (error: string): OrderResult => ({ error, accepted: false, diplomacy: null, text: '' });
    if (!s) return fail('Цель не найдена.');
    const agent = ORDER_AGENT[action];
    if (!agent) return fail('Такого приказа нет.');
    // Шанс и гибель — на ту минуту, что игрок видел в меню, если оно свежее: приказ
    // исполняется ровно по показанным числам. Запреты — на сейчас.
    const opt = this.orderOptions(agent, s, now, this.shownAt(shownAt, now)).find((o) => o.id === action);
    if (!opt) return fail('Такого приказа нет.');
    if (!opt.can) return fail(opt.reason ?? 'Сейчас нельзя.');
    // Цена дела в энергии — при приказе, чем бы оно ни кончилось: разговор был, дело сделано (docs/agent_energy.md).
    this.payEnergy(agent, action, now);
    if (agent === 'spy') return this.spyOrder(action as 'probe' | 'revolt', s, now, opt.chance ?? 0, opt.peril ?? 0, opt.perilWhy);
    return this.diploOrder(action as DiploActionId, s, now, opt);
  }

  /**
   * Приказ дипломата у ворот в минуту `now`: ответ двора, отношение, срок занятости, плата, донесение. Цену в энергии
   * списал тот, кто зовёт: приказ у ворот — в эту же минуту, дело из «Походов» — при отправке (`errand`).
   */
  private diploOrder(diplo: DiploActionId, s: GenSettlement, now: number, opt: OrderOption): OrderResult {
    const target = s.id;
    const rec = this.diploOf(target, now);
    const standing = standingAt(rec, now);
    const before = rec.attitude;
    const answer = respond({
      action: diplo,
      attitude: rec.attitude,
      temper: this.temperOfSettlement(s),
      standing,
      pressure: this.damageOf(target, now),
      seed: orderSeed(this.save.seed, target, diplo, rec.attitude, standing),
    });

    rec.attitude = answer.attitude;
    if (answer.standing !== standing) {
      if (answer.breakIn > 0) {
        // Разрыв пакта не мгновенный: до срока бумага ещё держит обе стороны.
        rec.breakAt = now + answer.breakIn;
      } else {
        rec.standing = answer.standing;
        rec.since = now;
        rec.until = answer.duration > 0 ? now + answer.duration : 0;
        rec.breakAt = 0;
      }
    }
    this.save.diplomacy[target] = rec;

    const def = DIPLO_ACTION_BY_ID[diplo];
    const f = this.save.figures.diplomat;
    f.busyUntil = now + def.busy;

    const cost = answer.accepted ? opt.cost : {};
    const spent: Loot = {};
    for (const [r, n] of Object.entries(cost) as [keyof Loot, number][]) spent[r] = -(n ?? 0);
    const good = answer.accepted && diplo !== 'war' && diplo !== 'insult';
    const text = `${s.name}: ${answer.text}`;

    this.addEffect({
      id: `order-${target}-${diplo}-${now}`,
      lost: {},
      resources: spent,
      prestige: diplo === 'pact' || diplo === 'peace' ? (answer.accepted ? 2 : 0) : diplo === 'war' ? 1 : 0,
      morale: good ? 2 : diplo === 'war' ? -2 : 0,
      battle: null,
      text,
      good,
    });
    this.addReport({
      id: `order-${target}-${diplo}-${now}-r`,
      at: now,
      kind: 'support',
      title: `${def.name}: ${s.name}`,
      target: { id: s.id, name: s.name, x: s.x, y: s.y },
      won: answer.accepted,
      sent: {},
      lost: {},
      enemyPower: null,
      enemyLost: null,
      loot: null,
      intel: null,
      battle: null,
      text: `${answer.text} Отношение ${before} → ${rec.attitude}.`,
      read: false,
    });
    this.write();
    return { error: null, accepted: answer.accepted, diplomacy: this.diploView(s, now), text };
  }

  /**
   * Дело лазутчика. Провал стоит свободы и лица: он возвращается ни с чем, его держат
   * под стражей `SPY_HELD`, и цель запоминает лицо — отношение падает. Гибель — своя
   * кость, от удачи дела не зависящая (`peril`): её число стоит в меню до приказа, и
   * применяется ровно оно.
   */
  private spyOrder(action: 'probe' | 'revolt', s: GenSettlement, now: number, chance: number, peril: number, why: string[]): OrderResult {
    const rec = this.diploOf(s.id, now);
    const f = this.save.figures.spy;
    const person = f.person ?? 0;
    const seed = spySeed(this.save.seed, s.id, action, chance, rec.attitude, person);
    const out = spyOutcome(chance, seed, action);
    // Гибель — своя кость: в её зерне нет шанса дела, поэтому ни удача, ни Дозор её не
    // двигают. Решает её та же дверь, что посчитала число в меню (`peril.diesAt`).
    const dies = diesAt(spyDeathRoll(this.save.seed, s.id, now, person), peril);
    // Заход засчитан в память цели — любым исходом, и после того, как его риск решён.
    this.markVisit(s.id, now);
    // Скрытность решает не исход, а то, заметили ли провал, — тем же броском.
    const quiet = !out.success && !dies && slipped(out.miss, this.save.profile?.stealth ?? 0);
    const times = this.spyTimes();
    f.busyUntil = now + (out.success || quiet ? times.busy : times.held);
    f.held = !out.success && !quiet;

    let intel: Intel | null = null;
    if (quiet) {
      // Не вышло, но ушёл тихо: не держат, дома не горюют, цель насторожилась.
      this.moveAttitude(s.id, SPY_SLIP_ATTITUDE, now);
    } else if (!out.success) {
      // Его заметили — и запомнили. Это и есть цена провала, когда он не погиб.
      this.moveAttitude(s.id, SPY_CAUGHT_ATTITUDE, now);
    } else if (action === 'probe') {
      // Донесение — тот же снимок, что и у разведчика, но с вилкой: лазутчик считает головы на глаз.
      const snap = this.snapshot(s, now);
      intel = { ...snap, spread: out.spread };
      this.save.intel[s.id] = intel;
    } else {
      this.save.revolts[s.id] = revoltWindow(now);
    }

    const def = SPY_ACTION_BY_ID[action];
    const title = out.success ? `${def.name}: ${s.name}` : `Провал у ${placeWord(s, 'of')}`;
    const text = quiet ? SPY_SLIP_TEXT[action] : out.text;
    this.addReport({
      id: `spy-${s.id}-${action}-${now}`,
      at: now,
      kind: 'scout',
      title,
      target: { id: s.id, name: s.name, x: s.x, y: s.y },
      won: out.success,
      sent: {},
      lost: {},
      enemyPower: null,
      enemyLost: null,
      loot: null,
      intel,
      battle: null,
      text,
      read: false,
    });
    this.addEffect({
      id: `spy-${s.id}-${action}-${now}-eff`,
      lost: {},
      resources: {},
      prestige: out.success && action === 'revolt' ? 2 : 0,
      morale: out.success ? 1 : quiet ? 0 : AGENT_HELD_MORALE,
      battle: null,
      deed: { agent: 'spy', ok: out.success, at: now, person },
      text: `${s.name}: ${text}`,
      good: out.success,
    });
    // Погиб на деле: дело сделано или нет — видно выше, а человека больше нет.
    if (dies) {
      this.downFigure('spy', now, { peril, where: `у ${placeWord(s, 'of')}`, why, spot: { id: s.id, name: s.name, x: s.x, y: s.y } });
    }
    this.write();
    return {
      error: null,
      accepted: out.success,
      diplomacy: this.diploView(s, now),
      text: `${s.name}: ${text}`,
    };
  }

  /**
   * Письма на столе. Срок разбирается прямо здесь: «считаем при чтении» — это
   * не фигура речи, а буквально то, что делает `stepLetters`, когда на стол
   * посмотрели. Протухшее письмо до этого списка не доживает.
   */
  async letters(): Promise<LetterView[]> {
    const now = this.clock();
    this.stepLetters(now);
    return letterOrder(this.save.letters).map((l) => this.letterView(l, now));
  }

  /**
   * Ответ игрока. Просроченное письмо ответа уже не принимает — оно разрешилось
   * само, и об этом есть строка в летописи; молча подменять один исход другим
   * нельзя (правило «приказ, который молча станет чем-то другим, хуже отказа»).
   */
  async answerLetter(id: string, answer: 'yes' | 'no'): Promise<string | null> {
    const now = this.clock();
    this.stepLetters(now);
    const l = this.save.letters.find((x) => x.id === id);
    if (!l) return 'Этой вести уже нет. Она решилась сама, исход в летописи.';
    if (letterExpired(l, now)) return 'Срок вышел, гонец уехал.';
    const view = this.letterView(l, now);
    const choice = view.choices.find((c) => c.id === answer);
    if (!choice) return 'Это решают на карте.';
    if (!choice.can) return choice.reason ?? 'Сейчас нельзя.';
    this.closeLetter(l, answer, now);
    this.write();
    return null;
  }

  async deals(): Promise<DealView[]> {
    const now = this.clock();
    const out: DealView[] = [];
    for (const tribeId of Object.keys(this.save.pacts)) out.push(...this.dealsOf(tribeId, now));
    return out;
  }

  async reports(): Promise<Report[]> {
    return this.save.reports.map((r) => ({ ...r }));
  }

  async readReports(): Promise<void> {
    for (const r of this.save.reports) r.read = true;
    this.write();
  }

  async tribes(): Promise<TribeInfo[]> {
    const counts = new Map<string, number>();
    for (const s of this.gen.settlements) {
      if (!s.tribeId) continue;
      counts.set(s.tribeId, (counts.get(s.tribeId) ?? 0) + 1);
    }
    return this.gen.tribes.map((t) => {
      const hostility = this.hostilityOf(t.id);
      const relation: Relation =
        hostility >= HOSTILITY_ENEMY
          ? 'enemy'
          : t.id === this.save.allyTribe && hostility < HOSTILITY_ALLY_BREAK
            ? 'ally'
            : 'neutral';
      return {
        id: t.id,
        name: t.name,
        color: t.color,
        relation,
        hostility: Math.round(hostility),
        settlements: counts.get(t.id) ?? 0,
      };
    });
  }

  async sync(profile: PlayerProfile): Promise<WorldPulse> {
    const now = this.clock();
    // Реестр приезжает по своему сроку — раз в `ROSTER_PULL_MS` и только пока открыта
    // карта; здесь его просто перечитывают. Дешёвая операция: строк не больше `ROSTER_MAX`.
    this.adoptCastles();
    this.revealNeighbours();
    // Слепок собран до того, как племя узнало о последствиях, которые ещё лежат
    // здесь неотданными: павших в них мир списывает с войска сам (`bury`).
    let army = profile.army ?? {};
    for (const e of this.save.effects) if (e.lostTroops) army = troopsAfter(army, e.lostTroops);
    // Вызовы к воротам в сохранении мира не лежат: их везёт партия, а мир помнит только посчитанные (`gateFights`).
    const { gate: calls = [], ...kept } = profile;
    this.save.profile = { ...kept, army };
    this.save.profileAt = now;
    this.seatAgents(now);
    this.muster(now);
    this.advance(now);
    // Дипломат у замка соседа передаёт союз или разрыв серверу войны — приказ асинхронный, ход фигур нет (Р-4).
    await this.sendEnvoy(now);
    this.errandBack('diplomat', now);
    // Война между игроками: итоги, посчитанные сервером, и полководец там, где его войско (docs/pvp.md).
    this.stepWars(now);
    // Вставшие раненые его отряда к полководцу больше не переходят (ДР-6): в городе отряда нет, они встают гарнизоном.
    // Бой события у ворот — после хода мира: у ворот стоят те, кто дома в эту минуту.
    const gateDone = this.gateFights(calls, now);
    // Орудие поставили, сняли или башня стала ниже его уровня — мир узнаёт об этом на
    // пульсе, и сила обстрела меняется в эту минуту (`aimTower`).
    const besieged = this.homeSiege(now);
    if (besieged) this.aimTower(HOME_ID, besieged, now);
    const reports = this.fresh;
    this.fresh = [];
    const effects = this.save.effects;
    this.save.effects = [];
    this.write();
    const camp = this.ourSiege(now);
    const discs = this.sightDiscs(now);
    return {
      now,
      marches: [...this.visibleMarches(now).map((m) => this.viewMarch(m, camp, this.marchRestView(m, now, discs))), ...this.warMarches()],
      figures: FIGURE_IDS.map((id) => this.viewFigure(id, now)),
      reports,
      effects,
      siege: this.siegeView(now),
      faith: this.faithView(profile.faith ?? null),
      unread: this.save.reports.filter((r) => !r.read).length,
      ...(gateDone.length > 0 ? { gateDone } : {}),
    };
  }

  /**
   * Вера земли под замком и доля чужой веры вокруг.
   *
   * Считается по клетке замка и потому не меняется, пока замок стоит на месте,
   * — отсюда и кэш: обход круга радиусом `FAITH_AROUND` стоит многих чтений атласа
   * (`faith.faithPressure`), а пульс идёт каждые `PULSE_MS`. Ключ включает веру деревни: после крещения
   * та же округа даёт другую долю чужого.
   */
  private faithCache: { key: string; view: { id: FaithId; pressure: number } } | null = null;

  private faithView(mine: FaithId | null): { id: FaithId; pressure: number } {
    const home = this.save.home;
    const here = faithAt(home.x, home.y);
    // Пока деревня своей веры не назвала, чужой вокруг для неё нет: считать
    // давление не на что, а подставлять веру земли значило бы посчитать её
    // дважды. Первый же пульс поставит веру, второй посчитает округу.
    const key = `${home.x}|${home.y}|${mine ?? here}`;
    if (this.faithCache?.key === key) return this.faithCache.view;
    const view = { id: here, pressure: faithPressure(home.x, home.y, FAITH_AROUND, mine ?? here) };
    this.faithCache = { key, view };
    return view;
  }

  // ---------- Война между игроками (docs/pvp.md) ----------
  //
  // Бой между игроками считает сервер (`/api/war`), в минуту прихода и тем же ядром, что бой здесь
  // (`world/fights`). Мир на клиенте делает три вещи: показывает войну теми же видами, что осаду логова
  // (поход — фигура полководца, чужой поход — отряд на карте и тревога, лагерь — окно осады), применяет
  // итог своей стороны один раз (`warSeen`) и отдаёт приказы. Своего исхода у него нет.

  /** Свои войны из последнего ответа сервера. Сервера нет — пусто. */
  private warList(): WarView[] {
    return this.warsFrom?.() ?? [];
  }

  /** Война, которую ведёт наш полководец, пока она не кончилась. */
  private warLed(): WarView | null {
    const id = this.save.figures.general.war;
    return id ? (this.warList().find((w) => w.id === id && w.role === 'atk' && w.phase !== 'done') ?? null) : null;
  }

  /** Лагерь игрока под нашими стенами. */
  private warOnUs(): WarView | null {
    return this.warList().find((w) => w.role === 'def' && w.phase === 'camp' && w.camp) ?? null;
  }

  /** Имя чужого города в войне. */
  private warCity(w: WarView, side: 'atk' | 'def'): string {
    return cityOr(side === 'atk' ? w.atkCity : w.defCity);
  }

  /**
   * Итоги войны — в отчёты и последствия, каждый ровно один раз (`save.warSeen`), и полководец — туда,
   * где его войско по словам сервера. Зовётся на пульсе после хода мира.
   */
  private stepWars(now: number): void {
    if (!this.warsFrom) return;
    this.warFought.clear();
    const list = this.warList();
    const seen = new Set(this.save.warSeen ?? []);
    // Сервер отдаёт свежие сверху; применяется старое первым.
    for (const w of [...list].reverse()) {
      // Лагерь войны — для записи осады (ролик осады): сервер снимает его вместе с концом осады.
      if (w.camp) this.warCamps.set(w.id, w.camp);
      // Удар из поля, не пробившийся через рогатки (docs/siege_v2.md, 19.2): у союзника — его выручка, у города — удар его
      // полководца. Боя не было; донесение один раз.
      for (const t of w.turned ?? []) {
        const mine = w.role === 'ally' ? Boolean(w.me) && t.ally === w.me : w.role === 'def' && !t.ally;
        const id = warTurnedId(w.id, t.at);
        if (!mine || seen.has(id) || t.at > now) continue;
        seen.add(id);
        this.turnedReport(w, t);
      }
      // Осада союзника (docs/siege_v2.md, раздел 5): из её боёв наш — только выручка нашей дружины.
      if (w.role === 'ally') {
        for (const b of w.battles) {
          if (seen.has(b.id) || b.at > now || !w.me || b.ally !== w.me) continue;
          seen.add(b.id);
          this.allyBattle(w, b);
        }
        continue;
      }
      for (const b of w.battles) {
        if (seen.has(b.id) || b.at > now) continue;
        seen.add(b.id);
        this.warBattle(w, b);
      }
      // Починки пролома под нашими стенами — дерево и камень со склада, каждая один раз (раздел 5): сервер числит их цену
      // за нами, пока не увидит отметку в слепке (`WarSheet.seen`).
      if (w.role === 'def' && w.camp) {
        for (const d of repairsOf(w.camp as unknown as SiegeWindow)) {
          const rid = warRepairId(w.id, d.at);
          if (seen.has(rid) || d.at > now) continue;
          seen.add(rid);
          this.payStock(wallRepairCost(w.camp.wall ?? 0), rid, 'Пролом заделывают. К концу фазы стена будет цела.', d.at);
        }
        // Требушет на стене (Р-5) — та же цена, что починка, и тот же порядок: один раз, по отметке.
        for (const g of w.camp.guns ?? []) {
          const gid = warGunId(w.id, g.at);
          if (seen.has(gid) || g.at > now) continue;
          seen.add(gid);
          this.payStock(wallRepairCost(w.camp.wall ?? 0), gid, 'На стену ставят требушет.', g.at);
        }
      }
      // Обстрел нашего города (Р-5): каждое второе попадание в постройку — −1 уровень, не ниже первого; один раз, по отметке.
      if (w.role === 'def') this.warShots(w, seen, now);
      // Кольцо блокады войны (Р-5): строка летописи о замкнутом и разомкнутом кольце — один раз, по отметке.
      this.warRing(w, seen, now);
      const fid = warFallId(w.id);
      if (w.fall && !seen.has(fid) && w.fall.at <= now) {
        seen.add(fid);
        this.warFall(w, w.fall);
      }
      // Дань (docs/siege_v2.md, 7.3): добро переходит у обеих сторон один раз, по отметке.
      const tid = warTributeId(w.id);
      if (w.tribute && !seen.has(tid) && w.tribute.at <= now) {
        seen.add(tid);
        this.warTribute(w, w.tribute);
      }
      if (w.role === 'atk') this.warGeneral(w, now);
    }
    // Полководец числится в войне, которой у сервера больше нет: снята по сроку или запись войн начата
    // заново. Он дома с тем, что было при нём, — пропасть в походе без следа он не может.
    const led = this.save.figures.general.war;
    if (led && this.warsKnown?.() && !list.some((w) => w.id === led)) this.warHome(now, null);
    this.stepSpies(now, seen);
    this.stepRivals(list, seen);
    this.save.warSeen = keptSeen(
      seen,
      this.warsKnown?.() === false ? null : [...warSeenIds(list), ...this.spyList().map((x) => spySeenId(x.id)), ...rivalSeenIds(list, this.proposalList())],
    );
  }

  /** Полководец — где его войско по словам сервера: идёт, стоит лагерем, возвращается. */
  private warGeneral(w: WarView, now: number): void {
    const f = this.save.figures.general;
    // Убыль похода не в бою — до того, как состав встанет по словам сервера (ДР-2).
    if (f.war === w.id) this.warAttrition(w, f.troops ?? {}, now);
    if (w.phase === 'done') {
      if (f.war === w.id) this.warHome(now, w);
      return;
    }
    // Энергией полководца в войне владеет сервер: прежняя стойка сверяется до того, как война её сменит.
    if (!f.war) this.energyOf('general', now);
    f.war = w.id;
    f.troops = troopTotal(w.army.troops as TroopStack) > 0 ? { ...(w.army.troops as TroopStack) } : undefined;
    f.rest = w.army.rest;
    // Режим марша и истощение похода — у сервера (ДР-2): своего отрезка у мира на этой дороге нет.
    if (w.gait) f.gait = w.gait;
    else delete f.gait;
    f.wear = undefined;
    f.halt = w.legAt !== undefined && w.legAt > now ? w.legAt : undefined;
    f.handover = undefined;
    f.chase = undefined;
    f.strike = undefined;
    f.assault = undefined;
    if (w.phase === 'march') {
      // После смены режима — от начала нового отрезка, в стоянку — на месте (ДР-2, `WarView.legFrom`).
      f.from = { ...(w.legFrom ?? w.from) };
      f.to = { ...w.to };
      f.departAt = w.legAt ?? w.sentAt;
      f.arriveAt = w.arriveAt;
      f.phase = now < w.arriveAt ? 'moving' : 'field';
    } else if (w.phase === 'camp') {
      f.from = { ...w.to };
      f.to = { ...w.to };
      f.departAt = w.arriveAt;
      f.arriveAt = w.arriveAt;
      f.phase = 'field';
    } else {
      f.from = { ...(w.backFrom ?? w.to) };
      f.to = { ...this.save.home };
      f.departAt = w.legAt ?? w.endAt ?? now;
      f.arriveAt = w.backAt ?? now;
      f.phase = now < f.arriveAt ? 'moving' : 'home';
    }
  }

  /**
   * Убыль похода не в бою (ДР-2, М4): истощение налегке в пути, истощение лагеря за фазы, выбитое башней — сервер снял её с
   * войска похода (`WarRow.army`), а боя, который донёс бы её до племени, у неё нет. Разница «прошлый состав − павшие в боях
   * этого пульса − нынешний состав» уходит в племя последствием без строки (больные и отставшие, не раненые), один раз:
   * следующий пульс сравнивает уже с новым составом. Прежде такая убыль до племени не доходила вовсе.
   */
  private warAttrition(w: WarView, prev: TroopStack, now: number): void {
    const left = troopsAfter(troopsAfter(prev, this.warFought.get(w.id) ?? {}), w.army.troops as TroopStack);
    const n = troopTotal(left);
    if (n === 0) return;
    this.addEffect({
      id: `war-${w.id}-worn-${now}`,
      lost: { warrior: n },
      lostTroops: left,
      routed: true,
      resources: {},
      prestige: 0,
      morale: 0,
      battle: null,
      text: '',
      good: false,
    });
  }

  /** Война кончилась: полководец дома с теми, кто уцелел. Дружину перебили — разбит, как в любом бою. */
  private warHome(now: number, w: WarView | null): void {
    const f = this.save.figures.general;
    // Последняя отметка войны — до того, как полководец снова станет своим: дома энергия копится с минуты прихода.
    const last = w?.army.energy;
    if (last) f.energy = { ...last };
    f.war = undefined;
    const troops = w ? (w.army.troops as TroopStack) : (f.troops ?? {});
    f.troops = troopTotal(troops) > 0 ? { ...troops } : undefined;
    f.from = { ...this.save.home };
    f.to = { ...this.save.home };
    f.departAt = now;
    f.arriveAt = now;
    f.phase = 'home';
    // Уцелевшие дома — гарнизон (ДР-6).
    this.homecoming(now);
    if (w && !troopTotal(troops) && w.battles.length > 0) {
      const name = this.warCity(w, 'def');
      const spot = { id: w.defCastle, name, x: w.to.x, y: w.to.y };
      this.defeatGeneral(w.endAt ?? now, `разбит у города ${name}.`, `у города ${name}`, spot, mixSeed(w.battles.length, w.sentAt));
    }
  }

  /**
   * Удар из поля, не пробившийся через рогатки в минуту прихода (docs/siege_v2.md, 19.2): проход был занят, боя не было,
   * дружина цела и стоит в поле. Донесение — тому, чья дружина: союзнику о его выручке, городу — об ударе его полководца.
   * Прежде такой удар пропадал молча.
   */
  private turnedReport(w: WarView, t: WarTurned): void {
    const allied = w.role === 'ally';
    const ally = this.warCity(w, 'def');
    const enemy = this.warCity(w, 'atk');
    const busy = `в ту минуту ${gateBusyFor(t.waitMs)}`;
    this.addReport({
      id: `war-${warTurnedId(w.id, t.at)}`,
      at: t.at,
      kind: allied ? 'raid' : 'defense',
      title: allied ? `Выручка не пробилась: ${ally}` : `Удар не пробился: лагерь ${enemy}`,
      target: allied ? { id: w.defCastle, name: ally, x: w.to.x, y: w.to.y } : this.homeSpot(),
      won: false,
      sent: { warrior: t.men },
      lost: {},
      enemyPower: null,
      enemyLost: null,
      loot: null,
      intel: null,
      battle: null,
      text: allied
        ? `Мы пришли на выручку союзнику, но к лагерю города ${enemy} через рогатки не пробились: ${busy} Боя не было, дружина цела и стоит в поле.`
        : `Полководец подошёл к лагерю города ${enemy} с тыла, но через рогатки не пробился: ${busy} Боя не было, дружина цела и стоит в поле.`,
      read: false,
    });
  }

  /**
   * Бой выручки под городом союзника (docs/siege_v2.md, раздел 5): наша дружина била лагерь с тыла — отчёт с роликом и её
   * потери. Город союзника своих потерь здесь не несёт: его гарнизон не выходил.
   */
  private allyBattle(w: WarView, b: WarBattle): void {
    const field = recordedField(b.input as unknown as FieldInput);
    const won = b.won;
    const ours = (b.genTroops ?? {}) as TroopStack;
    const lost = (b.genLost ?? {}) as TroopStack;
    const camp = b.atkTroops as TroopStack;
    const ally = this.warCity(w, 'def');
    const enemy = this.warCity(w, 'atk');
    const lostMen = troopTotal(lost);
    const title = won ? `Выручка: лагерь под ${ally} разбит` : `Выручка отбита: ${ally}`;
    this.addReport({
      id: `war-${b.id}`,
      at: b.at,
      kind: 'raid',
      title,
      target: { id: w.defCastle, name: ally, x: w.to.x, y: w.to.y },
      won,
      sent: { warrior: troopTotal(ours) },
      lost: lostMen > 0 ? { warrior: lostMen } : {},
      enemyPower: Math.round(troopPower(camp)),
      enemyLost: troopTotal(b.atkLost as TroopStack),
      loot: null,
      intel: null,
      battle: field.result
        ? { us: 'attacker', result: field.result, troops: { attacker: { ...ours }, defender: { ...camp } }, place: this.placeOf(w.to), site: 'camp' }
        : null,
      ...(b.rearThrough ? { rearThrough: { ...b.rearThrough } } : {}),
      text: `Мы пришли на выручку союзнику и ударили по лагерю города ${enemy} с тыла: ${won ? 'лагерь разбит, осада снята' : 'лагерь устоял'}.${lostMen > 0 ? ` Наших пало ${lostMen}.` : ' Наши все целы.'}`,
      read: false,
    });
    const g = this.save.figures.general;
    // Дорога выручки списана целиком (ДР-5): в бой сервер вёл дошедших, и уход за неё — ровно его.
    this.legDone();
    if (lostMen > 0 && g.troops) g.troops = troopsAfter(g.troops, lost);
    this.warLost(lost);
    this.addEffect({
      id: `war-${b.id}-eff`,
      lost: lostMen > 0 ? { warrior: lostMen } : {},
      lostTroops: lost,
      field: lost,
      resources: {},
      prestige: won ? 4 : 0,
      morale: won ? 4 : -4,
      battle: won ? 'won' : 'lost',
      ...warScarOf(b, 'ally'),
      ...(field.result ? { deed: { agent: 'general' as const, ok: won, at: b.at } } : {}),
      ...this.flankDeed(field, 'attacker', won, b.at, w.to),
      text: title,
      good: won,
    });
  }

  /** Бой войны — отчётом с роликом и последствием своей стороны. Журнал ролика пересчитан из входа сервера. */
  private warBattle(w: WarView, b: WarBattle): void {
    const ours = w.role === 'atk' ? 'atk' : 'def';
    // Выручка союзника (раздел 5): дружина в бою его, а не наша, — городу её не списывать.
    const allied = Boolean(b.ally);
    // Победа выручки — союзника, который дрался (АУ-8, п. 4, `pvp.reliefCredit`): осаждённому — «осада снята», без победы
    // и славы. Бой старше версии правила — как был.
    const lifted = ours === 'def' && reliefCredit(b);
    // Ядро детерминировано: тот же вход по той же версии правил даёт тот же бой до бита (BTL-0), и журнал для ролика берётся отсюда.
    const field = recordedField(b.input as unknown as FieldInput);
    const weStruck = b.by === ours;
    const won = b.won === weStruck;
    const town = plusTroops(b.homeTroops as TroopStack, (b.genTroops ?? {}) as TroopStack);
    const camp = b.atkTroops as TroopStack;
    const townLost = plusTroops(b.homeLost as TroopStack, (b.genLost ?? {}) as TroopStack);
    const ourLost = ours === 'atk' ? (b.atkLost as TroopStack) : allied ? (b.homeLost as TroopStack) : townLost;
    const theirLost = ours === 'atk' ? townLost : (b.atkLost as TroopStack);
    const sent = ours === 'atk' ? camp : town;
    const their = ours === 'atk' ? town : camp;
    const record: BattleRecord | null = field.result
      ? {
          us: weStruck ? 'attacker' : 'defender',
          result: field.result,
          troops: b.by === 'atk' ? { attacker: { ...camp }, defender: { ...town } } : { attacker: { ...town }, defender: { ...camp } },
          ...(b.militia && b.by === 'atk' ? { militia: { attacker: { men: 0, archers: 0 }, defender: { ...b.militia } } } : {}),
          place: this.placeOf(w.to),
          site: b.site,
          // Штурм из лагеря после обстрела: ролик начнётся с него; проломы сервер уже открыл во фронте штурма (`world/wall`).
          ...(b.site === 'wall' && b.by === 'atk' && craftCount(b.craft, 'bombard') > 0 ? { shots: craftCount(b.craft, 'bombard') } : {}),
          ...(b.site === 'wall' && b.by === 'atk' && (b.craft?.breach ?? 0) > 0 ? { breach: b.craft?.breach } : {}),
          ...(b.site === 'wall' && b.openings ? { openings: b.openings } : {}),
        }
      : null;
    const other = this.warCity(w, ours === 'atk' ? 'def' : 'atk');
    const lostMen = troopTotal(ourLost);
    const SITE: Record<WarBattle['site'], string> = { wall: 'Штурм', sortie: 'Вылазка', camp: 'Удар по лагерю', joint: 'Совместный удар' };
    // Вылазка на машину и выручка союзника — свои слова (docs/siege_v2.md, раздел 5).
    const burnt = b.burn ? MACHINE_NAME[b.burn].toLowerCase() : null;
    const helper = b.ally ? this.castleOf(b.ally as SettlementId) : null;
    const site = burnt ? `Вылазка на ${burnt === 'осадная башня' ? 'осадную башню' : burnt}` : allied ? `Выручка из «${cityOr(helper?.city)}»` : SITE[b.site];
    const hit = burnt ? (b.won ? 'сожгли' : 'отбита') : null;
    const title =
      ours === 'atk'
        ? b.by === 'atk'
          ? `${won ? 'Штурм удался' : 'Штурм отбит'}: ${other}`
          : `${site} из ${other}: ${hit ? (b.won ? 'машину сожгли' : 'отбита') : won ? 'лагерь устоял' : 'лагерь разбит'}`
        : b.by === 'atk'
          ? `${won ? 'Штурм отбит' : 'Город взят штурмом'}: ${other}`
          : lifted
            ? `${site}: ${won ? 'осада снята' : 'лагерь устоял'}`
            : `${site}: ${hit ?? (won ? 'лагерь разбит' : 'лагерь устоял')}`;
    const lostText = lostMen > 0 ? ` Наших пало ${lostMen}.` : ' Наши все целы.';
    // Бой, разбивший лагерь или оставивший его без людей, кончил осаду: донесение о нём несёт запись осады (ролик осады).
    const ended = w.endAt === b.at && (w.end === 'lifted' || w.end === 'beaten');
    const siege = ended ? this.warSiegeRecord(w, b.at, 'broken') : null;
    const through = b.through ? { through: { ...b.through } } : {};
    const rear = b.rearThrough ? { rearThrough: { ...b.rearThrough } } : {};
    this.addReport({
      id: `war-${b.id}`,
      at: b.at,
      kind: ours === 'atk' ? 'raid' : 'defense',
      title,
      target: ours === 'atk' ? { id: w.defCastle, name: other, x: w.to.x, y: w.to.y } : this.homeSpot(),
      won,
      sent: { warrior: troopTotal(sent) },
      lost: lostMen > 0 ? { warrior: lostMen } : {},
      enemyPower: Math.round(troopPower(their)),
      enemyLost: troopTotal(theirLost),
      loot: null,
      intel: null,
      battle: record,
      ...through,
      ...rear,
      ...(siege ? { siege } : {}),
      text: lifted
        ? won
          ? `Союзник «${cityOr(helper?.city)}» пришёл на выручку и с тыла разбил лагерь города ${other}. Осада снята. Наш гарнизон в бой не выходил.`
          : `Выручку из «${cityOr(helper?.city)}» лагерь города ${other} отбил. Осада идёт.`
        : `Бой с отрядом города ${other}: ${won ? 'победа' : 'поражение'}.${lostText}${b.craft ? ` ${craftNote(b.craft)}` : ''}`,
      read: false,
    });
    // Наш полководец дрался: в походе — всегда, дома — если ударил из поля (выручка союзника — не наш полководец).
    const general = ours === 'atk' || (Boolean(b.genTroops) && !allied);
    this.warLost(ourLost);
    // Павшие похода в боях этого пульса — чтобы убыль не в бою (`warAttrition`) не посчитала их второй раз.
    if (ours === 'atk') this.warFought.set(w.id, plusTroops(this.warFought.get(w.id) ?? {}, ourLost));
    let standing: TroopStack = {};
    if (ours === 'def') {
      // Дружина, стоявшая у ворот, теряет свою долю тут же — тем же правилом, что у частокола; дружина из поля —
      // своими потерями.
      const held = this.defenders(b.at);
      standing = this.standingLost(held.own, held.standing, b.homeLost as TroopStack);
      const g = this.save.figures.general;
      // Дорога удара списана целиком (ДР-5): в бой сервер вёл дошедших, и уход за неё — ровно его.
      if (!allied && b.genTroops) this.legDone();
      if (!allied && b.genLost && troopTotal(b.genLost as TroopStack) > 0 && g.troops) g.troops = troopsAfter(g.troops, b.genLost as TroopStack);
    }
    this.addEffect({
      id: `war-${b.id}-eff`,
      lost: lostMen > 0 ? { warrior: lostMen } : {},
      lostTroops: ourLost,
      // В поле раненые лежат при полководце: у похода — все, у города — дружина удара.
      ...(ours === 'atk' ? { field: ourLost } : b.genLost && !allied ? { field: b.genLost as TroopStack } : {}),
      ...(troopTotal(standing) > 0 ? { standing } : {}),
      resources: {},
      // Выручка по новым правилам — не наш бой: ни славы, ни победы в счёте; облегчение осаждённого — мораль.
      prestige: won && !lifted ? 4 : 0,
      morale: won ? 4 : lifted ? 0 : -6,
      battle: lifted ? null : won ? 'won' : 'lost',
      // Метка боя войны (ДР-4) — сервера, своей роли: выручку союзника город не дрался, его метки в бою нет.
      ...(lifted ? {} : warScarOf(b, ours)),
      ...(general && field.result ? { deed: { agent: 'general' as const, ok: won, at: b.at } } : {}),
      ...(general ? this.flankDeed(field, weStruck ? 'attacker' : 'defender', won, b.at, w.to) : {}),
      text: title,
      good: won,
    });
  }

  /** Кольцо блокады войны в летопись (Р-5): осаждённому — город отрезан или снова дышит, осаждающему — кольцо замкнуто и прорвано. */
  private warRing(w: WarView, seen: Set<string>, now: number): void {
    const camp = w.camp as unknown as SiegeWindow | undefined;
    if (!camp) return;
    const town = w.role === 'def' ? this.homeName() : this.warCity(w, 'def');
    for (const d of blockadeDeeds(camp)) {
      const rid = warRingId(w.id, d.at);
      if (seen.has(rid) || d.at > now) continue;
      seen.add(rid);
      const text = d.on ? `Кольцо вокруг ${town} замкнуто. ${BLOCKADE_GIVES}` : `Кольцо вокруг ${town} разомкнуто: ${BREAK_WORDS[d.why ?? 'order']}.`;
      // Осаждающему кольцо — удача, осаждённому — беда; разомкнутое — наоборот.
      this.addEffect({ id: rid, lost: {}, resources: {}, prestige: 0, morale: 0, battle: null, text, good: d.on === (w.role === 'atk') });
    }
  }

  /**
   * Обстрел нашего города лагерем игрока (Р-5, `world/shelling`): выстрелы фаз посчитал сервер (строки журнала), и каждое
   * попадание, отнявшее уровень, ложится последствием один раз — по отметке `warShotId`, как починка и падение.
   */
  private warShots(w: WarView, seen: Set<string>, now: number): void {
    const rows = (w.camp?.phases ?? w.phases ?? []) as PhaseRow[];
    rows.forEach((r, k) => {
      if (r.at > now) return;
      (r.shots ?? []).forEach((s, i) => {
        if (!s.hit || !s.lost || !s.building) return;
        const sid = warShotId(w.id, k + 1, i);
        if (seen.has(sid)) return;
        seen.add(sid);
        this.shotLoss(sid, s.building);
      });
    });
  }

  /** Попадание, отнимающее уровень у постройки нашего города (`shelling.lostLevel`, не ниже первого), — последствием. */
  private shotLoss(id: string, building: string): void {
    const level = this.save.profile?.levels?.[building as keyof NonNullable<PlayerProfile['levels']>] ?? 0;
    const to = lostLevel(level);
    const name = this.buildingName(building);
    this.addEffect({
      id,
      lost: {},
      resources: {},
      ...(to < level ? { fallen: [{ id: building, from: level, to }] } : {}),
      prestige: 0,
      morale: 0,
      battle: null,
      text: to < level ? `Обстрел разрушил: ${name} теряет уровень.` : `Обстрел снова попал: ${name} — ниже первого уровня не падает.`,
      good: false,
    });
  }

  /** Город взят — участь, посчитанная сервером дверью `spoils.fate`: победителю увезённое, городу потери. */
  private warFall(w: WarView, f: WarFall): void {
    const how = FATE_META[f.fate].name.toLowerCase();
    // Осада войны в донесении о падении (ролик осады): штурм с ходу осадой не был — записи нет.
    const siege = this.warSiegeRecord(w, f.at, f.by === 'gates' ? (f.terms ? 'terms' : 'gates') : f.by, f.fate as Fate);
    if (w.role === 'atk') {
      const name = this.warCity(w, 'def');
      const loot = { ...(f.taken as Loot) };
      const goods = Object.values(loot).reduce((n: number, v) => n + (v ?? 0), 0);
      this.addReport({
        id: `war-${w.id}-fall`,
        at: f.at,
        kind: 'raid',
        title: `Город взят: ${name}`,
        target: { id: w.defCastle, name, x: w.to.x, y: w.to.y },
        won: true,
        sent: { warrior: troopTotal(w.army.troops as TroopStack) },
        lost: {},
        enemyPower: null,
        enemyLost: null,
        loot: goods > 0 ? loot : null,
        hidden: f.hidden,
        ...(f.led > 0 ? { led: f.led } : {}),
        intel: null,
        battle: null,
        ...(siege ? { siege } : {}),
        text: `${fallHow(f)}. Участь «${how}». Добыча едет домой обозом${f.led > 0 ? `, уведено ${f.led}` : ''}.`,
        read: false,
      });
      this.addEffect({
        id: `war-${w.id}-fall-eff`,
        lost: {},
        resources: loot,
        ...(f.led > 0 ? { bonded: f.led } : {}),
        castle: true,
        // Город взят из лагеря — осада доведена: опыт осад полководца (этап 2е). Штурм с ходу — не осада.
        ...(f.by !== 'storm' || w.mode === 'siege' ? { siege: true } : {}),
        prestige: 6,
        morale: 6,
        battle: null,
        text: `Город ${name} взят.`,
        good: true,
      });
      return;
    }
    const name = this.warCity(w, 'atk');
    const routed = f.routed as TroopStack;
    const men = troopTotal(routed);
    if (men > 0) {
      const held = this.defenders(f.at);
      this.standingLost(held.own, held.standing, routed);
    }
    const loss = asLoss(f.lost as Loot);
    this.warLost(routed, f);
    this.addReport({
      id: `war-${w.id}-fell`,
      at: f.at,
      kind: 'defense',
      title: f.by === 'hunger' ? 'Хлеб кончился' : f.by === 'gates' ? 'Ворота открыли' : 'Город взят штурмом',
      target: this.homeSpot(),
      won: false,
      sent: {},
      lost: men > 0 ? { warrior: men } : {},
      enemyPower: Math.round(troopPower(w.army.troops as TroopStack)),
      enemyLost: null,
      loot: Object.keys(loss).length > 0 ? loss : null,
      hidden: f.hidden,
      ...(f.fallen.length > 0 ? { fallen: f.fallen.map((x) => ({ ...x })) } : {}),
      ...(f.led > 0 ? { led: f.led } : {}),
      intel: null,
      battle: null,
      ...(siege ? { siege } : {}),
      text:
        f.by === 'gates'
          ? `Город открыл ворота отряду из города ${name}${f.terms ? ' на условиях' : ''}, гарнизон ушёл живым. Участь «${how}».`
          : `Отряд из города ${name} взял наш город${f.by === 'hunger' ? ' голодом, гарнизон разошёлся' : ''}. Участь «${how}».`,
      read: false,
    });
    this.addEffect({
      id: `war-${w.id}-fell-eff`,
      lost: men > 0 ? { warrior: men } : {},
      ...(men > 0 ? { lostTroops: routed, routed: true as const } : {}),
      resources: loss,
      ...(f.bondedLost > 0 ? { bonded: -f.bondedLost } : {}),
      ...(f.popLost > 0 ? { popLost: f.popLost } : {}),
      ...(f.fallen.length > 0 ? { fallen: f.fallen.map((x) => ({ ...x })) } : {}),
      ...(f.burned ? { burned: true } : {}),
      // Взят голодом — хлеба нет по окну, посчитанному сервером (docs/siege_v2.md, 21.1): остаток склада съеден.
      ...(f.by === 'hunger' ? { starved: true as const } : {}),
      prestige: 0,
      morale: -12,
      battle: null,
      text: `Город пал: участь «${how}».`,
      good: false,
    });
  }

  /**
   * Осада войны — в запись для ролика (`world/siegerecord`): последний виденный лагерь (`warCamps`, сервер снимает его с
   * концом осады) и журнал фаз войны; бои — записи войны той же осады, у каждого своё донесение (`war-<бой>`). Лагеря не
   * было (штурм с ходу) — записи нет.
   */
  private warSiegeRecord(w: WarView, at: number, how: SiegeEnd, fate?: Fate): SiegeRecord | null {
    if (w.role === 'ally') return null;
    const camp = this.warCamps.get(w.id) ?? w.camp;
    const phases = w.phases ?? camp?.phases;
    if (!camp && !phases?.length) return null;
    const ours = w.role === 'atk' ? 'atk' : 'def';
    const base = camp ?? { byId: w.atkCastle, campId: w.id, startedAt: w.arriveAt, foodAtStart: 0, garrisonAtStart: 0, townPerHour: 0, perManPerHour: 0 };
    // Лагерь войны — окно осады как есть (`contract.WarCamp`): те же поля, что у `SiegeWindow`.
    const win = { ...base, ...(phases?.length ? { phases } : {}) } as unknown as SiegeWindow;
    const since = siegeSince(win);
    const fights: SiegeFight[] = w.battles
      .filter((b) => b.at >= since && b.at <= at)
      .map((b) => ({
        at: b.at,
        site: b.site,
        won: b.won === (b.by === ours),
        report: `war-${b.id}`,
        ...(b.burn ? { machine: b.burn } : {}),
        ...(b.breakout ? { ring: true as const } : {}),
        ...(b.ally ? { ally: true as const } : {}),
      }));
    return siegeRecordOf(
      win,
      ours,
      { at, how, ...(fate ? { fate } : {}) },
      { camp: camp?.builders ?? troopTotal(w.army.troops as TroopStack), fights, place: this.placeOf(w.to) },
    );
  }

  /**
   * Дань войны (docs/siege_v2.md, 7.3) — у осаждающего добро в обоз и осада доведена, у осаждённого добро со склада. Числа
   * посчитал сервер той же дверью дележа, что добычу (`parley.tributeGoods`); каждая сторона применяет их один раз.
   */
  private warTribute(w: WarView, t: WarTribute): void {
    const goods = { ...(t.taken as Loot) };
    const siege = this.warSiegeRecord(w, t.at, 'paid');
    const total = Object.values(goods).reduce((n: number, v) => n + (v ?? 0), 0);
    if (w.role === 'atk') {
      const name = this.warCity(w, 'def');
      this.addReport({
        id: `war-${w.id}-tribute`,
        at: t.at,
        kind: 'raid',
        title: `Дань взята: ${name}`,
        target: { id: w.defCastle, name, x: w.to.x, y: w.to.y },
        won: true,
        sent: { warrior: troopTotal(w.army.troops as TroopStack) },
        lost: {},
        enemyPower: null,
        enemyLost: null,
        loot: total > 0 ? goods : null,
        hidden: t.hidden,
        intel: null,
        battle: null,
        ...(siege ? { siege } : {}),
        text: `${name} дал дань за снятие осады. Лагерь снят, дань едет домой обозом.`,
        read: false,
      });
      this.addEffect({ id: `war-${w.id}-tribute-eff`, lost: {}, resources: goods, prestige: 0, morale: 0, battle: null, siege: true, text: `${name} дал дань.`, good: true });
      return;
    }
    const name = this.warCity(w, 'atk');
    const loss = asLoss(goods);
    const p = this.save.profile;
    if (p) {
      const { gold, ...rest } = goods;
      const stock: Loot = { ...(p.stock ?? {}) };
      for (const [k, v] of Object.entries(rest)) stock[k as keyof Loot] = Math.max(0, (stock[k as keyof Loot] ?? 0) - (v ?? 0));
      p.stock = stock;
      p.gold = Math.max(0, (p.gold ?? 0) - (gold ?? 0));
    }
    this.addReport({
      id: `war-${w.id}-tribute`,
      at: t.at,
      kind: 'defense',
      title: 'Дань отдана',
      target: this.homeSpot(),
      won: false,
      sent: {},
      lost: {},
      enemyPower: Math.round(troopPower(w.army.troops as TroopStack)),
      enemyLost: null,
      loot: Object.keys(loss).length > 0 ? loss : null,
      hidden: t.hidden,
      intel: null,
      battle: null,
      ...(siege ? { siege } : {}),
      text: `Лагерь отряда из города ${name} взял дань и снялся. Город на время под защитой от осады.`,
      read: false,
    });
    this.addEffect({ id: `war-${w.id}-tribute-eff`, lost: {}, resources: loss, prestige: 0, morale: 0, battle: null, text: `Дань ${name}: лагерь снят.`, good: false });
  }

  /**
   * Потери войны — сразу и в слепок деревни, который держит мир (`save.profile`): племя спишет их со своего
   * войска и склада концом этого пульса, а запись партии со слепком обороны может уйти раньше следующего, —
   * и сервер прочёл бы «бой принят» (`warSeen`) у гарнизона, который ещё числит павших.
   */
  private warLost(troops: TroopStack, fall?: WarFall): void {
    const p = this.save.profile;
    if (!p) return;
    if (troopTotal(troops) > 0) p.army = troopsAfter(p.army ?? {}, troops);
    if (!fall) return;
    const { gold, ...goods } = fall.lost;
    const stock: Loot = { ...(p.stock ?? {}) };
    for (const [k, v] of Object.entries(goods)) stock[k as keyof Loot] = Math.max(0, (stock[k as keyof Loot] ?? 0) - (v ?? 0));
    p.stock = stock;
    p.gold = Math.max(0, (p.gold ?? 0) - (gold ?? 0));
    p.bonded = Math.max(0, (p.bonded ?? 0) - fall.bondedLost);
    p.pop = Math.max(1, p.pop - fall.popLost);
  }

  /** Чужие походы на нас и лагерь под стенами — отрядами на карте и тревогой, как набег логова. */
  private warMarches(): MarchView[] {
    const out: MarchView[] = [];
    for (const w of this.warList()) {
      if (w.role !== 'def' || (w.phase !== 'march' && w.phase !== 'camp')) continue;
      const camp = w.phase === 'camp';
      const troops = w.army.troops as TroopStack;
      out.push({
        id: `war-${w.id}`,
        mission: 'raid',
        units: { warrior: troopTotal(troops) },
        troops: { ...troops },
        own: false,
        hostile: true,
        phase: camp ? 'stay' : 'out',
        from: { ...w.from },
        to: { ...w.to },
        fromName: this.warCity(w, 'atk'),
        toName: this.homeName(),
        targetId: HOME_ID,
        departAt: w.sentAt,
        arriveAt: camp ? (w.starvesAt ?? w.arriveAt) : w.arriveAt,
        loot: null,
        recallable: false,
        ...(camp ? { siege: true } : {}),
      });
    }
    return out;
  }

  /** Окно лагеря войны: рогатки, часы голода и участь — те же поля, что у осады логова. */
  private warWindow(w: WarView): SiegeWindow | null {
    return w.camp ? (w.camp as unknown as SiegeWindow) : null;
  }

  /** Что потеряет наш город, если лагерь игрока доест его сейчас, — той же дверью участи, что падение. */
  private warFallForecast(w: WarView, at: number): FallForecast {
    // Чужой обоз черту «Добычливый» не множит — та же дверь `haul`, что у набега на наш город.
    const haul = this.haul({ warrior: troopTotal(w.army.troops as TroopStack) }, false);
    const r = this.fateHome(this.save.profile, haul.carry, haul.escort, at, w.fate, 0);
    const gold = r.lost.gold ?? 0;
    return {
      goods: r.lostTotal - gold,
      gold,
      hidden: r.hiddenTotal,
      ledBonded: r.ledBonded.taken,
      ledPop: r.ledPop.taken,
      scatterPop: r.scattered.pop,
      scatterBonded: r.scattered.bonded,
      buildings: r.fallen.length,
      levels: FATES[w.fate].levels,
      burnsWorks: r.burnsWorks,
      routed: troopTotal(this.routedAt(at).routed),
    };
  }

  /** Осада игроком нашего города — окно обороняющегося. */
  private warSiegeView(now: number): SiegeView | null {
    const w = this.warOnUs();
    const c = w ? this.warWindow(w) : null;
    if (!w || !c) return null;
    const men = this.menOf(w.army.troops as TroopStack);
    const camp = restView(w.army.rest, now, men);
    const home = this.homeRestView(now);
    return {
      byId: w.atkCastle,
      byName: this.warCity(w, 'atk'),
      since: siegeSince(c),
      starvesAt: w.starvesAt ?? starvesAt(c),
      garrison: c.garrisonAtStart,
      foodAtStart: c.breadAtSince ?? c.foodAtStart,
      // Хлеб в городе — склад (ОС-1); голод решает сервер войны тем же правилом шага по описи склада.
      bread: Math.floor(this.homeFood(c, now)),
      // Штраф к добыче — тот, по которому сервер ведёт склад (`WarCamp.cut`): племя добывает по нему же.
      ...this.warBreadView(w, c, now),
      campMen: men,
      builders: c.builders ?? men,
      ...(c.gateAt !== undefined ? { gateAt: c.gateAt } : {}),
      ...(c.rearGateAt !== undefined ? { rearGateAt: c.rearGateAt } : {}),
      ...(c.wood !== undefined ? { wood: c.wood } : {}),
      fate: w.fate,
      fall: this.warFallForecast(w, now),
      palisade: this.save.profile?.levels?.palisade ?? 0,
      // Лагерь укреплён, город обстреливают — защитник видит это в окне осады (`world/siegecraft`).
      ...this.craftNoteOf(c, true),
      ...this.restViews(camp, home),
      // Износ осады — тот, с которым сервер войны бьёт гарнизон (`war.garrisonRest`): дни осады и залпы лагеря.
      ...this.wearOf(garrisonWear(c, now)),
      phases: this.phasesView(c, now, false),
      // Машины лагеря видны со стены (docs/siege_v2.md, 4.3).
      ...(machinesNote(c, now) ? { machineNote: machinesNote(c, now) } : {}),
      // Башня бьёт и по лагерю соседа (docs/siege_v2.md, раздел 5): обстрел посчитан сервером той же дверью (`world/bombard`).
      ...(c.fire ? { fire: fireView(c.fire, now) } : {}),
      ...(c.ration ? { ration: true } : {}),
      answers: this.answersOf(
        c,
        now,
        w.fate,
        // Охрана машины — сторона лагеря у города, прорежённого башней: той же меркой, что у сервера (`war.campSide`).
        thinKinds(kindsOf(w.army.troops as TroopStack), c.fire ? fireView(c.fire, now).thin : 0),
        (w.reliefs ?? []).map((r) => ({ from: cityOr(r.city), men: troopTotal(r.army.troops as TroopStack), at: r.at })),
      ),
      // Цену дани назначит сервер на минуту предложения той же формулой по слепку обороны; окно считает её по нашему складу.
      // Дань лагерю игрока — та же, что назначит сервер: справедливая, сбавленная красноречием нашего дипломата (АГ-1).
      parley: this.parleyDef(c, now, false, tributeAsk(fairTribute(this.homeBounty({ warrior: troopTotal(w.army.troops as TroopStack) }, now, w.fate), siegeShare(c, now)), this.save.profile?.eloquence ?? 0)),
      // Кольцо блокады (Р-5): лагерь — без выбитых башней, гарнизон — свой; решает сервер той же дверью (`war.ringCheck`).
      blockade: this.blockadeView(c, now, troopPower(w.army.troops as TroopStack) * (1 - (c.fire ? fireView(c.fire, now).thin : 0)), troopPower(this.defenders(now).all), false),
      // Постройки, стоящие без работы под обстрелом (Р-5): до броска следующей фазы — племя не берёт с них выработку.
      ...this.idleOf(c, now),
    };
  }

  /**
   * Штраф к добыче и прогноз склада нашего города под лагерем игрока (ОС-1): соотношение сил той же меркой, что у сервера
   * (лагерь — без выбитых башней, гарнизон — без ополчения), а штраф — серверный, если сервер его назвал: по нему он ведёт склад
   * в шаге осады. Прогноз — склад племени, без слепка осады — склад окна сервера (`homeDryAhead`).
   */
  private warBreadView(w: WarView, c: SiegeWindow, now: number): Pick<SiegeView, 'cut' | 'ratio' | 'dryAt'> {
    const thin = c.fire ? fireView(c.fire, now).thin : 0;
    const view = this.breadView(troopPower(w.army.troops as TroopStack) * (1 - thin), troopPower(this.defenders(now).all), this.homeDryAhead(c));
    return c.cut !== undefined ? { ...view, cut: c.cut } : view;
  }

  /** Постройки нашего города, стоящие без работы под обстрелом к минуте `now` (`shelling.idleBuildings`). Нет — нет поля. */
  private idleOf(c: SiegeWindow, now: number): { idle?: string[] } {
    const idle = idleBuildings(rowsOf(c), now, PHASE_MS);
    return idle.length ? { idle } : {};
  }

  /** Наш лагерь под городом игрока — окно осаждающего. */
  private warCampView(now: number): CampView | null {
    const w = this.warLed();
    const c = w && w.phase === 'camp' ? this.warWindow(w) : null;
    if (!w || !c) return null;
    const troops = w.army.troops as TroopStack;
    const men = this.menOf(troops);
    const card = this.castleOf(w.defCastle);
    const camp = restView(w.army.rest, now, men);
    const power = card ? estimate(card.power, 'rough') : { ...UNKNOWN };
    return {
      byId: HOME_ID,
      byName: 'Наша дружина',
      since: siegeSince(c),
      starvesAt: w.starvesAt ?? starvesAt(c),
      // Гарнизон — той же точностью, что мощь из реестра: точное число окна осады нападающему не показывается.
      garrison: estimate(c.garrisonAtStart, power.precision),
      foodAtStart: c.foodAtStart,
      campMen: men,
      builders: c.builders ?? men,
      ...(c.gateAt !== undefined ? { gateAt: c.gateAt } : {}),
      ...(c.rearGateAt !== undefined ? { rearGateAt: c.rearGateAt } : {}),
      ...(c.wood !== undefined ? { wood: c.wood } : {}),
      fate: w.fate,
      targetId: w.defCastle,
      targetName: this.warCity(w, 'def'),
      castle: true,
      lair: false,
      stage: card ? this.castleView(card, now, this.sightDiscs(now)).stage : 'stronghold',
      power,
      fates: this.warFates(w.defCastle, now),
      // Древесину под городом соседа не делят (сервер войны: всё к городу) — кнопок нет, есть строка.
      woodFixed: WOOD_FIXED,
      // Полководец города идёт на лагерь — удар лежит в записи войны у обеих сторон (`WarView.strike`).
      ...(w.strike
        ? { relief: { from: this.warCity(w, 'def'), men: troopTotal(w.strike.army.troops as TroopStack), at: w.strike.at, joint: w.strike.joint } }
        : {}),
      men: troopTotal(troops),
      // Штурм из лагеря под городом игрока — та же цена, и сервер спросит её той же дверью.
      storm: this.energyCost('general', 'storm', now),
      // У города игрока стена есть: обстрел ломает её и бьёт по духу гарнизона; дела и цены сервер проверит той же дверью.
      crafts: this.craftMenu(c, now, true),
      ...this.craftNoteOf(c, true),
      machines: this.machinesView(c, now, true),
      ...this.restViews(camp, undefined),
      phases: this.phasesView(c, now, true),
      parley: this.parleyAtk(c, now, w.fate, null),
      // Р-5: цель артиллерии и кольцо.
      aim: this.aimView(c, now),
      // Мощь гарнизона соседа не видна (ОС-1в): соотношение — вилкой, та же, что у «Полей города»; решает сервер.
      blockade: this.blockadeView(c, now, 0, 0, true, this.warRatio(w, c, now)),
      // Лагерь тает (ОС-1б): соотношение — той же вилкой, и куда оно идёт за фазы.
      melt: this.campMelt(w, c, now),
    };
  }

  /**
   * Соотношение сил лагеря под городом игрока глазами нападающего (ОС-1в): мощь гарнизона ему не видна (мощь реестра — посёлок
   * и вся дружина со слов игрока, не гарнизон), и знание о соотношении — вилка из двух правд. Штраф сервера (`WarCamp.cut` →
   * `siegefood.ratioRangeOfCut`): внутри кривой — точное число на последний пересчёт, на краях — полупрямая. Разведка лазутчика
   * (`SpyIntel.home` — гарнизон той же меркой, что у решения сервера): мощь лагеря сейчас к гарнизону на минуту разведки,
   * вилкой правила старения разведки (`intel.precisionOf`). Одна вилка на «Поля города» и «Кольцо».
   */
  private warRatio(w: WarView, c: SiegeWindow, now: number): RatioRange {
    return ratioWithin(c.cut !== undefined ? ratioRangeOfCut(c.cut) : { lo: 0, hi: Infinity }, this.spyRatio(w, c, now));
  }

  /** Вилка соотношения по последней разведке лазутчика у этого города; разведки нет или она устарела — null. */
  private spyRatio(w: WarView, c: SiegeWindow, now: number): RatioRange | null {
    let at = -Infinity;
    let home: TroopStack | null = null;
    for (const x of this.spyList()) {
      const seen = x.out?.at ?? x.arriveAt;
      if (x.role === 'atk' && x.defCastle === w.defCastle && x.out?.ok && x.out.intel && seen > at) {
        at = seen;
        home = x.out.intel.home as TroopStack;
      }
    }
    const precision = home ? precisionOf(now - at) : 'unknown';
    if (!home || precision === 'unknown') return null;
    const spread = precision === 'exact' ? 0 : precision === 'rough' ? INTEL_ROUGH_SPREAD : INTEL_VAGUE_SPREAD;
    const g = troopPower(home);
    const camp = troopPower(w.army.troops as TroopStack) * (1 - (c.fire ? fireView(c.fire, now).thin : 0));
    return { lo: blockadeRatio(camp, g * (1 + spread)), hi: blockadeRatio(camp, g * (1 - spread)) };
  }

  /**
   * Лагерь под городом игрока тает (ОС-1б, docs/siege_v2.md, 23.9): соотношение сил — вилка `warRatio` (та же, что у кольца),
   * доля лагеря за фазу «без перемен» — та же `siegeroll.wasteOf`, что у шага сервера (путь от дома, пустой амбар дома —
   * вдвое), и через сколько фаз штраф упадёт к среднему по краям вилки, если ничего больше не случится (`phasesToEven`).
   */
  private campMelt(w: WarView, c: SiegeWindow, now: number): CampMelt {
    const range = this.warRatio(w, c, now);
    const waste = wasteOf('calm', c.homeDays, (this.save.profile?.food ?? 1) <= 0, campFed(c.gait));
    const soon = phasesToEven(range.lo, waste);
    const late = phasesToEven(range.hi, waste);
    const at = (k: number | null): number | undefined => (k ? phaseAt(siegeSince(c), rowsOf(c).length + k) : undefined);
    return { cut: c.cut ?? CUT_MAX, range, waste, soon, late, ...(soon ? { soonAt: at(soon) } : {}), ...(late ? { lateAt: at(late) } : {}) };
  }

  /**
   * Осадные машины и способы штурма глазами окна лагеря (docs/siege_v2.md, 4.3–4.4) — дверями `world/machines` и
   * `world/wall`: готовность — та же очередь, что у штурма; что откроет машина — та же стена, что у боя. `walls` — есть ли у
   * цели стена (город игрока); у двора мира и логова её нет.
   */
  private machinesView(w: SiegeWindow, now: number, walls: boolean): MachinesView {
    const list = machinesAt(w, now);
    const breaches = walls ? breachesOf(w) : 0;
    const methods: StormMethod[] = walls
      ? stormMachines(w, now).map((id) => {
          const words = wallFront(assaultOf(breaches, [id]))
            .openings.filter((o) => o.id !== 'breach' && o.id !== 'scaling')
            .map((o) => openingWords(o))
            .join(' ');
          return { machine: id, words };
        })
      : [];
    return {
      share: machineShare(w.wood),
      walls,
      breaches,
      methods,
      list: MACHINE_IDS.map((id) => {
        const mine = list.filter((e) => e.id === id && !(e.spent !== undefined && e.spent <= now));
        const ready = mine.some((e) => e.ready);
        const reason = machineBlock(w, id, now, walls);
        return {
          id,
          name: MACHINE_NAME[id],
          use: MACHINE_USE[id],
          wood: MACHINE_WOOD[id],
          state: ready ? 'ready' : mine.length > 0 ? 'building' : 'none',
          ...(mine.length > 0 && !ready ? { readyAt: mine[0].readyAt } : {}),
          can: reason === null,
          reason,
        };
      }),
    };
  }

  /**
   * Строки участи против города игрока: что получит победитель — той же дверью, что взятие, с конвоем
   * дружины и населением, какое игрок знает. Замки гейта — свои; «сжечь» против игрока доступно.
   */
  private warFates(id: SettlementId, now: number): FateOption[] {
    const men = troopTotal(this.save.figures.general.troops ?? {});
    // Конвой — той же дверью, что у взятия: строка выбора и сам увод не расходятся.
    const escort = this.haul({ warrior: men }, true).escort;
    const c = this.castleOf(id);
    const pop = c ? Math.max(0, Math.floor(c.pop)) : 0;
    // Город игрока — та же дверь участи, что у нашего города (`fateHome`): склад чужого не виден, людей — столько,
    // сколько владелец о себе написал в реестре.
    const known = { stock: {}, gold: 0, stash: 0, pop, bonded: 0, levels: {} } as unknown as PlayerProfile;
    return FATE_IDS.map((fid) => {
      const r = this.fateHome(known, Infinity, escort, now, fid);
      const reason = fateBlock(fid, 'player', undefined, now, this.playerLocks());
      const led = r.ledBonded.taken + r.ledPop.taken;
      return { id: fid, can: reason === null, reason, led: { min: 0, max: led }, less: { min: 0, max: r.lessGoods } };
    });
  }

  /** Поход на город игрока глазами карточки: можно ли выступить, сколько идти, что с войной сейчас. */
  private warCard(c: PlayerCastle, now: number): CardWar | undefined {
    if (!this.warsFrom) return undefined;
    const f = this.save.figures.general;
    const troops = f.troops ?? {};
    // Срок пути — та же формула, что у сервера, с его темпом войны и в режиме марша (ДР-2): сам срок прихода назовёт сервер.
    const walkMs = Math.round(warWalkMs(this.save.home, c, f.gait) / this.warPaceOf());
    const gaits = this.gaitRows((g) => Math.round(warWalkMs(this.save.home, c, g) / this.warPaceOf()), 'siege', now);
    const mine = this.warList().find((w) => w.role === 'atk' && w.defCastle === c.id && w.phase !== 'done');
    const theirs = this.warList().find((w) => w.role === 'def' && w.atkCastle === c.id && (w.phase === 'march' || w.phase === 'camp'));
    return {
      can: this.warBlock(c, now) === null,
      reason: this.warBlock(c, now),
      walkMs,
      men: troopTotal(troops),
      power: troopPower(troops),
      energy: { storm: this.warEnergy(c, 'storm', now), siege: this.warEnergy(c, 'siege', now) },
      gaits,
      ...this.campStormOf(now, walkMs),
      ...(mine && mine.phase !== 'done'
        ? {
            ours: {
              phase: mine.phase,
              mode: mine.mode,
              arriveAt: mine.arriveAt,
              ...(mine.starvesAt !== undefined ? { starvesAt: mine.starvesAt } : {}),
              ...(mine.backAt !== undefined ? { backAt: mine.backAt } : {}),
            },
          }
        : {}),
      ...(theirs ? { theirs: { phase: theirs.phase as 'march' | 'camp', arriveAt: theirs.arriveAt } } : {}),
      ...this.pactOf(c),
    };
  }

  // ---------- Пакт и выручка союзника (docs/siege_v2.md, раздел 5; этап 2г) ----------

  /** Пакт с городом и выручка союзника в осаде — поля карточки. */
  private pactOf(c: PlayerCastle): Pick<CardWar, 'pact' | 'pactBreakAt' | 'relief'> {
    const p = this.pactsFrom?.().find((x) => x.castle === c.id);
    if (!p) return {};
    const relief = p.state === 'pact' ? this.reliefPlan(c, this.clock()) : null;
    return { pact: p.state, ...(p.breakAt !== undefined ? { pactBreakAt: p.breakAt } : {}), ...(relief ? { relief } : {}) };
  }

  /**
   * Чем занят полководец у сервера войны (BTL-2, OWNER-DECISIONS п. 9: один полководец — одно действие): ведёт поход на соседа
   * (`WAR_BUSY`), его выручка союзнику в пути или его удар по лагерю у своих стен ждёт минуты прихода — то же правило, что у
   * сервера (`war.generalBusy`). Выручка и удар лежат в войнах с сервера, пока не сошлись в бою.
   */
  private warGeneralBusy(): string | null {
    if (this.save.figures.general.war) return WAR_BUSY;
    const wars = this.warList();
    if (wars.some((w) => w.role === 'ally' && w.reliefs?.some((r) => r.castle === w.me))) return GENERAL_RELIEVES;
    if (wars.some((w) => w.role === 'def' && w.strike)) return GENERAL_STRIKES;
    return null;
  }

  /** Осада союзника, на которую можно прийти на выручку. */
  private allySiege(c: PlayerCastle): WarView | null {
    return this.warList().find((w) => w.role === 'ally' && w.defCastle === c.id && w.phase === 'camp' && w.camp) ?? null;
  }

  /**
   * Выручка союзника до приказа (раздел 5): полководец из поля идёт к его городу и бьёт лагерь с тыла — тем же правилом,
   * что удар полководца по лагерю у своих стен (`warStrikePlan`): срок пути, хлеб союзника и цена удара в энергии.
   */
  private reliefPlan(c: PlayerCastle, now: number, out = false): ReliefPlan | null {
    const w = this.allySiege(c);
    if (!w) return null;
    const f = this.save.figures.general;
    // Дело из «Походов» (`out`, Р-4): полководец выходит на выручку из своих ворот с отрядом — дверью выхода `siegeBlock`.
    const leaving = out && postureOf(f, now) === 'stands';
    const force = leaving ? { ...(f.troops ?? {}) } : fieldTroops(f, now);
    const no = (reason: string): ReliefPlan => ({ can: false, reason, seconds: asGame(0), men: troopTotal(force) });
    const going = w.reliefs?.find((r) => r.castle === w.me);
    if (going) return { ...no('Наша дружина уже идёт на выручку.'), going: going.at };
    const off = this.offDuty('general', now) ?? this.retiringBlock('general');
    if (off) return no(off);
    const busy = this.warGeneralBusy();
    if (busy) return no(busy);
    this.settleHandover(f, now);
    if (f.handover) return no(`Отряд ещё в сборе: ${formatLeft(Math.max(0, f.handover.until - now) / 1000)}.`);
    if (troopTotal(f.troops ?? {}) === 0) return no(this.noBand(now));
    if (leaving) {
      const blocked = this.siegeBlock(now);
      if (blocked) return no(blocked);
    }
    if (troopTotal(force) === 0) return no('Полководец в городе. На выручку идут из поля: выведи его за ворота.');
    const from = this.figureAt(f, now);
    const seconds = fieldWalkSeconds(from, c, terrainFactor(this.save.seed, from, c), f.gait);
    if (now + realMs(seconds) >= (w.starvesAt ?? Infinity)) return no('Не успеть: хлеб у союзника кончится раньше.');
    const energy = this.energyCost('general', 'strike', now, realMs(seconds));
    return { can: !energy.block, reason: energy.block, seconds, men: troopTotal(force), energy };
  }

  // ---------- Соседи в «Вестях» (ДП-1) ----------

  /** Предложения с сервера войны: ждущие ответа и итоги. */
  private proposalList(): ProposalView[] {
    return this.proposalsFrom?.() ?? [];
  }

  async rivals(): Promise<RivalMail> {
    const marching = this.warList()
      .filter((w) => w.role === 'def' && w.phase === 'march')
      .map((w) => ({ id: w.id, castle: w.atkCastle, city: this.warCity(w, 'atk'), mode: w.mode, arriveAt: w.arriveAt, ...(typeof w.sentAt === 'number' ? { sentAt: w.sentAt } : {}) }));
    return { proposals: this.proposalList(), marching };
  }

  async answerProposal(id: string, act: ProposalAct): Promise<string | null> {
    return this.warSend({ op: 'deal', id, act });
  }

  /**
   * Итоги предложений и походы соседей на нас — в летопись, каждое один раз (`warSeen`), обеим сторонам своими словами
   * (ДП-1). Ключ последствия — `dip-…`: летопись относит его к «Соседям» (`annals.refTopic`).
   */
  private stepRivals(list: readonly WarView[], seen: Set<string>): void {
    for (const p of [...this.proposalList()].reverse()) {
      if (!p.end) continue;
      const id = proposalSeenId(p);
      if (seen.has(id)) continue;
      seen.add(id);
      const good = p.end === 'yes' || (p.endBy === 'us' && p.end !== 'broken');
      this.addEffect({ id, lost: {}, resources: {}, prestige: 0, morale: 0, battle: null, text: endWords(p), good });
    }
    for (const w of [...list].reverse()) {
      if (w.role !== 'def') continue;
      const id = rivalWarId(w.id);
      if (seen.has(id)) continue;
      seen.add(id);
      const how = w.mode === 'storm' ? 'на штурм' : 'осадой';
      this.addEffect({ id, lost: {}, resources: {}, prestige: 0, morale: 0, battle: null, text: `«${this.warCity(w, 'atk')}» идёт на нас походом — ${how}.`, good: false });
    }
  }

  /**
   * Пакт с соседом-игроком (раздел 5): `on` — предложить или принять; нет — разорвать, отозвать или отклонить. Пакт значит
   * одно: союзник может прийти на выручку, а походом на него не пойти. Хранит его сервер войны.
   */
  async pact(castle: SettlementId, on: boolean): Promise<string | null> {
    return this.warSend(on ? { op: 'pact', target: castle } : { op: 'unpact', target: castle });
  }

  /**
   * На выручку союзнику (раздел 5): полководец из поля идёт к его городу и бьёт лагерь с тыла в минуту прихода — бой
   * считает сервер войны. Цена удара — при приказе, как у удара по лагерю у своих стен.
   */
  async relief(castle: SettlementId, out = false): Promise<string | null> {
    const now = this.clock();
    const c = this.castleOf(castle);
    const w = c ? this.allySiege(c) : null;
    if (!c || !w) return 'Союзник не в осаде.';
    const plan = this.reliefPlan(c, now, out);
    if (!plan?.can) return plan?.reason ?? 'Союзник не в осаде.';
    const f = this.save.figures.general;
    const walkMs = Math.round(realMs(plan.seconds));
    // Налегке выручка тает в пути (ДР-2, М4): уход за дорогу считает сервер (ДР-5, `gait.strikeWorn`), приказ несёт состав
    // на выходе — списанный к этой минуте; мир списывает за дорогу ровно то же (`strikeLeg`).
    this.wearGeneral(now);
    const force = out && postureOf(f, now) === 'stands' ? { ...(f.troops ?? {}) } : fieldTroops(f, now);
    const from = this.spotOf(f, now);
    const err = await this.warSend({
      op: 'relief',
      id: w.id,
      walkMs,
      // Откуда идёт — сервер сверяет срок с расстоянием и место со слепком (docs/security.md, ЗЩ-2).
      from,
      ...(f.gait ? { gait: f.gait } : {}),
      army: {
        troops: force as Counts,
        resolve: 0,
        ...spiritField(this.generalSpirit()),
        pips: { ...this.generalPips() } as Counts,
        ...(f.rest ? { rest: { ...f.rest } } : {}),
        energy: { ...this.energyOf('general', now) },
      },
    });
    if (err) return err;
    // Полководец идёт к городу союзника той же ходьбой, что всякая фигура, а приходит в минуту удара, названную сервером.
    f.chase = undefined;
    this.walk('general', { x: c.x, y: c.y }, now);
    this.strikeLeg(now, Math.round(walkMs / this.warPaceOf()), strikeSeed('relief', w.id, from, walkMs));
    const at = this.warList()
      .find((x) => x.id === w.id)
      ?.reliefs?.find((r) => r.castle === w.me)?.at;
    if (at !== undefined) f.arriveAt = Math.max(now, at);
    this.payEnergy('general', 'strike', now);
    this.write();
    return null;
  }

  /**
   * Вылазка на машину лагеря (docs/siege_v2.md, раздел 5): вышедшие из ворот бьются с охраной машины, победа сжигает её.
   * Лагерь логова машин не строит; под лагерем игрока бой считает сервер войны (`fights.machineFight`).
   */
  async burnMachine(id: MachineId, troops: TroopStack): Promise<AttackResult> {
    const now = this.clock();
    const own = this.homeSiege(now);
    if (own) return { error: burnBlock(own, id, now) ?? 'Лагерь логова машин не строит.', reportId: null, won: false };
    const w = this.warOnUs();
    if (!w?.camp) return { error: 'Под стенами никого.', reportId: null, won: false };
    const why = burnBlock(w.camp as unknown as SiegeWindow, id, now);
    if (why) return { error: why, reportId: null, won: false };
    const home = this.defenders(now).all;
    const going = pickTroops(troops, home);
    if (!going) return { error: 'Столько бойцов дома нет.', reportId: null, won: false };
    if (troopTotal(going) === 0) return { error: 'Отряд пустой.', reportId: null, won: false };
    const err = await this.warSend({ op: 'sally', id: w.id, machine: id, troops: going as Counts });
    return err ? { error: err, reportId: null, won: false } : { error: null, ...this.warReportOf(w.id) };
  }

  /** Почему поход на этот город сейчас нельзя. Последнее слово — у сервера: он знает и чужой слепок. */
  private warBlock(c: PlayerCastle, now: number): string | null {
    if (!this.warOrderTo) return 'Война между игроками идёт только в Telegram.';
    const f = this.save.figures.general;
    const off = this.offDuty('general', now) ?? this.retiringBlock('general');
    if (off) return off;
    if (f.war) return 'Полководец уже в походе.';
    const busy = this.warGeneralBusy();
    if (busy) return busy;
    if (this.ourSiege(now)) return `${CAMP_BUSY} ${CAMP_LEAVE}`;
    const sieged = this.siegeBlock(now);
    if (sieged) return sieged;
    // Пакт и отсчёт его разрыва (АУ-8, п. 1) — та же проверка, по которой откажет сервер войны (`war.march`).
    const pact = pactWarBlock(this.pactsFrom?.().find((x) => x.castle === c.id), now);
    if (pact) return pact;
    if (!this.inRealm(c)) return this.beyond();
    this.settleHandover(f, now);
    if (f.handover) return `Отряд ещё в сборе: ${formatLeft(Math.max(0, f.handover.until - now) / 1000)}.`;
    if (f.phase !== 'home') return 'Поход выходит из своего города: верни полководца домой.';
    if (troopTotal(f.troops ?? {}) === 0) return NO_BAND_HOME;
    // Энергии — хотя бы на поход с осадой, дешевле из двух дел у стен; какое дело — решает кнопка (`warEnergy`).
    return this.warEnergy(c, 'siege', now).block;
  }

  /**
   * Цена похода на город игрока в энергии полководца: дело у стен — ценой, и её должно хватить к минуте прихода, с
   * дорогой по дням пути (`data/energy`, docs/agent_energy.md, раздел 2). Ту же проверку делает сервер той же дверью
   * (`netlify/lib/war.ts`): путь — `pvp.warWalkMs` с темпом войны, как у сервера.
   */
  private warEnergy(c: PlayerCastle, mode: 'storm' | 'siege', now: number): EnergyCost {
    const walkMs = Math.round(warWalkMs(this.save.home, c, this.save.figures.general.gait) / this.warPaceOf());
    return this.energyCost('general', mode, now, walkMs);
  }

  /** Слепок обороны для записи партии (`SaveRecord.war`): его читает сервер, когда на нас идут. */
  warSheet(): WarSheet | null {
    const p = this.save.profile;
    if (!p) return null;
    const now = this.clock();
    const held = this.defenders(now);
    const militia = Math.max(0, Math.round(p.militia ?? 0));
    const archers = Math.min(militia, Math.max(0, Math.round(p.militiaArchers ?? 0)));
    return {
      army: { ...(p.army ?? {}) } as Counts,
      home: { ...held.all } as Counts,
      militia,
      archers,
      resolve: 0,
      ...spiritField(this.ownSpirit()),
      pips: { ...this.homePips(now) } as Counts,
      // Полководец в городе (ДР-3): с ним у стен и командиры флангов — их тактику ставит сервер своей книгой.
      ...(inTown(this.save.figures.general, now) ? { led: true as const } : {}),
      rest: this.homeRest(held, now, militia),
      food: Math.max(0, p.food ?? 0),
      townPerHour: Math.max(0, p.foodPerHour ?? 0),
      perManPerHour: Math.max(0, p.soldierFoodPerHour ?? 0),
      stock: { ...(p.stock ?? {}) } as Counts,
      stash: Math.max(0, p.stash ?? 0),
      gold: Math.max(0, Math.floor(p.gold ?? 0)),
      pop: Math.max(0, p.pop ?? 0),
      bonded: Math.max(0, p.bonded ?? 0),
      levels: { ...(p.levels ?? {}) },
      power: troopPower(p.army ?? {}),
      locks: { ...(p.fateLocks ?? {}) },
      seen: [...(this.save.warSeen ?? [])],
      // Готовое орудие башни (docs/siege_v2.md, раздел 5): сервер войны бьёт им по лагерю соседа той же дверью (`world/bombard`).
      ...(p.tower ? { tower: { ...p.tower } } : {}),
      // Раскладка (docs/retinue.md): какая часть гарнизона может уйти с полководцем, и в каком своём походе он сейчас. По
      // ним сервер правит слепок, лёгший до выхода или до возврата (`war.liveSheet`). С ДР-6 полководец в городе берёт
      // состав из всего гарнизона в минуту выхода (`takeBand`) — может уйти любой; вне города — никто из стоящих дома.
      retinue: { ...(inTown(this.save.figures.general, now) ? held.all : held.standing) } as Counts,
      out: this.save.figures.general.war ? [this.save.figures.general.war] : [],
      // Тайная служба (docs/spy_pvp.md): Дозор, скрытность и черта своего лазутчика и стоит ли он дома — нападающему шанс
      // и гибель его дела, защитнику охрана от чужого.
      watch: {
        keen: Math.max(1, p.intelKeen ?? 1),
        veil: Math.max(0, Math.min(1, p.veil ?? 1)),
        stealth: Math.max(0, Math.min(1, p.stealth ?? 0)),
        held: this.traitOf('held'),
        home: this.spyHome(),
      },
      time: this.villageTime(now),
      // Где полководец: с этим местом сервер сверяет, откуда приказ ведёт удар или выручку (docs/security.md, ЗЩ-2).
      gen: this.spotOf(this.save.figures.general, now),
    };
  }

  /** Клетка фигуры для сервера войны — та же, от которой мир считает её дорогу (`figureAt`). */
  private spotOf(f: StoredFigure, now: number): { x: number; y: number } {
    const at = this.figureAt(f, now);
    return { x: at.x, y: at.y };
  }

  /**
   * «Объявить» в лагере под городом игрока — приказом серверу: проверит участь и объявит он, той же дверью, что при выходе
   * (`war.fateWhy`). Принятое — строкой летописи, как у лагеря под логовом (`besiege`).
   */
  private async warDeclare(w: WarView, fateId: Fate, now: number): Promise<string | null> {
    const err = await this.warSend({ op: 'fate', id: w.id, fate: fateId });
    if (err) return err;
    this.addEffect({
      id: `camp-fate-${w.defCastle}-${now}`,
      lost: {},
      resources: {},
      prestige: 0,
      morale: 0,
      battle: null,
      text: `Город ${this.warCity(w, 'def')}: объявлена участь «${FATE_META[fateId].name.toLowerCase()}».`,
      good: true,
    });
    this.write();
    return null;
  }

  /**
   * Хватит ли после осады на штурм из лагеря — до выхода, одной строкой на поход к городу игрока и на осаду у ворот логова
   * (docs/siege_audit.md, решение 9). В лагере энергия стоит: что останется у стен после дороги (`road`, мс пути) и цены
   * лагеря, то и будет на штурм. Осада сама не по карману — строки нет: об этом скажет её отказ.
   */
  private campStormOf(now: number, road = 0): { campStorm?: string } {
    const have = this.energyNow('general', now);
    // Дорога — в темпе режима марша (ДР-2, М8).
    const rate = gaitSpeed(this.save.figures.general.gait);
    if (this.isSpent('general', now) || energyBlock(have, priceOf('siege'), road, rate)) return {};
    const left = leftAfter(have, priceOf('siege'), road, rate);
    const storm = priceOf('storm');
    const shown = shownEnergy(left);
    return {
      campStorm:
        energyBlock(left, storm) === null
          ? `После осады у стен останется ${shown} энергии: хватит и на штурм из лагеря (${storm}).`
          : `После осады у стен останется ${shown} энергии: на штурм из лагеря (${storm}) не хватит. В лагере она не копится, город возьмёт только голод.`,
    };
  }

  /** Отдать приказ войны и сразу применить, что изменилось. */
  private async warSend(order: WarOrder): Promise<string | null> {
    if (!this.warOrderTo) return 'Война между игроками идёт только в Telegram.';
    const err = await this.warOrderTo(order);
    this.stepWars(this.clock());
    this.write();
    return err;
  }

  async warMarch(target: SettlementId, mode: 'storm' | 'siege', fateId: Fate, ring = false): Promise<string | null> {
    const now = this.clock();
    const c = this.castleOf(target);
    if (!c) return 'Этого города нет на карте.';
    const block = this.warBlock(c, now);
    if (block) return block;
    const reason = fateBlock(fateId, 'player', undefined, now, this.playerLocks());
    if (reason) return reason;
    const tired = this.warEnergy(c, mode, now).block;
    if (tired) return tired;
    const f = this.save.figures.general;
    // Налегке лагерь не встаёт (ДР-2, М7) — та же проверка, что у сервера.
    const noCamp = mode === 'siege' ? siegeBlockOf(f.gait) : null;
    if (noCamp) return noCamp;
    const troops = { ...(f.troops ?? {}) };
    const rest = f.rest;
    // Войском похода владеет сервер: истощение налегке с выхода считает он (`war.wearLight`), своё мир снимает.
    this.wearGeneral(now);
    f.wear = undefined;
    return this.warSend({
      op: 'march',
      target,
      mode,
      fate: fateId,
      // «Блокада» из «Походов» (Р-5): кольцо замкнёт сервер в минуту постановки, если мощи хватит.
      ...(ring && mode === 'siege' ? { blockade: true as const } : {}),
      ...(f.gait ? { gait: f.gait } : {}),
      army: {
        troops: troops as Counts,
        resolve: 0,
        ...spiritField(this.generalSpirit()),
        pips: { ...this.generalPips() } as Counts,
        ...(rest ? { rest: { ...rest } } : {}),
        // Энергия полководца — отметкой: цену дела у стен и дорогу считает сервер той же дверью (`world/energy`).
        energy: { ...this.energyOf('general', now) },
      },
    });
  }

  /** Город игрока, под которым стоит наш лагерь войны. */
  private warCampOf(): SettlementId | null {
    const led = this.warLed();
    return led && led.phase === 'camp' ? led.defCastle : null;
  }

  /** Вылазка на лагерь игрока: состав — приказом, бой — у сервера, той же дверью, что у лагеря логова. */
  private async warSortie(w: WarView, troops: TroopStack, now: number): Promise<AttackResult> {
    const home = this.defenders(now).all;
    const going = pickTroops(troops, home);
    if (!going) return { error: 'Столько бойцов дома нет.', reportId: null, won: false };
    if (troopTotal(going) === 0) return { error: 'Отряд пустой.', reportId: null, won: false };
    const err = await this.warSend({ op: 'sortie', id: w.id, troops: going as Counts });
    return err ? { error: err, reportId: null, won: false } : { error: null, ...this.warReportOf(w.id) };
  }

  /** Удар полководца по лагерю игрока под нашими стенами — до приказа: та же `strikeForecast`, что бой. */
  private warStrikePlan(w: WarView, garrison: boolean, now: number): StrikePlan {
    const rout = perilShare(routPeril(0));
    const no = (reason: string): StrikePlan => ({ can: false, reason, seconds: asGame(0), rear: { went: 0, passed: 0 }, front: null, garrisonable: true, rout });
    const f = this.save.figures.general;
    const off = this.offDuty('general', now) ?? this.retiringBlock('general');
    if (off) return no(off);
    // Удар по этому лагерю уже идёт — та же проверка: полководец бьёт лагерь у своих стен (BTL-2).
    const busy = this.warGeneralBusy();
    if (busy) return no(busy);
    this.settleHandover(f, now);
    if (f.handover) return no(`Отряд ещё в сборе: ${formatLeft(Math.max(0, f.handover.until - now) / 1000)}.`);
    // Из города лагерь у своих стен бьют вылазкой — этот отказ, а не «отряда нет» (ДР-6, как `strikeCheck`).
    if (inTown(f, now)) return no(STRIKE_FROM_TOWN);
    if (troopTotal(f.troops ?? {}) === 0) return no('При полководце нет отряда.');
    const force = fieldTroops(f, now);
    if (troopTotal(force) === 0) return no(STRIKE_FROM_TOWN);
    const c = this.warWindow(w);
    if (!c) return no('Под этими стенами лагеря нет.');
    const from = this.figureAt(f, now);
    const to = this.save.home;
    const seconds = fieldWalkSeconds(from, to, terrainFactor(this.save.seed, from, to), f.gait);
    const arriveAt = now + realMs(seconds);
    if (arriveAt >= (w.starvesAt ?? Infinity)) return no('Не успеть: хлеб в городе кончится раньше.');
    const going = garrison ? this.garrison(now) : null;
    const cast = strikeForecast(
      { since: siegeSince(c), builders: c.builders ?? 0, gateAt: c.gateAt, rearGateAt: c.rearGateAt, wood: c.wood },
      arriveAt,
      kindsOf(force),
      going ? kindsOf(going) : null,
    );
    const refused = refusedAtGate(cast.rear, cast.front);
    // Удар — бой: цена в энергии — к минуте прихода, с дорогой (та же, что у удара по лагерю логова).
    const energy = this.energyCost('general', 'strike', now, realMs(seconds));
    return {
      can: !refused && !energy.block,
      reason: refused ? gateBusyText(Math.max(cast.rear.waitMs, cast.front?.waitMs ?? 0) + realMs(seconds)) : energy.block,
      seconds,
      rear: { went: cast.rear.went, passed: cast.rear.passed },
      front: cast.front ? { went: cast.front.went, passed: cast.front.passed } : null,
      garrisonable: true,
      rout,
      energy,
    };
  }

  /**
   * Удар полководца по лагерю игрока: дружина — с тыла, гарнизон, если зовут, — со стороны города. Бой
   * случится в минуту прихода, и считает его сервер; полководец идёт к своим воротам этой же дорогой.
   */
  private async warStrike(w: WarView, garrison: boolean, now: number): Promise<string | null> {
    const plan = this.warStrikePlan(w, garrison, now);
    if (!plan.can) return plan.reason;
    const f = this.save.figures.general;
    const walkMs = Math.round(realMs(plan.seconds));
    // Налегке дружина тает в пути (ДР-2, М4): уход за дорогу считает сервер (ДР-5, `gait.strikeWorn`), приказ несёт состав на
    // выходе — списанный к этой минуте; мир списывает за дорогу ровно то же (`strikeLeg`).
    this.wearGeneral(now);
    const force = fieldTroops(f, now);
    const from = this.spotOf(f, now);
    const err = await this.warSend({
      op: 'strike',
      id: w.id,
      joint: garrison,
      walkMs,
      from,
      ...(f.gait ? { gait: f.gait } : {}),
      army: {
        troops: force as Counts,
        resolve: 0,
        ...spiritField(this.generalSpirit()),
        pips: { ...this.generalPips() } as Counts,
        ...(f.rest ? { rest: { ...f.rest } } : {}),
        energy: { ...this.energyOf('general', now) },
      },
    });
    if (err) return err;
    // Полководец идёт к своим воротам той же ходьбой, что всякая фигура (`walk`), а приходит в минуту удара,
    // названную сервером: у сервера может стоять темп войны.
    if (walkMs > 0) {
      f.chase = undefined;
      this.walk('general', { ...this.save.home }, now);
      this.strikeLeg(now, Math.round(walkMs / this.warPaceOf()), strikeSeed('strike', w.id, from, walkMs));
      const at = this.warList().find((x) => x.id === w.id)?.strike?.at;
      if (at !== undefined) f.arriveAt = Math.max(now, at);
    }
    // Цена удара — при приказе, как у удара по лагерю логова.
    this.payEnergy('general', 'strike', now);
    this.write();
    return null;
  }

  /** Последний свежий бой войны — отчётом, для ответа на приказ «ударить». */
  private warReportOf(id: string): { reportId: string | null; won: boolean } {
    const w = this.warList().find((x) => x.id === id);
    const b = w?.battles[w.battles.length - 1];
    if (!w || !b) return { reportId: null, won: false };
    return { reportId: `war-${b.id}`, won: b.won === (b.by === w.role) };
  }

  // ---------- Лазутчик против соседа (docs/spy_pvp.md) ----------
  //
  // Исход тайного дела считает сервер войны (`netlify/lib/war.ts` через `world/rivalspy`), как бой. Мир на клиенте
  // делает то же, что с войной: показывает лазутчика там, где он по словам сервера (идёт, в плену, идёт домой),
  // применяет итог своей стороны ровно один раз (`warSeen`, отметка `<номер>.spy`) и отдаёт приказ — по меню, которое
  // посчитал сервер. Своего исхода у него нет.

  /** Дела лазутчиков из последнего ответа сервера. Сервера нет — пусто. */
  private spyList(): SpyView[] {
    return this.spiesFrom?.() ?? [];
  }

  /** Свой лазутчик дома — у ворот или в городе, в строю и не на деле: он охраняет город от чужого. */
  private spyHome(): boolean {
    const f = this.save.figures.spy;
    return !f.gone && !f.rival && f.phase === 'home';
  }

  /** Чем занят лазутчик на деле у соседа — словами отказа. */
  private rivalNote(now: number): string {
    const f = this.save.figures.spy;
    const x = this.spyList().find((v) => v.id === f.rival);
    const name = x ? cityOr(x.defCity) : 'соседа';
    if (x?.phase === 'held') return `Лазутчика держат в «${name}», отпустят через ${formatLeft(Math.max(0, (x.releaseAt ?? now) - now) / 1000)}.`;
    if (x?.phase === 'back') return `Лазутчик идёт домой от «${name}», дома через ${formatLeft(Math.max(0, (x.backAt ?? now) - now) / 1000)}.`;
    return `Лазутчик на тайном деле у «${name}». Вернётся сам.`;
  }

  /**
   * Итоги тайных дел — в отчёты и последствия, каждое ровно один раз (`warSeen`), и лазутчик — туда, где он по словам
   * сервера. Зовётся из `stepWars` с тем же списком принятого.
   */
  private stepSpies(now: number, seen: Set<string>): void {
    if (!this.spiesFrom) return;
    const list = this.spyList();
    for (const x of [...list].reverse()) {
      const sid = spySeenId(x.id);
      if (x.out && !seen.has(sid) && x.out.at <= now) {
        seen.add(sid);
        this.spyDeed(x, x.out);
      }
      if (x.role === 'atk') this.rivalSpy(x, now);
    }
    // Лазутчик числится на деле, которого у сервера больше нет: он дома с тем, что было при нём.
    const led = this.save.figures.spy.rival;
    if (led && this.warsKnown?.() && !list.some((x) => x.id === led)) this.rivalHome(now, null);
  }

  /** Лазутчик — где он по словам сервера: идёт к соседу, в плену, идёт домой. */
  private rivalSpy(x: SpyView, now: number): void {
    const f = this.save.figures.spy;
    if (x.phase === 'done') {
      if (f.rival === x.id) this.rivalHome(now, x);
      return;
    }
    if (f.gone) return;
    // Энергией лазутчика на деле владеет сервер: прежняя стойка сверяется до того, как дело её сменит.
    if (!f.rival) this.energyOf('spy', now);
    f.rival = x.id;
    f.watching = false;
    f.sheltered = undefined;
    f.spent = undefined;
    const home = { ...this.save.home };
    if (x.phase === 'go') {
      f.from = home;
      f.to = { ...x.to };
      f.departAt = x.sentAt;
      f.arriveAt = x.arriveAt;
      f.phase = now < x.arriveAt ? 'moving' : 'field';
      f.held = false;
    } else if (x.phase === 'held') {
      f.from = { ...x.to };
      f.to = { ...x.to };
      f.departAt = x.arriveAt;
      f.arriveAt = x.arriveAt;
      f.phase = 'field';
      f.held = true;
      // Держат до отпуска, названного сервером: так «задержан» видят карточка и «Походы».
      f.busyUntil = x.releaseAt ?? f.busyUntil;
    } else {
      f.from = { ...x.to };
      f.to = home;
      f.departAt = x.releaseAt ?? x.arriveAt;
      f.arriveAt = x.backAt ?? now;
      f.phase = now < f.arriveAt ? 'moving' : 'home';
      f.held = false;
    }
  }

  /** Дело кончилось: лазутчик дома. Погиб — место уже пустует (`downFigure` в `spyDeed`), его не трогают. */
  private rivalHome(now: number, x: SpyView | null): void {
    const f = this.save.figures.spy;
    f.rival = undefined;
    f.held = false;
    if (f.phase === 'down' || f.gone) return;
    // Последняя отметка дела — дома энергия копится с минуты прихода.
    if (x?.energy) f.energy = { ...x.energy };
    const at = Math.min(now, x?.backAt ?? now);
    f.from = { ...this.save.home };
    f.to = { ...this.save.home };
    f.departAt = at;
    f.arriveAt = at;
    f.phase = 'home';
  }

  /** Добро словами: «120 еды, 40 дерева». */
  private goodsWords(c: Counts | undefined): string {
    const parts = Object.entries(c ?? {})
      .filter(([, v]) => v > 0)
      .map(([k, v]) => `${RESOURCE_META[k as ResourceId]?.name.toLowerCase() ?? (k === 'gold' ? 'золото' : k)} ${v}`);
    return parts.length ? parts.join(', ') : 'ничего';
  }

  /** Итог дела — отчётом и последствием своей стороны, ровно один раз. Посчитан сервером, здесь только применяется. */
  private spyDeed(x: SpyView, o: SpyOut): void {
    const def = RIVAL_DEED_BY_ID[x.deed];
    const caught = o.held || o.dead;
    const p = this.save.profile;
    if (x.role === 'atk') {
      const name = cityOr(x.defCity);
      const spot = { id: x.defCastle, name, x: x.to.x, y: x.to.y };
      const f = this.save.figures.spy;
      const person = f.person ?? 0;
      let text: string;
      if (o.gone) text = `Города «${name}» больше нет в игре. Лазутчик идёт домой.`;
      else if (o.ok) text = this.rivalDone(x.deed, o);
      else if (o.slipped) text = 'Не вышло, но лазутчик ушёл тихо. Чей он, там не узнали, но насторожились.';
      else if (o.held) text = `Лазутчика схватили. Держат до отпуска: ${formatLeft(Math.max(0, (x.releaseAt ?? o.at) - o.at) / 1000)}.`;
      else text = 'Лазутчика схватили у ворот.';
      const stolen = o.stolen ?? {};
      this.addReport({
        id: `spy-${x.id}`,
        at: o.at,
        kind: 'scout',
        title: o.ok ? `${def.name}: ${name}` : caught ? `Лазутчик схвачен: ${name}` : `Не вышло у «${name}»`,
        target: spot,
        won: o.ok,
        sent: {},
        lost: {},
        enemyPower: null,
        enemyLost: null,
        loot: Object.keys(stolen).length ? ({ ...stolen } as Loot) : null,
        intel: null,
        battle: null,
        text,
        read: false,
      });
      if (!o.gone) {
        this.addEffect({
          id: `spy-${x.id}-eff`,
          lost: {},
          resources: { ...stolen } as Loot,
          ...(o.lured ? { pop: o.lured } : {}),
          prestige: o.ok && def.hostile ? 2 : 0,
          morale: o.ok ? 1 : o.slipped || o.dead ? 0 : AGENT_HELD_MORALE,
          battle: null,
          deed: { agent: 'spy', ok: o.ok, at: o.at, person },
          text: `${name}: ${text}`,
          good: o.ok,
        });
      }
      // Пришедшее — сразу и в слепок деревни: запись партии со слепком может уйти раньше, чем племя его примет.
      if (p) {
        const { gold, ...goods } = stolen;
        const stock: Loot = { ...(p.stock ?? {}) };
        for (const [k, v] of Object.entries(goods)) stock[k as keyof Loot] = (stock[k as keyof Loot] ?? 0) + v;
        p.stock = stock;
        p.gold = (p.gold ?? 0) + (gold ?? 0);
        p.pop = p.pop + (o.lured ?? 0);
      }
      if (o.dead && !f.gone) this.downFigure('spy', o.at, { peril: x.peril, where: `у города ${name}`, why: [], spot });
      return;
    }
    // Защитник: дело его задело или лазутчика поймали — иначе сервер его не прислал бы.
    const who = caught ? cityOr(x.atkCity) : null;
    const lost: Counts = { ...(o.burned ?? {}) };
    for (const [k, v] of Object.entries(o.stolen ?? {})) lost[k] = (lost[k] ?? 0) + v;
    const harm = o.ok && def.hostile ? this.rivalHarmWords(x.deed, o) : '';
    const catchText = o.dead
      ? `Лазутчика из «${who}» схватили, живым он не дался.`
      : o.held
        ? `Лазутчика из «${who}» схватили и держат под стражей.`
        : 'Чей лазутчик — не узнали.';
    const title = harm ? `${def.name} в городе` : `Схвачен лазутчик из «${who}»`;
    this.addReport({
      id: `spy-${x.id}`,
      at: o.at,
      kind: 'defense',
      title,
      target: this.homeSpot(),
      won: !harm,
      sent: {},
      lost: {},
      enemyPower: null,
      enemyLost: null,
      loot: Object.keys(lost).length ? asLoss(lost as Loot) : null,
      intel: null,
      battle: null,
      text: [harm, catchText].filter(Boolean).join(' '),
      read: false,
    });
    this.addEffect({
      id: `spy-${x.id}-eff`,
      lost: {},
      resources: asLoss(lost as Loot),
      ...(o.lured ? { popLost: o.lured } : {}),
      prestige: caught ? 1 : 0,
      morale: (o.ok ? (o.morale ?? 0) : 0) + (caught ? 1 : 0),
      battle: null,
      text: harm || catchText,
      good: !harm,
    });
    if (p) {
      const { gold, ...goods } = lost;
      const stock: Loot = { ...(p.stock ?? {}) };
      for (const [k, v] of Object.entries(goods)) stock[k as keyof Loot] = Math.max(0, (stock[k as keyof Loot] ?? 0) - v);
      p.stock = stock;
      p.gold = Math.max(0, (p.gold ?? 0) - (gold ?? 0));
      p.pop = Math.max(1, p.pop - (o.lured ?? 0));
    }
  }

  /** Что сделало удавшееся дело — глазами нападающего. Числа — сервера (`SpyOut`), своей арифметики нет. */
  private rivalDone(deed: RivalDeedId, o: SpyOut): string {
    if (deed === 'look') {
      const i = o.intel;
      if (!i) return 'Лазутчик вернулся, но сосчитать не успел.';
      return `Лазутчик сосчитал точно: дома ${troopTotal(i.home as TroopStack)} бойцов, всего в дружине ${troopTotal(i.army as TroopStack)}, ополчения ${i.militia}, из них стрелков ${i.archers}, жителей ${i.pop}.`;
    }
    if (deed === 'fire') return `Склад горел: сгорело ${this.goodsWords(o.burned)}.`;
    if (deed === 'theft') return `Лазутчик унёс со склада ${this.goodsWords(o.stolen)}. Унесённое уже дома.`;
    return `В городе смута, мораль упала${o.lured ? `. К нам перебежали: ${o.lured}` : ''}.`;
  }

  /** Что сделал с нами чужой лазутчик — словами защитника. */
  private rivalHarmWords(deed: RivalDeedId, o: SpyOut): string {
    if (deed === 'fire') return `Ночью загорелся склад: сгорело ${this.goodsWords(o.burned)}.`;
    if (deed === 'theft') return `Со склада пропало: ${this.goodsWords(o.stolen)}.`;
    return `В городе смута, мораль упала${o.lured ? `. Из города сбежали: ${o.lured}` : ''}.`;
  }

  /** Почему лазутчика сейчас к этому городу не послать; null — можно спросить меню. Последнее слово — у сервера. */
  private rivalBlock(c: PlayerCastle, now: number): string | null {
    if (!this.spyLookTo || !this.warOrderTo) return 'Тайная война между игроками идёт только в Telegram.';
    const f = this.save.figures.spy;
    const off = this.offDuty('spy', now) ?? this.retiringBlock('spy');
    if (off) return off;
    if (!this.inRealm(c)) return this.beyond();
    const busy = Math.max(0, (f.busyUntil ?? 0) - now);
    if (busy > 0) return `${this.busyNote('spy')}: ${formatLeft(busy / 1000)}.`;
    if (f.watching) return 'Лазутчик наблюдает. Сними наблюдение, потом посылай.';
    if (f.phase !== 'home') return 'Лазутчик выходит из своего города: верни его домой.';
    // Из осаждённого города не выходит и лазутчик — та же дверь выхода, что у похода и фигуры.
    return this.siegeBlock(now);
  }

  /** Лазутчик против города игрока глазами карточки: можно ли спросить меню, сколько идти, что с делом сейчас. */
  private spyCard(c: PlayerCastle, now: number): CardSpy | undefined {
    if (!this.spiesFrom) return undefined;
    const mine = this.spyList().find((x) => x.role === 'atk' && x.defCastle === c.id && x.phase !== 'done');
    const look = this.spyList().find((x) => x.role === 'atk' && x.defCastle === c.id && x.out?.ok && x.out.intel);
    const i = look?.out?.intel;
    return {
      reason: this.rivalBlock(c, now),
      walkMs: Math.round(spyWalkMs(this.save.home, c) / this.warPaceOf()),
      ...(mine && mine.phase !== 'done'
        ? {
            ours: {
              deed: mine.deed,
              phase: mine.phase,
              arriveAt: mine.arriveAt,
              ...(mine.releaseAt !== undefined ? { releaseAt: mine.releaseAt } : {}),
              ...(mine.backAt !== undefined ? { backAt: mine.backAt } : {}),
            },
          }
        : {}),
      ...(look && i
        ? {
            intel: {
              at: look.out?.at ?? look.arriveAt,
              home: troopTotal(i.home as TroopStack),
              army: troopTotal(i.army as TroopStack),
              militia: i.militia,
              archers: i.archers,
              pop: i.pop,
              power: Math.round(i.power),
            },
          }
        : {}),
    };
  }

  async spyMenu(target: SettlementId): Promise<RivalMenu> {
    const now = this.clock();
    const none = (error: string): RivalMenu => ({ error, at: now, walkMs: 0, options: [] });
    const c = this.castleOf(target);
    if (!c) return none('Этого города нет на карте.');
    const block = this.rivalBlock(c, now);
    if (block || !this.spyLookTo) return none(block ?? 'Тайная война между игроками идёт только в Telegram.');
    const menu = await this.spyLookTo(target);
    if (typeof menu === 'string') return none(menu);
    this.spyShown = { target, menu };
    // Срок плена — та же черта, что у логова (`spyTimes`), с темпом войны, как у сервера.
    const held = Math.round(this.spyTimes().held / this.warPaceOf() / 1000);
    return {
      error: null,
      at: menu.at,
      walkMs: menu.walkMs,
      options: menu.options.map((o) => {
        const def = RIVAL_DEED_BY_ID[o.deed];
        // Цена в энергии — своей дверью и с дорогой до города: отметка лазутчика у клиента, сервер проверит её же.
        const energy = this.energyCost('spy', o.deed, now, menu.walkMs);
        const reason = o.reason ?? energy.block;
        return {
          deed: o.deed,
          name: def.name,
          icon: def.icon,
          description: def.description,
          can: o.can && reason === null,
          reason,
          chance: o.chance,
          peril: o.peril,
          why: o.why,
          held,
          energy,
        };
      }),
    };
  }

  async spyRival(target: SettlementId, deed: RivalDeedId, shownAt: number): Promise<string | null> {
    const now = this.clock();
    const c = this.castleOf(target);
    if (!c) return 'Этого города нет на карте.';
    const block = this.rivalBlock(c, now);
    if (block) return block;
    const shown = this.spyShown?.target === target && this.spyShown.menu.at === shownAt ? this.spyShown.menu : null;
    const opt = shown?.options.find((o) => o.deed === deed);
    if (!shown || !opt) return 'Посмотри дела заново.';
    if (!opt.can) return opt.reason ?? 'Сейчас нельзя.';
    const tired = this.energyCost('spy', deed, now, shown.walkMs).block;
    if (tired) return tired;
    // Энергия — отметкой: цену дела и дорогу считает сервер той же дверью (`world/energy`), и здесь её не списывают.
    return this.warSend({
      op: 'spy',
      target,
      deed,
      energy: { ...this.energyOf('spy', now) },
      shown: { chance: opt.chance, peril: opt.peril },
      at: shownAt,
    });
  }

  async persist(): Promise<void> {
    this.write();
  }

}

/** Своё предложение глазами окна. */
function offerView(o: SiegeOffer): NonNullable<ParleyView['mine']> {
  return {
    kind: o.kind,
    ...(o.fate ? { fate: o.fate } : {}),
    ...(o.price !== undefined ? { price: o.price } : {}),
    until: o.until,
    ...(o.answer ? { answer: o.answer } : {}),
  };
}

/** Как взят город соседа — словами донесения нападающему: голодом, сдачей (на условиях) или штурмом. */
function fallHow(f: WarFall): string {
  if (f.by === 'hunger') return 'Город сдался голоду';
  if (f.by === 'gates') return f.terms ? 'Город сдался на наших условиях, гарнизон ушёл живым' : 'Город открыл ворота, гарнизон ушёл живым';
  return 'Город взят штурмом';
}

/** Отметка итога предложения в летописи (ДП-1): номер и итог — у предложения итог один. */
const proposalSeenId = (p: ProposalView): string => `dip-${p.id}-${p.end ?? 'open'}`;
/** Отметка похода соседа на нас в летописи (ДП-1). */
const rivalWarId = (war: string): string => `dip-war-${war}`;

/** Отметки соседей, которые сервер ещё отдаёт: итоги предложений и войны на нас. */
function rivalSeenIds(list: readonly WarView[], proposals: readonly ProposalView[]): string[] {
  return [...proposals.filter((p) => p.end).map(proposalSeenId), ...list.filter((w) => w.role === 'def').map((w) => rivalWarId(w.id))];
}

/** Номера итогов, которые сервер отдаёт в списке войн: бои, падения городов, дань, починки и удары, не пробившиеся к лагерю. */
function warSeenIds(list: readonly WarView[]): string[] {
  const ids: string[] = [];
  for (const w of list) {
    for (const b of w.battles) ids.push(b.id);
    if (w.fall) ids.push(warFallId(w.id));
    if (w.tribute) ids.push(warTributeId(w.id));
    for (const d of w.camp?.log ?? []) if (d.act === 'repair') ids.push(warRepairId(w.id, d.at));
    for (const g of w.camp?.guns ?? []) ids.push(warGunId(w.id, g.at));
    for (const d of w.camp?.log ?? []) if (d.act === 'blockade') ids.push(warRingId(w.id, d.at));
    (w.camp?.phases ?? w.phases ?? []).forEach((r, k) => (r.shots ?? []).forEach((s, i) => s.lost && ids.push(warShotId(w.id, k + 1, i))));
    for (const t of w.turned ?? []) ids.push(warTurnedId(w.id, t.at));
  }
  return ids;
}

/**
 * Список принятого после пульса. Номер, который сервер ещё отдаёт, не вытесняется никогда: вытесненный, он на следующем
 * пульсе снова «не принят», и итог ложился бы второй раз — на каждом пульсе, пока игрок в игре (docs/bughunt.md,
 * «Больше двухсот итогов»). Потолок `WAR_SEEN_MAX` — только на номера, которых в списках сервера уже нет. Списков ещё
 * не знаем (`live` — null: игра только открылась) — не вытесняется ничего.
 */
export function keptSeen(seen: Iterable<string>, live: readonly string[] | null): string[] {
  const all = [...seen];
  if (live === null) return all;
  const listed = new Set(live);
  const gone = new Set(all.filter((id) => !listed.has(id)).slice(-WAR_SEEN_MAX));
  return all.filter((id) => listed.has(id) || gone.has(id));
}
