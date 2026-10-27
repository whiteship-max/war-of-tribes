// Дух дружины (ДР-1, docs/siege_v2.md, «Решения ДР-1»): мораль и дисциплина одной дверью (`sim/spirit`), жалованье — полное или
// минимальное — дверью содержания войска (`sim/upkeep.setWageMode`), числа и формулы — `game/spiritrules`.
//
// Области (правило 11) названы и проверены утверждениями в каждом тесте: жалованье полное или минимальное, доля восстановления
// на краю или в пути, терпение идёт или нет, шкала не у края (иначе прибавка срезана и тест зелёный даром).
import { describe, expect, it } from 'vitest';
import type { GameState } from '../types';
import { createInitialState } from '../state';
import { deserialize, serialize } from '../save';
import { DAY_LENGTH } from '../constants';
import { gameSeconds } from '../pace';
import { armyResolve, armyWagesPerDay, payGraceDays, troopWage, wageOf } from '../derived';
import {
  GLORY_CAP,
  GLORY_HALF_MS,
  GLORY_LOSS,
  GLORY_WIN,
  SPIRIT_FLOOR,
  SPIRIT_TOP,
  WAGE_FALL_MS,
  WAGE_MIN_SHARE,
  WAGE_RECOVER_MS,
  payLeftMs,
  payShareAt,
  resolvePoints,
  spiritOfIn,
  type SpiritIn,
} from '../spiritrules';
import { gloryNow, noteBattle, payShare, spiritIn, spiritOf, spiritView, wageMode } from './spirit';
import { dismissCheck, mergeWage, setWageMode, upkeepTick } from './upkeep';
import { playerProfile } from '@/world/bridge';
import { seeded } from './random';

const HOUR = 3600_000;

/** Партия с дружиной и полной казной: платить есть чем. */
function party(): GameState {
  const s = createInitialState();
  s.army.spearman = 60;
  s.army.archer = 20;
  s.gold = 1e7;
  return s;
}

/** Сдвинуть часы партии на `ms` настоящего времени. */
const after = (s: GameState, ms: number): void => {
  s.time += gameSeconds(ms / 1000);
};

describe('старая партия: дух по нынешнему состоянию, жалованье полное', () => {
  it('запись без жалованья и памяти боёв читается полным жалованьем, дух — тот же, что у этой партии сейчас', () => {
    const s = party();
    const was = spiritOf(s);
    const raw = JSON.parse(serialize(s)) as Record<string, unknown> & { pay: Record<string, unknown> };
    delete raw.pay.wage;
    delete raw.pay.paid;
    delete raw.spirit;
    const back = deserialize(JSON.stringify(raw))!;
    expect(back, 'партия читается').not.toBeNull();
    expect(wageMode(back)).toBe('full');
    expect(payShare(back)).toBe(1);
    expect(gloryNow(back)).toBe(0);
    expect(spiritOf(back)).toEqual(was);
    expect(back.pay.wage).toBeUndefined();
  });

  it('мусор вместо жалованья — полное, давно; целое — как есть', () => {
    expect(mergeWage({ wage: { mode: 'half', since: 0, from: 1 } })).toEqual({});
    expect(mergeWage({ wage: { mode: 'min', since: 'x', from: 1 } })).toEqual({});
    expect(mergeWage({ wage: { mode: 'min', since: 5, from: 3 }, paid: 12.5 })).toEqual({ wage: { mode: 'min', since: 5, from: 1 }, paid: 12.5 });
  });

  it('смена жалованья и память боёв переживают запись и чтение', () => {
    const s = party();
    setWageMode(s, 'min');
    noteBattle(s, true);
    const back = deserialize(serialize(s))!;
    expect(back.pay.wage).toEqual(s.pay.wage);
    expect(back.spirit).toEqual(s.spirit);
  });
});

