// Окно «Жители» (UI-5, docs/ui_v2.md, 5.4): сводка одной таблицей — люди, жильё, прирост, мораль, оборона: число функцией
// игры, разбор без «Прочее», дверь к источнику; места работы — куда поставить свободные руки; дружина и невольники —
// строками-ссылками в свои окна, невольники с отпуском — в «Порядке». Ничего из прежнего окна не потеряно.
//
// Окно рисуется в строку (`renderToStaticMarkup`) с партией теста: стор игры подменён видом, как в тесте ратуши
// (`next/hall.test.ts`). Области (правило 11) названы в каждом блоке и проверяются утверждениями: дружина дома, вера со
// стойкостью, разведчики в пути, невольники и мастера на местах, вольный сбор, стройка, город сверх крыш.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { GameState } from '@/game/types';
import { createInitialState } from '@/game/state';
import { MORALE_GROWTH_ZERO } from '@/game/constants';
import { BUILDING_BY_ID } from '@/game/data/buildings';
import {
  bondedCount,
  buildingOfType,
  buildingSlots,
  buildingTitle,
  defense,
  faithTilt,
  freeJobCount,
  handsCount,
  homeArmyPower,
  housingCapacity,
  idleCount,
  mastersOn,
  workerCount,
} from '@/game/derived';
import { startUpgrade } from '@/game/sim/actions';
import { popGrowth } from '@/game/sim/population';
import { dec } from '@/game/num';
import { REST_LABEL } from '@/ui/kit/breakdown';
import { WINDOW, makersOf, sourceWord, toBuilding, type Source } from '@/ui/kit/sources';
import type { TipContent } from './tip';
import { defenseTip, fmtInt, housingTip, popRate, popTip, type TipGo } from './hudTips';
import { housingDoor, idleTip, peopleTip, summaryLines, workplaces } from './people';

const { stores, fake } = vi.hoisted(() => ({
  stores: { game: {} as Record<string, unknown> },
  fake: <T extends object>(real: T, view: () => Record<string, unknown>): T => Object.assign((sel: (g: unknown) => unknown) => sel(view()), real),
}));
vi.mock('@/game/store', async (orig) => {
  const real = await orig<{ useGame: object }>();
  return { ...real, useGame: fake(real.useGame, () => stores.game) };
});

import { PeoplePanel } from '@/ui/panels/PeoplePanel';
import { OrderPanel, useOrderView } from '@/ui/panels/OrderPanel';

const SRC = join(__dirname, '..');

/** Куда ушла дверь подсказки — тем же видом, что дверь набора. */
function goer(s: GameState): { go: TipGo; went: () => Source | null } {
  let went: Source | null = null;
  return {
    go: {
      tab: (t) => (went = { kind: 'tab', tab: t }),
      building: (id) => (went = toBuilding(s.buildings.find((b) => b.id === id)!.type)),
      realm: (v) => (went = { kind: 'realm', view: v }),
      to: (src) => (went = src),
    },
    went: () => went,
  };
}

/** Строки разбора без «Прочее»: строки складываются в итог на глазах игрока (docs/ui_v2.md, 2.2). */
function labels(t: TipContent): string[] {
  return (t.rows ?? []).map((r) => r.label);
}

// ---------- Партии ----------

/** Начало партии: 30 жителей, 7 свободных рук, дружины нет. */
const fresh = (): GameState => createInitialState(7);

/** Дружина дома, вера со стойкостью (православные, храм первого уровня), трое разведчиков в пути. */
function guarded(): GameState {
  const s = createInitialState(7);
  Object.assign(s.army, { clubman: 20, archer: 8 });
  s.faith.id = 'orthodox';
  s.scoutsAway = 3;
  return s;
}

/** Невольники на ферме и без места, мастера в мастерской, двое на вольном сборе, идёт стройка. */
function busy(): GameState {
  const s = createInitialState(7);
  s.bonded = 12;
  s.bondedWork.farmer = 5;
  s.masters = 2;
  s.freeJobs.gatherer = 2;
  for (const r of Object.keys(s.resources) as (keyof typeof s.resources)[]) s.resources[r] = 5000;
  startUpgrade(s, buildingOfType(s, 'houses')!.id);
  return s;
}

