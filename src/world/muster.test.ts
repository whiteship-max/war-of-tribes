import { describe, expect, it } from 'vitest';
import { SECTORS, UNIT_KINDS, stackTotal, type ArmySetup, type Stack } from '@/battle';
import { createInitialState } from '@/game/state';
import { deserialize, serialize } from '@/game/save';
import { armySize } from '@/game/derived';
import { seeded } from '@/game/sim/random';
import { TROOP_IDS } from '@/game/data/troops';
import { kindsOf, troopTotal, type TroopStack } from '@/game/battle/kinds';
import { presetFormation, toArmySetup } from '@/game/battle/formation';
import type { GameState, TroopId } from '@/game/types';
import { LocalWorld } from './local/LocalWorld';
import { applyEffects, playerProfile, syncAway } from './bridge';
import { NOBODY_AWAY, awayMen, awayOf, homeOf, weakest } from './muster';
import { fitSetup } from './battle';
import { distance } from './geo';
import type { FigureView, MarchView, PlayerProfile, Report, SettlementView, WorldPulse } from './types';

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

describe('кто из дружины дома — одно правило', () => {
  it('войско при полководце не дома ни в одной фазе, чужие отряды не в счёт', () => {
    for (const phase of ['home', 'moving', 'field', 'down'] as const) {
      const general = { phase, troops: { clubman: 10, archer: 4 } };
      const away = awayOf([march({ own: false, units: { warrior: 99 } })], [general]);
      expect(away.troops, `полководец в фазе ${phase}: его дружина не дома`).toEqual({ clubman: 10, archer: 4 });
      expect(away.loose, 'чужой отряд в свои ушедшие не пишется').toBe(0);
      expect(homeOf({ clubman: 10, archer: 10 }, away), `фаза ${phase}: дома только лучники`).toEqual({ archer: 6 });
    }
  });

  it('отряд без состава снимается со слабых, и гарнизон не бывает отрицательным', () => {
    const away = awayOf([march({ units: { warrior: 7 } })], [{ troops: { legionary: 50 } }]);
    expect(awayMen(away)).toBe(57);
    // Дубинщиков пять, копейщиков трое: семерых без имени снимают со слабого конца.
    expect(homeOf({ clubman: 5, spearman: 3, legionary: 20 }, away)).toEqual({ spearman: 1 });
    expect(weakest({ archer: 2, clubman: 1 }, 2)).toEqual({ clubman: 1, archer: 1 });
    expect(homeOf({}, away), 'в мире числится больше, чем есть: дома просто никого').toEqual({});
    expect(homeOf({ rider: 3 }, NOBODY_AWAY)).toEqual({ rider: 3 });
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
    // Выше порога набегов: по деревне в тридцать душ набеги не ходят вовсе. Без
    // набегов последовательность приказов не упирается в лагерь под стенами.
    if (raids) s.pop = 200;
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
    return next;
  }

  get now(): number {
    return this.clock.now;
  }

  async general(): Promise<FigureView> {
    return (await this.world.figures()).find((f) => f.id === 'general') as FigureView;
  }

  async pulse(step: string): Promise<WorldPulse> {
    // Кто в эту минуту при полководце и сколько войска у племени — до пульса:
    // бой пульса считался из них.
    const held = (await this.general()).troops;
    const army: TroopStack = { ...this.s.army };
    const profile = { ...playerProfile(this.s, awayOf(this.marches, this.figures)), ...(this.over ?? {}) };
    const pulse = await this.world.sync(profile);
    if (pulse.effects.length > 0) applyEffects(this.s, pulse.effects);
    syncAway(this.s, pulse.marches, pulse.figures);
    this.marches = pulse.marches;
    this.figures = pulse.figures;
    for (const r of pulse.reports) this.fought(r, step, army, held);
    holds(this, step);
    return pulse;
  }

  /** Бой из отчёта: в строю не больше, чем стояло там, откуда выходили. */
  fought(r: Report, step: string, army: TroopStack, held: TroopStack): void {
    const b = r.battle;
    if (!b) return;
    this.battles++;
    const us = b.troops[b.us];
    const initial = b.result.sides[b.us].initial;
    const kinds = kindsOf(us);
    const sortie = r.id.startsWith('sortie');
    const atHome = b.us === 'defender' || sortie;
    for (const id of TROOP_IDS) {
      const pool = atHome ? (army[id] ?? 0) - (held[id] ?? 0) : (army[id] ?? 0);
      expect(us[id] ?? 0, `${step}: «${r.title}» — ${id} в строю больше, чем ${atHome ? 'стояло дома' : 'было у племени'}`).toBeLessThanOrEqual(Math.max(0, pool));
    }
    const militia = b.militia?.[b.us] ?? { men: 0, archers: 0 };
    kinds.infantry += militia.men - militia.archers;
    kinds.archer += militia.archers;
    for (const k of UNIT_KINDS) {
      expect(initial[k], `${step}: «${r.title}» — ядро поставило в строй ${k} сверх записанного состава`).toBeLessThanOrEqual(kinds[k]);
    }
  }

  async setGarrison(t: TroopStack | null, step: string): Promise<string | null> {
    const err = await this.world.setGarrison(t);
    if (!err) this.taken++;
    await this.pulse(step);
    return err;
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
    const g = await this.general();
    while (this.now < g.readyAt) {
      this.clock.now = Math.min(g.readyAt, this.now + 20_000);
      await this.pulse(step);
    }
    await this.pulse(step);
  }

  async walk(to: { x: number; y: number }, step: string): Promise<string | null> {
    const err = await this.world.moveFigure('general', to);
    await this.pulse(step);
    if (err) return err;
    const g = await this.general();
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
 * племени, дома — ровно остальные, и племя считает ушедших тем же правилом, что
 * и мир. Проверяется после каждого пульса каждой последовательности.
 */
function holds(p: Party, step: string): void {
  const away = awayOf(p.marches, p.figures);
  for (const id of TROOP_IDS) {
    expect(away.troops[id] ?? 0, `${step}: ${id} при полководце и в походах больше, чем есть у племени`).toBeLessThanOrEqual(p.s.army[id]);
  }
  expect(troopTotal(homeOf(p.s.army, away)) + awayMen(away), `${step}: дома и в поле вместе не всё войско`).toBe(armySize(p.s));
  expect(p.s.warriorsAway, `${step}: племя считает ушедших не тем правилом, что мир`).toBe(awayMen(away));
}

/** Честный приказ — ровно тот, что даст панель: всех, кто дома, плюс тех, кто уже при нём. */
const honest = (p: Party, g: FigureView): TroopStack => {
  const home = homeOf(p.s.army, awayOf(p.marches, p.figures));
  const out: TroopStack = {};
  for (const id of TROOP_IDS) {
    const n = (home[id] ?? 0) + (g.troops[id] ?? 0);
    if (n > 0) out[id] = n;
  }
  return out;
};

const doubled = (t: TroopStack): TroopStack =>
  Object.fromEntries(Object.entries(t).map(([k, n]) => [k, (n ?? 0) * 2])) as TroopStack;

const plus = (a: TroopStack, b: TroopStack): TroopStack => {
  const out: TroopStack = {};
  for (const id of TROOP_IDS) {
    const n = (a[id] ?? 0) + (b[id] ?? 0);
    if (n > 0) out[id] = n;
  }
  return out;
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
        await p.settle(`${tag}: сбор идёт`);
        await again();
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
    const res = await p.world.attack({ setup: null });
    expect(res.error).toBeNull();
    const report = (await p.world.reports()).find((r) => r.id === res.reportId);
    expect(report?.battle?.result.sides.attacker.total.initial, 'в строю ядра десять, а не сто десять').toBe(10);
    await p.pulse('после боя');
  }, 60_000);

  it('случайные приказы, найм, бои и загрузки на трёх мирах', async () => {
    const kinds: TroopId[] = ['clubman', 'spearman', 'archer', 'rider', 'legionary'];
    let taken = 0;
    let battles = 0;
    for (const seed of [11, 42, 101]) {
      const rng = seeded(seed * 7919);
      let p = Party.start(seed, { clubman: 12, spearman: 8, archer: 6, legionary: 3 });
      await p.pulse('старт');
      const info = await p.world.info();
      const lair = await p.lair();
      for (let i = 0; i < 60; i++) {
        const step = `мир ${seed}, шаг ${i}`;
        const roll = rng();
        if (roll < 0.25) {
          // Передача бывает только дома: из поля полководец сначала возвращается.
          // Приказы — от честного до наглого, и принятый не должен нарушить правило.
          if ((await p.general()).phase === 'field') await p.walk(info.home, `${step}: домой за дружиной`);
          const g = await p.general();
          const asks = [honest(p, g), doubled(g.troops), plus(g.troops, p.s.army), { ...p.s.army }, weakest(honest(p, g), 5)];
          await p.setGarrison(asks[Math.floor(rng() * asks.length)], `${step}: передача`);
        } else if (roll < 0.32) {
          if ((await p.general()).phase === 'field') await p.walk(info.home, `${step}: домой распускать`);
          await p.setGarrison(null, `${step}: роспуск`);
        } else if (roll < 0.42) {
          await p.settle(`${step}: ждём передачу`);
        } else if (roll < 0.57) {
          // Поход на логово целиком: дождаться дружины, дойти, ударить.
          await p.settle(`${step}: сбор перед походом`);
          await p.walk(lair, `${step}: к логову`);
          const res = await p.world.attack({ setup: null });
          await p.pulse(`${step}: удар${res.error ? ` (${res.error})` : ''}`);
        } else if (roll < 0.63) {
          await p.walk({ x: info.home.x + 4, y: info.home.y + 3 }, `${step}: в поле`);
        } else if (roll < 0.69) {
          await p.walk(info.home, `${step}: домой`);
        } else if (roll < 0.77) {
          const id = kinds[Math.floor(rng() * kinds.length)];
          p.s.army[id] += 1 + Math.floor(rng() * 5);
          await p.pulse(`${step}: наняли ${id}`);
        } else if (roll < 0.85) {
          p = p.reload();
          await p.pulse(`${step}: загрузка`);
        } else {
          await p.idle(Math.floor(rng() * 6 + 1) * MIN, `${step}: время идёт`);
        }
      }
      taken += p.taken;
      battles += p.battles;
    }
    // Последовательность, в которой мир ничего не принял и никто не бился, правила не проверила.
    expect(taken, 'передачи дружины проходили').toBeGreaterThanOrEqual(10);
    expect(battles, 'бои случались').toBeGreaterThanOrEqual(5);
  }, 120_000);

  /** Ждать, пока в пульсе не случится нужное: пульс каждые двадцать секунд. */
  const until = async (p: Party, step: string, done: (pulse: WorldPulse) => boolean): Promise<WorldPulse> => {
    for (let i = 0; i < 3000; i++) {
      p.clock.now += 20_000;
      const pulse = await p.pulse(step);
      if (done(pulse)) return pulse;
    }
    throw new Error(`${step}: так и не дождались`);
  };

  it('вылазка выходит из гарнизона, а голод рассеивает гарнизон — дружина при полководце цела', async () => {
    // Мир 11: первый же набег на крепкую для него деревню садится лагерем.
    const p = Party.start(11, { clubman: 14 });
    await p.pulse('старт');
    expect(await p.setGarrison({ clubman: 10 }, 'сбор')).toBeNull();
    await p.settle('сбор');
    await until(p, 'ждём лагерь', (pulse) => Boolean(pulse.siege));
    const sortie = async (t: TroopStack): Promise<string | null> => {
      const res = await p.world.sortie(t);
      await p.pulse(`вылазка ${JSON.stringify(t)}`);
      return res.error ?? 'вылазка принята';
    };
    expect(await sortie({ clubman: 10 }), 'дружина при полководце на вылазку не выходит').toMatch(/дома нет/);
    expect(await sortie({ ...p.s.army }), 'всем войском — тоже').toMatch(/дома нет/);
    await until(p, 'ждём голода', (pulse) => pulse.reports.some((r) => r.title === 'Хлеб кончился'));
    expect(troopTotal((await p.general()).troops), 'дружина при полководце цела').toBe(10);
    expect(p.s.army.clubman, 'рассеялась половина гарнизона — двое из четырёх').toBe(12);

    // Мир 101: гарнизон выходит, и бой ставит в строй ровно его.
    const q = Party.start(101, { clubman: 14 });
    await q.pulse('старт');
    expect(await q.setGarrison({ clubman: 10 }, 'сбор')).toBeNull();
    await q.settle('сбор');
    await until(q, 'ждём лагерь', (pulse) => Boolean(pulse.siege));
    const battles = q.battles;
    const res = await q.world.sortie({ clubman: 4 });
    expect(res.error, 'гарнизон выходит').toBeNull();
    await q.pulse('после вылазки');
    expect(q.battles, 'вылазка дошла до боя и прошла проверку состава').toBe(battles + 1);
  }, 60_000);

  it('павших мир списывает сразу: убитого на вылазке не выпустить второй раз ни до пульса, ни после', async () => {
    const p = Party.start(11, { clubman: 14 });
    await p.pulse('старт');
    expect(await p.setGarrison({ clubman: 10 }, 'сбор')).toBeNull();
    await p.settle('сбор');
    await until(p, 'ждём лагерь', (pulse) => Boolean(pulse.siege));
    // Один дубинщик против готового лагеря: не возвращается, а лагерь стоит.
    const first = await p.world.sortie({ clubman: 1 });
    expect(first.error).toBeNull();
    expect(first.won, 'лагерь устоял').toBe(false);
    expect((await p.world.reports()).find((r) => r.id === first.reportId)?.lost.warrior, 'вылазка стоила человека').toBe(1);
    // До пульса: племя о павшем ещё не знает, а мир — уже.
    const before = await p.world.sortie({ clubman: 4 });
    expect(before.error ?? 'вылазка принята', 'павшего до пульса второй раз не выпустить').toMatch(/дома нет/);
    // После пульса: слепок собран до того, как племя списало павшего.
    await p.pulse('после вылазки');
    const after = await p.world.sortie({ clubman: 4 });
    expect(after.error ?? 'вылазка принята', 'и после пульса тоже').toMatch(/дома нет/);
    await p.pulse('после второй попытки');
  }, 60_000);

  it('запертая расстановка не ставит к частоколу тех, кого после отметки отдали полководцу', async () => {
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
    expect(frozenRaid() ?? JSON.parse(p.store.read() as string).frozenDefense?.marchId, 'бились по запертой').toBe(raid);
    expect(fight.battle, 'это бой, а не лагерь').toBeTruthy();
    expect(troopTotal(fight.battle!.troops.defender), 'у частокола дружины нет').toBe(0);
    // Сам состав ядра проверил пульс (`fought`): ополчение — да, дубинщики — нет.
    expect(stackTotal(fight.battle!.result.sides.defender.initial)).toBeLessThanOrEqual(fight.battle!.militia!.defender.men);
  }, 60_000);

  it('сохранение, где дружину успели удвоить, сверяется на первом же пульсе', async () => {
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
    expect(homeOf(q.s.army, awayOf(q.marches, q.figures)), 'лучники дома не пропали').toEqual({ archer: 10 });
  }, 60_000);
});
