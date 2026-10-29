// Партия и фаза бродяги (ПН-1, docs/gdd/path_of_sword.md, 6.1–6.1.2 и 3.3; «Решения ПН-1»): диспетчер шага по фазе, содержание
// отряда, уход равной долей, обоз и его вместимость, фураж по сезону, раненые без лазарета, дух отряда.
//
// Выключатель Пути меча здесь включён подменой модуля (`vi.mock`), а не правкой `ROAM_ON`: что он выключен у игроков и что
// выключенный не пускает фазу, держит `roamflag.test.ts`. Каждая точка сначала утверждает, что она внутри области своего правила:
// отряд в фазе бродяги, кошель полон или пуст, обоз сыт или пуст, терпение кончилось или нет, сезон — тот, о котором речь.
import { describe, expect, it, vi } from 'vitest';
import type { GameState, TroopId } from '../types';
import { createInitialState } from '../state';
import { deserialize } from '../save';
import { DAY_LENGTH, FREE_RANGE_MULT, MAX_OFFLINE_DAYS, SOLDIER_FOOD, TEST_ARMY_FOOD, WOUND_DAYS } from '../constants';
import { TROOP_BY_ID, TROOP_IDS } from '../data/troops';
import { YARDS } from '../data/yards';
import { SEASONS, SEASON_MODIFIERS, SEASON_SECONDS, YEAR_DAYS } from '../data/seasons';
import { TAX_PER_POP } from '../data/policy';
import { DESERT_SHARE, WAGE_GEAR, WAGE_HEAD, WAGE_MAN } from '../data/upkeep';
import { GENERAL_DRILL, HUNGER_MORALE, WAGE_MIN_SHARE } from '../spiritrules';
import { seasonOf, yearOf } from '../derived';
import { bandPatienceDays, fieldForage, forageShare } from '../roamrules';
import { GAIT_HAUL, GAITS } from '@/world/data/gait';
import { UNIT_BY_ID } from '@/world/data/units';
import { AWAY_AFTER, CATCHUP_STEP, absence, awayGameSeconds, liveStep } from './tick';
import { beginRoam, cargoCap, mergeRoam, roamFor, setMove } from './roam';
import { standWay } from '@/world/roammove';
import { freshMark } from '@/world/energy';
import { addStock } from './stock';
import { layBandWounds } from './bandwounds';
import { spiritView } from './spirit';
import { setWageMode } from './upkeep';
import { gameSeconds } from '../pace';
// Кусок пути (ПН-5, хвост а): у админа он докачан до первой партии бродяги — тест держит его так же (`game/roamlazy`).
import '../roamdoor';

vi.mock('../roamflag', () => ({ ROAM_ON: true, roamOpenFor: () => true, roamOn: () => true, setRoamOpen: () => {} }));

/** Отряд бродяги на новой партии: в лагере, весной первого года. */
function roamParty(band: Partial<Record<TroopId, number>>, o: { war?: number; purse?: number; food?: number } = {}): GameState {
  const s = createInitialState(20261029);
  const why = beginRoam(s, { origin: 'warrior', hero: { name: 'Ратко', war: o.war ?? 1 }, band, purse: o.purse ?? 0, food: o.food ?? 0 });
  expect(why, 'вход в путь').toBeNull();
  expect(s.phase).toBe('roam');
  return s;
}

/** Прожить `days` игровых дней отрядом. */
const live = (s: GameState, days: number): void => roamFor(s, days * DAY_LENGTH, CATCHUP_STEP);

/** Жалованье вида по формуле ГДД 3.3.2 — из данных вида, мимо `price.baseWage`. */
const wageFormula = (id: TroopId): number => {
  const d = TROOP_BY_ID[id];
  const things = Object.values(d.gear).reduce((n: number, v) => n + (v ?? 0), 0) + (d.mounted ? 1 : 0);
  return TAX_PER_POP * (WAGE_HEAD + WAGE_MAN * d.grade + WAGE_GEAR * things);
};

/** Фураж сезона по правилу Р4 — из сезона поля, мимо `roamrules`. */
const FIELD = YARDS.find((y) => y.job === 'farmer')!;
const forageFormula = (season: (typeof SEASONS)[number]): number =>
  (FREE_RANGE_MULT * (FIELD.seasons[season] ?? 1)) / Math.max(...SEASONS.map((x) => FIELD.seasons[x] ?? 1));

/** Деревня партии — то, что фаза бродяги не трогает. */
const village = (s: GameState): string =>
  JSON.stringify({ r: s.resources, pop: s.pop, b: s.buildings, a: s.army, g: s.gold, w: s.wounded, i: s.inbox, m: s.morale, e: s.equipment });