/** Город сверх крыш и мораль ниже порога: жильё «мест нет», жители уходят. */
function crowded(): GameState {
  const s = createInitialState(7);
  s.pop = housingCapacity(s) + 5;
  s.morale = MORALE_GROWTH_ZERO - 5;
  return s;
}

const PARTIES: [string, () => GameState][] = [
  ['начало', fresh],
  ['дружина дома, вера, разведчики', guarded],
  ['невольники, мастера, сбор, стройка', busy],
  ['сверх крыш, мораль ниже порога', crowded],
];

// ---------- Сводка ----------

describe('сводка «Жителей» — пять чисел функциями игры, разбор без «Прочее», дверь к источнику', () => {
  it('пять строк по порядку: люди, жильё, прирост, мораль, оборона', () => {
    const s = fresh();
    expect(summaryLines(s, goer(s).go).map((l) => l.key)).toEqual(['people', 'housing', 'growth', 'morale', 'defense']);
  });

  it('число строки — та же функция игры, что на других экранах', () => {
    for (const [name, make] of PARTIES) {
      const s = make();
      const by = Object.fromEntries(summaryLines(s, goer(s).go).map((l) => [l.key, l]));
      expect(by.people.value, name).toBe(fmtInt(s.pop));
      expect(by.housing.value, name).toBe(fmtInt(housingCapacity(s)));
      expect(by.growth.value, name).toBe(popRate(popGrowth(s).perDay));
      expect(by.morale.value, name).toBe(String(Math.round(s.morale)));
      // Оборона — тем же округлением, что в «Дружине» (`ArmyPanel`: `dec(defense(s), 0)`).
      expect(by.defense.value, name).toBe(dec(defense(s), 0));
    }
  });

  it('разбор каждой строки складывается в итог: «Прочее» нет ни в одной партии', () => {
    for (const [name, make] of PARTIES) {
      const s = make();
      for (const l of summaryLines(s, goer(s).go)) {
        const t = l.tip();
        expect(t.rows?.length, `${name}, ${l.key}: разбор есть`).toBeGreaterThan(0);
        expect(labels(t), `${name}, ${l.key}`).not.toContain(REST_LABEL);
      }
    }
  });

  it('дверь строки — окно числа, у жилья — постройка с жильём; подпись двери — слово окна', () => {
    for (const [name, make] of PARTIES) {
      const s = make();
      const by = Object.fromEntries(summaryLines(s, goer(s).go).map((l) => [l.key, l]));
      expect(by.people.to, name).toEqual(WINDOW.pop);
      expect(by.growth.to, name).toEqual(WINDOW.pop);
      expect(by.morale.to, name).toEqual(WINDOW.morale);
      expect(by.defense.to, name).toEqual(WINDOW.defense);
      expect(WINDOW.defense).toEqual({ kind: 'tab', tab: 'army' });
      expect(by.housing.to, name).toEqual(housingDoor(s));
      // Дверь жилья — первая главная кнопка его разбора: постройка, у которой больше всего мест.
      const first = housingTip(s, goer(s).go).makers![0];
      expect(sourceWord(by.housing.to), name).toBe(first.label);
    }
    expect(housingDoor(fresh())).toEqual(toBuilding('houses'));
  });

  it('жильё без мест и мораль ниже порога — тоном беды и словами', () => {
    const s = crowded();
    const by = Object.fromEntries(summaryLines(s, goer(s).go).map((l) => [l.key, l]));
    expect(by.housing.tone).toBe('bad');
    expect(by.housing.sub).toContain('мест нет');
    expect(by.morale.tone).toBe('bad');
    expect(by.morale.sub).toContain('жители уходят');
    // Область: город и правда сверх крыш, мораль — ниже порога прироста.
    expect(s.pop).toBeGreaterThan(housingCapacity(s));
    expect(s.morale).toBeLessThan(MORALE_GROWTH_ZERO);
  });

  it('прирост — разбор подсказки жителей верха, без второго разбора: жильё в сводке своей строкой', () => {
    const s = fresh();
    const { go } = goer(s);
    const t = summaryLines(s, go).find((l) => l.key === 'growth')!.tip();
    expect(t.rows).toEqual(popTip(s, go).rows);
    expect(t.sum).toEqual(popTip(s, go).sum);
    expect(t.more).toBeUndefined();
  });
});

