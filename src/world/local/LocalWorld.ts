// Мир целиком на клиенте: генерация по сиду плюс своя маленькая симуляция соседей.
// Реализует WorldApi — тот же интерфейс, что потом реализует HttpWorld. Всё, что
// считается здесь (время пути, бой, старение разведки), считается детерминированно,
// чтобы сервер мог повторить расчёт один в один.
import { seeded } from '@/game/sim/random';
import { FRONT, GEAR, REAR, type ArmySetup, type Stack, type UnitKind } from '@/battle';
import { gearOf, kindsOf, troopLosses, troopTotal, type TroopStack } from '@/game/battle/kinds';
import { TROOP_IDS } from '@/game/data/troops';
import { troopsOfKinds } from '@/game/battle/faces';
import type { BattlePlace } from '@/game/battle/ground';
import type { WorldApi } from '../api';
import type {
  AttackOrder,
  AttackResult,
  BattleRecord,
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
  Loot,
  MarchOrder,
  MarchView,
  OrderOption,
  OrderResult,
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
  Standing,
  TemperId,
  TribeInfo,
  UnitStack,
  WorldInfo,
  WorldPulse,
} from '../types';
import { generateWorld, popOf, powerOf, type GenSettlement, type WorldGen } from '../gen';
import {
  clampToWorld,
  distance,
  formatCoord,
  formatLeft,
  marchPosition,
  secondsLeft,
  marchSeconds,
  terrainAt,
  terrainFactor,
  terrainIndex,
  travelTime,
} from '../geo';
import { FogMap, inSight, type FogData, type SightDisc } from '../fog';
import { WATCHER, liveSight, standing } from '../sight';
import { featuresAt } from '../geography';
import { claimsNear, claimsOf, ownerAt, type Claim } from '../territory';
import { DEAL_BY_ID, FIGURE_BY_ID, FIGURE_IDS } from '../data/figures';
import { DIPLO_ACTIONS, DIPLO_ACTION_BY_ID, TEMPER_BY_ID } from '../data/diplomacy';
import { ORDER_AGENT, SPY_ACTIONS, SPY_ACTION_BY_ID } from '../data/spy';
import {
  guardOf,
  revoltActive,
  revoltElapsed,
  revoltPower,
  revoltWindow,
  spyChance,
  spyOutcome,
  spySeed,
} from '../spy';
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
import { RELATION_META, stageOf } from '../data/meta';
import { stackCarry, stackSize } from '../data/units';
import { marchSeed, stackAfter, stackLosses, stackPower } from '../combat';
import { garrisonOf, raidingParty, GARRISON_STYLES } from '../garrison';
import { resolveField } from '../battle';
import { placeAt } from '../place';
import { intercept as meetingOf, type Meeting } from '../pursuit';
import { estimate, readIntel } from '../intel';
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
  AI_WAR_PACE,
  AI_WAR_WEIGHT,
  GIFT_PER_POP,
  HANDOVER_BASE,
  HANDOVER_MAX,
  HANDOVER_PER_MAN,
  PEACE_PER_POP,
  REVOLT_POWER_LOSS,
  SPY_BUSY,
  SPY_CAUGHT_ATTITUDE,
  SPY_HELD,
  SUPPORT_ATTITUDE,
  LOOT_REFILL,
  POWER_GROWTH_CAP,
  REPORTS_KEPT,
  SCOUT_COVER,
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
  type StoredFigure,
  type StoredMarch,
  type WorldSave,
  type WorldStorage,
} from './state';

export const HOME_ID: SettlementId = 'home';

/** Набег, который пришёлся на время без игрока, не состоится: игра остаётся лёгкой. */
const AWAY_GRACE = 20_000;

export interface LocalWorldOptions {
  /** Сид мира. По умолчанию берётся из сохранения, иначе случайный. */
  seed?: number;
  /** Часы мира. В тестах подменяются. */
  now?: () => number;
  /** null — не сохранять (тесты). */
  storage?: WorldStorage | null;
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