describe('жалованье: минимальное дешевле и ведёт дух к дну, полное возвращает за шесть настоящих часов', () => {
  it('минимальное: казна платит долю WAGE_MIN_SHARE, мастеров и совета это не касается', () => {
    const s = party();
    const full = armyWagesPerDay(s);
    expect(full, 'дружина есть').toBeGreaterThan(0);
    expect(setWageMode(s, 'min')).toBeNull();
    expect(armyWagesPerDay(s)).toBeCloseTo(full * WAGE_MIN_SHARE, 9);
    expect(troopWage(s, 'spearman')).toBeCloseTo(wageOf(s, 'spearman') * WAGE_MIN_SHARE, 12);
    expect(dismissCheck(s, 'spearman', 10).saves).toBeCloseTo(10 * wageOf(s, 'spearman') * WAGE_MIN_SHARE, 9);
    expect(setWageMode(s, 'min'), 'второй раз то же — отказ').not.toBeNull();
  });

  it('дух на минимальном падает к дну за WAGE_FALL_MS и лежит там', () => {
    const s = party();
    const top = spiritView(s);
    // Точка внутри области: дух не на дне.
    expect(top.morale.value).toBeGreaterThan(SPIRIT_FLOOR + 10);
    setWageMode(s, 'min');
    after(s, WAGE_FALL_MS / 2);
    const mid = spiritView(s);
    expect(mid.morale.value).toBeLessThan(top.morale.value);
    expect(mid.morale.value).toBeGreaterThan(SPIRIT_FLOOR);
    after(s, WAGE_FALL_MS / 2);
    expect(payShare(s)).toBe(0);
    expect(spiritView(s).morale.value).toBe(SPIRIT_FLOOR);
    expect(spiritView(s).discipline.value).toBe(SPIRIT_FLOOR);
  });

  it('вернул полное — от дна до потолка ровно за WAGE_RECOVER_MS (~6 ч), не убывая и не раньше', () => {
    expect(WAGE_RECOVER_MS, 'шесть настоящих часов').toBe(6 * HOUR);
    const s = party();
    setWageMode(s, 'min');
    after(s, WAGE_FALL_MS);
    expect(payShare(s), 'с дна').toBe(0);
    setWageMode(s, 'full');
    const ceil = spiritView(s).morale.ceil;
    let last = -1;
    for (let t = 0; t <= WAGE_RECOVER_MS; t += 15 * 60_000) {
      const v = spiritView(s).morale.value;
      expect(v, `${t / 60_000} мин: не убывает`).toBeGreaterThanOrEqual(last);
      if (t < WAGE_RECOVER_MS) expect(v, `${t / 60_000} мин: ещё не потолок`).toBeLessThan(ceil);
      last = v;
      if (t < WAGE_RECOVER_MS) after(s, 15 * 60_000);
    }
    expect(spiritView(s).morale.value).toBeCloseTo(ceil, 9);
    expect(payLeftMs('full', payShare(s))).toBe(0);
  });

  it('смена на середине пути начинает с середины, а не с края', () => {
    const s = party();
    setWageMode(s, 'min');
    after(s, WAGE_FALL_MS);
    setWageMode(s, 'full');
    after(s, 3 * HOUR);
    const mid = payShare(s);
    expect(mid, 'в пути').toBeGreaterThan(0.2);
    expect(mid).toBeLessThan(1);
    setWageMode(s, 'min');
    expect(payShare(s)).toBeCloseTo(mid, 12);
    setWageMode(s, 'full');
    expect(payShare(s)).toBeCloseTo(mid, 12);
    // Остаток пути — по той же кривой: с середины до потолка меньше шести часов.
    expect(payLeftMs('full', mid)).toBeLessThan(WAGE_RECOVER_MS);
    expect(payShareAt('full', mid, payLeftMs('full', mid))).toBeCloseTo(1, 9);
  });
});

describe('неуплата — та же дверь: терпение кончилось — дух на дне, бойцы уходят', () => {
  it('долг дольше терпения Статуи: полное жалованье, а дух на дне', () => {
    const s = party();
    s.gold = 0;
    s.pay.debt = 1000;
    s.pay.late = payGraceDays(s) * DAY_LENGTH;
    // Точка внутри области: жалованье полное и восстановлено — дух держит только терпение.
    expect(wageMode(s)).toBe('full');
    expect(payShare(s)).toBe(1);
    const v = spiritView(s);
    expect(v.morale.value).toBe(SPIRIT_FLOOR);
    expect(v.discipline.value).toBe(SPIRIT_FLOOR);
    expect(v.morale.lines.find((l) => l.id === 'patience')!.value).toBeLessThan(0);
    // Уход — прежней дверью содержания: за игровой день дружина редеет.
    const men = (s.army.spearman ?? 0) + (s.army.archer ?? 0);
    upkeepTick(s, DAY_LENGTH, 0);
    expect((s.army.spearman ?? 0) + (s.army.archer ?? 0)).toBeLessThan(men);
  });

  it('уплаченное считается счётом партии — для книги духа сервера', () => {
    const s = party();
    s.pay.from = 0;
    const due = armyWagesPerDay(s);
    upkeepTick(s, DAY_LENGTH, 0);
    expect(s.pay.paid ?? 0).toBeCloseTo(due, 6);
  });
});

describe('победы и поражения', () => {
  it('победа прибавляет, поражение отнимает больше; память тает вдвое за GLORY_HALF_MS', () => {
    const s = party();
    const base = spiritView(s).morale.value;
    // Точка внутри области: шкала не у края — прибавка видна целиком.
    expect(base + GLORY_WIN).toBeLessThan(SPIRIT_TOP);
    expect(base - GLORY_LOSS).toBeGreaterThan(SPIRIT_FLOOR);
    noteBattle(s, true);
    expect(spiritView(s).morale.value).toBeCloseTo(base + GLORY_WIN, 9);
    after(s, GLORY_HALF_MS);
    expect(gloryNow(s)).toBeCloseTo(GLORY_WIN / 2, 9);
    noteBattle(s, false);
    expect(gloryNow(s)).toBeCloseTo(GLORY_WIN / 2 - GLORY_LOSS, 9);
    for (let i = 0; i < 10; i++) noteBattle(s, false);
    expect(gloryNow(s)).toBe(-GLORY_CAP);
  });
});

