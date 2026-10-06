/**
 * Отчёты об ошибках (docs/admin.md): что хранится и как зовётся. Хранилище `tribe-reports`, ключ — номер отчёта.
 * Кладёт отчёт адрес `/api/report` (личность — из подписи), читают команды админа `/reports` и `/report`.
 *
 * Хранится только нужное, чтобы разобраться: текст игрока, версия, устройство, экран, что было со сценой и последние
 * строки летописи. Снимка экрана пока нет — место под него оставлено в договоре (`ReportPut.shot`).
 */
import { readReport, type ReportCtx } from './contract.js';
import { PLAYER } from './admin.js';
import { parseJson } from './http.js';
import type { Kv } from './kv.js';

export interface StoredReport {
  v: 1;
  id: string;
  at: number;
  /** Ключ игрока `tg-<id>` — из подписи. */
  player: string;
  /** Имя пользователя Telegram и имя города — чтобы админ узнал игрока без поиска. */
  user: string;
  city: string;
  text: string;
  ctx: ReportCtx;
}

/** Номер отчёта: минута прихода в 36-ричной записи и хвост номера игрока. Растёт со временем — список сортируется им. */
export const reportId = (now: number, player: string): string => `${now.toString(36)}-${player.slice(-4)}`;

/** Вид номера: проверяется до похода в хранилище. */
export const REPORT_ID = /^[0-9a-z]{6,12}-\d{1,4}$/;

export function readStoredReport(v: unknown): StoredReport | null {
  if (!v || typeof v !== 'object') return null;
  const r = v as Record<string, unknown>;
  const body = readReport(r);
  if (!body || typeof r.id !== 'string' || !REPORT_ID.test(r.id) || typeof r.player !== 'string' || !PLAYER.test(r.player)) return null;
  return {
    v: 1,
    id: r.id,
    at: typeof r.at === 'number' ? r.at : 0,
    player: r.player,
    user: typeof r.user === 'string' ? r.user.slice(0, 32) : '',
    city: typeof r.city === 'string' ? r.city.slice(0, 64) : '',
    text: body.text,
    ctx: body.ctx,
  };
}

/** Отчёт по номеру; нет или испорчен — `null`. */
export async function reportAt(kv: Kv, id: string): Promise<StoredReport | null> {
  const found = await kv.getWithMetadata(id);
  return readStoredReport(found ? parseJson(String(found.data)) : null);
}
