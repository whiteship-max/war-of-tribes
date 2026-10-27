// ДР-7 (docs/city_v3.md, «Решения ДР-7»): Статуя Героя — памятник без связи с полководцем: мораль дружины строкой духа (ДР-1) и
// тихий сдвиг стабильности (СБ-1), с ростом по уровню, числами одной двери `statuerules`; вещи — только на правителе: надетое на
// агентов в старых сохранениях снимается при чтении без потерь, одной строкой летописи.
//
// Граница области (правило 11): уровни Статуи 1…вершина; партия на «Ладе» и ниже, не в осаде; шкала морали не упирается в
// верх (основа 70 + вершина Статуи — ниже 100) — утверждается в самом тесте.
import { describe, expect, it } from 'vitest';
import { createInitialState } from './state';
import { deserialize, enter, serialize } from './save';
import { buildingOfType, maxLevelFor } from './derived';
import { STATUE_MORALE_TOP, STATUE_TOP, statueCalm, statueMorale } from './statuerules';
import { GLORY_CAP, HUNGER_MORALE, SPIRIT_BASE, SPIRIT_TOP, STAB_MORALE, resolvePoints } from './spiritrules';
import { STAB_CALM, STAB_MAX, battleShock } from './stabrules';
import { giftCeil } from './councilrules';
import { FERVOUR_SCALE, ESTATE_PLUS } from './estaterules';
import { spiritIn, spiritView } from './sim/spirit';
import { spiritOfIn } from './spiritrules';
import { barsOf, pressureParts } from './sim/stability';
import { gearOf, wear } from './sim/gear';
import { GEAR_SLOTS, slotName } from './data/items';
import { FIGURE_IDS } from '@/world/data/figures';
import { playerProfile } from '@/world/bridge';
import type { GameState } from './types';

const at = (level: number): GameState => {
  const s = createInitialState(7);
  buildingOfType(s, 'statue')!.level = level;
  return s;
};

describe('Статуя Героя: числа выведены, а не назначены', () => {
  it('мораль на вершине — лучший Воевода той же мерой стойкости; первый уровень — ноль; ровно по уровню', () => {
    expect(STATUE_TOP, 'вершина Статуи — потолок постройки').toBe(maxLevelFor('statue'));
    expect(STATUE_MORALE_TOP).toBeCloseTo(resolvePoints(giftCeil('marshal')), 12);
    expect(statueMorale(1), 'первый уровень — как до ДР-7').toBe(0);
    expect(statueMorale(0), 'Статуи нет — ноль').toBe(0);
    expect(statueMorale(STATUE_TOP)).toBeCloseTo(STATUE_MORALE_TOP, 12);
    const step = STATUE_MORALE_TOP / (STATUE_TOP - 1);
    for (let l = 2; l <= STATUE_TOP; l++) expect(statueMorale(l) - statueMorale(l - 1), `ур. ${l}: ровный шаг`).toBeCloseTo(step, 12);
    expect(statueMorale(STATUE_TOP + 5), 'выше вершины не растёт').toBeCloseTo(STATUE_MORALE_TOP, 12);
  });

  it('заметная, но не главная: не меньше ступени стабильности, меньше памяти боёв, голода, рыцарства и всей стабильности', () => {
    expect(STATUE_MORALE_TOP, 'заметна: не меньше морали одной ступени стабильности').toBeGreaterThanOrEqual(STAB_MORALE);
    expect(STATUE_MORALE_TOP, 'меньше памяти боёв').toBeLessThan(GLORY_CAP);
    expect(STATUE_MORALE_TOP, 'меньше голода').toBeLessThan(HUNGER_MORALE);
    expect(STATUE_MORALE_TOP, 'меньше всей стабильности').toBeLessThan(STAB_MORALE * STAB_MAX);
    expect(STATUE_MORALE_TOP, 'меньше рыцарства в силе').toBeLessThan(resolvePoints(FERVOUR_SCALE * ESTATE_PLUS.knights * 2));
    // Лад: сдвиг памятника — та же мерка, что у толчка боя; меньше тихих дней, — «немного».
    for (let l = 1; l <= STATUE_TOP; l++) expect(statueCalm(l)).toBeCloseTo(battleShock(statueMorale(l)), 12);
    expect(statueCalm(STATUE_TOP), 'немного: меньше ровной жизни').toBeLessThan(STAB_CALM);
    expect(statueCalm(2), 'со второго уровня — уже есть').toBeGreaterThan(0);
  });

  it('таблица по уровням — та, что записана в docs/city_v3.md («Решения ДР-7», 8–9) и docs/BUILDINGS.md (правило 12)', () => {
    const morale = [0, 0.67, 1.33, 2, 2.67, 3.33, 4, 4.67, 5.33, 6];
    const calm = [0, 0.26, 0.52, 0.79, 1.05, 1.31, 1.57, 1.83, 2.09, 2.36];
    expect(morale.length, 'уровни 1…вершина').toBe(STATUE_TOP);
    const r2 = (x: number): number => Math.round(x * 100) / 100;
    for (let l = 1; l <= STATUE_TOP; l++) {
      expect(r2(statueMorale(l)), `ур. ${l}: мораль дружины`).toBe(morale[l - 1]);
      expect(r2(statueCalm(l)), `ур. ${l}: лад, % ступени в день`).toBe(calm[l - 1]);
    }
  });
});

