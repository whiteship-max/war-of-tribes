// Передача в «Дружине» (UI-4, docs/ui_v2.md, 5.3): две колонки — гарнизон и отряд, — шаг по каждому виду, итог мощи и
// жалованья «было → станет» функциями игры, одна кнопка «Подтвердить» и строка «в городе — защищает стены».
//
// Окно рисуется в строку (`renderToStaticMarkup`) с партией теста: сторы игры и мира подменены видом, как в тесте ратуши
// (`next/hall.test.ts`). Области (правило 11) названы в каждом блоке и проверяются утверждениями: полководец в городе с
// отрядом и без, в поле, в городе во время сбора.
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import { TAP_SLIP, TAP_TARGET } from '@/gestures';
import { createInitialState } from '@/game/state';
import type { GameState } from '@/game/types';
import { TROOP_BY_ID, TROOP_IDS } from '@/game/data/troops';
import { armySize, homeArmy, wageOf } from '@/game/derived';
import { troopPower } from '@/game/battle/price';
import { troopTotal, troopsAfter, type TroopStack } from '@/game/battle/kinds';
import { seeded } from '@/game/sim/random';
import { syncAway } from '@/world/bridge';
import { inTown } from '@/world/muster';
import type { FigureView, MarchView, Regroup } from '@/world/types';
import { REST_LABEL } from '@/ui/kit/breakdown';
import { fmtInt, fmtRate } from '@/ui/next/hudTips';

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

import { ArmyPanel } from '@/ui/panels/ArmyPanel';
import { inWallsTip, outWallsTip, shift, sideOf, sideTip, transferSums } from './Muster';
import { postureLine } from './MusterLink';

const NOW = 1_700_000_000_000;
const ARMY: TroopStack = { clubman: 40, archer: 16, spearman: 12, rider: 6 };
const HELD: TroopStack = { clubman: 10, archer: 4 };
const FREE: Regroup = { block: null, grow: null, instant: true };

/** Вид полководца из пульса — те поля, что читает окно. */
function general(over: Partial<FigureView>): FigureView {
  return {
    id: 'general',
    name: 'Полководец',
    icon: '🎖️',
    phase: 'home',
    place: 'map',
    departAt: NOW - 60_000,
    arriveAt: NOW - 60_000,
    troops: { ...HELD },
    readyAt: 0,
    regroup: FREE,
    gone: null,
    ...over,
  } as FigureView;
}

const march = (troops: TroopStack): MarchView =>
  ({ id: 'm1', mission: 'support', units: {}, troops, own: true, hostile: false, phase: 'out' }) as unknown as MarchView;

/** Партия: войско `ARMY`, полководец `g`, отряды `marches`; `s.away` сведён тем же мостом, что у игры. */
function party(g: FigureView, marches: MarchView[] = []): GameState {
  const s = createInitialState(7);
  Object.assign(s.army, ARMY);
  syncAway(s, marches, [g]);
  stores.game = { s, showToast: () => undefined, openBuilding: () => undefined };
  stores.world = { marches, figures: [g], setGarrison: async () => null };
  return s;
}

/** Строки вида: имя и число гарнизона из двери карточки, число отряда — из шага (или числом, когда менять нельзя). */
function rowsOf(html: string): { name: string; garrison: string }[] {
  return [...html.matchAll(/aria-label="([^"]+): карточка вида"[^>]*>(?:(?!<\/button>)[\s\S])*?<small[^>]*>[^<]*<\/small><b>([^<]+)<\/b>/g)].map((m) => ({
    name: m[1],
    garrison: m[2],
  }));
}
const count = (html: string, s: string): number => html.split(s).length - 1;