  constructor(opts: LocalWorldOptions = {}) {
    this.clock = opts.now ?? (() => Date.now());
    this.reveal = opts.reveal ?? false;
    this.storage = opts.storage === undefined ? browserStorage : opts.storage;
    const stored = parseWorldSave(this.storage?.read() ?? null);
    const seed = opts.seed ?? stored?.seed ?? Math.floor(Math.random() * 0x7fffffff);
    this.gen = generateWorld(seed);
    this.save =
      stored && stored.seed === seed
        ? stored
        : createWorldSave(seed, this.gen.home, this.gen.allyTribe, this.clock());
    for (const s of this.gen.settlements) this.byId.set(s.id, s);
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
   * Собственные часы поселения. Их останавливает бунт: пока он идёт, поселение
   * не растёт, запасы не копятся и разбитый гарнизон не отстраивается — это и
   * означает «производство встало».
   *
   * Считается при чтении из одного окна времени, а не отмечается тиком, поэтому
   * офлайн даёт ровно то же, что непрерывная игра. Отметки на записях
   * (`damage.at`, `looted`) ставятся в этих же часах — иначе бунт двигал бы
   * прошлое, и разбитый гарнизон чинился бы задним числом.
   */
  private liveAt = (id: SettlementId, now: number): number =>
    now - revoltElapsed(this.save.revolts[id], now);

  /** Сколько поселение прожило своей жизнью: возраст мира минус время бунтов. */
  private lived = (s: GenSettlement, now: number): number =>
    Math.max(0, this.liveAt(s.id, now) - this.save.createdAt);

  /** Бунт идёт прямо сейчас? */
  private inRevolt = (id: SettlementId, now: number): boolean =>
    revoltActive(this.save.revolts[id], now);

  private revoltView(id: SettlementId, now: number): RevoltView | null {
    const w = this.save.revolts[id];
    if (!w || !revoltActive(w, now)) return null;
    return { since: w.since, until: w.until, power: REVOLT_POWER_LOSS };
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
    const base = powerOf(s, this.lived(s, now), POWER_GROWTH_CAP);
    // Пока идёт бунт, гарнизон занят своими: он слабее ровно на объявленную долю.
    const revolt = revoltPower(this.inRevolt(s.id, now));
    return Math.max(1, base * revolt * (1 - this.damageOf(s.id, now)) + this.supportIn(s.id));
  }

  private popNow = (s: GenSettlement, now: number): number =>
    popOf(s, this.lived(s, now), POWER_GROWTH_CAP);

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
      loot: this.lootAvailable(s, now),
      kinds: g.kinds,
      formation,
      style: GARRISON_STYLES[g.style].name,
    };
  }

  // ---------- Добыча ----------

  private lootCap = (s: GenSettlement, now: number): number => Math.round(this.popNow(s, now) * 3);

  /** Сколько добра лежит в поселении сейчас: после набега запасы восстанавливаются не сразу. */
  private lootAvailable(s: GenSettlement, now: number): number {
    const last = this.save.looted[s.id] ?? this.save.createdAt - LOOT_REFILL;
    const refill = Math.min(1, Math.max(0, (this.liveAt(s.id, now) - last) / LOOT_REFILL));
    return Math.round(this.lootCap(s, now) * refill);
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

  private takeLoot(s: GenSettlement, now: number, carry: number): Loot | null {
    const avail = this.lootAvailable(s, now);
    const take = Math.min(avail, Math.floor(carry));
    const cap = Math.max(1, this.lootCap(s, now));
    const leftShare = Math.max(0, (avail - take) / cap);
    this.save.looted[s.id] = this.liveAt(s.id, now) - leftShare * LOOT_REFILL;
    if (take <= 0) return null;
    const mix = s.lootMix;
    const out: Loot = {};
    const per = Math.floor(take / mix.length);
    let rest = take - per * mix.length;
    for (const r of mix) {
      const extra = rest > 0 ? 1 : 0;
      rest -= extra;
      const n = per + extra;
      if (n > 0) out[r] = (out[r] ?? 0) + n;
    }
    return out;
  }

  /** Что чужаки унесут у игрока: поровну с того, что лежит на складе. */
  private plunderHome(profile: PlayerProfile | null, carry: number): Loot {
    const out: Loot = {};
    if (!profile) return out;
    const entries = Object.entries(profile.resources).filter(([, n]) => (n ?? 0) > 0) as [
      keyof Loot,
      number,
    ][];
    const total = entries.reduce((n, [, v]) => n + v, 0);
    if (total <= 0) return out;
    const take = Math.min(total, Math.floor(carry));
    for (const [r, v] of entries) {
      const n = Math.floor((v / total) * take);
      if (n > 0) out[r] = -n;
    }
    return out;
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

    // События походов — строго по времени: догон офлайна должен дать тот же порядок.
    for (let guard = 0; guard < 500; guard++) {
      let next: StoredMarch | null = null;
      for (const m of save.marches) {
        if (this.dueAt(m) > now) continue;
        if (!next || this.dueAt(m) < this.dueAt(next)) next = m;
      }
      if (!next) break;
      this.resolve(next, this.dueAt(next), prevSeen);
    }

    this.scheduleAi(now);
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
    if (m.phase === 'stay') return this.turnHome(m, at, null);
    if (!m.own) return this.resolveIncoming(m, at, prevSeen);

    const target = this.byId.get(m.targetId) ?? null;
    if (!target) return this.turnHome(m, at, null);
    // Набегов в этом списке не бывает: армия ходит только с полководцем, и бой
    // считается там, где он стоит (см. attack). Отряд без него — разведка или
    // поддержка, больше отправить нечего.
    if (m.mission === 'support') return this.resolveSupport(m, target, at);
    return this.resolveScout(m, target, at);
  }

  private arriveHome(m: StoredMarch, at: number): void {
    this.remove(m);
    if (!m.own) return;
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

    // Бой — та же разведка, и лучшая: гарнизон посчитан своими глазами.
    const intel = this.snapshot(target, at);
    this.save.intel[target.id] = intel;

    // Золото берут до добра: доля казны соразмерна тому, сколько гарнизона выбили.
    const gold = field.won ? Math.round(this.castleGold(target, at) * field.defenderLoss) : 0;
    const loot = field.won ? this.takeLoot(target, at, stackCarry({ warrior: survivors })) : null;
    const spoils: Loot | null = gold > 0 ? { ...(loot ?? {}), gold } : loot;
    const goods = loot ? Object.values(loot).reduce((n, v) => n + (v ?? 0), 0) : 0;
    const lootText =
      (goods > 0 ? ` Взято: ${goods} добра.` : '') + (gold > 0 ? ` Казна замка: ${gold} золота.` : '');
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
      title: field.won ? `Набег удался: ${target.name}` : `Набег отбит: ${target.name}`,
      target: { id: target.id, name: target.name, x: target.x, y: target.y },
      won: field.won,
      sent: { warrior: men },
      lost: lostMen > 0 ? { warrior: lostMen } : {},
      enemyPower: Math.round(defense),
      enemyLost,
      loot: spoils,
      intel,
      battle: record,
      text: field.won
        ? `Гарнизон ${target.name} разбит.${lootText}`
        : `Оборона ${target.name} оказалась крепче.${survivors === 0 ? ' Полководец пал.' : ' Уцелевшие остались при полководце.'}`,
      read: false,
    });

    this.addEffect({
      id: `${reportId}-battle`,
      lost: lostMen > 0 ? { warrior: lostMen } : {},
      lostTroops,
      // Обоз идёт домой сам: полководец остаётся в поле, а добыча ему не нужна.
      resources: spoils ?? {},
      prestige: field.won ? 4 : 0,
      morale: field.won ? 4 : -6,
      battle: field.won ? 'won' : 'lost',
      text: field.won
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
    this.remove(m);
    // Пока игрока не было, никто ничего не громит: предупреждение он бы не увидел.
    if (at - prevSeen > AWAY_GRACE) {
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
    const plunder = outcome.won ? this.plunderHome(profile, stackCarry(attackerLeft)) : {};
    const taken = Object.values(plunder).reduce((n, v) => n + Math.abs(v ?? 0), 0);

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
      loot: taken > 0 ? plunder : null,
      intel: null,
      battle: record,
      text: outcome.won
        ? `${m.fromName} прорвались через заслон. Унесено ${taken} добра.`
        : `${m.fromName} отбиты у частокола.`,
      read: false,
    });

    this.addEffect({
      id: `${m.id}-defense`,
      lost: warriorsLost > 0 ? { warrior: warriorsLost } : {},
      lostTroops: troopsLost,
      resources: plunder,
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
   * Мягкие набеги: редко, из ближних поселений и всегда с запасом времени на реакцию.
   * Мощь набега упирается в оборону игрока — потерять всё за одну ночь нельзя.
   */
  private scheduleAi(now: number): void {
    const save = this.save;
    if (now < save.nextAiAt) return;
    const rng = seeded(marchSeed(save.seed, save.nextMarch + 7919));

    const home = save.home;
    const near = this.gen.settlements.filter((s) => distance(s, home) <= AI_RANGE);
    // Война хоть с одним соседом ускоряет весь темп: воюющий сосед не ждёт
    // своей очереди столько же, сколько ждал бы ровный.
    const atWar = near.some((s) => this.standingOf(s, now) === 'war');
    const pause = AI_ATTACK_MIN + rng() * (AI_ATTACK_MAX - AI_ATTACK_MIN);
    save.nextAiAt = now + pause * (atWar ? AI_WAR_PACE : 1);

    const profile = save.profile;
    if (!profile || profile.pop < AI_MIN_POP) return;
    if (save.marches.some((m) => !m.own)) return;

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
          AI_BARBARIAN_WEIGHT;
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
    return this.save.marches.filter((m) => {
      if (m.own) return true;
      if (m.targetId === HOME_ID && m.phase === 'out' && m.arriveAt - now <= warn) return true;
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
      settlements.push(this.view(s, now, discs));
    }
    const home = this.save.home;
    if (home.x >= x0 && home.x < x1 && home.y >= y0 && home.y < y1) settlements.push(this.homeView(now));
    const explored = this.reveal ? new Uint8Array(w * h).fill(1) : this.fog.maskFor(rect0);
    return { rect: rect0, terrain, features, influence, explored, settlements };
  }

  async settlement(id: SettlementId): Promise<SettlementCard | null> {
    const now = this.clock();
    if (id === HOME_ID) {
      const p = this.save.profile;
      return {
        ...this.homeView(now),
        terrain: terrainAt(this.save.seed, this.save.home.x, this.save.home.y),
        distance: 0,
        terrainFactor: 1,
        power: estimate(p?.defense ?? 0, 'exact'),
        pop: estimate(p?.pop ?? 0, 'exact'),
        intel: null,
        figuresHere: this.figuresAt(HOME_ID, now),
        deals: [],
        // Сама с собой деревня не воюет и пактов не подписывает.
        diplomacy: null,
        revolt: null,
        can: { raid: false, scout: false, support: false, open: true },
        note: 'Своя деревня. Сюда возвращаются походы и сюда же приходят чужие.',
      };
    }
    const s = this.byId.get(id);
    // Про неразведанное место карточки нет: игрок о нём ещё не знает.
    if (!s || !this.fog.has(s.x, s.y)) return null;
    const view = this.view(s, now, this.sightDiscs(now));
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
      intel: reading,
      figuresHere: here,
      deals: s.tribeId ? this.dealsOf(s.tribeId, now) : [],
      diplomacy: this.diploView(s, now),
      revolt: this.revoltView(s.id, now),
      can: { raid: canRaid, scout: true, support: ally, open: false },
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
    f.troops = troopTotal(next) > 0 ? { ...next } : undefined;
    f.handover = undefined;
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
    if (!near || near.home) return { error: 'Рядом нет чужого поселения.', reportId: null, won: false };
    const target = this.byId.get(near.id);
    if (!target) return { error: 'Цель не найдена.', reportId: null, won: false };
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

  /** Сколько добра не хватает на складе. Ноль — хватает. */
  private shortOf(cost: Loot): number {
    const have = this.save.profile?.resources ?? {};
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
