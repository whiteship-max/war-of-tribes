// «Дружина» ДР-1 (docs/siege_v2.md, «Решения ДР-1»): окно уже имеющегося войска — без найма (двери в Казармы и Конюшню), мораль
// и дисциплина с разбором, жалованье полное или минимальное и роспуск с тем, что вернётся. Найм — в Казармах, роспуска там
// больше нет. Состав плитками и роспуск в карточке вида (ДР-8) — `dr8.test.ts`; здесь вкладки «Дух» и «Жалованье» (`start`).
//
// Окно рисуется в строку (`renderToStaticMarkup`) с партией теста: сторы игры и мира подменены видом, как в `transfer.test.ts`.
// Числа на экране сверяются с функциями игры (правило 18), а не со своей арифметикой.
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createInitialState } from '@/game/state';
import type { GameState } from '@/game/types';
import { TROOP_BY_ID } from '@/game/data/troops';
import { armyWagesPerDay } from '@/game/derived';
import { WAGE_MIN_SHARE } from '@/game/spiritrules';
import { spiritView } from '@/game/sim/spirit';
import { dismissReturns, dismissSoldiers, setWageMode } from '@/game/sim/upkeep';
import { syncAway } from '@/world/bridge';
import type { FigureView, Regroup } from '@/world/types';
import { fmtInt } from '@/ui/next/hudTips';

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
  return { ...real, useWorld: fake(real.useWorld, () => stores.world), worldNow: () => NOW };
});

import { ArmyPanel, type ArmyTab } from '@/ui/panels/ArmyPanel';
import { Barracks } from './Barracks';

const NOW = 1_700_000_000_000;
const FREE: Regroup = { block: null, grow: null, instant: true };
const general = { id: 'general', name: 'Полководец', icon: '', phase: 'home', place: 'map', departAt: NOW, arriveAt: NOW, troops: {}, readyAt: 0, regroup: FREE, gone: null } as unknown as FigureView;

function party(over: (s: GameState) => void = () => undefined): GameState {
  const s = createInitialState(7);
  Object.assign(s.army, { spearman: 30, archer: 12, rider: 5, legionary: 4 });
  s.gold = 1e6;
  over(s);
  syncAway(s, [], [general]);
  stores.game = { s, showToast: () => undefined, openBuilding: () => undefined, act: () => undefined };
  stores.world = { marches: [], figures: [general], setGarrison: async () => null };
  return s;
}

const html = (start: ArmyTab = 'roster'): string => renderToStaticMarkup(h(ArmyPanel, { start }));

describe('меню «Дружина» без найма', () => {
  it('найма нет: ни очереди найма, ни кнопки «Нанять» — двери в Казармы (и Конюшню, если она есть)', () => {
    party();
    const out = html();
    expect(out).not.toContain('>Нанять<');
    expect(out, 'очереди найма казарм нет').not.toMatch(/Новобранцев можно|В очередь/);
    expect(out).toContain('Казармы');
    expect(out).toContain('<h3>Найм</h3>');
  });

  it('в Казармах — найм, а роспуска и жалованья больше нет: дверь в «Дружину»', () => {
    party();
    const out = renderToStaticMarkup(h(Barracks));
    expect(out).not.toContain('Роспуск');
    expect(out).not.toContain('распустить');
    expect(out).toContain('жалованье, дух, роспуск');
  });
});

describe('мораль и дисциплина: две шкалы, жалованье и «что влияет»', () => {
  it('шкалы — числами двери духа, строка жалованья и что это даёт в бою', () => {
    const s = party();
    const v = spiritView(s);
    const out = html('spirit');
    expect(out).toContain('Мораль');
    expect(out).toContain('Дисциплина');
    expect(out).toContain(`>${Math.round(v.morale.value)}<`);
    expect(out).toContain('Жалованье полное: дух держится у потолка.');
    expect(out).toMatch(/В бою: стойкость <b>×/);
  });

  it('жалованье — две плитки с ценой в день: полное и минимальное (доля WAGE_MIN_SHARE)', () => {
    const s = party();
    const full = armyWagesPerDay(s);
    const out = html('wage');
    expect(out).toContain(`Полное: ${fmtInt(Math.round(full))} золота в день`);
    expect(out).toContain(`Минимальное: ${fmtInt(Math.round(full * WAGE_MIN_SHARE))} золота в день`);
    expect(out).toMatch(/role="radio" aria-checked="true" aria-label="Полное/);
  });

  it('урезал жалованье — плитка «Минимальное» выбрана, строка духа говорит, что дух падает', () => {
    party((s) => {
      setWageMode(s, 'min');
    });
    expect(html('wage')).toMatch(/role="radio" aria-checked="true" aria-label="Минимальное/);
    expect(html('spirit')).toContain('Жалованье минимальное: дух падает, до дна ~');
  });
});

describe('роспуск: показанное — ровно то, что случится', () => {
  it('жители и снаряжение на складе после роспуска трёх — `dismissReturns` тех же трёх', () => {
    const s = party();
    const n = 3;
    const back = dismissReturns('spearman', n);
    const pop = s.pop;
    const gear = { ...s.equipment };
    expect(Object.keys(back.gear).length, 'у копейщика есть снаряжение').toBeGreaterThan(0);
    expect(dismissSoldiers(s, 'spearman', n)).toBeNull();
    expect(s.pop - pop).toBe(back.people);
    for (const [id, k] of Object.entries(back.gear)) expect((s.equipment[id as keyof typeof s.equipment] ?? 0) - (gear[id as keyof typeof gear] ?? 0), id).toBe(k);
    // И само число — снаряжение вида на каждого из трёх (данные вида), а не только «показ равен делу».
    for (const [id, per] of Object.entries(TROOP_BY_ID.spearman.gear)) expect(back.gear[id as keyof typeof back.gear], id).toBe((per ?? 0) * n);
    expect(s.army.spearman).toBe(30 - n);
  });
});

