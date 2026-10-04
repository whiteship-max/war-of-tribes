import { useState } from 'react';
import type { GoodId } from '@/game/types';
import { useGame } from '@/game/store';
import { MUTINY_FUSE, ORDER_UNREST, ORDER_WARN } from '@/game/constants';
import { BONDED_GOOD, GOOD_BY_ID } from '@/game/data/market';
import { ORDER_TEXT } from '@/game/data/order';
import {
  bondedIncoming,
  bondedSalePrice,
  bondedTotal,
  caravanProgress,
  caravanSeconds,
  marketLeft,
  marketOffer,
  marketPrice,
  marketStock,
  orderBreakdown,
} from '@/game/derived';
import { marketCheck, saleCheck } from '@/game/sim/market';
import { buyGoods, cancelCaravan, sellBonded } from '@/game/sim/actions';
import { waitShort } from './wait';
import { count as countOf } from './plural';
import { Icon } from '@/ui/icons/Icon';
import { asGame } from '@/game/pace';

/**
 * Рынок: за золото сюда привозят чужое добро.
 *
 * Закупка у проезжих торговцев. Вкладки под торг между игроками нет: невыпущенное не
 * показывается (docs/ui_audit.md, 14.1, 3), место ему заведут вместе с сервером.
 *
 * Тупика без объяснения быть не должно: у каждой строки написано, почём, сколько
 * осталось на сегодня и почему кнопка не нажимается.
 */
export function Market() {
  const s = useGame((g) => g.s);

  return (
    <>
      <h3>
        Закупка <span className="muted">в пути ~{waitShort(caravanSeconds(s))}</span>
      </h3>
      <div className="mod total">
        <span className="ico"><Icon name="res-gold" glyph="💰" /></span>
        <span className="name">Золото</span>
        <span className="val pos">{Math.floor(s.gold)}</span>
      </div>
      <div className="note">Покупку везёт телега. Отменишь, золото вернётся.</div>
      <BuyTab />
    </>
  );
}

function Caravans() {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  if (s.caravans.length === 0) return null;
  return (
    <>
      <h3>
        В пути <span className="muted">{countOf(s.caravans.length, 'телега', 'телеги', 'телег')}</span>
      </h3>
      {s.caravans.map((c) => {
        const def = GOOD_BY_ID[c.good];
        const pct = Math.round(caravanProgress(s, c) * 100);
        const left = asGame(Math.max(0, Math.ceil(c.arriveAt - s.time)));
        return (
          <div className="card" key={c.id}>
            <div className="ico">{def?.icon ?? '📦'}</div>
            <div className="body">
              <div className="title">
                {def?.name ?? 'Товар'} · {c.count}
                <span className="count">~{waitShort(left)}</span>
              </div>
              <div className="desc">Уплачено {c.gold} золота.</div>
              <div className="progress">
                <div style={{ width: `${pct}%` }} />
              </div>
            </div>
            <button
              className="btn ghost"
              onClick={() => act((st) => cancelCaravan(st, c.id))}
              aria-label="Отменить"
            >
              ✕
            </button>
          </div>
        );
      })}
    </>
  );
}

function BuyTab() {
  const s = useGame((g) => g.s);
  const offer = marketOffer(s);

  return (
    <>
      <Caravans />
      <h3>
        Прилавок <span className="muted">{countOf(offer.length, 'товар', 'товара', 'товаров')}</span>
      </h3>
      <div className="note">Товар меняется каждый день и дорожает, чем больше берёшь.</div>
      {offer.length === 0 ? (
        <div className="note bad">Прилавок пуст.</div>
      ) : (
        offer.map((g) => (g.kind === 'bonded' ? <BondedRow key={g.id} /> : <GoodRow key={g.id} good={g.id} />))
      )}
    </>
  );
}

/**
 * Невольничий ряд. Та же лавка и тот же счёт, что у любого товара: дневной
 * запас, цена растёт по мере скупки, золото списывается сразу, людей приводят
 * к воротам через срок каравана. Второй лавки под невольников нет.
 *
 * Отличий у ряда два, и оба про цену, которую обязаны видеть до нажатия. Первое —
 * каким станет порядок, если купить: считает это та же функция, что и строку
 * состояния (`orderBreakdown`), и в счёт идут и те, кого уже ведут торговцы.
 * Второе — продажа: торговцы берут невольников дешевле, чем приводят, и не больше
 * дневного запаса ряда.
 */
