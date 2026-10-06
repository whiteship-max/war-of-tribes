/**
 * Поручения сервера в исходящие игроков — новости войны между игроками (docs/NOTIFY.md, раздел 12).
 *
 * Бой между игроками считает сервер (`war.advance`), значит и сказать о нём может только он: клиента в минуту боя
 * может не быть ни у одной стороны. Новости выводятся из записи войн (`war.newsOf`), а кладутся сюда тем, кто
 * **записал** ход войны, — обработчиком `/api/war` или проходом доставки, — и только после удачной условной записи:
 * проигравший гонку ход не случился, его новости кладёт победитель. Ключ новости — имя момента, поэтому вторая
 * кладка той же новости не задваивает её, а ушедшая не уйдёт снова (`notify.news`).
 *
 * Игрок — ключ из записи войны (`WarRow.atk` / `def`): туда он попал из подписи нападающего и из реестра. Других
 * ключей здесь не собирается, и вида ключа проверяется тот же, что у метки индекса (`PLAYER_KEY`).
 */
import { parseJson, WRITE_TRIES } from './http.js';
import type { Kv } from './kv.js';
import type { NoticeItem } from './contract.js';
import { news, PLAYER_KEY, readNotify } from './notify.js';

export interface OutboxIo {
  /** Записи исходящих по ключу игрока. */
  notify: Kv;
  /** Индекс по минутам. */
  due: Kv;
}

/** Положить новости войны игрокам. Ошибка одного игрока не мешает другим: новость — не партия. */
export async function queueNews(io: OutboxIo, diff: Map<string, { add: NoticeItem[]; drop: string[] }>, now: number): Promise<void> {
  for (const [player, d] of diff) {
    if (!PLAYER_KEY.test(player) || (d.add.length === 0 && d.drop.length === 0)) continue;
    try {
      for (let tries = 0; tries < WRITE_TRIES; tries++) {
        const found = await io.notify.getWithMetadata(player);
        const rec = readNotify(found ? parseJson(String(found.data)) : null);
        const { record, marks } = news(rec, d.add, d.drop, player, now);
        const written = await io.notify.setJSON(player, record, found?.etag ? { onlyIfMatch: found.etag } : { onlyIfNew: true });
        if (!written.modified) continue;
        for (const mark of marks) await io.due.set(mark, '1');
        break;
      }
    } catch {
      // Хранилище не ответило: новость потеряна, война цела. Повторять некому — и это выбор, как у отправки.
    }
  }
}
