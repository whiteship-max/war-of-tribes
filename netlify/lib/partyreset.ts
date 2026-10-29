/**
 * Обнулить партию одного игрока (30.10.2026, решение владельца: владелец начинает Путь меча с нуля; docs/admin.md).
 *
 * Чистый старт мира (`era.wipeWorld`) стирает всех; здесь — один ключ, и только его записи:
 *   1. **архив** — копия партии и наблюдения (опись, книги, флаги) в хранилище админки, ключ `archive/<игрок>/<минута>`; на всякий
 *      случай, восстановления из него нет — его читают руками;
 *   2. **стирание** — запись партии и наблюдение игрока. Книги стройки, войска и запасов начнутся заново первой записью новой
 *      партии, как у новичка: иначе сервер сверял бы новую партию со старыми книгами и звал её подделкой;
 *   3. **метка** — минута обнуления, ключ `reset/<игрок>`: её несёт записка админки (`AdminNote.reset`), и устройство, чья партия
 *      старше метки, стирает её и начинает новую (`src/net/sync.ts`). Без метки старая партия с телефона легла бы на пустой
 *      сервер первой записью — и обнуление не значило бы ничего.
 * Указы, книга алмазов, заморозка и строка реестра не трогаются: указы и дела алмазов — за игроком, а не за партией (новая партия
 * на устройстве наследует их номера, как «Начать заново»), а строку замка перепишет первая же запись новой партии. Чужие ключи —
 * не читаются и не пишутся.
 *
 * Метка пишется последней: устройство, получившее её раньше стирания, приняло бы с сервера старую партию как чужую и продолжило её.
 */
import { parseJson } from './http.js';
import { STORES, type Stores } from './kv.js';
import { PLAYER, logAdmin, rewrite } from './admin.js';

export const resetKey = (player: string): string => `reset/${player}`;
export const archiveKey = (player: string, at: number): string => `archive/${player}/${at}`;

export interface ResetFile {
  v: 1;
  /** Минута последнего обнуления; не было — 0. */
  at: number;
  /** Кто обнулил: идентификатор админа (0 — с сервера, командой обслуживания). */
  by: number;
}

export function readReset(v: unknown): ResetFile {
  const r = (v && typeof v === 'object' ? v : {}) as Record<string, unknown>;
  const at = typeof r.at === 'number' && Number.isSafeInteger(r.at) && r.at > 0 ? r.at : 0;
  return { v: 1, at, by: typeof r.by === 'number' && Number.isSafeInteger(r.by) ? r.by : 0 };
}

/** Минута обнуления партии игрока; не обнуляли — 0. Строгим чтением: устройство обязано узнать о нём с первого ответа. */
export async function resetOf(stores: Stores, player: string): Promise<number> {
  const found = await stores(STORES.admin, 'strong').getWithMetadata(resetKey(player));
  return readReset(found ? parseJson(String(found.data)) : null).at;
}

/** Что легло в архив: ключ и были ли партия и наблюдение. */
export interface ResetDone {
  archive: string;
  save: boolean;
  watch: boolean;
  at: number;
}

/**
 * Обнулить партию игрока `player`: архив → стирание → метка → строка журнала админа. Возвращает итог или отказ словами. Повтор
 * безопасен: второй архив ляжет рядом, метка станет новее.
 */
export async function resetParty(stores: Stores, player: string, by: number, now: number): Promise<ResetDone | string> {
  if (!PLAYER.test(player)) return `Ключ игрока «${player}» не похож на tg-<номер>.`;
  const saves = stores(STORES.saves, 'strong');
  const watch = stores(STORES.watch, 'strong');
  const admin = stores(STORES.admin, 'strong');
  const save = await saves.getWithMetadata(player);
  const seen = await watch.getWithMetadata(player);
  const archive = archiveKey(player, now);
  await admin.setJSON(archive, {
    v: 1,
    at: now,
    by,
    player,
    save: save ? { etag: save.etag ?? null, data: String(save.data) } : null,
    watch: seen ? { etag: seen.etag ?? null, data: String(seen.data) } : null,
  });
  const kept = await admin.getWithMetadata(archive);
  if (!kept) return 'Архив не записался — партия не тронута.';
  if (save) await saves.delete(player);
  if (seen) await watch.delete(player);
  const mark = await rewrite(admin, resetKey(player), readReset, () => ({ v: 1 as const, at: now, by }));
  if (!mark) return 'Партия стёрта, а метка обнуления не записалась — повтори: без метки устройство вернёт старую партию.';
  await logAdmin(stores, { at: now, by, who: player, what: `Партия обнулена: архив ${archive}${save ? '' : ' (партии на сервере не было)'}.` });
  return { archive, save: Boolean(save), watch: Boolean(seen), at: now };
}
