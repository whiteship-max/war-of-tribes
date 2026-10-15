// Торговля (UI-7, docs/ui_v2.md, 5.6; П8, П12): прилавок рынка — таблица выбора, у выбранного товара — покупка с ценой «нужно
// из есть»; цена штуки — с разбором (основа и рост за скупленное), строки складываются в неё; порядок после покупки
// невольников — числом и словом порога; лавка «Сокровищницы» — таблица «Запас +100 · Места · Цена».
//
// Области (правило 11): рынок стоит (прилавок не пуст) и на нём есть товар со склада, вещь кузни и невольники; цена — после
// скупки (рост не ноль) и до неё; порядок — до ропота и за ним.
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { GameState } from '@/game/types';
import { createInitialState } from '@/game/state';
import { ORDER_UNREST } from '@/game/constants';
import { BONDED_GOOD } from '@/game/data/market';
import { RESOURCE_IDS } from '@/game/constants';
import { bondedIncoming, bondedTotal, marketLeft, marketOffer, marketPrice, marketStock, orderBreakdown } from '@/game/derived';
import { buyGoods } from '@/game/sim/actions';
import { SHOP_GOODS, SHOP_LOT } from '@/game/sim/gems';
import { REST_LABEL } from '@/ui/kit/breakdown';

const { stores, fake } = vi.hoisted(() => ({
  stores: { game: {} as Record<string, unknown> },
  fake: <T extends object>(real: T, view: () => Record<string, unknown>): T => Object.assign((sel: (g: unknown) => unknown) => sel(view()), real),
}));
vi.mock('@/game/store', async (orig) => {
  const real = await orig<{ useGame: object }>();
  return { ...real, useGame: fake(real.useGame, () => stores.game) };
});

import { MarketNew, orderAfter, ownOf, priceTip, shelfCells } from './MarketNew';
import { SHOP_COLS, Treasury } from './Treasury';
import { useTreasury } from '@/ui/treasury';

/** Город с рынком и золотом; первый товар со склада скуплен на треть дневного запаса — цена выросла. */
function town(): GameState {
  const s = createInitialState(7);
  s.gold = 5000;
  return s;
}

describe('прилавок — числами игры', () => {
  it('строка: цена следующей штуки, осталось сегодня из запаса, сколько есть — функциями рынка', () => {
    const s = town();
    const offer = marketOffer(s);
    // Область: рынок стоит, на прилавке есть товар со склада, вещь и невольники.
    expect(offer.length).toBeGreaterThan(1);
    expect(offer.some((g) => g.id === BONDED_GOOD.id)).toBe(true);
    expect(offer.some((g) => g.resource)).toBe(true);
    for (const def of offer) {
      const c = shelfCells(s, def);
      expect(c).toEqual({ price: marketPrice(s, def), left: marketLeft(s, def), stock: marketStock(s, def), own: ownOf(s, def) });
    }
    expect(ownOf(s, BONDED_GOOD)).toBe(bondedTotal(s));
  });

  it('цена штуки с разбором: основа и рост за скупленное; итог — `marketPrice`, «Прочее» нет', () => {
    const s = town();
    const def = marketOffer(s).find((g) => g.resource)!;
    const before = priceTip(s, def);
    expect(before.rows?.map((r) => r.label)).toEqual(['Основа']);
    buyGoods(s, def.id, Math.ceil(marketStock(s, def) / 3));
    // Область: скуплено — рост не ноль.
    expect(marketPrice(s, def)).toBeGreaterThan(def.price);
    const t = priceTip(s, def);
    expect(t.rows?.map((r) => r.label)).toHaveLength(2);
    expect(t.rows?.map((r) => r.label)).not.toContain(REST_LABEL);
    expect(t.sum?.value).toBe(String(marketPrice(s, def)));
  });

  it('порядок после покупки невольников — `orderBreakdown` с теми, кого уже ведут; за порогом — слово «Ропот»', () => {
    const s = town();
    // Область: двоих уже ведут торговцы — порядок после покупки считает и их.
    buyGoods(s, BONDED_GOOD.id, 2);
    expect(bondedIncoming(s)).toBe(2);
    const calm = orderAfter(s, 1);
    expect(calm.value).toBe(Math.round(orderBreakdown(s, 3).value));
    // Ропот: столько невольников, что надзор не держит.
    let n = 1;
    while (orderAfter(s, n).value >= ORDER_UNREST && n < 5000) n *= 2;
    const hot = orderAfter(s, n);
    expect(hot.value, 'область: за порогом ропота').toBeLessThan(ORDER_UNREST);
    expect(hot.tone).toBe('bad');
    expect(hot.words).toContain('Ропот');
  });
});

describe('окно рынка: таблица выбора и покупка выбранного', () => {
  it('строки прилавка — кнопки выбора, выбрана первая; покупка — шаг, цена «из есть» и «Купить»; карточек нет', () => {
    const s = town();
    buyGoods(s, marketOffer(s).find((g) => g.resource)!.id, 2);
    stores.game = { s, act: () => {} };
    const html = renderToStaticMarkup(h(MarketNew));
    const picks = [...html.matchAll(/class="kit-cells pick"[^>]*aria-pressed="(true|false)"/g)].map((m) => m[1]);
    expect(picks).toHaveLength(marketOffer(s).length);
    expect(picks.indexOf('true')).toBe(0);
    expect(html).toContain('wide-steps');
    expect(html).toMatch(/class="have">из \d/);
    expect(html).toContain('Купить');
    // Телега в пути — строкой таблицы с отменой.
    expect(html).toMatch(/aria-label="Отменить: [^"]+, вернуть \d+ золота"/);
    expect(html).not.toMatch(/class="card/);
  });
});

describe('лавка «Сокровищницы» — таблица', () => {
  it('«+100» — в шапке, строка на каждый запас лавки, цена — кнопкой; прежних карточек нет', () => {
    expect(SHOP_COLS[0].title).toBe(`Запас +${SHOP_LOT}`);
    expect(SHOP_GOODS.every((r) => (RESOURCE_IDS as string[]).includes(r))).toBe(true);
    // Вне Telegram: окна нет — плашка «нет связи» общей строкой над таблицей (строке нужен только `window`).
    vi.stubGlobal('window', {});
    stores.game = { s: town(), showToast: () => {}, sheet: null };
    useTreasury.setState({ open: true, tab: 'shop' });
    const html = renderToStaticMarkup(h(Treasury));
    expect(html.match(/nx-shop-go/g)?.length).toBe(SHOP_GOODS.length);
    expect(html).not.toContain('nx-trade-body');
    vi.unstubAllGlobals();
  });
});
