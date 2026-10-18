// Меню приказов по отзывам тестеров (docs/feedback.md, ОТ-1): подтверждение шага разведчика и дорога набега под
// полководцем. Меню рисуется в строку с подменёнными сторами — тем же приёмом, что карточка клетки (`next/card.test.ts`).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createInitialState } from '@/game/state';
import { formatCoord } from '@/world/geo';
import { waitLeft } from '@/ui/parts/wait';
import type { ActionMenuState } from '@/world/store';
import type { FigureView, MarchView } from '@/world/types';

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

import { ActionMenu } from './ActionMenu';

const CELL = { x: 31, y: 17 };
const LEAD = { seconds: 420, caught: 0, peril: 0, perilWhy: [], at: NOW } as unknown as ActionMenuState['lead'];

function figure(id: FigureView['id']): FigureView {
  return { id, name: id, icon: '·', phase: 'home', place: 'map', departAt: NOW, arriveAt: NOW, readyAt: 0, gone: null } as unknown as FigureView;
}

function render(menu: Partial<ActionMenuState>): string {
  const noop = () => undefined;
  stores.game = { s: createInitialState(7), showToast: noop, openSiege: noop, openCamp: noop };
  stores.world = {
    menu: { cell: CELL, target: null, name: 'Пустая земля', card: null, march: null, plan: null, lead: LEAD, ...menu },
    orders: [],
    figures: [figure('general'), figure('scout')],
    info: { home: { x: 0, y: 0 }, homeId: 'home' },
    closeMenu: noop,
    moveFigure: noop,
    order: noop,
    intercept: noop,
    watch: noop,
    shelter: noop,
  };
  return renderToStaticMarkup(h(ActionMenu));
}

describe('шаг разведчика — подтверждением (отзыв 11.10)', () => {
  it('разведчик на пустую землю: куда, сколько идти, «Отправить» и «Отмена»', () => {
    const html = render({ agent: 'scout' });
    expect(html).toContain(formatCoord(CELL));
    expect(html).toContain(`Идти ${waitLeft(LEAD!.seconds)}.`);
    expect(html).toContain('>Отправить<');
    expect(html).toContain('>Отмена<');
  });
  it('другой человек на пустую землю — прежнее «Вести сюда», без «Отмены»', () => {
    const html = render({ agent: 'diplomat' });
    expect(html).toContain('>Вести сюда<');
    expect(html).not.toContain('>Отмена<');
  });
  it('карта открывает меню на каждый шаг разведчика, а не ведёт молча', () => {
    const map = readFileSync(join(__dirname, 'WorldMap.tsx'), 'utf8');
    expect(map).toMatch(/if \(target \|\| enemy \|\| across \|\| hand === 'scout' \|\|/);
  });
});

describe('дорога набега под полководцем (отзыв 18.10)', () => {
  const march = { id: 'm1', fromName: 'Логово', toName: 'дом', arriveAt: NOW + 3_600_000, hostile: true, own: false, phase: 'out' } as unknown as MarchView;
  it('на пути набега — «встать мало, боя не будет» и перехват', () => {
    const html = render({ agent: 'general', march, across: true });
    expect(html).toContain('Просто встать на пути мало');
    expect(html).toContain('Перехватить');
  });
  it('касание самого отряда — перехват без строки про дорогу', () => {
    const html = render({ agent: 'general', march });
    expect(html).toContain('Перехватить');
    expect(html).not.toContain('Просто встать на пути мало');
  });
});
