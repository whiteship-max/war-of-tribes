import { describe, expect, it } from 'vitest';
import { SECTORS, UNIT_KINDS, stackTotal, type ArmySetup, type Stack } from '@/battle';
import { createInitialState } from '@/game/state';
import { deserialize, serialize } from '@/game/save';
import { armySize } from '@/game/derived';
import { seeded } from '@/game/sim/random';
import { TROOP_IDS } from '@/game/data/troops';
import { kindsOf, troopTotal, troopsAfter, type TroopStack } from '@/game/battle/kinds';
import { presetFormation, toArmySetup } from '@/game/battle/formation';
import type { GameState, TroopId } from '@/game/types';
import { LocalWorld } from './local/LocalWorld';
import { applyEffects, playerProfile, syncAway } from './bridge';
import {
  NOBODY_AWAY,
  awayMen,
  awayOf,
  homeOf,
  postureOf,
  roomOf,
  standingShare,
  standingTroops,
  weakest,
} from './muster';
import { fitSetup } from './battle';
import { STRIKE_FROM_TOWN } from './siege';
import { distance } from './geo';
import type { FigureView, MarchView, PlayerProfile, Report, SettlementView, WorldPulse } from './types';
import { shieldVillagers } from './lairs';

const START = 1_700_000_000_000;
const MIN = 60_000;

// ---------------------------------------------------------------------------
// Правило само по себе
// ---------------------------------------------------------------------------

const march = (over: Partial<MarchView>): MarchView => ({
  id: 'm1',
  mission: 'support',
  units: {},
  own: true,
  hostile: false,
  phase: 'out',
  from: { x: 0, y: 0 },
  to: { x: 1, y: 1 },
  fromName: 'дом',
  toName: 'цель',
  targetId: 's1',
  departAt: START,
  arriveAt: START + 1000,
  loot: null,
  recallable: true,
  ...over,
});

describe('где стоит боец — одно правило', () => {
  it('дружина в гарнизоне ровно тогда, когда собрана и дома, — и ровно в одном из двух списков', () => {
    const cases = [
      { phase: 'home', readyAt: 0, posture: 'stands' },
      { phase: 'home', readyAt: START + 5000, posture: 'gathering' },
      { phase: 'moving', readyAt: 0, posture: 'engaged' },
      { phase: 'field', readyAt: 0, posture: 'engaged' },
      { phase: 'field', readyAt: START + 5000, posture: 'gathering' },
      { phase: 'down', readyAt: 0, posture: 'engaged' },
    ] as const;
    for (const c of cases) {
      const general = { phase: c.phase, readyAt: c.readyAt, troops: { clubman: 10, archer: 4 } };
      expect(postureOf(general), `фаза ${c.phase}, сбор до ${c.readyAt}`).toBe(c.posture);
      const away = awayOf([march({ own: false, units: { warrior: 99 } })], [general]);
      const druzhina = { clubman: 10, archer: 4 };
      const home = c.posture === 'stands';
      expect(away.troops, `фаза ${c.phase}: не в гарнизоне`).toEqual(home ? {} : druzhina);
      expect(away.standing, `фаза ${c.phase}: в гарнизоне`).toEqual(home ? druzhina : {});
      expect(away.loose, 'чужой отряд в свои ушедшие не пишется').toBe(0);
      const army = { clubman: 10, archer: 10 };
      const garrison = homeOf(army, away);
      expect(garrison, `фаза ${c.phase}: гарнизон`).toEqual(home ? army : { archer: 6 });
      expect(troopTotal(garrison) + awayMen(away), `фаза ${c.phase}: в гарнизоне и вне его — всё войско`).toBe(20);
      // Держать полководцу можно всё, что не ушло отрядами, — в любой фазе одно и то же.
      expect(roomOf(army, []), `фаза ${c.phase}`).toEqual(army);
    }
    expect(postureOf({ phase: 'home', troops: {} }), 'пустая дружина').toBe('none');
  });

  it('минута спрашивается честно: сбор кончился — стоит, встал позже боя — не стоял', () => {
    const f = { phase: 'home' as const, departAt: START + 10_000, handover: { until: START + 20_000 }, troops: { clubman: 3 } };
    expect(postureOf(f, START + 15_000)).toBe('gathering');
    expect(postureOf({ ...f, handover: null }, START + 5_000), 'встал у ворот после этой минуты').toBe('engaged');
    expect(postureOf({ ...f, handover: null }, START + 10_000)).toBe('stands');
    expect(postureOf({ ...f, readyAt: START + 20_000, handover: undefined }, START + 25_000), 'сбор кончился').toBe('stands');
  });

  it('отряд без состава снимается со слабых, и гарнизон не бывает отрицательным', () => {
    const away = awayOf([march({ units: { warrior: 7 } })], [{ phase: 'field', troops: { legionary: 50 } }]);
    expect(awayMen(away)).toBe(57);
    // Дубинщиков пять, копейщиков трое: семерых без имени снимают со слабого конца.
    expect(homeOf({ clubman: 5, spearman: 3, legionary: 20 }, away)).toEqual({ spearman: 1 });
    expect(weakest({ archer: 2, clubman: 1 }, 2)).toEqual({ clubman: 1, archer: 1 });
    expect(homeOf({}, away), 'в мире числится больше, чем есть: дома просто никого').toEqual({});
    expect(homeOf({ rider: 3 }, NOBODY_AWAY)).toEqual({ rider: 3 });
    // Дружина из старого сохранения больше войска: в гарнизон встаёт не больше, чем есть.
    const doubled = awayOf([], [{ phase: 'home', troops: { clubman: 110 } }]);
    expect(standingTroops({ clubman: 10, archer: 10 }, doubled)).toEqual({ clubman: 10 });
    expect(homeOf({ clubman: 10, archer: 10 }, doubled)).toEqual({ clubman: 10, archer: 10 });
  });

  it('потери обороны делятся между гарнизоном и дружиной до бойца, и никто не теряет больше, чем стоял', () => {
    const rng = seeded(4242);
    for (let i = 0; i < 2000; i++) {
      const garrison: TroopStack = {};
      const standing: TroopStack = {};
      const lost: TroopStack = {};
      for (const id of TROOP_IDS) {
        if (rng() < 0.6) garrison[id] = Math.floor(rng() * 30);
        if (rng() < 0.6) standing[id] = Math.floor(rng() * 30);
        lost[id] = Math.floor(rng() * ((garrison[id] ?? 0) + (standing[id] ?? 0) + 1));
      }
      const share = standingShare(garrison, standing, lost);
      for (const id of TROOP_IDS) {
        const s = share[id] ?? 0;
        expect(s, `набор ${i}: ${id} дружина не теряет больше, чем стояло`).toBeLessThanOrEqual(standing[id] ?? 0);
        expect((lost[id] ?? 0) - s, `набор ${i}: ${id} гарнизон не теряет больше, чем стояло`).toBeLessThanOrEqual(garrison[id] ?? 0);
        expect((lost[id] ?? 0) - s, `набор ${i}: ${id}`).toBeGreaterThanOrEqual(0);
      }
    }
    expect(standingShare({ clubman: 4 }, { clubman: 10 }, { clubman: 7 })).toEqual({ clubman: 5 });
  });

  it('расстановка из гарнизона подрезке не подлежит, а сверх гарнизона — снимается с конца', () => {
    const rng = seeded(20260913);
    const presets = ['defense', 'standard', 'anti-cavalry', 'center-punch'] as const;
    for (let i = 0; i < 400; i++) {
      const home: TroopStack = {};
      for (const id of TROOP_IDS) if (rng() < 0.5) home[id] = Math.floor(rng() * 40);
      if (troopTotal(home) === 0) continue;
      const militia = Math.floor(rng() * 60);
      const archers = Math.floor(rng() * militia);
      const setup = toArmySetup(presetFormation(home, presets[i % presets.length]), militia - archers, archers);
      const have = kindsOf(home);
      have.infantry += militia - archers;
      have.archer += archers;
      expect(fitSetup(setup, have), `набор ${i}: собранная из тех же людей расстановка не меняется`).toEqual(setup);
    }

    const setup: ArmySetup = toArmySetup(presetFormation({ spearman: 30, archer: 20 }, 'defense'));
    const copy = structuredClone(setup);
    const cut = fitSetup(setup, { spear: 10, infantry: 0, archer: 20, cavalry: 0 });
    const total = (s: ArmySetup): Stack => {
      const out: Stack = { spear: 0, infantry: 0, archer: 0, cavalry: 0 };
      for (const id of SECTORS) for (const k of UNIT_KINDS) out[k] += s.sectors[id][k];
      return out;
    };
    expect(total(cut)).toEqual({ spear: 10, infantry: 0, archer: 20, cavalry: 0 });
    // Снимают с конца: резерв и тыл пустеют раньше фронта.
    const front = cut.sectors.A.spear + cut.sectors.B.spear + cut.sectors.C.spear;
    expect(front, 'фронт держится до последнего').toBe(Math.min(10, setup.sectors.A.spear + setup.sectors.B.spear + setup.sectors.C.spear));
    expect(setup, 'исходная расстановка не тронута: запертая лежит в сохранении').toEqual(copy);
  });
});

