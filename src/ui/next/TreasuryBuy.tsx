// Вкладка «Купить» Сокровищницы (docs/payments.md): наборы алмазов за USDT в сети TON. Отдельный кусок — грузится только
// при открытии вкладки, и с ним — библиотека кошелька TON Connect; первая загрузка их не несёт.
//
// Окно алмазов не начисляет: «Купить» делает заказ на сервере и просит кошелёк подписать перевод, а алмазы ложатся,
// когда сервер сам найдёт перевод в сети. Пока заказ ждёт, окно спрашивает сервер раз в пять секунд.
import { useEffect } from 'react';
import { toUserFriendlyAddress } from '@tonconnect/ui';
import { useGame } from '@/game/store';
import { GEM_PACKS, PAY_WITH, packBonus } from '@/game/data/gems';
import { anyWaiting, buyPack, connectWallet, disconnectWallet, pinNetwork, refreshPay, tonConnect, usePay } from '@/net/pay';
import { serverNow } from '@/net/clock';
import { tgInitData } from '@/telegram/webapp';
import { Icon } from '@/ui/icons/Icon';
import { GemIcon } from './Rush';
import type { PayOrderView, PayState } from '../../../netlify/lib/contract';

/** Как часто спрашиваем сервер, пока заказ ждёт перевода. */
const POLL_MS = 5000;

/** Статус заказа словами. */
export const PAY_STATE_WORD: Record<PayState, string> = {
  created: 'создан',
  waiting: 'ждёт перевода',
  paid: 'оплачен, начисляется',
  credited: 'начислено',
  expired: 'истёк',
};

const short = (raw: string, testnet: boolean): string => {
  try {
    const a = toUserFriendlyAddress(raw, testnet);
    return `${a.slice(0, 4)}…${a.slice(-4)}`;
  } catch {
    return raw.slice(0, 8);
  }
};

export default function TreasuryBuy() {
  const toast = useGame((g) => g.showToast);
  const on = usePay((p) => p.on);
  const net = usePay((p) => p.net);
  const orders = usePay((p) => p.orders);
  const wallet = usePay((p) => p.wallet);
  const ready = usePay((p) => p.ready);
  const busy = usePay((p) => p.busy);
  const outside = !tgInitData();

  useEffect(() => {
    void refreshPay();
    void tonConnect();
  }, []);
  // Кошелёк подключается только в сети оплаты.
  useEffect(() => {
    if (net) void pinNetwork(net);
  }, [net]);
  // Пока заказ ждёт перевода — спрашиваем сервер; найдёт перевод — алмазы лягут, баланс обновится.
  const waiting = anyWaiting(orders, serverNow());
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(() => void refreshPay(), POLL_MS);
    return () => clearInterval(t);
  }, [waiting]);

  const why = outside ? 'Покупка — только в игре из Telegram.' : on === false ? 'Оплата ещё не настроена на сервере.' : null;
  const buy = async (pack: string): Promise<void> => {
    const said = await buyPack(pack);
    if (said) toast(said);
  };
  const recent = [...orders].reverse().slice(0, 5);
  return (
    <>
      <div className="nx-pay">
        <span>
          Оплата — {PAY_WITH}
          {net === 'testnet' && ' · тестовая сеть'}
        </span>
        {wallet ? (
          <button className="nx-confirm" onClick={() => void disconnectWallet()} aria-label="Отключить кошелёк">
            {short(wallet.address, net !== 'mainnet')} ✕
          </button>
        ) : (
          <button className="nx-confirm" disabled={!ready || why !== null} onClick={() => void connectWallet()}>
            Подключить кошелёк
          </button>
        )}
      </div>
      {why && <div className="note">{why}</div>}
      {GEM_PACKS.map((p) => {
        const bonus = packBonus(p);
        const mine = busy === `order:${p.id}`;
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
            <button className="nx-go nx-trade-go" disabled={why !== null || on !== true || !ready || busy !== null} onClick={() => void buy(p.id)}>
              {mine ? '…' : 'Купить'}
            </button>
          </div>
        );
      })}
      {recent.length > 0 && (
        <div className="nx-gem-log">
          {recent.map((o) => (
            <OrderLine key={o.id} o={o} />
          ))}
        </div>
      )}
    </>
  );
}

function OrderLine({ o }: { o: PayOrderView }) {
  const pack = GEM_PACKS.find((p) => p.id === o.pack);
  return (
    <div className="nx-gem-line">
      <span className={o.state === 'credited' ? 'pos' : o.state === 'expired' ? 'neg' : ''}>
        {pack?.name ?? o.pack} · {o.usdt} USDT — {PAY_STATE_WORD[o.state]}
        {o.note && <small className="nx-why"> · {o.note}</small>}
      </span>
      <small>TRIBE-{o.id}</small>
    </div>
  );
}