describe('разборы сводки — каждое слагаемое хоть раз не ноль', () => {
  it('оборона: дружина дома, стены, основа, жители и вера; итог — `defense`', () => {
    const seen = new Set<string>();
    for (const [name, make] of PARTIES) {
      const s = make();
      const t = defenseTip(s, goer(s).go);
      expect(labels(t), name).not.toContain(REST_LABEL);
      expect(t.sum!.value, name).toBe(dec(defense(s), 0));
      for (const l of labels(t)) seen.add(l.replace(/ [\d ×,]+$/, '').replace(/ ×.*$/, ''));
    }
    expect(seen).toContain('Дружина дома');
    expect(seen).toContain('Основа');
    expect(seen).toContain('Жители');
    expect(seen).toContain(BUILDING_BY_ID.palisade.name);
    expect(seen).toContain('Православие');
    // Область: в партии «дружина дома» и правда есть мощь у стен, вера держит стойкость, а разведчики не в городе.
    const g = guarded();
    expect(homeArmyPower(g)).toBeGreaterThan(0);
    expect(faithTilt(g).steadfast).toBeGreaterThan(0);
    expect(labels(defenseTip(g, goer(g).go))).toContain(`Жители ${fmtInt(g.pop - g.scoutsAway)}`);
  });

  it('оборона: кнопки — постройки с обороной, дверь — «Дружина»', () => {
    const s = fresh();
    const { go, went } = goer(s);
    const t = defenseTip(s, go);
    expect(t.makers!.map((m) => m.label).sort()).toEqual(makersOf('defense').map((type) => BUILDING_BY_ID[type].name).sort());
    expect(makersOf('defense')).toContain('palisade');
    t.link!.go();
    expect(went()).toEqual(WINDOW.defense);
    expect(t.link!.label).toBe(sourceWord(WINDOW.defense));
  });

  it('люди: на местах, вольный сбор, свободные руки и разведчики — итог `s.pop`', () => {
    const seen = new Set<string>();
    for (const [name, make] of PARTIES) {
      const s = make();
      const t = peopleTip(s, goer(s).go);
      expect(labels(t), name).not.toContain(REST_LABEL);
      expect(t.sum!.value, name).toBe(fmtInt(s.pop));
      for (const l of labels(t)) seen.add(l);
    }
    expect([...seen].sort()).toEqual(['Вольный сбор', 'Разведчики в пути', 'На местах в постройках', 'Свободные руки'].sort());
  });

  it('свободные руки: жители минус занятые — итог `idleCount`', () => {
    for (const [name, make] of PARTIES) {
      const s = make();
      if (idleCount(s) === 0) continue;
      const t = idleTip(s);
      expect(labels(t), name).not.toContain(REST_LABEL);
      expect(t.sum!.value, name).toBe(fmtInt(idleCount(s)));
    }
    // Область: вольный сбор идёт — его строка видна.
    expect(labels(idleTip(busy()))).toContain('Вольный сбор');
  });
});

// ---------- Места работы ----------

describe('места работы — куда поставить свободные руки', () => {
  it('каждая постройка с местами — одной строкой; площадь — последней, без предела', () => {
    for (const [name, make] of PARTIES) {
      const s = make();
      const rows = workplaces(s);
      const withSlots = s.buildings.filter((b) => buildingSlots(b) > 0).map((b) => b.id);
      expect(rows.filter((r) => r.type !== 'campfire').map((r) => r.id).sort(), name).toEqual(withSlots.sort());
      const square = rows[rows.length - 1];
      expect(square.type, name).toBe('campfire');
      expect(square.free, name).toBeNull();
    }
  });

  it('люди — жители на местах; мест — места минус все руки: жители, невольники и мастера', () => {
    for (const [name, make] of PARTIES) {
      const s = make();
      for (const r of workplaces(s)) {
        if (r.type === 'campfire') continue;
        const b = s.buildings.find((x) => x.id === r.id)!;
        expect(r.people, `${name}, ${r.type}`).toBe(workerCount(s, b.id));
        expect(r.free, `${name}, ${r.type}`).toBe(Math.max(0, buildingSlots(b) - handsCount(s, b.id)));
        expect(r.name).toBe(buildingTitle(s, b.type));
      }
    }
    // Область: невольники и мастера и правда стоят на местах — их руки мест не оставляют.
    const s = busy();
    const farm = buildingOfType(s, 'farm')!;
    const shop = buildingOfType(s, 'workshop')!;
    expect(bondedCount(s, farm.id)).toBeGreaterThan(0);
    expect(mastersOn(s, shop.id)).toBeGreaterThan(0);
    const row = (id: number) => workplaces(s).find((r) => r.id === id)!;
    expect(row(farm.id).sub).toContain('невольников 5');
    expect(row(shop.id).sub).toContain('мастеров 2');
  });

  it('порядок: без рук — первыми, потом с местами, потом полные; площадь — кто на вольном сборе', () => {
    for (const [name, make] of PARTIES) {
      const ranks = workplaces(make()).map((r) => r.rank);
      expect(ranks, name).toEqual([...ranks].sort((a, b) => a - b));
    }
    const s = busy();
    const square = workplaces(s).find((r) => r.type === 'campfire')!;
    expect(square.people).toBe(freeJobCount(s, 'gatherer'));
    expect(square.sub).toContain('Собиратель 2');
    // Все жители на местах — сумма столбца «Люди»: никто не потерян и не посчитан дважды.
    for (const [name, make] of PARTIES) {
      const t = make();
      const sum = workplaces(t).reduce((n, r) => n + r.people, 0);
      expect(sum, name).toBe(t.pop - idleCount(t));
    }
  });
});

