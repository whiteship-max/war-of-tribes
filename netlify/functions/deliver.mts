/**
 * Доставка уведомлений на Netlify — функция по расписанию, раз в минуту (docs/NOTIFY.md, разделы 3 и 12). Проход
 * целиком — в общем `lib/deliver.ts`, одном на Netlify и на своём сервере (`vps/schedule.ts`): ход войны между
 * игроками, метки индекса, правила отправки, условная отметка «ушло», адаптер Telegram.
 *
 * **Включается флагом `TRIBE_DELIVER=on`** (`http.deliverOn`) в переменных окружения сайта. Без флага функция
 * просыпается по расписанию и сразу выходит, ничего не читая: снять одно расписание переменной Netlify не даёт, а
 * функция без `schedule` и без `path` отвечала бы всякому по адресу `/.netlify/functions/deliver`. Расписание
 * работает только на опубликованной выкладке; по адресу функцию по расписанию не вызвать.
 *
 * Ключ записи исходящих здесь берётся **только из метки индекса** и только вида `tg-<число>` (`lib/deliver.ts`);
 * подписи у прохода нет, и собрать ключ больше не из чего.
 *
 * Была заморожена 16.09.2026 (docs/SUBTRACT.md): адаптеров не было, проход не отправлял ничего. Разморожена
 * 05.10.2026 вместе с адаптером Telegram и флагом (решение владельца, docs/NOTIFY.md, раздел 12).
 */
import type { Config } from '@netlify/functions';
import { blobsStores } from '../lib/blobs.js';
import { deliverPass, passIoOf } from '../lib/deliver.js';
import { deliverOn } from '../lib/http.js';
import { telegram } from '../lib/telegram.js';

export const config: Config = { schedule: '* * * * *' };

export default async (): Promise<Response> => {
  if (deliverOn()) await deliverPass(passIoOf(blobsStores(), telegram()), Date.now(), Date.now);
  return new Response(null, { status: 204 });
};
