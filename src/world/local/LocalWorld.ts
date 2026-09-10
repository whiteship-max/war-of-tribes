// Мир целиком на клиенте: генерация по сиду плюс своя маленькая симуляция соседей.
// Реализует WorldApi — тот же интерфейс, что потом реализует HttpWorld. Всё, что
// считается здесь (время пути, бой, старение разведки), считается детерминированно,
// чтобы сервер мог повторить расчёт один в один.
import { seeded } from '@/game/sim/random';
import { serverNow } from '@/net/clock';
import {
  FRONT,
  GEAR,
  REAR,
  emptyStack,
  stackTotal,
  type ArmySetup,
  type Stack,
  type UnitKind,
} from '@/battle';
import { gearOf, kindsOf, troopLosses, troopTotal, type TroopStack } from '@/game/battle/kinds';
import { TROOP_IDS } from '@/game/data/troops';
import { troopsOfKinds } from '@/game/battle/faces';
import type { BattlePlace } from '@/game/battle/ground';
import type { WorldApi } from '../api';
import type {
  AttackOrder,
  AttackResult,
  BattleRecord,
  CardSack,
  CardSiege,
  Coord,
  DealId,
  DealView,
  DiploActionId,
  DiploRecord,
  DiploView,
  FigureId,
  OrderActionId,
  FigureView,
  HomeEffect,
  Intel,
  IntelReading,
  InterceptPlan,
  Letter,
  LetterAnswerId,
  LetterFrom,
  LetterView,
  Loot,
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
  lairLoot,
  lairPhase,
  lairPop,
  lairPower,
  lairRaidWeight,
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
import { WATCHER, liveSight, standing } from '../sight';
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
  spySeed,
} from '../spy';
import { haltElapsed, sackActive, sackLook, sackPower, sackWindow } from '../sack';
import {
  CAMP_BUSY,
  CAMP_LEAVE,
  PLAYER_CAMP,
  SIEGE_BLOCK,
  campMen,
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
import { stackCarry, stackSize } from '../data/units';
import { asLoss, plunder, type Spoils } from '../spoils';
import { marchSeed, stackAfter, stackLosses, stackPower } from '../combat';
import { garrisonOf, menOfPower, raidingParty, GARRISON_STYLES } from '../garrison';
import { resolveField, type FieldOutcome } from '../battle';
import { placeAt } from '../place';
import { intercept as meetingOf, type Meeting } from '../pursuit';
import { estimate, precisionOf, readIntel } from '../intel';
import {
  AI_MIN_POP,
  CASTLE_GOLD_PER_POWER,
  AI_POWER_SHARE,
  AI_POWER_VS_DEFENSE,
  AI_RANGE,
  AI_WARNING_BASE,
  AI_ATTACK_MAX,
  AI_ATTACK_MIN,
  DAMAGE_RECOVER,
  DEAL_DURATION,
  DEAL_PAYOUT,
  DEFENSE_FREEZE,
  FIGURE_DOWN,
  FIGURE_SCOUT_COVER,
  FIGURE_TOUCH,
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
  SPY_HELD,
  SUPPORT_ATTITUDE,
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
  SIEGE_IF_BELOW,
  SIEGE_RELIEF_AT,
  SIEGE_RELIEF_ATTITUDE,
  SIEGE_RELIEF_RANGE,
  SIEGE_RELIEF_SHARE,
  SIEGE_ROUT,
  SIEGE_SORTIE_AT,
  SIEGE_SORTIE_RATIO,
  SIEGE_TOWN_EAT_MAN,
  SORTIE_CAMP_BONUS,
  SUPPORT_STAY,
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

/** Набег, который пришёлся на время без игрока, не состоится: игра остаётся лёгкой. */
export const AWAY_GRACE = 20_000;

export interface LocalWorldOptions {
  /** Сид мира. По умолчанию берётся из сохранения, иначе случайный. */
  seed?: number;
  /** Часы мира. В тестах подменяются. */
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

const UNKNOWN = { precision: 'unknown' as const, value: null, min: 0, max: 0 };

export class LocalWorld implements WorldApi {
  private gen: WorldGen;
  private save: WorldSave;
  private byId = new Map<SettlementId, GenSettlement>();
  private clock: () => number;
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
    this.clock = opts.now ?? serverNow;
    this.reveal = opts.reveal ?? false;
    this.storage = opts.storage === undefined ? browserStorage : opts.storage;
    this.provide = opts.castles ?? null;
    const stored = parseWorldSave(this.storage?.read() ?? null);
    const seed = opts.seed ?? stored?.seed ?? Math.floor(Math.random() * 0x7fffffff);
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
      name: visible ? c.name : (seen?.owner ?? 'Чей-то замок'),
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
    // Предел щедрый нарочно: слот проходит раз в час, и месяц офлайна — это
    // около семисот слотов. Обрежь их сотней — и догон разошёлся бы с
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
  private homeSiege(now: number): SiegeWindow | null {
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
        garrison: troopTotal(p?.army ?? {}) + extraMen,
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
   * `extraMen` — те, кого слепок ещё не считает домашними: дружина, дошедшая до
   * ворот в эту самую минуту, или, наоборот, вышедшие на вылазку и не
   * вернувшиеся (тогда число отрицательное). Слепок приходит в начале пульса, а
   * событие разбирается уже внутри него; без поправки часы голода соврали бы на
   * целый пульс в чью-то пользу.
   *
   * Начало осады и её одноразовые события при пересчёте не двигаются: осада
   * идёт та же, меняются только часы.
   */
  private openSiegeAt(
    id: SettlementId,
    byId: SettlementId,
    campId: string,
    at: number,
    extraMen = 0,
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
    });
    this.save.sieges[id] = w;
    // Срок стоянки лагеря и есть час голода: падение разбирает та же очередь
    // событий по времени, что и приход любого другого отряда.
    const camp = this.save.marches.find((m) => m.id === campId);
    if (camp) camp.stayUntil = starvesAt(w);
    return w;
  }

  /**
   * Гарнизон изменился — часы голода считаются заново. Один раз, в самом
   * событии: пересчёт на каждое изменение и был бы тем самым тиком, которого у
   * осады нет. Поводов четыре — дружина дошла домой, передача войска вернула её
   * в гарнизон, вылазка вышла и не вернулась, лагерь потерял людей.
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
    return {
      byId: w.byId,
      byName: this.byId.get(w.byId)?.name ?? 'Чужаки',
      since: siegeSince(w),
      starvesAt: starvesAt(w),
      garrison: w.garrisonAtStart,
      foodAtStart: w.foodAtStart,
    };
  }

  /**
   * Лагерь под стенами для карточки поселения. Часов голода здесь нет нарочно:
   * сколько хлеба у чужого города, игрок не знает ни глазами, ни разведкой. Он
   * видит, что осада идёт, — и узнает о её конце вместе с городом.
   */
  private cardSiege(id: SettlementId, now: number): CardSiege | null {
    const w = this.siegeOf(id, now);
    if (!w) return null;
    return {
      mine: ourCamp(w),
      byName: ourCamp(w) ? 'Наша дружина' : (this.byId.get(w.byId)?.name ?? 'Чужаки'),
      since: siegeSince(w),
    };
  }

  /**
   * Войско в лагере: чем он бьётся, когда по нему бьют. Хранится оно там же, где
   * жило и раньше, — в марше у чужого лагеря и при полководце у нашего, — и
   * вторым числом в окне осады не дублируется.
   *
   * `guard` — лагерь обороняется. Вылазка бьёт в готовое: рогатки выставлены,
   * дозоры стоят, — и прибавка идёт числом бойцов (`campMen`), а не отдельной
   * строкой в ядре боя: иначе у боя появилась бы вторая правда о том, сколько
   * кого в строю, и журнал перестал бы сходиться с потерями.
   */
  private campArmy(
    w: SiegeWindow,
    guard: boolean,
  ): {
    kinds: Stack;
    gear: Partial<Record<UnitKind, number>>;
    setup: ArmySetup | null;
    /** Сколько бойцов строя стоит в лагере — с прибавкой, если он готов. */
    men: number;
    power: number;
    name: string;
  } | null {
    const bonus = guard ? SORTIE_CAMP_BONUS : 0;
    if (ourCamp(w)) {
      const troops = this.save.figures.general.troops ?? {};
      const men = troopTotal(troops);
      if (men <= 0) return null;
      const kinds = kindsOf(troops);
      if (bonus > 0) {
        for (const k of Object.keys(kinds) as UnitKind[]) {
          if (kinds[k] > 0) kinds[k] = campMen(kinds[k], bonus);
        }
      }
      return {
        kinds,
        gear: this.ownGear(troops),
        setup: null,
        men: stackTotal(kinds),
        power: men * (this.save.profile?.warriorPower ?? 1),
        name: 'наш лагерь',
      };
    }
    const m = this.save.marches.find((x) => x.id === w.campId);
    if (!m) return null;
    const party = raidingParty(this.save.seed, m.id, m.power);
    const kinds = { ...party.kinds };
    if (bonus > 0) kinds.infantry += campMen(stackTotal(kinds), bonus) - stackTotal(kinds);
    return {
      kinds,
      gear: party.gear,
      // С прибавкой у лагеря людей больше, чем в его расстановке, — пресет
      // выбирается заново по тем же людям, а не растягивается на новых.
      setup: bonus > 0 ? null : party.setup,
      men: stackTotal(kinds),
      power: m.power,
      name: m.fromName,
    };
  }

  /**
   * Кто бы ни ударил по лагерю — вылазка осаждённого, выручка соседей или наш
   * полководец, — считается это здесь и одним боем. Разводить их по трём местам
   * значило бы завести три правды о том, насколько лагерь крепок.
   */
  private campBattle(
    id: SettlementId,
    at: number,
    seed: number,
    attacker: { kinds: Stack; gear: Partial<Record<UnitKind, number>>; setup: ArmySetup | null },
    guard: boolean,
  ): { field: FieldOutcome; camp: NonNullable<ReturnType<LocalWorld['campArmy']>> } | null {
    const w = this.siegeOf(id, at);
    if (!w) return null;
    const camp = this.campArmy(w, guard);
    if (!camp) return null;
    const field = resolveField({
      seed,
      attacker,
      defender: { kinds: camp.kinds, gear: camp.gear, setup: camp.setup },
    });
    return { field, camp };
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
        this.downFigure('general', at, 'потерял всю дружину под чужими стенами.');
      } else {
        f.troops = left;
        if (gone > 0) {
          this.addEffect({
            id: `camp-wear-${at}`,
            lost: { warrior: gone },
            lostTroops: lost,
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
    if (camp) this.turnHome(camp, at, null);
    return w;
  }

  /**
   * Отряд дошёл и увидел, чем его встречают. Лезть на частокол, который заметно
   * сильнее пришедшего, никто не станет: он садится лагерем и берёт город тем,
   * чего у города конечное количество.
   *
   * Кость здесь не про смысл, а про частоту. Смысл задаёт порог: осада
   * случается ровно там, где штурм заведомо не удался бы. Но без ограничителя
   * из этого следует, что крепкая деревня видит лагерь вместо набега почти
   * всегда, — то есть вложение в стену наказывается исчезновением набега как
   * события. Поэтому доля (`SIEGE_CHANCE`) и остывание (`SIEGE_COOLDOWN`)
   * крутятся отдельно от порога: одно отвечает за «можно», другое за «часто ли».
   */
  private beginSiege(m: StoredMarch, at: number): boolean {
    const p = this.save.profile;
    if (!p) return false;
    if (this.save.sieges[HOME_ID]) return false;
    // Цепочку осад закрывает окно неприкосновенности: у павшего города пустой
    // амбар, и вторая осада подряд повторила бы исход, не дав ни решения между.
    if (siegeImmune(this.save.siegeImmune[HOME_ID], at)) return false;
    // Остывание — то же самое, но после любого конца осады, а не только после
    // падения: снял её игрок вылазкой или разбил лагерь союзник — лагерь под
    // теми же стенами не встаёт снова через четверть часа.
    if (at < (this.save.siegeAgainAt[HOME_ID] ?? 0)) return false;
    if (m.power >= Math.max(1, p.defense) * SIEGE_IF_BELOW) return false;
    if (seeded(m.seed)() >= SIEGE_CHANCE) return false;

    const w = this.openSiegeAt(HOME_ID, m.fromId, m.id, at);
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
      target: { id: HOME_ID, name: 'Наша деревня', x: this.save.home.x, y: this.save.home.y },
      won: false,
      sent: {},
      lost: {},
      enemyPower: Math.round(m.power),
      enemyLost: null,
      loot: null,
      intel: null,
      battle: null,
      text: `${m.fromName} не пошли на приступ: заслон крепче их отряда. Встали лагерем у ворот и ждут, когда кончится хлеб.`,
      read: false,
    });
    return true;
  }

  /**
   * Голод сделал своё: город пал. Владелец при этом не меняется — такой механики
   * в игре нет и заводить её здесь незачем. Осада отнимает припасы и дружину,
   * а не посёлок: ни одно здание она не трогает.
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
    if (!ours) return this.homeFalls(w, at);

    // Чужой город доели мы. Гарнизон разошёлся ровно так же, как расходится
    // наш: та же доля и тот же смысл, — а разница в том, кому достаётся склад.
    const s = this.byId.get(id);
    if (!s) return;
    const prev = this.damageOf(id, at);
    this.save.damage[id] = {
      loss: Math.min(0.95, prev + SIEGE_ROUT * (1 - prev)),
      at: this.liveAt(id, at),
    };
    const f = this.save.figures.general;
    const men = troopTotal(f.troops ?? {});
    const gold = Math.round(this.castleGold(s, at) * SIEGE_ROUT);
    const took = this.takeLoot(s, at, stackCarry({ warrior: men }));
    const goods = took.takenTotal;
    const spoils: Loot | null =
      gold > 0 ? { ...took.taken, gold } : goods > 0 ? took.taken : null;
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
      text: `В ${s.name} кончился хлеб. Гарнизон разошёлся, склад вычистили на ${goods} добра.${
        took.hiddenTotal > 0 ? ` В их тайнике осталось ${took.hiddenTotal}.` : ''
      }${gold > 0 ? ` Казна: ${gold} золота.` : ''} Лагерь снят.`,
      read: false,
    });
    this.addEffect({
      id: `siege-${id}-${at}`,
      lost: {},
      resources: spoils ?? {},
      prestige: 5,
      morale: 5,
      // Настоящего боя не было ни у нас, ни у них: город взяли голодом, и
      // записывать это в битвы значило бы считать то, чего не случилось.
      battle: null,
      text: `Осада ${s.name} кончилась: город сдался голоду.`,
      good: true,
    });
    this.moveAttitude(id, ATTACK_ATTITUDE, at);
  }

  /** Пал наш город. Всё, что при этом происходит, — здесь и больше нигде. */
  private homeFalls(w: SiegeWindow, at: number): void {
    const p = this.save.profile;
    const army = p?.army ?? {};
    // Гарнизон рассеян: люди с оружием из взятого голодом города расходятся.
    const routed: TroopStack = {};
    for (const id of TROOP_IDS) {
      const gone = Math.floor(Math.max(0, army[id] ?? 0) * SIEGE_ROUT);
      if (gone > 0) routed[id] = gone;
    }
    const men = troopTotal(routed);
    const camp = this.save.marches.find((m) => m.id === w.campId);
    // Берут столько, сколько унесут, и всё, что не влезло в тайник: правило то
    // же, что у прорвавшегося набега, и функция та же (`spoils.plunder`).
    const spoils = this.plunderHome(p ?? null, stackCarry(camp?.units ?? {}));
    const taken = spoils.takenTotal;
    const from = this.byId.get(w.byId)?.name ?? camp?.fromName ?? 'Чужаки';

    this.addReport({
      id: `${w.campId}-fell`,
      at,
      kind: 'defense',
      title: 'Хлеб кончился',
      target: { id: HOME_ID, name: 'Наша деревня', x: this.save.home.x, y: this.save.home.y },
      won: false,
      sent: { warrior: Math.round(troopTotal(army)) },
      lost: men > 0 ? { warrior: men } : {},
      enemyPower: Math.round(camp?.power ?? 0),
      enemyLost: null,
      loot: taken > 0 ? asLoss(spoils.taken) : null,
      hidden: spoils.hiddenTotal,
      intel: null,
      battle: null,
      text: `Голод сделал за ${from} всю работу: гарнизон разошёлся, склад вычистили на ${taken} добра.${spoils.hiddenTotal > 0 ? ` В тайнике уцелело ${spoils.hiddenTotal}.` : ''} Лагерь снят.`,
      read: false,
    });
    this.addEffect({
      id: `${w.campId}-fell`,
      lost: men > 0 ? { warrior: men } : {},
      lostTroops: men > 0 ? routed : undefined,
      resources: asLoss(spoils.taken),
      prestige: 0,
      morale: -12,
      // Настоящего боя не было: город взяли голодом, и записывать это в
      // проигранные битвы значило бы считать то, чего не случилось.
      battle: null,
      text: `Осада ${from} доела деревню: гарнизон рассеян, склад вычищен.`,
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
    const camp = this.campArmy(w, true);
    if (!camp) return;
    const power = this.powerNow(s, at);
    // Сравниваются **бойцы строя**, а не мощь с мощью: у лагеря игрока мощь
    // считается головами найма на среднюю силу бойца, а у поселения — своей
    // меркой, и сравнивать их напрямую значило бы сравнивать разное.
    if (menOfPower(power) < camp.men * SIEGE_SORTIE_RATIO) return;
    const g = garrisonOf(this.save.seed, s.id, power, s.castle);
    const out = this.campBattle(id, at, this.warSeed().seed, { kinds: g.kinds, gear: g.gear, setup: g.setup }, true);
    if (!out) return;
    this.resolveSortieOn(id, at, out.field, `Из ${s.name} вышли на вылазку.`);
    // Гарнизон вышел и поредел: часы голода города считаются заново — один раз,
    // здесь, в самом событии.
    const gone = Math.round(menOfPower(power) * out.field.attackerLoss);
    const prev = this.damageOf(id, at);
    this.save.damage[id] = {
      loss: Math.min(0.95, prev + out.field.attackerLoss * (1 - prev)),
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
   * голода или потерями. Сосед, снимающий её даром через семь минут, отнял бы у
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
    if (!this.campArmy(w, false)) return;
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
      arriveAt: at + Math.round(seconds * 1000),
      phase: 'out',
      power,
      loot: null,
      relief: id,
    });
  }

  /**
   * Отряд выручки дошёл до лагеря. Бой — тот же, что у вылазки, только лагерь
   * бьют снаружи и врасплох: прибавки за готовность у него здесь нет.
   */
  private resolveRelief(m: StoredMarch, at: number): void {
    const id = m.relief as SettlementId;
    const w = this.siegeOf(id, at);
    this.remove(m);
    // Осаду успели снять без них — отряд разворачивается и уходит домой.
    if (!w) return;
    const party = raidingParty(this.save.seed, m.id, m.power);
    const out = this.campBattle(
      id,
      at,
      m.seed,
      { kinds: party.kinds, gear: party.gear, setup: party.setup },
      false,
    );
    if (!out) return;
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
      enemyLost: Math.round(m.power * out.field.attackerLoss),
      loot: null,
      intel: null,
      battle: null,
      text: out.field.won
        ? `${m.fromName} пришли на выручку ${target.name} и сбили наш лагерь. Осада снята.`
        : `${m.fromName} пришли на выручку ${target.name} и были отбиты. Осада стоит.`,
      read: false,
    });
  }

  /**
   * Наш полководец садится в осаду под городом, у которого стоит. Тем же окном,
   * теми же часами голода и тем же порядком падения, что у чужой осады: второй
   * реализации у осады нет.
   */
  async besiege(): Promise<string | null> {
    const now = this.clock();
    const f = this.save.figures.general;
    if (f.phase === 'down') return 'Полководец выбыл.';
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
    if (standingAt(this.diploOf(target.id, now), now) === 'pact') {
      return 'Пакт в силе: осады не будет. Сначала разрыв — его объявляет дипломат.';
    }
    if (this.save.sieges[target.id]) return 'Под этими стенами уже стоит лагерь.';
    if (siegeImmune(this.save.siegeImmune[target.id], now)) {
      return 'Город недавно доели: в амбаре пусто, осаждать нечего.';
    }
    this.openSiegeAt(target.id, HOME_ID, PLAYER_CAMP, now);
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
      text: `Дружина обложила ${target.name}. Сколько у них хлеба, мы не знаем — узнаем вместе с ними. ${CAMP_LEAVE}`,
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
  async sortie(troops: TroopStack, setup: ArmySetup | null = null): Promise<AttackResult> {
    const now = this.clock();
    const w = this.homeSiege(now);
    if (!w) return { error: 'Под стенами никого: выходить не на кого.', reportId: null, won: false };
    const home = this.save.profile?.army ?? {};
    const going: TroopStack = {};
    for (const [key, raw] of Object.entries(troops ?? {}) as [keyof TroopStack, number][]) {
      const n = Math.max(0, Math.floor(raw ?? 0));
      if (n <= 0) continue;
      if (n > (home[key] ?? 0)) return { error: 'Столько бойцов дома нет.', reportId: null, won: false };
      going[key] = n;
    }
    const men = troopTotal(going);
    if (men === 0) return { error: 'Выходить некому: отряд пустой.', reportId: null, won: false };

    const seed = marchSeed(this.save.seed, this.save.nextMarch++);
    const out = this.campBattle(
      HOME_ID,
      now,
      seed,
      { kinds: kindsOf(going), gear: this.ownGear(going), setup },
      true,
    );
    if (!out) return { error: 'Лагеря под стенами уже нет.', reportId: null, won: false };
    const { field, camp } = out;

    const lostTroops = field.result ? troopLosses(going, field.result.sides.attacker.losses) : {};
    const lostMen = troopTotal(lostTroops);
    const campLost = this.resolveSortieOn(HOME_ID, now, field, 'Мы вышли на вылазку.');
    // Осада снята победой — считать часы голода больше не по чему. Не снята —
    // гарнизон стал меньше на потери, и часы идут от него.
    if (!field.won) this.resiege(HOME_ID, now, -lostMen);

    const record: BattleRecord | null = field.result
      ? {
          us: 'attacker',
          preset: field.preset.attacker,
          result: field.result,
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
      target: { id: HOME_ID, name: 'Наша деревня', x: this.save.home.x, y: this.save.home.y },
      won: field.won,
      sent: { warrior: men },
      lost: lostMen > 0 ? { warrior: lostMen } : {},
      enemyPower: Math.round(camp.power),
      enemyLost: campLost,
      loot: null,
      intel: null,
      battle: record,
      text: field.won
        ? `Дружина вышла из ворот и разметала лагерь. Осада снята, город снова ест.`
        : `Лагерь встретил вылазку готовым (${Math.round(SORTIE_CAMP_BONUS * 100)}% сверху за рогатки и дозоры). Отбились, но и им досталось: ${campLost} чел. Осада стоит.`,
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
    // сути (втрое от базы за полтора суток) и считается от возраста мира, а
    // логово может завестись сегодня. Часы берутся собственные, как у соседей:
    // бунт останавливает и рост логова тоже.
    const base = isLair(s)
      ? lairPower(this.anchorOf(s), this.lairRec(s.id), this.liveAt(s.id, now))
      : powerOf(s, this.lived(s, now), POWER_GROWTH_CAP);
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

  /** Характер владельца: один на все его дворы, потому что владелец один. */
  private temperOfSettlement = (s: GenSettlement): TemperId =>
    temperOf(this.save.seed, s.owner ?? s.id);

  /**
   * Отношения с двором. Если состояние успело смениться само (пакт истёк,
   * настал срок объявленного разрыва), запись правится тут же — это не тик, а
   * приведение при чтении: считать одно и то же дважды нельзя.
   */
  private diploOf(id: SettlementId, now: number): DiploRecord {
    const rec = this.save.diplomacy[id] ?? freshRecord(now);
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
   * остальное — набеги оттуда вшестеро охотнее (`AI_WAR_WEIGHT`) и общий темп
   * быстрее (`AI_WAR_PACE`). Ни одного нового числа в набегах для этого не
   * понадобилось.
   *
   * Потолков у мести четыре, и три из них стояли до этой задачи. Новый — только
   * `REVENGE_WARS_MAX`: больше стольких войн разом на голову не свалится. Прежние:
   * шкала отношения снизу заперта (`ATTITUDE_MIN`), то есть охотнее некуда; набег
   * на нас один за раз и не сильнее `AI_POWER_VS_DEFENSE` доли обороны; чаще, чем
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
    };
  }

  private homeView(now: number): SettlementView {
    const p = this.save.profile;
    return {
      id: HOME_ID,
      x: this.save.home.x,
      y: this.save.home.y,
      name: 'Наша деревня',
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
    };
  }

  private addReport(r: Report): void {
    this.save.reports.unshift(r);
    if (this.save.reports.length > REPORTS_KEPT) this.save.reports.length = REPORTS_KEPT;
    this.fresh.push(r);
  }

  private addEffect(e: HomeEffect): void {
    this.save.effects.push(e);
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
   */
  private snapshot(s: GenSettlement, now: number): Intel {
    const power = this.powerNow(s, now);
    const g = garrisonOf(this.save.seed, s.id, power, s.castle);
    const formation: Partial<Record<string, Stack>> = {};
    for (const id of [...FRONT, ...REAR]) formation[id] = { ...g.setup.sectors[id] };
    return {
      at: now,
      power,
      pop: this.popNow(s, now),
      // Разведка видит амбары, а не подпол: в снимок идёт открытая часть склада,
      // и тайника чужого двора игрок не узнаёт ни числом, ни разведкой.
      loot: this.lootOpen(s, now),
      kinds: g.kinds,
      formation,
      style: GARRISON_STYLES[g.style].name,
    };
  }

  // ---------- Добыча ----------

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
   * Доля выбрана по игроку: на десятом уровне Тайника он прячет около четверти
   * полного склада (docs/sack.md). Без неё игрок выдоил бы соседей досуха, а
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

  /** Что видно разведке: склад двора за вычетом того, что в тайнике. */
  private lootOpen(s: GenSettlement, now: number): number {
    return plunder(this.lootStock(s, now), this.lootStash(s, now), Infinity).takenTotal;
  }

  /**
   * Сколько золота лежит в замке сейчас. Восстанавливается тем же сроком, что и
   * прочая добыча, поэтому дважды подряд один замок не обчистить.
   */
  private castleGold(s: GenSettlement, now: number): number {
    if (!s.castle) return 0;
    const last = this.save.looted[s.id] ?? this.save.createdAt - LOOT_REFILL;
    const refill = Math.min(1, Math.max(0, (this.liveAt(s.id, now) - last) / LOOT_REFILL));
    return Math.round(powerOf(s, this.lived(s, now), POWER_GROWTH_CAP) * CASTLE_GOLD_PER_POWER * refill);
  }

  /**
   * Сколько игрок видит чужую армию до её прихода. База обязана быть заметно
   * больше `DEFENSE_FREEZE` — иначе набег появляется уже запертым; Дозор игрока
   * только прибавляет сверху, укоротить предупреждение он не может.
   */
  private warningMs(): number {
    return AI_WARNING_BASE + Math.max(0, this.save.profile?.warning ?? 0) * 1000;
  }


  /**
   * Снаряжение своего отряда. Конюшня добавляет коннице ступень: мощь бойца она
   * не трогает (это запрещено — мощь считается из состава), а ступень снаряжения
   * даёт в бою мораль, и именно так сытые кони и добрая сбруя работают.
   */
  private ownGear(troops: TroopStack): Partial<Record<UnitKind, number>> {
    const gear = gearOf(troops);
    const bonus = Math.max(0, Math.round(this.save.profile?.mountGear ?? 0));
    if (bonus > 0 && gear.cavalry !== undefined) {
      gear.cavalry = Math.min(GEAR.max, gear.cavalry + bonus);
    }
    return gear;
  }

  /**
   * Что победитель выносит из чужого двора. Считает это то же правило, что и у
   * нашей деревни (`spoils.plunder`): всё, кроме тайника, но не больше, чем
   * поднимет отряд. Второй арифметики добычи в игре нет.
   */
  private takeLoot(s: GenSettlement, now: number, carry: number): Spoils {
    const avail = this.lootAvailable(s, now);
    const spoils = plunder(this.lootStock(s, now), this.lootStash(s, now), carry);
    const cap = Math.max(1, this.lootCap(s, now));
    // На складе остаётся тайник и то, что не подняли: отметка ставится так,
    // чтобы наполнение пошло именно с этого места, а не с нуля и не с полного.
    const left = Math.max(0, avail - spoils.takenTotal);
    this.save.looted[s.id] = this.liveAt(s.id, now) - Math.min(1, left / cap) * LOOT_REFILL;
    return spoils;
  }

  /**
   * Что чужаки унесут у игрока. Считает это общее правило (`spoils.plunder`) —
   * то же самое, которым игрок обчищает чужие дворы: склад минус тайник, но не
   * больше, чем отряд поднимет. Своей арифметики у этой стороны нет и быть не
   * должно; отличаются стороны только тем, откуда берутся склад и тайник.
   */
  private plunderHome(profile: PlayerProfile | null, carry: number): Spoils {
    if (!profile) return { taken: {}, takenTotal: 0, hiddenTotal: 0, spilledTotal: 0 };
    return plunder(profile.stock ?? {}, profile.stash ?? 0, carry);
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
   * растягивать его вслед за изучением нельзя: тогда десятая ступень отдала бы
   * игроку живое наблюдение за третью карты даром.
   */
  private homeReveal(): number {
    return Math.max(HOME_SIGHT, Math.round(this.save.profile?.survey ?? 0));
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
  private sightDiscs(now: number): SightDisc[] {
    const out: SightDisc[] = [{ x: this.save.home.x, y: this.save.home.y, r: HOME_SIGHT }];
    for (const id of FIGURE_IDS) {
      const f = this.save.figures[id];
      if (!f) continue;
      const r = liveSight(id, f.phase, f.watching);
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
      if (!f || f.phase === 'down') continue;
      this.fog.revealPath(this.figureAt(f, from), this.figureAt(f, now), FIGURE_BY_ID[id].sight);
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
        tribeId: null,
        pop: c.pop,
        power: c.power,
        castle: true,
      };
    }
  }

  // ---------- Фигуры ----------

  /** Поселение, у которого фигура стоит вплотную. HOME_ID — своё. */
  private touching(at: Coord): { id: SettlementId; name: string; home: boolean } | null {
    if (distance(at, this.save.home) <= FIGURE_TOUCH) {
      return { id: HOME_ID, name: 'Наша деревня', home: true };
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

  /** Отправляет фигуру домой павшей: насовсем её потерять нельзя. */
  private downFigure(id: FigureId, at: number, text: string): void {
    const f = this.save.figures[id];
    const def = FIGURE_BY_ID[id];
    f.phase = 'down';
    f.from = { ...this.save.home };
    f.to = { ...this.save.home };
    f.departAt = at;
    f.arriveAt = at;
    f.downUntil = at + FIGURE_DOWN;
    const lost = f.troops ?? {};
    f.troops = undefined;
    this.addEffect({
      id: `fig-${id}-${at}`,
      lost: {},
      lostTroops: troopTotal(lost) > 0 ? lost : undefined,
      resources: {},
      prestige: 0,
      morale: -4,
      battle: null,
      text: `${def.name} ${text} Вернётся не скоро.`,
      good: false,
    });
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
        if (now < f.downUntil) continue;
        f.phase = 'home';
        f.downUntil = 0;
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
          text: `${FIGURE_BY_ID[id].name} снова в строю.`,
          good: true,
        });
        continue;
      }
      if (f.phase === 'moving' && now >= f.arriveAt) {
        const at = f.arriveAt;
        f.from = { ...f.to };
        f.departAt = at;
        f.phase = this.touching(f.to)?.home ? 'home' : 'field';
        this.onFigureArrived(id, at);
        if (this.save.figures[id].phase === 'down') continue;
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
   * Что случается в момент прибытия. Бросок один и посеян временем выхода, а не
   * порядком разбора событий: иначе онлайн и офлайн дали бы разные исходы.
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
    if (id === 'scout') {
      const power = this.powerNow(target, at);
      if (power > FIGURE_SCOUT_COVER && rng() < 0.25) {
        this.downFigure(id, at, `попался часовым у ${target.name}.`);
        return;
      }
      this.save.intel[target.id] = this.snapshot(target, at);
      return;
    }
    if (id === 'diplomat' && this.relationOf(target) === 'enemy' && rng() < 0.3) {
      this.downFigure(id, at, `схвачен во враждебном ${target.name}.`);
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
    const prevSeen = save.seenAt;

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
      this.resolve(next, this.dueAt(next), prevSeen);
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

  private resolve(m: StoredMarch, at: number, prevSeen: number): void {
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
        ? this.resolveIncoming(m, at, prevSeen)
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
    // заново. Один раз, здесь, в самом событии.
    this.resiege(HOME_ID, at, troopTotal(m.troops ?? {}) || Math.max(0, m.units.warrior ?? 0));
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
  private attackAt(target: GenSettlement, at: number, setup: ArmySetup | null): AttackResult {
    const f = this.save.figures.general;
    const troops = f.troops ?? {};
    const men = troopTotal(troops);
    const seed = marchSeed(this.save.seed, this.save.nextMarch++);
    const defense = this.powerNow(target, at);
    const garrison = garrisonOf(this.save.seed, target.id, defense, target.castle);
    const field = resolveField({
      seed,
      attacker: { kinds: kindsOf(troops), gear: this.ownGear(troops), setup },
      defender: { kinds: garrison.kinds, gear: garrison.gear, setup: garrison.setup },
      intel: this.save.intel[target.id]?.kinds,
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
    const arms = burned ? lairArms(defense) : 0;
    // Золото берут до добра: доля казны соразмерна тому, сколько гарнизона выбили.
    const gold = field.won ? Math.round(this.castleGold(target, at) * field.defenderLoss) : 0;
    // Победитель выгребает склад дочиста — всё, кроме тайника, и не больше, чем
    // отряд поднимет. Правило то же, что у набега на нашу деревню, и функция та
    // же: одностороннего дележа в игре нет.
    const took = field.won
      ? this.takeLoot(target, at, stackCarry({ warrior: survivors }))
      : { taken: {} as Loot, takenTotal: 0, hiddenTotal: 0, spilledTotal: 0 };
    const goods = took.takenTotal;
    const spoils: Loot | null =
      gold > 0 ? { ...took.taken, gold } : goods > 0 ? took.taken : null;
    // Сжигается логово после того, как из него всё вынесли: сожжённое уже не
    // отдаёт ни добра, ни разведданных — их брать не у кого.
    if (burned) this.burnLair(target, at);
    // Выигранный набег на поселение оставляет разорение: сжечь чужой двор нельзя
    // (он чужой, а позже будет человеческий), но и стоять нетронутым после
    // победы он не должен. Ставится это **после** добычи: разоряют то, что не
    // унесли, а склад разорённого двора не наполняется, пока стоят его часы.
    if (field.won && !burned) {
      this.sackSettlement(target.id, at, this.save.profile?.name ?? 'Мы');
    }
    const lootText =
      (goods > 0 ? ` Взято: ${goods} добра.` : '') +
      (took.hiddenTotal > 0 ? ` В тайнике у них осталось ${took.hiddenTotal}.` : '') +
      (arms > 0 ? ` Оружия: ${arms}.` : '') +
      (gold > 0 ? ` Казна замка: ${gold} золота.` : '');
    const record: BattleRecord | null = field.result
      ? {
          us: 'attacker',
          preset: field.preset.attacker,
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
      hidden: took.hiddenTotal,
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
      // Обоз идёт домой сам: полководец остаётся в поле, а добыча ему не нужна.
      resources: spoils ?? {},
      // Оружие едет числом: во что оно превратится, решает племя — про кузницу
      // и её список мир не знает.
      arms: arms > 0 ? arms : undefined,
      lair: burned || undefined,
      prestige: field.won ? 4 : 0,
      morale: field.won ? 4 : -6,
      battle: field.won ? 'won' : 'lost',
      text: burned
        ? `Логово ${target.name} (${formatCoord(target)}) сожжено.`
        : field.won
          ? `Набег на ${target.name} (${formatCoord(target)}) удался.`
          : `Набег на ${target.name} (${formatCoord(target)}) отбит.`,
      good: field.won,
    });

    if (survivors === 0) {
      f.troops = undefined;
      this.downFigure('general', at, `разбит под ${target.name}.`);
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
    return seconds > 0 ? 1 / (seconds * 1000) : 0;
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
    if (f.phase === 'down') {
      return {
        meet: null,
        reason: `Полководец выбыл: вернётся через ${formatLeft(Math.max(0, f.downUntil - now) / 1000)}.`,
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
      attacker: { kinds: kindsOf(troops), gear: this.ownGear(troops), setup: null },
      defender: { kinds: party.kinds, gear: party.gear, setup: party.setup },
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
          preset: field.preset.attacker,
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
      resources: {},
      prestige: field.won ? 4 : 0,
      morale: field.won ? 5 : -5,
      battle: field.won ? 'won' : 'lost',
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
      this.downFigure('general', at, `разбит в поле у ${formatCoord(spot)}.`);
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

  private resolveIncoming(m: StoredMarch, at: number, prevSeen: number): void {
    // Пока игрока не было, никто ничего не громит: предупреждение он бы не увидел.
    // Это и осады касается: лагерь под стенами спящего — то же самое разорение,
    // только растянутое.
    if (at - prevSeen > AWAY_GRACE) {
      this.remove(m);
      this.addReport({
        id: `${m.id}-skip`,
        at,
        kind: 'defense',
        title: 'Набег не состоялся',
        target: { id: HOME_ID, name: 'Наша деревня', x: this.save.home.x, y: this.save.home.y },
        won: true,
        sent: {},
        lost: {},
        enemyPower: Math.round(m.power),
        enemyLost: null,
        loot: null,
        intel: null,
        battle: null,
        text: `${m.fromName}: чужаки покружили у становища и ушли.`,
        read: false,
      });
      return;
    }
    // Отряд дошёл и увидел заслон. Если тот заведомо крепче — на приступ никто
    // не пойдёт: марш становится лагерем, и разбирать его будет уже осада.
    if (this.beginSiege(m, at)) return;
    this.remove(m);

    const profile = this.save.profile;
    const party = raidingParty(this.save.seed, m.id, m.power);
    // Гарнизон дома: бойцы племени плюс ополчение — частокол, башня и сами жители.
    // Ополчение в расстановке не участвует: пехота растекается по фронту сама,
    // а стрелков башни ставит во вторую линию `toArmySetup`.
    const home = profile?.army ?? {};
    const militia = Math.max(0, Math.round(profile?.militia ?? 0));
    // Башня ставит часть ополчения стрелками: людей не прибавляется, меняется род.
    const archers = Math.min(militia, Math.max(0, Math.round(profile?.militiaArchers ?? 0)));
    const homeKinds = kindsOf(home);
    homeKinds.infantry += militia - archers;
    homeKinds.archer += archers;
    // Оборона, запертая за пять минут до прихода: менять её было уже нельзя.
    const frozen = this.save.frozenDefense;
    const setup = frozen && frozen.marchId === m.id ? frozen.setup : (profile?.defenseSetup ?? null);
    const field = resolveField({
      seed: m.seed,
      attacker: { kinds: party.kinds, gear: party.gear, setup: party.setup },
      defender: { kinds: homeKinds, gear: this.ownGear(home), setup },
    });
    const outcome = { won: field.won, attackerLoss: field.attackerLoss, defenderLoss: field.defenderLoss };
    const record: BattleRecord | null = field.result
      ? {
          us: 'defender',
          preset: setup ? null : field.preset.defender,
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
    const warriors = profile?.units.warrior ?? 0;
    // Ополчение гибнет наравне со всеми, но списываются только бойцы: жителей
    // набег не уносит — за них отвечают мораль и разграбленный склад.
    const troopsLost = field.result ? troopLosses(home, field.result.sides.defender.losses) : {};
    const warriorsLost = Math.min(warriors, troopTotal(troopsLost) || Math.round(warriors * outcome.defenderLoss));
    // Симметрия: прорвавшийся набег чистит наш склад тем же правилом и той же
    // функцией, какой мы чистим чужие дворы, — всё, кроме тайника, и не больше,
    // чем поднимет отряд. Считается это здесь, **после** проверки `AWAY_GRACE`:
    // пока игрока нет, набег не состоится вовсе, а значит и терять нечего.
    const spoils = outcome.won
      ? this.plunderHome(profile, stackCarry(attackerLeft))
      : { taken: {}, takenTotal: 0, hiddenTotal: 0, spilledTotal: 0 };
    const taken = spoils.takenTotal;

    this.addReport({
      id: `${m.id}-defense`,
      at,
      kind: 'defense',
      title: outcome.won ? 'Деревню разграбили' : 'Нападение отбито',
      target: { id: HOME_ID, name: 'Наша деревня', x: this.save.home.x, y: this.save.home.y },
      won: !outcome.won,
      sent: { warrior: warriors },
      lost: warriorsLost > 0 ? { warrior: warriorsLost } : {},
      enemyPower: Math.round(m.power),
      enemyLost: Math.round(m.power * outcome.attackerLoss),
      loot: taken > 0 ? asLoss(spoils.taken) : null,
      hidden: outcome.won ? spoils.hiddenTotal : 0,
      intel: null,
      battle: record,
      text: outcome.won
        ? `${m.fromName} прорвались через заслон и вычистили склад: унесено ${taken} добра.${spoils.hiddenTotal > 0 ? ` В тайнике уцелело ${spoils.hiddenTotal}.` : ''}`
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
      resources: asLoss(spoils.taken),
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
      // Стол на пять, и очереди за ним нет: шестое письмо сгоняет то, у
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
      // Ячейка у предупреждения своя, пятая: сгонять решения оно не должно —
      // чужой отряд выходит каждые четверть часа, и стол превратился бы в
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
      body: def.body(l, goods),
      from: this.letterFrom(l),
      choices,
      seconds: Math.max(0, (l.until - now) / 1000),
      silence: def.silence(l),
    };
  }

  /**
   * Мягкие набеги: редко, из ближних поселений и всегда с запасом времени на реакцию.
   * Мощь набега упирается в оборону игрока — потерять всё за одну ночь нельзя.
   */
  private scheduleAi(now: number): void {
    const save = this.save;
    if (now < save.nextAiAt) return;
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
    if (!profile || profile.pop < AI_MIN_POP) return;
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
    const power = Math.max(
      2,
      Math.min(this.powerNow(src, now) * AI_POWER_SHARE, Math.max(3, profile.defense * AI_POWER_VS_DEFENSE)),
    );
    const units: UnitStack = { warrior: Math.max(1, Math.round(power / 3)) };
    const seconds = marchSeconds(distance(src, home), terrainFactor(save.seed, src, home), units);
    const travel = Math.max(seconds * 1000, this.warningMs());
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
      toName: 'Наша деревня',
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
   * Наш полководец бьёт по чужому лагерю, у которого стоит. Бой — тот же, что у
   * вылазки и у выручки: правда о том, насколько крепок лагерь, одна.
   *
   * У своих ворот лагерь встречает нас готовым — это и есть вылазка, только
   * ведёт её полководец своей дружиной, а не гарнизон. У чужих ворот лагерь
   * бьют снаружи, и прибавки за готовность у него нет.
   */
  private breakCamp(id: SettlementId, at: number): AttackResult {
    const f = this.save.figures.general;
    const troops = f.troops ?? {};
    const men = troopTotal(troops);
    const seed = marchSeed(this.save.seed, this.save.nextMarch++);
    const guard = id === HOME_ID;
    const out = this.campBattle(
      id,
      at,
      seed,
      { kinds: kindsOf(troops), gear: this.ownGear(troops), setup: null },
      guard,
    );
    if (!out) return { error: 'Лагеря под стенами уже нет.', reportId: null, won: false };
    const { field, camp } = out;

    const lostTroops = field.result ? troopLosses(troops, field.result.sides.attacker.losses) : {};
    const left: TroopStack = {};
    for (const [key, n] of Object.entries(troops) as [keyof TroopStack, number][]) {
      const rest = (n ?? 0) - (lostTroops[key] ?? 0);
      if (rest > 0) left[key] = rest;
    }
    const lostMen = men - troopTotal(left);
    const campLost = this.resolveSortieOn(id, at, field, 'Полководец ударил по лагерю.');
    // Осада не снята — гарнизон города не менялся, а вот наши потери к нему не
    // относятся: в лагере стояли не они. Пересчитывать часы голода не с чего.
    const target = id === HOME_ID ? null : this.byId.get(id);
    const place = target ? { id, name: target.name, x: target.x, y: target.y } : {
      id: HOME_ID,
      name: 'Наша деревня',
      x: this.save.home.x,
      y: this.save.home.y,
    };
    const record: BattleRecord | null = field.result
      ? {
          us: 'attacker',
          preset: field.preset.attacker,
          result: field.result,
          troops: { attacker: { ...troops }, defender: troopsOfKinds(camp.kinds, camp.gear) },
          place: this.placeOf(target ?? this.save.home),
        }
      : null;

    const reportId = `camp${seed}`;
    this.addReport({
      id: reportId,
      at,
      kind: 'raid',
      title: field.won ? `Лагерь разбит: ${camp.name}` : `Лагерь устоял: ${camp.name}`,
      target: place,
      won: field.won,
      sent: { warrior: men },
      lost: lostMen > 0 ? { warrior: lostMen } : {},
      enemyPower: Math.round(camp.power),
      enemyLost: campLost,
      loot: null,
      intel: null,
      battle: record,
      text: field.won
        ? `Лагерь ${camp.name} разметан, осада снята.`
        : `Лагерь ${camp.name} отбился${guard ? ` (${Math.round(SORTIE_CAMP_BONUS * 100)}% сверху за готовность)` : ''}. Осада стоит, но и им досталось: ${campLost} чел.`,
      read: false,
    });
    this.addEffect({
      id: `${reportId}-eff`,
      lost: lostMen > 0 ? { warrior: lostMen } : {},
      lostTroops,
      resources: {},
      prestige: field.won ? 4 : 0,
      morale: field.won ? 5 : -4,
      battle: field.won ? 'won' : 'lost',
      text: field.won ? `Лагерь ${camp.name} разбит: осада снята.` : `Лагерь ${camp.name} устоял.`,
      good: field.won,
    });

    if (troopTotal(left) === 0) {
      f.troops = undefined;
      this.downFigure('general', at, `положил дружину на лагерь ${camp.name}.`);
    } else {
      f.troops = left;
    }
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
      arriveAt: now + Math.round(seconds * 1000),
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
    if (
      !this.save.sieges[m.targetId] &&
      !siegeImmune(this.save.siegeImmune[m.targetId], at) &&
      at >= (this.save.siegeAgainAt[m.targetId] ?? 0) &&
      m.power < Math.max(1, power) * SIEGE_IF_BELOW &&
      seeded(m.seed)() < SIEGE_CHANCE
    ) {
      const w = this.openSiegeAt(m.targetId, m.fromId, m.id, at);
      this.save.siegeAgainAt[m.targetId] = at + SIEGE_COOLDOWN;
      m.phase = 'stay';
      m.stayUntil = starvesAt(w);
      return;
    }
    const party = raidingParty(this.save.seed, m.id, m.power);
    const g = garrisonOf(this.save.seed, target.id, power, target.castle);
    const field = resolveField({
      seed: m.seed,
      attacker: { kinds: party.kinds, gear: party.gear, setup: party.setup },
      defender: { kinds: g.kinds, gear: g.gear, setup: g.setup },
    });
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
        // унесли бы у него: весь склад за вычетом собственного тайника.
        loot: estimate(plunder(p?.stock ?? {}, p?.stash ?? 0, Infinity).takenTotal, 'exact'),
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
      pop:
        reading?.pop ??
        (view.seenPop !== null ? estimate(view.seenPop, view.visible ? 'exact' : 'rough') : { ...UNKNOWN }),
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

  /** Какие фигуры стоят вплотную к этой цели. */
  private figuresAt(id: SettlementId, now: number): FigureId[] {
    const out: FigureId[] = [];
    for (const fid of FIGURE_IDS) {
      const f = this.save.figures[fid];
      if (!f || f.phase === 'down' || f.phase === 'moving') continue;
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

    const units: UnitStack = {};
    let size = 0;
    for (const [id, n] of Object.entries(order.units) as [keyof UnitStack, number][]) {
      const count = Math.max(0, Math.floor(n ?? 0));
      if (count <= 0) continue;
      const have = profile.units[id] ?? 0;
      if (count > have) return { error: `Столько людей нет дома: ${id === 'scout' ? 'разведчиков' : 'воинов'}.`, march: null };
      units[id] = count;
      size += count;
    }
    if (size === 0) return { error: 'Отряд пустой.', march: null };
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
      fromName: 'Наша деревня',
      toName: target.name,
      departAt: now,
      arriveAt: now + Math.round(seconds * 1000),
      phase: 'out',
      power: stackPower(units, profile.warriorPower),
      troops: order.troops && troopTotal(order.troops) > 0 ? { ...order.troops } : undefined,
      setup: order.setup ?? null,
      loot: null,
    };
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
      at,
      from: { ...f.from },
      to: { ...f.to },
      departAt: f.departAt,
      arriveAt: f.arriveAt,
      sight: def.sight,
      atId: near?.id ?? null,
      atName: near?.name ?? null,
      atHome: near?.home ?? false,
      downUntil: f.downUntil,
      busyUntil: Math.max(0, f.busyUntil ?? 0),
      // Наблюдение — приказ, а не свойство фигуры: пока лазутчик смотрит, он не
      // работает, и обратное тоже верно. Панель обязана показывать, что сейчас.
      watching: Boolean(f.watching),
      watchSight: liveSight(id, f.phase, f.watching),
      troops: { ...troops },
      power: troopTotal(troops) * (this.save.profile?.warriorPower ?? 1),
      capacity: id === 'general' ? this.commandCap() : 0,
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

  async moveFigure(id: FigureId, to: Coord): Promise<string | null> {
    const now = this.clock();
    const f = this.save.figures[id];
    const def = FIGURE_BY_ID[id];
    if (f.phase === 'down') {
      const left = Math.ceil(Math.max(0, f.downUntil - now) / 1000);
      return `${def.name} выбыл: вернётся через ${Math.ceil(left / 60)} мин.`;
    }
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
    const seconds = travelTime(dist, terrainFactor(this.save.seed, from, target), def.speed);
    f.from = from;
    f.to = target;
    f.departAt = now;
    f.arriveAt = now + Math.round(seconds * 1000);
    f.phase = 'moving';
    // Пошёл — значит перестал смотреть. Наблюдение, пережившее дорогу, вернулось
    // бы само собой на новом месте и запирало бы приказы там, где игрок его не
    // ставил: приказ, который молча станет чем-то другим, хуже отказа.
    if (id === WATCHER) f.watching = false;
    this.write();
    return null;
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
    const def = FIGURE_BY_ID[id];
    if (f.phase === 'down') {
      return `${def.name} выбыл: вернётся через ${formatLeft(Math.max(0, f.downUntil - now) / 1000)}.`;
    }
    const busy = Math.max(0, (f.busyUntil ?? 0) - now);
    if (busy > 0) return `${this.busyNote(id)}: ${formatLeft(busy / 1000)}.`;
    if (on && !standing(f.phase)) return 'Наблюдают стоя: доведи лазутчика до места, откуда смотреть.';
    if (Boolean(f.watching) === on) return null;
    f.watching = on;
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
   * переходит из деревни к полководцу или обратно, поэтому взять больше, чем
   * стоит дома, нельзя: дома — это `profile.army`, и в нём уже нет тех, кто при
   * полководце.
   */
  async setGarrison(troops: TroopStack | null): Promise<string | null> {
    const now = this.clock();
    const f = this.save.figures.general;
    this.settleHandover(f, now);
    if (f.phase === 'down') return 'Полководец выбыл.';
    if (f.phase === 'moving') return 'Полководец в пути — войско к нему не подойдёт.';
    if (f.handover) {
      return `Дружина ещё в дороге: ${formatLeft(Math.max(0, f.handover.until - now) / 1000)}.`;
    }
    if (!this.touching(this.figureAt(f, now))?.home) {
      return 'Забрать дружину можно только у своей деревни.';
    }
    const home = this.save.profile?.army ?? {};
    const held = f.troops ?? {};
    const next: TroopStack = {};
    for (const [key, raw] of Object.entries(troops ?? {}) as [keyof TroopStack, number][]) {
      const want = Math.max(0, Math.floor(raw ?? 0));
      if (want <= 0) continue;
      const take = want - (held[key] ?? 0);
      if (take > (home[key] ?? 0)) return 'Столько бойцов дома нет.';
      next[key] = want;
    }
    // Дружину из осаждённого города не увести: это тот же выход, только другим
    // приказом. Вернуть её в гарнизон осада не мешает — под запретом выход, а не
    // вход, и подкрепление под стенами дело хорошее.
    if (TROOP_IDS.some((id) => (next[id] ?? 0) > (held[id] ?? 0))) {
      const blocked = this.siegeBlock(now);
      if (blocked) return blocked;
    }
    const cap = this.commandCap();
    if (troopTotal(next) > cap) {
      return `Столько за собой не увести: Статуя держит ${cap} бойцов.`;
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
    const wait = Math.min(HANDOVER_MAX, HANDOVER_BASE + moved * HANDOVER_PER_MAN);
    f.troops = troopTotal(onRoad) > 0 ? onRoad : undefined;
    f.handover = { troops: next, until: now + wait };
    this.write();
    return null;
  }

  /** Сколько бойцов полководец может вести: работа Статуи, число из слепка. */
  private commandCap = (): number => Math.max(0, Math.round(this.save.profile?.command ?? 0));

  /**
   * Передача дружины кончается сама, по времени: срок наступил — состав стал
   * тем, о котором договорились. Это приведение при чтении, а не тик: офлайн
   * даёт ровно то же, что непрерывная игра.
   */
  private settleHandover(f: StoredFigure, now: number): void {
    if (!f.handover || now < f.handover.until) return;
    const next = f.handover.troops;
    // Сколько вернулось в гарнизон. Слепок деревни этих людей ещё не считает
    // домашними, поэтому под осадой их приходится назвать поимённо — и часы
    // голода пересчитываются, как от любого другого подкрепления.
    const back = Math.max(0, troopTotal(f.troops ?? {}) - troopTotal(next));
    f.troops = troopTotal(next) > 0 ? { ...next } : undefined;
    f.handover = undefined;
    if (back > 0) this.resiege(HOME_ID, now, back);
  }

  async attack(order: AttackOrder): Promise<AttackResult> {
    const now = this.clock();
    const f = this.save.figures.general;
    if (f.phase === 'down') return { error: 'Полководец выбыл.', reportId: null, won: false };
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
    // вылазка. Свой лагерь этой проверкой не задет: `ourCamp` отсекает его.
    const camp = this.siegeOf(near.id, now);
    if (camp && !ourCamp(camp)) return this.breakCamp(near.id, now);
    if (near.home) return { error: 'Рядом нет чужого поселения.', reportId: null, won: false };
    if (this.ourSiege(now)) {
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
    return this.attackAt(target, now, order.setup ?? null);
  }

  async negotiate(deal: DealId): Promise<string | null> {
    const now = this.clock();
    const f = this.save.figures.diplomat;
    if (f.phase === 'down') return 'Дипломат выбыл.';
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
    if (f.phase === 'down') {
      return `${def.name} выбыл: вернётся через ${formatLeft(Math.max(0, f.downUntil - now) / 1000)}.`;
    }
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
  private orderOptions(agent: FigureId, target: GenSettlement, now: number): OrderOption[] {
    if (agent === 'diplomat') return this.diploOptions(target, now);
    if (agent === 'spy') return this.spyOptions(target, now);
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
      };
    });
  }

  /**
   * Приказы лазутчика. Шанс считается той же чистой функцией, что и в приказе,
   * и от тех же трёх входов: уровень лазутчика (Дозор игрока), стража цели и
   * расстояние. Показанный шанс и есть тот, по которому потом бросается кость.
   */
  private spyOptions(target: GenSettlement, now: number): OrderOption[] {
    const common = this.agentBlock('spy', target, now);
    const keen = Math.max(1, this.save.profile?.intelKeen ?? 1);
    const guard = guardOf(this.powerNow(target, now), target.castle);
    const away = distance(this.save.home, target);
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
        seconds: Math.round(def.busy / 1000),
      };
    });
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
  async order(action: OrderActionId, target: SettlementId): Promise<OrderResult> {
    const now = this.clock();
    const s = this.byId.get(target);
    const fail = (error: string): OrderResult => ({ error, accepted: false, diplomacy: null, text: '' });
    if (!s) return fail('Цель не найдена.');
    const agent = ORDER_AGENT[action];
    if (!agent) return fail('Такого приказа нет.');
    const opt = this.orderOptions(agent, s, now).find((o) => o.id === action);
    if (!opt) return fail('Такого приказа нет.');
    if (!opt.can) return fail(opt.reason ?? 'Сейчас нельзя.');
    if (agent === 'spy') return this.spyOrder(action as 'probe' | 'revolt', s, now, opt.chance ?? 0);

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
   * Дело лазутчика. Он у игрока один, поэтому провал его **не губит**: он
   * возвращается ни с чем, его держат под стражей `SPY_HELD`, и цель запоминает
   * лицо — отношение падает. Потерять агента насовсем значило бы превратить
   * механику в наказание, а не в риск.
   */
  private spyOrder(action: 'probe' | 'revolt', s: GenSettlement, now: number, chance: number): OrderResult {
    const rec = this.diploOf(s.id, now);
    const seed = spySeed(this.save.seed, s.id, action, chance, rec.attitude);
    const out = spyOutcome(chance, seed, action);
    const f = this.save.figures.spy;
    f.busyUntil = now + (out.success ? SPY_BUSY : SPY_HELD);
    f.held = !out.success;

    let intel: Intel | null = null;
    if (!out.success) {
      // Его заметили — и запомнили. Это и есть цена провала вместо гибели.
      this.moveAttitude(s.id, SPY_CAUGHT_ATTITUDE, now);
    } else if (action === 'probe') {
      // Донесение — тот же снимок, что и у разведчика, но с вилкой и без
      // построения: лазутчик считает головы, а не разглядывает линии.
      const snap = this.snapshot(s, now);
      intel = { ...snap, formation: undefined, spread: out.spread };
      this.save.intel[s.id] = intel;
    } else {
      this.save.revolts[s.id] = revoltWindow(now);
    }

    const def = SPY_ACTION_BY_ID[action];
    const title = out.success ? `${def.name}: ${s.name}` : `Провал у ${s.name}`;
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
      text: out.text,
      read: false,
    });
    this.addEffect({
      id: `spy-${s.id}-${action}-${now}-eff`,
      lost: {},
      resources: {},
      prestige: out.success && action === 'revolt' ? 2 : 0,
      morale: out.success ? 1 : -2,
      battle: null,
      text: `${s.name}: ${out.text}`,
      good: out.success,
    });
    this.write();
    return {
      error: null,
      accepted: out.success,
      diplomacy: this.diploView(s, now),
      text: `${s.name}: ${out.text}`,
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
    // Реестр приезжает по своему сроку — раз в минуту и только пока открыта
    // карта; здесь его просто перечитывают. Дешёвая операция: пара сотен строк.
    this.adoptCastles();
    this.save.profile = profile;
    this.lockDefense(now, profile);
    this.advance(now);
    const reports = this.fresh;
    this.fresh = [];
    const effects = this.save.effects;
    this.save.effects = [];
    this.save.seenAt = now;
    this.write();
    return {
      now,
      marches: this.visibleMarches(now).map((m) => this.viewMarch(m)),
      figures: FIGURE_IDS.map((id) => this.viewFigure(id, now)),
      reports,
      effects,
      siege: this.siegeView(now),
      unread: this.save.reports.filter((r) => !r.read).length,
    };
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
