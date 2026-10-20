// Меню дел по отзывам тестеров (docs/feedback.md, ОТ-1; Р-4 — docs/AGENTS.md, раздел 16): подтверждение каждого дела,
// пустая земля без хода и дорога набега под полководцем. Меню рисуется в строку с подменёнными сторами — тем же приёмом,
// что карточка клетки (`next/card.test.ts`).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createInitialState } from '@/game/state';
import { formatCoord } from '@/world/geo';
import { realLeft } from '@/ui/parts/wait';
import type { ActionMenuState } from '@/world/store';
import type { ErrandOption, FigureView, MarchView } from '@/world/types';

const NOW = 1_900_000_000_000;

const { stores, fake } = vi.hoisted(() => ({
  stores: { game: {} as Record<string, unknown>, world: {} as Record<string, unknown> },
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
vi.mock('@/ui/map/twslot', async (orig) => ({ ...(await orig<object>()), reachable: () => true }));

import { ActionMenu, ErrandConfirm, roadWords } from './ActionMenu';

const CELL = { x: 31, y: 17 };

function figure(id: FigureView['id']): FigureView {
  return { id, name: id, icon: '·', phase: 'home', place: 'map', departAt: NOW, arriveAt: NOW, readyAt: 0, gone: null } as unknown as FigureView;
}

const errand = (o: Partial<ErrandOption>): ErrandOption => ({
  id: 'recon',
  agent: 'scout',
  name: 'Разведать',
  does: 'Дойдёт до ворот, пересчитает гарнизон и вернётся домой с донесением.',
  can: true,
  reason: null,
  walkMs: 420_000,
  backMs: 420_000,
  risk: [],
  chance: null,
  cost: {},
  energy: { price: 10, block: null },
  at: NOW,
  ...o,
});

function render(menu: Partial<ActionMenuState>): string {
  const noop = () => undefined;
  stores.game = { s: createInitialState(7), showToast: noop, openSiege: noop, openCamp: noop };
  stores.world = {
    menu: { cell: CELL, target: null, name: 'Пустая земля', card: null, march: null, plan: null, goal: null, errands: null, ...menu },
    figures: [figure('general'), figure('scout')],
    info: { home: { x: 0, y: 0 }, homeId: 'home' },
    closeMenu: noop,
    errand: noop,
    watch: noop,
    shelter: noop,
  };
  return renderToStaticMarkup(h(ActionMenu));
}

describe('дело — с подтверждением, свободной ходьбы нет (Р-4)', () => {
  it('пустая земля: дел нет, «Отправить» нет — люди ходят только к цели', () => {
    const html = render({ agent: 'scout' });
    expect(html).toContain('Люди ходят только к цели');
    expect(html).not.toContain('>Отправить<');
    expect(html).not.toContain('Вести сюда');
  });
  it('у логова — строка дела с дорогой туда и назад', () => {
    const html = render({ agent: 'scout', target: 'lair-1', name: 'Волчья падь', goal: { kind: 'place', id: 'lair-1' }, errands: [errand({})] });
    expect(html).toContain('>Разведать<');
    expect(html).toContain(`туда ${realLeft(420)}, назад ${realLeft(420)}`);
  });
  it('подтверждение: куда, что сделает, дорога, риск, «Назад» и «Отправить»', () => {
    const o = errand({ risk: ['Часовые схватят: 20 %.', 'Гибель: 3 %.'] });
    const html = renderToStaticMarkup(h(ErrandConfirm, { where: `Волчья падь · ${formatCoord(CELL)}`, o, busy: false, onBack: () => {}, onGo: () => {} }));
    for (const part of ['Куда', 'Волчья падь', o.does, 'Дорога', roadWords(o), 'Риск', 'Часовые схватят: 20 %.', '>Назад<', '>Отправить<']) {
      expect(html, part).toContain(part);
    }
  });
  it('недоступное дело — с причиной, «Отправить» погашено', () => {
    const o = errand({ can: false, reason: 'Разведчик выбился из сил.' });
    const html = renderToStaticMarkup(h(ErrandConfirm, { where: 'x', o, busy: false, onBack: () => {}, onGo: () => {} }));
    expect(html).toContain('Разведчик выбился из сил.');
    expect(html).toMatch(/<button class="nx-go" disabled="">Отправить</);
  });
  it('карта с человеком в руке по пустой земле не ведёт — строкой отвечает', () => {
    const map = readFileSync(join(__dirname, 'WorldMap.tsx'), 'utf8');
    expect(map).not.toMatch(/moveFigure/);
    expect(map).toContain('ходит только к цели');
  });
});

describe('дорога набега под полководцем (отзыв 18.10)', () => {
  const march = { id: 'm1', fromName: 'Логово', toName: 'дом', arriveAt: NOW + 3_600_000, hostile: true, own: false, phase: 'out' } as unknown as MarchView;
  const chase = [errand({ id: 'intercept', agent: 'general', name: 'Перехватить', does: 'Встретит отряд в поле до его цели и даст бой.' })];
  it('на пути набега — «встать мало, боя не будет» и перехват', () => {
    const html = render({ agent: 'general', march, across: true, goal: { kind: 'march', id: 'm1' }, errands: chase });
    expect(html).toContain('Просто встать на пути мало');
    expect(html).toContain('Перехватить');
  });
  it('касание самого отряда — перехват без строки про дорогу', () => {
    const html = render({ agent: 'general', march, goal: { kind: 'march', id: 'm1' }, errands: chase });
    expect(html).toContain('Перехватить');
    expect(html).not.toContain('Просто встать на пути мало');
  });
});
