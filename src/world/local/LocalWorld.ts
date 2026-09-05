// Мир целиком на клиенте: генерация по сиду плюс своя маленькая симуляция соседей.
// Реализует WorldApi — тот же интерфейс, что потом реализует HttpWorld. Всё, что
// считается здесь (время пути, бой, старение разведки), считается детерминированно,
// чтобы сервер мог повторить расчёт один в один.
import { seeded } from '@/game/sim/random';
import { FRONT, GEAR, REAR, type ArmySetup, type Stack, type UnitKind } from '@/battle';
import { gearOf, kindsOf, troopLosses, troopTotal, type TroopStack } from '@/game/battle/kinds';
import type { WorldApi } from '../api';
import type {
  AttackOrder,
  AttackResult,
  BattleRecord,
  Coord,
  DealId,
  DealView,
  FigureId,
  FigureView,
  HomeEffect,
  Intel,
  IntelReading,
  Loot,
  MarchOrder,
  MarchView,
  PlayerProfile,
  Rect,
  RegionChunk,
  Relation,
  Report,
  SendResult,
  SettlementCard,
  SettlementId,
  SettlementView,
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
  marchPosition,
  marchSeconds,
  terrainAt,
  terrainFactor,
  terrainIndex,
  travelTime,
} from '../geo';
import { FogMap, inSight, type FogData, type SightDisc } from '../fog';
import { featuresAt } from '../geography';
import { claimsNear, claimsOf, ownerAt, type Claim } from '../territory';
import { DEAL_BY_ID, FIGURE_BY_ID, FIGURE_IDS } from '../data/figures';
import { RELATION_META, stageOf } from '../data/meta';
import { stackCarry, stackSize } from '../data/units';
import { marchSeed, stackAfter, stackLosses, stackPower } from '../combat';
import { garrisonOf, raidingParty, GARRISON_STYLES } from '../garrison';
import { resolveField } from '../battle';
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
  HOSTILITY_ATTACK,
  HOSTILITY_DECAY_PER_MIN,
  HOSTILITY_ENEMY,
  HOSTILITY_SUPPORT,
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

  constructor(opts: LocalWorldOptions = {}) {
    this.clock = opts.now ?? (() => Date.now());
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

  private elapsed = (now: number): number => Math.max(0, now - this.save.createdAt);

  /** Насколько гарнизон ещё не отстроился после последнего разгрома. */
  private damageOf(id: SettlementId, now: number): number {
    const d = this.save.damage[id];
    if (!d) return 0;
    const k = 1 - (now - d.at) / DAMAGE_RECOVER;
    return k <= 0 ? 0 : d.loss * k;
  }

  /** Свои отряды, стоящие в поселении поддержкой. */
  private supportIn(id: SettlementId): number {
    let p = 0;
    for (const m of this.save.marches) if (m.phase === 'stay' && m.targetId === id) p += m.power;
    return p;
  }

  private powerNow(s: GenSettlement, now: number): number {
    const base = powerOf(s, this.elapsed(now), POWER_GROWTH_CAP);
    return Math.max(1, base * (1 - this.damageOf(s.id, now)) + this.supportIn(s.id));
  }

  private popNow = (s: GenSettlement, now: number): number => popOf(s, this.elapsed(now), POWER_GROWTH_CAP);

  private hostilityOf = (tribeId: string | null): number =>
    tribeId ? Math.max(0, this.save.hostility[tribeId] ?? 0) : 0;

  private relationOf(s: GenSettlement): Relation {
    if (!s.tribeId) return 'barbarian';
    // Подписанный союз — тоже союз: дипломат для того и ходит, чтобы менять
    // отношения, а не только смотреть на них.
    if (this.pactActive(s.tribeId, 'alliance')) return 'ally';
    const h = this.hostilityOf(s.tribeId);
    if (h >= HOSTILITY_ENEMY) return 'enemy';
    if (s.tribeId === this.save.allyTribe && h < HOSTILITY_ALLY_BREAK) return 'ally';
    return 'neutral';
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
    const refill = Math.min(1, Math.max(0, (now - last) / LOOT_REFILL));
    return Math.round(this.lootCap(s, now) * refill);
  }

  /**
   * Сколько золота лежит в замке сейчас. Восстанавливается тем же сроком, что и
   * прочая добыча, поэтому дважды подряд один замок не обчистить.
   */
  private castleGold(s: GenSettlement, now: number): number {
    if (!s.castle) return 0;
    const last = this.save.looted[s.id] ?? this.save.createdAt - LOOT_REFILL;
    const refill = Math.min(1, Math.max(0, (now - last) / LOOT_REFILL));
    return Math.round(powerOf(s, this.elapsed(now), POWER_GROWTH_CAP) * CASTLE_GOLD_PER_POWER * refill);
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
    this.save.looted[s.id] = now - leftShare * LOOT_REFILL;
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
   * Круги обзора прямо сейчас: своё поселение, три фигуры и свои отряды в пути.
   * От них зависит только второй слой — живые данные. Первый слой (местность)
   * они открывают навсегда, и обратно он не закрывается.
   */
  private sightDiscs(now: number): SightDisc[] {
    const out: SightDisc[] = [{ x: this.save.home.x, y: this.save.home.y, r: HOME_SIGHT }];
    for (const id of FIGURE_IDS) {
      const f = this.save.figures[id];
      if (!f || f.phase === 'down') continue;
      const at = this.figureAt(f, now);
      out.push({ x: at.x, y: at.y, r: FIGURE_BY_ID[id].sight });
    }
    for (const m of this.save.marches) {
      if (!m.own) continue;
      const at = m.phase === 'stay' ? m.to : marchPosition(m, now);
      out.push({ x: at.x, y: at.y, r: MARCH_SIGHT });
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
    this.fog.revealDisc(save.home, HOME_SIGHT);
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

    // Обиды затягиваются сами: набег не делает племя врагом навсегда.
    const minutes = (now - save.hostilityAt) / 60_000;
    if (minutes > 0.05) {
      const drop = minutes * HOSTILITY_DECAY_PER_MIN;
      for (const id of Object.keys(save.hostility)) {
        save.hostility[id] = Math.max(0, save.hostility[id] - drop);
      }
      save.hostilityAt = now;
    }

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
    this.save.damage[target.id] = { loss: Math.min(0.95, prev + field.defenderLoss * (1 - prev)), at };
    if (target.tribeId) {
      this.save.hostility[target.tribeId] = Math.min(
        100,
        this.hostilityOf(target.tribeId) + HOSTILITY_ATTACK,
      );
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
      ? { us: 'attacker', preset: field.preset.attacker, result: field.result }
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
    if (target.tribeId) {
      this.save.hostility[target.tribeId] = Math.max(
        0,
        this.hostilityOf(target.tribeId) + HOSTILITY_SUPPORT,
      );
    }
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
      ? { us: 'defender', preset: setup ? null : field.preset.defender, result: field.result }
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
    save.nextAiAt = now + AI_ATTACK_MIN + rng() * (AI_ATTACK_MAX - AI_ATTACK_MIN);

    const profile = save.profile;
    if (!profile || profile.pop < AI_MIN_POP) return;
    if (save.marches.some((m) => !m.own)) return;

    const home = save.home;
    // Племя, с которым подписано ненападение или союз, набегов не шлёт: иначе
    // дипломат покупал бы бумагу, а не мир.
    const near = this.gen.settlements.filter(
      (s) =>
        distance(s, home) <= AI_RANGE &&
        !this.pactActive(s.tribeId, 'truce') &&
        !this.pactActive(s.tribeId, 'alliance'),
    );
    const angry = near.filter((s) => s.tribeId && this.hostilityOf(s.tribeId) > 10);
    const pool = angry.length > 0 ? angry : near.filter((s) => !s.tribeId);
    if (pool.length === 0) return;

    const src = pool[Math.floor(rng() * pool.length)];
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
        if (this.fog.has(wx, wy)) influence[i] = ownerAt(claims, wx, wy);
      }
    }
    const rect0 = { x: x0, y: y0, w, h };
    const discs = this.sightDiscs(now);
    const settlements: SettlementView[] = [];
    for (const s of this.gen.settlements) {
      if (s.x < x0 || s.x >= x1 || s.y < y0 || s.y >= y1) continue;
      // Неразведанная клетка не отдаёт даже того, что в ней кто-то живёт.
      if (!this.fog.has(s.x, s.y)) continue;
      settlements.push(this.view(s, now, discs));
    }
    const home = this.save.home;
    if (home.x >= x0 && home.x < x1 && home.y >= y0 && home.y < y1) settlements.push(this.homeView(now));
    return { rect: rect0, terrain, features, influence, explored: this.fog.maskFor(rect0), settlements };
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
    // Набег доступен ровно тогда, когда есть кому вести: полководец стоит здесь
    // и войско при нём. Второго способа назначить цель в игре нет.
    const canRaid = here.includes('general') && troopTotal(general.troops ?? {}) > 0;
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
      can: { raid: canRaid, scout: true, support: ally, open: false },
      note: canRaid
        ? null
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
    return this.save.marches.map((m) => this.viewMarch(m));
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
      troops: { ...troops },
      power: troopTotal(troops) * (this.save.profile?.warriorPower ?? 1),
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
    this.write();
    return null;
  }

  /** Домой — обычный переход, по тем же правилам: своей арифметики у него нет. */
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
    if (f.phase === 'down') return 'Полководец выбыл.';
    if (f.phase === 'moving') return 'Полководец в пути — войско к нему не подойдёт.';
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
    f.troops = troopTotal(next) > 0 ? next : undefined;
    this.write();
    return null;
  }

  async attack(order: AttackOrder): Promise<AttackResult> {
    const now = this.clock();
    const f = this.save.figures.general;
    if (f.phase === 'down') return { error: 'Полководец выбыл.', reportId: null, won: false };
    if (f.phase === 'moving') return { error: 'Полководец ещё в пути.', reportId: null, won: false };
    if (troopTotal(f.troops ?? {}) === 0) return { error: 'Войска при полководце нет.', reportId: null, won: false };
    const near = this.touching(this.figureAt(f, now));
    if (!near || near.home) return { error: 'Рядом нет чужого поселения.', reportId: null, won: false };
    const target = this.byId.get(near.id);
    if (!target) return { error: 'Цель не найдена.', reportId: null, won: false };
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
    this.save.hostility[target.tribeId] = Math.max(0, hostility - def.hostilityDrop);
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
      marches: this.save.marches.map((m) => this.viewMarch(m)),
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