// ---------------------------------------------------------------------------
// Правило в игре: деревня, мир и мост — тем же порядком, что world/store.pulse
// ---------------------------------------------------------------------------

function memory(data: string | null = null) {
  return {
    read: (): string | null => data,
    write: (json: string): void => {
      data = json;
    },
  };
}

const plus = (a: TroopStack, b: TroopStack): TroopStack => {
  const out: TroopStack = {};
  for (const id of TROOP_IDS) {
    const n = (a[id] ?? 0) + (b[id] ?? 0);
    if (n > 0) out[id] = n;
  }
  return out;
};

const NO_GENERAL = { phase: 'home', troops: {}, readyAt: 0, departAt: 0 } as unknown as FigureView;

/**
 * Партия целиком: племя, мир с ручными часами и мост между ними. Пульс — ровно
 * тот, что в `world/store.pulse`: слепок по спискам с прошлого пульса, мир,
 * последствия, пересчёт ушедших. Каждый приказ, как и в игре, кончается пульсом.
 */
class Party {
  marches: MarchView[] = [];
  figures: FigureView[] = [];
  /** Сколько раз мир принял передачу дружины: тест, в котором не прошло ничего, ничего и не доказал. */
  taken = 0;
  battles = 0;
  /** Сколько боёв у частокола дружина простояла в обороне. */
  stood = 0;
  /** Бои дружины, отданные приказом: номер отчёта → кто был при полководце до боя. */
  ordered = new Map<string, TroopStack>();
  /** Полководцу велено догонять: бой погони — тоже приказ. */
  chased = false;
  /** Удар по лагерю из поля: кто мог оказаться в строю — дружина и гарнизон на минуту приказа. */
  fieldStrike: TroopStack | null = null;

  private constructor(
    public s: GameState,
    public world: LocalWorld,
    public store: ReturnType<typeof memory>,
    public clock: { now: number },
    /** Правка слепка поверх моста — только чтобы дождаться лагеря под стенами. */
    public over: Partial<PlayerProfile> | null = null,
  ) {}

  static start(seed: number, army: TroopStack, raids = true): Party {
    const s = createInitialState();
    for (const id of TROOP_IDS) s.army[id] = Math.max(0, army[id] ?? 0);
    const st = s.buildings.find((b) => b.type === 'statue');
    if (st) st.level = 10;
    // Выше защиты новичка: по деревне в тридцать душ набеги не ходят вовсе. Без
    // набегов последовательность приказов не упирается в лагерь под стенами.
    if (raids) s.pop = shieldVillagers(0.1);
    const clock = { now: START };
    const store = memory();
    return new Party(s, new LocalWorld({ seed, now: () => clock.now, storage: store }), store, clock);
  }

  /** Закрыли игру и открыли снова: оба сохранения с диска, списки мира пусты. */
  reload(): Party {
    const s = deserialize(serialize(this.s)) as GameState;
    const store = memory(this.store.read());
    const clock = { now: this.clock.now };
    const next = new Party(s, new LocalWorld({ now: () => clock.now, storage: store }), store, clock, this.over);
    next.taken = this.taken;
    next.battles = this.battles;
    next.stood = this.stood;
    return next;
  }

