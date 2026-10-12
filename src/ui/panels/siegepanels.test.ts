// Окна осады обеих сторон — что они говорят игроку (docs/siege_audit.md). Окно рисуется в строку (`renderToStaticMarkup`)
// с видом мира, как его отдаёт пульс; эффекты не идут — проверяется то, что окно покажет с этим видом.
//
// Области правил: окно обороняющегося — город в осаде (вид осады есть); окно лагеря — лагерь стоит (вид лагеря есть).
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createInitialState } from '@/game/state';
import { recruitCheck } from '@/game/sim/army';
import { SIEGE_NO_RECRUIT } from '@/game/constants';
import { NO_GARRISON, WOOD_FIXED } from '@/world/siege';
import { estimate } from '@/world/intel';
import type { CampView, SiegeView } from '@/world/types';
import { SiegePanel } from './SiegePanel';
import { CampPanel, reliefLine } from './CampPanel';
import { wearLine } from '@/ui/parts/restWords';

const NOW = 1_900_000_000_000;

// Строка без браузера читает сторы `zustand` с их начального состояния, а не с положенного: окна читают здесь вид,
// который кладёт тест, теми же селекторами (`useGame`, `useWorld`), а часы окна — его минута.
const { stores, fake } = vi.hoisted(() => ({
  stores: { game: {} as Record<string, unknown>, world: {} as Record<string, unknown> },
  /** Хук стора, который читает вид теста; прочее у стора — настоящее (на него подписываются модули при загрузке). */
  fake: <T extends object>(real: T, view: () => Record<string, unknown>): T => Object.assign((sel: (g: unknown) => unknown) => sel(view()), real),
}));
vi.mock('@/game/store', async (orig) => {
  const real = await orig<{ useGame: object }>();
  return { ...real, useGame: fake(real.useGame, () => stores.game) };
});
vi.mock('@/world/store', async (orig) => {
  const real = await orig<{ useWorld: object }>();
  return { ...real, useWorld: fake(real.useWorld, () => stores.world), worldNow: () => 1_900_000_000_000 };
});

const siege = (over: Partial<SiegeView> = {}): SiegeView => ({
  byId: 'c-1',
  byName: 'Альфа',
  since: NOW - 3_600_000,
  starvesAt: NOW + 10 * 3_600_000,
  garrison: 0,
  foodAtStart: 500,
  campMen: 80,
  builders: 80,
  fate: 'plunder',
  fall: { goods: 100, gold: 0, hidden: 10, ledBonded: 0, ledPop: 0, scatterPop: 0, scatterBonded: 0, buildings: 0, levels: 1, burnsWorks: false, routed: 0 },
  palisade: 2,
  ...over,
});

const camp = (over: Partial<CampView> = {}): CampView => {
  const { fall: _f, palisade: _p, garrison: _g, ...base } = siege();
  return {
    ...base,
    byId: 'home',
    byName: 'Наша дружина',
    garrison: estimate(60, 'rough'),
    targetId: 'c-2',
    targetName: 'Бета',
    castle: true,
    lair: false,
    stage: 'stronghold',
    power: estimate(5000, 'rough'),
    fates: [
      { id: 'plunder', can: true, reason: null, led: { min: 0, max: 0 }, less: { min: 0, max: 0 } },
      { id: 'captives', can: true, reason: null, led: { min: 0, max: 5 }, less: { min: 0, max: 0 } },
      { id: 'burn', can: true, reason: null, led: { min: 0, max: 0 }, less: { min: 0, max: 0 } },
    ],
    men: 90,
    ...over,
  } as CampView;
};

/** Окно обороняющегося со своим городом без войска. */
function siegeHtml(view: SiegeView): string {
  const s = createInitialState();
  for (const k of Object.keys(s.army) as (keyof typeof s.army)[]) s.army[k] = 0;
  stores.game = { s, openSortie: () => {}, showToast: () => {}, openBuilding: () => {} };
  stores.world = { siege: view, marches: [], figures: [], info: null, now: NOW, strikePlan: async () => null, strikeCamp: async () => null };
  return renderToStaticMarkup(createElement(SiegePanel));
}

function campHtml(view: CampView): string {
  stores.game = { showToast: () => {}, closeSheet: () => {} };
  stores.world = { camp: view, loadCamp: async () => {}, besiege: async () => null, attack: async () => null, retreat: async () => null, setWood: async () => null, campCraft: async () => null };
  return renderToStaticMarkup(createElement(CampPanel));
}

describe('окно осады у обороняющегося', () => {
  it('пустой гарнизон: в казармы не зовёт — в осаде найм закрыт; говорит, что остаётся', () => {
    // Посылка правила: найм в осаде закрыт той же проверкой, что у казарм.
    const s = createInitialState();
    s.siege = { until: NOW + 3_600_000 } as typeof s.siege;
    expect(recruitCheck(s, 'clubman', 1).blocked).toBe(SIEGE_NO_RECRUIT);
    const html = siegeHtml(siege());
    expect(html, 'точка внутри области: гарнизона нет').toContain('В гарнизоне никого');
    expect(html).toContain(NO_GARRISON);
    expect(html).not.toContain('В казармы');
    expect(html).not.toContain('Найми дубинщиков');
  });

  it('износ осады — своей строкой; без поля строки нет', () => {
    const html = siegeHtml(siege({ wear: 0.85 }));
    expect(html).toContain(wearLine(0.85));
    expect(wearLine(0.85)).toContain('слабее на 15 %');
    const plain = siegeHtml(siege());
    expect(plain).not.toContain('Осада точит');
  });
});

describe('окно лагеря у осаждающего', () => {
  it('под городом соседа древесину не делят: строка вместо пяти кнопок, которые только отказывали бы', () => {
    const html = campHtml(camp({ woodFixed: WOOD_FIXED }));
    expect(html).toContain(WOOD_FIXED);
    for (const name of ['Всё к городу', 'Три четверти', 'Поровну', 'Четверть', 'Всё в тыл']) expect(html, name).not.toContain(`>${name}<`);
    // Под логовом — кнопки на месте.
    const lair = campHtml(camp({ castle: false, lair: true }));
    expect(lair).toContain('>Поровну<');
  });

  it('гарнизон — вилкой той же точности, что мощь; выручка — кто, сколько, когда', () => {
    const relief = { from: 'Бета', men: 50, at: NOW + 3_600_000, joint: true };
    const html = campHtml(camp({ relief }));
    const g = estimate(60, 'rough');
    expect(g.precision, 'точка внутри области: оценка не точная').toBe('rough');
    expect(html).toContain(`${g.min}–${g.max}`);
    expect(html).not.toContain('Гарнизон 60');
    // Строка выручки — той функцией, что окно (срок — от часов окна, поэтому сверяется начало строки).
    expect(html).toContain('На лагерь идёт выручка: «Бета», 50 бойцов.');
    expect(html).toContain('гарнизон выйдет навстречу');
    expect(reliefLine({ ...relief, joint: false }, NOW)).not.toContain('навстречу');
  });
});
