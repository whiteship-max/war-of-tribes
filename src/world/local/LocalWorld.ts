// Мир целиком на клиенте: генерация по сиду плюс своя маленькая симуляция соседей.
// Реализует WorldApi — тот же интерфейс, что потом реализует HttpWorld. Всё, что
// считается здесь (время пути, бой, старение разведки), считается детерминированно,
// чтобы сервер мог повторить расчёт один в один.
import { seeded } from '@/game/sim/random';
import { FRONT, REAR, type Stack } from '@/battle';
import { gearOf, kindsOf, troopLosses, troopTotal } from '@/game/battle/kinds';
import type { WorldApi } from '../api';
import type {
  BattleRecord,
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
  distance,
  formatCoord,
  marchPosition,
  marchSeconds,
  terrainAt,
  terrainFactor,
  terrainIndex,
} from '../geo';
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
  AI_WARNING,
  AI_ATTACK_MAX,
  AI_ATTACK_MIN,
  DAMAGE_RECOVER,
  DEFENSE_FREEZE,
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
  WORLD_ORIGIN,
  WORLD_SIZE,
} from '../data/tuning';
import {
  browserStorage,
  createWorldSave,
  parseWorldSave,
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
  /** Отчёты, появившиеся в текущем шаге: их отдаёт sync(). */
  private fresh: Report[] = [];

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
  }

  // ---------- Служебное ----------

  private write(): void {
    this.storage?.write(JSON.stringify(this.save));
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
    const h = this.hostilityOf(s.tribeId);
    if (h >= HOSTILITY_ENEMY) return 'enemy';
    if (s.tribeId === this.save.allyTribe && h < HOSTILITY_ALLY_BREAK) return 'ally';
    return 'neutral';
  }

  private tribeName = (id: string | null): string | null =>
    this.gen.tribes.find((t) => t.id === id)?.name ?? null;

  private view(s: GenSettlement, now: number): SettlementView {
    const relation = this.relationOf(s);
    return {
      id: s.id,
      x: s.x,
      y: s.y,
      name: s.name,
      stage: stageOf(this.powerNow(s, now), this.popNow(s, now)),
      relation,
      owner: s.owner,
      tribeId: s.tribeId,
      tribeName: this.tribeName(s.tribeId),
      color: RELATION_META[relation].color,
      mine: false,
      castle: s.castle,
    };
  }

  private homeView(): SettlementView {
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

  /** Отряд без записанного состава (старый поход, чужой набег) — пешая масса по мощи. */
  private fallbackStack(power: number): Stack {
    return { spear: 0, infantry: Math.max(1, Math.round(power / 2)), archer: 0, cavalry: 0 };
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
    if (m.mission === 'scout') return this.resolveScout(m, target, at);
    if (m.mission === 'support') return this.resolveSupport(m, target, at);
    return this.resolveRaid(m, target, at);
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

  private resolveRaid(m: StoredMarch, target: GenSettlement, at: number): void {
    const defense = this.powerNow(target, at);
    const garrison = garrisonOf(this.save.seed, target.id, defense, target.castle);
    // Состав отряда знает только племя; у старых походов его нет — считаем пехотой.
    const troops = m.troops ?? {};
    const kinds = troopTotal(troops) > 0 ? kindsOf(troops) : this.fallbackStack(m.power);
    const field = resolveField({
      seed: m.seed,
      attacker: { kinds, gear: gearOf(troops), setup: m.setup ?? null },
      defender: { kinds: garrison.kinds, gear: garrison.gear, setup: garrison.setup },
      intel: this.save.intel[target.id]?.kinds,
    });
    const outcome = { won: field.won, attackerLoss: field.attackerLoss, defenderLoss: field.defenderLoss };
    const lostTroops = troopTotal(troops) > 0 && field.result
      ? troopLosses(troops, field.result.sides.attacker.losses)
      : {};
    const lost = stackLosses(m.units, outcome.attackerLoss);
    const left = stackAfter(m.units, lost);
    const enemyLost = Math.round(defense * outcome.defenderLoss);
    const record: BattleRecord | null = field.result
      ? { us: 'attacker', preset: field.preset.attacker, result: field.result }
      : null;

    const prev = this.damageOf(target.id, at);
    this.save.damage[target.id] = {
      loss: Math.min(0.95, prev + outcome.defenderLoss * (1 - prev)),
      at,
    };
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
    // Отряд, еле выстоявший, вынесет из замка гроши — бесплатных денег здесь нет.
    const gold = outcome.won ? Math.round(this.castleGold(target, at) * outcome.defenderLoss) : 0;
    const loot = outcome.won ? this.takeLoot(target, at, stackCarry(left)) : null;
    const spoils: Loot | null = gold > 0 ? { ...(loot ?? {}), gold } : loot;
    const wiped = stackSize(left) === 0;
    const goods = loot ? Object.values(loot).reduce((n, v) => n + (v ?? 0), 0) : 0;
    const lootText =
      (goods > 0 ? ` Взято: ${goods} добра.` : '') + (gold > 0 ? ` Казна замка: ${gold} золота.` : '');

    this.addReport({
      id: `${m.id}-raid`,
      at,
      kind: 'raid',
      title: outcome.won ? `Набег удался: ${target.name}` : `Набег отбит: ${target.name}`,
      target: { id: target.id, name: target.name, x: target.x, y: target.y },
      won: outcome.won,
      sent: { ...m.units },
      lost,
      enemyPower: Math.round(defense),
      enemyLost,
      loot: spoils,
      intel,
      battle: record,
      text: outcome.won
        ? `Гарнизон ${target.name} разбит.${lootText}`
        : `Оборона ${target.name} оказалась крепче.${wiped ? ' Отряд не вернётся.' : ' Уцелевшие уходят домой.'}`,
      read: false,
    });

    this.addEffect({
      id: `${m.id}-battle`,
      lost,
      lostTroops,
      resources: {},
      prestige: outcome.won ? 4 : 0,
      morale: outcome.won ? 4 : -6,
      battle: outcome.won ? 'won' : 'lost',
      text: outcome.won
        ? `Набег на ${target.name} (${formatCoord(target)}) удался.`
        : `Набег на ${target.name} (${formatCoord(target)}) отбит.`,
      good: outcome.won,
    });

    m.units = left;
    if (wiped) this.remove(m);
    else this.turnHome(m, at, spoils);
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
      defender: { kinds: homeKinds, gear: gearOf(home), setup },
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
    const near = this.gen.settlements.filter((s) => distance(s, home) <= AI_RANGE);
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
    const travel = Math.max(seconds * 1000, AI_WARNING);
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
    for (let y = 0; y < h; y++) {
      for (let x = 0; x < w; x++) {
        terrain[y * w + x] = terrainIndex(terrainAt(this.save.seed, x0 + x, y0 + y));
      }
    }
    const settlements: SettlementView[] = [];
    for (const s of this.gen.settlements) {
      if (s.x >= x0 && s.x < x1 && s.y >= y0 && s.y < y1) settlements.push(this.view(s, now));
    }
    const home = this.save.home;
    if (home.x >= x0 && home.x < x1 && home.y >= y0 && home.y < y1) settlements.push(this.homeView());
    return { rect: { x: x0, y: y0, w, h }, terrain, settlements };
  }

  async settlement(id: SettlementId): Promise<SettlementCard | null> {
    const now = this.clock();
    if (id === HOME_ID) {
      const p = this.save.profile;
      return {
        ...this.homeView(),
        terrain: terrainAt(this.save.seed, this.save.home.x, this.save.home.y),
        distance: 0,
        terrainFactor: 1,
        power: estimate(p?.defense ?? 0, 'exact'),
        pop: estimate(p?.pop ?? 0, 'exact'),
        intel: null,
        can: { raid: false, scout: false, support: false, open: true },
        note: 'Своя деревня. Сюда возвращаются походы и сюда же приходят чужие.',
      };
    }
    const s = this.byId.get(id);
    if (!s) return null;
    const view = this.view(s, now);
    const reading = readIntel(this.save.intel[id] ?? null, now);
    const ally = view.relation === 'ally';
    return {
      ...view,
      terrain: terrainAt(this.save.seed, s.x, s.y),
      distance: distance(this.save.home, s),
      terrainFactor: terrainFactor(this.save.seed, this.save.home, s),
      power: reading ? reading.power : { ...UNKNOWN },
      pop: reading ? reading.pop : { ...UNKNOWN },
      intel: reading,
      can: { raid: true, scout: true, support: ally, open: false },
      note: ally ? null : 'Поддержку принимают только союзники.',
    };
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
    if (order.mission === 'raid' && (units.warrior ?? 0) === 0) {
      return { error: 'В набег ходят воины.', march: null };
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
    this.fresh = [];
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
