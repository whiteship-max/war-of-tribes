// Рынок (UI-7, docs/ui_v2.md, 5.6; находка П8): прилавок — таблица выбора «Товар · Цена · Сегодня · Есть», а не лента
// карточек с рядом шага в каждой; касание строки выбирает товар, под таблицей — покупка выбранного: шаг, цена «нужно из
// есть» (`parts/Cost`, одна форма на игру) и «Купить» с причиной погасшей. Телеги в пути — таблицей с отменой. Невольничий
// ряд — та же строка прилавка; у его покупки — каким станет порядок, и продажа торговцам.
//
// Своей арифметики нет (правило 18): цена — `marketPrice` (разбор — основа записи и рост за скупленное, `goodPrice`),
// партия — `marketCheck` и `saleCheck`, порядок — `orderBreakdown` с теми, кого уже ведут, срок телеги — `caravanSeconds`.
// Едет в куске нового вида (`parts/Market` — ленивый вход): первая загрузка за набор не платит.
import { useState } from 'react';
import type { GameState, GoodId } from '@/game/types';
import { useGame } from '@/game/store';
import { MUTINY_FUSE, ORDER_UNREST, ORDER_WARN } from '@/game/constants';
import { BONDED_GOOD, GOOD_BY_ID, goodStock, type GoodDef } from '@/game/data/market';
import { ORDER_TEXT } from '@/game/data/order';
import {
  bondedIncoming,
  bondedSalePrice,
  bondedTotal,
  caravanSeconds,
  marketLeft,
  marketLevel,
  marketOffer,
  marketPrice,
  marketStock,
  orderBreakdown,
} from '@/game/derived';
import { marketCheck, saleCheck } from '@/game/sim/market';
import { buyGoods, cancelCaravan, sellBonded } from '@/game/sim/actions';
import { asGame } from '@/game/pace';
import { Icon } from '@/ui/icons/Icon';
import { Table, type Col } from '@/ui/kit/Table';
import { Row } from '@/ui/kit/Row';
import { Num } from '@/ui/kit/Num';
import { Btn } from '@/ui/kit/Btn';
import { breakdown } from '@/ui/kit/breakdown';
import { tipGo } from '@/ui/kit/nav';
import { Cost } from '@/ui/parts/Cost';
import { Steps } from '@/ui/parts/Steps';
import { waitShort } from '@/ui/parts/wait';
import { count } from '@/ui/parts/plural';
import type { TipContent } from './tip';
import { fmtInt, goldTip } from './hudTips';
import './market.css';

export const SHELF_COLS: readonly Col[] = [
  { key: 'name', title: 'Товар' },
  { key: 'price', title: 'Цена', align: 'right', w: '48px' },
  { key: 'left', title: 'Сегодня', align: 'right', w: '64px' },
  { key: 'own', title: 'Есть', align: 'right', w: '52px' },
];

const CART_COLS: readonly Col[] = [
  { key: 'name', title: 'В пути' },
  { key: 'n', title: 'Сколько', align: 'right', w: '56px' },
  { key: 'left', title: 'Через', align: 'right', w: '72px' },
  { key: 'x', title: '', align: 'center', w: '44px' },
];

/** Сколько этого товара уже есть: запас склада, вещь кузни или невольники в городе. */
export function ownOf(s: GameState, def: GoodDef): number {
  if (def.id === BONDED_GOOD.id) return bondedTotal(s);
  return def.resource ? Math.floor(s.resources[def.resource]) : (s.equipment[def.equipment!] ?? 0);
}

/** Строка прилавка: цена следующей штуки, сколько осталось сегодня из дневного запаса, сколько уже есть. */
export function shelfCells(s: GameState, def: GoodDef): { price: number; left: number; stock: number; own: number } {
  return { price: marketPrice(s, def), left: marketLeft(s, def), stock: marketStock(s, def), own: ownOf(s, def) };
}

/**
 * Цена штуки с разбором: основа записи и рост за скупленное сегодня (`goodPrice`: к концу дневного запаса цена вырастает
 * на долю `PRICE_RAMP`). Итог — `marketPrice`, строки складываются в него.
 */
export function priceTip(s: GameState, def: GoodDef): TipContent {
  const price = marketPrice(s, def);
  const stock = goodStock(def, marketLevel(s));
  const bought = Math.max(0, stock - marketLeft(s, def));
  return breakdown({
    title: `${def.name} · ${price} за штуку`,
    body: 'Цена растёт, чем больше берёшь за день. Завтра — снова с основы.',
    total: price,
    parts: [
      { label: 'Основа', value: def.price },
      { label: `Скуплено сегодня ${bought} из ${stock}`, value: price - def.price },
    ],
    fmt: (n) => fmtInt(n),
    sumLabel: 'Цена',
  });
}

/** Что покупка невольников сделает с порядком: число и слово порога (`ORDER_UNREST`, `ORDER_WARN`). */
export function orderAfter(s: GameState, n: number): { value: number; tone: '' | 'warn' | 'bad'; words: string } {
  const value = Math.round(orderBreakdown(s, bondedIncoming(s) + n).value);
  if (value < ORDER_UNREST) return { value, tone: 'bad', words: `Порядок станет ${value}. Ропот, мятеж через ${waitShort(asGame(MUTINY_FUSE))}.` };
  if (value < ORDER_WARN) return { value, tone: 'warn', words: `Порядок станет ${value}. Надзор не держит столько невольников.` };
  return { value, tone: '', words: `Порядок станет ${value}.` };
}

