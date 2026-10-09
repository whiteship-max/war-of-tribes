/**
 * Алмазы в игре (docs/gems.md): баланс, лавка и журнал — с сервера, трата — приказом. Своего баланса у игры нет и быть не
 * может: число, которое видит игрок, — последнее, что сказал сервер (`/api/gems` или записка с ответом сохранения), и
 * меняет его только `takeGems` из ответа. Начислить отсюда нельзя ничего — у приказа два вида, и оба тратят.
 *
 * Дела, за которые сервер уже списал алмазы (припас лавки, достройка), применяет партия одной дверью
 * (`game/sim/gems.applyGemDeeds`) — сюда их только приносят. Как и указы админа (`net/admin.ts`), модуль про игру не
 * знает: применение ему отдаёт стор игры (`provideGemDeeds`), иначе импорты замкнулись бы в кольцо.
 *
 * Без сети траты нет: кнопки гаснут с причиной (`gemsOffline`), всё остальное в игре работает как работало.
 */
import { create } from 'zustand';
import {
  SAVE_PUSH_MS,
  readGemList,
  readGemNote,
  type GemEntry,
  type GemGood,
  type GemOrder,
  type GemShop,
  type GemsResponse,
} from '../../netlify/lib/contract';
import { tgInitData } from '@/telegram/webapp';
import { apiGet, apiPost, type ApiFail } from './api';
import { serverNow } from './clock';
import { tab } from './session';

export interface GemsStore {
  /** Баланс с сервера; `null` — сервер ещё не сказал. */
  balance: number | null;
  /** Лавка сегодня. */
  shop: GemShop | null;
  /** Журнал для «Истории» — с последнего чтения `/api/gems`. */
  list: GemEntry[];
  /** Когда сервер говорил об алмазах последний раз, по серверным часам. */
  at: number | null;
  /** Связи нет: почему, словами. `null` — с последнего ответа связь была. */
  why: string | null;
  /** Приказ в пути: что именно (`buy:stone`, `rush:<id>`), — его кнопка ждёт ответа. */
  busy: string | null;
}

export const useGems = create<GemsStore>(() => ({ balance: null, shop: null, list: [], at: null, why: null, busy: null }));

/** Сервер молчит дольше трёх записей партии — связи нет. Записка приезжает с каждой (раз в минуту). */
export const GEMS_STALE_MS = 3 * SAVE_PUSH_MS;

export const OFFLINE = 'Нет связи: алмазы тратятся только при связи.';
export const OUTSIDE = 'Алмазы тратятся только в игре из Telegram.';

/** Почему тратить алмазы сейчас нельзя по связи; `null` — можно. */
export function gemsOffline(g: Pick<GemsStore, 'balance' | 'at' | 'why'> = useGems.getState(), now: number = serverNow()): string | null {
  if (!tgInitData()) return OUTSIDE;
  if (g.why) return g.why;
  if (g.balance === null || g.at === null || now - g.at > GEMS_STALE_MS) return OFFLINE;
  return null;
}

let apply: ((deeds: GemEntry[]) => void) | null = null;

/** Чем применять дела — отдаёт стор игры. */
export const provideGemDeeds = (fn: (deeds: GemEntry[]) => void): void => {
  apply = fn;
};

/**
 * Записка из ответа сервера: баланс, лавка, дела. Нет её или кривая — ничего не меняется. Дела уходят в партию все:
 * уже применённые дверь отсеет номером.
 */
export function takeGems(raw: unknown): void {
  const note = readGemNote(raw);
  if (!note) return;
  useGems.setState({ balance: note.balance, shop: note.shop, at: serverNow(), why: null });
  if (note.deeds.length && apply) apply(note.deeds);
}

/** Сохранение не дошло до сервера — связи нет; баланс остаётся последним известным, тратить нельзя. */
export function gemsQuiet(why: ApiFail): void {
  if (why === 'offline' || why === 'server') useGems.setState({ why: OFFLINE });
}

/** Причина отказа словами — для всплывающей строки. */
const WHY: Partial<Record<ApiFail, string>> = {
  offline: OFFLINE,
  auth: OUTSIDE,
  busy: 'Слишком часто. Попробуй через пару секунд.',
  frozen: 'Аккаунт заморожен: приказы не принимаются.',
  server: 'Сокровищница не ответила. Попробуй ещё раз.',
};

const fold = (data: GemsResponse): void => {
  takeGems(data);
  useGems.setState({ list: readGemList(data.list) });
};

/** Прочитать алмазы и журнал — при открытии Сокровищницы. Вне Telegram — тихо ничего. */
export async function refreshGems(): Promise<void> {
  if (!tgInitData()) return;
  const res = await apiGet<GemsResponse>('/api/gems');
  if (res.ok) fold(res.data);
  else gemsQuiet(res.why);
}

let seq = 0;
/** Ключ повтора: признак запуска, серверная минута и счёт — один на нажатие. */
const freshKey = (): string => `${tab}-${serverNow().toString(36)}-${++seq}`;

/**
 * Приказ серверу. Возвращает отказ словами или `null`. Ответ приносит записку и журнал; дело (припас, достройка) ложится
 * в партию через `takeGems` — так же, как если бы оно приехало с записью партии. Ответ потерялся по дороге — дело и
 * баланс приедут со следующей запиской: сервер списал ровно один раз.
 */
async function order(what: string, body: GemOrder): Promise<string | null> {
  if (useGems.getState().busy) return 'Предыдущий приказ ещё в пути.';
  const off = gemsOffline();
  if (off) return off;
  useGems.setState({ busy: what });
  try {
    const res = await apiPost<GemsResponse>('/api/gems', body);
    if (!res.ok) {
      gemsQuiet(res.why);
      return WHY[res.why] ?? 'Сокровищница не ответила. Попробуй ещё раз.';
    }
    fold(res.data);
    return typeof res.data.error === 'string' ? res.data.error : null;
  } finally {
    useGems.setState({ busy: null });
  }
}

/** Купить в лавке сто единиц припаса. */
export const orderBuy = (res: GemGood): Promise<string | null> => order(`buy:${res}`, { op: 'buy', key: freshKey(), res });

/** Ускорить стройку: постройка, уровень, остаток работы и цена, которую видел игрок. */
export const orderRush = (id: number, building: string, level: number, work: number, price: number): Promise<string | null> =>
  order(`rush:${id}`, { op: 'rush', key: freshKey(), building, level, work, price });
