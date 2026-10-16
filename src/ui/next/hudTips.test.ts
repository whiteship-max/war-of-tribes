// Подсказки верха и запасов (docs/ui_v2.md, 5.2; UI-3): разбор «в день» складывается в то самое число игры, что стоит в
// строке (`netPerDay`, `popGrowth`, `moraleTarget`, `upkeepInfo`), и строки «Прочее» нет; главные кнопки — постройки,
// которые делают число (`kit/sources.makersOf`), крупнейшая первой; ниже — дверь окна (`WINDOW`); постройки нет в городе —
// «Построить» в «Стройку» ратуши.
//
// Область каждого разбора названа и проверена в самом тесте (правило 11): у каждого слагаемого есть партия набора, где оно
// не ноль, — иначе выпавшая строка не дала бы остатка и тест прошёл бы даром.
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { GameState, ResourceId } from '@/game/types';
import { createInitialState } from '@/game/state';
import { RESOURCE_IDS } from '@/game/constants';
import { BUILDING_BY_ID } from '@/game/data/buildings';
import { SEASON_SECONDS } from '@/game/data/seasons';
import { DAY_LENGTH } from '@/game/pace';
import {
  buildingOfType,
  buildingProduction,
  freeRangeProduction,
  heatingWoodPerDay,
  housingCapacity,
  mastersFoodPerDay,
  moraleBreakdown,
  netPerDay,
  productionPerDay,
  upkeepInfo,
} from '@/game/derived';
import { popGrowth } from '@/game/sim/population';
import { statAt } from '@/game/train';
import { maxLevelFor } from '@/game/derived';
import { REST_LABEL } from '@/ui/kit/breakdown';
import { WINDOW, makersOf, producersOf, sourceWord, type Source } from '@/ui/kit/sources';
import { TIP_W_WIDE, type TipContent } from './tip';
import { armyTip, energyTip, fmtInt, gemsTip, goldTip, moraleTip, popRate, popTip, rate, resTip, type TipGo } from './hudTips';

/** Куда повела последняя кнопка — тем же видом, что дверь набора (`kit/sources.Source`). */
function goer(s: GameState): { go: TipGo; went: () => Source | null } {
  let went: Source | null = null;
  return {
    go: {
      tab: (t) => (went = { kind: 'tab', tab: t }),
      building: (id) => (went = { kind: 'building', type: s.buildings.find((b) => b.id === id)!.type }),
      realm: (v) => (went = { kind: 'realm', view: v }),
      to: (src) => (went = src),
    },
    went: () => went,
  };
}

const labels = (t: TipContent): string[] => [...(t.rows ?? []), ...(t.more?.rows ?? [])].map((r) => r.label);
const at = (i: number) => (s: GameState): void => {
  s.time = i * SEASON_SECONDS + SEASON_SECONDS / 2;
};

/** Партии набора: каждая сдвигает одно слагаемое с нуля; последняя — всё разом. */
const CASES: { name: string; set: (s: GameState) => void }[] = [
  { name: 'начало', set: () => undefined },
  {
    name: 'вольный сбор',
    set: (s) => {
      s.freeJobs = { gatherer: 3, hunter: 2, woodcutter: 2, stonecutter: 2 };
    },
  },
  { name: 'зима второго года', set: at(7) },
  {
    name: 'дружина и мастера',
    set: (s) => {
      s.army.spearman = 30;
      s.army.rider = 4;
      s.masters = 3;
    },
  },
  { name: 'осада с пайком', set: (s) => void (s.siege = { byName: 'Альфа', until: s.time + 1e6, ration: true }) },
  {
    name: 'всё разом',
    set: (s) => {
      at(7)(s);
      s.freeJobs = { gatherer: 2, hunter: 2, woodcutter: 1 };
      s.army.spearman = 10;
      s.masters = 2;
      s.siege = { byName: 'Альфа', until: s.time + 1e6, ration: true };
    },
  },
];

function made(name: string): GameState {
  const s = createInitialState(7);
  CASES.find((c) => c.name === name)!.set(s);
  return s;
}