// ---------- Окно ----------

function render(s: GameState): string {
  stores.game = { s, openBuilding: () => undefined, act: () => undefined, openMap: () => undefined };
  return renderToStaticMarkup(h(PeoplePanel));
}

describe('окно «Жители» — две вкладки, таблица сводки, места работы, ссылки', () => {
  it('со свободными руками без стройки открывается на «Работах» — со счётчиком, как у низа', () => {
    const s = fresh();
    expect(idleCount(s)).toBeGreaterThan(0);
    const html = render(s);
    expect(html).toContain('role="tablist"');
    expect(html).toMatch(/aria-selected="true"[^>]*>(?:(?!<\/button>).)*Работы/);
    expect(html).toContain(`<em class="kit-badge">${idleCount(s)}</em>`);
    // Каждое место — строка с дверью в постройку.
    for (const r of workplaces(s)) expect(html, r.name).toContain(`aria-label="${r.name}: поставить людей"`);
    expect(html).toContain('Свободные руки');
  });

  it('во время стройки — на «Сводке»: пять строк с разбором и дверью, ссылки на «Дружину» и «Порядок»', () => {
    const s = busy();
    const html = render(s);
    expect(html).toMatch(/aria-selected="true"[^>]*>(?:(?!<\/button>).)*Сводка/);
    const lines = summaryLines(s, goer(s).go);
    for (const l of lines) expect(html, l.key).toContain(`aria-label="${l.label}: ${sourceWord(l.to)}"`);
    // Тело строки — справка (кнопка с разбором), дверь — отдельной кнопкой: по одной на строку.
    expect(html.match(/kit-cells tip/g)?.length).toBe(lines.length);
    expect(html).toContain('В своих окнах');
    expect(html).toContain(`aria-label="${sourceWord(WINDOW.army)}"`);
    expect(html).toContain(`aria-label="${sourceWord(WINDOW.order)}"`);
  });

  it('прежних полос и копий нет: ни трёх множителей прироста, ни карточек дружины, ни отпуска невольников', () => {
    for (const s of [fresh(), busy()]) {
      const html = render(s);
      expect(html).not.toContain('factor');
      expect(html).not.toContain('Отпустить');
      expect(html).not.toContain('card as-row');
      expect(html).not.toContain('Кто чем занят');
    }
  });
});

