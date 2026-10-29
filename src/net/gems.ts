/**
 * Алмазы в игре (docs/gems.md): баланс, лавка и журнал — с сервера, трата — приказом. Своего баланса у игры нет и быть не
 * может: число, которое видит игрок, — последнее, что сказал сервер (`/api/gems` или записка с ответом сохранения), и
 * меняет его только `takeGems` из ответа. Начислить отсюда нельзя ничего — приказы (`net/gemorder`) только тратят.
 *
 * Дела, за которые сервер уже списал алмазы (припас лавки, достройка), применяет партия одной дверью
 * (`game/sim/gems.applyGemDeeds`) — сюда их только приносят. Как и указы админа (`net/admin.ts`), модуль про игру не
 * знает: применение ему отдаёт стор игры (`provideGemDeeds`), иначе импорты замкнулись бы в кольцо.
 *
 * Без сети траты нет: кнопки гаснут с причиной (`gemsOffline`), всё остальное в игре работает как работало.
 */
import { create } from 'zustand';
import {
  GEM_SEEN_PARAM,
  SAVE_PUSH_MS,
  readGemList,
  readGemNote,
  type GemEntry,
  type GemShop,
  type GemsResponse,
} from '../../netlify/lib/contract';
import { tgInitData } from '@/telegram/webapp';
import { apiGet, type ApiFail } from './api';
import { serverNow } from './clock';

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

export const OFFLINE = 'Нет связи с Сокровищницей.';
export const OUTSIDE = 'Алмазы тратятся только в игре внутри Telegram.';

/** Почему тратить алмазы сейчас нельзя по связи; `null` — можно. */
export function gemsOffline(g: Pick<GemsStore, 'balance' | 'at' | 'why'> = useGems.getState(), now: number = serverNow()): string | null {
  if (!tgInitData()) return OUTSIDE;
  if (g.why) return g.why;
  if (g.balance === null || g.at === null || now - g.at > GEMS_STALE_MS) return OFFLINE;
  return null;
}

let apply: ((deeds: GemEntry[]) => void) | null = null;
let seenOf: (() => number) | null = null;

/** Чем применять дела — отдаёт стор игры. */
export const provideGemDeeds = (fn: (deeds: GemEntry[]) => void): void => {
  apply = fn;
};

/** Чем читать номер последнего применённого дела партии (`GameState.gemSeen`) — отдаёт стор игры. */
export const provideGemSeen = (fn: () => number): void => {
  seenOf = fn;
};

let settle: ((settled: number[]) => void) | null = null;

/** Чем снимать рассуждённые сервером ускорения «не понадобилось» (FIN-5) — отдаёт стор игры. */
export const provideGemSettled = (fn: (settled: number[]) => void): void => {
  settle = fn;
};

/** Номер последнего применённого дела; стор ещё не отдал — `null` (сервер ответит по-старому). */
export const gemSeenNow = (): number | null => (seenOf ? seenOf() : null);

/**
 * Хвост адреса с номером партии: сервер отдаст дела после него, самые старые первыми (FIN-4). Номера нет — пусто.
 * `first` — первый ли это параметр адреса.
 */
export const gemSeenQuery = (first = true): string => {
  const n = gemSeenNow();
  return n === null ? '' : `${first ? '?' : '&'}${GEM_SEEN_PARAM}=${n}`;
};

/** Сколько порций подряд дочитываем по «ещё»: журнал держит тысячу записей — это двадцать порций с запасом. */
const CHASE_MAX = 30;
let chased = 0;

/**
 * Записка из ответа сервера: баланс, лавка, дела. Нет её или кривая — ничего не меняется. Дела уходят в партию все:
 * уже применённые дверь отсеет номером. Сервер сказал «ещё» (FIN-4) — применив эти, сразу спрашиваем следующие; номер
 * не сдвинулся — не спрашиваем, чтобы не крутиться на месте.
 */
export function takeGems(raw: unknown): void {
  const note = readGemNote(raw);
  if (!note) return;
  useGems.setState({ balance: note.balance, shop: note.shop, at: serverNow(), why: null });
  const before = gemSeenNow();
  if (note.deeds.length && apply) apply(note.deeds);
  if (note.settled?.length && settle) settle(note.settled);
  const after = gemSeenNow();
  if (note.more && before !== null && after !== null && after > before && chased < CHASE_MAX) {
    chased++;
    void refreshGems();
  } else {
    chased = 0;
  }
}

/** Сохранение не дошло до сервера — связи нет; баланс остаётся последним известным, тратить нельзя. */
export function gemsQuiet(why: ApiFail): void {
  if (why === 'offline' || why === 'server') useGems.setState({ why: OFFLINE });
}

/** Ответ `/api/gems` — записка и журнал (на чтение и на приказ, `net/gemorder`). */
export const foldGems = (data: GemsResponse): void => {
  takeGems(data);
  useGems.setState({ list: readGemList(data.list) });
};

/** Прочитать алмазы и журнал — при открытии Сокровищницы. Вне Telegram — тихо ничего. */
export async function refreshGems(): Promise<void> {
  if (!tgInitData()) return;
  const res = await apiGet<GemsResponse>(`/api/gems${gemSeenQuery()}`);
  if (res.ok) foldGems(res.data);
  else gemsQuiet(res.why);
}
