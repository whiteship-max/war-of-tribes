// Рынок (РН-1, docs/city_v3.md, «Решения РН-1»): товары сеткой плиток и панель сделки в одном поле зрения, без прокрутки на
// 390×844. Плитка — значок, имя, цена покупки и продажи, сколько у тебя (и что везут) и сколько на рынке; касание выбирает
// товар. Панель — «Купить» и «Продать» переключателем, количество (цифрами, «− / +», 1, 10, 100, «Всё»), итог в моменте со
// сбитием и что станет у тебя, кнопка с причиной погасшей. Шапка — какой привоз, когда новый и серебро купцов.
//
// Своей арифметики нет (правило 18): цены — `marketPrice`, `marketSellPrice`, партия — `marketCheck`, `saleCheck`, «Всё» —
// `marketMax`, привоз — `marketrules.shiftOf`, порядок после невольников — `orderBreakdown`. Время — часы партии (`partyNow`).
// Едет в куске нового вида (`parts/Market` — ленивый вход): первая загрузка за окно не платит.
import { useState } from 'react';
import type { GameState, GoodId } from '@/game/types';
import { useGame } from '@/game/store';
import { MUTINY_FUSE, ORDER_UNREST, ORDER_WARN } from '@/game/constants';
import { BONDED_GOOD, GOODS, GOOD_BY_ID, type GoodDef } from '@/game/data/market';
import { ORDER_TEXT } from '@/game/data/order';
import { SHIFT, shiftOf, shiftStart } from '@/game/marketrules';
import { bondedIncoming, caravanSeconds, orderBreakdown } from '@/game/derived';
import {
  inTransit,
  marketCheck,
  marketDepth,
  marketHas,
  marketLeft,
  marketMax,
  marketPress,
  marketPrice,
  marketPurse,
  marketSellPrice,
  ownOf,
  saleCheck,
} from '@/game/sim/market';
import { buyGoods, sellGoods } from '@/game/sim/actions';
import { partyNow } from '@/net/clock';
import { asGame } from '@/game/pace';
import { Icon } from '@/ui/icons/Icon';
import { Num } from '@/ui/kit/Num';
import { Btn } from '@/ui/kit/Btn';
import { breakdown } from '@/ui/kit/breakdown';
import { realHoursMin, waitShort } from '@/ui/parts/wait';
import type { TipContent } from './tip';
import { fmtInt } from './hudTips';
import './market.css';
import type { IconName } from '@/ui/icons/alias';
import { iconName } from '@/ui/icons/registry';

export { ownOf };

/** Все товары рынка по порядку плиток: запасы, снаряжение, невольники. */
export const MARKET_GOODS: readonly GoodDef[] = [...GOODS, BONDED_GOOD];

/** Значок товара: запас — своим, предмет — снаряжением, невольники — цепью (накладная `ui/icons/registry.ts`). */
const goodIcon = (def: GoodDef | undefined): IconName =>
  !def ? 'ui-crate' : def.kind === 'resource' && def.resource ? iconName('res', def.resource) : def.kind === 'equipment' && def.equipment ? iconName('gear', def.equipment) : 'ui-chain';


/** Число на плитке: до десяти тысяч — целиком, дальше — «12 тыс.». */
export const short = (n: number): string => (n < 10_000 ? fmtInt(n) : `${fmtInt(Math.floor(n / 1000))} тыс.`);

/** Плитка: цена покупки и продажи следующей штуки, сколько у тебя и везут, сколько на рынке; привезли ли товар. */
export function shelfCells(s: GameState, def: GoodDef, now: number): { buy: number; sell: number; own: number; coming: number; left: number; brought: boolean } {
  return {
    buy: marketPrice(s, def, now),
    sell: marketSellPrice(s, def, now),
    own: ownOf(s, def),
    coming: inTransit(s, def.id),
    left: marketLeft(s, def, now),
    brought: marketHas(s, def, now),
  };
}

/**
 * Цена штуки с разбором: основа привоза и сбитие (нажим на цену от купленного и проданного, отходит сам). Итог —
 * `marketPrice`, строки складываются в него.
 */
