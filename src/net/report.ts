/**
 * Отчёт об ошибке (docs/admin.md): текст игрока и то, что игра знает о себе сама, — на `/api/report`. Сервер кладёт
 * отчёт и пишет админу в бот. Снимка экрана пока нет: место под него оставлено в договоре (`ReportPut.shot`).
 */
import type { GameState } from '@/game/types';
import { dayOf } from '@/game/derived';
import { sceneLog } from '@/scenelog';
import { deviceRatio } from '@/render/loop';
import { tgAbout } from '@/telegram/webapp';
import { REPORT_LIMITS, type ReportPut, type ReportResponse } from '../../netlify/lib/contract';
import { apiPost } from './api';
import { deviceNow } from './clock';
import { buildId } from './snapshot';

/** Что игра знает о себе в минуту отчёта: версия, устройство, экран, сцена, последние строки летописи. */
export function reportOf(text: string, view: string, s: GameState | null): ReportPut {
  let device = '';
  let screen = '';
  try {
    device = `${tgAbout()} · ${navigator.userAgent}`;
    screen = `${window.innerWidth}×${window.innerHeight} @${Math.round(deviceRatio() * 100) / 100}`;
  } catch {
    /* вне браузера */
  }
  // Летопись лежит новыми вперёд: берём последние и ставим по порядку.
  const events = s ? s.log.slice(0, REPORT_LIMITS.events).reverse().map((e) => `день ${dayOf(e.at)}: ${e.text}${(e.n ?? 1) > 1 ? ` ×${e.n}` : ''}`) : [];
  return {
    text: text.slice(0, REPORT_LIMITS.text),
    ctx: {
      build: buildId(),
      device: device.slice(0, REPORT_LIMITS.field),
      screen,
      view,
      scene: sceneLog.report({ Telegram: tgAbout() }).slice(0, REPORT_LIMITS.scene),
      events,
      clock: deviceNow(),
      day: s ? dayOf(s.time) : 0,
    },
  };
}

export type ReportResult = { ok: true; id: string } | { ok: false; why: string };

/** Отправить. Неудача — словами игрока, без технических подробностей. */
export async function sendReport(body: ReportPut): Promise<ReportResult> {
  const res = await apiPost<ReportResponse>('/api/report', body);
  if (res.ok) return { ok: true, id: res.data.id };
  switch (res.why) {
    case 'auth':
      return { ok: false, why: 'Письмо уходит только из игры, открытой в Telegram.' };
    case 'busy':
      return { ok: false, why: `Слишком много писем: не больше ${REPORT_LIMITS.perHour} в час. Попробуй позже.` };
    case 'offline':
      return { ok: false, why: 'Нет связи. Текст не пропал, отправь его, когда связь вернётся.' };
    default:
      return { ok: false, why: 'Письмо не ушло. Попробуй ещё раз чуть позже.' };
  }
}
