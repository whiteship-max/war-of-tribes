// Торговля (РН-1, docs/city_v3.md, «Решения РН-1»; П12): рынок — плитки всех товаров (цена покупки и продажи, у тебя и на
// рынке) и панель сделки; цена штуки — с разбором (основа привоза и сбитие), строки складываются в неё; порядок после
// покупки невольников — числом и словом порога; лавка «Сокровищницы» — таблица «Запас +100 · Места · Цена».
//
// Области (правило 11): рынок стоит, привоз дневной; есть привезённый товар со склада, вещь кузни, невольники и груз в пути;
// цена — после скупки (сбитие не ноль); порядок — до ропота и за ним.
import { createElement as h } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import type { GameState } from '@/game/types';
import { createInitialState } from '@/game/state';
import { ORDER_UNREST } from '@/game/constants';
import { BONDED_GOOD, GOODS } from '@/game/data/market';
import { RESOURCE_IDS } from '@/game/constants';
import { bondedIncoming, bondedTotal, orderBreakdown } from '@/game/derived';
import {
  inTransit,
  marketCheck,
  marketDepth,
  marketHas,
  marketLeft,
  marketOffer,
  marketPrice,
  marketPurse,
  marketSellPrice,
  saleCheck,
} from '@/game/sim/market';
import { buyGoods } from '@/game/sim/actions';
import { SHOP_GOODS, SHOP_LOT } from '@/game/sim/gems';
import { REST_LABEL } from '@/ui/kit/breakdown';

const { stores, fake, NOW } = vi.hoisted(() => ({
  /** 10:00 UTC — привоз 09:00–12:00 (сетка РН-1б): окно рынка читает часы партии. */
  NOW: Date.UTC(2026, 9, 23, 10, 0),
  stores: { game: {} as Record<string, unknown> },
  fake: <T extends object>(real: T, view: () => Record<string, unknown>): T => Object.assign((sel: (g: unknown) => unknown) => sel(view()), real),
}));
vi.mock('@/net/clock', async (orig) => ({ ...(await orig<object>()), partyNow: () => NOW }));
vi.mock('@/game/store', async (orig) => {
  const real = await orig<{ useGame: object }>();
  return { ...real, useGame: fake(real.useGame, () => stores.game) };
});

import { MARKET_GOODS, MarketNew, orderAfter, ownOf, priceTip, shelfCells, shiftLine } from './MarketNew';
import { SHOP_COLS, Treasury } from './Treasury';
import { useTreasury } from '@/ui/treasury';

/** Город с рынком и золотом; первый товар со склада скуплен на треть дневного запаса — цена выросла. */
function town(): GameState {
  const s = createInitialState(7);
  s.gold = 5000;
  return s;
}

describe('плитки рынка — числами игры', () => {
  it('плитка: цена покупки и продажи, у тебя и в пути, на рынке — функциями рынка, у каждого товара', () => {
    const s = town();
    buyGoods(s, marketOffer(s, NOW).find((g) => g.resource)!.id, 3, NOW);
    // Область: рынок стоит, есть привезённый товар, вещь, невольники и груз в пути.
    expect(MARKET_GOODS).toHaveLength(GOODS.length + 1);
    expect(s.caravans.length).toBeGreaterThan(0);
    for (const def of MARKET_GOODS) {
      expect(shelfCells(s, def, NOW)).toEqual({
        buy: marketPrice(s, def, NOW),
        sell: marketSellPrice(s, def, NOW),
        own: ownOf(s, def),
        coming: inTransit(s, def.id),
        left: marketLeft(s, def, NOW),
        brought: marketHas(s, def, NOW),
      });
    }
    expect(ownOf(s, BONDED_GOOD)).toBe(bondedTotal(s));
  });

  it('цена штуки с разбором: основа привоза и сбитие; итог — `marketPrice`, «Прочее» нет', () => {
    const s = town();
    const def = marketOffer(s, NOW).find((g) => g.resource)!;
    buyGoods(s, def.id, Math.ceil(marketDepth(s, def, NOW) / 3), NOW);
    // Область: скуплено — сбитие не ноль.
    const t = priceTip(s, def, NOW);
    expect(t.rows?.map((r) => r.label)).toHaveLength(2);
    expect(t.rows?.map((r) => r.label)).not.toContain(REST_LABEL);
    expect(t.sum?.value).toBe(String(marketPrice(s, def, NOW)));
    expect(Number(t.rows?.[1].value)).toBeGreaterThan(0);
  });

  it('порядок после покупки невольников — `orderBreakdown` с теми, кого уже ведут; за порогом — слово «Ропот»', () => {
    const s = town();
    // Область: двоих уже ведут торговцы — порядок после покупки считает и их.
    buyGoods(s, BONDED_GOOD.id, 2, NOW);
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

  it('шапка: через сколько новый привоз (сетка UTC, 3 часа) — настоящими часами, серебро купцов — `marketPurse`', () => {
    const s = town();
    const head = shiftLine(s, NOW);
        // 10:00 UTC — новый привоз в 12:00: через два часа.
    expect(head.next).toBe('2 ч 0 мин');
    expect(head.purse).toBe(Math.floor(marketPurse(s, NOW)));
    expect(shiftLine(s, Date.UTC(2026, 9, 22, 23, 59)).next).toBe('1 мин');
  });
});

describe('окно рынка: плитки и панель сделки', () => {
  it('плитки — выбор товара, выбрана первая; панель — «Купить» и «Продать», количество цифрами, 1, 10, 100, «Всё»; карточек нет', () => {
    const s = town();
    stores.game = { s, act: () => {} };
    const html = renderToStaticMarkup(h(MarketNew));
    const picks = [...html.matchAll(/<button[^>]*class="mk-tile[^"]*"[^>]*>/g)].map((m) => /aria-checked="(true|false)"/.exec(m[0])?.[1]);
    expect(picks).toHaveLength(MARKET_GOODS.length);
    expect(picks.indexOf('true')).toBe(0);
    expect(html).toMatch(/role="tab"[^>]*aria-selected="true"[^>]*>Купить/);
    expect(html).toContain('Продать');
    expect(html).toMatch(/inputMode="numeric"|inputmode="numeric"/);
    for (const q of ['>1<', '>10<', '>100<', '>Всё<']) expect(html).toContain(q);
    expect(html).toContain('новый привоз через 2 ч 0 мин');
    expect(html).not.toMatch(/class="card/);
  });

  it('погашенная кнопка говорит причину: мало золота, нечего продать, рынок пуст', () => {
    const s = town();
    s.gold = 0;
    stores.game = { s, act: () => {} };
    expect(renderToStaticMarkup(h(MarketNew))).toContain('Не хватает золота.');
    const def = marketOffer(s, NOW).find((g) => g.resource)!;
    s.resources[def.resource!] = 0;
    expect(saleCheck(s, def.id, 1, NOW).blocked).toBe('Продавать нечего.');
    const gone = GOODS.find((g) => !marketHas(s, g, NOW))!;
    expect(marketCheck(s, gone.id, 1, NOW).blocked).toBe('Рынок пуст: этого не привезли.');
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
