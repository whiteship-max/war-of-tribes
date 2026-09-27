// Мир целиком на клиенте: генерация по сиду плюс своя маленькая симуляция соседей.
// Реализует WorldApi — тот же интерфейс, что потом реализует HttpWorld. Всё, что
// считается здесь (время пути, бой, старение разведки), считается детерминированно,
// чтобы сервер мог повторить расчёт один в один.
import { freshSeed, mixSeed, seeded } from '@/game/sim/random';
import { asGame, gameSecondsOfMs, realMs, type GameSec } from '@/game/pace';
import { partyNow } from '@/net/clock';
import {
  UNIT_KINDS,
  emptyStack,
  stackTotal,
  type Pips,
  type Stack,
  type UnitKind,
} from '@/battle';
import { TROOPS_OF_KIND, kindsOf, troopLosses, troopPower, troopTotal, troopsAfter, type TroopStack } from '@/game/battle/kinds';
import { TROOP_IDS } from '@/game/data/troops';
import { troopsOfKinds } from '@/game/battle/faces';
import type { BattlePlace } from '@/game/battle/ground';
import type { WorldApi } from '../api';
import type {
  AttackOrder,
  AttackResult,
  BattleRecord,
  CampView,
  CardSack,
  CardSiege,
  Coord,
  DealId,
  DealView,
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
  StrikePlan,
  Standing,
  TemperId,
  TribeInfo,
  UnitStack,
  WorldInfo,
  WorldPulse,
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
import { cityName, cityOr } from '../../../netlify/lib/contract';
import { WATCHER, liveSight, standing } from '../sight';
import { canShelter, placeOf } from '../shelter';
import { ownGearOf, revealSight, slipped } from '../agents';
import { diesAt, perilOf, perilShare, perilText, perilWhy, routPeril, recentVisits, type PerilCase } from '../peril';
import { buildable, featuresAt } from '../geography';
import { claimsNear, claimsOf, ownerAt, type Claim } from '../territory';
import { DEAL_BY_ID, FIGURE_BY_ID, FIGURE_IDS } from '../data/figures';
import { DIPLO_ACTIONS, DIPLO_ACTION_BY_ID, TEMPER_BY_ID } from '../data/diplomacy';
import { ORDER_AGENT, SPY_ACTIONS, SPY_ACTION_BY_ID } from '../data/spy';
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
  PLAYER_CAMP,
  SIEGE_BLOCK,
  STRIKE_FROM_TOWN,
  immuneUntil,
  openSiege,
  ourCamp,
  siegeActive,
  siegeImmune,
  siegeSince,
  starvesAt,
  townEatPerHour,
  townLarder,
  type SiegeWindow,
} from '../siege';
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
  type LetterCandidate,
} from '../letters';
import { LETTER_KIND_BY_ID, goodsText } from '../data/letters';
import { BARBARIAN_NAMES, RELATION_META, stageOf } from '../data/meta';
import { stackCarry, stackEscort, stackSize } from '../data/units';
import {
  FATES,
  FATE_DEFAULT,
  FATE_IDS,
  burnImmuneUntil,
  fallSeed,
  fate,
  fateAt,
  fateBlock,
  homeLoss,
  winnerGain,
  type FateLocks,
  type FateResult,
} from '../spoils';
import { FATE_META, gainText, lossText } from '../data/fates';
import { marchSeed, stackAfter, stackLosses, stackPower } from '../combat';
import { aimOf, firePlan, reaim, thinAt } from '../bombard';
import { garrisonOf, menOfPower, raidingParty, GARRISON_STYLES } from '../garrison';
import { MIRROR_ON, mirrorPower } from '../mirror';
import type { FaithId } from '@/game/types';
import { fitSetup, resolveField, type FieldOutcome } from '../battle';
import {
  awayOf,
  fieldTroops,
  homeOf,
  ownOf,
  plus,
  postureOf,
  roomOf,
  standingShare,
  standingTroops,
  weakest,
} from '../muster';
import {
  WOOD_SHARES,
  gateBusyText,
  playerWood,
  rebaseWood,
  refusedAtGate,
  splitLosses,
  strikeForecast,
  throughText,
  woodShare,
  type Through,
  type WoodPlan,
} from '../works';
import { faithAt, faithAttitude, faithPressure } from '../faith';
import { groundAt, placeAt } from '../place';
import { intercept as meetingOf, type Meeting } from '../pursuit';
import { UNKNOWN, estimate, precisionOf, readIntel } from '../intel';
import {
  CASTLE_GOLD_PER_POWER,
  AI_RANGE,
  AI_WARNING_BASE,
  AI_ATTACK_MAX,
  AI_ATTACK_MIN,
  DAMAGE_RECOVER,
  DEAL_DURATION,
  DEAL_PAYOUT,
  DEFENSE_FREEZE,
  AGENT_DEATH_MORALE,
  AGENT_HELD_MORALE,
  FIGURE_DOWN,
  GENERAL_ROUT_MORALE,
  FIGURE_SCOUT_CATCH,
  FIGURE_SCOUT_COVER,
  PERIL_MEMORY,
  FIGURE_TOUCH,
  FAITH_AROUND,
  HOME_SIGHT,
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
  HANDOVER_BASE,
  HANDOVER_MAX,
  HANDOVER_PER_MAN,
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
  TRADE_GOLD_PER_SETTLEMENT,
  TRIBUTE_PER_SETTLEMENT,
  WORLD_ORIGIN,
  WORLD_SIZE,
} from '../data/tuning';
import {
  browserStorage,
  createWorldSave,
  parseWorldSave,
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
   * Замки живых игроков из реестра. Отдаётся функцией, а не списком: реестр
   * приезжает по своему сроку, а мир спрашивает его на каждом пульсе. Про сеть
   * мир при этом по-прежнему не знает ничего — ему приносят строки.
   */
  castles?: () => PlayerCastle[];
  /**
   * Отдавать всю землю разведанной. Только отладочный обзор мира (`?worldview=open`):
   * в обычной партии мир не отдаёт клиенту того, чего игрок не видел, — иначе
   * туман войны существовал бы только на картинке.
   */
  reveal?: boolean;
}

/** Соль кости гибели разбитого полководца: своё число из сида того же боя. */
const ROUT_SALT = 0x726f7574;

/** Схватили ли часовые разведчика: первая кость прихода легла ниже доли поимки. */
export const caughtAt = (roll: number, caught: number): boolean => roll < caught;

/**
 * Сколько живут числа, показанные в меню приказа: приказ, отданный позже, считается
 * заново. Меню перечитывается каждым пульсом, так что десяти секунд хватает с запасом.
 */
const SHOWN_FRESH = 10_000;

