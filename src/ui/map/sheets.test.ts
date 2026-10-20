// Листы карты (UI-7, docs/ui_v2.md, 5.6; П9–П11): рейтинг — таблицей, числа столбцами, очки строки — разбором весами договора
// (`ratingPoints` — одна формула с сервером), внизу дверь «На карте»; молва края — таблицей с дверью к месту; «Походы» —
// люди, отряды и донесения таблицами, донесений видно восемь свежих, остальные — по «Ещё N».
//
// Области (правило 11): строка рейтинга с победами и взятыми городами (все три слагаемых не ноль) и с дробной мощью; походы —
// донесений больше предела и меньше него.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { createInitialState } from '@/game/state';
import type { FigureView, Report } from '@/world/types';
import { RATING_WEIGHTS, ratingPoints, type RatingRow } from '../../../netlify/lib/contract';
import { REST_LABEL } from '@/ui/kit/breakdown';

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

import { RATING_COLS, pointsTip } from './Rating';
import { MarchesNew, REPORTS_SHOWN } from '@/ui/next/MarchesNew';

const code = (rel: string): string =>
  readFileSync(join(__dirname, rel), 'utf8')
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/\{\/\*[\s\S]*?\*\/\}/g, ' ')
    .replace(/(^|[^:])\/\/.*$/gm, '$1');

describe('рейтинг — таблица, очки с разбором (П11)', () => {
  const row = (power: number, won: number, taken: number): RatingRow => ({
    place: 2,
    id: 'c-1',
    x: 10,
    y: 12,
    city: 'Белый Брод',
    name: 'Ольгерд',
    points: ratingPoints(power, won, taken),
    power,
    pop: 340,
    won,
    taken,
  });

  it('мощь, победы и взятые города складываются в очки сервера; «Прочее» нет; внизу — «На карте»', () => {
    // Область: все три слагаемых не ноль, мощь дробная (очки округлены).
    const r = row(812.4, 3, 1);
    expect(r.won * RATING_WEIGHTS.win > 0 && r.taken * RATING_WEIGHTS.taken > 0).toBe(true);
    let shown = false;
    const t = pointsTip(r, () => (shown = true));
    expect(t.rows?.map((x) => x.label)).toHaveLength(3);
    expect(t.rows?.map((x) => x.label)).not.toContain(REST_LABEL);
    expect(t.link?.label).toBe('На карте');
    t.link!.go();
    expect(shown).toBe(true);
    // Без побед и взятых — одна строка мощи.
    expect(pointsTip(row(230, 0, 0), () => {}).rows?.map((x) => x.label)).toEqual(['Мощь']);
  });

  it('столбцы — место, город и пять чисел; строки «через точки» нет', () => {
    expect(RATING_COLS.map((c) => c.key)).toEqual(['place', 'city', 'points', 'power', 'pop', 'won', 'taken']);
    const src = code('Rating.tsx');
    expect(src).toContain('<Table');
    expect(src).not.toMatch(/rowFacts|wm-rrow/);
  });

  it('молва края — таблица: касание — строка записи, «›» — к месту на карте', () => {
    const src = code('Feed.tsx');
    expect(src).toContain('<Table');
    expect(src).toMatch(/go: \(\) => show\(x\)/);
    expect(src).not.toContain('wm-rrow');
  });
});

describe('«Походы» таблицами (П10)', () => {
  const figure = (id: FigureView['id'], over: Partial<FigureView> = {}): FigureView =>
    ({
      id,
      name: id,
      icon: '•',
      phase: 'idle',
      place: 'map',
      at: { x: 5, y: 5 },
      from: { x: 5, y: 5 },
      to: { x: 5, y: 5 },
      departAt: 0,
      arriveAt: 0,
      sight: 3,
      atId: null,
      atName: 'Белый Брод',
      atHome: false,
      downUntil: 0,
      held: false,
      gone: null,
      retiring: false,
      busyUntil: 0,
      troops: {},
      ...over,
    }) as FigureView;
  const report = (i: number): Report =>
    ({ id: `r${i}`, at: NOW - i, kind: 'raid', title: `Бой ${i}`, text: 'Логово взято.', won: i % 2 === 0, read: i > 2 }) as unknown as Report;

  function html(reports: number): string {
    const s = createInitialState(7);
    stores.game = { s, showToast: () => {}, closeSheet: () => {}, openReport: () => {} };
    stores.world = {
      marches: [],
      info: { homeId: 'home' },
      reports: Array.from({ length: reports }, (_, i) => report(i)),
      figures: [figure('scout'), figure('diplomat', { place: 'city' }), figure('spy', { place: 'vacant', gone: 'died' }), figure('general', { atHome: true })],
      openChase: async () => null,
      recall: async () => null,
      loadReports: async () => {},
      markRead: async () => {},
      select: async () => {},
      recallFigure: async () => null,
      shelter: async () => null,
      setAnchor: () => {},
      pick: () => {},
    };
    return renderToStaticMarkup(h(MarchesNew));
  }

  it('люди — строкой таблицы со столбцами уровня, бойцов и энергии; действия — значками 44', () => {
    const out = html(0);
    expect(out).toMatch(/aria-label="Люди"/);
    for (const k of ['Ур.', 'Бойц.', 'Эн.']) expect(out).toContain(`>${k}<`);
    expect(out.match(/class="mr-who"/g)?.length, 'имя каждого человека — кнопка карточки').toBe(4);
    // Разведчик в поле: домой и в руку; дипломат в городе: выйти; генерал дома: только в руку.
    expect(out).toContain('aria-label="scout: домой"');
    expect(out).toContain('aria-label="scout: послать"');
    expect(out).toContain('aria-label="diplomat: выйти из города"');
    expect(out).not.toContain('aria-label="general: домой"');
    expect(out).toContain('Донесений нет.');
  });

  it(`донесений видно ${REPORTS_SHOWN} свежих и «Ещё N»; меньше предела — все и без кнопки`, () => {
    const many = html(REPORTS_SHOWN + 3);
    expect(many.match(/class="kit-go"/g)?.length).toBe(REPORTS_SHOWN);
    expect(many).toContain('Ещё 3');
    const few = html(REPORTS_SHOWN - 2);
    expect(few.match(/class="kit-go"/g)?.length).toBe(REPORTS_SHOWN - 2);
    expect(few).not.toMatch(/Ещё \d/);
  });
});