function BondedRow() {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const [count, setCount] = useState(1);
  const [sell, setSell] = useState(1);
  const def = BONDED_GOOD;
  const left = marketLeft(s, def);
  const n = Math.max(1, Math.min(count, Math.max(1, left)));
  const check = marketCheck(s, 'bonded', n);
  const price = marketPrice(s, def);
  const have = bondedTotal(s);
  const incoming = bondedIncoming(s);
  const after = Math.round(orderBreakdown(s, incoming + n).value);
  const tone = after < ORDER_UNREST ? 'bad' : after < ORDER_WARN ? 'warn' : '';
  const m = Math.max(1, Math.min(sell, Math.max(1, have)));
  const sale = saleCheck(s, m);

  return (
    <div className="card bonded-trade">
      <div className="bonded-head">
        <div className="ico">{def.icon}</div>
        <div className="body">
          <div className="title">
            {def.name}
            <span className="count">
              в городе {have}
              {incoming > 0 ? ` · ведут ${incoming}` : ''}
            </span>
          </div>
          <div className="desc">
            {price} <Icon name="res-gold" glyph="💰" /> {ORDER_TEXT.market.unit} · сегодня {left} из {marketStock(s, def)}
          </div>
        </div>
      </div>

      <div className="bonded-line">
        <div className="cost">
          <span className={s.gold >= check.cost ? '' : 'no'}>
            <Icon name="res-gold" glyph="💰" /> {check.cost} за {n}
          </span>
        </div>
        <div className="stepper">
          <button disabled={n <= 1} onClick={() => setCount(n - 1)} aria-label="Меньше">
            −
          </button>
          <span className="n">{n}</span>
          <button disabled={n >= left} onClick={() => setCount(n + 1)} aria-label="Больше">
            +
          </button>
        </div>
        <button className="btn" disabled={check.blocked !== null} onClick={() => act((st) => buyGoods(st, 'bonded', n))}>
          Купить
        </button>
      </div>
      {/* Цена покупки в порядке — до нажатия, а не после. */}
      <div className={`note order-after ${tone}`}>
        Порядок станет {after}
        {after < ORDER_UNREST
          ? `. Ропот, мятеж через ${waitShort(asGame(MUTINY_FUSE))}`
          : after < ORDER_WARN
            ? '. Надзор не держит столько невольников'
            : ''}
        .
      </div>
      {check.blocked && <div className="note">{check.blocked}</div>}

      <div className="bonded-line">
        <div className="cost">
          <span>
            <Icon name="res-gold" glyph="💰" /> +{sale.gold} за {m}
          </span>
        </div>
        <div className="stepper">
          <button disabled={m <= 1} onClick={() => setSell(m - 1)} aria-label="Меньше">
            −
          </button>
          <span className="n">{m}</span>
          <button disabled={m >= Math.min(have, sale.left)} onClick={() => setSell(m + 1)} aria-label="Больше">
            +
          </button>
        </div>
        <button className="btn ghost" disabled={sale.blocked !== null} onClick={() => act((st) => sellBonded(st, m))}>
          Продать
        </button>
      </div>
      <div className="note">
        Продажа по {bondedSalePrice()} <Icon name="res-gold" glyph="💰" /> {ORDER_TEXT.market.unit}, сегодня ещё {sale.left}.
        {sale.blocked && have > 0 ? ` ${sale.blocked}` : ''}
      </div>
    </div>
  );
}

function GoodRow({ good }: { good: GoodId }) {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const [count, setCount] = useState(1);
  const def = GOOD_BY_ID[good];
  const left = marketLeft(s, def);
  const n = Math.max(1, Math.min(count, Math.max(1, left)));
  const check = marketCheck(s, good, n);
  const price = marketPrice(s, def);
  const own = def.resource ? Math.floor(s.resources[def.resource]) : s.equipment[def.equipment!] ?? 0;

  return (
    <div className="card">
      <div className="ico">{def.icon}</div>
      <div className="body">
        <div className="title">
          {def.name}
          <span className="count">на складе {own}</span>
        </div>
        <div className="desc">
          {price} <Icon name="res-gold" glyph="💰" /> за штуку · сегодня {left} из {marketStock(s, def)}
        </div>
        <div className="cost">
          <span className={s.gold >= check.cost ? '' : 'no'}>
            <Icon name="res-gold" glyph="💰" /> {check.cost} за {n}
          </span>
        </div>
        {check.blocked && <div className="hint">{check.blocked}</div>}
      </div>
      <div className="stepper">
        <button disabled={n <= 1} onClick={() => setCount(n - 1)}>
          −
        </button>
        <span className="n">{n}</span>
        <button disabled={n >= left} onClick={() => setCount(n + 1)}>
          +
        </button>
      </div>
      <button
        className="btn"
        disabled={check.blocked !== null}
        onClick={() => act((st) => buyGoods(st, good, n))}
      >
        Купить
      </button>
    </div>
  );
}

