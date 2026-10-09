// «Сокровищница» — меню алмазов (docs/gems.md): плашка под строкой запасов (`GemPlaque`) и окно с вкладками
// «Купить · Лавка · История». Баланс, лавка и журнал — с сервера (`net/gems`); своих чисел у окна нет: цены — `gemrules`
// (правило 18), наборы — `data/gems`.
//
// «Купить» — наборы за USDT в сети TON. Оплаты пока нет (решение владельца 09.10.2026): кнопки «Подключить кошелёк» и
// «Купить» стоят, по нажатию — «Покупка скоро». Библиотеки кошелька в сборке нет.
import { useEffect } from 'react';
import { useGame } from '@/game/store';
import { RESOURCE_META } from '@/game/constants';
import { GEM_PACKS, PAY_WITH, packBonus } from '@/game/data/gems';
import { SHOP_DAILY, SHOP_GOODS, SHOP_LOT, shopBlocked, shopPrice, shopRoom } from '@/game/sim/gems';
import { gemLine, shopDay, shopResetAt } from '@/game/gemrules';
import { buildingTitle } from '@/game/derived';
import { BUILDING_BY_ID } from '@/game/data/buildings';
import { gemsOffline, orderBuy, useGems } from '@/net/gems';
import { serverNow } from '@/net/clock';
import type { BuildingTypeId } from '@/game/types';
import { Icon } from '@/ui/icons/Icon';
import { realSpanText } from '@/ui/parts/wait';
import { useTreasury, type TreasuryTab } from '@/ui/treasury';
import { useTrades } from '@/ui/trades';
import { useRealm } from '@/ui/realm/open';
import { GemIcon } from './Rush';

/** Слово оплаты, пока её нет. */
export const SOON = 'Покупка скоро.';

/** Плашка «💎 120 +» справа под строкой запасов: касание открывает Сокровищницу. */
export function GemPlaque() {
  const balance = useGems((g) => g.balance);
  const show = useTreasury((t) => t.show);
  return (
    <button className="nx-gems" onClick={() => show()} aria-label={`Сокровищница: ${balance ?? 'нет связи'}`}>
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
          <Icon name="ui-close" glyph="✕" />
        </button>
      </div>
      <div className="tabs">
        {TABS.map(([id, name]) => (
          <button key={id} className={tab === id ? 'active' : ''} onClick={() => setTab(id)}>
            {name}
          </button>
        ))}
      </div>
      {tab === 'buy' && <Buy />}
      {tab === 'shop' && <Shop />}
      {tab === 'history' && <History />}
    </div>
  );
}

/** Наборы алмазов за USDT в сети TON. Оплаты пока нет — кнопки отвечают «Покупка скоро». */
function Buy() {
  const toast = useGame((g) => g.showToast);
  const soon = (): void => toast(SOON);
  return (
    <>
      <div className="nx-pay">
        <span>Оплата — {PAY_WITH}</span>
        <button className="nx-confirm" onClick={soon}>
          Подключить кошелёк
        </button>
      </div>
      {GEM_PACKS.map((p) => {
        const bonus = packBonus(p);
        return (
          <div className="nx-trade" key={p.id}>
            <span className="nx-bico">
              <Icon name={`gempack-${p.id}`} glyph={p.icon} />
            </span>
            <div className="nx-trade-body">
              <b>
                {p.name} · <GemIcon /> {p.amount}
              </b>
              <span className="nx-trade-haul">
                {p.usdt} USDT{bonus > 0 && <em className="nx-bonus">+{bonus} %</em>}
              </span>
            </div>
            <button className="nx-go nx-trade-go" onClick={soon}>
              Купить
            </button>
          </div>
        );
      })}
    </>
  );
}

/** Лавка: сто единиц припаса за алмазы, десять покупок в сутки. Войска нет. */
function Shop() {
  const s = useGame((g) => g.s);
  const toast = useGame((g) => g.showToast);
  const balance = useGems((g) => g.balance);
  const shop = useGems((g) => g.shop);
  const at = useGems((g) => g.at);
  const why = useGems((g) => g.why);
  const busy = useGems((g) => g.busy);
  const now = serverNow();
  const used = shop && shop.day === shopDay(now) ? shop.used : 0;
  const left = Math.max(0, SHOP_DAILY - used);
  const offline = gemsOffline({ balance, at, why }, now);
  const buy = async (r: (typeof SHOP_GOODS)[number]): Promise<void> => {
    const err = await orderBuy(r);
    if (err) toast(err);
  };
  return (
    <>
      <div className="nx-pay">
        <span>
          Сегодня {used} из {SHOP_DAILY} · новые через {realSpanText(Math.ceil((shopResetAt(now) - now) / 1000))}
        </span>
      </div>
      {SHOP_GOODS.map((r) => {
        const price = shopPrice(r);
        const blocked = shopBlocked(s, r, price, balance, left, offline);
        const waiting = busy === `buy:${r}`;
        return (
          <div className="nx-trade" key={r}>
            <span className="nx-bico">
              <Icon name={`res-${r}`} glyph={RESOURCE_META[r].icon} />
            </span>
            <div className="nx-trade-body">
              <b>
                {RESOURCE_META[r].name} +{SHOP_LOT}
              </b>
              {blocked ? <small className="nx-why">{blocked}</small> : <span className="nx-trade-haul">места на складе: {shopRoom(s, r)}</span>}
            </div>
            <button className="nx-go nx-trade-go nx-gem-go" disabled={blocked !== null || waiting} onClick={() => void buy(r)}>
              {waiting ? (
                '…'
              ) : (
                <span>
                  <GemIcon /> {price}
                </span>
              )}
            </button>
          </div>
        );
      })}
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
  if (list.length === 0) return <div className="note">{balance === null ? 'Нет связи — журнал покажется, когда она будет.' : 'Операций пока нет.'}</div>;
  const name = (b: string): string => (b in BUILDING_BY_ID ? buildingTitle(s, b as BuildingTypeId) : b);
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
