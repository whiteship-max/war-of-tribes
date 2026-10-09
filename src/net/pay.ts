/**
 * Оплата наборов алмазов USDT в сети TON — сторона игры (docs/payments.md). Ходит на `/api/pay` и в кошелёк через
 * TON Connect; **алмазов не начисляет и начислить не может**: заказ называет только набор и адрес кошелька, сумму и
 * комментарий считает сервер, а алмазы ложатся, когда сервер сам нашёл перевод в сети. Баланс после этого приезжает
 * обычной запиской (`net/gems.refreshGems`).
 *
 * Модуль и библиотека кошелька (`@tonconnect/ui`) едут в отдельном куске вкладки «Купить» Сокровищницы
 * (`ui/next/TreasuryBuy.tsx`, `lazy`): импортирует этот модуль только она, и первая загрузка их не несёт.
 */
import { create } from 'zustand';
import { THEME, TonConnectUI } from '@tonconnect/ui';
import { readPayResponse, type PayOrderView, type PayResponse } from '../../netlify/lib/contract';
import { BOT_USERNAME, MINI_APP_NAME } from '@/game/data/social';
import { tgInitData } from '@/telegram/webapp';
import { apiGet, apiPost, type ApiFail } from './api';
import { refreshGems } from './gems';

/** Кошелёк, подключённый через TON Connect: адрес (`0:…`) и сеть (`-3` тестовая, `-239` основная). */
export interface PayWallet {
  address: string;
  chain: string;
}

export interface PayStore {
  /** Оплата настроена на сервере; `null` — сервер ещё не ответил. */
  on: boolean | null;
  net: 'testnet' | 'mainnet' | null;
  orders: PayOrderView[];
  wallet: PayWallet | null;
  /** Библиотека кошелька загружена. */
  ready: boolean;
  /** Что в пути: `order:<набор>` или `connect`. */
  busy: string | null;
}

export const usePay = create<PayStore>(() => ({ on: null, net: null, orders: [], wallet: null, ready: false, busy: null }));

const WHY: Partial<Record<ApiFail, string>> = {
  offline: 'Нет связи: покупка — только при связи.',
  auth: 'Покупка — только в игре из Telegram.',
  busy: 'Слишком часто. Попробуй через пару секунд.',
  frozen: 'Аккаунт заморожен: приказы не принимаются.',
};

function fold(raw: unknown): PayResponse | null {
  const r = readPayResponse(raw);
  if (!r) return null;
  usePay.setState({ on: r.on, net: r.net ?? null, orders: r.orders });
  // Легли алмазы — баланс и «История» с сервера.
  if (r.credited) void refreshGems();
  return r;
}

/** Заказы и проверка сети — при открытии вкладки и раз в несколько секунд, пока заказ ждёт перевода. */
export async function refreshPay(): Promise<void> {
  if (!tgInitData()) return;
  const res = await apiGet<PayResponse>('/api/pay');
  if (res.ok) fold(res.data);
}

/** Есть ли заказ, перевод которого ещё ищут. */
export const anyWaiting = (orders: PayOrderView[], now: number): boolean =>
  orders.some((o) => o.state === 'paid' || ((o.state === 'created' || o.state === 'waiting') && now <= o.until));

// ------------------------------------------------ TON Connect ---

let ui: Promise<TonConnectUI> | null = null;

/** Адрес манифеста TON Connect — рядом с игрой (`public/tonconnect-manifest.json`). */
const manifestUrl = (): string => new URL('/tonconnect-manifest.json', location.origin).toString();

/** Подключение кошелька — одно на запуск. */
export function tonConnect(): Promise<TonConnectUI> {
  ui ??= Promise.resolve().then(() => {
    const t = new TonConnectUI({
      manifestUrl: manifestUrl(),
      uiPreferences: { theme: THEME.DARK },
      language: 'ru',
      // Из кошелька в Telegram — обратно в игру.
      actionsConfiguration: { twaReturnUrl: `https://t.me/${BOT_USERNAME}/${MINI_APP_NAME}` },
    });
    const take = (): void => {
      const a = t.account;
      usePay.setState({ wallet: a ? { address: a.address, chain: String(a.chain) } : null });
    };
    t.onStatusChange(take);
    void t.connectionRestored.then(take);
    take();
    usePay.setState({ ready: true });
    return t;
  });
  return ui;
}

/** Сеть, в которой кошелёк подключается: та, что настроена на сервере (`-3` / `-239`). Кошелёк в другой не войдёт. */
export async function pinNetwork(net: 'testnet' | 'mainnet'): Promise<void> {
  const t = await tonConnect();
  t.setConnectionNetwork(net === 'mainnet' ? '-239' : '-3');
}

/** Подключить кошелёк — окно выбора кошелька TON Connect. */
export async function connectWallet(): Promise<void> {
  const t = await tonConnect();
  await t.openModal();
}

export async function disconnectWallet(): Promise<void> {
  const t = await tonConnect();
  if (t.connected) await t.disconnect();
}

/**
 * Купить набор: заказ на сервере → перевод кошельком → «подписал» серверу. Возвращает слова для строки или `null`.
 * Алмазы ложатся позже, когда сервер найдёт перевод в сети (`refreshPay`).
 */
export async function buyPack(pack: string): Promise<string | null> {
  const { wallet, busy } = usePay.getState();
  if (busy) return 'Предыдущая покупка ещё в пути.';
  if (!wallet) {
    await connectWallet();
    return null;
  }
  usePay.setState({ busy: `order:${pack}` });
  try {
    const res = await apiPost<PayResponse>('/api/pay', { op: 'order', pack, wallet: wallet.address, chain: wallet.chain });
    if (!res.ok) return WHY[res.why] ?? 'Сокровищница не ответила. Попробуй ещё раз.';
    const r = fold(res.data);
    if (!r || r.error || !r.tx || !r.order) return r?.error ?? 'Сокровищница не ответила. Попробуй ещё раз.';
    const t = await tonConnect();
    try {
      await t.sendTransaction({
        validUntil: r.tx.validUntil,
        network: r.tx.network,
        messages: r.tx.messages,
      });
    } catch {
      return 'Перевод не подписан. Заказ подождёт полчаса.';
    }
    const sent = await apiPost<PayResponse>('/api/pay', { op: 'sent', id: r.order.id });
    if (sent.ok) fold(sent.data);
    return 'Перевод отправлен. Алмазы лягут, как только сеть его подтвердит.';
  } finally {
    usePay.setState({ busy: null });
  }
}