describe('запас: «в день» — постройки и расход, итог — `netPerDay`', () => {
  it('строки складываются в итог ячейки, «Прочее» нет; заголовок — есть из вместимости склада', () => {
    const seen = new Set<string>();
    for (const c of CASES) {
      const s = made(c.name);
      const storage = buildingOfType(s, 'storage')!;
      for (const r of RESOURCE_IDS) {
        const t = resTip(s, r, storage.id, goer(s).go);
        expect(labels(t), `${c.name}, ${r}`).not.toContain(REST_LABEL);
        expect(t.sum!.value, `${c.name}, ${r}`).toBe(rate(netPerDay(s)[r]));
        expect(t.title).toContain(fmtInt(s.resources[r]));
        for (const l of labels(t)) seen.add(`${r}:${l}`);
      }
    }
    // Область: каждое слагаемое хоть в одной партии не ноль — Площадь (вольный сбор), очаги, едоки и осадный паёк.
    for (const want of ['food:Площадь', 'wood:Площадь', 'wood:Очаги', 'food:Едят жители', 'food:Едят бойцы', 'food:Едят мастера', 'food:Осадный паёк']) {
      expect(seen, want).toContain(want);
    }
  });

  it('строка постройки — её выработка (`buildingProduction`), Площади — вольный сбор (`freeRangeProduction`)', () => {
    const s = made('вольный сбор');
    const t = resTip(s, 'food', null, goer(s).go);
    const farm = buildingOfType(s, 'farm')!;
    expect(t.rows!.find((r) => r.label === BUILDING_BY_ID.farm.name)!.value).toBe(rate(buildingProduction(s, farm).food));
    expect(t.rows!.find((r) => r.label === BUILDING_BY_ID.campfire.name)!.value).toBe(rate(freeRangeProduction(s).food));
    // Валовое — сумма дворов и вольного сбора: строки не теряют и не удваивают выработку.
    const yards = s.buildings.reduce((n, b) => n + buildingProduction(s, b).food, 0);
    expect(yards + freeRangeProduction(s).food).toBeCloseTo(productionPerDay(s).food, 6);
    expect(freeRangeProduction(s).food).toBeGreaterThan(0);
  });

  it('главные кнопки — все постройки, которые делают запас, крупнейшая первой; ниже — «Склад»', () => {
    const s = made('вольный сбор');
    const storage = buildingOfType(s, 'storage')!;
    for (const r of RESOURCE_IDS) {
      const { go, went } = goer(s);
      const t = resTip(s, r, storage.id, go);
      const names = producersOf(r).map((type) => BUILDING_BY_ID[type].name);
      expect(t.makers!.map((m) => m.label).sort(), r).toEqual([...names].sort());
      // Порядок — по выработке: первая кнопка — первая строка разбора.
      expect(t.makers![0].label, r).toBe(t.rows![0].label);
      t.makers![0].go();
      expect(went()!.kind, r).toBe('building');
      t.link!.go();
      expect(went(), r).toEqual(WINDOW[r]);
      expect(t.link!.label).toBe(sourceWord(WINDOW[r]));
    }
    // Уголь — его делает лесопилка (и вольный сбор лесорубов с Площади).
    expect(makersOf('charcoal')).toContain('sawmill');
  });

  it('постройки нет в городе — кнопка «Построить» ведёт в «Стройку» ратуши; без двери набора её нет', () => {
    const s = createInitialState(7);
    s.buildings = s.buildings.filter((b) => b.type !== 'mine');
    const { go, went } = goer(s);
    const t = resTip(s, 'iron', null, go);
    // Область: железо делает только рудник — иначе кнопка «Построить» соседствовала бы с живой.
    expect(producersOf('iron')).toEqual(['mine']);
    expect(t.makers).toHaveLength(1);
    expect(t.makers![0].build).toBe(true);
    t.makers![0].go();
    expect(went()).toEqual({ kind: 'build' });
    const bare: TipGo = { tab: () => undefined, building: () => undefined, realm: () => undefined };
    expect(resTip(s, 'iron', null, bare).makers).toEqual([]);
    // Стоящая постройка «Построить» не получает.
    expect(resTip(createInitialState(7), 'iron', null, go).makers!.every((m) => !m.build)).toBe(true);
  });
});