describe('фазы и диспетчер шага', () => {
  it('вход в путь делает партию бродягой с отрядом, кошелем и хлебом в обозе — один раз и только с новой партии', () => {
    const s = roamParty({ spearman: 4, clubman: 2 }, { purse: 120, food: 30 });
    expect(s.roam?.band).toEqual({ spearman: 4, clubman: 2 });
    expect(s.roam?.purse).toBe(120);
    expect(s.roam?.cargo.food).toBe(30);
    expect(beginRoam(s, { origin: 'warrior', hero: { name: 'x', war: 1 }, band: {}, purse: 0, food: 0 })).toBe('Партия уже идёт своим путём.');
    const old = createInitialState(1);
    old.time = DAY_LENGTH;
    expect(beginRoam(old, { origin: 'warrior', hero: { name: 'x', war: 1 }, band: {}, purse: 0, food: 0 })).toBe('Путь меча начинают с новой партии.');
    expect(old.phase).toBeUndefined();
  });

  it('живой шаг бродяги идёт шагом отряда: часы и обоз движутся, деревня спит', () => {
    const s = roamParty({ spearman: 10 }, { purse: 1000, food: 500 });
    const before = village(s);
    const t0 = s.time;
    let now = Date.UTC(2026, 9, 1, 12);
    for (let i = 0; i < 120; i++) {
      now += 1000;
      liveStep(s, 1, now);
    }
    expect(s.time - t0).toBeCloseTo(gameSeconds(120), 9);
    expect(s.roam!.cargo.food!, 'отряд ел из обоза').toBeLessThan(500);
    expect(s.roam!.purse, 'и платил из кошеля').toBeLessThan(1000);
    expect(village(s), 'деревня не шагала').toBe(before);
  });

  it('отлучка бродяги — догон шагом отряда под тем же потолком, без вестей посёлка', () => {
    const s = roamParty({ spearman: 10 }, { purse: 1e6, food: 7000 });
    const before = village(s);
    const since = Date.UTC(2026, 9, 1, 12);
    const now = since + 10 * 24 * 3600 * 1000;
    // Граница области: отлучка длиннее порога и упирается в потолок догона.
    expect((now - since) / 1000).toBeGreaterThan(AWAY_AFTER);
    expect(awayGameSeconds(since, now)).toBe(MAX_OFFLINE_DAYS * DAY_LENGTH);
    absence(s, since, now);
    expect(s.time).toBeCloseTo(MAX_OFFLINE_DAYS * DAY_LENGTH, 6);
    expect(village(s), 'ни шага посёлка, ни вестей на столе').toBe(before);
    // Длинный промежуток живого шага — та же отлучка.
    const t = s.time;
    liveStep(s, 3600, now + 3600 * 1000);
    expect(s.time - t).toBeCloseTo(awayGameSeconds(now, now + 3600 * 1000), 6);
  });

  it('партия лорда при включённом пути шагает посёлком, как шагала', () => {
    const s = createInitialState(20261029);
    const food = s.resources.food;
    liveStep(s, 1, Date.UTC(2026, 9, 1, 12));
    expect(s.phase).toBeUndefined();
    expect(s.resources.food, 'посёлок ел').not.toBe(food);
  });
});

