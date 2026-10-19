/**
 * Отчёт об ошибке (`/api/report`, docs/admin.md): игрок пишет текст, игра прикладывает, что знает о себе (версия,
 * устройство, экран, что было со сценой, последние события), сервер кладёт отчёт и коротко пишет админам в бот —
 * подробности по команде `/report <номер>`. Один обработчик на Netlify (`functions/report.mts`) и на своём сервере.
 *
 * Личность — только из подписи, как везде: отчёт нельзя прислать от чужого имени. Поток держит наблюдение игрока —
 * не больше `REPORT_LIMITS.perHour` отчётов в час; счёт лежит в хранилище и переживает смерть экземпляра функции.
 * Снимка экрана пока нет: место под него оставлено в договоре (`ReportPut.shot`).
 */
import { readInitData, saveKeyOf } from '../initdata.js';
import { allow, botToken, deny, json, parseJson, readBody, type Route } from '../http.js';
import { REPORT_LIMITS, cityName, cityOr, readReport, type ReportResponse } from '../contract.js';
import { STORES } from '../kv.js';
import { adminIds } from '../admin.js';
import { reportId, type StoredReport } from '../reports.js';
import { observe, reported, reportsInHour, touched } from '../watch.js';
import { telegram, type Telegram } from '../telegram.js';

/** Запросов в минуту на игрока — грубое сито поверх настоящего предела в час. */
const PER_MINUTE = 6;

/** Сколько текста игрока уходит админу в бот сразу; остальное — по `/report`. */
const PREVIEW = 300;

export const reportWith =
  (tg: () => Telegram): Route =>
  async (req, io) => {
    const now = io.now;
    const auth = readInitData(req.headers.get('x-telegram-init-data'), botToken(), Math.floor(now / 1000));
    if (!auth.ok) return deny(401, 'unauthorized');

    const key = saveKeyOf(auth.user);
    if (!allow(`report:${key}`, PER_MINUTE, now)) return deny(429, 'slow-down', { 'retry-after': '10' });
    if (req.method !== 'POST') return deny(405, 'method');

    const text = await readBody(req);
    if (text === null) return deny(413, 'too-big');
    const sent = readReport(parseJson<unknown>(text));
    if (!sent) return deny(400, 'bad-body');

    const id = reportId(now, key);
    let over = false;
    let city = '';
    await observe(io.stores, key, (rec) => {
      if (reportsInHour(rec, now) >= REPORT_LIMITS.perHour) {
        over = true;
        return null;
      }
      city = cityName(rec.card?.city) ?? '';
      return reported(touched(rec, now, auth.user.username), now, id, sent.text);
    });
    if (over) return deny(429, 'too-many', { 'retry-after': '600' });

    const user = auth.user.username ?? '';
    const stored: StoredReport = { v: 1, id, at: now, player: key, user, city, text: sent.text, ctx: sent.ctx };
    const put = await io.stores(STORES.reports).setJSON(id, stored, { onlyIfNew: true });
    if (!put.modified) return deny(429, 'slow-down', { 'retry-after': '5' });

    const api = tg();
    const short = sent.text.length > PREVIEW ? `${sent.text.slice(0, PREVIEW)}…` : sent.text;
    const note = `Отчёт об ошибке ${id}\n«${cityOr(city)}» ${key}${user ? ` @${user}` : ''} · день ${sent.ctx.day} · ${sent.ctx.view || '—'}\n\n${short}\n\nПодробнее: /report ${id}`;
    for (const admin of adminIds()) await api.say(admin, note);

    const body: ReportResponse = { now, id };
    return json(body);
  };

export const report: Route = reportWith(() => telegram());