describe('передача: две колонки, шаг по видам, итог и одна кнопка — полководец в городе', () => {
  it('гарнизон и отряд по каждому виду, шаг у каждого, кнопка одна', () => {
    const g = general({});
    const s = party(g);
    // Область: полководец в городе, менять можно.
    expect(inTown(g), 'точка внутри области: в городе').toBe(true);
    const html = renderToStaticMarkup(h(ArmyPanel));
    const kinds = TROOP_IDS.filter((t) => (ARMY[t] ?? 0) > 0);
    const rows = rowsOf(html);
    expect(rows.map((r) => r.name), 'строка на каждый вид в дружине').toEqual(kinds.map((t) => TROOP_BY_ID[t].name));
    for (const [i, t] of kinds.entries()) {
      expect(rows[i].garrison, `${t}: гарнизон — всё минус отряд`).toBe(fmtInt((ARMY[t] ?? 0) - (HELD[t] ?? 0)));
    }
    expect(count(html, 'aria-label="К полководцу 10"'), 'шаг «+10» у каждого вида').toBe(kinds.length);
    expect(count(html, 'aria-label="В гарнизон"'), 'шаг «−» у каждого вида').toBe(kinds.length);
    const nums = [...html.matchAll(/<span class="n">(\d+)<\/span>/g)].map((m) => Number(m[1]));
    expect(nums, 'в шаге — число отряда').toEqual(kinds.map((t) => HELD[t] ?? 0));
    expect(count(html, '>Подтвердить<'), 'кнопка одна').toBe(1);
    expect(html, 'приказ тот же — кнопка гаснет с причиной').toMatch(/disabled=""[^>]*><span>Подтвердить<\/span><\/button><small class="kit-why">Раскладка та же<\/small>/);
    // Колонки названы, прежнего окна за строкой нет, прежнего списка «Состав» нет.
    expect(html).toContain('Гарнизон');
    expect(html).toContain('Отряд');
    expect(html, 'прежнего окна «Раскладка» нет').not.toMatch(/nx-rk/);
    expect(html, 'прежнего списка «Состав» нет').not.toContain('Состав дружины');
    // Виды без бойцов — значками-дверями в карточку: карточка у каждого из девяти видов достижима.
    expect(count(html, ': карточка вида"'), 'дверь в карточку — у всех видов').toBe(TROOP_IDS.length);
    expect(armySize(s)).toBe(troopTotal(ARMY));
  });

  it('итог «было → станет» — мощь `troopPower`, жалованье `wageOf`; в городе — «защищает стены»', () => {
    const g = general({});
    const s = party(g);
    const html = renderToStaticMarkup(h(ArmyPanel));
    const garrison = troopsAfter(ARMY, HELD);
    expect(html, 'мощь гарнизона').toContain(`>${fmtInt(Math.round(troopPower(garrison)))}<`);
    expect(html, 'мощь отряда').toContain(`>${fmtInt(Math.round(troopPower(HELD)))}<`);
    const wages = (t: TroopStack): number => TROOP_IDS.reduce((n, id) => n + (t[id] ?? 0) * wageOf(s, id), 0);
    expect(html, 'жалованье гарнизона').toContain(`>${fmtRate(wages(garrison))}<`);
    expect(html, 'жалованье отряда').toContain(`>${fmtRate(wages(HELD))}<`);
    expect(html, 'строка полководца').toContain('В городе — защищает стены');
  });

  // Решение владельца 16.10.2026 (docs/ui_v2.md, 6.10): полководец в городе без отряда защищает стены. Прежде строка
  // говорила «В городе, отряда нет» — оборону он вёл только с отрядом.
  it('полководец в городе без отряда — «защищает стены, отряда нет»; в поле — шага нет, город не защищает', () => {
    const empty = general({ troops: {} });
    expect(postureLine(empty, NOW)).toBe('В городе — защищает стены, отряда нет');
    const out = general({ phase: 'field', regroup: { block: 'Отряд собирают только у своего города.', grow: null, instant: false } });
    // Область: полководец не в городе.
    expect(inTown(out), 'точка внутри области: в поле').toBe(false);
    party(out);
    const html = renderToStaticMarkup(h(ArmyPanel));
    expect(html).toContain('В походе — город не защищает');
    expect(html, 'отказ — словами мира').toContain('Отряд собирают только у своего города.');
    expect(count(html, 'aria-label="К полководцу'), 'менять нельзя — шага нет').toBe(0);
    expect(count(html, '>Подтвердить<'), 'и кнопки нет').toBe(0);
  });

  // Сбор в городе — из сохранения прежних правил: с 16.10.2026 перевод в городе мгновенный и в осаде (6.11).
  it('в городе во время сбора (роспуск в осаде по прежним правилам) — «защищает стены», и срок сбора виден', () => {
    const g = general({ readyAt: NOW + 3_600_000, regroup: { block: 'Отряд ещё в сборе: 1 ч.', grow: null, instant: false } });
    // Область: полководец в городе, сбор идёт.
    expect(inTown(g), 'точка внутри области: в городе').toBe(true);
    expect(g.readyAt, 'точка внутри области: сбор идёт').toBeGreaterThan(NOW);
    const line = postureLine(g, NOW);
    expect(line, 'в сборе в городе — у стен').toMatch(/^В городе — защищает стены · сбор ещё /);
  });
});