describe('Статуя Героя: прибавки дверями духа и стабильности, по уровням', () => {
  it('мораль дружины — строкой духа «Статуя Героя» ровно `statueMorale`; дисциплины не трогает; уезжает в бой', () => {
    const base = at(1);
    const v1 = spiritView(base);
    expect(v1.morale.value, 'область: основа без причин').toBe(SPIRIT_BASE);
    expect(SPIRIT_BASE + STATUE_MORALE_TOP, 'область: вершина Статуи не упирается в верх шкалы').toBeLessThan(SPIRIT_TOP);
    expect(v1.morale.lines.some((l) => l.id === 'statue'), 'первый уровень — строки нет').toBe(false);
    for (let l = 2; l <= STATUE_TOP; l++) {
      const s = at(l);
      const v = spiritView(s);
      expect(v.morale.lines.find((x) => x.id === 'statue')?.value, `ур. ${l}: строка духа`).toBeCloseTo(statueMorale(l), 12);
      // Без строки Статуи — та же партия (Статуя растит и влияние рыцарства — их своя строка): разница — ровно Статуя.
      const without = spiritOfIn({ ...spiritIn(s), statue: 0 });
      expect(v.morale.value, `ур. ${l}: мораль выше ровно на Статую`).toBeCloseTo(without.morale.value + statueMorale(l), 9);
      expect(v.discipline.value, `ур. ${l}: дисциплины Статуя не трогает`).toBe(without.discipline.value);
      // В бой — слепком моста, тем же духом.
      expect(playerProfile(s).spirit?.morale, `ур. ${l}: в бой`).toBeCloseTo(Math.round(v.morale.value * 10) / 10, 9);
    }
  });

  it('лад державы — слагаемым давления «Статуя» ровно `statueCalm`; первый уровень — без слагаемого', () => {
    expect(pressureParts(at(1), barsOf(at(1))).some((p) => p.id === 'statue')).toBe(false);
    for (let l = 2; l <= STATUE_TOP; l++) {
      const s = at(l);
      expect(s.siege, 'область: не в осаде').toBeFalsy();
      const part = pressureParts(s, barsOf(s)).find((p) => p.id === 'statue');
      expect(part?.value, `ур. ${l}`).toBeCloseTo(statueCalm(l), 12);
    }
  });

  it('с полководцем не связана: отметки и всё, что уезжает о полководце, — одни при любой Статуе', () => {
    const one = playerProfile(at(1));
    for (let l = 2; l <= STATUE_TOP; l++) {
      const p = playerProfile(at(l));
      expect(p.pips, `ур. ${l}: отметки`).toEqual(one.pips);
    }
  });
});

describe('вещи — только на правителе; надетое на агентов в старом сохранении — в сундук', () => {
  it('при чтении вещи с агентов сняты без следа в партии, сказано одной строкой летописи; без вещей — строки нет', () => {
    const s = createInitialState(7);
    const json = JSON.parse(serialize(s));
    // Старое сохранение: на двух агентах три вещи (имена — как писала прежняя ячейка), мусор не в счёт.
    json.agents.general.slots = ['меч', null, 'щит'];
    json.agents.spy.slots = ['плащ', { id: 'яд', power: 9 }, 7];
    const back = deserialize(JSON.stringify(json))!;
    for (const id of FIGURE_IDS) expect('slots' in back.agents[id], `${id}: мест под вещи нет`).toBe(false);
    expect(JSON.parse(serialize(back)).agents.general.slots, 'в сохранение не едет').toBeUndefined();
    enter(back, back.lastSaved);
    const lines = back.log.filter((e) => /вещи/i.test(e.text));
    expect(lines.map((e) => e.text), 'одна строка').toEqual(['Вещи с агентов — в сундуке: их надевают только на правителя.']);
    // Без вещей — без строки.
    const clean = deserialize(serialize(createInitialState(7)))!;
    enter(clean, clean.lastSaved);
    expect(clean.log.some((e) => /вещи/i.test(e.text))).toBe(false);
  });

  it('правитель: мест три, все открыты; надеть можно только вещь из таблицы и владения, снять — всегда; места у престола', () => {
    const s = createInitialState(7);
    expect(gearOf(s)).toEqual(Array.from({ length: GEAR_SLOTS }, () => null));
    const sword = slotName('меч')!;
    expect(wear(s, 0, sword, [sword]), 'вещи нет в таблице').toBe('Такой вещи нет.');
    expect(wear(s, GEAR_SLOTS, null, []), 'места нет').toBe('Такого места нет.');
    // Надетое из старой записи державы — читается именем и снимается в сундук.
    const json = JSON.parse(serialize(s));
    json.realm.gear = ['щит', 5, null];
    const back = deserialize(JSON.stringify(json))!;
    expect(gearOf(back)).toEqual([slotName('щит'), null, null]);
    expect(wear(back, 0, null, [])).toBeNull();
    expect(gearOf(back)).toEqual([null, null, null]);
    expect(back.realm.gear, 'пусто — поля нет').toBeUndefined();
  });
});