describe('содержание отряда — одна дверь sim/upkeep, вход «отряд» (ГДД 3.3.2)', () => {
  it('жалованье за игровой день = формула 3.3.2 на каждом виде; минимальное — долей ДР-1', () => {
    for (const id of TROOP_IDS) {
      const s = roamParty({ [id]: 10 }, { purse: 1e6, food: 5000 });
      live(s, 1);
      // Граница области: кошель полон, долга нет — платят целиком.
      expect(s.pay.debt, id).toBe(0);
      expect(1e6 - s.roam!.purse, id).toBeCloseTo(10 * wageFormula(id), 6);
      const m = roamParty({ [id]: 10 }, { purse: 1e6, food: 5000 });
      expect(setWageMode(m, 'min')).toBeNull();
      live(m, 1);
      expect(1e6 - m.roam!.purse, `${id}, минимальное`).toBeCloseTo(10 * wageFormula(id) * WAGE_MIN_SHARE, 6);
    }
  });

  it('паёк за игровой день = SOLDIER_FOOD на рот, конный — за двоих, за вычетом фуража сезона', () => {
    expect(TEST_ARMY_FOOD, 'паёк при обычных правилах').toBe(1);
    for (const id of TROOP_IDS) {
      const s = roamParty({ [id]: 10 }, { purse: 1e6, food: 5000 });
      expect(seasonOf(s.time)).toBe('spring');
      live(s, 1);
      const mouths = 10 * (TROOP_BY_ID[id].mounted ? 2 : 1);
      expect(5000 - s.roam!.cargo.food!, id).toBeCloseTo(SOLDIER_FOOD * mouths * SEASON_MODIFIERS.spring.food * (1 - forageFormula('spring')), 6);
    }
  });

  it('до конца терпения не уходит никто; терпение — две игр. дн. и по полдня за кружок Военного дела', () => {
    expect(bandPatienceDays(1)).toBe(2.5);
    expect(bandPatienceDays(3)).toBe(3.5);
    const at = (war: number, days: number): number => {
      const s = roamParty({ spearman: 100 }, { war, purse: 0, food: 7e4 });
      live(s, days);
      return 100 - (s.roam!.band.spearman ?? 0);
    };
    expect(at(1, 2.45), 'Военное дело 1, до 2.5 игр. дн.').toBe(0);
    expect(at(1, 3.0), 'Военное дело 1, после 2.5 игр. дн.').toBeGreaterThan(0);
    expect(at(3, 3.0), 'Военное дело 3, до 3.5 игр. дн.').toBe(0);
    expect(at(3, 4.0), 'Военное дело 3, после').toBeGreaterThan(0);
  });

  it('неуплата: уходит DESERT_SHARE в игровой день, равной долей каждого вида, и совсем — крыши нет', () => {
    const start: Partial<Record<TroopId, number>> = { spearman: 200, clubman: 120, rider: 40, archer: 80, legionary: 60 };
    const s = roamParty(start, { purse: 0, food: 7e5 });
    const pop = s.pop;
    const grace = bandPatienceDays(1);
    live(s, grace + 4);
    // Граница области: кошель пуст, долг есть, терпение кончилось, еды вдоволь — повод один, неуплата.
    expect(s.roam!.purse).toBe(0);
    expect(s.pay.debt).toBeGreaterThan(0);
    expect(s.pay.late).toBeGreaterThanOrEqual(grace * DAY_LENGTH);
    expect(s.roam!.cargo.food!).toBeGreaterThan(1000);
    const left = (Object.keys(start) as TroopId[]).map((id) => {
      const n = start[id] ?? 0;
      return { id, share: (n - (s.roam!.band[id] ?? 0)) / n, n };
    });
    for (const a of left) expect(a.share, `${a.id} уходил`).toBeGreaterThan(0);
    // Четыре дня по 15 % в день от того, кто ещё остался (шаг — мал, убыль — непрерывная): 1 − e^(−0.15·4) — у каждого вида, с
    // точностью до одного человека.
    const expected = 1 - Math.exp(-DESERT_SHARE * 4);
    for (const a of left) expect(Math.abs(a.share - expected), `${a.id}: ушло ${a.share}, ждали ${expected}`).toBeLessThanOrEqual(1.5 / a.n);
    expect(s.pop, 'ушедшие жителями не стали').toBe(pop);
    expect(s.log.some((e) => e.group === 'band:desert:rider'), 'летопись называет ушедших').toBe(true);
  });

  it('голод — тот же уход, своим поводом: обоз пуст зимой — уходят голодом, и раненые тоже', () => {
    const s = roamParty({ spearman: 100, clubman: 100 }, { purse: 1e6, food: 0 });
    // Зима второго года: поле мертво, фуража нет, и мягкой первой зимы — тоже.
    s.time = (YEAR_DAYS + 3 * (YEAR_DAYS / 4)) * DAY_LENGTH;
    expect(seasonOf(s.time)).toBe('winter');
    expect(yearOf(s.time)).toBe(2);
    layBandWounds(s, { spearman: 20 });
    live(s, bandPatienceDays(1) + 1);
    expect(s.pay.debt, 'жалованье платят').toBe(0);
    expect((s.roam!.band.spearman ?? 0) + (s.roam!.band.clubman ?? 0)).toBeLessThan(200);
    expect(s.log.some((e) => e.group === 'band:desert:spearman:food')).toBe(true);
    expect(s.log.some((e) => e.group === 'band:desert:spearman'), 'неуплаты нет').toBe(false);
    const hurt = s.roam!.wounded.reduce((n, g) => n + (g.troops.spearman ?? 0), 0);
    expect(hurt, 'раненые уходят той же долей').toBeLessThan(20);
  });
});