describe('итог передачи — функциями игры, разбор без «Прочее»', () => {
  it('две колонки вместе — всё войско, до приказа и после, на случайных раскладках', () => {
    const s = party(general({}));
    const rnd = seeded(41);
    let changed = 0;
    for (let i = 0; i < 60; i++) {
      const all: TroopStack = {};
      const held: TroopStack = {};
      const want: TroopStack = {};
      for (const id of TROOP_IDS) {
        const n = Math.floor(rnd() * 40);
        if (n === 0) continue;
        all[id] = n;
        held[id] = Math.floor(rnd() * (n + 1));
        want[id] = Math.floor(rnd() * (n + 1));
      }
      const sums = transferSums(s, all, held, want);
      const whole = sideOf(s, all);
      for (const when of ['was', 'will'] as const) {
        expect(sums.garrison[when].power + sums.retinue[when].power, `${i}: мощь ${when}`).toBeCloseTo(whole.power, 9);
        expect(sums.garrison[when].wages + sums.retinue[when].wages, `${i}: жалованье ${when}`).toBeCloseTo(whole.wages, 9);
      }
      expect(sums.retinue.was.power, `${i}: отряд до — тот, что есть`).toBeCloseTo(troopPower(held), 9);
      expect(sums.retinue.will.power, `${i}: отряд после — тот, что станет`).toBeCloseTo(troopPower(want), 9);
      for (const key of ['power', 'wages'] as const) {
        const tip = sideTip(s, 'x', want, key, sums.retinue.was[key]);
        expect(tip.rows?.map((r) => r.label), `${i}: ${key} — без «Прочее»`).not.toContain(REST_LABEL);
      }
      if (troopPower(held) !== troopPower(want)) changed++;
    }
    expect(changed, 'область: раскладки, где отряд меняется, есть').toBeGreaterThan(30);
    expect(shift(37, 57, String)).toBe('37 → 57');
    expect(shift(37, 37, String)).toBe('37');
  });

  it('«В обороне» — гарнизон и отряд в городе; «Не в обороне» — по видам; оба без «Прочее»', () => {
    // В городе с отрядом и с отрядом в пути: отряд в городе — строкой, ушедшие — не в обороне.
    const away = march({ spearman: 5 });
    const inside = general({});
    const s = party(inside, [away]);
    const tip = inWallsTip(s, [away], [inside]);
    expect(tip.rows?.map((r) => r.label)).not.toContain(REST_LABEL);
    expect(tip.rows?.find((r) => r.label === 'Отряд в городе')?.value, 'точка внутри области: отряд в городе — строкой').toBe(fmtInt(troopTotal(HELD)));
    expect(tip.sum?.value).toBe(fmtInt(homeArmy(s)));
    const out = outWallsTip(s);
    expect(out.rows?.map((r) => r.label)).not.toContain(REST_LABEL);
    expect(out.sum?.value, 'не в обороне — ушедшие в пути').toBe('5');
    // Полководец в поле: отряда в обороне нет, он — не в обороне.
    const field = general({ phase: 'field' });
    const t = party(field);
    const tip2 = inWallsTip(t, [], [field]);
    expect(tip2.rows?.map((r) => r.label)).not.toContain(REST_LABEL);
    expect(tip2.rows?.some((r) => r.label === 'Отряд в городе'), 'в поле — отряда в обороне нет').toBe(false);
    expect(outWallsTip(t).sum?.value, 'отряд в поле — не в обороне').toBe(fmtInt(troopTotal(HELD)));
  });
});

describe('касание передачи — не мельче порогов судьи', () => {
  const CSS = readFileSync(join(__dirname, 'muster.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const prop = (sel: string, name: string): number | null => {
    const v = [...CSS.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
      .filter(([, s]) => s.split(',').map((x) => x.trim()).includes(sel))
      .map(([, , body]) => body.match(new RegExp(`(?:^|[;\\s])${name}:\\s*([^;]+)`))?.[1].trim())
      .filter((x): x is string => x !== undefined)
      .pop();
    if (!v) return null;
    if (v === 'var(--tap)') return TAP_TARGET;
    const m = v.match(/^(\d+)px$/);
    return m ? Number(m[1]) : null;
  };
  it('вид — дверь 44, кнопки шага — 44, виды без бойцов — 44, ячейки итога верха — не мельче справки', () => {
    expect(prop('.ms-kind', 'min-height')).toBeGreaterThanOrEqual(TAP_TARGET);
    expect(prop('.ms-steps .stepper.wide-steps button', 'width')).toBeGreaterThanOrEqual(TAP_TARGET);
    expect(prop('.ms-steps .stepper.wide-steps button', 'height')).toBeGreaterThanOrEqual(TAP_TARGET);
    expect(prop('.ms-more-b', 'width')).toBeGreaterThanOrEqual(TAP_TARGET);
    expect(prop('.ms-more-b', 'height')).toBeGreaterThanOrEqual(TAP_TARGET);
    expect(prop('.ms-sum .kit-num', 'min-height')).toBeGreaterThanOrEqual(TAP_SLIP + 1);
  });
});
