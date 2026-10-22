// РТ-2 (docs/stability.md, «РТ-2»): окно «Сословия» в Ратуше — специализация, пять карточек с гербом, полосами и пользой, лист
// сословия; указы сословий в «Указах» с лояльностью и замком; строки ропота в разделе «Стабильность». Своих чисел у окна нет:
// каждое число сверяется с меркой игры (`derived.estatesNow`).
//
// Окна рисуются в строку (`renderToStaticMarkup`) с партией теста: стор игры подменён видом, как в `rt1.test.ts`.
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { EstateId, GameState } from '@/game/types';
import { createInitialState } from '@/game/state';
import { estatesNow } from '@/game/derived';
import { ESTATES, ESTATE_DOMINANT, ESTATE_HALLS, LOYAL } from '@/game/estaterules';
import { ESTATE_META } from '@/game/data/estates';
import { ESTATE_DECREE } from '@/game/data/policy';
import { grantPrivilege } from '@/game/sim/estates';
import { folkCauses } from '@/game/sim/stabview';
import { cityOf, estateRows, grantPreview, leverWords } from './estates';
import { estateDecreeCells } from '@/ui/realm/decrees';

const { stores, fake } = vi.hoisted(() => ({
  stores: { game: {} as Record<string, unknown> },
  fake: <T extends object>(real: T, view: () => Record<string, unknown>): T => Object.assign((sel: (g: unknown) => unknown) => sel(view()), real),
}));
vi.mock('@/game/store', async (orig) => {
  const real = await orig<{ useGame: object }>();
  return { ...real, useGame: fake(real.useGame, () => stores.game) };
});

/** Город теста: подсказка раздела уже прочитана, золото есть. */
function town(over: (s: GameState) => void = () => {}): GameState {
  const s = createInitialState(7);
  s.faith.id = 'catholic';
  s.gold = 50_000;
  s.hints = { seen: ['estates'] };
  over(s);
  return s;
}

const view = (s: GameState): void => {
  stores.game = { s, act: () => true, sheet: null, openBuilding: () => undefined, closeSheet: () => undefined, townTab: 'estates', setTownTab: () => undefined, showToast: () => undefined };
};

const raise = (s: GameState, e: EstateId, level: number): void => {
  for (const b of s.buildings) if (ESTATE_HALLS[e].includes(b.type)) b.level = level;
};

describe('окно «Сословия»', () => {
  it('ровный город: пять карточек с гербом, «Ровный город», ни пользы, ни цены', async () => {
    const { HallEstates } = await import('./HallEstates');
    const s = town();
    view(s);
    const html = renderToStaticMarkup(h(HallEstates));
    expect(html.match(/class="es-card /g)?.length).toBe(ESTATES.length);
    for (const e of ESTATES) expect(html).toContain(ESTATE_META[e].name);
    expect(html).toContain('Ровный город');
    expect(html.match(/Без силы/g)?.length).toBe(ESTATES.length);
  });

  it('опора и перевес: специализация её именем, рамка перевеса, польза и цена — числами мерки игры', async () => {
    const { HallEstates } = await import('./HallEstates');
    const s = town((g) => raise(g, 'merchants', 8));
    expect(grantPrivilege(s, 'merchants')).toBeNull();
    expect(grantPrivilege(s, 'merchants')).toBeNull();
    const n = estatesNow(s).merchants;
    expect(n.infl, 'точка внутри: перевес').toBeGreaterThanOrEqual(ESTATE_DOMINANT);
    view(s);
    const html = renderToStaticMarkup(h(HallEstates));
    expect(cityOf(s).name).toBe(ESTATE_META.merchants.kind);
    expect(html).toContain(ESTATE_META.merchants.kind);
    expect(html).toContain('es-card merchants dominant');
    const w = leverWords('merchants', n);
    expect(html).toContain(w.plus);
    expect(html).toContain(w.minus);
    const row = estateRows(s).find((r) => r.id === 'merchants')!;
    expect(row.loyalty).toBeCloseTo(n.loyalty, 9);
    expect(html).toContain(`${Math.round(n.infl)}\u00a0%`);
  });

  it('ропот: пренебрежённые с ярлыком на карточке и строкой своего имени у податных; примерка дарования — та же мерка', async () => {
    const { HallEstates } = await import('./HallEstates');
    const s = town();
    for (const e of ['merchants', 'merchants', 'knights', 'knights'] as EstateId[]) expect(grantPrivilege(s, e)).toBeNull();
    view(s);
    const html = renderToStaticMarkup(h(HallEstates));
    expect(html).toMatch(/ропот \+\d+ %/);
    expect(folkCauses(s).map((l) => l.name)).toContain('Цехи ропщут');
    expect(folkCauses(s).map((l) => l.name)).toContain('Крестьянство ропщет');
    const p = grantPreview(s, 'guilds');
    const g = p.rows.find((r) => r.id === 'guilds')!;
    expect(g.loyalty[0]).toBeCloseTo(estatesNow(s).guilds.loyalty, 9);
    // После дарования: своя +P, и влияние растёт на долю привилегии — мерой игры на копии.
    expect(grantPrivilege(s, 'guilds')).toBeNull();
    expect(g.loyalty[1]).toBeCloseTo(estatesNow(s).guilds.loyalty, 9);
    expect(g.infl[1]).toBeCloseTo(estatesNow(s).guilds.infl, 9);
  });
});

describe('указы сословий в «Указах»', () => {
  it('пять строк; закрыт — пока лояльность ниже порога; «даст» — плюс сословия с указом', () => {
    const s = town();
    const rows = estateDecreeCells(s);
    expect(rows.map((r) => r.id)).toEqual(ESTATES.map((e) => ESTATE_DECREE[e]));
    for (const r of rows) expect(r.open, r.id).toBe(false);
    expect(grantPrivilege(s, 'peasants')).toBeNull();
    const peas = estateDecreeCells(s).find((r) => r.estate === 'peasants')!;
    expect(peas.loyalty, 'точка внутри: верны').toBeGreaterThanOrEqual(LOYAL);
    expect(peas.open).toBe(true);
    expect(peas.gives).toBe(leverWords('peasants', estatesNow({ ...s, decree: ESTATE_DECREE.peasants }).peasants).plus);
  });
});