export function priceTip(s: GameState, def: GoodDef, now: number): TipContent {
  const price = marketPrice(s, def, now);
  const base = marketPrice({ ...s, market: { ...s.market, press: {} } }, def, now);
  const q = Math.round(marketPress(s, def.id, now));
  return breakdown({
    title: `${def.name} · ${price} за штуку`,
    body: `Каждая купленная штука дороже прежней, проданная — дешевле; на ${fmtInt(marketDepth(s, def, now))} штук цена уходит вдвое. Сбитие отходит само — вдвое за 45 минут.`,
    total: price,
    parts: [
      { label: 'Основа привоза', value: base },
      { label: `Сбитие: нажим ${q > 0 ? '+' : ''}${q}`, value: price - base },
    ],
    fmt: (n) => fmtInt(n),
    sumLabel: 'Цена',
  });
}

/** Единица цены словами: невольника продают «за человека», а не «за штуку» (`ORDER_TEXT.market.unit`). */
export const unitWord = (def: GoodDef): string => (def.id === BONDED_GOOD.id ? ORDER_TEXT.market.unit : 'за штуку');

/** Что покупка невольников сделает с порядком: число и слово порога (`ORDER_UNREST`, `ORDER_WARN`). */
export function orderAfter(s: GameState, n: number): { value: number; tone: '' | 'warn' | 'bad'; words: string } {
  const value = Math.round(orderBreakdown(s, bondedIncoming(s) + n).value);
  if (value < ORDER_UNREST) return { value, tone: 'bad', words: `Порядок станет ${value}. Ропот, мятеж через ${waitShort(asGame(MUTINY_FUSE))}.` };
  if (value < ORDER_WARN) return { value, tone: 'warn', words: `Порядок станет ${value}. Надзор не держит столько невольников.` };
  return { value, tone: '', words: `Порядок станет ${value}.` };
}

/** Шапка: через сколько новый привоз (сетка UTC, каждые 3 часа) и серебро купцов на этот привоз. */
export function shiftLine(s: GameState, now: number): { next: string; purse: number } {
  return { next: realHoursMin(Math.max(0, (shiftStart(shiftOf(now)) + SHIFT - now) / 1000)), purse: Math.floor(marketPurse(s, now)) };
}

export function MarketNew() {
  const s = useGame((g) => g.s);
  const now = partyNow();
  const [pick, setPick] = useState<GoodId>(MARKET_GOODS[0].id);
  const [side, setSide] = useState<'buy' | 'sell'>('buy');
  const chosen = GOOD_BY_ID[pick] ?? MARKET_GOODS[0];
  const head = shiftLine(s, now);

  return (
    <section className="mk">
      <div className="mk-top">
        <span className="mk-shift">
          <Icon name="ui-wagon" />
          <span>
            <b>Привоз</b>
            <small>новый привоз через {head.next}</small>
          </span>
        </span>
        <span className="mk-purse" title="Серебро купцов на этот привоз: столько они отдадут за проданное (невольники — мимо)">
          <Icon name="ui-pouch" />
          <span>
            <b>{fmtInt(head.purse)}</b>
            <small>у купцов</small>
          </span>
        </span>
      </div>
      <p className="mk-legend">
        <span>купить · продать</span>
        <span>у тебя · на рынке</span>
      </p>
      <div className="mk-grid" role="radiogroup" aria-label="Товары">
        {MARKET_GOODS.map((def) => {
          const c = shelfCells(s, def, now);
          const on = def.id === chosen.id;
          return (
            <button
              key={def.id}
              type="button"
              role="radio"
              aria-checked={on}
              className={`mk-tile${on ? ' on' : ''}${c.left <= 0 && c.own <= 0 ? ' dim' : ''}`}
              onClick={() => setPick(def.id)}
              aria-label={`${def.name}: купить по ${c.buy}, продать по ${c.sell}, у тебя ${c.own}, на рынке ${c.left}`}
            >
              <span className="mk-tn">
                <Icon name={goodIcon(def)} />
                <span className="one-line">{def.name}</span>
              </span>
              <span className="mk-tp">
                <b>{c.left > 0 ? short(c.buy) : '—'}</b>
                <i>{short(c.sell)}</i>
              </span>
              <span className="mk-ts">
                <span>
                  {short(c.own)}
                  {c.coming > 0 && <em>+{short(c.coming)}</em>}
                </span>
                <span>{c.left > 0 ? short(c.left) : c.brought ? 'пусто' : 'нет'}</span>
              </span>
            </button>
          );
        })}
      </div>
      <Deal key={`${chosen.id}:${side}`} def={chosen} side={side} setSide={setSide} now={now} />
    </section>
  );
}

