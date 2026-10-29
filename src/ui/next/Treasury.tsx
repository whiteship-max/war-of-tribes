// «Сокровищница» — меню алмазов (docs/gems.md): плашка под строкой запасов (`GemPlaque`) и окно с вкладками
// «Купить · Лавка · История». Баланс, лавка и журнал — с сервера (`net/gems`); своих чисел у окна нет: цены — `gemrules`
// (правило 18), наборы — `data/gems`.
//
// «Купить» — наборы за USDT в сети TON (docs/payments.md): отдельный кусок `TreasuryBuy` вместе с библиотекой кошелька
// TON Connect — грузится только при открытии вкладки, первая загрузка его не несёт.
import { Suspense, lazy, useEffect } from 'react';
import { useGame } from '@/game/store';
import { RESOURCE_META } from '@/game/constants';
import { SHOP_DAILY, SHOP_GOODS, SHOP_LOT, shopPrice } from '@/game/sim/gems';
import { shopBlocked, shopRoom } from '@/game/sim/gemview';
import { gemLine, shopResetAt } from '@/game/gemrules';
import { buildingTitle } from '@/game/derived';
import { BUILDING_BY_ID } from '@/game/data/buildings';
import { has } from '@/game/guard';
import { gemsOffline, useGems, type GemsStore } from '@/net/gems';
import { orderBuy } from '@/net/gemorder';
import { serverNow } from '@/net/clock';
import type { BuildingTypeId } from '@/game/types';
import { Icon } from '@/ui/icons/Icon';
import { realSpanText } from '@/ui/parts/wait';
import { shopUsed, useTreasury, type TreasuryTab } from '@/ui/treasury';
import { useTrades } from '@/ui/trades';
import { useRealm } from '@/ui/realm/open';
import { GemIcon } from './Rush';
import { gemsTip } from './hudTips';
import { tipAt } from './tip';
import { Table, type Col } from '@/ui/kit/Table';
import { iconName } from '@/ui/icons/registry';
import { overflowOf } from '@/game/sim/stockview';
import { askRoom } from '@/ui/room';

/**
 * Лавка сегодня по часам сервера — одни часы на лавку и подсказку плашки: «сейчас», от которого считают сутки (полночь
 * UTC, `shopResetAt`) и связь (`gemsOffline`), и сколько покупок из `SHOP_DAILY` сделано (`ui/treasury.shopUsed`).
 */
function shopToday(shop: GemsStore['shop']): { now: number; used: number } {
  const now = serverNow();
  return { now, used: shopUsed(shop, now) };
}

/** Вкладка «Купить» — отдельным куском, с библиотекой кошелька. */
const Buy = lazy(() => import('./TreasuryBuy'));

/**
 * Плашка «💎 120 +» слева под строкой запасов: касание — подсказка алмазов, как у чисел верха (docs/ui_v2.md, 5.2): баланс,
 * лавка сегодня и дверь «Сокровищница» на «Купить». Числа — в миг касания.
 */
export function GemPlaque() {
  const balance = useGems((g) => g.balance);
  const show = useTreasury((t) => t.show);
  const tip = (e: { currentTarget: Element }): void => {
    const g = useGems.getState();
    const { now, used } = shopToday(g.shop);
    tipAt(e.currentTarget, gemsTip(g.balance, used, gemsOffline(g, now), () => show('buy')));
  };
  return (
    <button className="nx-gems" onClick={tip} aria-label={`Алмазы: ${balance ?? 'нет связи'}`}>
      <GemIcon />
      <b>{balance ?? '—'}</b>
      <i className="nx-gems-plus">+</i>
    </button>
  );
}

const TABS: [TreasuryTab, string][] = [
  ['buy', 'Купить'],
  ['shop', 'Лавка'],
  ['history', 'История'],
];

export function Treasury() {
  const sheet = useGame((g) => g.sheet);
  const mapOpen = useGame((g) => g.mapOpen);
  const tradesOpen = useTrades((t) => t.open);
  const realmOpen = useRealm((r) => r.open);
  const tab = useTreasury((t) => t.tab);
  const setTab = useTreasury((t) => t.setTab);
  const hide = useTreasury((t) => t.hide);
  const balance = useGems((g) => g.balance);

  // Открылась шторка постройки, карта, промыслы или держава — окно уступает: два окна разом не стоят.
  useEffect(() => {
    if (sheet !== null || mapOpen || tradesOpen || realmOpen) hide();
  }, [sheet, mapOpen, tradesOpen, realmOpen, hide]);

  return (
    <div className="panel nx-bpanel nx-treasury">
      <div className="nx-bhead">
        <span className="nx-bico gem">
          <GemIcon />
        </span>
        <div className="nx-btitle">
          <b className="one-line">Сокровищница</b>
          <span className="nx-blvl">
            <span className="nx-gem-val">
              <GemIcon /> {balance ?? '—'}
            </span>
          </span>
        </div>
        <button className="nx-bclose" onClick={hide} aria-label="Закрыть">
          <Icon name="ui-close" />
        </button>
      </div>
      <div className="tabs">
        {TABS.map(([id, name]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            {name}
          </button>
        ))}
      </div>
      {tab === 'buy' && (
        <Suspense fallback={<div className="note">Открываем кошелёк…</div>}>
          <Buy />
        </Suspense>
      )}
      {tab === 'shop' && <Shop />}
      {tab === 'history' && <History />}
    </div>
  );
}