describe('жители и жильё', () => {
  const POP: { name: string; set: (s: GameState) => void }[] = [
    { name: 'начало', set: () => undefined },
    { name: 'сверх крыш', set: (s) => void (s.pop = housingCapacity(s) + 5) },
    { name: 'мораль низкая', set: (s) => void (s.morale = 3) },
    { name: 'мало еды', set: (s) => void (s.resources.food = 20) },
    { name: 'сытый паёк', set: (s) => void (s.ration = 'rich') },
    {
      name: 'ислам',
      set: (s) => {
        s.faith.id = 'islam';
        buildingOfType(s, 'church')!.level = 5;
      },
    },
    { name: 'ратуша 6', set: (s) => void (buildingOfType(s, 'town_hall')!.level = 6) },
  ];

  it('прирост: основа под множителями складывается в `popGrowth`; жильё — в `housingCapacity`; «Прочее» нет', () => {
    const off = new Set<string>();
    for (const c of POP) {
      const s = createInitialState(7);
      c.set(s);
      const g = popGrowth(s);
      const t = popTip(s, goer(s).go);
      expect(labels(t), c.name).not.toContain(REST_LABEL);
      expect(t.sum!.value, c.name).toBe(popRate(g.perDay));
      expect(t.more!.sum!.value, c.name).toBe(fmtInt(housingCapacity(s)));
      expect(t.title).toBe(`Жители · ${fmtInt(s.pop)} из ${fmtInt(housingCapacity(s))}`);
      // Множитель не единица — его строка видна: иначе выпавший из разбора множитель утонул бы в пороге записи.
      const shown = (word: string): boolean => labels(t).some((l) => l.startsWith(`${word} ×`));
      if (g.morale !== 1 && shown('Мораль')) off.add('morale');
      if (g.housing !== 1 && shown('Жильё')) off.add('housing');
      if (g.food !== 1 && shown('Еда')) off.add('food');
      if (g.ration !== 1 && shown('Паёк')) off.add('ration');
      if (g.faith !== 1 && shown('Вера')) off.add('faith');
      if (g.morale < 0) off.add('leave');
      if (t.more!.rows.some((r) => r.label === BUILDING_BY_ID.town_hall.name)) off.add('hall');
    }
    // Область: каждый множитель хоть раз не единица, люди хоть раз уходят, ратуша хоть раз даёт жильё.
    expect([...off].sort()).toEqual(['faith', 'food', 'hall', 'housing', 'leave', 'morale', 'ration']);
  });

  it('главные кнопки — постройки с жильём, больше мест — первой; дверь — «Прирост»', () => {
    const s = createInitialState(7);
    const { go, went } = goer(s);
    const t = popTip(s, go);
    expect(t.makers!.map((m) => m.label)).toEqual([BUILDING_BY_ID.houses.name, BUILDING_BY_ID.town_hall.name]);
    t.link!.go();
    expect(went()).toEqual(WINDOW.pop);
  });
});

describe('мораль: цель и её слагаемые', () => {
  const MORALE: { name: string; set: (s: GameState) => void }[] = [
    { name: 'начало', set: () => undefined },
    { name: 'сверх крыш', set: (s) => void (s.pop = Math.round(housingCapacity(s) * 1.4)) },
    { name: 'высокий налог', set: (s) => void (s.tax = 'high') },
    {
      name: 'пир',
      set: (s) => {
        s.feastUntil = s.time + 1e6;
        s.feastAt = s.time;
      },
    },
    { name: 'скудный паёк', set: (s) => void (s.ration = 'lean') },
    {
      name: 'всё против',
      set: (s) => {
        s.pop = Math.round(housingCapacity(s) * 2);
        s.resources.food = 0;
        s.tax = 'high';
        s.ration = 'lean';
      },
    },
  ];

  it('строки складываются в цель (`moraleTarget`) вместе со срезом шкалы, «Прочее» нет', () => {
    let clamped = 0;
    let free = 0;
    let taxed = 0;
    let feast = 0;
    let lever = 0;
    for (const c of MORALE) {
      const s = createInitialState(7);
      c.set(s);
      const m = moraleBreakdown(s);
      const t = moraleTip(s, goer(s).go);
      expect(labels(t), c.name).not.toContain(REST_LABEL);
      expect(t.sum!.value, c.name).toBe(String(Math.round(m.target)));
      if (labels(t).includes('Предел шкалы')) clamped++;
      else free++;
      if (m.tax !== 0) taxed++;
      if (m.feast !== 0) feast++;
      if (t.body!.includes('Указ и паёк')) lever++;
    }
    // Область: шкала срезает цель хоть в одной партии и не срезает хоть в одной; налог, пир и паёк — хоть раз не ноль.
    expect(clamped).toBeGreaterThan(0);
    expect(free).toBeGreaterThan(0);
    expect(taxed).toBeGreaterThan(0);
    expect(feast).toBeGreaterThan(0);
    expect(lever).toBeGreaterThan(0);
  });

  it('главные кнопки — постройки с моралью и пиром, больше морали — первой; дверь — «Мораль»', () => {
    const s = createInitialState(7);
    const { go, went } = goer(s);
    const t = moraleTip(s, go);
    expect(t.makers!.map((m) => m.label).sort()).toEqual(makersOf('morale').map((type) => BUILDING_BY_ID[type].name).sort());
    expect(t.makers![0].label).toBe(BUILDING_BY_ID.church.name);
    t.link!.go();
    expect(went()).toEqual(WINDOW.morale);
  });
});