  get now(): number {
    return this.clock.now;
  }

  async general(): Promise<FigureView> {
    return (await this.world.figures()).find((f) => f.id === 'general') as FigureView;
  }

  /** Полководец, каким его знает партия с последнего пульса или приказа. */
  known(): FigureView {
    return this.figures.find((f) => f.id === 'general') ?? NO_GENERAL;
  }

  async pulse(step: string): Promise<WorldPulse> {
    // Кто в эту минуту где и сколько войска у племени — до пульса: бои пульса
    // считались из них. Полководец — тот, что пришёл прошлым пульсом или приказом:
    // спросить мир заново значило бы свести передачу раньше, чем её сведёт пульс.
    const before = this.known();
    const army: TroopStack = { ...this.s.army };
    const profile = { ...playerProfile(this.s, awayOf(this.marches, this.figures)), ...(this.over ?? {}) };
    const pulse = await this.world.sync(profile);
    if (pulse.effects.length > 0) applyEffects(this.s, pulse.effects);
    syncAway(this.s, pulse.marches, pulse.figures);
    this.marches = pulse.marches;
    this.figures = pulse.figures;
    const after = this.known();
    const sameTime = new Map<number, TroopStack>();
    let ordered = false;
    for (const r of pulse.reports) ordered = this.fought(r, step, army, before, after, sameTime) || ordered;
    unbidden(pulse, step, before, after, ordered);
    holds(this, step);
    return pulse;
  }

  /**
   * Бой из отчёта: в строю не больше, чем стояло там, откуда выходили, и дружина
   * бьётся только там, куда её послали. Возвращает, был ли это бой по приказу.
   */
  fought(r: Report, step: string, army: TroopStack, before: FigureView, after: FigureView, sameTime: Map<number, TroopStack>): boolean {
    const b = r.battle;
    const minus = (t: TroopStack): TroopStack => troopsAfter(army, t);
    if (!b) {
      if (r.title === 'Хлеб кончился') {
        const stands = postureOf(after, r.at) === 'stands' && postureOf(before, r.at) !== 'gathering';
        const pool = troopTotal(stands ? army : minus(before.troops));
        expect(r.lost.warrior ?? 0, `${step}: голод рассеял больше, чем стояло в обороне`).toBeLessThanOrEqual(pool);
      }
      return false;
    }
    this.battles++;
    const us = b.troops[b.us];
    const initial = b.result.sides[b.us].initial;
    const kinds = kindsOf(us);
    let pool: TroopStack;
    let byOrder = false;
    if (b.us === 'defender') {
      // Дружина стоит у частокола, только если в минуту боя она собрана и дома.
      const stands = postureOf(after, r.at) === 'stands' && postureOf(before, r.at) !== 'gathering';
      if (stands && troopTotal(before.troops) > 0) this.stood++;
      pool = stands ? army : minus(before.troops);
    } else if (r.id.startsWith('sortie')) {
      // На вылазку выходят из гарнизона, а в нём и дружина, если она собрана и дома.
      const stands = postureOf(before, r.at) === 'stands';
      pool = stands ? army : minus(before.troops);
    } else {
      // Бой дружины: только приказом — ударом, погоней или ударом из поля (в минуту
      // прихода, тогда в строю ещё и гарнизон, если его звали).
      const order =
        this.ordered.get(r.id) ??
        (r.id.startsWith('chase') && this.chased ? before.troops : null) ??
        (r.id.startsWith('camp') && this.fieldStrike ? this.fieldStrike : null);
      expect(order, `${step}: «${r.title}» — дружина в бою, куда её не посылали`).not.toBeNull();
      pool = order ?? {};
      byOrder = true;
    }
    const sum = plus(sameTime.get(r.at) ?? {}, us);
    sameTime.set(r.at, sum);
    for (const id of TROOP_IDS) {
      expect(us[id] ?? 0, `${step}: «${r.title}» — ${id} в строю больше, чем стояло там, откуда выходили`).toBeLessThanOrEqual(Math.max(0, pool[id] ?? 0));
      expect(sum[id] ?? 0, `${step}: ${id} в боях одной минуты больше, чем есть у племени`).toBeLessThanOrEqual(army[id] ?? 0);
    }
    const militia = b.militia?.[b.us] ?? { men: 0, archers: 0 };
    kinds.infantry += militia.men - militia.archers;
    kinds.archer += militia.archers;
    for (const k of UNIT_KINDS) {
      expect(initial[k], `${step}: «${r.title}» — ядро поставило в строй ${k} сверх записанного состава`).toBeLessThanOrEqual(kinds[k]);
    }
    return byOrder;
  }

  async setGarrison(t: TroopStack | null, step: string): Promise<string | null> {
    const size = armySize(this.s);
    const err = await this.world.setGarrison(t);
    if (!err) this.taken++;
    this.figures = await this.world.figures();
    const pulse = await this.pulse(step);
    // Перенос — это перенос: племя не убывает и не прибывает от передачи.
    if (pulse.effects.every((e) => !e.lostTroops && !e.lost.warrior)) {
      expect(armySize(this.s), `${step}: передача изменила войско`).toBe(size);
    }
    return err;
  }

  /** Удар полководца там, где он стоит. Кто был при нём до удара — для проверки строя. */
  async strike(step: string): Promise<{ error: string | null; reportId: string | null; won: boolean }> {
    const g = await this.general();
    const res = await this.world.attack({ setup: null });
    if (!res.error && res.reportId) this.ordered.set(res.reportId, { ...g.troops });
    this.figures = await this.world.figures();
    await this.pulse(`${step}${res.error ? ` (${res.error})` : ''}`);
    return res;
  }

  /** Подождать: пульс каждые двадцать секунд, как в открытой игре. */
  async idle(ms: number, step: string): Promise<WorldPulse> {
    let last: WorldPulse | null = null;
    for (let t = 0; t < ms; t += 20_000) {
      this.clock.now += 20_000;
      last = await this.pulse(step);
    }
    return last ?? this.pulse(step);
  }

