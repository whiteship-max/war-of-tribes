/**
 * Вести края (docs/feed.md): чтение `/api/feed`. Записи пишет сервер; клиент только показывает и ничего не присылает —
 * тела у запроса нет.
 */
import { apiGet } from './api';
import { FEED_KINDS, type FeedItem, type FeedResponse } from '../../netlify/lib/contract';

export type { FeedItem };

/** Пока карта открыта, она спрашивает ленту не чаще раза в минуту — как рейтинг. */
export const FEED_PULL_MS = 60_000;

export type FeedResult = { ok: true; items: FeedItem[]; now: number } | { ok: false; why: string };

/** Почему ленты нет — словами для окна. */
const WHY: Record<string, string> = {
  auth: 'Вести края видны в игре из Telegram.',
  offline: 'Нет связи с сервером.',
  busy: 'Сервер занят. Попробуй через минуту.',
};

const okItem = (r: unknown): r is FeedItem => {
  const x = r as Partial<FeedItem> | null;
  return (
    !!x &&
    typeof x.id === 'string' &&
    (FEED_KINDS as readonly string[]).includes(x.kind as string) &&
    typeof x.at === 'number' &&
    typeof x.x === 'number' &&
    typeof x.y === 'number' &&
    typeof x.city === 'string'
  );
};

export async function fetchFeed(): Promise<FeedResult> {
  const res = await apiGet<FeedResponse>('/api/feed');
  if (!res.ok) return { ok: false, why: WHY[res.why] ?? 'Вести края сейчас не получить.' };
  const items = Array.isArray(res.data?.items) ? res.data.items.filter(okItem) : [];
  return { ok: true, items, now: typeof res.data?.now === 'number' ? res.data.now : 0 };
}