describe('дружина: жалованье по видам, кнопки к казармам и конюшне', () => {
  it('строки видов складываются в жалованье (`upkeepInfo.armyWages`); отсрочка — словами', () => {
    const s = made('дружина и мастера');
    const t = armyTip(s, goer(s).go);
    expect(labels(t)).not.toContain(REST_LABEL);
    expect(t.sum!.value).toBe(rate(-upkeepInfo(s).armyWages));
    // Область: два вида в строю — строк две, обе не ноль.
    expect(t.rows!.length).toBe(2);
    s.pay.from = s.time + 3 * DAY_LENGTH;
    expect(armyTip(s, goer(s).go).body).toContain('Платить — через');
  });

  it('кнопки — где учат виды; дверь — «Дружина»', () => {
    const s = createInitialState(7);
    const { go, went } = goer(s);
    const t = armyTip(s, go);
    expect(makersOf('army')).toEqual(['barracks', 'stable']);
    expect(t.makers!.map((m) => m.label)).toEqual([BUILDING_BY_ID.barracks.name, BUILDING_BY_ID.stable.name]);
    t.makers![1].go();
    expect(went()).toEqual({ kind: 'building', type: 'stable' });
    t.link!.go();
    expect(went()).toEqual(WINDOW.army);
  });
});

describe('золото: сбор, вера и жалованье', () => {
  it('строки складываются в «в день» — сбор минус причитающееся; вера и жалованье хоть раз не ноль', () => {
    const GOLD: { name: string; set: (s: GameState) => void }[] = [
      { name: 'начало', set: () => undefined },
      {
        name: 'налог и дружина после отсрочки',
        set: (s) => {
          s.tax = 'moderate';
          s.army.spearman = 20;
          s.masters = 2;
          s.pay.from = 0;
          s.time = 5 * DAY_LENGTH;
        },
      },
      { name: 'десятина', set: (s) => void (s.faith.id = 'catholic') },
      {
        name: 'закят',
        set: (s) => {
          s.faith.id = 'islam';
          s.tax = 'moderate';
        },
      },
    ];
    const seen = new Set<string>();
    for (const c of GOLD) {
      const s = createInitialState(7);
      c.set(s);
      const up = upkeepInfo(s);
      const t = goldTip(s, goer(s).go);
      expect(labels(t), c.name).not.toContain(REST_LABEL);
      expect(t.sum!.value, c.name).toBe(rate(up.income - up.due));
      for (const l of labels(t)) seen.add(l);
    }
    for (const want of ['Налог', 'Жалованье дружине', 'Жалованье мастерам']) expect(seen, want).toContain(want);
    expect([...seen].some((l) => l !== 'Налог' && !l.startsWith('Жалованье')), 'строка веры').toBe(true);
  });

  it('золото не делает ни одна постройка — кнопок нет, дверь — «Указы»', () => {
    const s = createInitialState(7);
    const { go, went } = goer(s);
    const t = goldTip(s, go);
    expect(t.makers ?? []).toEqual([]);
    expect(makersOf('gold')).toEqual([]);
    t.link!.go();
    expect(went()).toEqual(WINDOW.gold);
  });
});