describe('обоз — дверь склада с ключом cargo (ГДД 3.3.5)', () => {
  it('вместимость — ноша бойца мира на голову строя, режимом марша', () => {
    const s = roamParty({ spearman: 6, rider: 2 });
    for (const g of GAITS) {
      s.roam!.way = standWay(g);
      expect(cargoCap(s.roam!), g).toBeCloseTo(8 * UNIT_BY_ID.warrior.carry * GAIT_HAUL[g], 9);
    }
    layBandWounds(s, { spearman: 5 });
    s.roam!.way = standWay('normal');
    expect(cargoCap(s.roam!), 'раненых несут — они не везут').toBe(8 * UNIT_BY_ID.warrior.carry);
  });

  it('всё добро разом не выше вместимости, ни один вид не ниже нуля — на тысячах случайных прибавок и убавок', () => {
    const s = roamParty({ spearman: 3 });
    const cap = cargoCap(s.roam!);
    let x = 7;
    const rnd = (): number => ((x = (Math.imul(x, 1103515245) + 12345) >>> 0) / 2 ** 32);
    const ids = ['food', 'wood', 'hides', 'iron'] as const;
    let full = 0;
    for (let i = 0; i < 5000; i++) {
      const r = ids[Math.floor(rnd() * ids.length)];
      const n = (rnd() - 0.4) * cap * 0.6;
      const before = s.roam!.cargo[r] ?? 0;
      const got = addStock(s, r, n, cap, 'cargo');
      const load = Object.values(s.roam!.cargo).reduce((a: number, v) => a + (v ?? 0), 0);
      expect(load).toBeLessThanOrEqual(cap + 1e-6);
      for (const v of Object.values(s.roam!.cargo)) expect(v).toBeGreaterThanOrEqual(0);
      expect((s.roam!.cargo[r] ?? 0) - before).toBeCloseTo(got, 9);
      if (n > 0 && got < n - 1e-9) full++;
    }
    // Граница области: обоз правда упирался в вместимость, а не только наполнялся.
    expect(full).toBeGreaterThan(100);
    expect(s.resources.food, 'склад города не тронут').toBe(createInitialState(1).resources.food);
  });

  it('ушли люди — вместимость упала, лишнее брошено строкой летописи', () => {
    const s = roamParty({ spearman: 10 }, { purse: 0, food: 0 });
    addStock(s, 'wood', 7000, cargoCap(s.roam!), 'cargo');
    expect(s.roam!.cargo.wood).toBe(7000);
    s.roam!.band.spearman = 5;
    addStock(s, 'food', 0, cargoCap(s.roam!), 'cargo');
    expect(s.roam!.cargo.wood).toBeCloseTo(5 * UNIT_BY_ID.warrior.carry, 6);
    expect(s.log.some((e) => e.text.startsWith('Обоз не поднять: брошено'))).toBe(true);
  });
});

describe('фураж по сезону — поле сезона из SEASON_MODIFIERS (ГДД 3.3.4)', () => {
  it('доля пайка: в лучший сезон поля — вполсилы, зимой — ничего; столбец — из таблицы сезонов', () => {
    for (const season of SEASONS) expect(fieldForage(SEASON_MODIFIERS[season]), season).toBeCloseTo(forageFormula(season), 12);
    expect(fieldForage(SEASON_MODIFIERS.autumn)).toBeCloseTo(FREE_RANGE_MULT, 12);
    expect(fieldForage(SEASON_MODIFIERS.winter)).toBe(0);
    expect(fieldForage(SEASON_MODIFIERS.summer)).toBeGreaterThan(fieldForage(SEASON_MODIFIERS.spring));
  });

  it('в открытом лагере и обычным маршем — фураж; налегке и с обозом в пути — нет', () => {
    const m = SEASON_MODIFIERS.summer;
    expect(forageShare(m, { camp: { kind: 'open', since: 0, builders: 0 }, way: standWay('light') })).toBeCloseTo(forageFormula('summer'), 12);
    expect(forageShare(m, { camp: null, way: standWay('normal') })).toBeCloseTo(forageFormula('summer'), 12);
    expect(forageShare(m, { camp: null, way: undefined }), 'места выхода нет — обычный марш').toBeCloseTo(forageFormula('summer'), 12);
    expect(forageShare(m, { camp: null, way: standWay('light') })).toBe(0);
    expect(forageShare(m, { camp: null, way: standWay('train') })).toBe(0);
  });

  it('шаг отряда: осенью из обоза уходит полпайка, зимой второго года — весь паёк', () => {
    const eat = (time: number, camp: boolean): number => {
      // Хлеба — меньше обоза налегке: ничего не брошено, убыль — только паёк.
      const s = roamParty({ spearman: 10 }, { purse: 1e6, food: 3000 });
      s.time = time;
      if (!camp) {
        s.roam!.camp = null;
        s.roam!.way = standWay('light');
      }
      live(s, 1);
      return 3000 - s.roam!.cargo.food!;
    };
    const full = 10 * SOLDIER_FOOD;
    const autumn = 2 * SEASON_SECONDS;
    expect(seasonOf(autumn)).toBe('autumn');
    expect(seasonOf(autumn + DAY_LENGTH)).toBe('autumn');
    expect(eat(autumn, true)).toBeCloseTo(full * (1 - FREE_RANGE_MULT), 6);
    expect(eat(autumn, false), 'налегке в пути фуража нет').toBeCloseTo(full, 6);
    const winter2 = YEAR_DAYS * DAY_LENGTH + 3 * SEASON_SECONDS;
    expect(seasonOf(winter2 + DAY_LENGTH)).toBe('winter');
    expect(eat(winter2, true)).toBeCloseTo(full * SEASON_MODIFIERS.winter.food, 6);
  });
});