describe('строки «что влияет»: сумма — значение, каждая причина двигает шкалу в свою сторону', () => {
  const base: SpiritIn = { stab: 0, patience: 0, unfed: 0, glory: 0, rite: 0, marshal: 0, knights: 0, merchants: 0, general: 1, barracks: 1, statue: 0, pay: 1 };

  it('сумма строк — значение, на решётке причин', () => {
    const rnd = seeded(77);
    for (let i = 0; i < 400; i++) {
      const v = spiritOfIn({
        stab: Math.floor(rnd() * 7) - 3,
        patience: rnd() * 100,
        unfed: rnd(),
        glory: (rnd() * 2 - 1) * GLORY_CAP,
        rite: rnd() * 20,
        marshal: rnd() * 12,
        knights: rnd() * 18,
        merchants: rnd() * 0.25,
        general: rnd() < 0.2 ? null : 1 + Math.floor(rnd() * 5),
        barracks: Math.floor(rnd() * 11),
        statue: rnd() * 6,
        pay: rnd(),
      });
      for (const a of [v.morale, v.discipline]) {
        expect(a.lines.reduce((n, l) => n + l.value, 0)).toBeCloseTo(a.value, 9);
        expect(a.value).toBeGreaterThanOrEqual(SPIRIT_FLOOR);
        expect(a.value).toBeLessThanOrEqual(SPIRIT_TOP);
      }
    }
  });

  it('без причин — основа: ровно нейтраль боя', () => {
    const v = spiritOfIn(base);
    expect(v.morale.value).toBe(70);
    expect(v.discipline.value).toBe(70);
  });

  it('каждая причина — в свою сторону и не мимо шкалы', () => {
    const at = (over: Partial<SpiritIn>) => spiritOfIn({ ...base, ...over });
    const v0 = at({});
    // Точки внутри области: основа далеко от краёв.
    expect(v0.morale.value).toBeGreaterThan(20);
    expect(v0.morale.value).toBeLessThan(80);
    expect(at({ stab: 2 }).morale.value).toBeGreaterThan(v0.morale.value);
    expect(at({ stab: -2 }).discipline.value).toBeLessThan(v0.discipline.value);
    expect(at({ glory: 6 }).morale.value).toBeGreaterThan(v0.morale.value);
    expect(at({ unfed: 0.5 }).morale.value).toBeLessThan(v0.morale.value);
    expect(at({ patience: 50 }).discipline.value).toBeLessThan(v0.discipline.value);
    expect(at({ marshal: 5 }).morale.value).toBeGreaterThan(v0.morale.value);
    expect(at({ marshal: 5 }).discipline.value).toBeGreaterThan(v0.discipline.value);
    expect(at({ rite: 5, merchants: 0.2 }).morale.value).toBeLessThan(at({ rite: 5 }).morale.value);
    expect(at({ general: 4 }).discipline.value).toBeGreaterThan(v0.discipline.value);
    expect(at({ general: null }).discipline.value).toBeLessThan(v0.discipline.value);
    expect(at({ barracks: 6 }).discipline.value).toBeGreaterThan(v0.discipline.value);
    expect(at({ statue: 3 }).morale.value, 'Статуя Героя — мораль (ДР-7)').toBeGreaterThan(v0.morale.value);
    expect(at({ statue: 3 }).discipline.value, 'дисциплины Статуя не трогает').toBe(v0.discipline.value);
    expect(at({ statue: 3, merchants: 0.2 }).morale.value, 'купцы памятник не режут').toBe(at({ statue: 3 }).morale.value);
    expect(at({ pay: 0.5 }).morale.value).toBeLessThan(v0.morale.value);
  });

  it('стойкость — одной дверью: строки обряда, Воеводы, рыцарей и купцов вместе — ровно `resolvePoints(armyResolve)`', () => {
    const RES = ['rite', 'marshal', 'knights', 'merchants'];
    const sumOf = (lines: { id: string; value: number }[]): number => lines.filter((l) => RES.includes(l.id)).reduce((n, l) => n + l.value, 0);
    const rnd = seeded(5);
    for (let i = 0; i < 200; i++) {
      const p = { rite: rnd() * 15, marshal: rnd() * 12, knights: rnd() * 18, merchants: rnd() * 0.3 };
      const v = spiritOfIn({ ...base, ...p, pay: 1 });
      expect(sumOf(v.morale.lines)).toBeCloseTo(resolvePoints((p.rite + p.marshal + p.knights) * (1 - p.merchants)), 9);
    }
    // Партия с идущим обрядом языческого храма: стойкость есть — точка внутри области.
    const s = party();
    s.faith = { ...s.faith, id: 'pagan', riteUntil: s.time + 1 };
    expect(armyResolve(s), 'стойкость есть').toBeGreaterThan(0);
    expect(sumOf(spiritView(s).morale.lines)).toBeCloseTo(resolvePoints(armyResolve(s)), 9);
  });

  it('дух партии — та же формула от тех же чисел, что видит окно и едет в мир', () => {
    const s = party();
    expect(spiritView(s)).toEqual(spiritOfIn(spiritIn(s)));
    const p = playerProfile(s);
    expect(p.spirit).toEqual(spiritOf(s));
  });
});
