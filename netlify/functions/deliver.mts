/**
 * Доставка уведомлений — функция по расписанию, раз в минуту. Первая фоновая работа
 * сервера (docs/NOTIFY.md, раздел 3).
 *
 * В этой пачке она проходит всю цепочку — метки индекса, запись исходящих, правила
 * отправки, условную отметку «ушло» — и **не отправляет ничего**: адаптеров нет ни одного.
 * Вместо отправки каждый проход кладёт счётчик в `tribe-notify-stats`: сколько созрело,
 * сколько ушло бы, сколько отброшено и почему. Ключей игроков в счётчиках нет.
 *
 * Работает только на опубликованной выкладке: на предпросмотрах и ветках Netlify
 * расписание не запускает. По адресу её не вызвать — путь ей не объявлен.
 *
 * Ключ записи исходящих здесь берётся **только из метки индекса** и только вида `tg-<число>`
 * (`lib/deliver.ts`); подписи у прохода нет, и собрать ключ больше не из чего.
 */
import type { Config } from '@netlify/functions';
import { getStore } from '@netlify/blobs';
import { deliverPass, type Kv } from '../lib/deliver.js';

export const config: Config = { schedule: '* * * * *' };

/** Хранилище в узкой двери прохода: чтение текстом, запись, перечисление, удаление. */
const kv = (name: string): Kv => {
  const s = getStore({ name, consistency: 'strong' });
  return {
    getWithMetadata: async (key, opts) => {
      const found = await s.getWithMetadata(key, opts);
      return found ? { data: String(found.data), etag: found.etag } : null;
    },
    setJSON: (key, value, opts) => s.setJSON(key, value, opts?.onlyIfMatch ? { onlyIfMatch: opts.onlyIfMatch } : { onlyIfNew: opts?.onlyIfNew }),
    set: (key, value) => s.set(key, value),
    list: (opts) => s.list(opts),
    delete: (key) => s.delete(key),
  };
};

export default async (): Promise<Response> => {
  await deliverPass({ notify: kv('tribe-notify'), due: kv('tribe-notify-due'), stats: kv('tribe-notify-stats') }, Date.now(), Date.now);
  return new Response(null, { status: 204 });
};