/** Кто лезет через рогатки одной стороны лагеря: свои поимённо или чужие родами. */
type CampPart = { own: TroopStack } | { kinds: Stack; gear: Partial<Record<UnitKind, number>> };

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
    const stored = parseWorldSave(this.storage?.read() ?? null);
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
    this.fog.revealDisc(this.save.home, HOME_SIGHT);
    this.stepSightings(this.clock(), this.sightDiscs(this.clock()));
  }

  // ---------- Служебное ----------

  private write(): void {
    this.save.fog = this.fog.toJSON();
    this.forgetVisits(this.clock());
    this.storage?.write(JSON.stringify(this.save));
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
      name: visible ? cityOr(c.city) : (cityName(seen?.name) ?? seen?.owner ?? 'Чей-то замок'),
      stage: visible ? stageOf(c.power, c.pop) : (seen?.stage ?? 'camp'),
      relation: 'neutral',
      owner: visible ? c.name : (seen?.owner ?? null),
      tribeId: null,
      tribeName: null,
      color: RELATION_META.neutral.color,
      mine: false,
      castle: true,
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
      // Брать замок игрока нечем: походов между игроками нет, выбирать участь некому.
      fates: [],
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
      note: 'Замок живого игрока. Что с ним делать, в игре пока нельзя ничего: ни похода, ни разведки, ни переговоров.',
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
      if (this.byId.has(l.id)) continue;
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
    // Разведданные о сожжённом никому не нужны и врали бы: гарнизона больше нет.
    delete this.save.intel[s.id];
    delete this.save.sightings[s.id];
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
      if (distance(spot, home) < LAIR_HOME_GAP) continue;
      // Под чужой стеной разбойники не селятся — и под своим же пепелищем тоже:
      // новое логово обязано читаться как новое место, а не как воскресшее.
      if (this.gen.settlements.some((o) => distance(o, spot) < LAIR_SETTLE_GAP)) continue;
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
    return w && siegeActive(w, now) ? w : null;
  }

  /**
   * Осада деревни, если она идёт прямо сейчас. Считается при чтении из одного
   * окна: ни флага «осаждён», ни тика, который его снимет, в мире нет.
   */
  protected homeSiege(now: number): SiegeWindow | null {
    return this.siegeOf(HOME_ID, now);
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
    return this.homeSiege(now) ? SIEGE_BLOCK : null;
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
  ): { food: number; garrison: number; townPerHour: number; perManPerHour: number } {
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
  ): SiegeWindow {
    const prev = this.save.sieges[id];
    const same = prev && prev.campId === campId ? prev : null;
    const w = openSiege({
      byId,
      campId,
      now: at,
      ...this.larderOf(id, at, extraMen),
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
    });
    // Рогатки держат те, кто их строил: у новой осады это лагерь в минуту постановки.
    // Спрашивается у того же `campArmy`, которым лагерь бьётся, — второго счёта людей нет.
    if (!same) w.builders = this.campArmy(w, at)?.men;
    // Окно открылось или пересчиталось — гарнизон мог смениться, а с ним расчёт на башне.
    this.aimTower(id, w, at);
    this.save.sieges[id] = w;
    // Срок стоянки лагеря и есть час голода: падение разбирает та же очередь
    // событий по времени, что и приход любого другого отряда.
    const camp = this.save.marches.find((m) => m.id === campId);
    if (camp) camp.stayUntil = starvesAt(w);
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

  /** Осада наружу: факт, срок и то, чем он посчитан. Считать её больше негде. */
  private siegeView(now: number): SiegeView | null {
    const w = this.homeSiege(now);
    if (!w) return null;
    const camp = this.campArmy(w, now);
    const wood = camp ? camp.wood : w.wood;
    return {
      byId: w.byId,
      byName: this.byId.get(w.byId)?.name ?? 'Чужаки',
      since: siegeSince(w),
      starvesAt: this.hunger(w),
      garrison: w.garrisonAtStart,
      foodAtStart: w.foodAtStart,
      campMen: camp?.men ?? 0,
      builders: this.buildersOf(w, now),
      ...(camp && w.fire ? { fire: { thin: camp.thin, cap: Math.max(w.fire.base, w.fire.thin), slow: w.fire.slow } } : {}),
      ...(w.gateAt !== undefined ? { gateAt: w.gateAt } : {}),
      ...(w.rearGateAt !== undefined ? { rearGateAt: w.rearGateAt } : {}),
      ...(wood !== undefined ? { wood } : {}),
      fate: this.fateFor(w.fate, HOME_ID, now),
      fall: this.fallForecast(w, now),
      palisade: this.save.profile?.levels?.palisade ?? 0,
    };
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
    const r = this.fateHome(this.save.profile, haul.carry, haul.escort, at, f);
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
      byName: ourCamp(w) ? 'Наша дружина' : (this.byId.get(w.byId)?.name ?? 'Чужаки'),
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
    gear: Partial<Record<UnitKind, number>>;
    resolve?: number;
    /** Отметки того, кто ведёт лагерь: у нашего — полководец, у чужого — никто. */
    pips?: Pips;
    /** Сколько бойцов строя стоит в лагере. */
    men: number;
    power: number;
    name: string;
    /** Какая доля мощи лагеря выбита обстрелом с башни к минуте `at` (`world/bombard`). */
    thin: number;
    /** План рогаток под обстрелом: по нему лагерь рубит на самом деле. */
    wood: WoodPlan | undefined;
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
      const kinds = kindsOf(troops);
      for (const k of UNIT_KINDS) kinds[k] = Math.round(kinds[k] * (1 - thin));
      return {
        kinds,
        gear: this.ownGear(troops),
        // Наш лагерь держит дружина полководца — это его бой, и его отметки в нём есть.
        resolve: this.ownResolve(),
        pips: this.generalPips(),
        men: stackTotal(kinds),
        power: troopPower(troops) * (1 - thin),
        name: 'наш лагерь',
        thin,
        wood,
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
       * он ведёт, только если его дружина стоит у ворот (`homePips`); выручка
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
    const gate = this.campGate(id, at, { front: kindsOfPart(attack.front), rear: kindsOfPart(attack.rear) });
    if (!gate) return null;
    const { w, camp, front, rear } = gate;
    if (refusedAtGate(front, rear)) return { refused: true, front, rear };
    const parts = [
      { part: attack.front, t: front },
      { part: attack.rear, t: rear },
    ].filter((x): x is { part: CampPart; t: Through } => Boolean(x.part && x.t));
    const kinds = emptyStack();
    const gearSum: Partial<Record<UnitKind, number>> = {};
    for (const { part, t } of parts) {
      // Доля строя одинакова у каждого рода, поэтому и снаряжение у прошедших
      // с одной стороны то же, что у всего отряда этой стороны; стороны
      // смешиваются весом прошедших.
      const gear = 'own' in part ? this.ownGear(part.own) : part.gear;
      for (const k of UNIT_KINDS) {
        kinds[k] += t.kinds[k];
        gearSum[k] = (gearSum[k] ?? 0) + (gear[k] ?? 0) * t.kinds[k];
      }
    }
    const gear: Partial<Record<UnitKind, number>> = {};
    for (const k of UNIT_KINDS) if (kinds[k] > 0) gear[k] = Math.round((gearSum[k] ?? 0) / kinds[k]);
    const fought = parts.reduce((n, x) => n + x.t.passed, 0);
    const all = parts.reduce((n, x) => n + x.t.went, 0);
    const own = parts.some((x) => 'own' in x.part);
    // Лагерь стоит под городом: место боя — клетка города.
    const cell = id === HOME_ID ? this.save.home : this.byId.get(id);
    const field = resolveField({
      seed,
      ground: cell ? groundAt(this.save.seed, cell, attack.from) : undefined,
      attacker: {
        kinds,
        gear,
        resolve: own ? this.ownResolve() : undefined,
        pips: own ? (attack.general ? this.generalPips() : this.homePips(at)) : undefined,
        // Встают те, кто прошёл, по правилу развёртывания: расстановки у удара по лагерю нет.
        setup: null,
      },
      // Стойкость и отметки лагеря: у нашего — обряд и отметки полководца, у чужого
      // её нет. Прежде `campArmy` её считал, а сюда она не доходила вовсе.
      defender: { kinds: camp.kinds, gear: camp.gear, resolve: camp.resolve, pips: camp.pips, setup: null },
    });
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
    const losses = field.result?.sides.attacker.losses ?? emptyStack();
    const lost = splitLosses(losses, front?.kinds ?? emptyStack(), rear?.kinds ?? emptyStack());
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
   * Лагерь понёс потери, но устоял. Убыль ложится туда, где живёт войско
   * лагеря: у чужого — в мощь и состав марша, у нашего — в дружину при
   * полководце. Второго места, где хранится войско лагеря, нет.
   */
  private wearCamp(w: SiegeWindow, loss: number, at: number, why: string): number {
    if (ourCamp(w)) {
      const f = this.save.figures.general;
      const troops = f.troops ?? {};
      // Доля потерь ложится на каждый род ровно так же, как её считает бой:
      // «убыло 30%» — это 30% в каждой полосе, а не тридцать первых попавшихся.
      const kinds = kindsOf(troops);
      const hit = emptyStack();
      for (const k of Object.keys(kinds) as UnitKind[]) hit[k] = Math.round(kinds[k] * loss);
      const lost = troopLosses(troops, hit);
      const left: TroopStack = {};
      for (const [key, n] of Object.entries(troops) as [keyof TroopStack, number][]) {
        const rest = (n ?? 0) - (lost[key] ?? 0);
        if (rest > 0) left[key] = rest;
      }
      let gone = troopTotal(troops) - troopTotal(left);
      // То же правило и для нашего лагеря: вылазка, дошедшая до рогаток, не
      // может не стоить ему ни одного человека.
      if (gone === 0 && troopTotal(left) > 1) {
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
          'потерял всю дружину под чужими стенами.',
          town ? `под ${town.name}` : 'под чужими стенами',
          town ? { id: town.id, name: town.name, x: town.x, y: town.y } : this.homeSpot(),
          mixSeed(this.save.seed, Math.floor(at / 1000)),
        );
      } else {
        f.troops = left;
        if (gone > 0) {
          this.addEffect({
            id: `camp-wear-${at}`,
            lost: { warrior: gone },
            lostTroops: lost,
            // Лагерь — дружина в поле: раненые лежат при полководце (docs/infirmary.md).
            field: lost,
            resources: {},
            prestige: 0,
            morale: -3,
            battle: null,
            text: `${why} Лагерь устоял, но людей поубавилось.`,
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
    if (gone === 0 && before > 1) {
      m.units = stackAfter(m.units, { warrior: 1 });
      gone = before - stackSize(m.units);
    }
    return gone;
  }

  /**
   * Осада снята: лагерь ушёл. Одно место на все поводы — разбитый лагерь,
   * уведённый полководец, павший город. Оно же и единственное, где осада
   * пропадает из сохранения, и единственное, где ставится остывание.
   */
  private liftSiege(id: SettlementId, at: number): SiegeWindow | null {
    const w = this.save.sieges[id];
    if (!w) return null;
    delete this.save.sieges[id];
    this.save.siegeAgainAt[id] = at + SIEGE_COOLDOWN;
    const camp = this.save.marches.find((m) => m.id === w.campId);
    // Выбитое обстрелом с башни записывается в войско лагеря одним разом, здесь: до этой
    // минуты оно выводилось при чтении (`campArmy`), а окна, из которого выводить, больше нет.
    const thin = thinAt(w.fire, at);
    if (camp && thin > 0) {
      camp.power = Math.max(1, camp.power * (1 - thin));
      camp.units = stackAfter(camp.units, stackLosses(camp.units, thin));
    }
    if (camp) this.turnHome(camp, at, null);
    return w;
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
    // Марш становится стоянкой у ворот. `from` не трогаем: по нему лагерь потом
    // уйдёт домой, и подменить его точкой стоянки значило бы отправить чужаков
    // восвояси в нашу же деревню.
    m.phase = 'stay';
    m.stayUntil = starvesAt(w);
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
      text: `${m.fromName} не пошли на приступ: заслон крепче их отряда. Встали лагерем у ворот и ждут, когда кончится хлеб. Объявили: ${FATE_META[this.fateFor(m.fate, HOME_ID, at)].name.toLowerCase()}.`,
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
   */
  private sitsDown(id: SettlementId, m: StoredMarch, at: number, field: FieldOutcome): boolean {
    if (this.save.sieges[id]) return false;
    // Цепочку закрывает окно неприкосновенности: у павшего города пустой амбар, и вторая
    // осада подряд повторила бы исход, не дав ни решения между.
    if (siegeImmune(this.save.siegeImmune[id], at)) return false;
    // Остывание — то же самое, но после любого конца осады, а не только после падения.
    if (at < (this.save.siegeAgainAt[id] ?? 0)) return false;
    if (field.won) return false;
    return seeded(m.seed)() < SIEGE_CHANCE;
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
  private siegeFalls(id: SettlementId, at: number): void {
    const w = this.save.sieges[id];
    if (!w) return;
    this.save.siegeImmune[id] = immuneUntil(at);
    const ours = ourCamp(w);
    this.liftSiege(id, at);
    // Пал наш город — это `homeFalls`, и больше ничего. Раньше сюда вёл любой
    // не наш лагерь, и падение чужого двора под чужим же лагерем (война соседей)
    // рассеяло бы наш гарнизон и вычистило наш склад. Проверка стоит на самом
    // городе, а не на лагере.
    if (id === HOME_ID) return this.homeFalls(w, at);

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
    this.save.damage[id] = {
      loss: Math.min(0.95, prev + SIEGE_ROUT * (1 - prev)),
      at: this.liveAt(id, at),
    };
    // Война соседей между собой: игроку не достаётся ничего, и отчёта ему нет —
    // это не его бой.
    if (!ours) return;
    const f = this.save.figures.general;
    const men = troopTotal(f.troops ?? {});
    // Участь города — та же дверь, что у нашей деревни, и та, что объявлена приказом
    // «Осадить»: склад и казна до тайника, сколько поднимет дружина, а на ступени,
    // уводящей людей, — невольники и горожане, скольких она устережёт.
    const declared = this.fateFor(w.fate, id, at);
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
      title: `Город взят голодом: ${s.name}`,
      target: { id, name: s.name, x: s.x, y: s.y },
      won: true,
      sent: { warrior: men },
      lost: {},
      enemyPower: Math.round(this.powerNow(s, at)),
      enemyLost: null,
      loot: spoils,
      hidden: took.hiddenTotal,
      intel: this.snapshot(s, at),
      battle: null,
      text: `В ${s.name} кончился хлеб. Гарнизон разошёлся.${gainText(took)}${
        took.hiddenTotal > 0 ? ` В их тайнике осталось ${took.hiddenTotal}.` : ''
      } Лагерь снят.`,
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
      text: `Осада ${s.name} кончилась: город сдался голоду.`,
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
  private homeFalls(w: SiegeWindow, at: number): void {
    const p = this.save.profile;
    // Расходится оборона, а не всё войско: гарнизон и дружина, если она собрана
    // и стоит дома, — она голодала за той же стеной. Дружина в поле или в сборе
    // в городе не голодала, и рассеивать её значило бы снять людей, которых
    // полководец по-прежнему держит при себе.
    // Гарнизон рассеян: люди с оружием из взятого голодом города расходятся.
    const { held, routed } = this.routedAt(at);
    const army = held.all;
    const men = troopTotal(routed);
    this.standingLost(held.own, held.standing, routed);
    const camp = this.save.marches.find((m) => m.id === w.campId);
    // Участь взятого города — одна дверь на оба пути поражения и та, что объявил
    // лагерь: тот же дележ склада и казны, что у прорвавшегося набега, тот же увод,
    // те же постройки. Соль выбора построек — сид мира и минута падения.
    const declared = this.fateFor(w.fate, HOME_ID, at);
    this.markFall(HOME_ID, declared, at);
    const haul = this.haul(camp?.units ?? {}, false);
    const spoils = this.fateHome(p ?? null, haul.carry, haul.escort, at, declared);
    const loss = homeLoss(spoils);
    if (FATES[declared].chain) this.save.burnImmune[HOME_ID] = burnImmuneUntil(at);
    const from = this.byId.get(w.byId)?.name ?? camp?.fromName ?? 'Чужаки';

    this.addReport({
      id: `${w.campId}-fell`,
      at,
      kind: 'defense',
      title: 'Хлеб кончился',
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
      text: `Голод сделал за ${from} всю работу: гарнизон разошёлся. Участь — «${FATE_META[declared].name.toLowerCase()}». ${lossText(declared, spoils)} Лагерь снят.`,
      read: false,
    });
    this.addEffect({
      id: `${w.campId}-fell`,
      lost: men > 0 ? { warrior: men } : {},
      lostTroops: men > 0 ? routed : undefined,
      // Гарнизон рассеян, а не ранен: лазарет его не кладёт (docs/infirmary.md, решение 7).
      routed: true,
      prestige: 0,
      morale: -12,
      // Настоящего боя не было: город взяли голодом, и записывать это в
      // проигранные битвы значило бы считать то, чего не случилось.
      battle: null,
      ...loss,
      text: `Осада ${from} доела деревню: гарнизон рассеян, ${FATES[declared].spoils ? 'склад вычищен' : 'город сожжён'}.`,
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
      const times = [starvesAt(w)];
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
    if (at >= starvesAt(w)) return this.siegeFalls(id, at);
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
    const out = this.campBattle(id, at, this.warSeed().seed, { front: { kinds: g.kinds, gear: g.gear } });
    if (!out || out.refused) return;
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
  private resolveSortieOn(id: SettlementId, at: number, field: FieldOutcome, why: string): number {
    const w = this.save.sieges[id];
    if (!w) return 0;
    const campLost = this.wearCamp(w, field.defenderLoss, at, why);
    if (field.won) this.liftSiege(id, at);
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
    const units: UnitStack = { warrior: Math.max(1, Math.round(power / 3)) };
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
    this.remove(m);
    // Осаду успели снять без них — отряд разворачивается и уходит домой.
    if (!w) return;
    const party = raidingParty(this.save.seed, m.id, m.power);
    const out = this.campBattle(id, at, m.seed, {
      front: { kinds: party.kinds, gear: party.gear },
      from: m.from,
    });
    // Проход занят — выручка к рогаткам не пробилась и ушла ни с чем.
    if (!out || out.refused) return;
    const ours = ourCamp(w);
    const campLost = this.resolveSortieOn(id, at, out.field, `${m.fromName} пришли на выручку осаждённым.`);
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
          ? `${m.fromName} пришли на выручку ${target.name} и сбили наш лагерь. Осада снята.`
          : `${m.fromName} пришли на выручку ${target.name} и были отбиты. Осада стоит.`) +
        (out.share < 1
          ? ` Через рогатки к бою прошли ${out.fought} бойцов строя из ${out.all}.`
          : ''),
      read: false,
    });
  }

  /**
   * Наш полководец садится в осаду под городом, у которого стоит. Тем же окном,
   * теми же часами голода и тем же порядком падения, что у чужой осады: второй
   * реализации у осады нет.
   */
  async besiege(fateId: Fate = FATE_DEFAULT): Promise<string | null> {
    const now = this.clock();
    const f = this.save.figures.general;
    const off = this.offDuty('general', now) ?? this.retiringBlock('general');
    if (off) return off;
    if (f.phase === 'moving') return 'Полководец ещё в пути.';
    this.settleHandover(f, now);
    if (f.handover) {
      return `Дружина ещё в дороге: ${formatLeft(Math.max(0, f.handover.until - now) / 1000)}.`;
    }
    if (troopTotal(f.troops ?? {}) === 0) return 'Осаду держат войском, а его при полководце нет.';
    const near = this.touching(this.figureAt(f, now));
    if (!near || near.home) return 'Рядом нет чужого поселения.';
    const target = this.byId.get(near.id);
    if (!target) return 'Цель не найдена.';
    // Участь объявляется приказом и проверяется им же: недоступную не объявить.
    const blocked = fateBlock(fateId, 'world', this.save.burnImmune[target.id], now, this.playerLocks());
    if (blocked) return blocked;
    // «Осаждать» у своего же лагеря — тот же приказ с новой участью: окно остаётся, часы
    // голода и проходы не трогаются, осаждённый видит новую участь сразу.
    const standingCamp = this.siegeOf(target.id, now);
    if (standingCamp && ourCamp(standingCamp)) {
      if (this.fateFor(standingCamp.fate, target.id, now) === fateId) return 'Осада и так идёт с этой участью.';
      standingCamp.fate = fateId;
      this.addEffect({
        id: `camp-fate-${target.id}-${now}`,
        lost: {},
        resources: {},
        prestige: 0,
        morale: 0,
        battle: null,
        text: `Под ${target.name} объявлено: «${FATE_META[fateId].name.toLowerCase()}».`,
        good: true,
      });
      this.write();
      return null;
    }
    if (standingAt(this.diploOf(target.id, now), now) === 'pact') {
      return 'Пакт в силе: осады не будет. Сначала разрыв — его объявляет дипломат.';
    }
    if (this.save.sieges[target.id]) return 'Под этими стенами уже стоит лагерь.';
    if (siegeImmune(this.save.siegeImmune[target.id], now)) {
      return 'Город недавно доели: в амбаре пусто, осаждать нечего.';
    }
    // Лагерь игрока делит древесину сам, в окне осады; встаёт он со всем во фронт.
    this.openSiegeAt(target.id, HOME_ID, PLAYER_CAMP, now, 0, { fate: fateId, wood: playerWood(WOOD_SHARES[0]) });
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
      text: `Дружина обложила ${target.name}. Объявлено: «${FATE_META[fateId].name.toLowerCase()}». ${CAMP_LEAVE}`,
      read: false,
    });
    this.moveAttitude(target.id, ATTACK_ATTITUDE, now);
    this.write();
    return null;
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
    if (!w) return { error: 'Под стенами никого: выходить не на кого.', reportId: null, won: false };
    // Выходят из гарнизона — вместе с дружиной, если полководец в городе: дома она
    // и есть гарнизон (`world/muster`), и за ворота выходит этой же вылазкой.
    // Через фронт: вылазка лезет в рогатки, обращённые к городу.
    const held = this.defenders(now);
    const home = held.all;
    const going: TroopStack = {};
    for (const [key, raw] of Object.entries(troops ?? {}) as [keyof TroopStack, number][]) {
      const n = Math.max(0, Math.floor(raw ?? 0));
      if (n <= 0) continue;
      if (n > (home[key] ?? 0)) return { error: 'Столько бойцов дома нет.', reportId: null, won: false };
      going[key] = n;
    }
    const men = troopTotal(going);
    if (men === 0) return { error: 'Выходить некому: отряд пустой.', reportId: null, won: false };

    // Проход занят — отказ до боя, и сид похода не тратится.
    const gate = this.campGate(HOME_ID, now, { front: kindsOf(going) });
    if (gate?.front && refusedAtGate(gate.front)) {
      return { error: gateBusyText(gate.front.waitMs), reportId: null, won: false };
    }
    const seed = marchSeed(this.save.seed, this.save.nextMarch++);
    const out = this.campBattle(HOME_ID, now, seed, { front: { own: going } });
    if (!out || out.refused || !out.front) return { error: 'Лагеря под стенами уже нет.', reportId: null, won: false };
    const { field, camp, front: through } = out;

    // Потери боя — только из дравшихся, и снимаются они с отряда тем же правилом,
    // что у любого боя: по родам, слабые первыми. Дружина, вышедшая с гарнизоном,
    // теряет свою долю тут же — тем же правилом, что у частокола.
    const lostTroops = field.result ? troopLosses(going, out.lost.front) : {};
    const lostMen = troopTotal(lostTroops);
    this.standingLost(held.own, held.standing, lostTroops);
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
          ? `Дружина вышла из ворот и разметала лагерь. Осада снята, город снова ест.`
          : `Лагерь отбился. Осада стоит, но и им досталось: ${campLost} чел.`) + throughText(through),
      read: false,
    });
    this.addEffect({
      id: `${reportId}-eff`,
      lost: lostMen > 0 ? { warrior: lostMen } : {},
      lostTroops,
      resources: {},
      prestige: field.won ? 4 : 0,
      morale: field.won ? 6 : -5,
      battle: field.won ? 'won' : 'lost',
      text: field.won ? 'Вылазка сняла осаду.' : 'Вылазка отбита: лагерь стоит.',
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
      text: `${target.name} больше не считает нас соседями: набеги оттуда пойдут чаще и злее. Мир заключает дипломат.`,
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
      tribeName: 'Твоё племя',
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

  /** Сама минута голода из окна. Звать напрямую можно только там, где участие уже известно. */
  private hunger(w: SiegeWindow): number {
    return starvesAt(w);
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
   * Сколько игрок видит чужую армию до её прихода. База обязана быть заметно
   * больше `DEFENSE_FREEZE` — иначе набег появляется уже запертым; Дозор игрока
   * только прибавляет сверху, укоротить предупреждение он не может.
   */
  protected warningMs(): number {
    // `warning` — игровые секунды: вся семья предупреждения идёт со шкалой времени, как ритм набегов,
    // и с миллисекундами мира складывается только через дверь (`game/pace`).
    return AI_WARNING_BASE + realMs(Math.max(0, this.save.profile?.warning ?? 0));
  }


  /**
   * Снаряжение своего отряда. Конюшня добавляет коннице ступень: мощь бойца она
   * не трогает (это запрещено — мощь считается из состава), а ступень снаряжения
   * даёт в бою мораль, и именно так сытые кони и добрая сбруя работают.
   */
  /**
   * Стойкость нашей стороны: обряд перед боем, если он идёт. Число приезжает
   * готовым в слепке деревни — мир про веру, храм и уклад не знает и знать не
   * должен, ему передают одну прибавку к морали.
   *
   * Стоит рядом с `ownGear` нарочно: наша сторона в мире узнаётся ровно по
   * этим двум вызовам, и забыть один из них труднее, когда они рядом.
   */
  private ownResolve(): number {
    return Math.max(0, this.save.profile?.fervour ?? 0);
  }

  /**
   * Отметки полководца в бою, который **ведёт он**: удар по двору и логову, перехват, удар по лагерю
   * из поля и наш лагерь, по которому бьют. Стойкость в этих боях — тот же обряд (`ownResolve`), что
   * у всех наших: прежний натиск в неё больше не прибавляется (docs/battle_eu4.md, пачка 1).
   */
  private generalPips(): Pips {
    return this.save.profile?.pips ?? {};
  }

  /**
   * Отметки у своего города — у стены и на вылазке — **только пока дружина стоит у ворот**:
   * тогда она часть гарнизона, и полководец ведёт его сам (решение владельца 26.09.2026,
   * docs/battle_eu4.md, вопрос 5). Дружина в сборе, в пути, в поле или в лагере — полководца у стены
   * нет, и отметок нет: место полководца имеет цену. У стены — все отметки, и манёвр тоже: у EU4 манёвр
   * обороняющегося держит переправу нападающему (14.5, Л9 пересмотрено).
   */
  private homePips(at: number): Pips {
    if (postureOf(this.save.figures.general, at) !== 'stands') return {};
    return this.generalPips();
  }

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
  private fateHome(profile: PlayerProfile | null, carry: number, escort: number, at: number, declared: Fate): FateResult {
    return fate({
      fate: declared,
      stock: profile?.stock ?? {},
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
   * земля. Живой обзор у деревни остаётся прежним кругом (`HOME_SIGHT`), и
   * растягивать его вслед за изучением нельзя: тогда высшая ступень отдала бы
   * игроку живое наблюдение за всей изученной округой даром.
   */
  private homeReveal(): number {
    return Math.max(HOME_SIGHT, Math.round(this.save.profile?.survey ?? 0));
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
   * пять мест, где город взят. Обоз полководца (`ours`) множит черта «Обозный»;
   * чужой отряд, взявший наш город, — никогда. Прежде `stackCarry` звали пять мест
   * порознь, и черта, дошедшая до двух из них, разошлась бы с тремя молча.
   */
  private haul(units: UnitStack, ours: boolean): { carry: number; escort: number } {
    const carry = stackCarry(units);
    return { carry: ours ? carry * this.traitOf('carry') : carry, escort: stackEscort(units) };
  }

  /** Доля приходов, в которые часовые берут разведчика: «Неприметный» реже, «Примелькался» чаще. */
  private scoutCatch(): number {
    return Math.min(1, FIGURE_SCOUT_CATCH * this.traitOf('catch'));
  }

  /**
   * Срок сбора и роспуска дружины: прежний потолок, умноженный на черту. Множится
   * после потолка — «Мясника» ждут дольше и у дружины, которая и так упиралась в него.
   */
  private musterWait(moved: number): number {
    return Math.round(Math.min(HANDOVER_MAX, HANDOVER_BASE + moved * HANDOVER_PER_MAN) * this.traitOf('muster'));
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
    const out: SightDisc[] = [{ x: this.save.home.x, y: this.save.home.y, r: HOME_SIGHT }];
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
      text: `${def.name} погиб ${death.where}.${why} Перед приказом гибель стояла ${perilText(death.peril)}. Место пустует.`,
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
      if (f.phase === 'down') {
        // Пустое место не возвращается само: вернётся нанятый, когда его назовёт слепок.
        if (f.gone || now < f.downUntil) continue;
        const held = Boolean(f.held);
        f.phase = 'home';
        f.downUntil = 0;
        f.held = false;
        f.from = { ...this.save.home };
        f.to = { ...this.save.home };
        f.departAt = now;
        f.arriveAt = now;
        this.addEffect({
          id: `fig-${id}-back-${now}`,
          lost: {},
          resources: {},
          prestige: 0,
          morale: 2,
          battle: null,
          text: held ? `${FIGURE_BY_ID[id].name}а отпустили: снова в строю.` : `${FIGURE_BY_ID[id].name} снова в строю.`,
          good: true,
        });
        continue;
      }
      if (f.phase === 'moving' && now >= f.arriveAt) {
        const at = f.arriveAt;
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
        f.from = { ...f.to };
        f.departAt = at;
        f.phase = this.touching(f.to)?.home ? 'home' : 'field';
        this.onFigureArrived(id, at);
        if (this.save.figures[id].phase === 'down') continue;
        // Полководец с дружиной встал у своих ворот — дружина вошла в оборону, и
        // за стеной прибавилось ртов. Путь из осаждённого города заперт, а домой
        // открыт, поэтому этот повод под осадой случается, а обратный — нет.
        if (id === 'general' && f.phase === 'home') this.resiege(HOME_ID, at);
      }
      // Разведчик, стоящий у чужого поселения, считает войско заново, пока стоит:
      // это и есть его умение, и на нём держится ценность фигуры.
      if (id === 'scout' && f.phase === 'field') {
        const near = this.touching(f.to);
        const target = near && !near.home ? this.byId.get(near.id) : null;
        if (target) this.save.intel[target.id] = this.snapshot(target, now);
      }
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
        this.downFigure(id, at, { peril, where: `у ${target.name}`, why: frozen?.why ?? [], spot: { id: target.id, name: target.name, x: target.x, y: target.y } });
        return;
      }
      if (isCaught) {
        this.holdFigure(id, target, at, `попался часовым у ${target.name}.`, { agent: 'scout', ok: false, at, person });
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
    if (id === 'diplomat' && this.relationOf(target) === 'enemy' && rng() < 0.3) {
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
        if (now >= pact.until) {
          delete deals[key];
          this.addEffect({
            id: `pact-${tribeId}-${key}-end`,
            lost: {},
            resources: {},
            prestige: 0,
            morale: -2,
            battle: null,
            text: `Договор «${DEAL_BY_ID[key].name}» с племенем ${this.tribeName(tribeId)} истёк.`,
            good: false,
          });
          continue;
        }
        if (key !== 'tribute' && key !== 'trade') continue;
        // Догон офлайна платит за каждый пропущенный срок, а не один раз: иначе
        // выгоднее было бы не отходить от экрана.
        for (let guard = 0; guard < 200 && now - pact.paidAt >= DEAL_PAYOUT; guard++) {
          pact.paidAt += DEAL_PAYOUT;
          this.payPact(tribeId, key, pact.paidAt);
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
        text: `Торговля с племенем ${name}: ${gold} золота.`,
        good: true,
      });
      return;
    }
    const total = Math.round(TRIBUTE_PER_SETTLEMENT * count);
    // Платят тем же, чем богаты сами: список берётся у их поселения.
    const mix = this.gen.settlements.find((s) => s.tribeId === tribeId)?.lootMix ?? ['food'];
    const resources: Loot = {};
    const per = Math.max(1, Math.floor(total / mix.length));
    for (const r of mix) resources[r] = (resources[r] ?? 0) + per;
    this.addEffect({
      id: `pact-${tribeId}-tribute-${at}`,
      lost: {},
      resources,
      prestige: 1,
      morale: 1,
      battle: null,
      text: `Дань от племени ${name} доставлена.`,
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
    if (!m.own) return;
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
  private attackAt(target: GenSettlement, at: number, declared: Fate): AttackResult {
    const f = this.save.figures.general;
    const troops = f.troops ?? {};
    const men = troopTotal(troops);
    const seed = marchSeed(this.save.seed, this.save.nextMarch++);
    const defense = this.powerNow(target, at);
    // Людей двора — до боя: у логова народ выводится из силы, а бой её убавит.
    const popThere = this.popNow(target, at);
    const garrison = garrisonOf(this.save.seed, target.id, defense, target.castle);
    const field = resolveField({
      seed,
      // Место боя — клетка цели; переправа — если полководец вышел на неё через русло.
      ground: groundAt(this.save.seed, target, this.save.figures.general.from),
      attacker: { kinds: kindsOf(troops), gear: this.ownGear(troops), resolve: this.ownResolve(), pips: this.generalPips(), setup: null },
      defender: { kinds: garrison.kinds, gear: garrison.gear, setup: null },
    });
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
      (arms > 0 ? ` Оружия: ${arms}.` : '');
    const record: BattleRecord | null = field.result
      ? {
          us: 'attacker',
          result: field.result,
          // Наш состав известен поимённо, чужой выводится из его же ступени
          // снаряжения: замок выходит латниками, малое поселение — дубинщиками.
          troops: { attacker: { ...troops }, defender: troopsOfKinds(garrison.kinds, garrison.gear) },
          // Бой идёт на клетке цели: у брода, на гребне, у опушки — как там и есть.
          place: this.placeOf(target),
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
      intel,
      battle: record,
      text: burned
        ? `${target.name} выжжено дотла. Набеги оттуда больше не выйдут.${lootText}`
        : field.won
          ? `Гарнизон ${target.name} разбит, двор разорён.${lootText}`
          : `Оборона ${target.name} оказалась крепче.${survivors === 0 ? ' Полководец пал.' : ' Уцелевшие остались при полководце.'}`,
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
      // Бой полководца — его дело. Пустой бой (некому было драться) делом не считается.
      ...(field.result ? { deed: { agent: 'general' as const, ok: field.won, at } } : {}),
      text: burned
        ? `Логово ${target.name} (${formatCoord(target)}) сожжено.`
        : field.won
          ? `Набег на ${target.name} (${formatCoord(target)}) удался.`
          : `Набег на ${target.name} (${formatCoord(target)}) отбит.`,
      good: field.won,
    });

    if (survivors === 0) {
      f.troops = undefined;
      this.defeatGeneral(at, `разбит под ${target.name}.`, `под ${target.name}`, { id: target.id, name: target.name, x: target.x, y: target.y }, seed);
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
    const seconds = travelTime(1, terrainFactor(this.save.seed, from, to), FIGURE_BY_ID[id].speed);
    return seconds > 0 ? 1 / realMs(seconds) : 0;
  }

  /** Чужой отряд, который можно догонять. null — такого нет. */
  private chaseTarget(marchId: string): StoredMarch | null {
    const m = this.save.marches.find((x) => x.id === marchId);
    if (!m || m.own || m.phase !== 'out') return null;
    return m;
  }

  /**
   * Где и когда встретимся, если приказать сейчас. Всё решается уравнением
   * (`pursuit.intercept`) один раз, в момент вопроса: ни фонового счёта, ни
   * шагов по таймеру за этим нет.
   */
  private planChase(m: StoredMarch, now: number): { meet: Meeting | null; reason: string | null } {
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
        reason: `Дружина ещё в дороге: ${formatLeft(Math.max(0, f.handover.until - now) / 1000)}.`,
      };
    }
    if (troopTotal(f.troops ?? {}) === 0) {
      return { meet: null, reason: 'Войска при полководце нет: за дружиной надо домой.' };
    }
    const from = this.figureAt(f, now);
    const ahead = marchPosition(m, now);
    const meet = meetingOf(from, this.paceOf('general', from, ahead), m, now);
    if (!meet) {
      // Отдельная причина, а не общее «нельзя»: игрок должен понимать, что
      // помешало — расстояние или время, которое осталось у цели.
      return {
        meet: null,
        reason: `Не догнать: они дойдут раньше — им идти ${formatLeft(secondsLeft(m.arriveAt, now))}.`,
      };
    }
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
      targetName: m.fromName,
      men: stackSize(m.units),
      targetSeconds: secondsLeft(m.arriveAt, now),
    };
  }

  async intercept(marchId: string): Promise<string | null> {
    const now = this.clock();
    // Армия в лагере занята. Уйти она может — но только сняв осаду, и это
    // отдельный приказ, а не побочный итог погони.
    if (this.ourSiege(now)) return `${CAMP_BUSY} ${CAMP_LEAVE}`;
    // Перехват — это выход полководца в поле, и из осаждённого города он такой
    // же невозможный, как любой другой. Отказ здесь, в приказе: принять его и
    // не сдвинуть фигуру было бы хуже отказа.
    if (this.touching(this.figureAt(this.save.figures.general, now))?.home) {
      const blocked = this.siegeBlock(now);
      if (blocked) return blocked;
    }
    const m = this.chaseTarget(marchId);
    if (!m) return 'Этот отряд уже не догнать.';
    const { meet, reason } = this.planChase(m, now);
    if (!meet) return reason ?? 'Перехват не выходит.';
    this.setChase(this.save.figures.general, meet, now, marchId);
    this.write();
    return null;
  }

  /** Курс на точку встречи. Прибытие ставится ровно на её время. */
  private setChase(f: StoredFigure, meet: Meeting, now: number, marchId: string): void {
    f.from = this.figureAt(f, now);
    f.to = clampToWorld(meet.at);
    f.departAt = now;
    f.arriveAt = Math.max(now, Math.round(meet.time));
    f.phase = 'moving';
    f.chase = { marchId };
    f.strike = undefined;
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
    const plan = m ? this.planChase(m, now) : { meet: null, reason: null };
    if (!m || !plan.meet) {
      this.breakChase(f, now, 'Их след потерян: отряд ушёл, и полководец встал в поле.');
      return;
    }
    this.setChase(f, plan.meet, now, marchId);
  }

  /** Погоня сорвалась: полководец останавливается там, где стоял. */
  private breakChase(f: StoredFigure, now: number, text: string): void {
    const at = this.figureAt(f, now);
    f.from = { ...at };
    f.to = { ...at };
    f.departAt = now;
    f.arriveAt = now;
    f.phase = this.touching(at)?.home ? 'home' : 'field';
    f.chase = undefined;
    // Встал у своих ворот — дружина в обороне (см. `stepFigures`).
    if (f.phase === 'home') this.resiege(HOME_ID, now);
    this.addEffect({
      id: `chase-lost-${now}`,
      lost: {},
      resources: {},
      prestige: 0,
      morale: -1,
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
    const marchId = f.chase?.marchId ?? '';
    f.chase = undefined;
    const m = this.chaseTarget(marchId);
    if (!m) {
      this.breakChase(f, at, 'Перехват сорвался: отряда на месте не оказалось.');
      return;
    }
    const here = this.figureAt(f, at);
    const them = marchPosition(m, at);
    if (distance(here, them) > FIGURE_TOUCH) {
      this.breakChase(f, at, `Перехват сорвался: ${m.fromName} прошли стороной.`);
      return;
    }

    const spot = { x: Math.round(here.x), y: Math.round(here.y) };
    const troops = f.troops ?? {};
    const men = troopTotal(troops);
    const seed = marchSeed(this.save.seed, this.save.nextMarch++);
    const party = raidingParty(this.save.seed, m.id, m.power);
    const field = resolveField({
      seed,
      // Место боя — клетка встречи; нападает полководец, и переправа — его шаг на неё (бой на воде — переправа).
      ground: groundAt(this.save.seed, spot, f.from),
      attacker: { kinds: kindsOf(troops), gear: this.ownGear(troops), resolve: this.ownResolve(), pips: this.generalPips(), setup: null },
      defender: { kinds: party.kinds, gear: party.gear, setup: null },
    });
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

    const reportId = `chase${seed}`;
    this.addReport({
      id: reportId,
      at,
      kind: 'raid',
      title: field.won ? `Перехват удался: ${m.fromName}` : `Перехват не удался: ${m.fromName}`,
      target: { id: m.fromId, name: m.fromName, x: spot.x, y: spot.y },
      won: field.won,
      sent: { warrior: men },
      lost: lostMen > 0 ? { warrior: lostMen } : {},
      enemyPower: Math.round(m.power),
      enemyLost,
      loot: null,
      intel: null,
      battle: record,
      text: field.won
        ? `${m.fromName} разбиты в поле и до деревни не дошли.`
        : `${m.fromName} пробились дальше.${survivors === 0 ? ' Полководец пал.' : ''}`,
      read: false,
    });
    this.addEffect({
      id: `${reportId}-eff`,
      lost: lostMen > 0 ? { warrior: lostMen } : {},
      lostTroops,
      // Перехват в поле: раненые лежат при полководце, пока дружина не вернётся.
      field: lostTroops,
      resources: {},
      prestige: field.won ? 4 : 0,
      morale: field.won ? 5 : -5,
      battle: field.won ? 'won' : 'lost',
      ...(field.result ? { deed: { agent: 'general' as const, ok: field.won, at } } : {}),
      text: field.won
        ? `Набег ${m.fromName} перехвачен в поле (${formatCoord(spot)}).`
        : `Перехват ${m.fromName} не удался.`,
      good: field.won,
    });

    if (field.won) {
      // Разбитые дальше не идут: набега не будет вовсе.
      this.remove(m);
    } else {
      // Отбились, но не даром: до деревни дойдут поредевшими.
      m.power = Math.max(1, m.power * (1 - field.defenderLoss));
      m.units = stackAfter(m.units, stackLosses(m.units, field.defenderLoss));
    }

    if (survivors === 0) {
      f.troops = undefined;
      this.defeatGeneral(at, `разбит в поле у ${formatCoord(spot)}.`, `в поле у ${formatCoord(spot)}`, { id: m.fromId, name: m.fromName, x: spot.x, y: spot.y }, seed);
    } else {
      f.troops = left;
      const stop = this.figureAt(f, at);
      f.from = { ...stop };
      f.to = { ...stop };
      f.departAt = at;
      f.arriveAt = at;
      f.phase = this.touching(stop)?.home ? 'home' : 'field';
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
        ? `Отряд пересчитал войско: около ${Math.round(power)} силы.${spotted ? ' Одного заметили.' : ''}`
        : 'Разведчика заметили, и он не вернулся. Ходить надо вдвоём.',
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
      text: `Отряд встал в ${target.name}. Союз крепче, отряд вернётся сам.`,
      read: false,
    });
    this.addEffect({
      id: `${m.id}-support`,
      lost: {},
      resources: {},
      prestige: 2,
      morale: 2,
      battle: null,
      text: `Наш отряд стоит в ${target.name} (${formatCoord(target)}).`,
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
    this.remove(m);
    const { profile, party, held, home, militia, archers, field } = wall;
    const outcome = { won: field.won, attackerLoss: field.attackerLoss, defenderLoss: field.defenderLoss };
    const record: BattleRecord | null = field.result
      ? {
          us: 'defender',
          result: field.result,
          troops: { attacker: troopsOfKinds(party.kinds, party.gear), defender: { ...home } },
          // Ополчение — не бойцы: частокол, башня и жители. В строю они стоят,
          // в казармах их нет, поэтому и записаны они отдельно.
          militia: { attacker: { men: 0, archers: 0 }, defender: { men: militia, archers } },
          // Оборону держат у себя дома — там и снимается место боя.
          place: this.placeOf(this.save.home),
        }
      : null;
    const attackerLeft = stackAfter(m.units, stackLosses(m.units, outcome.attackerLoss));
    const warriors = troopTotal(home);
    // Ополчение гибнет наравне со всеми, но списываются только бойцы: жителей
    // набег не уносит — за них отвечают мораль и разграбленный склад.
    const spread = field.result ? troopLosses(home, field.result.sides.defender.losses) : {};
    const warriorsLost = Math.min(warriors, troopTotal(spread) || Math.round(warriors * outcome.defenderLoss));
    // Погибают те, кто стоял у частокола. Потери, которые не легли ни на один
    // вид обороны, называются поимённо здесь же — со слабых, — а не числом:
    // числом племя сняло бы их со всей дружины и могло задеть тех, кто при
    // полководце в поле. Дружина у ворот теряет свою долю сразу.
    const troopsLost = troopTotal(spread) > 0 ? spread : weakest(home, warriorsLost);
    this.standingLost(held.own, held.standing, troopsLost);
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
    if (spoils && FATES[declared].chain) this.save.burnImmune[HOME_ID] = burnImmuneUntil(at);
    if (spoils) this.markFall(HOME_ID, declared, at);
    // Окно после падения — одно на оба пути: прорыв ставит его так же, как голод
    // (`siegeFalls`), и пока оно стоит, нет ни осады, ни набега (`scheduleAi`).
    if (spoils) this.save.siegeImmune[HOME_ID] = immuneUntil(at);

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
      intel: null,
      battle: record,
      ...(loss?.fallen ? { fallen: loss.fallen } : {}),
      text: spoils
        ? `${m.fromName} прорвались через заслон. ${lossText(declared, spoils)}`
        : `${m.fromName} отбиты у частокола.`,
      read: false,
    });

    // Пленные. Это не новая потеря: часть тех, кого племя уже посчитало
    // убитыми, на самом деле уведена — та же условность, что у лазарета.
    // Поэтому выкуп потом только возвращает и ничего не отнимает, а письмо о
    // нём остаётся тем, чем должно быть: потерянной возможностью, если его не
    // открыть.
    if (outcome.won && warriorsLost > 0) {
      const held = Math.max(1, Math.round(warriorsLost * RANSOM_SHARE));
      this.save.captives[m.fromId] = (this.save.captives[m.fromId] ?? 0) + held;
    }

    this.addEffect({
      id: `${m.id}-defense`,
      lost: warriorsLost > 0 ? { warrior: warriorsLost } : {},
      lostTroops: troopsLost,
      resources: {},
      ...loss,
      prestige: outcome.won ? 0 : 3,
      morale: outcome.won ? -10 : 5,
      battle: outcome.won ? 'lost' : 'won',
      // Прорвались — значит, дошли и до хозяйства за стеной. Насколько плохо,
      // решает то, сколько от заслона осталось; что с этим делать, знает племя.
      sacked: outcome.won ? Math.max(0.35, outcome.defenderLoss) : 0,
      text: outcome.won ? `Набег ${m.fromName} прорвался в деревню.` : `Набег ${m.fromName} отбит.`,
      good: !outcome.won,
    });
  }

  /**
   * Бой у стены против пришедшего отряда — весь, как он случится, и ничего не трогая. Им
   * решается и сам приступ (`resolveIncoming`), и садится ли отряд в осаду (`sitsDown`):
   * это один и тот же бой с тем же сидом, и второй сборки сторон быть не должно.
   */
  private wallField(m: StoredMarch, at: number) {
    const profile = this.save.profile;
    const party = raidingParty(this.save.seed, m.id, m.power);
    // Оборона дома: гарнизон, дружина, если она собрана и стоит у своих ворот, плюс
    // ополчение — частокол, башня и сами жители. Ополчение в расстановке не
    // участвует: пехота растекается по фронту сама, а стрелков башни ставит во
    // вторую линию `toArmySetup`. Дружины в сборе, в пути, в поле и в лагере здесь
    // нет, даже если полководец в двух шагах от ворот (`world/muster.postureOf`).
    const held = this.defenders(at);
    const home = held.all;
    const militia = Math.max(0, Math.round(profile?.militia ?? 0));
    // Башня ставит часть ополчения стрелками: людей не прибавляется, меняется род.
    const archers = Math.min(militia, Math.max(0, Math.round(profile?.militiaArchers ?? 0)));
    const homeKinds = kindsOf(home);
    homeKinds.infantry += militia - archers;
    homeKinds.archer += archers;
    // Оборона, запертая за `DEFENSE_FREEZE` до прихода: менять её было уже нельзя.
    // Заперта расстановка, а не люди в ней: ушедшего после этого в сбор или в
    // поле она в строй у частокола не вернёт — в строю не больше, чем стоит дома.
    const frozen = this.save.frozenDefense;
    const planned = frozen && frozen.marchId === m.id ? frozen.setup : (profile?.defenseSetup ?? null);
    const setup = planned ? fitSetup(planned, homeKinds) : null;
    const field = resolveField({
      seed: m.seed,
      // Место боя — своя деревня; переправа — если набег вышел на неё через русло.
      ground: groundAt(this.save.seed, this.save.home, m.from),
      attacker: { kinds: party.kinds, gear: party.gear, setup: null },
      // Ведёт оборону полководец, если его дружина стоит у ворот (`homePips`), — со всеми отметками: у EU4 манёвр
      // обороняющегося держит переправу нападающему (docs/battle_eu4.md, 14.5, Л9).
      defender: { kinds: homeKinds, gear: this.ownGear(home), resolve: this.ownResolve(), pips: this.homePips(at), setup },
    });
    return { profile, party, held, home, militia, archers, setup, field };
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
    const near = this.gen.settlements.filter(
      (s) => s.tribeId && distance(s, home) <= AI_RANGE && !busy.has(s.id),
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
        const until = starvesAt(w);
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
        until: starvesAt(w),
        fromId: w.byId,
        fromName: this.byId.get(w.byId)?.name ?? 'Чужаки',
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
        reason: short === 0 ? null : `На складе не хватает ${short} добра.`,
      });
      choices.push({ id: 'no', label: def.no, hint: def.noHint(l), can: true, reason: null });
    }
    return {
      ...l,
      title: def.title,
      icon: def.icon,
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
   * от обороны игрока его сила не зависит ничем. Молодой город логово не замечает
   * (`lairShield`), павший город не трогает до конца окна (`SIEGE_IMMUNE`).
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
    // Час, на который набег был назначен, а не тот, в который его разобрали.
    // Разница между ними и есть офлайн: пульс приходит когда придёт, а
    // назначенное время одно и то же на обеих дорогах. Всё, что зависит от
    // времени, здесь считается от него — иначе догон разошёлся бы с непрерывной
    // игрой ровно на длину перерыва.
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
    // Защита новичка по зрелости: пока логово город не замечает, набега нет вовсе.
    if (!profile || lairShield(profile.pop) <= 0) return;
    // Чужой отряд на деревню в мире один. Именно **на деревню**: соседи, идущие
    // друг на друга или на выручку осаждённому, к очереди набегов отношения не
    // имеют, и заслонять ими набег значило бы поставить набеги на игрока в
    // зависимость от того, повздорили ли два двора на краю карты.
    if (save.marches.some((m) => !m.own && m.targetId === HOME_ID)) return;

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
    const power = Math.max(2, lairRaid(this.powerNow(src, now), profile.pop));
    const units: UnitStack = { warrior: Math.max(1, Math.round(power / 3)) };
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
    this.liftSiege(id, at);
    const name = this.byId.get(id)?.name ?? 'города';
    this.addEffect({
      id: `camp-left-${id}-${at}`,
      lost: {},
      resources: {},
      prestige: 0,
      morale: -2,
      battle: null,
      text: `Осада ${name} снята: дружина ушла от стен, и город снова ест.`,
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
  ):
    | { error: string }
    | { error: null; f: StoredFigure; force: TroopStack; to: Coord; seconds: GameSec } {
    const f = this.save.figures.general;
    const off = this.offDuty('general', now) ?? this.retiringBlock('general');
    if (off) return { error: off };
    this.settleHandover(f, now);
    if (f.handover) return { error: `Дружина ещё в дороге: ${formatLeft(Math.max(0, f.handover.until - now) / 1000)}.` };
    if (troopTotal(f.troops ?? {}) === 0) return { error: 'Войска при полководце нет.' };
    const force = fieldTroops(f, now);
    if (troopTotal(force) === 0) return { error: STRIKE_FROM_TOWN };
    if (this.ourSiege(now)) return { error: `${CAMP_BUSY} ${CAMP_LEAVE}` };
    const w = this.siegeOf(id, now);
    const camp = w && !ourCamp(w) ? this.campArmy(w, now) : null;
    if (!w || !camp) return { error: 'Под этими стенами лагеря нет.' };
    const town = id === HOME_ID ? this.save.home : this.byId.get(id);
    if (!town) return { error: 'Цель не найдена.' };
    const from = this.figureAt(f, now);
    const to = { x: town.x, y: town.y };
    const dist = distance(from, to);
    const seconds = dist < 0.5 ? asGame(0) : travelTime(dist, terrainFactor(this.save.seed, from, to), FIGURE_BY_ID.general.speed);
    if (now + realMs(seconds) >= starvesAt(w)) {
      return { error: 'Не успеть: хлеб у города кончится раньше, чем полководец дойдёт.' };
    }
    return { error: null, f, force, to, seconds };
  }

  async strikePlan(id: SettlementId, garrison: boolean): Promise<StrikePlan> {
    const now = this.clock();
    const garrisonable = id === HOME_ID;
    const rout = perilShare(routPeril(distance(this.save.home, this.campSpot(id))));
    const check = this.strikeCheck(id, now);
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

  async strikeCamp(id: SettlementId, garrison: boolean): Promise<string | null> {
    const now = this.clock();
    const check = this.strikeCheck(id, now);
    if (check.error !== null) return check.error;
    const { f, to, seconds } = check;
    const withGarrison = garrison && id === HOME_ID;
    // Пробиться к приходу некому — отказ тем же планом, которым гасится кнопка:
    // принять приказ, который погашен в меню, значило бы разойтись с ним.
    const plan = await this.strikePlan(id, withGarrison);
    if (!plan.can) return plan.reason;
    if (seconds <= 0) {
      // Стоит у самого лагеря — бьёт сразу, без дороги.
      const res = this.resolveStrike(id, now, withGarrison);
      return res.error;
    }
    f.from = this.figureAt(f, now);
    f.to = { ...to };
    f.departAt = now;
    f.arriveAt = now + Math.round(realMs(seconds));
    f.phase = 'moving';
    f.chase = undefined;
    f.strike = { id, garrison: withGarrison };
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
      rear: { own: troops },
      front: joint ? { own: going } : undefined,
      general: true,
      from: f.from,
    });
    if (!out || out.refused) return { error: 'Лагеря под стенами уже нет.', reportId: null, won: false };
    const { field, camp, front, rear } = out;

    // Потери — из прошедших с каждой стороны, каждой стороне своими людьми: дружине
    // из дружины, гарнизону из гарнизона (`splitLosses`).
    const lostTroops = field.result ? troopLosses(troops, out.lost.rear) : {};
    const townLost = field.result && joint ? troopLosses(going, out.lost.front) : {};
    const left = troopsAfter(troops, lostTroops);
    const lostMen = men - troopTotal(left);
    const townMen = troopTotal(townLost);
    const campLost = this.resolveSortieOn(
      id,
      at,
      field,
      joint ? 'Полководец ударил по лагерю с тыла, гарнизон вышел из ворот.' : 'Полководец ударил по лагерю.',
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
          : `Лагерь ${camp.name} отбился. Осада стоит, но и им досталось: ${campLost} чел.`) +
        (joint && !field.won && townMen > 0 ? ` Гарнизон, вышедший из ворот, потерял ${townMen} чел.` : '') +
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
      ...(field.result ? { deed: { agent: 'general' as const, ok: field.won, at } } : {}),
      text: field.won ? `Лагерь ${camp.name} разбит: осада снята.` : `Лагерь ${camp.name} устоял.`,
      good: field.won,
    });

    if (troopTotal(left) === 0) {
      f.troops = undefined;
      f.strike = undefined;
      this.defeatGeneral(at, `положил дружину на лагерь ${camp.name}.`, `у лагеря ${camp.name}`, this.campSpot(id), seed);
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
    const units: UnitStack = { warrior: Math.max(1, Math.round(power / 3)) };
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
    const field = resolveField({
      seed: m.seed,
      ground: groundAt(this.save.seed, target, m.from),
      attacker: { kinds: party.kinds, gear: party.gear, setup: null },
      defender: { kinds: g.kinds, gear: g.gear, setup: null },
    });
    if (this.sitsDown(m.targetId, m, at, field)) {
      const w = this.openSiegeAt(m.targetId, m.fromId, m.id, at);
      this.save.siegeAgainAt[m.targetId] = at + SIEGE_COOLDOWN;
      m.phase = 'stay';
      m.stayUntil = starvesAt(w);
      return;
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
   *    `AI_WARNING_BASE`: предупреждение обязано быть заметно длиннее
   *    `DEFENSE_FREEZE`, иначе набег появляется уже запертым.
   *
   * Держать только первое было бы ошибкой того же рода, что и держать только
   * второе. Без донесения набег из дальнего двора входил бы в круг уже за
   * отметкой заморозки, и перехват в поле — лучшее, что есть на карте, —
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
      if (camp && m.relief === camp && m.phase === 'out' && m.arriveAt - now <= warn) return true;
      const at = m.phase === 'stay' ? m.to : marchPosition(m, now);
      return inSight(discs, at.x, at.y);
    });
  }

  private viewMarch(m: StoredMarch): MarchView {
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
      arriveAt: m.phase === 'stay' ? m.stayUntil ?? m.arriveAt : m.arriveAt,
      loot: m.loot ? { ...m.loot } : null,
      recallable: m.own && m.phase !== 'back',
      // Лагерь под стенами — это стоянка, а не поход, и панели должны звать её
      // своим именем. Своего вида похода у осады нет: игрок такого приказа
      // отдать не может, и заводить его в списке заданий было бы враньём.
      siege: m.phase === 'stay' && this.save.sieges[m.targetId]?.campId === m.id,
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
          : 'Своя деревня. Сюда возвращаются походы и сюда же приходят чужие.',
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
        note: `Пепелище. Логово выжжено, брать тут нечего и занять его нельзя — след сойдёт сам через ${formatLeft(ruinLeft(rec, now) / 1000)}.`,
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
    const canRaid =
      here.includes('general') && troopTotal(general.troops ?? {}) > 0 && !gathering && !pact;
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
          canRaid &&
          !this.save.sieges[s.id] &&
          !siegeImmune(this.save.siegeImmune[s.id], now) &&
          this.ourSiege(now) === null,
        open: false,
      },
      siege: this.cardSiege(s.id, now),
      ruinLeft: 0,
      sack: this.cardSack(s.id, now),
      note: canRaid
        ? null
        : pact
          ? 'Пакт в силе: нападать нельзя, пока он не разорван. Разрыв объявляет дипломат — и вступает он в силу не сразу.'
          : gathering
            ? `Дружина ещё в дороге: ${formatLeft(Math.max(0, (general.handover?.until ?? 0) - now) / 1000)}.`
            : here.includes('general')
              ? 'Полководец здесь, но войска при нём нет: за дружиной надо домой.'
              : 'Атакует только полководец: доведи его сюда — и ударь.',
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
    if (!profile) return { error: 'Деревня ещё не готова к походу.', march: null };
    // Из осаждённого города не выходит никто: ни гонец с воинами, ни разведка,
    // ни поддержка союзнику.
    const blocked = this.siegeBlock(now);
    if (blocked) return { error: blocked, march: null };

    const target = this.byId.get(order.target) ?? null;
    if (!target) {
      return {
        error: order.target === HOME_ID ? 'Свою деревню штурмовать незачем.' : 'Цель не найдена.',
        march: null,
      };
    }

    const held = this.defenders(now);
    // Названный состав уходит из гарнизона поимённо — тех же видов и не больше,
    // чем их стоит дома, вместе с дружиной, если полководец в городе: она теряет
    // ушедших своей долей (`standingLost`), как у частокола. Без состава отряд
    // уходит числом и снимается со слабых из тех, кто не при полководце
    // (`world/muster.homeOf`), — поэтому и считается он от них.
    const troops = order.troops && troopTotal(order.troops) > 0 ? { ...order.troops } : undefined;
    const units: UnitStack = {};
    let size = 0;
    for (const [id, n] of Object.entries(order.units) as [keyof UnitStack, number][]) {
      const count = Math.max(0, Math.floor(n ?? 0));
      if (count <= 0) continue;
      // Воины уходят из гарнизона — того, что стоит дома в эту минуту. Разведчики —
      // свободные руки деревни, и сколько их, знает только слепок.
      const have = id === 'warrior' ? troopTotal(troops ? held.all : held.own) : (profile.units[id] ?? 0);
      if (count > have) return { error: `Столько людей нет дома: ${id === 'scout' ? 'разведчиков' : 'воинов'}.`, march: null };
      units[id] = count;
      size += count;
    }
    if (size === 0) return { error: 'Отряд пустой.', march: null };
    if (troops && TROOP_IDS.some((t) => (troops[t] ?? 0) > (held.all[t] ?? 0))) {
      return { error: 'Столько бойцов дома нет.', march: null };
    }
    if (order.mission === 'raid') {
      // Единственный способ ударить — полководец у цели. Оставлять рядом второй
      // путь значило бы, что правило «армия ходит только с ним» держится на
      // честном слове интерфейса.
      return { error: 'В набег армию водит полководец, а не гонец.', march: null };
    }
    if (order.mission === 'scout' && (units.scout ?? 0) === 0) {
      return { error: 'Разведку ведут разведчики.', march: null };
    }
    if (order.mission === 'support') {
      if ((units.warrior ?? 0) === 0) return { error: 'Поддержку несут воины.', march: null };
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
    return { error: null, march: this.viewMarch(march) };
  }

  async marches(): Promise<MarchView[]> {
    return this.visibleMarches(this.clock()).map((m) => this.viewMarch(m));
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
      icon: def.icon,
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
      besieging: id === 'general' ? this.ourSiege(now) : null,
      readyAt: f.handover?.until ?? 0,
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
    // Дожившему до покоя дорога одна — домой.
    if (this.isRetiring(id) && !this.touching(clampToWorld(to))?.home) return this.retiringBlock(id);
    // Занятая фигура с места не сходит. Для лазутчика это и есть цена провала:
    // его задержали, и увести его нельзя, пока не отпустят. Для дипломата —
    // то же правило: посреди переговоров он не уходит.
    const busy = Math.max(0, (f.busyUntil ?? 0) - now);
    if (busy > 0) return `${this.busyNote(id)}: ${formatLeft(busy / 1000)}.`;
    const target = clampToWorld(to);
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
    }
    // Увести полководца из лагеря можно — но это и есть снятие осады, и
    // сказано об этом должно быть **до** приказа (см. `CAMP_LEAVE` в панели и в
    // меню действий). Отказывать здесь нельзя: тогда армия оказалась бы заперта
    // под чужими стенами навсегда.
    if (id === 'general') {
      const camp = this.ourSiege(now);
      if (camp) this.leaveCamp(camp, now);
    }
    this.walk(id, target, now, shownAt);
    this.write();
    return null;
  }

  /**
   * Отправить фигуру в путь — без проверок, их сделал приказ. Здесь же разведчику
   * замораживается риск у ворот цели: на минуту прихода, которая решена сейчас, и на
   * ту обстановку, которую игрок видел в меню (`shownAt`, если меню свежее).
   */
  private walk(id: FigureId, target: Coord, now: number, shownAt?: number): void {
    const f = this.save.figures[id];
    const from = this.figureAt(f, now);
    const seconds = travelTime(distance(from, target), terrainFactor(this.save.seed, from, target), FIGURE_BY_ID[id].speed);
    f.from = from;
    f.to = target;
    f.departAt = now;
    f.arriveAt = now + Math.round(realMs(seconds));
    f.phase = 'moving';
    // Новый путь — новый приказ: удар по лагерю, отданный раньше, отменён.
    f.strike = undefined;
    // Пошёл — значит перестал смотреть. Наблюдение, пережившее дорогу, вернулось
    // бы само собой на новом месте и запирало бы приказы там, где игрок его не
    // ставил: приказ, который молча станет чем-то другим, хуже отказа.
    if (id === WATCHER) f.watching = false;
    f.peril = undefined;
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
    const seconds = travelTime(distance(from, target), terrainFactor(this.save.seed, from, target), FIGURE_BY_ID[id].speed);
    const plan = id === 'scout' ? this.scoutPlan(target, now + Math.round(realMs(seconds))) : null;
    return {
      seconds,
      target: plan?.target?.id ?? null,
      caught: plan?.caught ?? 0,
      peril: plan?.peril ?? 0,
      perilWhy: plan?.why ?? [],
      at: now,
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
        ? `${def.name} погиб: место пустует, пока не наймут нового.`
        : `${def.name} ушёл на покой: место пустует, пока не наймут нового.`;
    }
    if (f.phase !== 'down') return null;
    const left = formatLeft(Math.max(0, f.downUntil - now) / 1000);
    return f.held ? `${def.name}а держат под стражей: отпустят через ${left}.` : `${def.name} вне строя: вернётся через ${left}.`;
  }

  /** Человек на месте дожил до возраста покоя (`RETIRE_AGE`) — так говорит слепок деревни: мир возраста не знает. */
  private isRetiring(id: FigureId): boolean {
    return Boolean(this.save.profile?.agents?.[id]?.retiring) && !this.save.figures[id].gone;
  }

  /** Отказ дожившему до покоя. null — не дожил. */
  private retiringBlock(id: FigureId): string | null {
    return this.isRetiring(id) ? `${FIGURE_BY_ID[id].name} дожил до покоя: дел больше не берёт и идёт домой.` : null;
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
    if (on && placeOf(f) === 'city') return 'Из-за стены не наблюдают: выведи лазутчика из города.';
    if (on && !standing(f.phase)) return 'Наблюдают стоя: доведи лазутчика до места, откуда смотреть.';
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
        ? `${def.name} ещё в пути: в город входят от своих ворот.`
        : `В город входят от своих ворот: доведи ${def.one} домой.`;
    }
    f.sheltered = on ? f.departAt : undefined;
    if (on && id === WATCHER) f.watching = false;
    this.write();
    return null;
  }

  async recallFigure(id: FigureId): Promise<string | null> {
    return this.moveFigure(id, { ...this.save.home });
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
   * Сбор — плата: пока он идёт, в `troops` числятся все, кого он касается, и в
   * обороне их нет ни как гарнизона, ни как дружины (`world/muster.postureOf`).
   */
  async setGarrison(troops: TroopStack | null): Promise<string | null> {
    const now = this.clock();
    const f = this.save.figures.general;
    this.settleHandover(f, now);
    const off = this.offDuty('general', now);
    if (off) return off;
    if (f.phase === 'moving') return 'Полководец в пути — войско к нему не подойдёт.';
    if (placeOf(f) === 'city') return 'Полководец укрылся в городе: выведи его к воротам — и собирай дружину.';
    if (f.handover) {
      return `Дружина ещё в дороге: ${formatLeft(Math.max(0, f.handover.until - now) / 1000)}.`;
    }
    if (!this.touching(this.figureAt(f, now))?.home) {
      return 'Забрать дружину можно только у своей деревни.';
    }
    const room = roomOf(this.save.profile?.army ?? {}, this.save.marches);
    const held = f.troops ?? {};
    const next: TroopStack = {};
    for (const [key, raw] of Object.entries(troops ?? {}) as [keyof TroopStack, number][]) {
      const want = Math.max(0, Math.floor(raw ?? 0));
      if (want <= 0) continue;
      if (want > (room[key] ?? 0)) return 'Столько бойцов дома нет.';
      next[key] = want;
    }
    // Дружину из осаждённого города не увести: это тот же выход, только другим
    // приказом. Вернуть её в гарнизон осада не мешает — под запретом выход, а не
    // вход, и подкрепление под стенами дело хорошее.
    if (TROOP_IDS.some((id) => (next[id] ?? 0) > (held[id] ?? 0))) {
      const blocked = this.siegeBlock(now);
      if (blocked) return blocked;
    }
    // Сколько людей переходит из рук в руки — в обе стороны: время стоит и
    // сбор, и роспуск. Пока идут — они уже не в гарнизоне и ещё не в строю,
    // поэтому в `troops` числятся и уходящие, и возвращающиеся.
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
    const wait = this.musterWait(moved);
    f.troops = troopTotal(onRoad) > 0 ? onRoad : undefined;
    f.handover = { troops: next, until: now + wait };
    // Дружина, стоявшая в обороне, ушла в сбор: за стеной её больше не кормят.
    this.resiege(HOME_ID, now);
    this.write();
    return null;
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
  private standingLost(own: TroopStack, standing: TroopStack, lost: TroopStack): void {
    const share = standingShare(own, standing, lost);
    if (troopTotal(share) === 0) return;
    const f = this.save.figures.general;
    const left = troopsAfter(f.troops ?? {}, share);
    f.troops = troopTotal(left) > 0 ? left : undefined;
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
      text: `Дружину полководца сверили с казармами: ${gone} чел. числились в ней сверх того, что есть у племени, и вычеркнуты.`,
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
        this.offMap(id, now);
        f.held = false;
        f.busyUntil = 0;
        f.gone = { person, at: now, why: 'retired' };
        continue;
      }
      if (want?.retiring && !f.gone) this.retireStep(id, now);
    }
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
    const off = this.offDuty('general', now) ?? this.retiringBlock('general');
    if (off) return { error: off, reportId: null, won: false };
    if (f.phase === 'moving') return { error: 'Полководец ещё в пути.', reportId: null, won: false };
    this.settleHandover(f, now);
    if (f.handover) {
      return {
        error: `Дружина ещё в дороге: ${formatLeft(Math.max(0, f.handover.until - now) / 1000)}.`,
        reportId: null,
        won: false,
      };
    }
    if (troopTotal(f.troops ?? {}) === 0) return { error: 'Войска при полководце нет.', reportId: null, won: false };
    const near = this.touching(this.figureAt(f, now));
    if (!near) return { error: 'Рядом нет чужого поселения.', reportId: null, won: false };
    // Под стенами стоит чужой лагерь — бьём по нему, а не по городу: это и есть
    // «ударить по лагерю» глазами игрока, и считается оно тем же боем, что и
    // вылазка. Свой лагерь этой проверкой не задет: `ourCamp` отсекает его. Под
    // своим городом полководец дома, и его дружина — гарнизон: отказ говорит учёт.
    const camp = this.siegeOf(near.id, now);
    if (camp && !ourCamp(camp)) {
      const check = this.strikeCheck(near.id, now);
      if (check.error !== null) return { error: check.error, reportId: null, won: false };
      return this.resolveStrike(near.id, now, false);
    }
    if (near.home) return { error: 'Рядом нет чужого поселения.', reportId: null, won: false };
    // Держит осаду — ударить можно только по тому городу, который держит: это штурм,
    // и он снимает лагерь. Другого дела у полководца, пока лагерь стоит, нет.
    const besieging = this.ourSiege(now);
    if (besieging && besieging !== near.id) {
      return { error: `${CAMP_BUSY} ${CAMP_LEAVE}`, reportId: null, won: false };
    }
    const target = this.byId.get(near.id);
    if (!target) return { error: 'Цель не найдена.', reportId: null, won: false };
    // Второй раз сожжённое логово разграбить нельзя, потому что его нет. Это
    // правило мира, а не подсказка панели: кнопки у пепелища и так не бывает.
    if (!this.alive(target, now)) {
      return { error: 'Здесь только пепелище: брать нечего.', reportId: null, won: false };
    }
    // Пакт держит и здесь, а не только в панели: правило игры не может стоять
    // на честном слове интерфейса.
    if (standingAt(this.diploOf(target.id, now), now) === 'pact') {
      return {
        error: 'Пакт в силе: удара не будет. Сначала разрыв — его объявляет дипломат.',
        reportId: null,
        won: false,
      };
    }
    // Участь объявляется приказом и проверяется им же.
    const declared = order.fate ?? FATE_DEFAULT;
    const blocked = fateBlock(declared, 'world', this.save.burnImmune[target.id], now, this.playerLocks());
    if (blocked) return { error: blocked, reportId: null, won: false };
    // Штурм из своего лагеря: осада снимается до боя (`STORM_LIFTS`) — и приступ дальше
    // ничем не отличается от удара с дороги.
    if (besieging === target.id) this.liftSiege(target.id, now);
    return this.attackAt(target, now, declared);
  }

  /**
   * Отступить из-под стен: полководец остаётся, где стоял, лагерь снимается. Тот же
   * `leaveCamp`, что у приказа увести полководца, — второго способа снять свою осаду нет.
   */
  async retreat(): Promise<string | null> {
    const now = this.clock();
    const id = this.ourSiege(now);
    if (!id) return 'Лагеря нет: отступать неоткуда.';
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
    if (!w) return 'Лагеря нет: делить древесину некому.';
    if (!WOOD_SHARES.includes(share)) return 'Такой доли нет.';
    if (woodShare(w.wood) === share) return 'Лагерь и так рубит так.';
    w.wood = rebaseWood(siegeSince(w), now, w.wood, share);
    this.write();
    return null;
  }

  /** Окно осаждающего: наш лагерь под чужим городом. null — лагеря нет. */
  async camp(): Promise<CampView | null> {
    const now = this.clock();
    const id = this.ourSiege(now);
    const w = id ? this.siegeOf(id, now) : null;
    const s = id ? this.byId.get(id) : undefined;
    if (!w || !s || !id) return null;
    const reading = readIntel(this.save.intel[id] ?? null, now);
    return {
      byId: w.byId,
      byName: 'Наша дружина',
      since: siegeSince(w),
      starvesAt: this.hunger(w),
      garrison: w.garrisonAtStart,
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
      power: reading ? reading.power : { ...UNKNOWN },
      fates: this.fateOptions(s, now),
      men: troopTotal(this.save.figures.general.troops ?? {}),
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
    if (!target) return 'Дипломату не с кем говорить: рядом нет чужого поселения.';
    if (!target.tribeId) return 'У варваров нет старейшин, с которыми говорят.';
    const def = DEAL_BY_ID[deal];
    const hostility = this.hostilityOf(target.tribeId);
    if (hostility > def.maxHostility) {
      return `Слишком много обид: «${def.name}» подпишут при вражде не выше ${def.maxHostility}, а она ${Math.round(hostility)}.`;
    }
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
      text: `Дипломат договорился в ${target.name}. ${def.description}`,
      read: false,
    });
    this.addEffect({
      id: `deal-${target.tribeId}-${deal}-${now}-eff`,
      lost: {},
      resources: {},
      prestige: 3,
      morale: 3,
      battle: null,
      text: `Договор с племенем ${name}: ${def.name.toLowerCase()}.`,
      good: true,
    });
    this.write();
    return null;
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
    const mix = s.lootMix;
    const out: Loot = {};
    const share = Math.max(1, Math.round(total / mix.length));
    for (const r of mix) out[r] = (out[r] ?? 0) + share;
    return out;
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
   * Почему агент сейчас не может приказывать по этой цели. null — может.
   * Одна проверка на всех: дошёл, не выбыл, не занят прошлым делом.
   */
  private agentBlock(id: FigureId, target: GenSettlement, now: number): string | null {
    const f = this.save.figures[id];
    const def = FIGURE_BY_ID[id];
    const off = this.offDuty(id, now) ?? this.retiringBlock(id);
    if (off) return off;
    if (f.phase === 'moving') return `${def.name} ещё в пути.`;
    if (this.touching(this.figureAt(f, now))?.id !== target.id) {
      return `Слишком далеко: ${def.one} надо довести к самым воротам.`;
    }
    // На пепелище работать не с кем: ни выведывать, ни дарить, ни бунтовать.
    // Отказ с причиной, а не молчаливо погашенная кнопка.
    if (!this.alive(target, now)) return 'Здесь только пепелище: работать не с кем.';
    const busy = Math.max(0, (f.busyUntil ?? 0) - now);
    if (busy > 0) return `${this.busyNote(id)}: ${formatLeft(busy / 1000)}.`;
    // Наблюдатель не работает, и это не подпорка интерфейса, а само правило:
    // живой обзор за пределами круга даёт один лазутчик, и платит он за это
    // тем, что смотрит вместо того, чтобы делать. Отказ — с причиной и с тем,
    // что надо сделать, а не молчаливо погашенная кнопка.
    if (id === WATCHER && f.watching) {
      return 'Лазутчик стоит наблюдателем: пока он смотрит, он не работает. Сними наблюдение — и приказывай.';
    }
    return null;
  }

  /** Чем занят агент — словами. Задержание и своё дело — разные вещи. */
  private busyNote(id: FigureId): string {
    if (this.save.figures[id]?.held) return `${FIGURE_BY_ID[id].name}а держат под стражей`;
    if (id === 'spy') return 'Лазутчик отлёживается после дела';
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
  private diploOptions(target: GenSettlement, now: number): OrderOption[] {
    const rec = this.diploOf(target.id, now);
    const standing = standingAt(rec, now);
    const temper = this.temperOfSettlement(target);
    const pressure = this.damageOf(target.id, now);
    const common =
      this.agentBlock('diplomat', target, now) ??
      (!target.tribeId ? 'У варваров нет старейшин, с которыми говорят.' : null);

    return DIPLO_ACTIONS.map((def) => {
      const chance = chanceOf({ action: def.id, attitude: rec.attitude, temper, standing, pressure, seed: 0 });
      const cost = this.orderCost(def.id, target, now);
      let reason = common;
      if (!reason) {
        const t = TEMPER_BY_ID[temper];
        if (def.id === 'pact' && standing === 'pact') reason = 'Пакт уже подписан.';
        else if (def.id === 'pact' && standing === 'war') reason = 'Сначала мир: под войну договоров не подписывают.';
        else if (def.id === 'pact' && chance === 0)
          reason = `${t.name} и слушать не станет: нужно отношение не ниже ${t.pactBar}, а оно ${rec.attitude}.`;
        else if (def.id === 'peace' && standing !== 'war') reason = 'Воевать не с кем: войны и так нет.';
        else if (def.id === 'peace' && chance === 0)
          reason = `Мириться не станут: нужно отношение не ниже ${t.peaceBar}, а оно ${rec.attitude}.`;
        else if (def.id === 'war' && standing === 'war') reason = 'Война и так идёт.';
        else if (def.id === 'war' && rec.breakAt > 0)
          reason = `Разрыв пакта уже объявлен: осталось ${formatLeft(Math.max(0, rec.breakAt - now) / 1000)}.`;
        else {
          const short = this.shortOf(cost);
          if (short > 0) reason = `На складе не хватает ${short} добра.`;
        }
      }
      return {
        id: def.id,
        can: reason === null,
        reason,
        chance,
        cost,
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
  private spyOptions(target: GenSettlement, now: number, at = now): OrderOption[] {
    const common = this.agentBlock('spy', target, now);
    const keen = Math.max(1, this.save.profile?.intelKeen ?? 1);
    const guard = guardOf(this.powerNow(target, at), target.castle);
    const away = distance(this.save.home, target);
    const risk = this.spyPeril(target, at);
    const times = this.spyTimes();
    return SPY_ACTIONS.map((def) => {
      const chance = spyChance({ action: def.id, keen, guard, distance: away });
      let reason = common;
      if (!reason && def.id === 'revolt') {
        if (!target.tribeId) reason = 'В лагере бродяг нет ни хозяев, ни недовольных: бунтовать не против кого.';
        else if (this.inRevolt(target.id, now)) {
          reason = `Там и так бунт: ещё ${formatLeft(Math.max(0, (this.save.revolts[target.id]?.until ?? 0) - now) / 1000)}.`;
        }
      }
      return {
        id: def.id,
        can: reason === null,
        reason,
        chance,
        // Лазутчик не платит добром: он платит риском.
        cost: {},
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
    if (agent === 'spy') return this.spyOrder(action as 'probe' | 'revolt', s, now, opt.chance ?? 0, opt.peril ?? 0, opt.perilWhy);

    const diplo = action as DiploActionId;
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
      text: `${answer.text} Отношение: ${before} → ${rec.attitude}.`,
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
    const title = out.success ? `${def.name}: ${s.name}` : `Провал у ${s.name}`;
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
      this.downFigure('spy', now, { peril, where: `у ${s.name}`, why, spot: { id: s.id, name: s.name, x: s.x, y: s.y } });
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
    if (!l) return 'Этого письма на столе уже нет: оно разрешилось само, и о том есть строка в летописи.';
    if (letterExpired(l, now)) return 'Срок вышел: гонец уехал.';
    const view = this.letterView(l, now);
    const choice = view.choices.find((c) => c.id === answer);
    if (!choice) return 'В этом письме решать нечего — решают на карте.';
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
    // Слепок собран до того, как племя узнало о последствиях, которые ещё лежат
    // здесь неотданными: павших в них мир списывает с войска сам (`bury`).
    let army = profile.army ?? {};
    for (const e of this.save.effects) if (e.lostTroops) army = troopsAfter(army, e.lostTroops);
    this.save.profile = { ...profile, army };
    this.save.profileAt = now;
    this.seatAgents(now);
    this.muster(now);
    this.lockDefense(now, profile);
    this.advance(now);
    // Орудие поставили, сняли или башня стала ниже его уровня — мир узнаёт об этом на
    // пульсе, и сила обстрела меняется в эту минуту (`aimTower`).
    const besieged = this.homeSiege(now);
    if (besieged) this.aimTower(HOME_ID, besieged, now);
    const reports = this.fresh;
    this.fresh = [];
    const effects = this.save.effects;
    this.save.effects = [];
    this.write();
    return {
      now,
      marches: this.visibleMarches(now).map((m) => this.viewMarch(m)),
      figures: FIGURE_IDS.map((id) => this.viewFigure(id, now)),
      reports,
      effects,
      siege: this.siegeView(now),
      faith: this.faithView(profile.faith ?? null),
      unread: this.save.reports.filter((r) => !r.read).length,
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

  /**
   * Заморозка обороны: за `DEFENSE_FREEZE` до прихода чужой армии расстановка
   * защёлкивается и дальше не меняется, что бы игрок ни присылал в слепке.
   * Иначе оборону перенастраивали бы в последнюю секунду, и разведка нападающего
   * не значила бы ничего.
   */
  private lockDefense(now: number, profile: PlayerProfile): void {
    const soon = this.save.marches.find(
      (m) => !m.own && m.phase === 'out' && m.arriveAt - now <= DEFENSE_FREEZE,
    );
    if (!soon) {
      if (this.save.frozenDefense) this.save.frozenDefense = null;
      return;
    }
    if (this.save.frozenDefense?.marchId === soon.id) return;
    this.save.frozenDefense = { marchId: soon.id, setup: profile.defenseSetup ?? null };
  }

  async persist(): Promise<void> {
    this.write();
  }

}