/** Столбцы лавки (UI-7, docs/ui_v2.md, 5.6; П12): «+100» — в шапке, а не в каждой строке; цена — кнопкой покупки. */
export const SHOP_COLS: readonly Col[] = [
  { key: 'name', title: `Запас +${SHOP_LOT}` },
  { key: 'room', title: 'Места', align: 'right', w: '56px' },
  { key: 'buy', title: 'Цена', align: 'right', w: '76px' },
];

/** Лавка: сто единиц припаса за алмазы, десять покупок в сутки. Войска нет. Таблица — запас, места на складе, цена. */
function Shop() {
  const s = useGame((g) => g.s);
  const toast = useGame((g) => g.showToast);
  const balance = useGems((g) => g.balance);
  const shop = useGems((g) => g.shop);
  const at = useGems((g) => g.at);
  const why = useGems((g) => g.why);
  const busy = useGems((g) => g.busy);
  const { now, used } = shopToday(shop);
  const left = Math.max(0, SHOP_DAILY - used);
  const offline = gemsOffline({ balance, at, why }, now);
  const buy = async (r: (typeof SHOP_GOODS)[number]): Promise<void> => {
    // Сто не влезут — сначала окно «Склад заполнен»; «Отмена» — приказа нет, алмазы не списаны (OWNER-DECISIONS, п. 1).
    if (!(await askRoom(overflowOf(useGame.getState().s, { [r]: SHOP_LOT })))) return;
    const err = await orderBuy(r);
    if (err) toast(err);
  };
  const rows = SHOP_GOODS.map((r) => ({ r, price: shopPrice(r), room: shopRoom(s, r), blocked: shopBlocked(s, r, shopPrice(r), balance, left, offline) }));
  // Причина, общая для всех рядов («Алмазы тратятся только в игре внутри Telegram», «Нет связи…»), говорится один раз над
  // таблицей: семь одинаковых строк подряд — повтор (docs/voice.md, 5). Прочие — по разу под ней.
  const common = rows.every((x) => x.blocked !== null && x.blocked === rows[0].blocked) ? rows[0].blocked : null;
  const own = [...new Set(rows.map((x) => x.blocked).filter((b): b is string => b !== null && b !== common))];
  return (
    <>
      <div className="nx-pay">
        <span>
          Сегодня {used} из {SHOP_DAILY} · новые через {realSpanText(Math.ceil((shopResetAt(now) - now) / 1000))}
        </span>
        {common && <small className="nx-why">{common}</small>}
      </div>
      <Table
        label="Лавка"
        cols={SHOP_COLS}
        rows={rows.map(({ r, price, room, blocked }) => {
          const waiting = busy === `buy:${r}`;
          return {
            key: r,
            dim: blocked !== null,
            cells: {
              name: (
                <span className="kit-name">
                  <Icon name={iconName('res', r)} />
                  <span className="one-line">{RESOURCE_META[r].name}</span>
                </span>
              ),
              room: <span className={room < SHOP_LOT ? 'bad' : ''}>{room}</span>,
              buy: (
                <button
                  type="button"
                  className="nx-go nx-gem-go nx-shop-go"
                  disabled={blocked !== null || waiting}
                  aria-label={`${RESOURCE_META[r].name} +${SHOP_LOT} за ${price} алмазов`}
                  onClick={() => void buy(r)}
                >
                  {waiting ? (
                    '…'
                  ) : (
                    <span>
                      <GemIcon /> {price}
                    </span>
                  )}
                </button>
              ),
            },
          };
        })}
      />
      {own.map((w) => (
        <small key={w} className="nx-why">
          {w}
        </small>
      ))}
    </>
  );
}

/** День и время записи — часами устройства: игроку — его полночь, его часы. */
const when = (ms: number): string => {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getDate())}.${p(d.getMonth() + 1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
};

/** Все операции с алмазами — свежие сверху. */
function History() {
  const s = useGame((g) => g.s);
  const list = useGems((g) => g.list);
  const balance = useGems((g) => g.balance);
  if (list.length === 0) return <div className="note">{balance === null ? 'Нет связи. Журнал откроется, когда она вернётся.' : 'Записей ещё нет.'}</div>;
  const name = (b: string): string => (has(BUILDING_BY_ID, b) ? buildingTitle(s, b as BuildingTypeId) : b);
  return (
    <div className="nx-gem-log">
      {[...list].reverse().map((e) => (
        <div className="nx-gem-line" key={e.n}>
          <span className={e.delta > 0 ? 'pos' : 'neg'}>{gemLine(e, name)}</span>
          <small>{when(e.at)}</small>
        </div>
      ))}
    </div>
  );
}