  async settle(step: string): Promise<void> {
    const g = this.figures.length > 0 ? this.known() : await this.general();
    while (this.now < g.readyAt) {
      this.clock.now = Math.min(g.readyAt, this.now + 20_000);
      await this.pulse(step);
    }
    await this.pulse(step);
  }

  async walk(to: { x: number; y: number }, step: string): Promise<string | null> {
    const err = await this.world.moveFigure('general', to);
    this.figures = await this.world.figures();
    await this.pulse(step);
    if (err) return err;
    const g = this.known();
    while (this.now < g.arriveAt) {
      this.clock.now = Math.min(g.arriveAt, this.now + 20_000);
      await this.pulse(step);
    }
    await this.pulse(step);
    return null;
  }

  async lair(): Promise<SettlementView> {
    const info = await this.world.info();
    const chunk = await this.world.region({ x: info.home.x - 30, y: info.home.y - 30, w: 60, h: 60 });
    return chunk.settlements.filter((x) => !x.mine).sort((a, b) => distance(info.home, a) - distance(info.home, b))[0];
  }
}

/**
 * Само правило. Бойцов при полководце и в походах никогда не больше, чем есть у
 * племени, в гарнизоне — ровно остальные, в обороне и вне её вместе — всё войско,
 * и племя считает не стоящих в обороне тем же правилом, что и мир. Проверяется
 * после каждого пульса каждой последовательности.
 */
function holds(p: Party, step: string): void {
  const away = awayOf(p.marches, p.figures);
  for (const id of TROOP_IDS) {
    expect(away.troops[id] ?? 0, `${step}: ${id} при полководце и в походах больше, чем есть у племени`).toBeLessThanOrEqual(p.s.army[id]);
  }
  expect(troopTotal(homeOf(p.s.army, away)) + awayMen(away), `${step}: в гарнизоне и вне его вместе не всё войско`).toBe(armySize(p.s));
  expect(p.s.warriorsAway, `${step}: племя считает не стоящих в гарнизоне не тем правилом, что мир`).toBe(awayMen(away));
}

/**
 * Дружина вне обороны и вне осады не теряет людей сама собой: в бой её ведёт
 * только приказ. Сбор и сверка с казармами меняют состав законно — их не судим.
 */
function unbidden(pulse: WorldPulse, step: string, before: FigureView, after: FigureView, ordered: boolean): void {
  if (ordered || postureOf(before) !== 'engaged' || after.besieging) return;
  // Дошёл до своих ворот и в том же пульсе встал в оборону: её потери законны.
  if (after.phase === 'home' && pulse.reports.some((r) => r.kind === 'defense')) return;
  if (pulse.effects.some((e) => e.text.includes('сверили с казармами'))) return;
  for (const id of TROOP_IDS) {
    expect(after.troops[id] ?? 0, `${step}: дружина в поле потеряла ${id} без приказа`).toBe(before.troops[id] ?? 0);
  }
}

/** Честный приказ — ровно тот, что даст панель: всё войско, что не ушло отрядами (`roomOf`). */
const honest = (p: Party, _g: FigureView): TroopStack => roomOf(p.s.army, p.marches);

const doubled = (t: TroopStack): TroopStack =>
  Object.fromEntries(Object.entries(t).map(([k, n]) => [k, (n ?? 0) * 2])) as TroopStack;

/** Ждать, пока в пульсе не случится нужное: пульс каждые двадцать секунд. */
const until = async (p: Party, step: string, done: (pulse: WorldPulse) => boolean): Promise<WorldPulse> => {
  for (let i = 0; i < 3000; i++) {
    p.clock.now += 20_000;
    const pulse = await p.pulse(step);
    if (done(pulse)) return pulse;
  }
  throw new Error(`${step}: так и не дождались`);
};

/** Лагерь под своими стенами, по сохранению мира: рты за стеной на последнее открытие окна. */
const siegeOnHome = (p: Party): { garrison: number; since: number } | null => {
  const save = JSON.parse(p.store.read() as string) as {
    sieges: Record<string, { garrisonAtStart: number; startedAt: number; sinceAt?: number }>;
  };
  const w = save.sieges?.home;
  return w ? { garrison: w.garrisonAtStart, since: w.sinceAt ?? w.startedAt } : null;
};

/** Ближайший чужой отряд, идущий на деревню, по сохранению мира. */
const raidOnHome = (p: Party): { id: string; arriveAt: number } | null => {
  const save = JSON.parse(p.store.read() as string) as { marches: (MarchView & { own: boolean })[] };
  const m = save.marches.filter((x) => !x.own && x.targetId === 'home' && x.phase === 'out').sort((a, b) => a.arriveAt - b.arriveAt)[0];
  return m ? { id: m.id, arriveAt: m.arriveAt } : null;
};

