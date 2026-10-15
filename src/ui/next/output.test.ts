// Выход двора с разбором (docs/ui_v2.md, раздел 2: «каждая цифра объяснима»; UI-2): строки разбора складываются в тот же
// выход, что кладёт добро на склад (`buildingProduction`), и строки «Прочее» нет.
//
// Область правила — двор с руками на местах: без рук складывать нечего, и тест прошёл бы даром. Каждый множитель выработки хоть в одной партии набора не равен единице — иначе выпавший из разбора
// множитель не дал бы остатка и прошёл бы молча (правило 11); это утверждение стоит в самом тесте.
import { describe, expect, it } from 'vitest';
import type { BuildingTypeId, GameState } from '@/game/types';
import { createInitialState } from '@/game/state';
import { BUILDINGS } from '@/game/data/buildings';
import { BOONS } from '@/game/data/boons';
import { SEASON_SECONDS } from '@/game/data/seasons';
import { buildingOfType, buildingProduction } from '@/game/derived';
import { REST_LABEL } from '@/ui/kit/breakdown';
import { OUTPUT_EPS, yardOutput, type OutputStepId } from './output';
import { yieldsOf } from './hall';

const YARDS = BUILDINGS.map((d) => d.id).filter((t) => yieldsOf(t).length > 0);

/** Партия набора: двор с руками и одним из рычагов выработки, сдвинутым с единицы. */
interface Case {
  name: string;
  set: (s: GameState, type: BuildingTypeId) => void;
}

const season = (i: number) => (s: GameState): void => {
  s.time = i * SEASON_SECONDS + SEASON_SECONDS / 2;
};

const CASES: Case[] = [
  { name: 'весна, ур. 1', set: () => undefined },
  { name: 'ур. 6', set: (s, t) => void (buildingOfType(s, t)!.level = 6) },
  { name: 'лето', set: season(1) },
  { name: 'осень', set: season(2) },
  { name: 'первая зима', set: season(3) },
  { name: 'зима второго года', set: season(7) },
  { name: 'мораль 15', set: (s) => void (s.morale = 15) },
  { name: 'мораль 95', set: (s) => void (s.morale = 95) },
  { name: 'указ «порядок»', set: (s) => void (s.decree = 'order') },
  { name: 'указ «вольница»', set: (s) => void (s.decree = 'freedom') },
  {
    name: 'вера с постами',
    set: (s) => {
      s.faith.id = 'orthodox';
      buildingOfType(s, 'church')!.level = 5;
    },
  },
  {
    name: 'вести на профессию двора',
    set: (s, t) => {
      const job = BUILDINGS.find((d) => d.id === t)!.job!;
      s.boons = BOONS.filter((b) => b.jobs?.[job] !== undefined).map((b) => ({ id: b.id, until: s.time + 1e6 }));
    },
  },
  { name: 'осада', set: (s) => void (s.siege = { byName: 'Альфа', until: s.time + 1e6 }) },
  {
    name: 'невольники на местах',
    set: (s, t) => {
      const b = buildingOfType(s, t)!;
      s.bonded = 6;
      s.bondedWork = { ...(s.bondedWork ?? {}), [b.id]: 4 };
    },
  },
  {
    name: 'всё разом',
    set: (s, t) => {
      for (const c of ['ур. 6', 'зима второго года', 'мораль 15', 'указ «порядок»', 'вера с постами', 'вести на профессию двора', 'осада', 'невольники на местах'])
        CASES.find((x) => x.name === c)!.set(s, t);
    },
  },
];

function party(type: BuildingTypeId, c: Case): GameState {
  const s = createInitialState(7);
  const b = buildingOfType(s, type)!;
  s.workers = { ...s.workers, [b.id]: 5 };
  c.set(s, type);
  return s;
}

describe('выход двора с разбором складывается в выход склада', () => {
  it('дворы есть, и у каждого — ресурсы выработки', () => {
    expect(YARDS.length).toBeGreaterThanOrEqual(7);
    expect(yardOutput(createInitialState(7), buildingOfType(createInitialState(7), 'houses')!)).toBeNull();
  });

  it('строки — тот же выход, что `buildingProduction`, без строки «Прочее»; каждый множитель в наборе не единица', () => {
    const seen = new Set<OutputStepId>();
    let checked = 0;
    let live = 0;
    for (const type of YARDS) {
      for (const c of CASES) {
        const s = party(type, c);
        const b = buildingOfType(s, type)!;
        const out = yardOutput(s, b)!;
        const prod = buildingProduction(s, b);
        // Область: руки на местах — строка рук есть и не ноль. Выход может быть и нулём (осада не пускает за едой,
        // `SIEGE_FOOD_YIELD`), и это не даром: строки рук и осады обязаны тогда погасить друг друга.
        expect(out.steps.some((st) => st.id === 'hands' && out.res.some((r) => (st.add[r] ?? 0) > OUTPUT_EPS)), `${type}, ${c.name}: руки`).toBe(true);
        if (out.res.some((r) => prod[r] > OUTPUT_EPS)) live++;
        for (const st of out.steps) seen.add(st.id);
        expect(out.steps.map((st) => st.label), `${type}, ${c.name}: «Прочее»`).not.toContain(REST_LABEL);
        for (const r of out.res) {
          expect(out.total[r], `${type}, ${c.name}: итог — выход склада`).toBe(prod[r]);
          const sum = out.steps.reduce((a, st) => a + (st.add[r] ?? 0), 0);
          expect(Math.abs(sum - prod[r]), `${type}, ${c.name}, ${r}: строки складываются в итог`).toBeLessThan(OUTPUT_EPS);
        }
        checked++;
      }
    }
    expect(checked).toBe(YARDS.length * CASES.length);
    // Нулевой выход — исключение набора (осада у дворов одной еды), а не правило.
    expect(live).toBeGreaterThan(checked * 0.8);
    // Каждый множитель разбора хоть раз сдвинут с единицы — выпавший дал бы «Прочее» в своей партии.
    for (const id of ['hands', 'bonded', 'level', 'season', 'boon', 'morale', 'faith', 'decree', 'siege'] as const)
      expect(seen.has(id), `множитель «${id}» в наборе`).toBe(true);
  });

  it('множитель в строке — тот, что записан: вклад строки — набранное до неё × (множитель − 1)', () => {
    const s = party('farm', CASES.find((c) => c.name === 'всё разом')!);
    const out = yardOutput(s, buildingOfType(s, 'farm')!)!;
    let run = 0;
    for (const st of out.steps) {
      const add = st.add.food ?? 0;
      if (st.factor !== null && st.id !== 'bonded') expect(add).toBeCloseTo(run * (st.factor - 1), 6);
      run += add;
    }
    expect(run).toBeCloseTo(out.total.food!, 6);
  });

  it('без рук строк нет, выход ноль', () => {
    const s = createInitialState(7);
    const b = buildingOfType(s, 'quarry')!;
    s.workers = { ...s.workers, [b.id]: 0 };
    const out = yardOutput(s, b)!;
    expect(out.steps).toEqual([]);
    expect(out.total.stone).toBe(0);
  });
});