const QUICK = [1, 10, 100] as const;

/** Панель сделки выбранного товара: сторона, количество, итог в моменте, что станет у тебя, кнопка с причиной. */
function Deal({ def, side, setSide, now }: { def: GoodDef; side: 'buy' | 'sell'; setSide: (v: 'buy' | 'sell') => void; now: number }) {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const [raw, setRaw] = useState('1');
  const buy = side === 'buy';
  const max = marketMax(s, def.id, side, now);
  const n = Math.max(1, Math.min(99_999, Math.floor(Number(raw) || 1)));
  const set = (v: number): void => setRaw(String(Math.max(1, Math.min(99_999, Math.floor(v)))));
  const check = buy ? marketCheck(s, def.id, n, now) : saleCheck(s, def.id, n, now);
  const gold = buy ? (check as ReturnType<typeof marketCheck>).cost : (check as ReturnType<typeof saleCheck>).gold;
  const own = ownOf(s, def);
  const after = buy && def.id === BONDED_GOOD.id ? orderAfter(s, n) : null;
  const run = (): void => {
    act((st) => (buy ? buyGoods(st, def.id, n, partyNow()) : sellGoods(st, def.id, n, partyNow())));
    setRaw('1');
  };
  const per = check.lot.first === check.lot.last ? `${check.lot.first}` : `${check.lot.first}–${check.lot.last}`;

  return (
    <div className="mk-deal">
      <div className="mk-seg" role="tablist" aria-label="Сделка">
        {(['buy', 'sell'] as const).map((k) => (
          <button key={k} type="button" role="tab" aria-selected={side === k} className={side === k ? 'on' : ''} onClick={() => setSide(k)}>
            {k === 'buy' ? 'Купить' : 'Продать'} <small>по {k === 'buy' ? marketPrice(s, def, now) : marketSellPrice(s, def, now)}</small>
          </button>
        ))}
      </div>
      <div className="mk-what">
        <Icon name={goodIcon(def)} />
        <b className="one-line">{def.name}</b>
        <span className="muted">
          <Num tip={() => priceTip(s, def, now)} label="Цена за штуку: разбор">
            {per}
          </Num>{' '}
          {unitWord(def)}
          {buy && ` · телега ${waitShort(caravanSeconds(s))}`}
        </span>
      </div>
      <div className="mk-qty">
        <span className="mk-num">
          <button type="button" onClick={() => set(n - 1)} disabled={n <= 1} aria-label="Меньше">
            −
          </button>
          <input
            type="text"
            inputMode="numeric"
            pattern="[0-9]*"
            aria-label="Сколько"
            value={raw}
            onChange={(e) => setRaw(e.target.value.replace(/\D/g, '').slice(0, 5))}
            onBlur={() => set(n)}
          />
          <button type="button" onClick={() => set(n + 1)} aria-label="Больше">
            +
          </button>
        </span>
        <span className="mk-quick">
          {QUICK.map((q) => (
            <button key={q} type="button" className={n === q ? 'on' : ''} onClick={() => set(q)}>
              {q}
            </button>
          ))}
          <button type="button" className={n === max && max > 0 ? 'on' : ''} disabled={max <= 0} onClick={() => set(max)} aria-label={`Всё: ${max}`}>
            Всё
          </button>
        </span>
      </div>
      <dl className="mk-sum">
        <div>
          <dt>{buy ? 'Отдашь' : 'Получишь'}</dt>
          <dd className={buy && gold > s.gold ? 'no' : ''}>
            <Icon name="res-gold" /> {fmtInt(gold)}
          </dd>
        </div>
        <div>
          <dt>У тебя</dt>
          <dd>
            {fmtInt(own)} → {fmtInt(buy ? own + n : Math.max(0, own - n))}
          </dd>
        </div>
      </dl>
      {after && <p className={`note order-after ${after.tone}`}>{after.words}</p>}
      <Btn kind="main" wide why={check.blocked} onClick={run}>
        {buy ? 'Купить' : 'Продать'} {fmtInt(n)}
      </Btn>
    </div>
  );
}