describe('дома и в поле вместе не больше, чем есть у племени', () => {
  it('собрать, распустить, собрать снова, в поход и обратно — с сохранением между шагами', async () => {
    for (const reloadEvery of [false, true]) {
      let p = Party.start(11, { clubman: 10, archer: 6, legionary: 4 }, false);
      const again = async (): Promise<void> => {
        if (reloadEvery) p = p.reload();
      };
      await p.pulse('старт');
      const lair = await p.lair();
      const info = await p.world.info();
      const field = { x: Math.round((lair.x + info.home.x) / 2), y: Math.round((lair.y + info.home.y) / 2) };

      for (let round = 0; round < 2; round++) {
        const tag = `${reloadEvery ? 'с загрузкой' : 'без загрузки'}, круг ${round + 1}`;
        await again();
        expect(await p.setGarrison(honest(p, await p.general()), `${tag}: собрать`), `${tag}: честный сбор проходит`).toBeNull();
        await again();
        await p.pulse(`${tag}: посреди сбора`);
        expect(troopTotal(homeOf(p.s.army, awayOf(p.marches, p.figures))), `${tag}: во время сбора в гарнизоне никого из войска`).toBe(0);
        await p.settle(`${tag}: сбор идёт`);
        await again();
        await p.pulse(`${tag}: собрана`);
        expect(homeOf(p.s.army, awayOf(p.marches, p.figures)), `${tag}: собрана и дома — в гарнизоне всё войско ровно раз`).toEqual({ clubman: 10, archer: 6, legionary: 4 });
        // Полководец дома, дружина при нём: взять тех же ещё раз нельзя.
        const g = await p.general();
        expect(await p.setGarrison(doubled(g.troops), `${tag}: удвоить дома`), `${tag}: удвоить дома`).toBeTruthy();
        expect(await p.setGarrison(plus(g.troops, p.s.army), `${tag}: взять всё войско сверху`)).toBeTruthy();
        expect(await p.setGarrison(null, `${tag}: распустить`)).toBeNull();
        await again();
        await p.settle(`${tag}: роспуск идёт`);
        expect(troopTotal((await p.general()).troops), `${tag}: распустили — при нём никого`).toBe(0);
        expect(await p.setGarrison(honest(p, await p.general()), `${tag}: собрать снова`)).toBeNull();
        await p.settle(`${tag}: второй сбор`);
        await again();
        expect(await p.walk(field, `${tag}: в поход`)).toBeNull();
        await again();
        await p.pulse(`${tag}: стоит в поле`);
        expect(troopTotal(homeOf(p.s.army, awayOf(p.marches, p.figures))), `${tag}: полководец в поле — дружины в гарнизоне нет`).toBe(0);
        expect(await p.setGarrison(doubled((await p.general()).troops), `${tag}: удвоить в поле`)).toBeTruthy();
        expect(await p.walk(info.home, `${tag}: обратно`)).toBeNull();
        await again();
        const back = await p.general();
        expect(back.phase, `${tag}: вернулся домой`).toBe('home');
        expect(await p.setGarrison(doubled(back.troops), `${tag}: удвоить после похода`)).toBeTruthy();
        expect(await p.setGarrison(null, `${tag}: распустить после похода`)).toBeNull();
        await p.settle(`${tag}: роспуск после похода`);
      }
      expect(p.taken, 'честные приказы проходили').toBeGreaterThanOrEqual(6);
    }
  }, 60_000);

  it('старый приём — десять дубинщиков в дружину на сто десять — не проходит ни одним приказом', async () => {
    const p = Party.start(11, { clubman: 10 }, false);
    await p.pulse('старт');
    expect(await p.setGarrison({ clubman: 10 }, 'первый сбор')).toBeNull();
    await p.settle('сбор');
    for (let k = 2; k <= 11; k++) {
      // Отказ — в самом приказе, а не сверкой потом: принятый приказ уже увёл бы
      // бойцов из гарнизона на всё время передачи.
      expect((await p.setGarrison({ clubman: 10 * k }, `приказ на ${10 * k}`)) ?? 'приказ принят', `приказ на ${10 * k} при десяти в племени`).toMatch(/дома нет/);
      await p.settle(`после приказа на ${10 * k}`);
    }
    expect(troopTotal((await p.general()).troops), 'при полководце не больше, чем у племени').toBe(10);
    // Бой видит ровно их: удар по ближайшему логову.
    expect(await p.walk(await p.lair(), 'к логову')).toBeNull();
    const res = await p.strike('удар');
    expect(res.error).toBeNull();
    const report = (await p.world.reports()).find((r) => r.id === res.reportId);
    expect(report?.battle?.result.sides.attacker.total.initial, 'в строю ядра десять, а не сто десять').toBe(10);
  }, 60_000);

  it('случайные приказы, найм, погони, вылазки, удары и загрузки на шести мирах', async () => {
    const kinds: TroopId[] = ['clubman', 'spearman', 'archer', 'rider', 'legionary'];
    let taken = 0;
    let battles = 0;
    let stood = 0;
    let sortied = 0;
    // Шесть миров, а не четыре: набег теперь стоит людей и часть их кончается прорывом с окном
    // после него, и на четырёх мирах дружина ни разу не успевала встать у частокола.
    for (const seed of [11, 42, 101, 7, 77, 202]) {
      const rng = seeded(seed * 7919);
      let p = Party.start(seed, { clubman: 12, spearman: 8, archer: 6, legionary: 3 });
      await p.pulse('старт');
      const info = await p.world.info();
      const lair = await p.lair();
      // Осада под деревней теперь реже и короче: лагерем садится только набег, который
      // частокол отбил бы. Чтобы вылазка не зависела от того, совпадёт ли осада с шагом
      // «вылазка», на каждую застигнутую осаду прогон один раз выходит сразу.
      const sortiedAt = new Set<number>();
      for (let i = 0; i < 90; i++) {
        const step = `мир ${seed}, шаг ${i}`;
        const camp = siegeOnHome(p);
        if (camp && !sortiedAt.has(camp.since)) {
          sortiedAt.add(camp.since);
          const res = await p.world.sortie(weakest(homeOf(p.s.army, awayOf(p.marches, p.figures)), 3));
          p.figures = await p.world.figures();
          if (!res.error) sortied++;
          await p.pulse(`${step}: вылазка на застигнутую осаду${res.error ? ` (${res.error})` : ''}`);
        }
        const roll = rng();
        if (roll < 0.22) {
          // Передача бывает только дома: из поля полководец сначала возвращается.
          // Приказы — от честного до наглого, и принятый не должен нарушить правило.
          if ((await p.general()).phase === 'field') await p.walk(info.home, `${step}: домой за дружиной`);
          const g = await p.general();
          const asks = [honest(p, g), doubled(g.troops), plus(g.troops, p.s.army), { ...p.s.army }, weakest(honest(p, g), 5)];
          await p.setGarrison(asks[Math.floor(rng() * asks.length)], `${step}: передача`);
        } else if (roll < 0.28) {
          if ((await p.general()).phase === 'field') await p.walk(info.home, `${step}: домой распускать`);
          await p.setGarrison(null, `${step}: роспуск`);
        } else if (roll < 0.36) {
          await p.settle(`${step}: ждём передачу`);
        } else if (roll < 0.48) {
          // Поход на логово целиком: дождаться дружины, дойти, ударить.
          await p.settle(`${step}: сбор перед походом`);
          await p.walk(lair, `${step}: к логову`);
          await p.strike(`${step}: удар`);
        } else if (roll < 0.53) {
          await p.walk({ x: info.home.x + 4, y: info.home.y + 3 }, `${step}: в поле`);
        } else if (roll < 0.58) {
          await p.walk(info.home, `${step}: домой`);
        } else if (roll < 0.63) {
          // Погоня за набегом, если он идёт: бой в поле — только по этому приказу.
          const raid = raidOnHome(p);
          const err = raid ? await p.world.intercept(raid.id) : 'набега нет';
          if (!err) p.chased = true;
          p.figures = await p.world.figures();
          await p.pulse(`${step}: погоня (${err ?? 'пошёл'})`);
        } else if (roll < 0.72) {
          // Под своими стенами лагерь: вылазка гарнизоном (с дружиной, если она дома),
          // удар «от ворот» (обязан получить отказ) или удар из поля, с гарнизоном и без.
          if (siegeOnHome(p)) {
            const how = rng();
            if (how < 0.4) {
              const res = await p.world.sortie(weakest(homeOf(p.s.army, awayOf(p.marches, p.figures)), 3));
              p.figures = await p.world.figures();
              if (!res.error) sortied++;
              await p.pulse(`${step}: вылазка${res.error ? ` (${res.error})` : ''}`);
            } else if (how < 0.6) {
              const res = await p.strike(`${step}: удар по лагерю от ворот`);
              if (postureOf(p.known()) === 'stands') expect(res.error, `${step}: полководец дома ударить не может`).toBe(STRIKE_FROM_TOWN);
            } else {
              const garrison = rng() < 0.5;
              const g = await p.general();
              const err = await p.world.strikeCamp('home', garrison);
              if (!err) p.fieldStrike = plus(g.troops, garrison ? homeOf(p.s.army, awayOf(p.marches, p.figures)) : {});
              if (postureOf(g) === 'stands') expect(err, `${step}: из города удара из поля нет`).toBe(STRIKE_FROM_TOWN);
              p.figures = await p.world.figures();
              await p.pulse(`${step}: удар из поля${err ? ` (${err})` : ''}`);
            }
          } else {
            await p.pulse(`${step}: лагеря нет`);
          }
        } else if (roll < 0.77) {
          const id = kinds[Math.floor(rng() * kinds.length)];
          p.s.army[id] += 1 + Math.floor(rng() * 5);
          await p.pulse(`${step}: наняли ${id}`);
        } else if (roll < 0.82) {
          p = p.reload();
          await p.pulse(`${step}: загрузка`);
        } else {
          await p.idle(Math.floor(rng() * 6 + 1) * MIN, `${step}: время идёт`);
        }
      }
      taken += p.taken;
      battles += p.battles;
      stood += p.stood;
    }
    // Последовательность, в которой мир ничего не принял и никто не бился, правила не проверила.
    expect(taken, 'передачи дружины проходили').toBeGreaterThanOrEqual(10);
    expect(battles, 'бои случались').toBeGreaterThanOrEqual(5);
    expect(stood, 'дружина стояла у частокола').toBeGreaterThanOrEqual(1);
    expect(sortied, 'вылазки случались').toBeGreaterThanOrEqual(1);
  }, 180_000);
});