export function MarketNew() {
  const s = useGame((g) => g.s);
  const offer = marketOffer(s);
  const [pick, setPick] = useState<GoodId | null>(null);
  const chosen = offer.find((g) => g.id === pick) ?? offer[0] ?? null;

  return (
    <section className="mk">
      <Row
        icon={{ name: 'res-gold', glyph: '💰' }}
        label="Золото"
        sub={`Покупку везёт телега, ${waitShort(caravanSeconds(s))}. Отменишь — золото вернётся`}
        value={fmtInt(s.gold)}
        tip={() => goldTip(s, tipGo())}
      />
      <Carts />
      <h3>
        Прилавок <span className="muted">{count(offer.length, 'товар', 'товара', 'товаров')}</span>
      </h3>
      <Table
        label="Прилавок"
        cols={SHELF_COLS}
        empty="Прилавок пуст."
        rows={offer.map((def) => {
          const c = shelfCells(s, def);
          return {
            key: def.id,
            on: chosen?.id === def.id,
            dim: c.left <= 0,
            pick: () => setPick(def.id),
            cells: {
              name: (
                <span className="kit-name">
                  <span className="ic">{def.icon}</span>
                  <span className="one-line">{def.name}</span>
                </span>
              ),
              price: c.price,
              left: `${c.left}/${c.stock}`,
              own: fmtInt(c.own),
            },
          };
        })}
      />
      <p className="note">Товар меняется каждый день и дорожает, чем больше берёшь.</p>
      {chosen && <Buy key={chosen.id} def={chosen} />}
    </section>
  );
}

/** Телеги в пути: что везут, сколько и через сколько; отмена возвращает золото. */
function Carts() {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  if (s.caravans.length === 0) return null;
  return (
    <Table
      label="В пути"
      cols={CART_COLS}
      rows={s.caravans.map((c) => {
        const def = GOOD_BY_ID[c.good];
        return {
          key: String(c.id),
          cells: {
            name: (
              <span className="kit-name">
                <span className="ic">{def?.icon ?? '📦'}</span>
                <span className="one-line">{def?.name ?? 'Товар'}</span>
              </span>
            ),
            n: c.count,
            left: waitShort(asGame(Math.max(0, Math.ceil(c.arriveAt - s.time)))),
            x: (
              <button type="button" className="mk-x" onClick={() => act((st) => cancelCaravan(st, c.id))} aria-label={`Отменить: ${def?.name ?? 'товар'}, вернуть ${c.gold} золота`}>
                <Icon name="ui-close" glyph="✕" />
              </button>
            ),
          },
        };
      })}
    />
  );
}

/** Покупка выбранного товара: шаг, цена партии «нужно из есть», «Купить»; у невольников — порядок после и продажа. */
function Buy({ def }: { def: GoodDef }) {
  const s = useGame((g) => g.s);
  const act = useGame((g) => g.act);
  const [want, setWant] = useState(1);
  const [sell, setSell] = useState(1);
  const left = marketLeft(s, def);
  const n = Math.max(1, Math.min(want, Math.max(1, left)));
  const check = marketCheck(s, def.id, n);
  const bonded = def.id === BONDED_GOOD.id;
  const after = bonded ? orderAfter(s, n) : null;
  const have = bondedTotal(s);
  const m = Math.max(1, Math.min(sell, Math.max(1, have)));
  const sale = saleCheck(s, m);
  const saleRoom = Math.min(have, sale.left);

  return (
    <div className="mk-buy">
      <h3>
        {def.name}{' '}
        <span className="muted">
          по <Num tip={() => priceTip(s, def)} label="Цена за штуку">{marketPrice(s, def)}</Num> {bonded ? ORDER_TEXT.market.unit : 'за штуку'}
        </span>
      </h3>
      <Steps value={n} max={left} spare={Math.max(0, left - n)} step={10} names={{ less: 'Меньше', more: 'Больше' }} onChange={(d) => setWant(Math.max(1, n + d))} />
      <div className="mk-act">
        <Cost cost={{ gold: check.cost }} />
        <Btn kind="main" why={check.blocked} onClick={() => act((st) => buyGoods(st, def.id, n))}>
          Купить {n}
        </Btn>
      </div>
      {after && <p className={`note order-after ${after.tone}`}>{after.words}</p>}
      {bonded && (
        <>
          <h3>
            Продать торговцам <span className="muted">по {bondedSalePrice()} {ORDER_TEXT.market.unit}, сегодня ещё {sale.left}</span>
          </h3>
          <Steps value={m} max={saleRoom} spare={Math.max(0, saleRoom - m)} step={10} names={{ less: 'Меньше', more: 'Больше' }} onChange={(d) => setSell(Math.max(1, m + d))} />
          <div className="mk-act">
            <span className="mk-gain">
              <Icon name="res-gold" glyph="💰" /> +{sale.gold}
            </span>
            <Btn why={have > 0 ? sale.blocked : ORDER_TEXT.market.noBonded} onClick={() => act((st) => sellBonded(st, m))}>
              Продать {m}
            </Btn>
          </div>
        </>
      )}
    </div>
  );
}
