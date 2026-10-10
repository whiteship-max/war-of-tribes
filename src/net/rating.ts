/**
 * Рейтинг игроков (docs/rating.md): чтение `/api/rating`. Очки считает сервер; клиент только показывает и ничего не
 * присылает — тела у запроса нет.
 */
import { apiGet } from './api';
import type { RatingResponse, RatingRow } from '../../netlify/lib/contract';

export type { RatingRow };

/** Пока окно рейтинга открыто, оно спрашивает сервер не чаще раза в минуту. */
export const RATING_PULL_MS = 60_000;

export type RatingResult = { ok: true; rows: RatingRow[] } | { ok: false; why: string };

/** Почему рейтинга нет — словами для окна. */
const WHY: Record<string, string> = {
  auth: 'Рейтинг виден в игре из Telegram.',
  offline: 'Нет связи.',
  busy: 'Слишком часто. Попробуй через минуту.',
};

const okRow = (r: unknown): r is RatingRow => {
  const x = r as Partial<RatingRow> | null;
  return !!x && typeof x.id === 'string' && typeof x.place === 'number' && typeof x.points === 'number';
};

export async function fetchRating(): Promise<RatingResult> {
  const res = await apiGet<RatingResponse>('/api/rating');
  if (!res.ok) return { ok: false, why: WHY[res.why] ?? 'Рейтинг сейчас не получить.' };
  const rows = Array.isArray(res.data?.rows) ? res.data.rows.filter(okRow) : [];
  return { ok: true, rows };
}