describe('дружина в обороне: собрана и дома — один раз, в сборе и в деле — нисколько', () => {
  /** Десять из четырнадцати при полководце, сбор кончился, полководец у ворот. */
  const gathered = async (seed: number): Promise<Party> => {
    const p = Party.start(seed, { clubman: 14 });
    await p.pulse('старт');
    expect(await p.setGarrison({ clubman: 10 }, 'сбор')).toBeNull();
    await p.settle('сбор');
    expect(postureOf(p.known()), 'собрана и дома').toBe('stands');
    return p;
  };

  it('у частокола: собранная дома — ровно один раз, ни нуля, ни дважды', async () => {
    for (const seed of [42, 77]) {
      const p = await gathered(seed);
      const pulse = await until(p, `мир ${seed}: ждём боя у частокола`, (x) => x.reports.some((r) => r.id.endsWith('-defense')));
      const fight = pulse.reports.find((r) => r.id.endsWith('-defense')) as Report;
      expect(fight.battle?.troops.defender, `мир ${seed}: у частокола гарнизон четыре и дружина десять`).toEqual({ clubman: 14 });
      // Бой стоит людей, и дружина теряет в нём свою долю — но только долю павших, ни одного
      // больше: при полководце и в гарнизоне вместе ровно четырнадцать минус павшие.
      const lost = troopTotal(pulse.effects.find((e) => e.id.endsWith('-defense'))?.lostTroops ?? {});
      expect(troopTotal(p.known().troops), `мир ${seed}: дружина не больше прежней`).toBeLessThanOrEqual(10);
      expect(troopTotal(p.s.army), `мир ${seed}: у племени четырнадцать минус павшие`).toBe(14 - lost);
    }
  }, 60_000);

  it('сбор — плата: пока он идёт, этих бойцов нет ни в гарнизоне, ни в обороне', async () => {
    const p = Party.start(42, { clubman: 14 });
    await p.pulse('старт');
    // Отдать дружину так, чтобы набег пришёл посреди сбора.
    const raid = await (async () => {
      for (let i = 0; i < 3000; i++) {
        p.clock.now += 5_000;
        await p.pulse('ждём набег');
        const r = raidOnHome(p);
        if (r && r.arriveAt - p.now < 40_000) return r;
      }
      throw new Error('набега нет');
    })();
    expect(await p.setGarrison({ clubman: 10 }, 'сбор под набегом')).toBeNull();
    expect(p.known().readyAt, 'сбор кончится позже набега').toBeGreaterThan(raid.arriveAt);
    const pulse = await until(p, 'ждём боя', (x) => x.reports.some((r) => r.id === `${raid.id}-defense`));
    const fight = pulse.reports.find((r) => r.id === `${raid.id}-defense`) as Report;
    expect(fight.battle?.troops.defender ?? {}, 'у частокола только гарнизон').toEqual({ clubman: 4 });
  }, 60_000);

  it('занята: в пути, в поле и в погоне — у частокола её нет, даже у самых ворот', async () => {
    const p = await gathered(42);
    const info = await p.world.info();
    expect(await p.walk({ x: info.home.x + 3, y: info.home.y + 2 }, 'встал в двух шагах от ворот')).toBeNull();
    expect(postureOf(p.known()), 'в поле').toBe('engaged');
    const pulse = await until(p, 'ждём боя', (x) => x.reports.some((r) => r.id.endsWith('-defense')));
    const fight = pulse.reports.find((r) => r.id.endsWith('-defense')) as Report;
    expect(fight.battle?.troops.defender ?? {}, 'полководец в поле — у частокола гарнизон').toEqual({ clubman: 4 });
    expect(troopTotal(p.known().troops), 'в бой без приказа дружина не пошла').toBe(10);

    // Погоня от своих ворот: пока полководец идёт к бою, у частокола его людей тоже нет.
    const q = await gathered(77);
    const raid = await (async () => {
      for (let i = 0; i < 3000; i++) {
        q.clock.now += 20_000;
        await q.pulse('ждём набег');
        const r = raidOnHome(q);
        if (r) return r;
      }
      throw new Error('набега нет');
    })();
    const err = await q.world.intercept(raid.id);
    expect(err, 'погоня принята').toBeNull();
    q.chased = true;
    q.figures = await q.world.figures();
    await q.pulse('погоня');
    expect(postureOf(q.known()), 'идёт к бою').toBe('engaged');
    expect(q.s.warriorsAway, 'не в обороне — вся дружина').toBe(10);
  }, 60_000);

  it('осада: полководец в городе — его бойцы в гарнизоне один раз во всех ролях, и вылазка тоже', async () => {
    const p = await gathered(11);
    const siege = await until(p, 'ждём лагерь', (x) => Boolean(x.siege));
    // Граница области: полководец дома, дружина собрана, лагерь под стенами.
    expect(postureOf(p.known()), 'собрана и дома').toBe('stands');
    expect(siege.siege?.garrison, 'за стеной едят гарнизон с дружиной — четырнадцать, не десять и не двадцать четыре').toBe(14);
    expect(homeOf(p.s.army, awayOf(p.marches, p.figures)), 'в гарнизоне все четырнадцать ровно раз').toEqual({ clubman: 14 });
    // Удар «от своих ворот» — не отдельный путь: дома его дружина — гарнизон.
    expect((await p.world.attack({ setup: null })).error).toBe(STRIKE_FROM_TOWN);
    expect(await p.world.strikeCamp('home', true)).toBe(STRIKE_FROM_TOWN);
    expect(await p.world.sortie({ clubman: 15 }).then((r) => r.error), 'больше гарнизона не выйти').toMatch(/дома нет/);

    // Голод рассеивает гарнизон: половину из четырнадцати, и дружина теряет свою долю.
    const fell = await until(p, 'ждём голода', (x) => x.reports.some((r) => r.title === 'Хлеб кончился'));
    expect(fell.reports.find((r) => r.title === 'Хлеб кончился')?.lost.warrior, 'рассеялась половина обороны').toBe(7);
    expect(p.s.army.clubman, 'осталось семеро').toBe(7);
    expect(troopTotal(p.known().troops), 'из них при полководце пятеро: доля дружины — пять из семи').toBe(5);

    // Мир 7: роспуск под осадой разрешён — и пока он идёт, эти люди за стеной не едят.
    const r = await gathered(7);
    await until(r, 'ждём лагерь', (x) => Boolean(x.siege));
    expect(siegeOnHome(r)?.garrison, 'собрана — едят все').toBe(14);
    expect(await r.setGarrison(null, 'роспуск под осадой')).toBeNull();
    expect(siegeOnHome(r)?.garrison, 'в сборе не едят').toBe(4);
    await r.settle('роспуск');
    expect(siegeOnHome(r)?.garrison, 'вернулись в гарнизон — снова едят').toBe(14);

    // Мир 101: вылазка всем гарнизоном выводит и дружину — без отдельного приказа —
    // и павшие ложатся на дружину её долей, тем же правилом, что у частокола.
    const q = await gathered(101);
    await until(q, 'ждём лагерь', (x) => Boolean(x.siege));
    const res = await q.world.sortie({ clubman: 14 });
    expect(res.error, 'вылазка всем гарнизоном принята').toBeNull();
    q.figures = await q.world.figures();
    await q.pulse('вылазка всем');
    const report = (await q.world.reports()).find((x) => x.id === res.reportId) as Report;
    expect(report.battle?.troops.attacker, 'на вылазку вышли все четырнадцать, дружина с ними').toEqual({ clubman: 14 });
    const lost = report.lost.warrior ?? 0;
    const left = troopTotal(q.known().troops);
    expect(10 - left, 'дружина потеряла свою долю павших').toBe(standingShare({ clubman: 4 }, { clubman: 10 }, { clubman: lost }).clubman ?? 0);
    expect(homeOf(q.s.army, awayOf(q.marches, q.figures)), 'после боя уцелевшие — гарнизон ровно раз').toEqual(14 - lost > 0 ? { clubman: 14 - lost } : {});
    const camp = siegeOnHome(q);
    if (camp) expect(camp.garrison, 'лагерь устоял: за стеной уцелевшие').toBe(14 - lost);
  }, 60_000);

  it('удар из поля: дружина в строю ровно раз, гарнизон — со стороны города, домой она приходит гарнизоном', async () => {
    const p = await gathered(11);
    // Хлеба в городе на час: иначе голод кончает осаду раньше, чем полководец дойдёт.
    p.over = { food: 60_000 };
    const info = await p.world.info();
    expect(await p.walk({ x: info.home.x + 3, y: info.home.y + 2 }, 'в поле до осады')).toBeNull();
    await until(p, 'ждём лагерь', (x) => Boolean(x.siege));
    // Граница области: полководец в поле, дружина занята и в гарнизоне её нет.
    expect(postureOf(p.known()), 'в поле').toBe('engaged');
    expect(homeOf(p.s.army, awayOf(p.marches, p.figures)), 'в городе только гарнизон').toEqual({ clubman: 4 });
    expect(p.s.warriorsAway, 'не в гарнизоне — вся дружина').toBe(10);
    const plan = await p.world.strikePlan('home', true);
    expect(plan.can, plan.reason ?? '').toBe(true);
    expect(await p.world.strikeCamp('home', true)).toBeNull();
    p.fieldStrike = { clubman: 14 };
    p.figures = await p.world.figures();
    await p.pulse('приказ удара');
    expect(postureOf(p.known()), 'идёт к лагерю — занята').toBe('engaged');
    const g = p.known();
    const pulse = await until(p, 'ждём прихода', (x) => x.reports.some((r) => r.id.startsWith('camp')));
    const r = pulse.reports.find((x) => x.id.startsWith('camp')) as Report;
    expect(r.at, 'бой — в минуту прихода').toBe(g.arriveAt);
    expect(r.battle?.troops.attacker, 'в строю дружина и гарнизон, по разу').toEqual({ clubman: 14 });
    expect(r.rearThrough?.went, 'с тыла вышла дружина').toBe(stackTotal(kindsOf({ clubman: 10 })));
    expect(r.through?.went, 'со стороны города — гарнизон').toBe(stackTotal(kindsOf({ clubman: 4 })));
    // Пришёл — встал у своих ворот, и уцелевшие из дружины стали гарнизоном.
    const after = p.known();
    if (after.phase === 'home') {
      expect(homeOf(p.s.army, awayOf(p.marches, p.figures)), 'всё уцелевшее войско — гарнизон ровно раз').toEqual(
        p.s.army.clubman > 0 ? { clubman: p.s.army.clubman } : {},
      );
    }
  }, 60_000);

  it('запертая расстановка ставит к частоколу дружину, собранную после отметки, один раз', async () => {
    // Мир 42: первый набег кончается боем у частокола, а не лагерем.
    const p = Party.start(42, { clubman: 10 });
    p.s.defenseFormation = presetFormation({ clubman: 10 }, 'defense');
    await p.pulse('старт');
    const frozenRaid = (): string | null => {
      const save = JSON.parse(p.store.read() as string) as { frozenDefense: { marchId: string } | null; marches: MarchView[] };
      const id = save.frozenDefense?.marchId ?? null;
      return save.marches.some((m) => m.id === id && m.targetId === 'home') ? id : null;
    };
    await until(p, 'ждём отметки', () => frozenRaid() !== null);
    const raid = frozenRaid() as string;
    // Расстановка заперта вместе с десятью дубинщиками; теперь их забирает полководец.
    expect(await p.setGarrison({ clubman: 10 }, 'отдали после отметки')).toBeNull();
    const pulse = await until(p, 'ждём боя', (x) => x.reports.some((r) => r.id === `${raid}-defense`));
    const fight = pulse.reports.find((r) => r.id === `${raid}-defense`) as Report;
    expect(fight.battle, 'это бой, а не лагерь').toBeTruthy();
    // Сбор в десять человек короче пяти минут: к бою дружина собрана и стоит дома.
    expect(fight.battle!.troops.defender, 'у частокола ровно десять, а не двадцать').toEqual({ clubman: 10 });
    expect(stackTotal(fight.battle!.result.sides.defender.initial)).toBeLessThanOrEqual(10 + fight.battle!.militia!.defender.men);
  }, 60_000);

  it('сохранение, где дружину успели удвоить, сверяется на первом же пульсе — до любого боя', async () => {
    const p = Party.start(11, { clubman: 10, archer: 10 }, false);
    await p.pulse('старт');
    expect(await p.setGarrison({ clubman: 10 }, 'сбор')).toBeNull();
    await p.settle('сбор');
    // Мир, сохранённый до починки: при полководце сто десять при десяти в племени.
    const save = JSON.parse(p.store.read() as string);
    save.figures.general.troops = { clubman: 110 };
    p.store.write(JSON.stringify(save));
    const q = p.reload();
    const pulse = await q.pulse('первый пульс после загрузки');
    expect(troopTotal((await q.general()).troops), 'лишних вычеркнули').toBe(10);
    expect(pulse.effects.some((e) => e.text.includes('сверили с казармами')), 'и сказали об этом строкой').toBe(true);
    const away = awayOf(q.marches, q.figures);
    expect(homeOf(q.s.army, away), 'в гарнизоне всё войско ровно раз, лучники не пропали').toEqual({ clubman: 10, archer: 10 });
    expect(q.s.warriorsAway).toBe(0);
  }, 60_000);

  it('удвоенное сохранение с набегом на подходе: у частокола не больше, чем есть у племени', async () => {
    const p = await gathered(42);
    await (async () => {
      for (let i = 0; i < 3000; i++) {
        p.clock.now += 20_000;
        await p.pulse('ждём набег');
        const r = raidOnHome(p);
        if (r && r.arriveAt - p.now < 20_000) return;
      }
      throw new Error('набега нет');
    })();
    const save = JSON.parse(p.store.read() as string);
    save.figures.general.troops = { clubman: 110 };
    p.store.write(JSON.stringify(save));
    const q = p.reload();
    const pulse = await until(q, 'бой после загрузки', (x) => x.reports.some((r) => r.id.endsWith('-defense')));
    const fight = pulse.reports.find((r) => r.id.endsWith('-defense')) as Report;
    expect(fight.battle?.troops.defender, 'у частокола четырнадцать, а не сто четырнадцать').toEqual({ clubman: 14 });
    // Сверка режет дружину до того, что есть у племени, — до всех четырнадцати; бой
    // забирает павших, и в гарнизоне остаются уцелевшие, по разу каждый, и все они — дружина.
    const lost = troopTotal(pulse.effects.find((e) => e.id.endsWith('-defense'))?.lostTroops ?? {});
    expect(troopTotal((await q.general()).troops)).toBe(14 - lost);
    expect(homeOf(q.s.army, awayOf(q.marches, q.figures))).toEqual(14 - lost > 0 ? { clubman: 14 - lost } : {});
  }, 60_000);
});