describe('энергия и алмазы: копятся не постройкой — только дверь окна', () => {
  it('энергия — «Промыслы», алмазы — «Сокровищница»', () => {
    const s = createInitialState(7);
    let opened = '';
    const e = energyTip(s, 0, () => (opened = 'trades'));
    expect(e.makers).toBeUndefined();
    e.link!.go();
    expect(opened).toBe('trades');
    expect(e.link!.label).toBe(sourceWord(WINDOW.energy));
    const g = gemsTip(120, 3, null, () => (opened = 'treasury'));
    expect(g.title).toBe('Алмазы · 120');
    expect(g.body).toContain('3 из 10');
    g.link!.go();
    expect(opened).toBe('treasury');
    expect(g.link!.label).toBe(sourceWord(WINDOW.treasury));
    expect(gemsTip(null, 0, 'Нет связи с Сокровищницей.', () => undefined).title).toBe('Алмазы · нет связи');
  });
});

describe('кто делает число — из данных игры', () => {
  it('жильё, мораль и дружину делают постройки, у которых это правда есть', () => {
    for (const type of makersOf('pop')) expect(statAt(type, 'housing', maxLevelFor(type)), type).toBeGreaterThan(0);
    for (const type of makersOf('morale')) {
      const lift = statAt(type, 'morale', maxLevelFor(type)) + statAt(type, 'feast', maxLevelFor(type));
      expect(lift, type).toBeGreaterThan(0);
    }
    // Область: у каждой из трёх есть постройки, и трактир (пир без морали) — среди моральных.
    expect(makersOf('pop').length).toBeGreaterThan(0);
    expect(makersOf('morale')).toContain('tavern');
    for (const r of RESOURCE_IDS) expect(makersOf(r as ResourceId)).toEqual(producersOf(r));
  });
});

describe('подсказка рисует кнопки построек над дверью окна', () => {
  const view = { w: 390, h: 844 };
  const anchor = { x: 100, y: 60, w: 44, h: 32 };

  it('кнопки — перед дверью окна; «Построить» — со словом; под окном с вопросом кнопок нет', async () => {
    const { TipView } = await import('./TipLayer');
    const s = createInitialState(7);
    s.buildings = s.buildings.filter((b) => b.type !== 'pen');
    const t = resTip(s, 'food', buildingOfType(s, 'storage')!.id, goer(s).go);
    const html = renderToStaticMarkup(h(TipView, { tip: { ...t, at: anchor }, view, busy: false, modal: false, hide: () => undefined }));
    const makersAt = html.indexOf('nx-tip-makers');
    expect(makersAt).toBeGreaterThan(html.indexOf('nx-tip-rows'));
    expect(makersAt).toBeLessThan(html.indexOf('nx-tip-go'));
    expect(html).toContain('class="nx-tip-maker build"');
    expect(html).toContain('<small>построить</small>');
    expect(html.match(/class="nx-tip-maker( build)?"/g)!.length).toBe(producersOf('food').length);
    // Плашка с кнопками шире (`TIP_W_WIDE`): по две кнопки в ряд имя постройки не рвётся посреди слова.
    expect(html).toContain(`width:${TIP_W_WIDE}px`);
    const under = renderToStaticMarkup(h(TipView, { tip: { ...t, at: anchor }, view, busy: false, modal: true, hide: () => undefined }));
    expect(under).not.toContain('nx-tip-maker');
  });

  it('второй разбор — своим именем под первым (жильё под жителями)', async () => {
    const { TipView } = await import('./TipLayer');
    const s = createInitialState(7);
    const html = renderToStaticMarkup(h(TipView, { tip: { ...popTip(s, goer(s).go), at: anchor }, view, busy: false, modal: false, hide: () => undefined }));
    expect(html).toContain('<b class="nx-tip-sub">Жильё</b>');
    expect(html.indexOf('nx-tip-sub')).toBeGreaterThan(html.indexOf('nx-tip-row sum'));
  });

  it('мастера едят из того же котла — строкой, пока они есть', () => {
    const s = made('дружина и мастера');
    expect(mastersFoodPerDay(s)).toBeGreaterThan(0);
    expect(heatingWoodPerDay(made('зима второго года'))).toBeGreaterThan(0);
  });
});