describe('ничего не потеряно: прежнее — в своих окнах', () => {
  it('невольники — в «Порядке»: где стоят, без места, отпуск шагом; прежней двери в «Жители» нет', () => {
    const s = busy();
    stores.game = { s, openBuilding: () => undefined, act: () => undefined, openMap: () => undefined };
    // С UI-8 (6.13) невольники — вкладкой «Невольники» окна «Порядка».
    useOrderView.setState({ view: 'bonded' });
    const html = renderToStaticMarkup(h(OrderPanel));
    expect(html).toContain(`Где невольники <span class="muted">${s.bonded}</span>`);
    expect(html).toContain(buildingTitle(s, 'farm'));
    expect(html).toContain('Без места — на стройке');
    expect(html).toContain(`Отпустить 10 из ${s.bonded}`);
    const order = readFileSync(join(SRC, 'panels/OrderPanel.tsx'), 'utf8');
    expect(order).not.toContain("openTab('people')");
  });

  it('пусто — откуда невольники берутся, и дверь на рынок', () => {
    const s = fresh();
    stores.game = { s, openBuilding: () => undefined, act: () => undefined, openMap: () => undefined };
    useOrderView.setState({ view: 'bonded' });
    const html = renderToStaticMarkup(h(OrderPanel));
    expect(html).toContain('Невольники <span class="muted">нет</span>');
    expect(html).toContain('На рынок');
    expect(html).not.toContain('Отпустить');
  });

  // Решение владельца 16.10.2026 (docs/ui_v2.md, 6.13): «Порядок» — вкладками «Надзор | Невольники», каждая меньше экрана
  // (стенд, заход `ui8c`). Область: невольники есть (12, на ферме 5), стройка идёт.
  it('«Порядок» — вкладки «Надзор | Невольники»: надзор и рычаги на одной, где стоят и отпуск — на другой', () => {
    const s = busy();
    expect(s.bonded, 'точка внутри области: невольники есть').toBeGreaterThan(0);
    stores.game = { s, openBuilding: () => undefined, act: () => undefined, openMap: () => undefined };
    useOrderView.setState({ view: 'watch' });
    const watch = renderToStaticMarkup(h(OrderPanel));
    expect([...watch.matchAll(/role="tab"[^>]*>(?:<[^>]+>)*([^<]+)</g)].map((m) => m[1]), 'вкладки').toEqual(['Надзор', 'Невольники']);
    expect(watch, 'выбрана «Надзор»').toMatch(/aria-selected="true" class="on"><span class="one-line">Надзор</);
    expect(watch, 'надзор — таблицей').toContain('aria-label="Кто держит невольников"');
    expect(watch, 'пороги шкалы — словами (Ч12)').toContain('>ропот<');
    expect(watch).toContain('>надзора мало<');
    expect(watch, 'на «Надзоре» отпуска нет').not.toContain('Отпустить');
    expect(watch, 'и где стоят — тоже').not.toContain('Где невольники');
    useOrderView.setState({ view: 'bonded' });
    const bonded = renderToStaticMarkup(h(OrderPanel));
    expect(bonded, 'на «Невольниках» — где стоят').toContain('Где невольники');
    expect(bonded, 'и отпуск').toContain(`Отпустить 10 из ${s.bonded}`);
    expect(bonded, 'надзора там нет').not.toContain('aria-label="Кто держит невольников"');
    // Дверь «Невольники» из «Жителей» открывает их вкладку.
    const people = readFileSync(join(SRC, 'panels/PeoplePanel.tsx'), 'utf8');
    expect(people).toMatch(/useOrderView\.getState\(\)\.set\('bonded'\);\s*goTo\(WINDOW\.order\)/);
  });

  it('отпуск — двумя касаниями: окно «Точно?» одно на игру (`kit/twotap`), своего таймера нет', () => {
    const src = readFileSync(join(SRC, 'parts/Bonded.tsx'), 'utf8');
    expect(src).toContain("from '@/ui/kit/twotap'");
    expect(src).toMatch(/if \(!armed\) return arm\(\);\s*disarm\(\);\s*act\(\(st\) => releaseBonded/);
    expect(src).not.toMatch(/setTimeout|onPointerDown|onTouchStart/);
  });

  it('полосы прироста — в «Приросте», войско и новобранцы — в «Дружине»', () => {
    const pop = readFileSync(join(SRC, 'panels/PopPanel.tsx'), 'utf8');
    for (const k of ['name="Мораль"', 'name="Свободное жильё"', 'name="Запас еды"', 'Новобранцы', 'Бойцы дружины']) expect(pop, k).toContain(k);
    const army = readFileSync(join(SRC, 'panels/ArmyPanel.tsx'), 'utf8');
    for (const k of ['Новобранцы', '<Muster', 'Нанять']) expect(army, k).toContain(k);
    // Разбор обороны в «Дружине» — тот же, что у строки сводки.
    expect(army).toContain('defenseTip(s, go)');
  });
});