describe('раненые без лазарета и дух отряда', () => {
  it('раненые лежат при отряде без мест и встают в строй отряда через WOUND_DAYS', () => {
    const s = roamParty({ spearman: 2 }, { purse: 1e6, food: 5000 });
    expect(layBandWounds(s, { spearman: 30, rider: 4 })).toBe(34);
    live(s, WOUND_DAYS - 0.1);
    expect(s.roam!.band.spearman).toBe(2);
    live(s, 0.2);
    expect(s.roam!.band).toEqual({ spearman: 32, rider: 4 });
    expect(s.roam!.wounded).toEqual([]);
    expect(s.wounded, 'лазарет города пуст').toEqual([]);
  });

  it('дух отряда: дисциплину держит герой, державы и Статуи нет, голод — доля, которую не закрыл фураж', () => {
    const s = roamParty({ spearman: 10 }, { war: 3, purse: 1e6, food: 0 });
    const v = spiritView(s);
    const line = (axis: 'morale' | 'discipline', id: string): number | undefined => v[axis].lines.find((l) => l.id === id)?.value;
    expect(line('discipline', 'general')).toBeCloseTo(GENERAL_DRILL * 2, 9);
    expect(line('morale', 'stab')).toBeUndefined();
    expect(line('morale', 'statue')).toBeUndefined();
    // Весна, лагерь, обоз пуст: голодна доля пайка за вычетом фуража.
    expect(line('morale', 'hunger')).toBeCloseTo(-HUNGER_MORALE * (1 - forageFormula('spring')), 9);
    addStock(s, 'food', 100, cargoCap(s.roam!), 'cargo');
    expect(spiritView(s).morale.lines.find((l) => l.id === 'hunger'), 'хлеб в обозе — голода нет').toBeUndefined();
  });
});

describe('отряд в сохранении', () => {
  it('запись и чтение везут фазу и отряд целиком; чужое — партия лорда', () => {
    const s = roamParty({ spearman: 7, rider: 1 }, { purse: 55, food: 300 });
    layBandWounds(s, { archer: 2 });
    // Ход, лагерь и энергия (ПН-3) — одной дверью записи хода.
    setMove(s, { way: { ...standWay('train', { x: 5, y: 6 }, 1000), until: 1000 }, camp: { kind: 'hidden', since: 1000, builders: 8 }, energy: freshMark(1000, 'camp') });
    const back = deserialize(JSON.stringify(s));
    expect(back?.phase).toBe('roam');
    expect(back?.roam).toEqual(s.roam);
    expect(mergeRoam({ phase: 'roam', roam: { origin: 'king' } })).toEqual({});
    expect(mergeRoam({ phase: 'war' })).toEqual({});
    expect(mergeRoam({ phase: 'lord' })).toEqual({ phase: 'lord' });
    const junk = mergeRoam({
      phase: 'roam',
      roam: { origin: 'taken', band: { spearman: -3, rider: 2.7 }, way: { from: { x: 1, y: 2 }, to: { x: 3, y: 4 }, at: 9, until: 5, gait: 'fly' }, camp: { kind: 'tent' }, cargo: { food: 'x' } },
    }).roam;
    expect(junk).toMatchObject({ band: { rider: 2 }, cargo: {}, camp: null });
    expect(junk?.way, 'режим из записи — из списка, срок — не раньше выхода').toEqual({ from: { x: 1, y: 2 }, to: { x: 3, y: 4 }, at: 9, until: 9 });
  });
});
