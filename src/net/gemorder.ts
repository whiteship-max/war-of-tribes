/**
 * Приказы алмазов (docs/gems.md; ПН-6 — лечение) — своим модулем: их зовёт только интерфейс трат (лавка, ускорение, лечение — куски
 * нового вида), а записка, баланс и дела (`net/gems`) нужны с первой загрузки. Трата — приказом серверу с ключом повтора; ответ
 * кладёт записку той же дверью (`foldGems` → `takeGems`). Начислить отсюда нельзя ничего: все виды приказа только тратят.
 */
import type { GemGood, GemOrder, GemsResponse } from '../../netlify/lib/contract';
import { apiPost, type ApiFail } from './api';
import { serverNow } from './clock';
import { tab } from './session';
import { OFFLINE, OUTSIDE, foldGems, gemSeenNow, gemsOffline, gemsQuiet, useGems } from './gems';

/** Причина отказа словами — для всплывающей строки. */
const WHY: Partial<Record<ApiFail, string>> = {
  offline: OFFLINE,
  auth: OUTSIDE,
  busy: 'Слишком часто. Попробуй через пару секунд.',
  frozen: 'Твой счёт заморожен.',
  server: 'Сокровищница не ответила. Попробуй ещё раз.',
};

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
    foldGems(res.data);
    return typeof res.data.error === 'string' ? res.data.error : null;
  } finally {
    useGems.setState({ busy: null });
  }
}

/** Номер партии в приказе: ответ привезёт дела после него, и среди них — только что купленное (FIN-4). */
const seenPart = (): { seen?: number } => {
  const n = gemSeenNow();
  return n === null ? {} : { seen: n };
};

/** Купить в лавке сто единиц припаса. */
export const orderBuy = (res: GemGood): Promise<string | null> => order(`buy:${res}`, { op: 'buy', key: freshKey(), res, ...seenPart() });

/** Ускорить стройку: постройка, уровень, остаток работы и цена, которую видел игрок. */
export const orderRush = (id: number, building: string, level: number, work: number, price: number): Promise<string | null> =>
  order(`rush:${id}`, { op: 'rush', key: freshKey(), building, level, work, price, ...seenPart() });

/** Лечение (ПН-6): раненые со сроком `until` (игровая секунда) и не раньше, остаток `left` настоящих секунд, цена, которую видел игрок. */
export const orderHeal = (until: number, left: number, price: number): Promise<string | null> =>
  order(`heal:${until}`, { op: 'heal', key: freshKey(), until, left, price, ...seenPart() });
